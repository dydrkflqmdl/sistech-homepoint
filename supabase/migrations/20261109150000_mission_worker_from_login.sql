-- 미션 기록의 이름(worker)은 저장한 사람의 아이디로 고정한다(사용자 결정). 화면이 보낸 이름은 쓰지 않는다.
-- save_mission만 create or replace로 바꾼다. 20261109130000의 본문과 다른 곳은 이름 처리뿐이다.
--   - p_fields에 worker 키가 있으면 값(내용·종류)은 보지 않고 호출한 사람의 아이디를 넣는다.
--     아이디: JWT의 app_metadata.login_id → user_metadata.login_id → email의 @ 앞부분 순.
--     (이메일 앞부분은 xn--… 그대로 둔다. punycode를 한글로 푸는 일은 SQL에서 하지 않는다.)
--     셋 다 없으면 빈 이름으로 저장하지 않고 오류를 낸다. Supabase 토큰에는 email이 늘 있어 실제로는 생기지 않는다.
--   - worker 키가 없으면 저장된 이름을 그대로 둔다(일부 칸만 바꾸는 저장).
--   - 완료 조건(완료로 저장하려면 네 칸 필수), 검사 순서, 버전 충돌 규칙, 권한(authenticated만 실행)은 그대로다.

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
  v_claims jsonb;
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
    select * from (values ('flightTime', '비행시간'), ('batteryNo', '배터리 번호'), ('batteryLeft', '배터리 남은 용량')) as f (k, l)
  loop
    continue when not (p_fields ? v_key);
    if jsonb_typeof(p_fields -> v_key) <> 'string' then
      raise exception using message = format('%s은(는) 문자열이어야 합니다.', v_label), errcode = 'P0001';
    end if;
    v_text := public.clean_text(p_fields ->> v_key);
    case v_key
      when 'flightTime' then v_flight_time := v_text;
      when 'batteryNo' then v_battery_no := v_text;
      else v_battery_left := v_text;
    end case;
    v_any := true;
  end loop;
  -- 이름: 키가 있으면 보낸 값 대신 저장하는 사람의 아이디로 채운다. JWT 클레임은 PostgREST가 넣어 준다.
  if p_fields ? 'worker' then
    begin
      v_claims := auth.jwt();
    exception when others then
      v_claims := null;
    end;
    v_worker := coalesce(
      nullif(public.clean_text(v_claims #>> '{app_metadata,login_id}'), ''),
      nullif(public.clean_text(v_claims #>> '{user_metadata,login_id}'), ''),
      nullif(public.clean_text(split_part(v_claims ->> 'email', '@', 1)), ''));
    if v_worker is null then
      raise exception using message = '저장한 사람의 아이디를 알 수 없습니다. 다시 로그인해 주세요.', errcode = 'P0001';
    end if;
    v_any := true;
  end if;
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
  -- 이름 키 없이 완료로 저장할 때 저장된 이름이 비어 있으면 거절된다(화면은 이름 키를 늘 보낸다).
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

-- create or replace는 권한을 그대로 두지만 의도를 분명히 하려고 다시 적는다.
revoke all on function public.save_mission(bigint, text, jsonb, integer) from public, anon;
grant execute on function public.save_mission(bigint, text, jsonb, integer) to authenticated;
