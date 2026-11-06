-- HOME POINT NAVI(홈포인트 네비): 장소·미션 기록 테이블, 접근 권한(RLS), 화면이 부르는 RPC 함수.
-- 예전 Express + node:sqlite 서버(server/db.js, server/app.js)의 저장 규칙과 오류 문구를 그대로 옮겼다.
-- 화면에 보여 줄 오류는 errcode P0001과 한국어 message로 올린다(PostgREST가 message를 그대로 내려준다).

-- ===================================================================
-- 글자 다루기 도우미
-- ===================================================================

-- JavaScript의 String.prototype.trim()과 같은 공백 집합으로 앞뒤를 뗀다.
-- (탭·줄바꿈·VT·FF·CR·스페이스·NBSP·U+1680·U+2000~200A·U+2028·U+2029·U+202F·U+205F·U+3000·BOM)
create function public.js_trim(s text) returns text
language sql immutable parallel safe security invoker
set search_path = public
as $$
  select btrim(s, E'\t\n\u000B\f\r                  　﻿')
$$;

-- 서버의 cleanText: 줄바꿈·탭은 표에서 칸을 깨뜨리므로 공백 하나로 바꾸고 앞뒤 공백을 지운다.
create function public.clean_text(s text) returns text
language sql immutable parallel safe security invoker
set search_path = public
as $$
  select public.js_trim(regexp_replace(s, E'[\r\n\t]+', ' ', 'g'))
$$;

-- 좌표는 소수점 7자리(약 1cm)로 맞춰 저장해서 중복 판정이 부동소수 오차에 흔들리지 않게 한다(서버의 roundCoord).
create function public.round_coord(x double precision) returns double precision
language sql immutable parallel safe security invoker
set search_path = public
as $$
  select round(x::numeric, 7)::double precision
$$;

-- 시각은 UTC ISO 8601 문자열(예: 2026-11-06T03:04:05.678Z)로 내려준다. 세션 시간대에 따라 모양이 바뀌지 않게 직접 만든다.
create function public.iso_time(t timestamptz) returns text
language sql stable parallel safe security invoker
set search_path = public
as $$
  select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- 미션명 풀이(public/mission.js의 missionNames와 같은 결과).
-- 미션명 "Q1_A_TA_SW__01_01 ~ _34"는 Q1_A_TA_SW__01_01부터 Q1_A_TA_SW__01_34까지 34개 미션이다.
-- 물결 앞 이름의 맨 뒤 번호가 첫 미션, 미션명 맨 끝 숫자가 마지막 미션이고, 번호는 첫 미션의 자릿수(01)에 맞춘다.
-- 범위가 아니거나, 끝이 시작보다 작거나, 500개 이상이면(오타로 본다) 미션명 하나로 본다.
--
-- JS 정규식 /^(.*?)(\d+)\s*[~～〜]\s*.*?(\d+)\s*$/ 를 그대로 쓰면 Postgres 정규식의 탐욕/게으름 규칙이 달라
-- 나뉘는 자리가 어긋날 수 있어서, 같은 매칭을 한 글자씩 따라간다.
--   \d  = ASCII 0~9만, \s = js_trim과 같은 공백 집합, .  = 줄 끝 문자(\n \r U+2028 U+2029)를 뺀 아무 글자
create function public.mission_names(raw text) returns text[]
language plpgsql immutable parallel safe security invoker
set search_path = public
as $$
declare
  ws constant text := E'\t\n\u000B\f\r                  　﻿';
  line_end constant text := E'\n\r  ';
  tildes constant text := E'~～〜';
  t text := public.js_trim(coalesce(raw, ''));
  c text[];
  n int;
  p int;          -- 첫 번호가 시작하는 자리
  e int;          -- 첫 번호가 끝나는 자리
  q int;          -- 물결 자리
  w int;          -- 물결 뒤 공백을 지난 자리
  d int;          -- 마지막 번호가 시작하는 자리
  f int;          -- 문자열 끝에 붙은 숫자 묶음이 시작하는 자리
  k int;
  matched boolean := false;
  ok boolean;
  prefix text;
  first_digits text;
  last_digits text;
  v_first numeric;
  v_last numeric;
  num text;
  result text[] := '{}';
begin
  if t = '' then
    return '{}';
  end if;
  c := regexp_split_to_array(t, '');
  n := array_length(c, 1);

  -- 앞뒤 공백을 뗐으므로 끝의 \s*는 빈 문자열이고, 맨 끝 글자는 숫자여야 한다.
  if not (ascii(c[n]) between 48 and 57) then
    return array[t];
  end if;
  f := n;
  while f > 1 and ascii(c[f - 1]) between 48 and 57 loop
    f := f - 1;
  end loop;

  -- (.*?)가 게으르므로 앞에서부터 첫 번호 자리를 하나씩 해 본다. 앞부분에 줄 끝 문자가 끼면 더 볼 것이 없다.
  -- (FOR p IN 1..n은 루프 안에서만 쓰는 새 변수를 만들어 끝난 뒤 p가 남지 않으므로 LOOP로 돈다.)
  p := 0;
  loop
    p := p + 1;
    exit when p > n;
    exit when p > 1 and position(c[p - 1] in line_end) > 0;
    continue when not (ascii(c[p]) between 48 and 57);
    -- (\d+)는 숫자 묶음 전체여야 한다(짧게 끊으면 다음 글자가 숫자라 \s*[~]에 맞지 않는다).
    e := p;
    while e < n and ascii(c[e + 1]) between 48 and 57 loop
      e := e + 1;
    end loop;
    q := e + 1;
    while q <= n and position(c[q] in ws) > 0 loop
      q := q + 1;
    end loop;
    continue when q >= n or position(c[q] in tildes) = 0;
    -- 마지막 번호는 물결 뒤에서 문자열 끝까지 이어지는 숫자 묶음이다.
    d := greatest(f, q + 1);
    w := q + 1;
    while w < d and position(c[w] in ws) > 0 loop
      w := w + 1;
    end loop;
    -- 물결 뒤 공백과 마지막 번호 사이(.*?)에는 줄 끝 문자가 올 수 없다.
    ok := true;
    for k in w..d - 1 loop
      if position(c[k] in line_end) > 0 then
        ok := false;
        exit;
      end if;
    end loop;
    if ok then
      matched := true;
      exit;
    end if;
  end loop;

  if not matched then
    return array[t];
  end if;

  prefix := array_to_string(c[1:p - 1], '');
  first_digits := array_to_string(c[p:e], '');
  last_digits := array_to_string(c[d:n], '');
  v_first := first_digits::numeric;
  v_last := last_digits::numeric;
  if v_last < v_first or v_last - v_first >= 500 then
    return array[t];
  end if;
  for k in 0..(v_last - v_first)::int loop
    num := (v_first + k)::text;
    -- padStart와 같게, 이미 자릿수가 넉넉하면 자르지 않는다(lpad는 자른다).
    if length(num) < length(first_digits) then
      num := lpad(num, length(first_digits), '0');
    end if;
    result := result || (prefix || num);
  end loop;
  return result;
end
$$;

-- ===================================================================
-- 테이블
-- ===================================================================

create table public.places (
  id         bigint generated by default as identity primary key,
  name       text not null check (char_length(name) between 1 and 200),
  district   text not null default '' check (char_length(district) <= 200), -- 시군(목록을 시군별로 묶는 데 쓴다). 주소에는 넣지 않는다.
  address    text not null default '' check (char_length(address) <= 200),
  phone      text not null default '' check (char_length(phone) <= 200),
  memo       text not null default '' check (char_length(memo) <= 2000),
  mission    text not null default '' check (char_length(mission) <= 200), -- 미션명(범위 표기 가능). mission_names로 펼친다.
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 같은 이름·같은 좌표는 한 번만 저장한다. 같은 CSV를 두 번 올려도 중복되지 않는다.
  constraint places_name_coord unique (name, lat, lng)
);
-- 색 칸은 두지 않는다. 표시 색은 미션 진행 상태로 화면이 정한다.

-- 미션별 진행 기록. 처음 손댈 때 만들어지고, 장소를 지우면 함께 지워진다.
create table public.missions (
  id           bigint generated by default as identity primary key,
  place_id     bigint not null references public.places (id) on delete cascade,
  mission      text not null check (char_length(mission) between 1 and 200),
  done         boolean not null default false,
  worker       text not null default '' check (char_length(worker) <= 200),
  flight_time  text not null default '' check (char_length(flight_time) <= 200),
  battery_no   text not null default '' check (char_length(battery_no) <= 200),
  -- 남은 용량은 % 없이 0~100 숫자 문자열(앞자리 0 없음)이거나 빈 칸이다.
  battery_left text not null default '' check (battery_left ~ '^(100|[1-9]?[0-9])?$'),
  -- 고칠 때마다 1씩 오른다. 두 기기가 같은 기록을 고칠 때 나중 저장이 앞 저장을 모르고 덮는 것을 막는다.
  version      integer not null default 1 check (version >= 1),
  updated_at   timestamptz not null default now(),
  constraint missions_place_mission unique (place_id, mission),
  -- 완료로 저장하려면 이름·비행시간·배터리 번호·남은 용량이 모두 채워져 있어야 한다(공백만 있는 것도 빈 칸으로 본다).
  constraint missions_done_requires_fields check (
    not done or (
      btrim(worker, E'\t\n\u000B\f\r                  　﻿') <> ''
      and btrim(flight_time, E'\t\n\u000B\f\r                  　﻿') <> ''
      and btrim(battery_no, E'\t\n\u000B\f\r                  　﻿') <> ''
      and battery_left <> ''
    )
  )
);
-- (place_id, mission) 유일 인덱스가 place_id로 찾는 조회와 장소 삭제 시 연쇄 삭제에도 쓰인다.

-- 장소: 좌표를 7자리로 맞추고, 고칠 때 updated_at을 갱신한다.
create function public.places_before_write() returns trigger
language plpgsql security invoker
set search_path = public
as $$
begin
  new.lat := public.round_coord(new.lat);
  new.lng := public.round_coord(new.lng);
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end
$$;

create trigger places_before_write
before insert or update on public.places
for each row execute function public.places_before_write();

-- 미션 기록: 고칠 때 updated_at을 갱신한다.
create function public.missions_before_update() returns trigger
language plpgsql security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger missions_before_update
before update on public.missions
for each row execute function public.missions_before_update();

-- ===================================================================
-- 접근 권한: 로그인한 사용자(authenticated)만 모든 것을 할 수 있고, anon은 아무것도 못 한다.
-- 프로젝트가 새 테이블·함수를 API 롤에 자동으로 열지 않는 설정이어도 동작하도록 필요한 권한은 모두 명시적으로 준다.
-- 반대로 자동으로 여는 설정이어도 anon에게 붙은 권한은 아래에서 거둔다.
-- RLS를 자동으로 켜는 설정이 있어도 여기서 직접 켠다.
-- ===================================================================

alter table public.places enable row level security;
alter table public.missions enable row level security;

create policy places_authenticated_all on public.places
  for all to authenticated using (true) with check (true);
create policy missions_authenticated_all on public.missions
  for all to authenticated using (true) with check (true);

-- 프로젝트를 "Automatically expose new tables" 꺼짐으로 만들면 기본 권한이 없으므로 스키마 사용 권한부터 명시한다.
grant usage on schema public to authenticated;
revoke all on table public.places, public.missions from public, anon;
revoke all on sequence public.places_id_seq, public.missions_id_seq from public, anon;
grant select, insert, update, delete on table public.places, public.missions to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ===================================================================
-- JSON 모양 도우미(화면이 쓰는 camelCase)
-- ===================================================================

create function public.mission_json(m public.missions) returns jsonb
language sql stable parallel safe security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'mission', m.mission,
    'done', m.done,
    'worker', m.worker,
    'flightTime', m.flight_time,
    'batteryNo', m.battery_no,
    'batteryLeft', m.battery_left,
    'version', m.version,
    'updatedAt', public.iso_time(m.updated_at)
  )
$$;

-- p_missions는 그 장소의 mission_json 배열(id 순).
create function public.place_json(p public.places, p_missions jsonb) returns jsonb
language sql stable parallel safe security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'district', p.district,
    'address', p.address,
    'phone', p.phone,
    'memo', p.memo,
    'mission', p.mission,
    'lat', p.lat,
    'lng', p.lng,
    'createdAt', public.iso_time(p.created_at),
    'updatedAt', public.iso_time(p.updated_at),
    'missions', coalesce(p_missions, '[]'::jsonb)
  )
$$;

-- ===================================================================
-- RPC 함수
-- ===================================================================

-- 장소 전체(id 순)와 장소마다 미션 기록(id 순). 기록이 없으면 missions는 [].
-- 장소마다 따로 조회하지 않고 미션 기록을 한 번에 읽어 장소별로 묶는다.
create function public.list_places() returns jsonb
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
$$;

-- CSV에서 읽은 장소를 한 트랜잭션으로 넣는다(함수 하나가 한 트랜잭션이라 중간에 실패하면 모두 되돌린다).
-- rows: [{name, district, address, phone, memo, mission, lat, lng, addressGiven}, ...]
-- 이미 있는 장소(이름·7자리 좌표가 같음)는 건너뛰고 duplicates로 센다.
-- 다만 CSV의 시군·주소·미션명이 비어 있지 않고 저장된 것과 다르면 그 칸만 CSV 값으로 바꾸고 updated로 센다(전화·메모·미션 기록은 그대로).
-- 그중 미션명이 실제로 바뀐 장소는 missionChanged로 따로 센다. 미션 범위가 바뀌면 기록을 다시 봐야 하기 때문이다.
-- addressGiven이 false면(CSV에 주소 칸이 비어 있음) 주소는 바꾸지 않는다. 키가 없으면 주소가 주어진 것으로 본다.
create function public.import_places(rows jsonb) returns jsonb
language plpgsql volatile security invoker
set search_path = public
as $$
declare
  r jsonb;
  i int := 0;
  v_name text;
  v_district text;
  v_address text;
  v_csv_address text;
  v_mission text;
  v_lat double precision;
  v_lng double precision;
  v_before text;
  v_count int;
  v_imported int := 0;
  v_updated int := 0;
  v_mission_changed int := 0;
begin
  if rows is null or jsonb_typeof(rows) <> 'array' then
    raise exception using message = '가져올 장소 목록이 잘못되었습니다.', errcode = 'P0001';
  end if;

  for r in select value from jsonb_array_elements(rows) loop
    i := i + 1;
    if jsonb_typeof(r) <> 'object' then
      raise exception using message = format('%s번째 장소의 형식이 잘못되었습니다.', i), errcode = 'P0001';
    end if;
    v_name := left(coalesce(r ->> 'name', ''), 200);
    if v_name = '' then
      raise exception using message = format('%s번째 장소: 이름이 비어 있습니다.', i), errcode = 'P0001';
    end if;
    if coalesce(jsonb_typeof(r -> 'lat'), '') <> 'number' or coalesce(jsonb_typeof(r -> 'lng'), '') <> 'number' then
      raise exception using message = format('%s번째 장소: 좌표가 숫자가 아닙니다.', i), errcode = 'P0001';
    end if;
    v_lat := public.round_coord((r ->> 'lat')::double precision);
    v_lng := public.round_coord((r ->> 'lng')::double precision);
    if abs(v_lat) > 90 or abs(v_lng) > 180 then
      raise exception using message = format('%s번째 장소: 좌표 범위를 벗어났습니다. (위도: %s, 경도: %s)', i, v_lat, v_lng), errcode = 'P0001';
    end if;
    v_district := left(coalesce(r ->> 'district', ''), 200);
    v_address := left(coalesce(r ->> 'address', ''), 200);
    v_mission := left(coalesce(r ->> 'mission', ''), 200);

    insert into public.places (name, district, address, phone, memo, mission, lat, lng)
    values (
      v_name, v_district, v_address,
      left(coalesce(r ->> 'phone', ''), 200),
      left(coalesce(r ->> 'memo', ''), 2000),
      v_mission, v_lat, v_lng
    )
    on conflict (name, lat, lng) do nothing;
    get diagnostics v_count = row_count;
    if v_count > 0 then
      v_imported := v_imported + 1;
      continue;
    end if;

    v_csv_address := case when r -> 'addressGiven' = 'false'::jsonb then '' else v_address end;
    select p.mission into v_before
    from public.places p
    where p.name = v_name and p.lat = v_lat and p.lng = v_lng;

    -- CSV 칸이 비어 있으면 저장된 값을 지우지 않는다. 바뀐 것이 있을 때만 고친다.
    update public.places p set
      district = case when v_district = '' then p.district else v_district end,
      address = case when v_csv_address = '' then p.address else v_csv_address end,
      mission = case when v_mission = '' then p.mission else v_mission end
    where p.name = v_name and p.lat = v_lat and p.lng = v_lng
      and (
        (v_district <> '' and p.district <> v_district)
        or (v_csv_address <> '' and p.address <> v_csv_address)
        or (v_mission <> '' and p.mission <> v_mission)
      );
    get diagnostics v_count = row_count;
    if v_count > 0 then
      v_updated := v_updated + 1;
      if v_mission <> '' and v_mission is distinct from v_before then
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

-- 미션 기록 하나를 저장한다. 기록이 없으면 만들고(version 1), 있으면 p_fields에 들어온 칸만 바꾸고 version을 올린다.
-- p_fields: {done: boolean, worker, flightTime, batteryNo, batteryLeft: 문자열} 중 일부. 다른 키는 무시한다.
-- p_base_version: 화면이 마지막으로 본 기록의 version(기록이 없었으면 null). 그 사이 다른 기기가 고쳤으면 덮지 않고
--   {"status":"conflict","record": 최신 기록 또는 null}을 돌려준다(예외가 아니다). 저장되면 {"status":"ok","record": 기록}.
-- 검사 순서(서버와 같음): 장소 없음 → 없는 미션 → 형식 → 버전 충돌 → 남은 용량·완료 조건
create function public.save_mission(p_place_id bigint, p_mission text, p_fields jsonb, p_base_version integer)
returns jsonb
language plpgsql volatile security invoker
set search_path = public
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
  -- 장소 행을 잠가 같은 장소의 미션 저장을 줄 세운다. 두 기기가 같은 기록을 동시에 고치면
  -- 뒤에 온 쪽은 앞 저장이 끝날 때까지 기다렸다가 바뀐 version을 보고 충돌로 판정된다.
  select * into v_place from public.places where id = p_place_id for no key update;
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

  -- 장소 잠금을 거치지 않고 테이블에 바로 쓴 경우까지 막도록 덮어쓸 때도 version을 한 번 더 확인한다.
  insert into public.missions as m (place_id, mission, done, worker, flight_time, battery_no, battery_left)
  values (p_place_id, p_mission, v_done, v_worker, v_flight_time, v_battery_no, v_battery_left)
  on conflict (place_id, mission) do update set
    done = excluded.done,
    worker = excluded.worker,
    flight_time = excluded.flight_time,
    battery_no = excluded.battery_no,
    battery_left = excluded.battery_left,
    version = m.version + 1,
    updated_at = now()
  where m.version = p_base_version
  returning * into v_row;
  if not found then
    select * into v_existing from public.missions where place_id = p_place_id and mission = p_mission;
    return jsonb_build_object('status', 'conflict', 'record', case when found then public.mission_json(v_existing) end);
  end if;
  return jsonb_build_object('status', 'ok', 'record', public.mission_json(v_row));
end
$$;

-- 메모를 바꾸고 list_places 원소 하나와 같은 모양으로 돌려준다. 메모는 여러 줄을 쓸 수 있어 줄바꿈은 그대로 두고 2000자로 자른다.
create function public.update_memo(p_place_id bigint, p_memo text) returns jsonb
language plpgsql volatile security invoker
set search_path = public
as $$
declare
  v_place public.places;
begin
  if p_memo is null then
    raise exception using message = '메모는 문자열이어야 합니다.', errcode = 'P0001';
  end if;
  update public.places set memo = left(p_memo, 2000) where id = p_place_id
  returning * into v_place;
  if not found then
    raise exception using message = '장소를 찾을 수 없습니다.', errcode = 'P0001';
  end if;
  return public.place_json(
    v_place,
    (select jsonb_agg(public.mission_json(x) order by x.id) from public.missions x where x.place_id = p_place_id)
  );
end
$$;

-- 장소를 지운다(미션 기록도 함께 지워진다). 지웠으면 true, 없던 장소면 false.
create function public.delete_place(p_place_id bigint) returns boolean
language plpgsql volatile security invoker
set search_path = public
as $$
begin
  delete from public.places where id = p_place_id;
  return found;
end
$$;

-- 함수 실행 권한: 로그인한 사용자만. (Supabase 기본 권한이 anon에게도 줄 수 있으므로 명시적으로 거둔다.)
-- 트리거 함수는 직접 부를 일이 없어 아무에게도 주지 않는다(트리거로 실행될 때는 실행 권한을 보지 않는다).
revoke all on function
  public.js_trim(text),
  public.clean_text(text),
  public.round_coord(double precision),
  public.iso_time(timestamptz),
  public.mission_names(text),
  public.places_before_write(),
  public.missions_before_update(),
  public.mission_json(public.missions),
  public.place_json(public.places, jsonb),
  public.list_places(),
  public.import_places(jsonb),
  public.save_mission(bigint, text, jsonb, integer),
  public.update_memo(bigint, text),
  public.delete_place(bigint)
from public, anon;
revoke all on function public.places_before_write(), public.missions_before_update() from authenticated;

grant execute on function
  public.js_trim(text),
  public.clean_text(text),
  public.round_coord(double precision),
  public.iso_time(timestamptz),
  public.mission_names(text),
  public.mission_json(public.missions),
  public.place_json(public.places, jsonb),
  public.list_places(),
  public.import_places(jsonb),
  public.save_mission(bigint, text, jsonb, integer),
  public.update_memo(bigint, text),
  public.delete_place(bigint)
to authenticated;

-- ===================================================================
-- Realtime: 화면이 두 테이블의 변경을 구독한다.
-- ===================================================================
alter publication supabase_realtime add table public.places, public.missions;
