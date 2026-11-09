-- 장소·미션 데이터의 보안·정합성 보강. 이미 적용된 마이그레이션은 고치지 않고 이 파일에서 바꾼다.
--   1) 표 직접 쓰기 차단: authenticated는 places·missions를 읽기(select)만 한다. 쓰기는 security definer RPC 넷
--      (import_places, save_mission, update_memo, delete_place)만 하고, 넷 다 로그인(auth.uid())이 없으면 거절한다.
--      select 권한·select 정책·Realtime 발행물은 그대로 둔다(화면이 두 표의 변경을 구독한다).
--   2) 트리거 방어: 미션 기록의 version은 트리거가 정한다(새 기록 1, 고칠 때마다 이전 값 + 1).
--      누가 어떤 경로로 쓰든(대시보드 포함) 장소의 미션명 범위에 없는 미션은 넣거나 고칠 수 없다.
--   3) 감사 로그: places·missions의 모든 행 변경을 public.audit_log에 남긴다(대시보드에서만 본다).
--      두 표에 updated_by(마지막으로 쓴 사용자)를 둔다.
--   4) 장소 삭제는 soft delete(계약 C3): deleted_at만 채우고 미션 기록은 남긴다. 같은 장소를 다시 가져오면 되살린다.
--   5) update_memo 메모 충돌 검사(계약 C1), 6) 부분 조회 get_places(계약 C2), 7) import_places 입력 검사 보강.
-- 함수는 create or replace로 바꾼다. 인자가 늘어나는 update_memo만 예전 2인자 함수를 지우고 3인자(마지막 인자 기본값 null)로 만든다.
-- security definer 함수는 search_path를 비우고(''), 본문의 모든 이름에 스키마를 붙인다(pg_catalog 내장 함수는 항상 먼저 찾는다).

-- ===================================================================
-- 칸 추가
-- ===================================================================

-- null이면 살아 있는 장소. 값이 있으면 지운 시각이다(행과 미션 기록은 남는다).
alter table public.places add column deleted_at timestamptz;
-- 마지막으로 쓴 사용자(auth.uid()). 대시보드처럼 로그인 없이 쓰면 null. 계정을 지워도 남기므로 외래 키를 걸지 않는다.
alter table public.places add column updated_by uuid;
alter table public.missions add column updated_by uuid;

-- ===================================================================
-- 감사 로그
-- ===================================================================

create table public.audit_log (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  actor   uuid default auth.uid(),           -- 쓴 사용자. 로그인 없이(대시보드·마이그레이션) 쓰면 null.
  tbl     text not null,                     -- 'places' 또는 'missions'
  op      text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  row_id  bigint,                            -- 바뀐 행의 id
  old_row jsonb,                             -- 바뀌기 전 행 전체(INSERT면 null)
  new_row jsonb                              -- 바뀐 뒤 행 전체(DELETE면 null)
);
create index audit_log_at on public.audit_log (at desc);
create index audit_log_row on public.audit_log (tbl, row_id, at desc);

-- RLS를 켜고 정책은 만들지 않는다. 권한도 주지 않으므로 anon·authenticated는 API로 읽지도 쓰지도 못한다.
-- 대시보드(Table Editor·SQL Editor)와 postgres 롤은 소유자라 그대로 본다. 행은 아래 definer 트리거만 넣는다.
alter table public.audit_log enable row level security;
revoke all on table public.audit_log from public, anon, authenticated;
revoke all on sequence public.audit_log_id_seq from public, anon, authenticated;
-- "새 테이블 자동 노출"이 켜진 프로젝트는 service_role에도 기본 권한을 준다. 감사 로그는 service_role 키로도 고치지 못하게 거둔다.
do $$
begin
  if exists (select from pg_catalog.pg_roles where rolname = 'service_role') then
    revoke all on table public.audit_log from service_role;
    revoke all on sequence public.audit_log_id_seq from service_role;
  end if;
end
$$;

-- 행 변경을 audit_log에 남긴다. security definer라 쓰는 롤이 audit_log 권한이 없어도 기록된다.
-- actor는 audit_log의 기본값 auth.uid()가 채운다(JWT 설정은 롤과 무관하게 읽힌다).
create function public.audit_log_on_change() returns trigger
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (tbl, op, row_id, new_row)
    values (tg_table_name, tg_op, new.id, pg_catalog.to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (tbl, op, row_id, old_row, new_row)
    values (tg_table_name, tg_op, new.id, pg_catalog.to_jsonb(old), pg_catalog.to_jsonb(new));
  else
    insert into public.audit_log (tbl, op, row_id, old_row)
    values (tg_table_name, tg_op, old.id, pg_catalog.to_jsonb(old));
  end if;
  return null;
end
$$;

create trigger places_audit
after insert or update or delete on public.places
for each row execute function public.audit_log_on_change();

create trigger missions_audit
after insert or update or delete on public.missions
for each row execute function public.audit_log_on_change();

-- ===================================================================
-- 쓰기 전 트리거
-- ===================================================================

-- 장소: 좌표를 7자리로 맞추고, 쓴 사용자를 남기고, 고칠 때 updated_at을 갱신한다.
create or replace function public.places_before_write() returns trigger
language plpgsql security invoker
set search_path = public
as $$
begin
  new.lat := public.round_coord(new.lat);
  new.lng := public.round_coord(new.lng);
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end
$$;

-- 미션 기록: 어떤 경로로 쓰든(RPC·대시보드·service_role) 지켜야 할 규칙.
--   - version은 트리거가 정한다. 새 기록은 1, 고칠 때마다 이전 값 + 1이고 넘겨준 값은 무시한다.
--     그래서 version을 올리지 않은 직접 UPDATE도 version이 올라, 화면이 들고 있던 오래된 version의 저장은 충돌로 걸린다.
--   - 장소의 미션명 범위(public.mission_names)에 없는 미션은 넣거나 고칠 수 없다(save_mission과 같은 문구).
--     범위가 줄어든 뒤 남은 예전 기록(범위 밖 기록)은 지우지 않고 그대로 두며, 범위가 다시 넓어지면 이어서 고칠 수 있다.
--     검사 뒤에 범위가 바뀌는 것은 막지 않는다. 그 결과는 위와 같은 "범위 밖 기록"이라 따로 잠그지 않는다.
--   - updated_by는 쓴 사용자(auth.uid()), updated_at은 고친 시각.
-- 예전 missions_before_update(updated_at만 갱신, UPDATE에만 걸림)는 이 트리거가 대신하므로 아래에서 지운다.
create function public.missions_before_write() returns trigger
language plpgsql security invoker
set search_path = public
as $$
declare
  v_range text;
begin
  select p.mission into v_range from public.places p where p.id = new.place_id;
  if not found then
    raise exception using message = '장소를 찾을 수 없습니다.', errcode = 'P0001';
  end if;
  if not coalesce(new.mission = any (public.mission_names(v_range)), false) then
    raise exception using message = '이 장소에 없는 미션입니다.', errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  new.updated_by := auth.uid();
  return new;
end
$$;

create trigger missions_before_write
before insert or update on public.missions
for each row execute function public.missions_before_write();

drop trigger missions_before_update on public.missions;
drop function public.missions_before_update();

-- ===================================================================
-- 접근 권한: authenticated는 두 표를 읽기만 한다
-- ===================================================================

-- 정책도 select만 남긴다. 지운 장소(deleted_at)를 정책으로 숨기지 않는 이유: 숨기면 soft delete(UPDATE)가
-- Realtime으로 다른 기기에 전달되지 않는다. 화면이 부르는 조회 함수(list_places, get_places)가 지운 장소를 뺀다.
drop policy if exists places_authenticated_all on public.places;
drop policy if exists missions_authenticated_all on public.missions;
create policy places_authenticated_select on public.places
  for select to authenticated using (true);
create policy missions_authenticated_select on public.missions
  for select to authenticated using (true);

-- "자동 노출" 설정이면 기본 권한으로 truncate·references·trigger까지 붙어 있으므로 모두 거둔 뒤 select만 준다.
revoke all on table public.places, public.missions from authenticated;
grant select on table public.places, public.missions to authenticated;
-- 행은 definer 함수(소유자 postgres)만 넣으므로 authenticated는 시퀀스가 필요 없다.
revoke all on sequence public.places_id_seq, public.missions_id_seq from authenticated;

-- ===================================================================
-- 조회 RPC (security invoker: 호출한 사용자의 권한과 RLS로 읽는다)
-- ===================================================================

-- 장소 전체(지운 장소 제외, id 순)와 장소마다 미션 기록(id 순). 기록이 없으면 missions는 [].
create or replace function public.list_places() returns jsonb
language sql stable security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(public.place_json(p, m.items) order by p.id), '[]'::jsonb)
  from public.places p
  left join (
    select place_id, jsonb_agg(public.mission_json(x) order by x.id) as items
    from public.missions x
    group by place_id
  ) m on m.place_id = p.id
  where p.deleted_at is null
$$;

-- 장소 일부를 번호로 읽는다(계약 C2). 원소 모양은 list_places 원소와 같고 id 순이다.
-- 지운 장소와 없는 번호는 결과에서 빠진다(화면은 빠진 번호를 지워진 장소로 보면 된다). 같은 번호가 여러 번 와도 한 번만.
-- 한 번에 500개까지(배열 원소 수 기준). p_ids가 null이면 [].
create function public.get_places(p_ids bigint[]) returns jsonb
language plpgsql stable security invoker
set search_path = public
as $$
begin
  if cardinality(p_ids) > 500 then
    raise exception using message = '한 번에 조회할 수 있는 장소는 500개까지입니다.', errcode = 'P0001';
  end if;
  return (
    select coalesce(jsonb_agg(public.place_json(p, (
             select jsonb_agg(public.mission_json(x) order by x.id) from public.missions x where x.place_id = p.id
           )) order by p.id), '[]'::jsonb)
    from public.places p
    where p.id = any (p_ids) and p.deleted_at is null
  );
end
$$;

-- ===================================================================
-- 쓰기 RPC (security definer: 표 쓰기 권한이 없는 authenticated 대신 소유자 권한으로 쓴다)
-- 넷 다 맨 앞에서 로그인을 확인한다. 실행 권한은 authenticated에만 있지만, 로그인 없이 그 롤로 오는 요청까지 막는다.
-- ===================================================================

-- CSV에서 읽은 장소를 한 트랜잭션으로 넣는다(함수 하나가 한 트랜잭션이라 중간에 실패하면 모두 되돌린다).
-- rows: [{line, name, district, address, phone, memo, mission, lat, lng, addressGiven}, ...]
--   line은 CSV 줄 번호(화면이 넣는다). 오류 문구는 line이 있으면 "N행", 없으면 "N번째 장소"로 시작한다.
-- 검사(파일 순서): 객체인지, 이름이 문자열이고 앞뒤 공백을 뗀 뒤 비어 있지 않은지, 좌표가 숫자이고 double로 바뀌는지, 범위 안인지.
-- 이름·시군·주소·미션명은 유니코드 NFC로 맞추고 앞뒤 공백(JS trim과 같은 집합)을 뗀 뒤 200자로 자른다.
-- 처리는 (이름, 위도, 경도) 순서로 한다. 여러 가져오기가 같은 장소들을 동시에 잠가도 잠그는 순서가 같아 교착되지 않는다.
-- 같은 장소가 두 줄이면 파일 순서대로 처리한다.
-- 이미 있는 장소(이름·7자리 좌표가 같음)는 건너뛰고 duplicates로 센다.
--   다만 CSV의 시군·주소·미션명이 비어 있지 않고 저장된 것과 다르면 그 칸만 CSV 값으로 바꾸고 updated로 센다(전화·메모·미션 기록은 그대로).
--   그중 미션명이 실제로 바뀐 장소는 missionChanged로 따로 센다. 미션 범위가 바뀌면 기록을 다시 봐야 하기 때문이다.
--   addressGiven이 false면(CSV에 주소 칸이 비어 있음) 주소는 바꾸지 않는다. 키가 없으면 주소가 주어진 것으로 본다.
-- 지운 장소(deleted_at)와 같은 장소면 되살린다: deleted_at을 비우고 위 갱신 규칙을 적용하며 imported로 센다.
--   옛 미션 기록·전화·메모는 그대로 둔다.
create or replace function public.import_places(rows jsonb) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  r jsonb;
  i int := 0;
  v_where text;
  v_name text;
  v_lat double precision;
  v_lng double precision;
  -- 검사를 통과해 정리한 값(파일 순서). 2단계에서 (이름, 위도, 경도) 순으로 처리한다.
  a_name text[] := '{}';
  a_district text[] := '{}';
  a_address text[] := '{}';
  a_given boolean[] := '{}';
  a_phone text[] := '{}';
  a_memo text[] := '{}';
  a_mission text[] := '{}';
  a_lat double precision[] := '{}';
  a_lng double precision[] := '{}';
  x record;
  v_csv_address text;
  v_id bigint;
  v_before text;
  v_deleted_at timestamptz;
  v_count int;
  v_imported int := 0;
  v_updated int := 0;
  v_mission_changed int := 0;
begin
  if auth.uid() is null then
    raise exception using message = '로그인이 필요합니다.', errcode = 'P0001';
  end if;
  if rows is null or jsonb_typeof(rows) <> 'array' then
    raise exception using message = '가져올 장소 목록이 잘못되었습니다.', errcode = 'P0001';
  end if;

  -- 1단계: 파일 순서대로 검사하고 값을 정리한다. 첫 오류에서 멈추고 아무것도 쓰지 않는다.
  for r in select value from jsonb_array_elements(rows) loop
    i := i + 1;
    v_where := case
      when jsonb_typeof(r -> 'line') = 'number' and (r ->> 'line') ~ '^[1-9][0-9]{0,8}$' then (r ->> 'line') || '행'
      else i || '번째 장소'
    end;
    if jsonb_typeof(r) <> 'object' then
      raise exception using message = format('%s의 형식이 잘못되었습니다.', v_where), errcode = 'P0001';
    end if;

    if coalesce(jsonb_typeof(r -> 'name'), 'null') = 'null' then
      raise exception using message = format('%s: 이름이 비어 있습니다.', v_where), errcode = 'P0001';
    end if;
    if jsonb_typeof(r -> 'name') <> 'string' then
      raise exception using message = format('%s: 이름은 문자열이어야 합니다.', v_where), errcode = 'P0001';
    end if;
    v_name := left(public.js_trim(normalize(r ->> 'name', NFC)), 200);
    if v_name = '' then
      raise exception using message = format('%s: 이름이 비어 있습니다.', v_where), errcode = 'P0001';
    end if;

    if coalesce(jsonb_typeof(r -> 'lat'), '') <> 'number' or coalesce(jsonb_typeof(r -> 'lng'), '') <> 'number' then
      raise exception using message = format('%s: 좌표가 숫자가 아닙니다.', v_where), errcode = 'P0001';
    end if;
    -- JSON 숫자는 자릿수 제한이 없어 1e400처럼 double을 넘는 값이 올 수 있다(0에 너무 가까운 1e-400도 같은 오류).
    begin
      v_lat := public.round_coord((r ->> 'lat')::double precision);
      v_lng := public.round_coord((r ->> 'lng')::double precision);
    exception when numeric_value_out_of_range or invalid_text_representation then
      raise exception using message = format('%s: 좌표 범위를 벗어났습니다.', v_where), errcode = 'P0001';
    end;
    if abs(v_lat) > 90 or abs(v_lng) > 180 then
      raise exception using
        message = format('%s: 좌표 범위를 벗어났습니다. (위도: %s, 경도: %s)', v_where, v_lat, v_lng),
        errcode = 'P0001';
    end if;

    a_name := array_append(a_name, v_name);
    a_district := array_append(a_district, left(public.js_trim(normalize(coalesce(r ->> 'district', ''), NFC)), 200));
    a_address := array_append(a_address, left(public.js_trim(normalize(coalesce(r ->> 'address', ''), NFC)), 200));
    a_given := array_append(a_given, (r -> 'addressGiven') is distinct from 'false'::jsonb);
    a_phone := array_append(a_phone, left(coalesce(r ->> 'phone', ''), 200));
    a_memo := array_append(a_memo, left(coalesce(r ->> 'memo', ''), 2000));
    a_mission := array_append(a_mission, left(public.js_trim(normalize(coalesce(r ->> 'mission', ''), NFC)), 200));
    a_lat := array_append(a_lat, v_lat);
    a_lng := array_append(a_lng, v_lng);
  end loop;

  -- 2단계: (이름, 위도, 경도) 순으로 넣거나 고친다. 이름은 바이트 순서("C")로 비교해 어느 세션에서나 순서가 같다.
  for x in
    select u.*
    from unnest(a_name, a_district, a_address, a_given, a_phone, a_memo, a_mission, a_lat, a_lng)
      with ordinality as u (name, district, address, address_given, phone, memo, mission, lat, lng, k)
    order by u.name collate "C", u.lat, u.lng, u.k
  loop
    insert into public.places (name, district, address, phone, memo, mission, lat, lng)
    values (x.name, x.district, x.address, x.phone, x.memo, x.mission, x.lat, x.lng)
    on conflict (name, lat, lng) do nothing;
    get diagnostics v_count = row_count;
    if v_count > 0 then
      v_imported := v_imported + 1;
      continue;
    end if;

    -- 이미 있는 장소(지운 장소 포함)를 잠그고 읽는다. 그 사이 누가 대시보드에서 아예 지웠으면 중복으로 센다.
    select p.id, p.mission, p.deleted_at into v_id, v_before, v_deleted_at
    from public.places p
    where p.name = x.name and p.lat = x.lat and p.lng = x.lng
    for no key update;
    if not found then
      continue;
    end if;

    -- CSV 칸이 비어 있으면 저장된 값을 지우지 않는다. 바뀐 것이 있거나 되살릴 때만 고친다.
    v_csv_address := case when x.address_given then x.address else '' end;
    update public.places p set
      district = case when x.district = '' then p.district else x.district end,
      address = case when v_csv_address = '' then p.address else v_csv_address end,
      mission = case when x.mission = '' then p.mission else x.mission end,
      deleted_at = null
    where p.id = v_id
      and (
        v_deleted_at is not null
        or (x.district <> '' and p.district <> x.district)
        or (v_csv_address <> '' and p.address <> v_csv_address)
        or (x.mission <> '' and p.mission <> x.mission)
      );
    get diagnostics v_count = row_count;
    if v_deleted_at is not null then
      v_imported := v_imported + 1;
    elsif v_count > 0 then
      v_updated := v_updated + 1;
      if x.mission <> '' and x.mission is distinct from v_before then
        v_mission_changed := v_mission_changed + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'imported', v_imported,
    'duplicates', i - v_imported,
    'updated', v_updated,
    'missionChanged', v_mission_changed
  );
end
$$;

-- 미션 기록 하나를 저장한다. 기록이 없으면 만들고(version 1), 있으면 p_fields에 들어온 칸만 바꾼다(version은 트리거가 1 올림).
-- p_fields: {done: boolean, worker, flightTime, batteryNo, batteryLeft: 문자열} 중 일부. 다른 키는 무시한다.
-- p_base_version: 화면이 마지막으로 본 기록의 version(기록이 없었으면 null). 그 사이 다른 기기가 고쳤으면 덮지 않고
--   {"status":"conflict","record": 최신 기록 또는 null}을 돌려준다(예외가 아니다). 저장되면 {"status":"ok","record": 기록}.
-- 검사 순서: 로그인 → 장소 없음(지운 장소 포함) → 없는 미션 → 형식 → 버전 충돌 → 남은 용량·완료 조건
create or replace function public.save_mission(p_place_id bigint, p_mission text, p_fields jsonb, p_base_version integer)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_place public.places;
  v_existing public.missions;
  v_found boolean;
  v_row public.missions;
  v_done boolean;
  v_worker text;
  v_flight_time text;
  v_battery_no text;
  v_battery_left text;
  v_any boolean := false;
  v_key text;
  v_label text;
  v_text text;
begin
  if auth.uid() is null then
    raise exception using message = '로그인이 필요합니다.', errcode = 'P0001';
  end if;

  -- 장소 행을 잠가 같은 장소의 미션 저장을 줄 세운다. 두 기기가 같은 기록을 동시에 고치면
  -- 뒤에 온 쪽은 앞 저장이 끝날 때까지 기다렸다가 바뀐 version을 보고 충돌로 판정된다.
  -- 기다리는 사이 장소가 지워지면(deleted_at) 잠금이 풀린 뒤 조건을 다시 보므로 "장소를 찾을 수 없습니다"가 된다.
  select * into v_place from public.places where id = p_place_id and deleted_at is null for no key update;
  if not found then
    raise exception using message = '장소를 찾을 수 없습니다.', errcode = 'P0001';
  end if;
  if p_mission is null or not (p_mission = any (public.mission_names(v_place.mission))) then
    raise exception using message = '이 장소에 없는 미션입니다.', errcode = 'P0001';
  end if;

  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception using message = '잘못된 요청 본문입니다.', errcode = 'P0001';
  end if;
  if p_fields ? 'done' then
    if jsonb_typeof(p_fields -> 'done') <> 'boolean' then
      raise exception using message = '완료 여부는 true/false여야 합니다.', errcode = 'P0001';
    end if;
    v_done := (p_fields ->> 'done')::boolean;
    v_any := true;
  end if;
  for v_key, v_label in
    select * from (values ('worker', '이름'), ('flightTime', '비행시간'), ('batteryNo', '배터리 번호'), ('batteryLeft', '배터리 남은 용량')) as f (k, l)
  loop
    continue when not (p_fields ? v_key);
    if jsonb_typeof(p_fields -> v_key) <> 'string' then
      raise exception using message = format('%s은(는) 문자열이어야 합니다.', v_label), errcode = 'P0001';
    end if;
    v_text := public.clean_text(p_fields ->> v_key);
    case v_key
      when 'worker' then v_worker := v_text;
      when 'flightTime' then v_flight_time := v_text;
      when 'batteryNo' then v_battery_no := v_text;
      else v_battery_left := v_text;
    end case;
    v_any := true;
  end loop;
  -- 빈 기록을 만들기만 하는 요청은 쓸모가 없고, 다른 기기의 버전만 올려 충돌을 일으킨다.
  if not v_any then
    raise exception using message = '바꿀 내용이 없습니다.', errcode = 'P0001';
  end if;

  select * into v_existing from public.missions where place_id = p_place_id and mission = p_mission;
  v_found := found;
  if (not v_found and p_base_version is not null) or (v_found and p_base_version is distinct from v_existing.version) then
    return jsonb_build_object('status', 'conflict', 'record', case when v_found then public.mission_json(v_existing) end);
  end if;

  -- 남은 용량은 % 없이 0~100 숫자 문자열로 저장한다. "45%"·"045" → "45", 빈 칸은 그대로 둔다.
  if v_battery_left is not null then
    v_battery_left := public.js_trim(regexp_replace(v_battery_left, '%$', ''));
    if v_battery_left <> '' then
      if v_battery_left !~ '^[0-9]{1,3}$' or v_battery_left::int > 100 then
        raise exception using message = '마지막 배터리 남은 용량은 0~100 사이 숫자만 적어 주세요.', errcode = 'P0001';
      end if;
      v_battery_left := v_battery_left::int::text;
    end if;
  end if;
  v_worker := left(v_worker, 200);
  v_flight_time := left(v_flight_time, 200);
  v_battery_no := left(v_battery_no, 200);

  -- 일부 칸만 올 수 있으므로 저장된 기록과 합친 결과로 완료 조건을 본다. 어기면 아무것도 쓰지 않는다.
  v_done := coalesce(v_done, v_existing.done, false);
  v_worker := coalesce(v_worker, v_existing.worker, '');
  v_flight_time := coalesce(v_flight_time, v_existing.flight_time, '');
  v_battery_no := coalesce(v_battery_no, v_existing.battery_no, '');
  v_battery_left := coalesce(v_battery_left, v_existing.battery_left, '');
  if v_done and (public.js_trim(v_worker) = '' or public.js_trim(v_flight_time) = ''
                 or public.js_trim(v_battery_no) = '' or public.js_trim(v_battery_left) = '') then
    raise exception using
      message = '완료로 저장하려면 이름, 비행시간, 사용한 배터리 번호, 마지막 배터리 남은 용량을 모두 적어야 합니다.',
      errcode = 'P0001';
  end if;

  -- 장소 잠금을 거치지 않고 표에 바로 쓴 경우(대시보드)까지 막도록 덮어쓸 때도 version을 한 번 더 확인한다.
  -- version·updated_at·updated_by는 트리거(missions_before_write)가 채운다.
  insert into public.missions as m (place_id, mission, done, worker, flight_time, battery_no, battery_left)
  values (p_place_id, p_mission, v_done, v_worker, v_flight_time, v_battery_no, v_battery_left)
  on conflict (place_id, mission) do update set
    done = excluded.done,
    worker = excluded.worker,
    flight_time = excluded.flight_time,
    battery_no = excluded.battery_no,
    battery_left = excluded.battery_left
  where m.version = p_base_version
  returning * into v_row;
  if not found then
    select * into v_existing from public.missions where place_id = p_place_id and mission = p_mission;
    return jsonb_build_object('status', 'conflict', 'record', case when found then public.mission_json(v_existing) end);
  end if;
  return jsonb_build_object('status', 'ok', 'record', public.mission_json(v_row));
end
$$;

-- 메모를 바꾼다(계약 C1). 메모는 여러 줄을 쓸 수 있어 줄바꿈은 그대로 두고 2000자로 자른다.
-- p_base_memo: 화면이 마지막으로 본 메모. 저장된 메모가 그와 다르면(그 사이 다른 기기가 고침) 덮지 않고
--   {"status":"conflict","place": 지금 장소}를 돌려준다(예외가 아니다). 저장되면 {"status":"ok","place": 바뀐 장소}.
--   다만 저장된 메모가 이미 새 메모와 같으면(같은 요청을 다시 보냄) 잃을 것이 없으므로 ok로 저장한다.
--   null(기본값)이면 조건 없이 저장한다. 예전 2인자 호출 update_memo(p_place_id, p_memo)도 그대로 동작한다.
-- place는 list_places 원소 하나와 같은 모양이다. 장소가 없거나 지워졌으면 오류.
drop function public.update_memo(bigint, text);
create function public.update_memo(p_place_id bigint, p_memo text, p_base_memo text default null) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_place public.places;
  v_memo text;
begin
  if auth.uid() is null then
    raise exception using message = '로그인이 필요합니다.', errcode = 'P0001';
  end if;
  if p_memo is null then
    raise exception using message = '메모는 문자열이어야 합니다.', errcode = 'P0001';
  end if;
  v_memo := left(p_memo, 2000);

  -- 행을 잠그고 읽어 비교와 저장 사이에 다른 저장이 끼지 못하게 한다(동시 저장은 줄 서서 뒤엣것이 충돌로 걸린다).
  select * into v_place from public.places where id = p_place_id and deleted_at is null for no key update;
  if not found then
    raise exception using message = '장소를 찾을 수 없습니다.', errcode = 'P0001';
  end if;
  if p_base_memo is not null and v_place.memo <> p_base_memo and v_place.memo <> v_memo then
    return jsonb_build_object('status', 'conflict', 'place', public.place_json(
      v_place,
      (select jsonb_agg(public.mission_json(x) order by x.id) from public.missions x where x.place_id = p_place_id)));
  end if;

  update public.places set memo = v_memo where id = p_place_id
  returning * into v_place;
  return jsonb_build_object('status', 'ok', 'place', public.place_json(
    v_place,
    (select jsonb_agg(public.mission_json(x) order by x.id) from public.missions x where x.place_id = p_place_id)));
end
$$;

-- 장소를 지운다(soft delete, 계약 C3). deleted_at만 채우고 행과 미션 기록은 남긴다.
-- 지웠으면 true, 없거나 이미 지운 장소면 false. 같은 장소를 다시 가져오면(import_places) 되살아난다.
create or replace function public.delete_place(p_place_id bigint) returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using message = '로그인이 필요합니다.', errcode = 'P0001';
  end if;
  update public.places set deleted_at = now() where id = p_place_id and deleted_at is null;
  return found;
end
$$;

-- ===================================================================
-- 함수 실행 권한
-- create or replace는 기존 권한을 그대로 두지만, 의도를 분명히 하려고 RPC 권한을 다시 적는다.
-- 새로 만든 함수는 "자동 노출" 설정이면 anon에게도 기본 권한이 붙으므로 반드시 거둔다.
-- 트리거 함수는 직접 부를 일이 없어 아무에게도 주지 않는다(트리거로 실행될 때는 실행 권한을 보지 않는다).
-- ===================================================================
revoke all on function
  public.list_places(),
  public.get_places(bigint[]),
  public.import_places(jsonb),
  public.save_mission(bigint, text, jsonb, integer),
  public.update_memo(bigint, text, text),
  public.delete_place(bigint),
  public.places_before_write(),
  public.missions_before_write(),
  public.audit_log_on_change()
from public, anon;
revoke all on function
  public.places_before_write(),
  public.missions_before_write(),
  public.audit_log_on_change()
from authenticated;

grant execute on function
  public.list_places(),
  public.get_places(bigint[]),
  public.import_places(jsonb),
  public.save_mission(bigint, text, jsonb, integer),
  public.update_memo(bigint, text, text),
  public.delete_place(bigint)
to authenticated;

-- PostgREST가 바뀐 함수 목록(update_memo 인자, get_places)을 바로 쓰도록 스키마 캐시를 다시 읽게 한다.
notify pgrst, 'reload schema';
