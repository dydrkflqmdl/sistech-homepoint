-- supabase/migrations/20261106000000_init.sql 검증. run-sql-tests.sh가 shim과 마이그레이션을 넣은 새 DB에서 돌린다.
-- psql 변수 cases: public/mission.js로 뽑은 [{input, output}] JSON
\set ON_ERROR_STOP on
\pset pager off

-- ---------- 검사 도구 ----------
create schema t;
create table t.results (n serial primary key, name text not null, pass boolean not null, detail text);
grant usage on schema t to public;
grant select, insert on t.results to public;
grant usage on sequence t.results_n_seq to public;

create function t.ok(p_name text, p_cond boolean, p_detail text default null) returns void
language sql as $$ insert into t.results (name, pass, detail) values (p_name, coalesce(p_cond, false), p_detail) $$;

create function t.eq(p_name text, p_got jsonb, p_want jsonb) returns void
language sql as $$
  insert into t.results (name, pass, detail)
  values (p_name, p_got is not distinct from p_want, '받음 ' || coalesce(p_got::text, 'NULL') || ' / 기대 ' || coalesce(p_want::text, 'NULL'))
$$;

-- sql을 현재 롤로 실행하고 오류를 'SQLSTATE: 메시지'로 돌려준다(성공하면 null). 실패한 문장의 효과는 되돌려진다.
create function t.err(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- 한국어 오류(P0001)가 정확히 그 문구로 나는지
create function t.raises(p_name text, p_sql text, p_message text) returns void
language sql as $$ select t.eq(p_name, to_jsonb(t.err(p_sql)), to_jsonb('P0001: ' || p_message)) $$;

-- 이름으로 장소 id 찾기
create function t.pid(p_name text) returns bigint
language sql as $$ select id from public.places where name = p_name $$;

-- save_mission 결과에서 status와 record 일부만 본다
create function t.sm(p_place text, p_mission text, p_fields jsonb, p_base int) returns jsonb
language sql as $$ select public.save_mission(t.pid(p_place), p_mission, p_fields, p_base) $$;

\o /dev/null
-- ---------- 구조 ----------
select t.ok('RLS 켜짐(places, missions)', (select bool_and(relrowsecurity) from pg_class where oid in ('public.places'::regclass, 'public.missions'::regclass)));
select t.eq('Realtime 발행물에 두 테이블',
  (select jsonb_agg(tablename order by tablename) from pg_publication_tables where pubname = 'supabase_realtime'),
  '["missions", "places"]');
select t.ok('places에 color 칸 없음', not exists (select from information_schema.columns where table_schema = 'public' and table_name = 'places' and column_name = 'color'));
-- 로그인 기록을 쓰는 세 함수만 security definer다(RLS를 거치지 않고 login_logs에 넣어야 한다).
select t.eq('security definer는 로그인 기록 쓰기 함수 셋뿐',
  (select jsonb_agg(proname::text order by proname) from pg_proc where pronamespace = 'public'::regnamespace and prosecdef),
  '["log_login", "log_logout", "login_logs_on_session"]');
select t.ok('public 함수는 모두 search_path=public',
  not exists (select from pg_proc where pronamespace = 'public'::regnamespace and not ('search_path=public' = any (coalesce(proconfig, '{}')))),
  (select string_agg(proname, ', ') from pg_proc where pronamespace = 'public'::regnamespace and not ('search_path=public' = any (coalesce(proconfig, '{}')))));
select t.ok('anon은 public 함수 실행 권한이 없음',
  not exists (select from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')),
  (select string_agg(proname, ', ') from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')));
select t.ok('PUBLIC에도 실행 권한이 없음',
  not exists (select from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.pronamespace = 'public'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE'));
select t.ok('authenticated는 RPC 실행 가능',
  has_function_privilege('authenticated', 'public.list_places()', 'execute')
  and has_function_privilege('authenticated', 'public.import_places(jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.save_mission(bigint, text, jsonb, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.update_memo(bigint, text)', 'execute')
  and has_function_privilege('authenticated', 'public.delete_place(bigint)', 'execute')
  and has_function_privilege('authenticated', 'public.mission_names(text)', 'execute'));
select t.ok('authenticated는 public 스키마 USAGE가 있음', has_schema_privilege('authenticated', 'public', 'usage'));
select t.ok('authenticated는 identity 시퀀스 권한이 있음',
  has_sequence_privilege('authenticated', 'public.places_id_seq', 'usage') and has_sequence_privilege('authenticated', 'public.missions_id_seq', 'usage'));
select t.ok('anon은 시퀀스 권한이 없음',
  not has_sequence_privilege('anon', 'public.places_id_seq', 'usage,select,update') and not has_sequence_privilege('anon', 'public.missions_id_seq', 'usage,select,update'));
select t.ok('트리거 함수는 authenticated도 직접 실행 못 함',
  not has_function_privilege('authenticated', 'public.places_before_write()', 'execute')
  and not has_function_privilege('authenticated', 'public.missions_before_update()', 'execute'));
select t.ok('anon은 테이블 권한이 없음',
  not has_table_privilege('anon', 'public.places', 'select,insert,update,delete')
  and not has_table_privilege('anon', 'public.missions', 'select,insert,update,delete'));

-- ---------- mission_names: JS와 같은 결과 ----------
set role authenticated;
select t.eq('mission_names ' || coalesce(to_jsonb(c ->> 'input')::text, 'null'), to_jsonb(public.mission_names(c ->> 'input')), c -> 'output')
from jsonb_array_elements(:'cases'::jsonb) c;
select t.ok('mission_names 비교 사례 5개 이상', jsonb_array_length(:'cases'::jsonb) >= 5);

-- ---------- import_places ----------
select t.eq('프런트가 함께 보내는 line 등 모르는 키는 무시',
  public.import_places('[{"line":2,"name":"L","lat":33.1,"lng":126.5,"color":"red","addressGiven":true}]'),
  '{"imported":1,"duplicates":0,"updated":0,"missionChanged":0}');
select t.ok('authenticated가 마이그레이션 권한만으로 RPC 전체 실행(update_memo·delete_place)',
  public.update_memo(t.pid('L'), '메모') ->> 'memo' = '메모' and public.delete_place(t.pid('L')));
select t.eq('빈 배열은 모두 0', public.import_places('[]'), '{"imported":0,"duplicates":0,"updated":0,"missionChanged":0}');
select t.eq('첫 가져오기: 2개 삽입',
  public.import_places('[
    {"name":"A","district":"태안군","address":"남면 1","phone":"010-1","memo":"메모1","mission":"M_01 ~ 03","lat":36.12345678912,"lng":126.1,"addressGiven":true},
    {"name":"B","lat":36.2,"lng":126.2}
  ]'),
  '{"imported":2,"duplicates":0,"updated":0,"missionChanged":0}');
select t.eq('좌표는 7자리로 반올림해 저장', (select to_jsonb(lat) from public.places where name = 'A'), '36.1234568');
select t.eq('빠진 칸은 빈 문자열', (select jsonb_build_array(district, address, phone, memo, mission) from public.places where name = 'B'), '["","","","",""]');
select t.eq('같은 것을 다시: 모두 중복, 갱신 없음',
  public.import_places('[{"name":"A","district":"태안군","address":"남면 1","phone":"010-1","memo":"메모1","mission":"M_01 ~ 03","lat":36.12345678912,"lng":126.1},{"name":"B","lat":36.2,"lng":126.2}]'),
  '{"imported":0,"duplicates":2,"updated":0,"missionChanged":0}');
select t.eq('7자리까지 같은 좌표도 중복',
  public.import_places('[{"name":"A","lat":36.12345679,"lng":126.10000001}]'),
  '{"imported":0,"duplicates":1,"updated":0,"missionChanged":0}');
select t.eq('이름이 다르면 새 장소', public.import_places('[{"name":"A2","lat":36.12345679,"lng":126.1}]'),
  '{"imported":1,"duplicates":0,"updated":0,"missionChanged":0}');

-- 미션 기록을 하나 만들어 두고 가져오기가 지우지 않는지 본다
select t.eq('기록 하나 만들기', t.sm('A', 'M_02', '{"worker":"홍길동"}', null) -> 'status', '"ok"');
select t.eq('시군만 다르면 updated 1, missionChanged 0, 전화·메모는 그대로',
  public.import_places('[{"name":"A","district":"서산시","address":"","phone":"999","memo":"바뀐메모","mission":"","lat":36.1234568,"lng":126.1}]'),
  '{"imported":0,"duplicates":1,"updated":1,"missionChanged":0}');
select t.eq('갱신 뒤 값', (select jsonb_build_array(district, address, phone, memo, mission) from public.places where name = 'A'),
  '["서산시","남면 1","010-1","메모1","M_01 ~ 03"]');
select t.eq('CSV 칸이 비어 있으면 지우지 않음',
  public.import_places('[{"name":"A","district":"","address":"","mission":"","lat":36.1234568,"lng":126.1}]'),
  '{"imported":0,"duplicates":1,"updated":0,"missionChanged":0}');
select t.eq('addressGiven=false면 주소를 바꾸지 않음',
  public.import_places('[{"name":"A","address":"다른 주소","addressGiven":false,"lat":36.1234568,"lng":126.1}]'),
  '{"imported":0,"duplicates":1,"updated":0,"missionChanged":0}');
select t.eq('addressGiven=false 뒤 주소', (select to_jsonb(address) from public.places where name = 'A'), '"남면 1"');
select t.eq('addressGiven 없으면 주소가 주어진 것으로 봄',
  public.import_places('[{"name":"A","address":"남면 2","lat":36.1234568,"lng":126.1}]'),
  '{"imported":0,"duplicates":1,"updated":1,"missionChanged":0}');
select t.eq('미션명이 바뀌면 missionChanged 1',
  public.import_places('[{"name":"A","mission":"M_01 ~ 02","district":"태안군","lat":36.1234568,"lng":126.1}]'),
  '{"imported":0,"duplicates":1,"updated":1,"missionChanged":1}');
select t.eq('미션명이 같으면 missionChanged 0(시군만 바뀜)',
  public.import_places('[{"name":"A","mission":"M_01 ~ 02","district":"서산시","lat":36.1234568,"lng":126.1}]'),
  '{"imported":0,"duplicates":1,"updated":1,"missionChanged":0}');
select t.eq('가져오기 뒤에도 미션 기록·메모 보존',
  (select jsonb_build_array(p.memo, m.worker, m.version) from public.places p join public.missions m on m.place_id = p.id where p.name = 'A'),
  '["메모1","홍길동",1]');
select t.eq('한 번에 같은 장소 두 줄: 1 삽입 1 중복',
  public.import_places('[{"name":"C","lat":35,"lng":127},{"name":"C","lat":35,"lng":127}]'),
  '{"imported":1,"duplicates":1,"updated":0,"missionChanged":0}');
select t.eq('한 번에 새 장소 + 같은 줄의 다른 미션: 1 삽입, 1 갱신(missionChanged)',
  public.import_places('[{"name":"D","mission":"x1","lat":35.5,"lng":127},{"name":"D","mission":"x2","lat":35.5,"lng":127}]'),
  '{"imported":1,"duplicates":1,"updated":1,"missionChanged":1}');
select t.raises('목록이 배열이 아니면 오류', $q$select public.import_places('{"a":1}')$q$, '가져올 장소 목록이 잘못되었습니다.');
select t.raises('이름 없는 줄은 오류', $q$select public.import_places('[{"name":"","lat":1,"lng":1}]')$q$, '1번째 장소: 이름이 비어 있습니다.');
select t.raises('좌표가 문자열이면 오류', $q$select public.import_places('[{"name":"E","lat":"1","lng":1}]')$q$, '1번째 장소: 좌표가 숫자가 아닙니다.');
select t.raises('중간에 실패하면 모두 되돌림(오류)', $q$select public.import_places('[{"name":"F","lat":1,"lng":1},{"name":"G","lat":1}]')$q$, '2번째 장소: 좌표가 숫자가 아닙니다.');
select t.ok('중간에 실패하면 모두 되돌림(F 없음)', t.pid('F') is null);
select t.eq('긴 텍스트 가져오기',
  public.import_places(jsonb_build_array(jsonb_build_object('name', repeat('긴', 250), 'memo', repeat('m', 2500), 'mission', repeat('x', 300), 'lat', 1.5, 'lng', 1.5))),
  '{"imported":1,"duplicates":0,"updated":0,"missionChanged":0}');
select t.eq('긴 텍스트는 잘라 넣음(이름 200, 메모 2000, 미션 200)',
  (select jsonb_build_array(char_length(name), char_length(memo), char_length(mission)) from public.places where name = repeat('긴', 200)),
  '[200,2000,200]');

-- ---------- save_mission ----------
-- A의 미션은 지금 "M_01 ~ 02"(M_01, M_02). 예전 범위의 M_03 기록을 만들 수 없어야 한다.
select t.raises('없는 장소', $q$select public.save_mission(999999, 'M_01', '{"done":false}', null)$q$, '장소를 찾을 수 없습니다.');
select t.raises('장소 id null', $q$select public.save_mission(null, 'M_01', '{"done":false}', null)$q$, '장소를 찾을 수 없습니다.');
select t.raises('장소에 없는 미션', $q$select t.sm('A', 'M_03', '{"done":false}', null)$q$, '이 장소에 없는 미션입니다.');
select t.raises('미션 이름 null', $q$select t.sm('A', null, '{"done":false}', null)$q$, '이 장소에 없는 미션입니다.');
select t.raises('없는 미션 검사가 형식 검사보다 먼저', $q$select t.sm('A', 'M_09', '{"done":"x"}', null)$q$, '이 장소에 없는 미션입니다.');
select t.raises('본문이 객체가 아님', $q$select t.sm('A', 'M_01', '[]', null)$q$, '잘못된 요청 본문입니다.');
select t.raises('본문 null', $q$select t.sm('A', 'M_01', null, null)$q$, '잘못된 요청 본문입니다.');
select t.raises('done이 문자열', $q$select t.sm('A', 'M_01', '{"done":"true"}', null)$q$, '완료 여부는 true/false여야 합니다.');
select t.raises('done이 null', $q$select t.sm('A', 'M_01', '{"done":null}', null)$q$, '완료 여부는 true/false여야 합니다.');
select t.raises('worker 숫자', $q$select t.sm('A', 'M_01', '{"worker":5}', null)$q$, '이름은(는) 문자열이어야 합니다.');
select t.raises('flightTime 숫자', $q$select t.sm('A', 'M_01', '{"flightTime":5}', null)$q$, '비행시간은(는) 문자열이어야 합니다.');
select t.raises('batteryNo null', $q$select t.sm('A', 'M_01', '{"batteryNo":null}', null)$q$, '배터리 번호은(는) 문자열이어야 합니다.');
select t.raises('batteryLeft 숫자', $q$select t.sm('A', 'M_01', '{"batteryLeft":45}', null)$q$, '배터리 남은 용량은(는) 문자열이어야 합니다.');
select t.raises('허용 키가 없으면', $q$select t.sm('A', 'M_01', '{"foo":1,"baseVersion":1,"version":3}', null)$q$, '바꿀 내용이 없습니다.');
select t.raises('빈 객체', $q$select t.sm('A', 'M_01', '{}', null)$q$, '바꿀 내용이 없습니다.');
select t.raises('형식 오류가 충돌보다 먼저', $q$select t.sm('A', 'M_01', '{"worker":1}', 77)$q$, '이름은(는) 문자열이어야 합니다.');
select t.eq('기록이 없는데 base 1이면 충돌(record null)', t.sm('A', 'M_01', '{"worker":"x"}', 1), '{"status":"conflict","record":null}');
select t.ok('충돌이면 기록을 만들지 않음', not exists (select from public.missions where place_id = t.pid('A') and mission = 'M_01'));

select t.eq('새 기록: 줄바꿈·탭은 공백 하나로, 앞뒤 공백 제거, version 1',
  (select jsonb_build_object('status', r -> 'status', 'worker', r #> '{record,worker}', 'version', r #> '{record,version}', 'done', r #> '{record,done}',
                             'batteryLeft', r #> '{record,batteryLeft}', 'mission', r #> '{record,mission}', 'keys', (select jsonb_agg(k order by k) from jsonb_object_keys(r -> 'record') k))
   from t.sm('A', 'M_01', E'{"worker":" \\u3000홍\\t\\n길동\\r\\n ","unknown":1}', null) r),
  '{"status":"ok","worker":"홍 길동","version":1,"done":false,"batteryLeft":"","mission":"M_01",
    "keys":["batteryLeft","batteryNo","done","flightTime","mission","updatedAt","version","worker"]}');
select t.ok('updatedAt은 UTC ISO 8601',
  (select (t.sm('A', 'M_01', '{"flightTime":"10분"}', 1) #>> '{record,updatedAt}') ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'));
select t.eq('base null인데 기록이 있으면 충돌(최신 기록과 함께)',
  (select jsonb_build_array(r -> 'status', r #> '{record,version}', r #> '{record,flightTime}') from t.sm('A', 'M_01', '{"worker":"y"}', null) r),
  '["conflict",2,"10분"]');
select t.eq('base가 오래되면 충돌', t.sm('A', 'M_01', '{"worker":"y"}', 1) -> 'status', '"conflict"');
select t.eq('충돌 판정이 남은 용량 검사보다 먼저', t.sm('A', 'M_01', '{"batteryLeft":"abc"}', 1) -> 'status', '"conflict"');
select t.eq('batteryLeft "45%" → "45", version 3',
  (select jsonb_build_array(r #> '{record,batteryLeft}', r #> '{record,version}', r #> '{record,worker}') from t.sm('A', 'M_01', '{"batteryLeft":" 45% "}', 2) r),
  '["45",3,"홍 길동"]');
select t.eq('batteryLeft "045" → "45"', t.sm('A', 'M_01', '{"batteryLeft":"045"}', 3) #> '{record,batteryLeft}', '"45"');
select t.eq('batteryLeft "100"', t.sm('A', 'M_01', '{"batteryLeft":"100"}', 4) #> '{record,batteryLeft}', '"100"');
select t.eq('batteryLeft "0%" → "0"', t.sm('A', 'M_01', '{"batteryLeft":"0%"}', 5) #> '{record,batteryLeft}', '"0"');
select t.eq('batteryLeft "%" → 빈 칸', t.sm('A', 'M_01', '{"batteryLeft":"%"}', 6) #> '{record,batteryLeft}', '""');
select t.raises('batteryLeft "101"', $q$select t.sm('A', 'M_01', '{"batteryLeft":"101"}', 7)$q$, '마지막 배터리 남은 용량은 0~100 사이 숫자만 적어 주세요.');
select t.raises('batteryLeft "4 5"', $q$select t.sm('A', 'M_01', '{"batteryLeft":"4 5"}', 7)$q$, '마지막 배터리 남은 용량은 0~100 사이 숫자만 적어 주세요.');
select t.raises('batteryLeft "45%%"', $q$select t.sm('A', 'M_01', '{"batteryLeft":"45%%"}', 7)$q$, '마지막 배터리 남은 용량은 0~100 사이 숫자만 적어 주세요.');
select t.raises('batteryLeft "１０"(전각)', $q$select t.sm('A', 'M_01', '{"batteryLeft":"１０"}', 7)$q$, '마지막 배터리 남은 용량은 0~100 사이 숫자만 적어 주세요.');
select t.raises('칸이 빠진 채 완료', $q$select t.sm('A', 'M_01', '{"done":true}', 7)$q$, '완료로 저장하려면 이름, 비행시간, 사용한 배터리 번호, 마지막 배터리 남은 용량을 모두 적어야 합니다.');
select t.eq('완료 실패는 아무것도 쓰지 않음(version 7 그대로)', (select to_jsonb(version) from public.missions where place_id = t.pid('A') and mission = 'M_01'), '7');
select t.eq('네 칸을 채우며 완료',
  (select jsonb_build_array(r -> 'status', r #> '{record,done}', r #> '{record,version}', r #> '{record,batteryLeft}')
   from t.sm('A', 'M_01', '{"done":true,"batteryNo":"3","batteryLeft":"20%"}', 7) r),
  '["ok",true,8,"20"]');
select t.raises('완료된 기록에서 이름을 공백으로 비우면 거부', $q$select t.sm('A', 'M_01', '{"worker":"  \t "}', 8)$q$, '완료로 저장하려면 이름, 비행시간, 사용한 배터리 번호, 마지막 배터리 남은 용량을 모두 적어야 합니다.');
select t.eq('완료 해제와 함께 비우기는 허용', t.sm('A', 'M_01', '{"done":false,"worker":""}', 8) #> '{record,version}', '9');
select t.eq('텍스트는 200자로 자름', (select to_jsonb(char_length(t.sm('A', 'M_01', jsonb_build_object('batteryNo', repeat('가', 250)), 9) #>> '{record,batteryNo}'))), '200');
select t.eq('일부 칸만 바꾸면 다른 칸은 그대로',
  (select jsonb_build_array(r #> '{record,flightTime}', r #> '{record,batteryLeft}', r #> '{record,done}', r #> '{record,version}') from t.sm('A', 'M_01', '{"flightTime":"5분"}', 10) r),
  '["5분","20",false,11]');

-- 테이블에 바로 쓸 때도 CHECK가 지킨다
select t.ok('직접 삽입: done인데 칸이 비면 CHECK 위반',
  t.err(format($q$insert into public.missions (place_id, mission, done) values (%s, 'M_02x', true)$q$, t.pid('A'))) like '23514:%');
select t.ok('직접 삽입: 남은 용량에 숫자 아닌 값이면 CHECK 위반',
  t.err(format($q$insert into public.missions (place_id, mission, battery_left) values (%s, 'M_02x', '4a')$q$, t.pid('A'))) like '23514:%');
select t.ok('직접 삽입: 공백뿐인 이름으로 done이면 CHECK 위반',
  t.err(format($q$insert into public.missions (place_id, mission, done, worker, flight_time, battery_no, battery_left) values (%s, 'M_02x', true, E'\u3000', '1', '1', '1')$q$, t.pid('A'))) like '23514:%');
-- (바깥 쿼리는 문장 시작 때의 스냅샷을 보므로 쓰기와 확인을 다른 문장으로 나눈다)
select t.eq('authenticated는 직접 삽입 가능(identity 포함)', to_jsonb(t.err($q$insert into public.places (name, lat, lng) values ('직접', 1.123456789, 2)$q$)), null);
select t.eq('직접 삽입도 좌표를 7자리로', (select to_jsonb(lat) from public.places where name = '직접'), '1.1234568');
select t.eq('authenticated는 직접 삭제 가능', to_jsonb(t.err($q$delete from public.places where name = '직접'$q$)), null);
select t.ok('직접 삭제됨', t.pid('직접') is null);

-- ---------- list_places ----------
select t.eq('list_places 원소 키',
  (select jsonb_agg(k order by k) from jsonb_object_keys(public.list_places() -> 0) k),
  '["address","createdAt","district","id","lat","lng","memo","mission","missions","name","phone","updatedAt"]');
select t.ok('list_places는 id 순',
  (select bool_and(a < b) from (select (e ->> 'id')::bigint a, lead((e ->> 'id')::bigint) over (order by o) b
                                from jsonb_array_elements(public.list_places()) with ordinality x(e, o)) s where b is not null));
select t.eq('list_places 개수 = places 개수', to_jsonb(jsonb_array_length(public.list_places())), (select to_jsonb(count(*)::int) from public.places));
select t.eq('기록 없는 장소는 missions []',
  (select e -> 'missions' from jsonb_array_elements(public.list_places()) e where e ->> 'name' = 'B'), '[]');
select t.eq('A의 기록은 id 순(M_02 먼저 만들었음)',
  (select jsonb_agg(m -> 'mission') from jsonb_array_elements(public.list_places()) e, jsonb_array_elements(e -> 'missions') m where e ->> 'name' = 'A'),
  '["M_02","M_01"]');
select t.eq('좌표는 숫자, done은 불리언',
  (select jsonb_build_array(jsonb_typeof(e -> 'lat'), jsonb_typeof(e -> 'id'), jsonb_typeof(e #> '{missions,0,done}'), jsonb_typeof(e #> '{missions,0,version}'))
   from jsonb_array_elements(public.list_places()) e where e ->> 'name' = 'A'),
  '["number","number","boolean","number"]');

-- ---------- update_memo ----------
select t.raises('메모 null', $q$select public.update_memo(t.pid('A'), null)$q$, '메모는 문자열이어야 합니다.');
select t.raises('메모: 없는 장소', $q$select public.update_memo(999999, 'x')$q$, '장소를 찾을 수 없습니다.');
select t.eq('메모는 줄바꿈 유지', public.update_memo(t.pid('A'), E'첫 줄\n둘째 줄\t') -> 'memo', to_jsonb(E'첫 줄\n둘째 줄\t'::text));
select t.eq('메모는 2000자로 자름', to_jsonb(char_length(public.update_memo(t.pid('A'), repeat('가', 2500)) ->> 'memo')), '2000');
create temp table memo_result as select public.update_memo(t.pid('A'), '메모2') as r;
select t.eq('update_memo 결과 = list_places 원소', (select r from memo_result),
  (select e from jsonb_array_elements(public.list_places()) e where e ->> 'name' = 'A'));
select t.ok('메모를 고치면 updatedAt이 createdAt 이후',
  (select (e ->> 'updatedAt') > (e ->> 'createdAt') from jsonb_array_elements(public.list_places()) e where e ->> 'name' = 'A'));

-- ---------- delete_place ----------
select t.ok('지우기 전 A의 기록 있음', exists (select from public.missions where place_id = t.pid('A')));
create temp table gone as select t.pid('A') as id;
select t.ok('delete_place → true', public.delete_place((select id from gone)));
select t.ok('장소와 함께 기록도 지워짐', not exists (select from public.missions where place_id = (select id from gone)));
select t.ok('다시 지우면 false', not public.delete_place((select id from gone)));
reset role;

-- ---------- anon은 막힌다 ----------
set role anon;
select t.ok('anon: places select 거부', t.err('select * from public.places') like '42501:%');
select t.ok('anon: missions select 거부', t.err('select * from public.missions') like '42501:%');
select t.ok('anon: places insert 거부', t.err($q$insert into public.places (name, lat, lng) values ('x', 1, 1)$q$) like '42501:%');
select t.ok('anon: list_places 거부', t.err('select public.list_places()') like '42501:%');
select t.ok('anon: import_places 거부', t.err($q$select public.import_places('[]')$q$) like '42501:%');
select t.ok('anon: save_mission 거부', t.err($q$select public.save_mission(1, 'x', '{}', null)$q$) like '42501:%');
select t.ok('anon: update_memo 거부', t.err($q$select public.update_memo(1, 'x')$q$) like '42501:%');
select t.ok('anon: delete_place 거부', t.err('select public.delete_place(1)') like '42501:%');
select t.ok('anon: mission_names 거부', t.err($q$select public.mission_names('a1~2')$q$) like '42501:%');
reset role;

-- 정책이 없는 다른 롤은 권한이 있어도 RLS에 막혀 행이 안 보인다
create role rls_probe nologin;
grant usage on schema public to rls_probe;
grant select on public.places to rls_probe;
set role rls_probe;
select t.ok('정책 없는 롤은 RLS로 0행', (select count(*) from public.places) = 0);
reset role;

-- ---------- 두 세션이 같은 기록을 동시에 고침 ----------
create extension dblink;
set role authenticated;
select t.eq('동시성용 장소', public.import_places('[{"name":"동시","mission":"C_1 ~ 2","lat":34,"lng":128}]') -> 'imported', '1');
select t.eq('C_1 기록 만들기(version 1)', t.sm('동시', 'C_1', '{"worker":"처음"}', null) #> '{record,version}', '1');
reset role;

select dblink_connect('a', :'conn');
select dblink_connect('b', :'conn');
select dblink_exec('a', 'set role authenticated');
select dblink_exec('b', 'set role authenticated');

-- 1) 기록이 있을 때 두 세션이 같은 version 1을 기준으로 저장
select dblink_exec('a', 'begin');
select t.eq('세션 A 저장(커밋 전) ok, version 2',
  (select r::jsonb #> '{record,version}' from dblink('a', $q$select t.sm('동시', 'C_1', '{"worker":"A"}', 1)::text$q$) as x(r text)), '2');
select dblink_send_query('b', $q$select t.sm('동시', 'C_1', '{"worker":"B"}', 1)::text$q$);
select pg_sleep(0.5);
select t.ok('세션 B는 A가 끝날 때까지 기다림', dblink_is_busy('b') = 1);
select dblink_exec('a', 'commit');
create temp table r1 as select r::jsonb as r from dblink_get_result('b') as x(r text);
select t.eq('세션 B는 충돌, 최신 기록(A, version 2)을 받음',
  (select jsonb_build_array(r -> 'status', r #> '{record,worker}', r #> '{record,version}') from r1), '["conflict","A",2]');
select * from dblink_get_result('b') as x(r text);

-- 2) 기록이 없을 때 두 세션이 모두 base null로 처음 저장
select dblink_exec('a', 'begin');
select t.eq('세션 A 첫 저장(커밋 전) ok',
  (select r::jsonb -> 'status' from dblink('a', $q$select t.sm('동시', 'C_2', '{"worker":"A"}', null)::text$q$) as x(r text)), '"ok"');
select dblink_send_query('b', $q$select t.sm('동시', 'C_2', '{"worker":"B"}', null)::text$q$);
select pg_sleep(0.5);
select t.ok('세션 B는 기다림(처음 저장)', dblink_is_busy('b') = 1);
select dblink_exec('a', 'commit');
create temp table r2 as select r::jsonb as r from dblink_get_result('b') as x(r text);
select t.eq('세션 B는 충돌, A가 만든 기록(version 1)을 받음',
  (select jsonb_build_array(r -> 'status', r #> '{record,worker}', r #> '{record,version}') from r2), '["conflict","A",1]');
select * from dblink_get_result('b') as x(r text);

-- 3) 장소 잠금을 거치지 않은 직접 쓰기가 끼어들어도 version 확인으로 막힌다
select dblink_exec('a', 'begin');
select dblink_exec('a', $q$update public.missions set worker = '직접', version = version + 1 where mission = 'C_2'$q$);
select dblink_send_query('b', $q$select t.sm('동시', 'C_2', '{"worker":"B2"}', 1)::text$q$);
select pg_sleep(0.5);
select dblink_exec('a', 'commit');
create temp table r3 as select r::jsonb as r from dblink_get_result('b') as x(r text);
select t.eq('직접 쓰기 뒤의 저장은 충돌',
  (select jsonb_build_array(r -> 'status', r #> '{record,worker}', r #> '{record,version}') from r3), '["conflict","직접",2]');
select * from dblink_get_result('b') as x(r text);
select dblink_disconnect('a');
select dblink_disconnect('b');

-- ===================================================================
-- 로그인 기록(supabase/migrations/20261106120000_login_logs.sql)
-- ===================================================================

-- ---------- 구조·권한 ----------
select t.ok('login_logs RLS 켜짐', (select relrowsecurity from pg_class where oid = 'public.login_logs'::regclass));
select t.ok('auth.sessions에 로그인 기록 트리거가 있음',
  exists (select from pg_trigger where tgrelid = 'auth.sessions'::regclass and tgname = 'login_logs_on_session' and not tgisinternal));
select t.ok('definer 함수 소유자는 마이그레이션 실행 롤',
  (select bool_and(pg_get_userbyid(proowner) = current_user) from pg_proc
   where pronamespace = 'public'::regnamespace and prosecdef));
select t.ok('authenticated는 login_logs에 어떤 권한도 없음(비공개)',
  not has_table_privilege('authenticated', 'public.login_logs', 'select')
  and not has_table_privilege('authenticated', 'public.login_logs', 'insert')
  and not has_table_privilege('authenticated', 'public.login_logs', 'update')
  and not has_table_privilege('authenticated', 'public.login_logs', 'delete'));
select t.ok('anon은 login_logs 권한이 없음',
  not has_table_privilege('anon', 'public.login_logs', 'select,insert,update,delete'));
select t.ok('login_logs 시퀀스는 anon·authenticated 모두 권한 없음',
  not has_sequence_privilege('anon', 'public.login_logs_id_seq', 'usage,select,update')
  and not has_sequence_privilege('authenticated', 'public.login_logs_id_seq', 'usage,select,update'));
select t.ok('authenticated는 로그인 기록 RPC 실행 가능',
  has_function_privilege('authenticated', 'public.log_login(text)', 'execute')
  and has_function_privilege('authenticated', 'public.log_logout()', 'execute'));
select t.ok('list_login_logs 함수는 존재하지 않음',
  not exists (select from pg_proc where pronamespace = 'public'::regnamespace and proname = 'list_login_logs'));
select t.ok('login_logs에 select 정책이 없음',
  not exists (select from pg_policies where schemaname = 'public' and tablename = 'login_logs'));
select t.ok('트리거 함수는 supabase_auth_admin만 실행 권한',
  has_function_privilege('supabase_auth_admin', 'public.login_logs_on_session()', 'execute')
  and not has_function_privilege('authenticated', 'public.login_logs_on_session()', 'execute')
  and not has_function_privilege('anon', 'public.login_logs_on_session()', 'execute'));

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'xn--hong@sistech.local', '{"login_id":"홍길동"}'),
  ('22222222-2222-2222-2222-222222222222', 'b@sistech.local', '{}'),
  ('33333333-3333-3333-3333-333333333333', 'c@sistech.local', '{"login_id":"영희"}'),
  ('44444444-4444-4444-4444-444444444444', 'boom@sistech.local', '{"login_id":"폭탄"}');

-- ---------- 트리거: 세션 생성 = 로그인 ----------
set role supabase_auth_admin;
insert into auth.sessions (user_id, user_agent, ip) values ('11111111-1111-1111-1111-111111111111', 'Mozilla/5.0 테스트', '203.0.113.7');
reset role;
select t.eq('세션 생성 → login 행 1개(이메일·아이디·UA·IP 채움)',
  (select jsonb_agg(jsonb_build_array(event, email, login_id, user_agent, ip)) from public.login_logs
   where user_id = '11111111-1111-1111-1111-111111111111'),
  '[["login", "xn--hong@sistech.local", "홍길동", "Mozilla/5.0 테스트", "203.0.113.7"]]');

-- 트리거 안에서 오류가 나도 세션(로그인)은 막지 않는다
alter table public.login_logs add constraint t_block check (email <> 'boom@sistech.local');
set role supabase_auth_admin;
select t.ok('트리거 안 오류는 삼켜서 세션 insert 성공',
  t.err($q$insert into auth.sessions (user_id, user_agent) values ('44444444-4444-4444-4444-444444444444', 'x')$q$) is null);
select t.ok('user_id가 null인 세션도 오류 없이 들어감',
  t.err($q$insert into auth.sessions (user_id) values (null)$q$) is null);
reset role;
alter table public.login_logs drop constraint t_block;
select t.ok('오류 난 세션은 세션만 남고 기록은 없음',
  (select count(*) from auth.sessions where user_id = '44444444-4444-4444-4444-444444444444') = 1
  and not exists (select from public.login_logs where user_id = '44444444-4444-4444-4444-444444444444'));
select t.ok('user_id 없는 세션은 기록하지 않음', not exists (select from public.login_logs where user_id is null));

-- GoTrue 버전에 따라 user_agent·ip 칸이 없어도 동작한다
alter table auth.sessions drop column user_agent, drop column ip;
set role supabase_auth_admin;
insert into auth.sessions (user_id) values ('33333333-3333-3333-3333-333333333333');
reset role;
select t.eq('user_agent·ip 칸이 없는 세션 테이블 → 빈 칸으로 기록',
  (select jsonb_agg(jsonb_build_array(event, email, login_id, user_agent, ip)) from public.login_logs
   where user_id = '33333333-3333-3333-3333-333333333333'),
  '[["login", "c@sistech.local", "영희", "", ""]]');
alter table auth.sessions add column user_agent text, add column ip text;

-- ---------- log_login: 트리거가 남긴 직후면 건너뜀 ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select t.eq('트리거 직후 log_login → 15초 중복이라 logged:false', public.log_login('UA'), '{"logged": false}');
reset role;
select t.ok('중복이면 행이 늘지 않음',
  (select count(*) from public.login_logs where user_id = '11111111-1111-1111-1111-111111111111') = 1);

select set_config('request.jwt.claim.sub', '', false);
set role authenticated;
select t.raises('jwt sub 없이 log_login → 로그인 필요', 'select public.log_login()', '로그인이 필요합니다.');
select t.raises('jwt sub 없이 log_logout → 로그인 필요', 'select public.log_logout()', '로그인이 필요합니다.');
reset role;

-- ---------- log_login: 트리거가 없는 프로젝트(대비 경로) ----------
drop trigger login_logs_on_session on auth.sessions;
set role supabase_auth_admin;
insert into auth.sessions (user_id) values ('22222222-2222-2222-2222-222222222222');
reset role;
select t.ok('트리거가 없으면 세션만 생기고 기록은 없음',
  not exists (select from public.login_logs where user_id = '22222222-2222-2222-2222-222222222222'));
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select set_config('request.headers', '{"user-agent":"헤더UA","x-forwarded-for":"198.51.100.1, 10.0.0.1"}', false);
set role authenticated;
select t.eq('트리거 없음 → log_login이 기록(logged:true)', public.log_login('UA2'), '{"logged": true}');
select t.eq('곧바로 다시 log_login → logged:false', public.log_login(''), '{"logged": false}');
reset role;
select t.eq('대비 경로 기록: 인자 UA, 헤더 IP(첫 번째)',
  (select jsonb_agg(jsonb_build_array(event, email, login_id, user_agent, ip)) from public.login_logs
   where user_id = '22222222-2222-2222-2222-222222222222'),
  '[["login", "b@sistech.local", "", "UA2", "198.51.100.1"]]');
update public.login_logs set occurred_at = occurred_at - interval '20 seconds' where user_id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
select t.eq('15초가 지나면 다시 기록', public.log_login(''), '{"logged": true}');
reset role;
select t.eq('UA 인자가 비면 요청 헤더 User-Agent 사용',
  (select to_jsonb(user_agent) from public.login_logs where user_id = '22222222-2222-2222-2222-222222222222' order by id desc limit 1),
  '"헤더UA"');

-- ---------- log_logout ----------
set role authenticated;
select t.eq('log_logout → logged:true', public.log_logout(), '{"logged": true}');
select t.eq('2초 안에 다시 log_logout → logged:false', public.log_logout(), '{"logged": false}');
reset role;
select t.eq('logout 행 1개(헤더 UA·IP)',
  (select jsonb_agg(jsonb_build_array(event, email, login_id, user_agent, ip)) from public.login_logs
   where user_id = '22222222-2222-2222-2222-222222222222' and event = 'logout'),
  '[["logout", "b@sistech.local", "", "헤더UA", "198.51.100.1"]]');
update public.login_logs set occurred_at = occurred_at - interval '3 seconds' where user_id = '22222222-2222-2222-2222-222222222222' and event = 'logout';
set role authenticated;
select t.eq('2초가 지나면 다시 logout 기록', public.log_logout(), '{"logged": true}');
reset role;
select set_config('request.headers', '', false);

-- ---------- 길이 제한·JWT 대비 ----------
-- 사용자 3은 앞의 트리거 검사에서 기록이 있으므로 15초 중복에 걸리지 않게 미룬다
update public.login_logs set occurred_at = occurred_at - interval '20 seconds' where user_id = '33333333-3333-3333-3333-333333333333';
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
set role authenticated;
select t.eq('500자 넘는 UA로 log_login', public.log_login(repeat('가', 600)), '{"logged": true}');
reset role;
select t.eq('UA는 500자로 잘림',
  (select to_jsonb(char_length(user_agent)) from public.login_logs where user_id = '33333333-3333-3333-3333-333333333333' order by id desc limit 1),
  '500');

-- auth.users에 없는 사용자는 JWT 클레임의 email·user_metadata.login_id로 채운다
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select set_config('request.jwt.claims', '{"email":"jwt@sistech.local","user_metadata":{"login_id":"철수"}}', false);
set role authenticated;
select t.eq('auth.users에 없는 사용자도 log_login', public.log_login('UA5'), '{"logged": true}');
reset role;
select t.eq('JWT 클레임으로 email·login_id 채움',
  (select jsonb_build_array(email, login_id) from public.login_logs where user_id = '55555555-5555-5555-5555-555555555555'),
  '["jwt@sistech.local", "철수"]');
select set_config('request.jwt.claims', '', false);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- ---------- 기록은 postgres(대시보드)로만 읽힌다 ----------
reset role;
select t.ok('postgres는 login_logs를 조회할 수 있음', (select count(*) from public.login_logs) > 0);
select t.ok('postgres 조회: 트리거 기록 내용',
  exists (select from public.login_logs where user_id = '11111111-1111-1111-1111-111111111111' and event = 'login'
    and email = 'xn--hong@sistech.local' and login_id = '홍길동' and user_agent = 'Mozilla/5.0 테스트' and ip = '203.0.113.7'));
set role authenticated;
select t.ok('authenticated: login_logs select 거부', t.err('select * from public.login_logs') like '42501:%');
select t.ok('authenticated: list_login_logs 호출 불가(함수 없음)', t.err('select public.list_login_logs()') like '42883:%');
reset role;

-- ---------- authenticated는 직접 쓸 수 없다 ----------
set role authenticated;
select t.ok('authenticated: login_logs 직접 insert 거부',
  t.err($q$insert into public.login_logs (user_id, event) values ('11111111-1111-1111-1111-111111111111', 'login')$q$) like '42501:%');
select t.ok('authenticated: login_logs 직접 update 거부',
  t.err($q$update public.login_logs set email = 'x'$q$) like '42501:%');
select t.ok('authenticated: login_logs 직접 delete 거부',
  t.err('delete from public.login_logs') like '42501:%');
select t.ok('authenticated: 트리거 함수 직접 실행 거부',
  t.err('select public.login_logs_on_session()') like '42501:%');
reset role;

-- ---------- anon은 막힌다 ----------
set role anon;
select t.ok('anon: login_logs select 거부', t.err('select * from public.login_logs') like '42501:%');
select t.ok('anon: log_login 거부', t.err($q$select public.log_login('x')$q$) like '42501:%');
select t.ok('anon: log_logout 거부', t.err('select public.log_logout()') like '42501:%');
reset role;

-- 정책 없는 롤은 권한이 있어도 RLS로 0행
grant select on public.login_logs to rls_probe;
set role rls_probe;
select t.ok('정책 없는 롤은 login_logs도 RLS로 0행', (select count(*) from public.login_logs) = 0);
reset role;

-- ---------- 결과 ----------
\o
\echo
\echo '실패한 항목:'
select n, name, detail from t.results where not pass order by n;
select count(*) filter (where pass) as "통과", count(*) filter (where not pass) as "실패" from t.results;
