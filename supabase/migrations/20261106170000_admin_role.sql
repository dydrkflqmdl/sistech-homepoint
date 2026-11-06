-- 관리자 지정: 김용문 계정(아이디 김용문 → 이메일 xn--4k0bz9vb1i@sistech.local)의 app_metadata에 role=admin을 넣는다.
-- 관리자 판정은 Edge Function이 auth.users.raw_app_meta_data->>'role' = 'admin'(= JWT의 app_metadata.role)으로 한다.
-- app_metadata는 사용자가 스스로 바꿀 수 없고(user_metadata와 다름) service_role·DB만 쓸 수 있어 권한 표시로 안전하다.
-- 같은 일을 스크립트로도 할 수 있다: npm run users -- --admin 김용문  (Admin API로 app_metadata를 병합한다)
--
-- 왜 DO 블록으로 감싸나: auth 스키마는 GoTrue(supabase_auth_admin)가 소유한다. 운영 Supabase에서는 postgres 롤이
-- auth.users를 UPDATE할 수 있지만, 권한이 다른 프로젝트나 GoTrue 버전이 바뀌어 칸 이름이 다른 경우에
-- 이 한 줄 때문에 배포(supabase db push) 전체가 멈추면 안 된다. 그래서 어떤 오류든 알림으로 바꾸고,
-- 못 했을 때는 위 스크립트를 대신 실행하라고 안내한다.
-- 멱등: 기존 raw_app_meta_data에 {"role":"admin"}을 병합(||)하므로 몇 번 실행해도 결과가 같다.
-- 계정이 아직 없으면(0행) 아무것도 바꾸지 않고 알림만 낸다. 계정을 만든 뒤 다시 적용하거나 스크립트를 쓰면 된다.

do $$
declare
  v_count integer;
begin
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
  where email = 'xn--4k0bz9vb1i@sistech.local';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise notice '관리자 지정 못 함: 김용문 계정(xn--4k0bz9vb1i@sistech.local)이 아직 없습니다. 계정을 만든 뒤 npm run users -- --admin 김용문 을 실행하세요.';
  end if;
exception when others then
  raise notice '관리자 지정 못 함(%: %). 대신 npm run users -- --admin 김용문 을 실행하세요.', sqlstate, sqlerrm;
end
$$;
