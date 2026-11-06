-- 로그인 기록을 화면·API로는 아무도 읽지 못하게 잠근다.
-- 의도: 모든 아이디의 로그인·로그아웃은 계속 login_logs에 쌓이지만, 읽는 곳은 Supabase 대시보드(Table Editor)뿐이다.
--   - 정책이 없는 채로 RLS를 켜 둔다 → anon·authenticated는 API(PostgREST)로 한 줄도 읽을 수 없다.
--   - 대시보드와 postgres 롤은 RLS를 우회하므로 그대로 볼 수 있다.
--   - 기록 쓰기(log_login, log_logout, auth.sessions 트리거)는 security definer라 그대로 동작한다. 이들은 건드리지 않는다.
-- 이미 적용된 20261106120000_login_logs.sql은 고치지 않고 이 파일에서 되돌린다.

drop policy if exists login_logs_authenticated_select on public.login_logs;

-- anon·public은 처음부터 권한이 없지만, 의도를 분명히 하려고 한 번 더 거둔다.
revoke all on table public.login_logs from public, anon, authenticated;

-- 로그인한 사람이 API로 전체 기록을 읽을 수 있는 통로이므로 제거한다. 화면은 더 이상 부르지 않는다.
drop function if exists public.list_login_logs(integer);

-- RLS는 켠 채로 둔다(이미 켜져 있어도 무해).
alter table public.login_logs enable row level security;
