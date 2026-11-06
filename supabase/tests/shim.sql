-- Supabase 호스팅 환경 흉내(테스트 전용). 마이그레이션 파일에는 넣지 않는다.
-- 기본은 "새 테이블을 API에 자동으로 열지 않음" 설정이다. 기본 권한이 없고, public 스키마 USAGE도 PUBLIC에서 거둔다.
-- 그래서 authenticated가 쓰는 권한은 모두 마이그레이션이 명시적으로 준 것이어야 한다.
-- anon에게는 스키마 USAGE만 준다(Supabase가 anon도 public 스키마를 볼 수 있게 해 둔다). 그래서 anon이 막히는지는
-- 스키마가 아니라 테이블·함수 권한에서 판정된다.
-- psql 변수 exposed=1이면 "자동으로 엶" 설정을 흉내 내 anon·authenticated에게 기본 권한을 연다.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- Supabase Auth(GoTrue) 흉내. 실제 auth 테이블은 GoTrue가 쓰는 롤 supabase_auth_admin이 소유한다.
-- 롤은 클러스터 전체에 남으므로 이미 있으면 다시 만들지 않는다.
do $$ begin
  if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;
grant usage on schema auth to supabase_auth_admin;
create table auth.users (
  id                 uuid primary key,
  email              text,
  raw_user_meta_data jsonb default '{}',
  raw_app_meta_data  jsonb default '{}',   -- GoTrue의 app_metadata(사용자가 못 바꿈). 관리자 role이 여기 들어간다.
  created_at         timestamptz default now()
);
-- 관리자 지정 마이그레이션(20261106170000_admin_role.sql)이 찾을 계정을 미리 넣어 둔다(shim은 마이그레이션보다 먼저 실행됨).
-- 김용문은 관리자가 되어야 하고, 손두병은 건드리지 않아야 한다. 김용문은 기존 app_metadata(provider)가 보존되는지도 본다.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'xn--4k0bz9vb1i@sistech.local', '{"login_id":"김용문"}', '{"provider":"email"}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'xn--hu1b84nd3d@sistech.local', '{"login_id":"손두병"}', '{"provider":"email"}');
create table auth.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users,
  user_agent text,
  ip         text,
  created_at timestamptz default now()
);
alter table auth.users owner to supabase_auth_admin;
alter table auth.sessions owner to supabase_auth_admin;
grant all on auth.users, auth.sessions to postgres;
create publication supabase_realtime;
revoke all on schema public from public;
grant usage on schema public to anon;

\if :exposed
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
grant usage on schema public to authenticated;
\endif
