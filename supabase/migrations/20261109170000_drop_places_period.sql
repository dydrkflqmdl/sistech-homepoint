-- 장소의 시기(period, 계약 C10)를 없앤다. 20261109160000_places_period.sql은 이미 적용돼 있어 고치지 않고 이 파일에서 되돌린다.
-- 사용자 결정으로 시기 기능이 필요 없어졌다. 같은 장소 판정은 다시 (이름, 7자리 위도, 7자리 경도)다.
--   0) (name, lat, lng)가 같은데 시기만 다른 행이 있으면 유일 제약을 되돌릴 수 없으므로 아무것도 바꾸지 않고 멈춘다.
--      어느 행을 남길지(미션 기록이 어디 붙어 있는지)는 사람이 봐야 하므로 자동으로 지우거나 합치지 않는다.
--   1) place_json을 period 없는 판으로 되돌린다(20261106000000_init.sql 정의와 같다. 그 뒤 바뀐 것은 period 추가뿐이었다).
--   2) import_places를 period 없는 판으로 되돌린다(20261109130000_places_missions_hardening.sql 본문과 같다).
--      row에 period 키가 와도 무시한다(예전 화면이 보내도 오류 없이 같은 이름·좌표 장소와 합쳐진다).
--   3) 유일 제약 places_name_lat_lng_period_key → places_name_coord unique (name, lat, lng), places_period_len 제약과 period 칸 삭제.
-- list_places·get_places·update_memo는 place_json을 쓰므로 저절로 period가 빠진다. save_mission·delete_place는 바꾸지 않는다.
-- Supabase CLI(db push)는 파일을 문장 단위로 실행한다(파일 전체가 한 트랜잭션이 아니다). 그래서 트랜잭션 블록이 필요한
-- lock table 같은 문장은 쓰지 않고, 되돌릴 수 없는 변경(제약 교체·칸 삭제) 앞에 검사 DO 블록을 둬서 검사에서 멈추면 아무것도 바뀌지 않게 한다.

-- ===================================================================
-- 0) 시기만 다른 같은 장소 검사
-- ===================================================================

-- 검사와 제약 교체 사이의 짧은 틈에 다른 시기 장소가 들어오면 아래 alter table의 unique 추가가 실패해 배포가 멈춘다(데이터는 그대로). 그때 다시 배포하면 된다.

do $$
declare
  v_groups int;
  v_sample text;
begin
  -- 지운 장소(deleted_at)도 유일 제약에 걸리므로 함께 센다. 건수는 겹치는 (이름, 좌표) 묶음 수다.
  select count(*),
         string_agg(format('%s (%s, %s): %s', g.name, g.lat, g.lng, g.periods), E'\n' order by g.rn) filter (where g.rn <= 20)
  into v_groups, v_sample
  from (
    select p.name, p.lat, p.lng,
           string_agg(format('id %s 시기 "%s"', p.id, p.period), ', ' order by p.period collate "C", p.id) as periods,
           row_number() over (order by p.name collate "C", p.lat, p.lng) as rn
    from public.places p
    group by p.name, p.lat, p.lng
    having count(*) > 1
  ) g;

  if v_groups > 0 then
    raise exception using
      message = format('시기만 다른 같은 장소 %s건이 있어 시기 열을 없앨 수 없습니다. 대시보드에서 정리한 뒤 다시 배포하세요.', v_groups),
      detail = '이름 (위도, 경도): 행 목록, 최대 20곳' || E'\n' || v_sample,
      hint = '같은 이름·좌표마다 한 행만 남기고 나머지는 지우거나 이름을 바꾸세요(미션 기록이 붙은 행을 남기는지 확인).',
      errcode = 'P0001';
  end if;
end
$$;

-- ===================================================================
-- 1) JSON 모양: place_json에서 period 제거
-- ===================================================================

-- 20261106000000_init.sql의 정의 그대로다. 속성(security invoker, search_path)도 같다.
-- period 칸을 지우기 전에 바꿔 둔다(SQL 함수 본문은 칸 의존성으로 잡히지 않아, 남겨 두면 칸 삭제 뒤 호출 때 오류가 난다).
create or replace function public.place_json(p public.places, p_missions jsonb) returns jsonb
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
-- 2) import_places: 같은 장소 판정을 (이름, 위도, 경도)로 되돌림
-- 20261109130000_places_missions_hardening.sql의 본문 그대로다.
-- ===================================================================

-- CSV에서 읽은 장소를 한 트랜잭션으로 넣는다(함수 하나가 한 트랜잭션이라 중간에 실패하면 모두 되돌린다).
-- rows: [{line, name, district, address, phone, memo, mission, lat, lng, addressGiven}, ...]
--   line은 CSV 줄 번호(화면이 넣는다). 오류 문구는 line이 있으면 "N행", 없으면 "N번째 장소"로 시작한다.
--   그 밖의 키(예전 화면이 보내는 period 등)는 무시한다.
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
  for r in select e.value from jsonb_array_elements(rows) with ordinality as e (value, n) order by e.n loop
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

-- ===================================================================
-- 3) 유일 제약을 (name, lat, lng)로 되돌리고 period 칸 삭제
-- ===================================================================

-- 0)에서 (name, lat, lng)가 겹치는 행이 없음을 확인했으므로 새 유일 제약이 바로 만족한다.
-- 제약 이름은 init(20261106000000_init.sql)과 같은 places_name_coord로 되돌린다.
alter table public.places
  drop constraint places_name_lat_lng_period_key,
  add constraint places_name_coord unique (name, lat, lng);

-- 길이 검사 제약은 칸과 함께 지워지지만, 무엇을 지우는지 분명히 하려고 따로 적는다.
alter table public.places
  drop constraint places_period_len,
  drop column period;

-- ===================================================================
-- 함수 실행 권한
-- create or replace는 기존 권한을 그대로 두지만, 의도를 분명히 하려고 다시 적는다(authenticated만 실행).
-- place_json은 init에서 정한 권한 그대로다(RPC가 아니라 다른 함수 안에서 쓰는 도우미).
-- ===================================================================
revoke all on function public.import_places(jsonb), public.place_json(public.places, jsonb) from public, anon;
grant execute on function public.import_places(jsonb), public.place_json(public.places, jsonb) to authenticated;

-- PostgREST가 바뀐 표 칸(places.period 없음)을 바로 알도록 스키마 캐시를 다시 읽게 한다.
notify pgrst, 'reload schema';
