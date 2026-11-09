-- Supabase 호스팅 환경 흉내(테스트 전용). 마이그레이션 파일에는 넣지 않는다.
-- 기본은 "새 테이블을 API에 자동으로 열지 않음" 설정이다. 기본 권한이 없고, public 스키마 USAGE도 PUBLIC에서 거둔다.
-- 그래서 authenticated가 쓰는 권한은 모두 마이그레이션이 명시적으로 준 것이어야 한다.
-- anon에게는 스키마 USAGE만 준다(Supabase가 anon도 public 스키마를 볼 수 있게 해 둔다). 그래서 anon이 막히는지는
-- 스키마가 아니라 테이블·함수 권한에서 판정된다.
-- psql 변수 exposed=1이면 "자동으로 엶" 설정을 흉내 내 anon·authenticated·service_role에게 기본 권한을 연다.
-- service_role은 Supabase처럼 RLS를 우회하는 롤이다(service_role 키). 표·함수 권한은 "자동 노출" 설정일 때만 기본으로 붙는다.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
-- Supabase의 auth.uid()·auth.jwt()와 같은 정의. PostgREST는 JWT 클레임을 request.jwt.claims(JSON)에 넣고,
-- 예전 버전은 request.jwt.claim.sub 같은 개별 설정에 넣었다. 둘 다 읽는다(테스트는 주로 claim.sub를 쓴다).
create function auth.uid() returns uuid language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create function auth.jwt() returns jsonb language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
-- Supabase는 API 롤이 auth.uid()를 쓸 수 있게 auth 스키마 USAGE를 준다(표 권한은 주지 않는다).
grant usage on schema auth to anon, authenticated, service_role;

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
-- 표시 아이디 복사 마이그레이션(20261109130200)은 두 계정의 user_metadata.login_id를 app_metadata.login_id로 옮겨야 한다.
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
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant usage on schema public to authenticated, service_role;
\endif
