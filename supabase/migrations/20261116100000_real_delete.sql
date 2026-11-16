-- 장소 삭제를 실제 삭제로 바꾸고, 미션 기록 하나만 지우는 함수를 더한다.
--
-- 지금까지 delete_place는 soft delete였다(places.deleted_at만 채우고 행과 미션 기록은 남김).
-- 그래서 같은 장소(이름·좌표)를 import_places로 다시 가져오면 deleted_at을 비워 되살렸고, 옛 미션 기록이 그대로 다시 보였다.
-- 사용자 결정: 삭제하면 실제로 지워지고, 다시 등록하면 기록 없는 새 장소로 시작한다.
--
--   1) delete_place: 행을 실제로 지운다. missions.place_id는 places(id) ON DELETE CASCADE라 그 장소의 미션 기록도 함께 지워진다.
--      시그니처·보안 설정·권한(관리자·직원만)·오류 문구는 그대로이고 본문만 바뀐다.
--   2) 예전에 삭제 표시만 해 둔 장소(deleted_at이 찬 행)를 실제로 지운다.
--      그런 행이 남아 있으면 다시 가져올 때 옛 기록이 되살아나기 때문이다.
--   3) clear_mission: 미션 기록 하나만 지운다(관리자·직원만). 화면이 보던 version과 다르면 지우지 않고 충돌로 알린다.
--
-- import_places·list_places·get_places·save_mission·update_memo와 deleted_at 칸은 건드리지 않는다.
-- import_places의 되살리기 분기는 코드에 남지만, 삭제 표시된 행이 더는 생기지 않는다.
--
-- Supabase CLI(db push)는 파일을 문장 단위로 실행한다(파일 전체가 한 트랜잭션이 아니다).
-- 그래서 lock table 같은 문장은 쓰지 않고, create or replace·조건 있는 delete·revoke·grant만 써서 다시 실행해도 결과가 같게 한다.

-- ===================================================================
-- 1) delete_place: 실제 삭제
-- 20261112120000_contractor_memo.sql의 정의에서 본문의 update를 delete로 바꿨다. 앞의 로그인·권한 검사는 그대로다.
-- 없거나 이미 지운 장소(deleted_at이 찬 행)는 false.
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
    raise exception using message = '비행팀 계정은 미션 기록과 메모만 할 수 있습니다.', errcode = 'P0001';
  end if;
  -- 미션 기록은 외래키(on delete cascade)로 함께 지워진다.
  delete from public.places where id = p_place_id and deleted_at is null;
  return found;
end
$$;

-- ===================================================================
-- 2) 예전에 삭제 표시만 해 둔 장소 정리
-- 운영 DB에는 그런 행이 없지만, 남아 있으면 같은 이름·좌표로 다시 가져올 때 옛 기록이 되살아나므로 지운다.
-- ===================================================================

delete from public.places where deleted_at is not null;

-- ===================================================================
-- 3) clear_mission: 미션 기록 하나 지우기
-- 순서: 로그인 → 권한(관리자·직원) → 장소 잠금 → 기록 찾기 → 버전 확인 → 삭제.
--   - 장소 잠금은 save_mission과 같다. 같은 장소의 저장·삭제가 줄을 서므로, 기다리는 동안 바뀐 version이 충돌로 걸린다.
--   - 미션명은 정확히 일치로만 본다. 지금 미션명 범위 밖의 옛 기록도 이름이 맞으면 지울 수 있다.
--   - 기록이 없으면(p_mission이 null이어도) {"status":"ok","cleared":false}.
--   - p_base_version이 null이 아니고 기록의 version과 다르면 지우지 않고 {"status":"conflict","record":…}(save_mission과 같은 record 모양).
--     null이면 버전 확인 없이 지운다.
--   - 권한 거절 문구는 delete_place와 같다(화면이 이 문구로 비행팀 거절을 알아본다).
-- ===================================================================

create or replace function public.clear_mission(p_place_id bigint, p_mission text, p_base_version integer) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_place public.places;
  v_row public.missions;
begin
  if auth.uid() is null then
    raise exception using message = '로그인이 필요합니다.', errcode = 'P0001';
  end if;
  if coalesce(public.app_role(), '') not in ('admin', 'staff') then
    raise exception using message = '비행팀 계정은 미션 기록과 메모만 할 수 있습니다.', errcode = 'P0001';
  end if;

  select * into v_place from public.places where id = p_place_id and deleted_at is null for no key update;
  if not found then
    raise exception using message = '장소를 찾을 수 없습니다.', errcode = 'P0001';
  end if;

  select * into v_row from public.missions where place_id = p_place_id and mission = p_mission;
  if not found then
    return jsonb_build_object('status', 'ok', 'cleared', false);
  end if;
  if p_base_version is not null and p_base_version <> v_row.version then
    return jsonb_build_object('status', 'conflict', 'record', public.mission_json(v_row));
  end if;

  delete from public.missions where id = v_row.id;
  return jsonb_build_object('status', 'ok', 'cleared', true);
end
$$;

-- ===================================================================
-- 함수 실행 권한
-- create or replace는 기존 권한을 그대로 두지만 의도를 분명히 하려고 다시 적는다. clear_mission은 새 함수라 꼭 필요하다.
-- ===================================================================
revoke all on function
  public.delete_place(bigint),
  public.clear_mission(bigint, text, integer)
from public, anon;
grant execute on function
  public.delete_place(bigint),
  public.clear_mission(bigint, text, integer)
to authenticated;

-- PostgREST가 새 함수를 바로 쓰도록 스키마 캐시를 다시 읽게 한다.
notify pgrst, 'reload schema';
