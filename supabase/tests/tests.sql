-- supabase/migrations/*.sql 검증. supabase/tests/run.sh가 shim과 마이그레이션을 넣은 새 DB에서 돌린다.
-- psql 변수 cases: public/mission.js로 뽑은 [{input, output}] JSON
-- psql 변수 coord_cases: public/coord.js의 roundCoord로 뽑은 [{input, output}] JSON(사례 파일이 없는 브랜치에서는 [])
-- psql 변수 conn: dblink로 다른 세션을 열 접속 문자열
\set ON_ERROR_STOP on
\pset pager off
-- 현장 사용자 둘(JWT sub). 쓰기 RPC는 auth.uid()가 있어야 한다.
-- 미션 기록의 이름은 JWT의 아이디(app_metadata.login_id → user_metadata.login_id → email 앞부분)로 정해진다.
-- u1은 user_metadata를 스스로 바꾼 경우(바꾼이름1)도 흉내 낸다. 기록에는 app_metadata 값(김현장)이 들어가야 한다.
\set u1 eeeeeeee-0000-0000-0000-000000000001
\set u2 eeeeeeee-0000-0000-0000-000000000002
\set u1_claims '{"email":"u1@sistech.local","app_metadata":{"login_id":"김현장"},"user_metadata":{"login_id":"바꾼이름1"}}'
\set u2_claims '{"email":"u2@sistech.local","app_metadata":{"login_id":"박현장"}}'

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

-- 이름으로 장소 id 찾기(지운 장소 포함)
create function t.pid(p_name text) returns bigint
language sql as $$ select id from public.places where name = p_name $$;

-- save_mission 결과에서 status와 record 일부만 본다
create function t.sm(p_place text, p_mission text, p_fields jsonb, p_base int) returns jsonb
language sql as $$ select public.save_mission(t.pid(p_place), p_mission, p_fields, p_base) $$;

-- 로그인 흉내: PostgREST처럼 JWT 클레임(request.jwt.claims, JSON)과 예전 방식의 request.jwt.claim.sub를 함께 넣는다.
create function t.login(p_sub text, p_claims jsonb default '{}') returns void
language sql as $$
  select set_config('request.jwt.claim.sub', p_sub, false),
         set_config('request.jwt.claims', (coalesce(p_claims, '{}') || jsonb_build_object('sub', p_sub))::text, false)
$$;
-- 로그인하지 않은 상태(대시보드·마이그레이션처럼 JWT 없음)
create function t.logout() returns void
language sql as $$ select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false) $$;

\o /dev/null
-- ---------- 구조 ----------
select t.ok('RLS 켜짐(places, missions, audit_log)',
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.places'::regclass, 'public.missions'::regclass, 'public.audit_log'::regclass)));
select t.eq('Realtime 발행물에 두 테이블',
  (select jsonb_agg(tablename order by tablename) from pg_publication_tables where pubname = 'supabase_realtime'),
  '["missions", "places"]');
select t.ok('places에 color 칸 없음', not exists (select from information_schema.columns where table_schema = 'public' and table_name = 'places' and column_name = 'color'));
select t.eq('새 칸: places.deleted_at·updated_by, missions.updated_by',
  (select jsonb_agg(table_name || '.' || column_name || ':' || data_type order by table_name, column_name) from information_schema.columns
   where table_schema = 'public' and (table_name, column_name) in (('places', 'deleted_at'), ('places', 'updated_by'), ('missions', 'updated_by'))),
  '["missions.updated_by:uuid", "places.deleted_at:timestamp with time zone", "places.updated_by:uuid"]');
-- 시기(period)는 20261109170000_drop_places_period.sql로 없앴다. 칸·제약이 남지 않고 유일 제약은 다시 (name, lat, lng)다.
select t.ok('places에 period 칸 없음', not exists (select from information_schema.columns where table_schema = 'public' and table_name = 'places' and column_name = 'period'));
select t.eq('places 유일 제약은 places_name_coord (name, lat, lng) 하나',
  (select jsonb_agg(jsonb_build_array(c.conname, (select jsonb_agg(a.attname order by k.o) from unnest(c.conkey) with ordinality k(n, o)
                                                  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n)))
   from pg_constraint c where c.conrelid = 'public.places'::regclass and c.contype = 'u'),
  '[["places_name_coord", ["name", "lat", "lng"]]]');
select t.ok('places에 시기 제약(places_period_len) 없음', not exists (select from pg_constraint where conrelid = 'public.places'::regclass and conname = 'places_period_len'));
select t.ok('place_json·import_places 본문에 period 없음',
  not exists (select from pg_proc where pronamespace = 'public'::regnamespace and proname in ('place_json', 'import_places') and prosrc like '%period%'));
-- security definer는 표에 쓰는 RPC 넷, 감사 트리거, 로그인 기록 쓰기 셋뿐이다(RLS·표 권한을 거치지 않고 써야 하는 것만).
select t.eq('security definer 함수 목록',
  (select jsonb_agg(proname::text order by proname) from pg_proc where pronamespace = 'public'::regnamespace and prosecdef),
  '["audit_log_on_change", "delete_place", "import_places", "log_login", "log_logout", "login_logs_on_session", "save_mission", "update_memo"]');
select t.ok('security definer 함수는 모두 search_path가 빈 값',
  not exists (select from pg_proc where pronamespace = 'public'::regnamespace and prosecdef and not ('search_path=""' = any (coalesce(proconfig, '{}')))),
  (select string_agg(proname, ', ') from pg_proc where pronamespace = 'public'::regnamespace and prosecdef and not ('search_path=""' = any (coalesce(proconfig, '{}')))));
select t.ok('나머지 public 함수는 모두 search_path=public',
  not exists (select from pg_proc where pronamespace = 'public'::regnamespace and not prosecdef and not ('search_path=public' = any (coalesce(proconfig, '{}')))),
  (select string_agg(proname, ', ') from pg_proc where pronamespace = 'public'::regnamespace and not prosecdef and not ('search_path=public' = any (coalesce(proconfig, '{}')))));
select t.ok('definer 함수 소유자는 마이그레이션 실행 롤',
  (select bool_and(pg_get_userbyid(proowner) = current_user) from pg_proc
   where pronamespace = 'public'::regnamespace and prosecdef));
select t.ok('anon은 public 함수 실행 권한이 없음',
  not exists (select from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')),
  (select string_agg(proname, ', ') from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')));
select t.ok('PUBLIC에도 실행 권한이 없음',
  not exists (select from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.pronamespace = 'public'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE'));
select t.ok('authenticated는 RPC 실행 가능',
  has_function_privilege('authenticated', 'public.list_places()', 'execute')
  and has_function_privilege('authenticated', 'public.get_places(bigint[])', 'execute')
  and has_function_privilege('authenticated', 'public.import_places(jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.save_mission(bigint, text, jsonb, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.update_memo(bigint, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.delete_place(bigint)', 'execute')
  and has_function_privilege('authenticated', 'public.mission_names(text)', 'execute'));
select t.ok('update_memo는 3인자 하나뿐(예전 2인자 없음, 셋째 인자 p_base_memo 기본값)',
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'update_memo') = 1
  and to_regprocedure('public.update_memo(bigint, text)') is null
  and (select pronargdefaults = 1 and proargnames = '{p_place_id,p_memo,p_base_memo}'
       from pg_proc where oid = 'public.update_memo(bigint, text, text)'::regprocedure));
select t.ok('authenticated는 public 스키마 USAGE가 있음', has_schema_privilege('authenticated', 'public', 'usage'));
select t.ok('authenticated는 places·missions에 select만(쓰기·truncate 등 없음)',
  has_table_privilege('authenticated', 'public.places', 'select') and has_table_privilege('authenticated', 'public.missions', 'select')
  and not has_table_privilege('authenticated', 'public.places', 'insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('authenticated', 'public.missions', 'insert,update,delete,truncate,references,trigger'));
select t.eq('places·missions 정책은 authenticated select 하나씩',
  (select jsonb_agg(jsonb_build_array(tablename, policyname, cmd, roles::text[], qual) order by tablename)
   from pg_policies where schemaname = 'public' and tablename in ('places', 'missions')),
  '[["missions", "missions_authenticated_select", "SELECT", ["authenticated"], "true"],
    ["places", "places_authenticated_select", "SELECT", ["authenticated"], "true"]]');
select t.ok('authenticated는 places·missions 시퀀스 권한이 없음(행은 RPC만 넣음)',
  not has_sequence_privilege('authenticated', 'public.places_id_seq', 'usage,select,update')
  and not has_sequence_privilege('authenticated', 'public.missions_id_seq', 'usage,select,update'));
select t.ok('anon은 시퀀스 권한이 없음',
  not has_sequence_privilege('anon', 'public.places_id_seq', 'usage,select,update') and not has_sequence_privilege('anon', 'public.missions_id_seq', 'usage,select,update'));
select t.ok('트리거 함수는 authenticated도 직접 실행 못 함',
  not has_function_privilege('authenticated', 'public.places_before_write()', 'execute')
  and not has_function_privilege('authenticated', 'public.missions_before_write()', 'execute')
  and not has_function_privilege('authenticated', 'public.audit_log_on_change()', 'execute'));
select t.eq('places 트리거', (select jsonb_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.places'::regclass and not tgisinternal),
  '["places_audit", "places_before_write"]');
select t.eq('missions 트리거(예전 missions_before_update 대신 missions_before_write)',
  (select jsonb_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.missions'::regclass and not tgisinternal),
  '["missions_audit", "missions_before_write"]');
select t.ok('예전 트리거 함수 missions_before_update는 없음', to_regprocedure('public.missions_before_update()') is null);
select t.ok('anon은 테이블 권한이 없음',
  not has_table_privilege('anon', 'public.places', 'select,insert,update,delete')
  and not has_table_privilege('anon', 'public.missions', 'select,insert,update,delete'));
-- 감사 로그: 정책 없음 + 권한 없음 → API로는 아무도 못 읽고 못 쓴다
select t.eq('audit_log 칸',
  (select jsonb_agg(column_name::text || ':' || data_type order by ordinal_position) from information_schema.columns
   where table_schema = 'public' and table_name = 'audit_log'),
  '["id:bigint", "at:timestamp with time zone", "actor:uuid", "tbl:text", "op:text", "row_id:bigint", "old_row:jsonb", "new_row:jsonb"]');
select t.eq('audit_log.actor 기본값은 auth.uid()',
  (select to_jsonb(column_default) from information_schema.columns where table_schema = 'public' and table_name = 'audit_log' and column_name = 'actor'),
  '"auth.uid()"');
select t.ok('audit_log 정책 없음', not exists (select from pg_policies where schemaname = 'public' and tablename = 'audit_log'));
select t.ok('audit_log: anon·authenticated·service_role 표·시퀀스 권한 없음',
  not has_table_privilege('anon', 'public.audit_log', 'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('authenticated', 'public.audit_log', 'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role', 'public.audit_log', 'select,insert,update,delete,truncate,references,trigger')
  and not has_sequence_privilege('anon', 'public.audit_log_id_seq', 'usage,select,update')
  and not has_sequence_privilege('authenticated', 'public.audit_log_id_seq', 'usage,select,update')
  and not has_sequence_privilege('service_role', 'public.audit_log_id_seq', 'usage,select,update'));

-- ---------- mission_names: JS와 같은 결과 ----------
set role authenticated;
select t.eq('mission_names ' || coalesce(to_jsonb(c ->> 'input')::text, 'null'), to_jsonb(public.mission_names(c ->> 'input')), c -> 'output')
from jsonb_array_elements(:'cases'::jsonb) c;
select t.ok('mission_names 비교 사례 5개 이상', jsonb_array_length(:'cases'::jsonb) >= 5);

-- ---------- round_coord: JS roundCoord와 같은 결과 ----------
select t.ok('round_coord ' || (c ->> 'input'),
  public.round_coord((c ->> 'input')::double precision) = (c ->> 'output')::double precision,
  '받음 ' || public.round_coord((c ->> 'input')::double precision)::text || ' / 기대 ' || (c ->> 'output'))
from jsonb_array_elements(:'coord_cases'::jsonb) c;
select t.ok('round_coord 비교 사례', jsonb_array_length(:'coord_cases'::jsonb) = 0 or jsonb_array_length(:'coord_cases'::jsonb) >= 5);

-- ---------- 쓰기 RPC는 로그인(auth.uid())이 없으면 거절 ----------
-- authenticated 롤이어도 JWT sub가 없으면 로그인하지 않은 것으로 본다. 읽기 RPC는 RLS로 충분해 확인하지 않는다.
select t.raises('sub 없이 import_places', $q$select public.import_places('[]')$q$, '로그인이 필요합니다.');
select t.raises('sub 없이 save_mission', $q$select public.save_mission(1, 'x', '{"done":true}', null)$q$, '로그인이 필요합니다.');
select t.raises('sub 없이 update_memo', $q$select public.update_memo(1, 'x')$q$, '로그인이 필요합니다.');
select t.raises('sub 없이 delete_place', 'select public.delete_place(1)', '로그인이 필요합니다.');
select t.eq('읽기 RPC는 sub 없이도 동작(아직 장소 없음)', public.list_places(), '[]');
-- 여기부터 현장 사용자 u1로 로그인한 상태(JWT 클레임에 아이디 포함)
select t.login(:'u1', :'u1_claims');

-- ---------- import_places ----------
select t.eq('프런트가 함께 보내는 line 등 모르는 키는 무시',
  public.import_places('[{"line":2,"name":"L","lat":33.1,"lng":126.5,"color":"red","addressGiven":true}]'),
  '{"imported":1,"duplicates":0,"updated":0,"missionChanged":0}');
select t.ok('authenticated가 마이그레이션 권한만으로 RPC 전체 실행(update_memo·delete_place)',
  public.update_memo(t.pid('L'), '메모') #>> '{place,memo}' = '메모' and public.delete_place(t.pid('L')));
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
select t.eq('기록 하나 만들기(보낸 이름 "홍길동"은 쓰지 않음)', t.sm('A', 'M_02', '{"worker":"홍길동"}', null) -> 'status', '"ok"');
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
  '["메모1","김현장",1]');
select t.eq('한 번에 같은 장소 두 줄: 1 삽입 1 중복',
  public.import_places('[{"name":"C","lat":35,"lng":127},{"name":"C","lat":35,"lng":127}]'),
  '{"imported":1,"duplicates":1,"updated":0,"missionChanged":0}');
select t.eq('한 번에 새 장소 + 같은 줄의 다른 미션: 1 삽입, 1 갱신(missionChanged)',
  public.import_places('[{"name":"D","mission":"x1","lat":35.5,"lng":127},{"name":"D","mission":"x2","lat":35.5,"lng":127}]'),
  '{"imported":1,"duplicates":1,"updated":1,"missionChanged":1}');
select t.eq('같은 장소 두 줄은 이름순 정렬 뒤에도 파일 순서대로(마지막 줄 x2가 남음)', (select to_jsonb(mission) from public.places where name = 'D'), '"x2"');
select t.eq('이름 역순으로 보내도 결과는 같음(처리는 이름·좌표 순)',
  public.import_places('[{"name":"Z9","lat":35.6,"lng":127},{"name":"C","lat":35,"lng":127},{"name":"Z1","lat":35.6,"lng":127}]'),
  '{"imported":2,"duplicates":1,"updated":0,"missionChanged":0}');
select t.raises('목록이 배열이 아니면 오류', $q$select public.import_places('{"a":1}')$q$, '가져올 장소 목록이 잘못되었습니다.');
select t.raises('원소가 객체가 아니면 오류', $q$select public.import_places('[{"name":"Q","lat":1,"lng":1}, 3]')$q$, '2번째 장소의 형식이 잘못되었습니다.');
select t.raises('이름 없는 줄은 오류', $q$select public.import_places('[{"name":"","lat":1,"lng":1}]')$q$, '1번째 장소: 이름이 비어 있습니다.');
select t.raises('이름 키가 없으면 비어 있음', $q$select public.import_places('[{"lat":1,"lng":1}]')$q$, '1번째 장소: 이름이 비어 있습니다.');
select t.raises('이름이 null이면 비어 있음', $q$select public.import_places('[{"name":null,"lat":1,"lng":1}]')$q$, '1번째 장소: 이름이 비어 있습니다.');
select t.raises('공백만 있는 이름은 오류(JS trim과 같은 공백 집합)',
  $q$select public.import_places(E'[{"name":" \\u3000\\t\\u00a0 ","lat":1,"lng":1}]')$q$, '1번째 장소: 이름이 비어 있습니다.');
select t.raises('이름이 숫자면 오류', $q$select public.import_places('[{"name":123,"lat":1,"lng":1}]')$q$, '1번째 장소: 이름은 문자열이어야 합니다.');
select t.raises('이름이 배열이면 오류', $q$select public.import_places('[{"name":["A"],"lat":1,"lng":1}]')$q$, '1번째 장소: 이름은 문자열이어야 합니다.');
select t.raises('좌표가 문자열이면 오류', $q$select public.import_places('[{"name":"E","lat":"1","lng":1}]')$q$, '1번째 장소: 좌표가 숫자가 아닙니다.');
select t.raises('1e400 좌표는 double로 못 바꿔도 한국어 범위 오류',
  $q$select public.import_places('[{"name":"큰수","lat":1e400,"lng":1}]')$q$, '1번째 장소: 좌표 범위를 벗어났습니다.');
select t.raises('1e-400 좌표도 같은 오류',
  $q$select public.import_places('[{"name":"작은수","lat":1,"lng":-1e-400}]')$q$, '1번째 장소: 좌표 범위를 벗어났습니다.');
select t.raises('double 안이지만 위도 범위 밖이면 값과 함께 오류',
  $q$select public.import_places('[{"name":"범위","lat":1e300,"lng":1}]')$q$, '1번째 장소: 좌표 범위를 벗어났습니다. (위도: 1e+300, 경도: 1)');
select t.raises('중간에 실패하면 모두 되돌림(오류)', $q$select public.import_places('[{"name":"F","lat":1,"lng":1},{"name":"G","lat":1}]')$q$, '2번째 장소: 좌표가 숫자가 아닙니다.');
select t.ok('중간에 실패하면 모두 되돌림(F 없음)', t.pid('F') is null);
select t.raises('오류 문구는 CSV 줄 번호(line) 우선',
  $q$select public.import_places('[{"line":7,"name":"G1","lat":1,"lng":1},{"line":12,"name":"  ","lat":1,"lng":1}]')$q$, '12행: 이름이 비어 있습니다.');
select t.raises('line 행 번호: 좌표 오류', $q$select public.import_places('[{"line":3,"name":"G2","lat":"1","lng":1}]')$q$, '3행: 좌표가 숫자가 아닙니다.');
select t.raises('line 행 번호: 1e400', $q$select public.import_places('[{"line":4,"name":"G3","lat":1,"lng":1e400}]')$q$, '4행: 좌표 범위를 벗어났습니다.');
select t.raises('line이 양의 정수가 아니면 순번 사용', $q$select public.import_places('[{"line":"9","name":"","lat":1,"lng":1},{"line":0,"name":"","lat":1,"lng":1}]')$q$, '1번째 장소: 이름이 비어 있습니다.');
select t.raises('line 0도 순번 사용', $q$select public.import_places('[{"line":0,"name":"","lat":1,"lng":1}]')$q$, '1번째 장소: 이름이 비어 있습니다.');
select t.ok('오류 난 가져오기는 아무것도 넣지 않음(G1·G2 없음)', t.pid('G1') is null and t.pid('G2') is null);
select t.eq('긴 텍스트 가져오기',
  public.import_places(jsonb_build_array(jsonb_build_object('name', repeat('긴', 250), 'memo', repeat('m', 2500), 'mission', repeat('x', 300), 'lat', 1.5, 'lng', 1.5))),
  '{"imported":1,"duplicates":0,"updated":0,"missionChanged":0}');
select t.eq('긴 텍스트는 잘라 넣음(이름 200, 메모 2000, 미션 200)',
  (select jsonb_build_array(char_length(name), char_length(memo), char_length(mission)) from public.places where name = repeat('긴', 200)),
  '[200,2000,200]');
-- 이름·시군·주소·미션명은 NFC로 맞추고 앞뒤 공백을 뗀다(전화·메모는 그대로)
select t.eq('NFD로 쓴 이름·시군도 가져오기',
  public.import_places(E'[{"name":" \\u1100\\u1161\\u11a8 ","district":"\\u1110\\u1162\\u110b\\u1161\\u11ab ","address":" 주소 ","mission":" N_1 ~ 2 ","phone":" 010 ","memo":" 메모 ","lat":33.5,"lng":126.5}]'),
  '{"imported":1,"duplicates":0,"updated":0,"missionChanged":0}');
select t.eq('NFC·trim으로 저장(전화·메모는 그대로)',
  (select jsonb_build_array(name, name = E'\uac01', district, address, mission, phone, memo) from public.places where lat = 33.5 and lng = 126.5),
  '["각", true, "태안", "주소", "N_1 ~ 2", " 010 ", " 메모 "]');
select t.eq('같은 이름을 NFC로 다시 가져오면 중복', public.import_places('[{"name":"각","lat":33.5,"lng":126.5}]'),
  '{"imported":0,"duplicates":1,"updated":0,"missionChanged":0}');

-- ---------- 시기(period) 없음 ----------
-- 시기 기능은 없앴다. 예전 화면이 period 키를 보내도 무시하고, 같은 이름·좌표면 시기와 관계없이 한 장소로 합쳐진다.
select t.eq('시기 키가 있어도 그냥 가져오기', public.import_places('[{"name":"시기점","mission":"PA_1 ~ 2","period":"Q1","lat":35.7,"lng":127.7}]'),
  '{"imported":1,"duplicates":0,"updated":0,"missionChanged":0}');
select t.eq('시기점에 기록', public.save_mission(t.pid('시기점'), 'PA_1', '{"flightTime":"Q1분"}', null) -> 'status', '"ok"');
select t.eq('같은 이름·좌표에 다른 시기 키 → 새 장소가 아니라 갱신(duplicates·updated·missionChanged)',
  public.import_places('[{"name":"시기점","mission":"PA_1 ~ 3","period":"Q2","lat":35.7,"lng":127.7}]'),
  '{"imported":0,"duplicates":1,"updated":1,"missionChanged":1}');
select t.eq('시기점은 한 장소이고 미션명만 바뀌고 기록은 그대로',
  (select jsonb_agg(jsonb_build_array(p.mission, (select jsonb_agg(m.mission || ':' || m.flight_time) from public.missions m where m.place_id = p.id)))
   from public.places p where p.name = '시기점'),
  '[["PA_1 ~ 3", ["PA_1:Q1분"]]]');
select t.eq('한 번에 시기만 다른 두 줄 → 1 삽입, 1 중복',
  public.import_places('[{"name":"시기둘","period":"Q4","lat":35.8,"lng":127.8},{"name":"시기둘","period":"Q3","lat":35.8,"lng":127.8}]'),
  '{"imported":1,"duplicates":1,"updated":0,"missionChanged":0}');
select t.eq('시기 값의 형식·길이는 더 이상 검사하지 않음(숫자·21자도 무시)',
  public.import_places(jsonb_build_array(jsonb_build_object('line', 3, 'name', 'B', 'period', 1, 'lat', 36.2, 'lng', 126.2),
                                         jsonb_build_object('name', 'B', 'period', repeat('가', 21), 'lat', 36.2, 'lng', 126.2))),
  '{"imported":0,"duplicates":2,"updated":0,"missionChanged":0}');
select t.eq('B는 여전히 한 줄', (select to_jsonb(count(*)::int) from public.places where name = 'B'), '1');
reset role;
select t.ok('표 제약: 같은 (이름, 좌표)는 직접 넣어도 거부',
  t.err($q$insert into public.places (name, lat, lng) values ('시기점', 35.7, 127.7)$q$) like '23505:%');
select t.ok('표에 period 칸이 없어 직접 넣기도 거부',
  t.err($q$insert into public.places (name, lat, lng, period) values ('시기직접', 1, 1, 'Q1')$q$) like '42703:%');
set role authenticated;
-- 화면 JSON(place_json)에 period 키 없음
select t.ok('list_places 원소에 period 키 없음',
  not exists (select from jsonb_array_elements(public.list_places()) e where e ? 'period'));
select t.ok('get_places 원소에 period 키 없음', not (public.get_places(array[t.pid('시기점')]) -> 0 ? 'period'));
select t.ok('update_memo의 place에 period 키 없음', not (public.update_memo(t.pid('시기점'), '시기 메모') -> 'place' ? 'period'));
-- 지운 장소는 시기 키와 관계없이 같은 이름·좌표로 되살아난다.
create temp table period_gone as select t.pid('시기점') as id;
select t.ok('시기점 지우기', public.delete_place((select id from period_gone)));
select t.eq('다른 시기 키로 다시 가져와도 되살림(imported 1)',
  public.import_places('[{"name":"시기점","period":"Q9","lat":35.7,"lng":127.7}]'),
  '{"imported":1,"duplicates":0,"updated":0,"missionChanged":0}');
select t.eq('되살린 시기점: 같은 id, deleted_at 비움, 기록 그대로',
  (select jsonb_build_array(id = (select id from period_gone), deleted_at is null,
                            (select jsonb_agg(m.mission || ':' || m.flight_time) from public.missions m where m.place_id = p.id))
   from public.places p where name = '시기점'),
  '[true, true, ["PA_1:Q1분"]]');

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
select t.eq('이름(worker)은 쓰지 않으므로 종류를 검사하지 않음(기록 없음 + base 77 → 충돌)', t.sm('A', 'M_01', '{"worker":5}', 77), '{"status":"conflict","record":null}');
select t.raises('flightTime 숫자', $q$select t.sm('A', 'M_01', '{"flightTime":5}', null)$q$, '비행시간은(는) 문자열이어야 합니다.');
select t.raises('batteryNo null', $q$select t.sm('A', 'M_01', '{"batteryNo":null}', null)$q$, '배터리 번호은(는) 문자열이어야 합니다.');
select t.raises('batteryLeft 숫자', $q$select t.sm('A', 'M_01', '{"batteryLeft":45}', null)$q$, '배터리 남은 용량은(는) 문자열이어야 합니다.');
select t.raises('허용 키가 없으면', $q$select t.sm('A', 'M_01', '{"foo":1,"baseVersion":1,"version":3}', null)$q$, '바꿀 내용이 없습니다.');
select t.raises('빈 객체', $q$select t.sm('A', 'M_01', '{}', null)$q$, '바꿀 내용이 없습니다.');
select t.raises('형식 오류가 충돌보다 먼저', $q$select t.sm('A', 'M_01', '{"flightTime":1}', 77)$q$, '비행시간은(는) 문자열이어야 합니다.');
select t.eq('기록이 없는데 base 1이면 충돌(record null)', t.sm('A', 'M_01', '{"worker":"x"}', 1), '{"status":"conflict","record":null}');
select t.ok('충돌이면 기록을 만들지 않음', not exists (select from public.missions where place_id = t.pid('A') and mission = 'M_01'));

select t.eq('새 기록: 이름은 보낸 값 대신 저장자 아이디, 다른 칸은 줄바꿈·탭을 공백 하나로·앞뒤 공백 제거, version 1',
  (select jsonb_build_object('status', r -> 'status', 'worker', r #> '{record,worker}', 'batteryNo', r #> '{record,batteryNo}', 'version', r #> '{record,version}', 'done', r #> '{record,done}',
                             'batteryLeft', r #> '{record,batteryLeft}', 'mission', r #> '{record,mission}', 'keys', (select jsonb_agg(k order by k) from jsonb_object_keys(r -> 'record') k))
   from t.sm('A', 'M_01', E'{"worker":" \\u3000홍\\t\\n길동\\r\\n ","batteryNo":" \\u30003\\t\\n번\\r\\n ","unknown":1}', null) r),
  '{"status":"ok","worker":"김현장","batteryNo":"3 번","version":1,"done":false,"batteryLeft":"","mission":"M_01",
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
  '["45",3,"김현장"]');
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
select t.raises('완료된 기록에서 비행시간을 공백으로 비우면 거부', $q$select t.sm('A', 'M_01', '{"flightTime":"  \t "}', 8)$q$, '완료로 저장하려면 이름, 비행시간, 사용한 배터리 번호, 마지막 배터리 남은 용량을 모두 적어야 합니다.');
select t.eq('완료 해제와 함께 비우기는 허용', t.sm('A', 'M_01', '{"done":false,"flightTime":""}', 8) #> '{record,version}', '9');
select t.eq('텍스트는 200자로 자름', (select to_jsonb(char_length(t.sm('A', 'M_01', jsonb_build_object('batteryNo', repeat('가', 250)), 9) #>> '{record,batteryNo}'))), '200');
select t.eq('일부 칸만 바꾸면 다른 칸은 그대로',
  (select jsonb_build_array(r #> '{record,flightTime}', r #> '{record,batteryLeft}', r #> '{record,done}', r #> '{record,version}') from t.sm('A', 'M_01', '{"flightTime":"5분"}', 10) r),
  '["5분","20",false,11]');

-- ---------- authenticated는 표에 직접 쓸 수 없다(쓰기는 RPC만) ----------
-- version을 안 올린 직접 UPDATE·INSERT도, 올린 것도 권한에서 막힌다.
select t.ok('직접 places insert 거부', t.err($q$insert into public.places (name, lat, lng) values ('직접', 1, 2)$q$) like '42501:%');
select t.ok('직접 places update 거부', t.err($q$update public.places set memo = 'x'$q$) like '42501:%');
select t.ok('직접 places delete 거부', t.err('delete from public.places') like '42501:%');
select t.ok('직접 missions insert 거부(version 없이)',
  t.err(format($q$insert into public.missions (place_id, mission, worker) values (%s, 'M_02', '직접')$q$, t.pid('A'))) like '42501:%');
select t.ok('직접 missions update 거부(version 안 올림)', t.err($q$update public.missions set worker = '직접'$q$) like '42501:%');
select t.ok('직접 missions update 거부(version 올림)', t.err($q$update public.missions set worker = '직접', version = version + 1$q$) like '42501:%');
select t.ok('직접 missions delete 거부', t.err('delete from public.missions') like '42501:%');
select t.ok('직접 truncate 거부', t.err('truncate public.missions') like '42501:%' and t.err('truncate public.places cascade') like '42501:%');
select t.eq('직접 쓰기 시도 뒤에도 A의 기록 그대로',
  (select jsonb_agg(jsonb_build_array(mission, version) order by mission) from public.missions where place_id = t.pid('A')),
  '[["M_01", 11], ["M_02", 1]]');
reset role;

-- ---------- 대시보드(postgres)처럼 표 권한이 있는 쓰기도 트리거가 지킨다 ----------
-- 로그인 없이(JWT 없이) 쓰는 것을 흉내 낸다.
select t.logout();
insert into public.places (name, mission, lat, lng) values ('직접', 'K_1 ~ 3', 1.123456789, 2);
select t.eq('직접 삽입도 좌표를 7자리로', (select to_jsonb(lat) from public.places where name = '직접'), '1.1234568');
select t.ok('로그인 없이 쓰면 updated_by null', (select updated_by is null from public.places where name = '직접'));
-- 표 제약(CHECK)은 트리거 뒤에 보므로 범위 안의 미션으로 시험한다
select t.ok('직접 삽입: done인데 칸이 비면 CHECK 위반',
  t.err(format($q$insert into public.missions (place_id, mission, done) values (%s, 'K_1', true)$q$, t.pid('직접'))) like '23514:%');
select t.ok('직접 삽입: 남은 용량에 숫자 아닌 값이면 CHECK 위반',
  t.err(format($q$insert into public.missions (place_id, mission, battery_left) values (%s, 'K_1', '4a')$q$, t.pid('직접'))) like '23514:%');
select t.ok('직접 삽입: 공백뿐인 이름으로 done이면 CHECK 위반',
  t.err(format($q$insert into public.missions (place_id, mission, done, worker, flight_time, battery_no, battery_left) values (%s, 'K_1', true, E'\u3000', '1', '1', '1')$q$, t.pid('직접'))) like '23514:%');
select t.raises('직접 삽입: 범위 밖 미션은 트리거가 거부',
  format($q$insert into public.missions (place_id, mission) values (%s, 'K_4')$q$, t.pid('직접')), '이 장소에 없는 미션입니다.');
select t.raises('직접 삽입: 없는 장소', $q$insert into public.missions (place_id, mission) values (999999, 'K_1')$q$, '장소를 찾을 수 없습니다.');
select t.eq('직접 삽입: version을 5로 줘도 오류 없이 들어감',
  to_jsonb(t.err(format($q$insert into public.missions (place_id, mission, version, worker) values (%s, 'K_1', 5, '직접')$q$, t.pid('직접')))), null);
select t.eq('직접 삽입 version은 트리거가 1로', (select to_jsonb(version) from public.missions where place_id = t.pid('직접') and mission = 'K_1'), '1');
update public.missions set worker = '직접2' where place_id = t.pid('직접') and mission = 'K_1';
select t.eq('version을 안 올린 직접 UPDATE도 트리거가 올림(2)', (select to_jsonb(version) from public.missions where place_id = t.pid('직접') and mission = 'K_1'), '2');
update public.missions set worker = '직접3', version = 100 where place_id = t.pid('직접') and mission = 'K_1';
select t.eq('version을 크게 줘도 이전 값 + 1(3)', (select to_jsonb(version) from public.missions where place_id = t.pid('직접') and mission = 'K_1'), '3');
update public.missions set version = 1 where place_id = t.pid('직접') and mission = 'K_1';
select t.eq('version을 줄여도 이전 값 + 1(4)', (select to_jsonb(version) from public.missions where place_id = t.pid('직접') and mission = 'K_1'), '4');
select t.raises('직접 수정: 범위 밖 미션으로 바꾸기 거부',
  format($q$update public.missions set mission = 'K_9' where place_id = %s and mission = 'K_1'$q$, t.pid('직접')), '이 장소에 없는 미션입니다.');
-- 화면이 들고 있던 오래된 version으로 저장하면 충돌(직접 쓰기가 version을 올렸으므로)
select t.login(:'u1', :'u1_claims');
set role authenticated;
select t.eq('직접 수정 뒤 오래된 version 저장은 충돌(최신 기록과 함께)',
  (select jsonb_build_array(r -> 'status', r #> '{record,version}', r #> '{record,worker}') from t.sm('직접', 'K_1', '{"worker":"화면"}', 1) r),
  '["conflict",4,"직접3"]');
select t.eq('최신 version으로는 저장(이름은 저장자 아이디), updated_by는 로그인 사용자',
  (select jsonb_build_array(r -> 'status', r #> '{record,version}', r #> '{record,worker}') from t.sm('직접', 'K_1', '{"worker":"화면"}', 4) r), '["ok",5,"김현장"]');
reset role;
select t.ok('RPC로 고친 기록의 updated_by = u1',
  (select updated_by = :'u1'::uuid from public.missions where place_id = t.pid('직접') and mission = 'K_1'));
-- 대시보드에서 장소를 아예 지우는 것(완전 삭제)은 그대로 된다. 기록도 함께 지워진다.
select t.logout();
create temp table direct_gone as select t.pid('직접') as id;
delete from public.places where name = '직접';
select t.ok('대시보드 완전 삭제: 장소와 기록 모두 없음',
  t.pid('직접') is null and not exists (select from public.missions where place_id = (select id from direct_gone)));
select t.login(:'u1', :'u1_claims');
set role authenticated;

-- ---------- list_places ----------
select t.eq('list_places 원소 키',
  (select jsonb_agg(k order by k) from jsonb_object_keys(public.list_places() -> 0) k),
  '["address","createdAt","district","id","lat","lng","memo","mission","missions","name","phone","updatedAt"]');
select t.ok('list_places는 id 순',
  (select bool_and(a < b) from (select (e ->> 'id')::bigint a, lead((e ->> 'id')::bigint) over (order by o) b
                                from jsonb_array_elements(public.list_places()) with ordinality x(e, o)) s where b is not null));
select t.eq('list_places 개수 = 살아 있는 장소 수(지운 L 제외)',
  to_jsonb(jsonb_array_length(public.list_places())), (select to_jsonb(count(*)::int) from public.places where deleted_at is null));
select t.ok('지운 L은 list_places에 없음', not exists (select from jsonb_array_elements(public.list_places()) e where e ->> 'name' = 'L'));
select t.eq('기록 없는 장소는 missions []',
  (select e -> 'missions' from jsonb_array_elements(public.list_places()) e where e ->> 'name' = 'B'), '[]');
select t.eq('A의 기록은 id 순(M_02 먼저 만들었음)',
  (select jsonb_agg(m -> 'mission') from jsonb_array_elements(public.list_places()) e, jsonb_array_elements(e -> 'missions') m where e ->> 'name' = 'A'),
  '["M_02","M_01"]');
select t.eq('좌표는 숫자, done은 불리언',
  (select jsonb_build_array(jsonb_typeof(e -> 'lat'), jsonb_typeof(e -> 'id'), jsonb_typeof(e #> '{missions,0,done}'), jsonb_typeof(e #> '{missions,0,version}'))
   from jsonb_array_elements(public.list_places()) e where e ->> 'name' = 'A'),
  '["number","number","boolean","number"]');

-- ---------- get_places(계약 C2) ----------
select t.eq('get_places: list_places 원소와 같은 모양, id 순, 없는 번호·null·중복은 빠짐',
  public.get_places(array[t.pid('B'), 999999, null, t.pid('A2'), t.pid('A'), t.pid('B')]),
  (select jsonb_agg(e order by (e ->> 'id')::bigint) from jsonb_array_elements(public.list_places()) e where e ->> 'name' in ('A', 'A2', 'B')));
select t.eq('get_places: 지운 장소는 빠짐', public.get_places(array[t.pid('L')]), '[]');
select t.eq('get_places: 빈 배열 → []', public.get_places('{}'), '[]');
select t.eq('get_places: null → []', public.get_places(null), '[]');
select t.ok('get_places: 500개까지는 됨', t.err('select public.get_places(array(select generate_series(1, 500)::bigint))') is null);
select t.raises('get_places: 501개는 오류', 'select public.get_places(array(select generate_series(1, 501)::bigint))', '한 번에 조회할 수 있는 장소는 500개까지입니다.');

-- ---------- update_memo(계약 C1) ----------
select t.raises('메모 null', $q$select public.update_memo(t.pid('A'), null)$q$, '메모는 문자열이어야 합니다.');
select t.raises('메모: 없는 장소', $q$select public.update_memo(999999, 'x')$q$, '장소를 찾을 수 없습니다.');
select t.eq('메모는 줄바꿈 유지', public.update_memo(t.pid('A'), E'첫 줄\n둘째 줄\t') #> '{place,memo}', to_jsonb(E'첫 줄\n둘째 줄\t'::text));
select t.eq('메모는 2000자로 자름', to_jsonb(char_length(public.update_memo(t.pid('A'), repeat('가', 2500)) #>> '{place,memo}')), '2000');
create temp table memo_result as select public.update_memo(t.pid('A'), '메모2') as r;
select t.eq('update_memo 결과는 {status, place}, status ok',
  (select jsonb_build_array(r -> 'status', (select jsonb_agg(k order by k) from jsonb_object_keys(r) k)) from memo_result), '["ok", ["place", "status"]]');
select t.eq('update_memo의 place = list_places 원소', (select r -> 'place' from memo_result),
  (select e from jsonb_array_elements(public.list_places()) e where e ->> 'name' = 'A'));
select t.ok('메모를 고치면 updatedAt이 createdAt 이후',
  (select (e ->> 'updatedAt') > (e ->> 'createdAt') from jsonb_array_elements(public.list_places()) e where e ->> 'name' = 'A'));
select t.eq('기준 메모가 저장된 것과 같으면 저장(ok)',
  (select jsonb_build_array(r -> 'status', r #> '{place,memo}') from public.update_memo(t.pid('A'), '메모3', '메모2') r), '["ok","메모3"]');
select t.eq('기준 메모가 다르면 충돌, 지금 장소를 돌려줌',
  (select jsonb_build_array(r -> 'status', r #> '{place,memo}', r #> '{place,name}') from public.update_memo(t.pid('A'), '덮어쓰기', '메모2') r),
  '["conflict","메모3","A"]');
select t.eq('충돌이면 저장하지 않음', (select to_jsonb(memo) from public.places where name = 'A'), '"메모3"');
create temp table memo_conflict as select public.update_memo(t.pid('A'), '덮어쓰기', '옛 메모') as r;
select t.eq('충돌 결과의 place도 list_places 원소와 같음', (select r -> 'place' from memo_conflict),
  (select e from jsonb_array_elements(public.list_places()) e where e ->> 'name' = 'A'));
select t.eq('저장된 메모가 이미 새 메모와 같으면 ok(같은 요청을 다시 보냄)',
  public.update_memo(t.pid('A'), '메모3', '메모2') -> 'status', '"ok"');
select t.eq('기준 메모 빈 문자열도 비교함', public.update_memo(t.pid('A'), 'y', '') -> 'status', '"conflict"');
select t.eq('기준 메모 null이면 조건 없이 저장', public.update_memo(t.pid('A'), '메모4', null) #> '{place,memo}', '"메모4"');
select t.eq('인자 이름으로 3인자 호출(PostgREST 방식)',
  public.update_memo(p_place_id => t.pid('A'), p_memo => '메모5', p_base_memo => '메모4') -> 'status', '"ok"');
select t.eq('인자 이름으로 2인자 호출(예전 화면)',
  public.update_memo(p_place_id => t.pid('A'), p_memo => '메모6') #> '{place,memo}', '"메모6"');

-- ---------- delete_place(soft delete, 계약 C3) ----------
select t.ok('지우기 전 A의 기록 있음', exists (select from public.missions where place_id = t.pid('A')));
create temp table gone as select t.pid('A') as id, (select count(*) from public.missions where place_id = t.pid('A')) as n;
select t.ok('delete_place → true', public.delete_place((select id from gone)));
select t.ok('soft delete: 행은 남고 deleted_at이 채워짐', (select deleted_at is not null from public.places where id = (select id from gone)));
select t.ok('soft delete: 미션 기록은 그대로 남음', (select count(*) from public.missions where place_id = (select id from gone)) = (select n from gone));
select t.ok('지운 장소는 list_places에서 빠짐', not exists (select from jsonb_array_elements(public.list_places()) e where (e ->> 'id')::bigint = (select id from gone)));
select t.eq('지운 장소는 get_places에서도 빠짐', public.get_places(array[(select id from gone)]), '[]');
select t.ok('다시 지우면 false', not public.delete_place((select id from gone)));
select t.ok('없는 장소 지우기 false', not public.delete_place(999999));
select t.raises('지운 장소에 미션 저장 → 장소 없음',
  format($q$select public.save_mission(%s, 'M_01', '{"worker":"x"}', 11)$q$, (select id from gone)), '장소를 찾을 수 없습니다.');
select t.raises('지운 장소 메모 → 장소 없음', format($q$select public.update_memo(%s, 'x')$q$, (select id from gone)), '장소를 찾을 수 없습니다.');
-- 같은 장소를 다시 가져오면 되살아난다. 지금 A: 시군 서산시, 주소 남면 2, 전화 010-1, 미션 M_01 ~ 02, 메모 메모6
select t.eq('지운 장소 다시 가져오기 → imported 1(되살림)',
  public.import_places('[{"name":"A","district":"","address":"새 주소","phone":"999","memo":"새 메모","mission":"","lat":36.1234568,"lng":126.1}]'),
  '{"imported":1,"duplicates":0,"updated":0,"missionChanged":0}');
select t.eq('되살린 장소: 같은 id, deleted_at 비움, 갱신 규칙(주소만 CSV로), 전화·메모·미션명 그대로',
  (select jsonb_build_array(id = (select id from gone), deleted_at is null, district, address, phone, memo, mission) from public.places where name = 'A'),
  '[true, true, "서산시", "새 주소", "010-1", "메모6", "M_01 ~ 02"]');
select t.eq('되살린 장소의 옛 미션 기록이 list_places에 다시 나옴',
  (select to_jsonb(jsonb_array_length(e -> 'missions')) from jsonb_array_elements(public.list_places()) e where e ->> 'name' = 'A'),
  (select to_jsonb(n) from gone));
select t.eq('되살린 뒤 다시 가져오면 평소처럼 중복', public.import_places('[{"name":"A","lat":36.1234568,"lng":126.1}]'),
  '{"imported":0,"duplicates":1,"updated":0,"missionChanged":0}');
select t.eq('되살린 장소에 이어서 저장(version 12)', t.sm('A', 'M_01', '{"worker":"되살림"}', 11) #> '{record,version}', '12');
-- 지운 장소를 미션명을 바꿔 두 줄로 가져오기: 첫 줄은 되살림(imported, missionChanged로 세지 않음), 둘째 줄은 평소 갱신
select t.eq('RV 가져오기', public.import_places('[{"name":"RV","mission":"V_1 ~ 2","lat":35.1,"lng":127.1}]') -> 'imported', '1');
select t.eq('RV 기록', t.sm('RV', 'V_2', '{"flightTime":"옛"}', null) -> 'status', '"ok"');
select t.ok('RV 지우기', public.delete_place(t.pid('RV')));
select t.eq('지운 장소 + 같은 장소 두 줄: 1 되살림, 1 중복(갱신·missionChanged)',
  public.import_places('[{"name":"RV","mission":"V_1 ~ 3","lat":35.1,"lng":127.1},{"name":"RV","mission":"V_1 ~ 4","lat":35.1,"lng":127.1}]'),
  '{"imported":1,"duplicates":1,"updated":1,"missionChanged":1}');
select t.eq('RV: 미션명은 마지막 줄 값, 옛 기록(V_2) 남음',
  (select jsonb_build_array(p.mission, p.deleted_at is null, m.mission, m.flight_time) from public.places p join public.missions m on m.place_id = p.id where p.name = 'RV'),
  '["V_1 ~ 4", true, "V_2", "옛"]');

-- ---------- 범위 밖 기록 ----------
-- 미션명 범위가 줄면 범위 밖 기록은 지우지 않고 남긴다(화면이 숨김). 고칠 수는 없고, 범위가 돌아오면 이어서 고친다.
select t.eq('범위 시험 장소(R_1 ~ 3)', public.import_places('[{"name":"R","mission":"R_1 ~ 3","lat":35.2,"lng":127.2}]') -> 'imported', '1');
select t.eq('R_3 기록(version 1)', t.sm('R', 'R_3', '{"batteryNo":"범위"}', null) #> '{record,version}', '1');
select t.eq('미션명 범위를 줄이면 missionChanged', public.import_places('[{"name":"R","mission":"R_1 ~ 2","lat":35.2,"lng":127.2}]'),
  '{"imported":0,"duplicates":1,"updated":1,"missionChanged":1}');
select t.eq('범위 밖 기록도 list_places에 그대로 나옴',
  (select jsonb_agg(m -> 'mission') from jsonb_array_elements(public.list_places()) e, jsonb_array_elements(e -> 'missions') m where e ->> 'name' = 'R'),
  '["R_3"]');
select t.raises('범위 밖 기록은 save_mission으로 못 고침', $q$select t.sm('R', 'R_3', '{"worker":"x"}', 1)$q$, '이 장소에 없는 미션입니다.');
reset role;
select t.raises('범위 밖 기록은 대시보드 직접 UPDATE도 트리거가 거부',
  format($q$update public.missions set worker = 'x' where place_id = %s and mission = 'R_3'$q$, t.pid('R')), '이 장소에 없는 미션입니다.');
set role authenticated;
select t.eq('범위를 되돌리기', public.import_places('[{"name":"R","mission":"R_1 ~ 3","lat":35.2,"lng":127.2}]') -> 'missionChanged', '1');
select t.eq('범위가 돌아오면 같은 기록을 이어서 고침(version 2)',
  (select jsonb_build_array(r -> 'status', r #> '{record,version}', r #> '{record,batteryNo}') from t.sm('R', 'R_3', '{"flightTime":"7분"}', 1) r),
  '["ok",2,"범위"]');

-- ---------- 미션 기록 이름 = 저장한 사람의 아이디(화면이 보낸 이름은 쓰지 않음) ----------
select t.eq('이름 시험 장소(W_1 ~ 3)', public.import_places('[{"name":"W","mission":"W_1 ~ 3","lat":35.3,"lng":127.3}]') -> 'imported', '1');
select t.eq('보낸 이름 대신 JWT app_metadata.login_id(사용자가 바꾼 user_metadata는 무시)',
  (select jsonb_build_array(r -> 'status', r #> '{record,worker}', r #> '{record,flightTime}') from t.sm('W', 'W_1', '{"worker":"다른 사람","flightTime":"1분"}', null) r),
  '["ok","김현장","1분"]');
select t.eq('이름 값이 문자열이 아니어도 저장자 아이디', t.sm('W', 'W_1', '{"worker":5}', 1) #> '{record,worker}', '"김현장"');
select t.login(:'u2', :'u2_claims');
select t.eq('이름 키 없이 저장하면 기존 이름 유지(다른 사람이 저장해도)',
  (select jsonb_build_array(r #> '{record,worker}', r #> '{record,flightTime}', r #> '{record,version}') from t.sm('W', 'W_1', '{"flightTime":"2분"}', 2) r),
  '["김현장","2분",3]');
select t.ok('이름은 그대로지만 updated_by는 마지막에 쓴 u2', (select updated_by = :'u2'::uuid from public.missions where place_id = t.pid('W') and mission = 'W_1'));
select t.eq('이름 키가 있으면(빈 값이라도) 저장하는 사람(u2)의 아이디로 바뀜', t.sm('W', 'W_1', '{"worker":""}', 3) #> '{record,worker}', '"박현장"');
-- 아이디를 고르는 순서: app_metadata.login_id → user_metadata.login_id → email의 @ 앞부분
select t.login(:'u1', '{"email":"u1@sistech.local","app_metadata":{"login_id":"  "},"user_metadata":{"login_id":" 사용자메타 "}}');
select t.eq('app_metadata.login_id가 비어 있으면 user_metadata.login_id(앞뒤 공백 제거)', t.sm('W', 'W_1', '{"worker":"x"}', 4) #> '{record,worker}', '"사용자메타"');
select t.login(:'u1', '{"email":"xn--4k0bz9vb1i@sistech.local","app_metadata":{"provider":"email"}}');
select t.eq('둘 다 없으면 email의 @ 앞부분(xn--… 그대로)', t.sm('W', 'W_1', '{"worker":"x"}', 5) #> '{record,worker}', '"xn--4k0bz9vb1i"');
select t.login(:'u1', '{}');
select t.raises('아이디를 전혀 알 수 없으면 이름 키가 있는 저장은 거부', $q$select t.sm('W', 'W_1', '{"worker":"x"}', 6)$q$,
  '저장한 사람의 아이디를 알 수 없습니다. 다시 로그인해 주세요.');
select t.eq('아이디를 몰라도 이름 키가 없는 저장은 됨(기존 이름 유지)',
  (select jsonb_build_array(r -> 'status', r #> '{record,worker}') from t.sm('W', 'W_1', '{"batteryNo":"1"}', 6) r), '["ok","xn--4k0bz9vb1i"]');
select t.login(:'u1', :'u1_claims');
-- 완료 조건은 그대로: 이름이 빈 기록을 이름 키 없이 완료로 저장하면 거부, 이름 키를 보내면 아이디가 들어가 완료
select t.eq('이름 없이 칸만 채운 새 기록(W_2)은 이름이 빈 칸',
  (select jsonb_build_array(r -> 'status', r #> '{record,worker}') from t.sm('W', 'W_2', '{"flightTime":"3분","batteryNo":"2","batteryLeft":"50"}', null) r), '["ok",""]');
select t.raises('이름이 빈 기록을 이름 키 없이 완료로 저장하면 거부', $q$select t.sm('W', 'W_2', '{"done":true}', 1)$q$,
  '완료로 저장하려면 이름, 비행시간, 사용한 배터리 번호, 마지막 배터리 남은 용량을 모두 적어야 합니다.');
select t.eq('이름 키와 함께 완료로 저장하면 저장자 아이디로 완료',
  (select jsonb_build_array(r -> 'status', r #> '{record,done}', r #> '{record,worker}') from t.sm('W', 'W_2', '{"done":true,"worker":""}', 1) r), '["ok",true,"김현장"]');
select t.eq('완료된 기록에 이름을 공백으로 보내도 아이디가 들어가 완료 유지',
  (select jsonb_build_array(r -> 'status', r #> '{record,done}', r #> '{record,worker}') from t.sm('W', 'W_2', '{"worker":"  "}', 2) r), '["ok",true,"김현장"]');

-- ---------- 감사 로그·updated_by ----------
-- 다른 사용자(u2)가 쓰면 그 사용자가 남는다
select t.login(:'u2', :'u2_claims');
select t.eq('u2가 B 메모 저장', public.update_memo(t.pid('B'), 'u2 메모') -> 'status', '"ok"');
select t.eq('u2가 A 기록 저장(이름은 u2의 아이디)',
  (select jsonb_build_array(r -> 'status', r #> '{record,worker}') from t.sm('A', 'M_02', '{"worker":"u2"}', 1) r), '["ok","박현장"]');
select t.login(:'u1', :'u1_claims');
select t.ok('authenticated: audit_log select 거부', t.err('select * from public.audit_log') like '42501:%');
select t.ok('authenticated: audit_log insert 거부', t.err($q$insert into public.audit_log (tbl, op) values ('places', 'INSERT')$q$) like '42501:%');
select t.ok('authenticated: audit_log update·delete 거부',
  t.err($q$update public.audit_log set tbl = 'x'$q$) like '42501:%' and t.err('delete from public.audit_log') like '42501:%');
reset role;
select t.ok('updated_by: 장소를 만든 사용자(u1)', (select updated_by = :'u1'::uuid from public.places where name = 'A2'));
select t.ok('updated_by: 마지막으로 고친 사용자(u2)',
  (select updated_by = :'u2'::uuid from public.places where name = 'B')
  and (select updated_by = :'u2'::uuid from public.missions where place_id = t.pid('A') and mission = 'M_02'));
select t.ok('감사 로그: 가져오기 INSERT(actor u1, 새 행 전체)',
  exists (select from public.audit_log where tbl = 'places' and op = 'INSERT' and row_id = t.pid('A2')
          and actor = :'u1'::uuid and old_row is null and new_row ->> 'name' = 'A2' and (new_row ->> 'lat')::float8 = 36.1234568));
select t.ok('감사 로그: 메모 UPDATE는 바뀌기 전·뒤 행(actor u2)',
  exists (select from public.audit_log where tbl = 'places' and op = 'UPDATE' and row_id = t.pid('B') and actor = :'u2'::uuid
          and old_row ->> 'memo' = '' and new_row ->> 'memo' = 'u2 메모' and new_row ->> 'updated_by' = :'u2'));
select t.ok('감사 로그: 충돌로 저장하지 않은 메모는 남지 않음',
  not exists (select from public.audit_log where tbl = 'places' and new_row ->> 'memo' = '덮어쓰기'));
select t.ok('감사 로그: soft delete는 deleted_at이 채워지는 UPDATE',
  exists (select from public.audit_log where tbl = 'places' and op = 'UPDATE' and row_id = (select id from gone)
          and old_row ->> 'deleted_at' is null and new_row ->> 'deleted_at' is not null and actor = :'u1'::uuid));
select t.ok('감사 로그: 되살림은 deleted_at이 비는 UPDATE',
  exists (select from public.audit_log where tbl = 'places' and op = 'UPDATE' and row_id = (select id from gone)
          and old_row ->> 'deleted_at' is not null and new_row ->> 'deleted_at' is null));
select t.ok('감사 로그: 미션 기록 UPDATE마다 version이 1씩',
  (select bool_and((new_row ->> 'version')::int = (old_row ->> 'version')::int + 1) from public.audit_log where tbl = 'missions' and op = 'UPDATE')
  and (select count(*) from public.audit_log where tbl = 'missions' and op = 'UPDATE') > 10);
select t.ok('감사 로그: 미션 기록 INSERT는 version 1',
  (select bool_and((new_row ->> 'version')::int = 1) from public.audit_log where tbl = 'missions' and op = 'INSERT'));
select t.ok('감사 로그: 대시보드 완전 삭제는 DELETE(actor null), 함께 지워진 기록도 DELETE',
  exists (select from public.audit_log where tbl = 'places' and op = 'DELETE' and row_id = (select id from direct_gone)
          and old_row ->> 'name' = '직접' and new_row is null and actor is null)
  and exists (select from public.audit_log where tbl = 'missions' and op = 'DELETE' and old_row ->> 'place_id' = (select id from direct_gone)::text));
select t.ok('감사 로그: 실패한(되돌린) 가져오기는 남지 않음', not exists (select from public.audit_log where new_row ->> 'name' in ('F', 'G1', 'G2')));
set role service_role;
select t.ok('service_role: audit_log select 거부', t.err('select * from public.audit_log') like '42501:%');
reset role;
set role authenticated;

-- ---------- 읽기만 가능한 authenticated의 직접 조회(Realtime도 이 권한으로 본다) ----------
select t.ok('authenticated: places·missions 직접 select 가능(지운 장소 포함)',
  (select count(*) from public.places where deleted_at is not null) >= 1 and (select count(*) from public.missions) > 0);
reset role;

-- ---------- anon은 막힌다 ----------
set role anon;
select t.ok('anon: places select 거부', t.err('select * from public.places') like '42501:%');
select t.ok('anon: missions select 거부', t.err('select * from public.missions') like '42501:%');
select t.ok('anon: places insert 거부', t.err($q$insert into public.places (name, lat, lng) values ('x', 1, 1)$q$) like '42501:%');
select t.ok('anon: audit_log select 거부', t.err('select * from public.audit_log') like '42501:%');
select t.ok('anon: list_places 거부', t.err('select public.list_places()') like '42501:%');
select t.ok('anon: get_places 거부', t.err($q$select public.get_places('{1}')$q$) like '42501:%');
select t.ok('anon: import_places 거부', t.err($q$select public.import_places('[]')$q$) like '42501:%');
select t.ok('anon: save_mission 거부', t.err($q$select public.save_mission(1, 'x', '{}', null)$q$) like '42501:%');
select t.ok('anon: update_memo 거부(2인자·3인자)',
  t.err($q$select public.update_memo(1, 'x')$q$) like '42501:%' and t.err($q$select public.update_memo(1, 'x', 'y')$q$) like '42501:%');
select t.ok('anon: delete_place 거부', t.err('select public.delete_place(1)') like '42501:%');
select t.ok('anon: mission_names 거부', t.err($q$select public.mission_names('a1~2')$q$) like '42501:%');
reset role;

-- 정책이 없는 다른 롤은 권한이 있어도 RLS에 막혀 행이 안 보인다
create role rls_probe nologin;
grant usage on schema public to rls_probe;
grant select on public.places, public.audit_log to rls_probe;
set role rls_probe;
select t.ok('정책 없는 롤은 RLS로 0행', (select count(*) from public.places) = 0);
select t.ok('정책 없는 롤은 audit_log도 RLS로 0행', (select count(*) from public.audit_log) = 0);
reset role;
select t.ok('postgres(대시보드)는 audit_log를 읽음', (select count(*) from public.audit_log) > 0);

-- ---------- 여러 세션이 동시에 ----------
create extension dblink;
set role authenticated;
select t.eq('동시성용 장소', public.import_places('[{"name":"동시","mission":"C_1 ~ 2","lat":34,"lng":128}]') -> 'imported', '1');
select t.eq('C_1 기록 만들기(version 1)', t.sm('동시', 'C_1', '{"worker":"처음"}', null) #> '{record,version}', '1');
reset role;

select dblink_connect('a', :'conn');
select dblink_connect('b', :'conn');
select dblink_exec('a', 'set role authenticated');
select dblink_exec('b', 'set role authenticated');
select dblink_exec('a', format('set request.jwt.claim.sub = %L', :'u1'));
select dblink_exec('b', format('set request.jwt.claim.sub = %L', :'u2'));
select dblink_exec('a', format('set request.jwt.claims = %L', (:'u1_claims'::jsonb || jsonb_build_object('sub', :'u1'::text))::text));
select dblink_exec('b', format('set request.jwt.claims = %L', (:'u2_claims'::jsonb || jsonb_build_object('sub', :'u2'::text))::text));

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
  (select jsonb_build_array(r -> 'status', r #> '{record,worker}', r #> '{record,version}') from r1), '["conflict","김현장",2]');
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
  (select jsonb_build_array(r -> 'status', r #> '{record,worker}', r #> '{record,version}') from r2), '["conflict","김현장",1]');
select * from dblink_get_result('b') as x(r text);

-- 3) 장소 잠금을 거치지 않는 대시보드 직접 쓰기(postgres)가 version을 안 올려도 트리거가 올리므로 저장은 충돌로 막힌다
select dblink_exec('a', 'reset role');
select dblink_exec('a', 'begin');
select dblink_exec('a', $q$update public.missions set worker = '직접' where mission = 'C_2'$q$);
select dblink_send_query('b', $q$select t.sm('동시', 'C_2', '{"worker":"B2"}', 1)::text$q$);
select pg_sleep(0.5);
select t.ok('세션 B는 직접 쓰기가 끝날 때까지 기다림', dblink_is_busy('b') = 1);
select dblink_exec('a', 'commit');
create temp table r3 as select r::jsonb as r from dblink_get_result('b') as x(r text);
select t.eq('version을 안 올린 직접 쓰기 뒤의 저장은 충돌',
  (select jsonb_build_array(r -> 'status', r #> '{record,worker}', r #> '{record,version}') from r3), '["conflict","직접",2]');
select * from dblink_get_result('b') as x(r text);
select dblink_exec('a', 'set role authenticated');

-- 4) 저장이 장소 잠금을 기다리는 사이 다른 기기가 장소를 지우고(soft delete) 커밋하면 "장소를 찾을 수 없습니다"
select dblink_exec('a', 'begin');
select t.ok('세션 A가 장소 삭제(커밋 전)', (select r from dblink('a', $q$select public.delete_place(t.pid('동시'))$q$) as x(r boolean)));
select dblink_send_query('b', $q$select t.err($x$select t.sm('동시', 'C_1', '{"worker":"늦은 저장"}', 2)$x$)$q$);
select pg_sleep(0.5);
select t.ok('세션 B 저장은 삭제가 끝날 때까지 기다림', dblink_is_busy('b') = 1);
select dblink_exec('a', 'commit');
create temp table r4 as select r from dblink_get_result('b') as x(r text);
select t.eq('삭제 커밋 뒤 기다리던 저장은 장소 없음 오류', (select to_jsonb(r) from r4), '"P0001: 장소를 찾을 수 없습니다."');
select * from dblink_get_result('b') as x(r text);
select t.eq('기다리던 저장은 아무것도 쓰지 않음(C_1은 A의 version 2 그대로, 기록은 남음)',
  (select jsonb_build_array(worker, version) from public.missions where place_id = t.pid('동시') and mission = 'C_1'), '["김현장", 2]');

-- 5) 두 기기가 같은 메모를 같은 기준으로 동시에 저장하면 뒤에 온 쪽은 충돌(계약 C1)
set role authenticated;
select t.login(:'u1', :'u1_claims');
select t.eq('메모 동시성용 장소', public.import_places('[{"name":"메모동시","memo":"처음","lat":34.5,"lng":128.5}]') -> 'imported', '1');
reset role;
select dblink_exec('a', 'begin');
select t.eq('세션 A 메모 저장(커밋 전) ok',
  (select r::jsonb -> 'status' from dblink('a', $q$select public.update_memo(t.pid('메모동시'), 'A의 메모', '처음')::text$q$) as x(r text)), '"ok"');
select dblink_send_query('b', $q$select public.update_memo(t.pid('메모동시'), 'B의 메모', '처음')::text$q$);
select pg_sleep(0.5);
select t.ok('세션 B 메모 저장은 기다림', dblink_is_busy('b') = 1);
select dblink_exec('a', 'commit');
create temp table r5 as select r::jsonb as r from dblink_get_result('b') as x(r text);
select t.eq('세션 B는 충돌, A의 메모를 받음', (select jsonb_build_array(r -> 'status', r #> '{place,memo}') from r5), '["conflict","A의 메모"]');
select * from dblink_get_result('b') as x(r text);
select t.eq('메모는 A의 것', (select to_jsonb(memo) from public.places where name = '메모동시'), '"A의 메모"');

-- 6) 두 가져오기가 같은 장소들을 반대 순서로 담아 동시에 실행해도 (이름, 위도, 경도) 순으로 잠가 교착되지 않는다.
--    파일 순서대로 잠갔다면 B가 교착2를 쥔 채 교착1을 기다리고, A가 교착2를 기다려 서로 막힌다(교착).
set role authenticated;
select t.eq('교착 시험 장소 둘', public.import_places('[{"name":"교착1","lat":34.7,"lng":128.7},{"name":"교착2","lat":34.7,"lng":128.7}]') -> 'imported', '2');
reset role;
select dblink_exec('a', 'begin');
select t.eq('세션 A가 교착1을 잠금(가져오기, 커밋 전)',
  (select r::jsonb -> 'duplicates' from dblink('a', $q$select public.import_places('[{"name":"교착1","lat":34.7,"lng":128.7}]')::text$q$, false) as x(r text)), '1');
select dblink_send_query('b', $q$select public.import_places('[{"name":"교착2","district":"B","lat":34.7,"lng":128.7},{"name":"교착1","district":"B","lat":34.7,"lng":128.7}]')::text$q$);
select pg_sleep(0.5);
select t.ok('세션 B는 교착1에서 기다림', dblink_is_busy('b') = 1);
select t.eq('세션 A는 교착2도 바로 잠금(B가 쥐고 있지 않음)',
  (select r::jsonb -> 'duplicates' from dblink('a', $q$select public.import_places('[{"name":"교착2","lat":34.7,"lng":128.7}]')::text$q$, false) as x(r text)), '1');
select dblink_exec('a', 'commit');
create temp table r6 as select r::jsonb as r from dblink_get_result('b', false) as x(r text);
select t.eq('세션 B 가져오기도 끝남(둘 다 시군 갱신)', (select r from r6), '{"imported":0,"duplicates":2,"updated":2,"missionChanged":0}');
select * from dblink_get_result('b') as x(r text);

-- 7) 두 기기가 같은 장소의 다른 미션을 동시에 저장하면(장소 잠금으로 줄 섬) 각 기록에는 각자의 아이디가 들어간다.
--    화면이 보낸 이름(서로 상대 아이디를 적어 보냄)은 쓰지 않는다.
set role authenticated;
select t.eq('이름 동시성용 장소', public.import_places('[{"name":"이름동시","mission":"W_1 ~ 2","lat":34.9,"lng":128.9}]') -> 'imported', '1');
reset role;
select dblink_exec('a', 'begin');
select t.eq('세션 A(김현장)가 W_1 저장(커밋 전, 이름은 "박현장"이라고 보냄)',
  (select r::jsonb #> '{record,worker}' from dblink('a', $q$select t.sm('이름동시', 'W_1', '{"worker":"박현장","flightTime":"A"}', null)::text$q$) as x(r text)), '"김현장"');
select dblink_send_query('b', $q$select t.sm('이름동시', 'W_2', '{"worker":"김현장","flightTime":"B"}', null)::text$q$);
select pg_sleep(0.5);
select t.ok('세션 B(박현장)는 같은 장소라 A가 끝날 때까지 기다림', dblink_is_busy('b') = 1);
select dblink_exec('a', 'commit');
create temp table r7 as select r::jsonb as r from dblink_get_result('b') as x(r text);
select t.eq('세션 B 저장 ok, 이름은 B의 아이디', (select jsonb_build_array(r -> 'status', r #> '{record,worker}') from r7), '["ok","박현장"]');
select * from dblink_get_result('b') as x(r text);
select t.eq('두 기록의 이름·updated_by는 각자의 것',
  (select jsonb_agg(jsonb_build_array(mission, worker, flight_time, updated_by::text) order by mission) from public.missions where place_id = t.pid('이름동시')),
  jsonb_build_array(jsonb_build_array('W_1', '김현장', 'A', :'u1'::text), jsonb_build_array('W_2', '박현장', 'B', :'u2'::text)));
select dblink_disconnect('a');
select dblink_disconnect('b');

-- ===================================================================
-- 로그인 기록(supabase/migrations/20261106120000_login_logs.sql, 20261109130100_login_logs_hardening.sql)
-- ===================================================================

-- ---------- 구조·권한 ----------
-- 앞 구간의 u1 클레임이 남아 있으면 JWT 대비 경로 검사가 흔들리므로 비우고 시작한다.
select t.logout();
select t.ok('login_logs RLS 켜짐', (select relrowsecurity from pg_class where oid = 'public.login_logs'::regclass));
select t.ok('auth.sessions에 로그인 기록 트리거가 있음',
  exists (select from pg_trigger where tgrelid = 'auth.sessions'::regclass and tgname = 'login_logs_on_session' and not tgisinternal));
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
select t.ok('login_logs: 세션당 login 하나 유일 인덱스',
  exists (select from pg_indexes where schemaname = 'public' and tablename = 'login_logs' and indexname = 'login_logs_login_session' and indexdef like 'CREATE UNIQUE INDEX%'));
select t.eq('login_logs.ip는 null 허용·기본값 없음, session_id는 uuid',
  (select jsonb_agg(jsonb_build_array(column_name, data_type, is_nullable, column_default) order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'login_logs' and column_name in ('ip', 'session_id')),
  '[["ip", "text", "YES", null], ["session_id", "uuid", "YES", null]]');
select t.ok('purge_login_logs는 postgres 전용(anon·authenticated·service_role 실행 불가)',
  not has_function_privilege('authenticated', 'public.purge_login_logs(interval)', 'execute')
  and not has_function_privilege('anon', 'public.purge_login_logs(interval)', 'execute')
  and not has_function_privilege('service_role', 'public.purge_login_logs(interval)', 'execute'));

-- 1111: user_metadata만, 6666: app_metadata와 user_metadata가 다름(사용자가 user_metadata를 바꾼 경우)
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'xn--hong@sistech.local', '{"login_id":"홍길동"}', '{}'),
  ('22222222-2222-2222-2222-222222222222', 'b@sistech.local', '{}', '{}'),
  ('33333333-3333-3333-3333-333333333333', 'c@sistech.local', '{"login_id":"영희"}', '{}'),
  ('44444444-4444-4444-4444-444444444444', 'boom@sistech.local', '{"login_id":"폭탄"}', '{}'),
  ('66666666-6666-6666-6666-666666666666', 'app@sistech.local', '{"login_id":"바꾼이름"}', '{"provider":"email","login_id":"진짜이름"}');

-- ---------- 트리거: 세션 생성 = 로그인 ----------
set role supabase_auth_admin;
insert into auth.sessions (id, user_id, user_agent, ip)
values ('5e550000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mozilla/5.0 테스트', '203.0.113.7');
insert into auth.sessions (id, user_id, user_agent, ip)
values ('5e550000-0000-0000-0000-000000000006', '66666666-6666-6666-6666-666666666666', 'UA6', '203.0.113.6');
reset role;
select t.eq('세션 생성 → login 행 1개(이메일·아이디·UA·세션 id, IP는 꾸밀 수 있는 값이라 비움)',
  (select jsonb_agg(jsonb_build_array(event, email, login_id, user_agent, ip, session_id)) from public.login_logs
   where user_id = '11111111-1111-1111-1111-111111111111'),
  '[["login", "xn--hong@sistech.local", "홍길동", "Mozilla/5.0 테스트", null, "5e550000-0000-0000-0000-000000000001"]]');
select t.eq('트리거도 아이디는 app_metadata.login_id 먼저',
  (select jsonb_agg(login_id) from public.login_logs where user_id = '66666666-6666-6666-6666-666666666666'), '["진짜이름"]');

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
select t.eq('user_agent·ip 칸이 없는 세션 테이블 → UA 빈 칸, IP null로 기록',
  (select jsonb_agg(jsonb_build_array(event, email, login_id, user_agent, ip)) from public.login_logs
   where user_id = '33333333-3333-3333-3333-333333333333'),
  '[["login", "c@sistech.local", "영희", "", null]]');
alter table auth.sessions add column user_agent text, add column ip text;

-- ---------- log_login: 트리거가 남긴 직후면 건너뜀 ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select t.eq('트리거 직후 log_login(세션 모름) → 15초 규칙으로 logged:false', public.log_login('UA'), '{"logged": false}');
reset role;
select t.ok('중복이면 행이 늘지 않음',
  (select count(*) from public.login_logs where user_id = '11111111-1111-1111-1111-111111111111') = 1);

-- ---------- log_login: 세션당 한 번(JWT session_id) ----------
-- 같은 세션이면 시간이 지나도 중복이고, 트리거가 비워 둔 IP를 cf-connecting-ip로 채운다(x-forwarded-for는 믿지 않음).
update public.login_logs set occurred_at = occurred_at - interval '1 hour' where user_id = '11111111-1111-1111-1111-111111111111';
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","session_id":"5e550000-0000-0000-0000-000000000001"}', false);
select set_config('request.headers', '{"user-agent":"헤더UA1","cf-connecting-ip":"198.51.100.9","x-forwarded-for":"10.9.9.9","x-real-ip":"10.8.8.8"}', false);
set role authenticated;
select t.eq('같은 세션 log_login → logged:false(1시간 뒤에도)', public.log_login('무시될 UA'), '{"logged": false}');
reset role;
select t.eq('같은 세션 기록에 cf-connecting-ip를 채움(UA는 트리거 값 유지), 행은 하나',
  (select jsonb_agg(jsonb_build_array(user_agent, ip)) from public.login_logs where user_id = '11111111-1111-1111-1111-111111111111'),
  '[["Mozilla/5.0 테스트", "198.51.100.9"]]');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","session_id":"5e550000-0000-0000-0000-000000000002"}', false);
set role authenticated;
select t.eq('새 세션 log_login → logged:true', public.log_login('무시될 UA'), '{"logged": true}');
select t.eq('그 세션으로 곧바로 다시 → logged:false', public.log_login(''), '{"logged": false}');
reset role;
select t.eq('새 세션 기록: UA·IP는 헤더(인자·x-forwarded-for·x-real-ip 무시), session_id 저장',
  (select jsonb_agg(jsonb_build_array(user_agent, ip, session_id)) from public.login_logs where session_id = '5e550000-0000-0000-0000-000000000002'),
  '[["헤더UA1", "198.51.100.9", "5e550000-0000-0000-0000-000000000002"]]');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","session_id":"5e550000-0000-0000-0000-000000000003"}', false);
set role authenticated;
select t.eq('15초 안이라도 다른 세션(다른 기기)이면 logged:true', public.log_login(''), '{"logged": true}');
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","session_id":"세션아님"}', false);
set role authenticated;
select t.eq('session_id가 uuid가 아니면 세션 모름(15초 규칙으로 중복)', public.log_login(''), '{"logged": false}');
reset role;
select t.eq('사용자 1111의 login 행은 세션마다 하나씩 3개',
  (select to_jsonb(count(*)) from public.login_logs where user_id = '11111111-1111-1111-1111-111111111111' and event = 'login'), '3');
select set_config('request.jwt.claims', '', false);
select set_config('request.headers', '', false);

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
select set_config('request.headers', '{"user-agent":"헤더UA","x-forwarded-for":"198.51.100.1, 10.0.0.1","x-real-ip":"198.51.100.2"}', false);
set role authenticated;
select t.eq('트리거 없음 → log_login이 기록(logged:true)', public.log_login('UA2'), '{"logged": true}');
select t.eq('곧바로 다시 log_login → logged:false', public.log_login(''), '{"logged": false}');
reset role;
select t.eq('대비 경로 기록: UA는 요청 헤더(인자 무시), x-forwarded-for·x-real-ip는 믿지 않아 IP null',
  (select jsonb_agg(jsonb_build_array(event, email, login_id, user_agent, ip)) from public.login_logs
   where user_id = '22222222-2222-2222-2222-222222222222'),
  '[["login", "b@sistech.local", "", "헤더UA", null]]');
update public.login_logs set occurred_at = occurred_at - interval '20 seconds' where user_id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
select t.eq('15초가 지나면 다시 기록', public.log_login(''), '{"logged": true}');
reset role;
select t.eq('기기 정보는 늘 요청 헤더 User-Agent',
  (select to_jsonb(user_agent) from public.login_logs where user_id = '22222222-2222-2222-2222-222222222222' order by id desc limit 1),
  '"헤더UA"');

-- ---------- log_logout ----------
set role authenticated;
select t.eq('log_logout → logged:true', public.log_logout(), '{"logged": true}');
select t.eq('2초 안에 다시 log_logout → logged:false', public.log_logout(), '{"logged": false}');
reset role;
select t.eq('logout 행 1개(헤더 UA, cf-connecting-ip가 없어 IP null)',
  (select jsonb_agg(jsonb_build_array(event, email, login_id, user_agent, ip)) from public.login_logs
   where user_id = '22222222-2222-2222-2222-222222222222' and event = 'logout'),
  '[["logout", "b@sistech.local", "", "헤더UA", null]]');
update public.login_logs set occurred_at = occurred_at - interval '3 seconds' where user_id = '22222222-2222-2222-2222-222222222222' and event = 'logout';
select set_config('request.headers', '{"user-agent":"헤더UA","cf-connecting-ip":" 203.0.113.50 "}', false);
select set_config('request.jwt.claims', '{"session_id":"5e550000-0000-0000-0000-000000000022"}', false);
set role authenticated;
select t.eq('2초가 지나면 다시 logout 기록', public.log_logout(), '{"logged": true}');
reset role;
select t.eq('logout도 cf-connecting-ip(앞뒤 공백 제거)와 session_id를 남김',
  (select jsonb_build_array(ip, session_id) from public.login_logs where user_id = '22222222-2222-2222-2222-222222222222' and event = 'logout' order by id desc limit 1),
  '["203.0.113.50", "5e550000-0000-0000-0000-000000000022"]');
select set_config('request.headers', '', false);
select set_config('request.jwt.claims', '', false);

-- ---------- 길이 제한·JWT 대비·표시 아이디 ----------
-- 사용자 3은 앞의 트리거 검사에서 기록이 있으므로 15초 중복에 걸리지 않게 미룬다
update public.login_logs set occurred_at = occurred_at - interval '20 seconds' where user_id = '33333333-3333-3333-3333-333333333333';
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select set_config('request.headers', jsonb_build_object('user-agent', repeat('가', 600), 'cf-connecting-ip', repeat('9', 150))::text, false);
set role authenticated;
select t.eq('500자 넘는 헤더 UA로 log_login', public.log_login(repeat('나', 600)), '{"logged": true}');
reset role;
select t.eq('UA는 헤더 값을 500자로, IP는 100자로 자름',
  (select jsonb_build_array(char_length(user_agent), left(user_agent, 1), char_length(ip)) from public.login_logs
   where user_id = '33333333-3333-3333-3333-333333333333' order by id desc limit 1),
  '[500, "가", 100]');
select set_config('request.headers', '', false);

-- auth.users의 app_metadata.login_id가 user_metadata.login_id보다 먼저다(사용자가 user_metadata를 바꿔도 그대로)
update public.login_logs set occurred_at = occurred_at - interval '20 seconds' where user_id = '66666666-6666-6666-6666-666666666666';
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
set role authenticated;
select t.eq('app_metadata에 아이디가 있는 사용자 log_login', public.log_login(''), '{"logged": true}');
select t.eq('같은 사용자 log_logout', public.log_logout(), '{"logged": true}');
reset role;
select t.eq('log_login·log_logout 기록의 아이디 = app_metadata 값',
  (select jsonb_agg(login_id order by id) from public.login_logs where user_id = '66666666-6666-6666-6666-666666666666'),
  '["진짜이름", "진짜이름", "진짜이름"]');

-- auth.users에 없는 사용자는 JWT 클레임의 email·app_metadata.login_id·user_metadata.login_id 순으로 채운다
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select set_config('request.jwt.claims', '{"email":"jwt@sistech.local","user_metadata":{"login_id":"철수"}}', false);
set role authenticated;
select t.eq('auth.users에 없는 사용자도 log_login', public.log_login('UA5'), '{"logged": true}');
reset role;
select t.eq('JWT 클레임으로 email·login_id 채움(user_metadata)',
  (select jsonb_build_array(email, login_id) from public.login_logs where user_id = '55555555-5555-5555-5555-555555555555'),
  '["jwt@sistech.local", "철수"]');
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
select set_config('request.jwt.claims', '{"email":"jwt7@sistech.local","app_metadata":{"login_id":"앱아이디"},"user_metadata":{"login_id":"바꾼아이디"}}', false);
set role authenticated;
select t.eq('JWT의 app_metadata.login_id가 있는 사용자 log_login', public.log_login(''), '{"logged": true}');
reset role;
select t.eq('JWT 클레임도 app_metadata.login_id 먼저',
  (select jsonb_build_array(email, login_id) from public.login_logs where user_id = '77777777-7777-7777-7777-777777777777'),
  '["jwt7@sistech.local", "앱아이디"]');
select set_config('request.jwt.claims', '', false);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- ---------- 기록은 postgres(대시보드)로만 읽힌다 ----------
reset role;
select t.ok('postgres는 login_logs를 조회할 수 있음', (select count(*) from public.login_logs) > 0);
select t.ok('postgres 조회: 트리거 기록 내용',
  exists (select from public.login_logs where user_id = '11111111-1111-1111-1111-111111111111' and event = 'login'
    and email = 'xn--hong@sistech.local' and login_id = '홍길동' and user_agent = 'Mozilla/5.0 테스트' and ip = '198.51.100.9'));
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
select t.ok('authenticated: purge_login_logs 실행 거부', t.err('select public.purge_login_logs()') like '42501:%');
reset role;

-- ---------- anon·service_role은 막힌다 ----------
set role anon;
select t.ok('anon: login_logs select 거부', t.err('select * from public.login_logs') like '42501:%');
select t.ok('anon: log_login 거부', t.err($q$select public.log_login('x')$q$) like '42501:%');
select t.ok('anon: log_logout 거부', t.err('select public.log_logout()') like '42501:%');
select t.ok('anon: purge_login_logs 거부', t.err('select public.purge_login_logs()') like '42501:%');
reset role;
set role service_role;
select t.ok('service_role: purge_login_logs 거부', t.err('select public.purge_login_logs()') like '42501:%');
reset role;

-- 정책 없는 롤은 권한이 있어도 RLS로 0행
grant select on public.login_logs to rls_probe;
set role rls_probe;
select t.ok('정책 없는 롤은 login_logs도 RLS로 0행', (select count(*) from public.login_logs) = 0);
reset role;

-- ---------- 보존 정책: purge_login_logs ----------
insert into public.login_logs (user_id, event, occurred_at) values
  ('99999999-9999-9999-9999-999999999999', 'login', now() - interval '400 days'),
  ('99999999-9999-9999-9999-999999999999', 'logout', now() - interval '200 days');
create temp table logs_before as select count(*) as n from public.login_logs;
select t.eq('purge_login_logs() 기본 1년: 400일 된 기록 1건 지움', to_jsonb(public.purge_login_logs()), '1');
select t.eq('purge_login_logs(180일): 200일 된 기록 1건 지움', to_jsonb(public.purge_login_logs('180 days')), '1');
select t.ok('최근 기록은 남음', (select count(*) from public.login_logs) = (select n - 2 from logs_before));
select t.raises('보존 기간이 음수면 오류', $q$select public.purge_login_logs('-1 day')$q$, '보존 기간은 0 이상이어야 합니다.');
select t.raises('보존 기간 null이면 오류', 'select public.purge_login_logs(null)', '보존 기간은 0 이상이어야 합니다.');

-- ===================================================================
-- 관리자 지정(supabase/migrations/20261106170000_admin_role.sql)
-- shim이 김용문·손두병 행을 넣어 두었고, 마이그레이션이 김용문에게만 role=admin을 병합했어야 한다.
-- (뒤의 표시 아이디 복사 마이그레이션이 login_id도 넣는다)
-- ===================================================================
select t.eq('김용문은 app_metadata.role = admin(기존 provider 보존, login_id 복사됨)',
  (select raw_app_meta_data from auth.users where email = 'xn--4k0bz9vb1i@sistech.local'),
  '{"provider":"email","role":"admin","login_id":"김용문"}');
select t.ok('손두병은 role 없음',
  (select raw_app_meta_data ->> 'role' is null from auth.users where email = 'xn--hu1b84nd3d@sistech.local'));
select t.ok('role=admin은 김용문 한 명뿐',
  (select count(*) from auth.users where raw_app_meta_data ->> 'role' = 'admin') = 1);
-- 멱등: 같은 마이그레이션을 다시 실행해도 모든 행이 그대로다.
create temp table t_users_before as select id, email, raw_user_meta_data, raw_app_meta_data from auth.users;
\ir ../migrations/20261106170000_admin_role.sql
select t.ok('관리자 마이그레이션 재실행 → auth.users 변화 없음(멱등)',
  not exists (
    (select id, email, raw_user_meta_data, raw_app_meta_data from auth.users
     except select * from t_users_before)
    union all
    (select * from t_users_before
     except select id, email, raw_user_meta_data, raw_app_meta_data from auth.users)));
-- auth.users 권한이 없는 롤(rls_probe: auth 스키마 USAGE조차 없음)로 실행해도 오류로 멈추지 않아야 한다(배포가 멈추지 않게).
-- ON_ERROR_STOP이 켜져 있으므로 DO 블록이 오류를 삼키지 못하면 여기서 테스트 파일 전체가 중단된다.
set role rls_probe;
\ir ../migrations/20261106170000_admin_role.sql
reset role;
select t.ok('auth.users 권한 없는 롤로 재실행 → 오류 없이 지나가고 데이터도 그대로',
  (select count(*) from auth.users where raw_app_meta_data ->> 'role' = 'admin') = 1);

-- ===================================================================
-- 표시 아이디 복사(supabase/migrations/20261109130200_login_id_app_metadata.sql, 계약 C4)
-- ===================================================================
select t.eq('마이그레이션이 shim 계정의 login_id를 app_metadata로 복사(다른 키 보존)',
  (select jsonb_agg(jsonb_build_array(email, raw_app_meta_data) order by email) from auth.users
   where id in ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002')),
  '[["xn--4k0bz9vb1i@sistech.local", {"provider":"email","role":"admin","login_id":"김용문"}],
    ["xn--hu1b84nd3d@sistech.local", {"provider":"email","login_id":"손두병"}]]');
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('c4c40000-0000-0000-0000-000000000001', 'c4-copy@sistech.local', '{"login_id":"복사"}', null),
  ('c4c40000-0000-0000-0000-000000000002', 'c4-keep@sistech.local', '{"login_id":"바꾼이름"}', '{"login_id":"원래이름","provider":"email"}'),
  ('c4c40000-0000-0000-0000-000000000003', 'c4-none@sistech.local', '{}', '{"provider":"email"}'),
  ('c4c40000-0000-0000-0000-000000000004', 'c4-num@sistech.local', '{"login_id":123}', '{}'),
  ('c4c40000-0000-0000-0000-000000000005', 'c4-empty@sistech.local', '{"login_id":""}', '{"login_id":""}');
\ir ../migrations/20261109130200_login_id_app_metadata.sql
select t.eq('표시 아이디 복사 규칙: app_metadata가 null이어도 복사, 이미 있으면 덮지 않음, 없거나 문자열 아니거나 빈 값이면 그대로',
  (select jsonb_agg(jsonb_build_array(email, raw_app_meta_data) order by email) from auth.users where email like 'c4-%'),
  '[["c4-copy@sistech.local", {"login_id":"복사"}],
    ["c4-empty@sistech.local", {"login_id":""}],
    ["c4-keep@sistech.local", {"login_id":"원래이름","provider":"email"}],
    ["c4-none@sistech.local", {"provider":"email"}],
    ["c4-num@sistech.local", {}]]');
create temp table t_users_c4 as select id, raw_user_meta_data, raw_app_meta_data from auth.users;
\ir ../migrations/20261109130200_login_id_app_metadata.sql
select t.ok('표시 아이디 복사 재실행 → 변화 없음(멱등)',
  not exists (
    (select id, raw_user_meta_data, raw_app_meta_data from auth.users except select * from t_users_c4)
    union all
    (select * from t_users_c4 except select id, raw_user_meta_data, raw_app_meta_data from auth.users)));
-- auth 스키마 권한이 없는 롤로 실행해도 알림만 내고 지나가야 한다(ON_ERROR_STOP이라 못 삼키면 여기서 중단)
set role rls_probe;
\ir ../migrations/20261109130200_login_id_app_metadata.sql
reset role;
select t.ok('auth.users 권한 없는 롤로 표시 아이디 복사 재실행 → 오류 없이 지나감',
  not exists (select id, raw_user_meta_data, raw_app_meta_data from auth.users except select * from t_users_c4));

-- ---------- 결과 ----------
\o
\echo
\echo '실패한 항목:'
select n, name, detail from t.results where not pass order by n;
select count(*) filter (where pass) as "통과", count(*) filter (where not pass) as "실패" from t.results;
