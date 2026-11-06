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
create publication supabase_realtime;
revoke all on schema public from public;
grant usage on schema public to anon;

\if :exposed
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
grant usage on schema public to authenticated;
\endif
