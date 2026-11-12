-- 계정 권한 세 가지: 관리자(admin), 직원(staff), 외주(contractor).
-- 권한은 auth.users.raw_app_meta_data->>'role'(= JWT의 app_metadata.role)에 둔다. 사용자가 스스로 바꿀 수 없는 칸이다.
--   'admin'      관리자. 지금과 같다(계정 관리 함수는 Edge Function admin-users가 따로 검사한다).
--   'contractor' 외주. 장소 보기(list_places, get_places), 미션 기록(save_mission), 로그인 기록(log_login, log_logout)만 할 수 있다.
--                CSV 가져오기(import_places), 메모 고치기(update_memo), 장소 지우기(delete_place)는 거절한다.
--   그 밖의 값이나 값이 없으면 'staff'(직원). 지금까지의 일반 계정이 그대로 직원이 된다.
-- 이 파일은 누구에게도 권한을 넣지 않는다(저장소가 공개라 누가 외주인지 올리지 않는다).
-- 기존 관리자는 그대로 관리자이고, 나머지는 role이 없으므로 직원이다. 권한은 계정 관리 화면이나 SQL Editor에서 바꾼다.
--
-- 권한은 JWT가 아니라 auth.users에서 그때그때 읽는다. 그래서 바꾸면 다시 로그인하지 않아도 바로 적용된다.
-- Supabase CLI(db push)는 파일을 문장 단위로 실행한다(파일 전체가 한 트랜잭션이 아니다).
-- 그래서 lock table 같은 문장은 쓰지 않고, 모든 문장을 create or replace·revoke·grant로 써서 다시 실행해도 결과가 같게 한다.

-- ===================================================================
-- 1) app_role(): 지금 로그인한 사용자의 권한
-- ===================================================================

-- 'admin' | 'contractor' | 'staff'. 로그인하지 않았으면(auth.uid() 없음) null.
-- auth.users에 행이 없으면 null이다. 지운 계정의 JWT가 아직 살아 있어도(최대 1시간) 쓰기 RPC를 못 하게 한다.
-- 쓰기 RPC는 'admin'·'staff'만 허용하므로(허용 목록) null은 외주처럼 거절된다.
-- auth.users를 못 읽는 환경이면(권한·칸 이름이 다른 경우) 쓰기 RPC가 모두 멈추지 않게 JWT의 app_metadata.role로 대신한다.
-- 이때는 경고(warning)를 남겨 로그에서 알 수 있게 한다.
-- 다른 security definer 함수 안에서만 부른다. 화면은 my_role()을 쓴다.
create or replace function public.app_role() returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    return null;
  end if;
  begin
    select u.raw_app_meta_data ->> 'role' into v_role from auth.users u where u.id = v_uid;
    if not found then
      return null;
    end if;
  exception when others then
    raise warning using message = format('app_role: auth.users를 읽지 못해 JWT의 role을 씁니다. (%s: %s)', sqlstate, sqlerrm);
    v_role := auth.jwt() #>> '{app_metadata,role}';
  end;
  return case v_role when 'admin' then 'admin' when 'contractor' then 'contractor' else 'staff' end;
end
$$;

-- ===================================================================
-- 2) my_role(): 화면이 부르는 RPC. app_role()과 같은 값이다(null일 수 있다).
-- ===================================================================

-- app_role()을 authenticated에 열지 않으려고 security definer로 감싼다.
create or replace function public.my_role() returns text
language sql stable security definer
set search_path = ''
as $$
  select public.app_role()
$$;

-- ===================================================================
-- 3) import_places: 외주 계정 거절
-- 20261109170000_drop_places_period.sql의 정의 그대로이고, 로그인 검사 바로 뒤에 권한 검사만 넣었다(관리자·직원만 통과, 외주와 auth.users에 없는 계정은 거절).
-- ===================================================================

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
  if coalesce(public.app_role(), '') not in ('admin', 'staff') then
    raise exception using message = '외주 계정은 미션 기록만 할 수 있습니다.', errcode = 'P0001';
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
-- 4) update_memo: 외주 계정 거절
-- 20261109130000_places_missions_hardening.sql의 정의 그대로이고, 로그인 검사 바로 뒤에 권한 검사만 넣었다(관리자·직원만 통과, 외주와 auth.users에 없는 계정은 거절).
-- (그 파일은 예전 2인자 판을 지우고 create function으로 만들었다. 여기서는 같은 3인자 판을 create or replace로 바꾼다.)
-- ===================================================================

create or replace function public.update_memo(p_place_id bigint, p_memo text, p_base_memo text default null) returns jsonb
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
  if coalesce(public.app_role(), '') not in ('admin', 'staff') then
    raise exception using message = '외주 계정은 미션 기록만 할 수 있습니다.', errcode = 'P0001';
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

-- ===================================================================
-- 5) delete_place: 외주 계정 거절
-- 20261109130000_places_missions_hardening.sql의 정의 그대로이고, 로그인 검사 바로 뒤에 권한 검사만 넣었다(관리자·직원만 통과, 외주와 auth.users에 없는 계정은 거절).
-- ===================================================================

create or replace function public.delete_place(p_place_id bigint) returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using message = '로그인이 필요합니다.', errcode = 'P0001';
  end if;
  if coalesce(public.app_role(), '') not in ('admin', 'staff') then
    raise exception using message = '외주 계정은 미션 기록만 할 수 있습니다.', errcode = 'P0001';
  end if;
  update public.places set deleted_at = now() where id = p_place_id and deleted_at is null;
  return found;
end
$$;

-- ===================================================================
-- 함수 실행 권한
-- 새로 만든 함수는 "자동 노출" 설정이면 anon·authenticated에게도 기본 권한이 붙으므로 반드시 거둔다.
-- app_role()은 definer 함수 안에서만 쓰므로 authenticated에게도 주지 않는다(definer 함수는 소유자 권한으로 부른다).
-- my_role()만 authenticated에게 연다.
-- create or replace는 기존 권한을 그대로 두지만, 의도를 분명히 하려고 바꾼 RPC 셋의 권한도 다시 적는다.
-- ===================================================================
revoke all on function public.app_role() from public, anon, authenticated;
revoke all on function
  public.my_role(),
  public.import_places(jsonb),
  public.update_memo(bigint, text, text),
  public.delete_place(bigint)
from public, anon;
grant execute on function
  public.my_role(),
  public.import_places(jsonb),
  public.update_memo(bigint, text, text),
  public.delete_place(bigint)
to authenticated;

-- PostgREST가 새 RPC(my_role)를 바로 쓰도록 스키마 캐시를 다시 읽게 한다.
notify pgrst, 'reload schema';
