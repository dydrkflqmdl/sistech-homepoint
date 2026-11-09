-- 표시 아이디(한글 아이디)를 믿을 수 있는 곳으로 복사한다(계약 C4).
-- 지금까지 아이디는 auth.users.raw_user_meta_data->>'login_id'(= JWT의 user_metadata.login_id)에만 있었다.
-- user_metadata는 사용자가 supabase.auth.updateUser({ data })로 스스로 바꿀 수 있어서, 그 값을 그대로 쓰면 로그인 기록의
-- 아이디를 꾸밀 수 있다. app_metadata(raw_app_meta_data)는 service_role·DB만 쓸 수 있으므로 그쪽에 복사해 두고,
-- 로그 함수(20261109130100)는 app_metadata.login_id → user_metadata.login_id 순으로 읽는다.
--
-- 규칙(멱등): user_metadata.login_id가 비어 있지 않은 문자열이고 app_metadata.login_id가 없을 때만 복사한다.
--   이미 app_metadata.login_id가 있으면 덮지 않는다(그쪽이 기준이다). 다른 app_metadata 키(provider, role)는 그대로 둔다.
-- 새 계정은 계정 관리 함수(admin-users)·스크립트가 만들 때 app_metadata.login_id도 함께 넣어야 한다.
-- 관리자 지정 마이그레이션(20261106170000)과 같은 이유로, auth 스키마 권한·칸 이름이 달라도 배포가 멈추지 않게
-- 어떤 오류든 알림(notice)으로 바꾼다. 못 했으면 다시 적용하거나 SQL Editor에서 같은 UPDATE를 실행하면 된다.

do $$
begin
  update auth.users u
  set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
                          || jsonb_build_object('login_id', u.raw_user_meta_data ->> 'login_id')
  where jsonb_typeof(u.raw_user_meta_data -> 'login_id') = 'string'
    and u.raw_user_meta_data ->> 'login_id' <> ''
    and coalesce(u.raw_app_meta_data ->> 'login_id', '') = '';
exception when others then
  raise notice '표시 아이디 복사 못 함(%: %). 계정마다 app_metadata.login_id를 user_metadata.login_id와 같게 넣어 주세요.', sqlstate, sqlerrm;
end
$$;
