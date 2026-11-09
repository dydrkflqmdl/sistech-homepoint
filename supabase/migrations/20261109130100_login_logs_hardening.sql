-- 로그인 기록 보강. 이미 적용된 20261106120000_login_logs.sql·20261106150000_login_logs_private.sql은 고치지 않는다.
--   1) 로그인 기록은 세션당 한 줄: 기록에 session_id(= JWT의 session_id 클레임 = auth.sessions.id)를 남기고,
--      같은 세션의 'login' 행이 이미 있으면 log_login은 새로 넣지 않는다(유일 인덱스로도 막는다).
--      session_id를 모르는 경우(클레임이 없는 토큰, 이 파일 이전에 트리거가 남긴 행)만 예전처럼 15초 규칙으로 거른다.
--   2) IP는 Cloudflare가 덮어쓰는 cf-connecting-ip 헤더만 믿는다. 사용자가 꾸밀 수 있는 x-forwarded-for·x-real-ip는 보지 않고,
--      없으면 null로 둔다. auth.sessions.ip도 GoTrue가 x-forwarded-for 첫 값으로 채우므로 쓰지 않는다. 대신 화면이 로그인 직후
--      log_login을 부르면 같은 세션의 기록에 cf-connecting-ip(와 비어 있던 기기 정보)를 채운다.
--      기기 정보(user_agent)도 요청 헤더 값만 쓴다. log_login의 인자는 예전 화면과의 호환을 위해 남겨 두고 무시한다.
--   3) 표시 아이디는 app_metadata.login_id(사용자가 못 바꿈)를 먼저, 없으면 user_metadata.login_id를 쓴다(계약 C4).
--   4) definer 함수 셋(log_login, log_logout, login_logs_on_session)은 search_path를 비우고 모든 이름에 스키마를 붙인다.
--   5) 보존 정책: purge_login_logs(보존 기간, 기본 1년)로 오래된 기록을 지운다. postgres(대시보드 SQL Editor·pg_cron)만 실행한다.

-- ===================================================================
-- 칸·인덱스
-- ===================================================================

alter table public.login_logs add column session_id uuid;  -- JWT의 session_id(= auth.sessions.id). 모르면 null.
-- IP를 모르면 ''가 아니라 null로 둔다. 예전 행의 ''도 null로 맞춘다.
alter table public.login_logs alter column ip drop not null;
alter table public.login_logs alter column ip drop default;
update public.login_logs set ip = null where ip = '';
-- 한 세션의 로그인 기록은 하나뿐이다(트리거와 화면 호출이 겹쳐도).
create unique index login_logs_login_session on public.login_logs (session_id)
  where event = 'login' and session_id is not null;

-- ===================================================================
-- 함수
-- ===================================================================

-- 화면이 로그인 직후 부른다. 돌려주는 값: {"logged": true} 새로 남김, {"logged": false} 이미 있어서 건너뜀.
-- 같은 세션의 login 행이 이미 있으면(트리거가 먼저 남김) 새로 넣지 않고, 그 행에 빠진 IP·기기 정보만 채운다.
-- p_user_agent는 무시한다(사용자가 마음대로 넣을 수 있는 값이라 요청 헤더의 User-Agent만 쓴다).
create or replace function public.log_login(p_user_agent text default '') returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_claims jsonb;
  v_headers jsonb;
  v_session uuid;
  v_ip text;
  v_ua text;
  v_email text;
  v_login_id text;
  v_count integer;
begin
  if v_uid is null then
    raise exception using message = '로그인이 필요합니다.', errcode = 'P0001';
  end if;

  -- 요청 헤더·JWT 클레임은 PostgREST가 넣어 준다. 모양이 이상해도 기록은 남기도록 읽기 실패는 무시한다.
  begin
    v_claims := auth.jwt();
  exception when others then
    v_claims := null;
  end;
  begin
    v_headers := nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  begin
    v_session := (v_claims ->> 'session_id')::uuid;
  exception when others then
    v_session := null;
  end;
  v_ip := pg_catalog.left(nullif(pg_catalog.btrim(v_headers ->> 'cf-connecting-ip'), ''), 100);
  v_ua := pg_catalog.left(coalesce(v_headers ->> 'user-agent', ''), 500);

  -- 같은 사용자의 동시 호출이 둘 다 "처음"으로 판정하지 않게 줄 세운다(트랜잭션이 끝나면 풀린다).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('login_logs:' || v_uid::text));

  if v_session is not null then
    update public.login_logs l set
      ip = coalesce(l.ip, v_ip),
      user_agent = case when l.user_agent = '' then v_ua else l.user_agent end
    where l.session_id = v_session and l.event = 'login' and l.user_id = v_uid
      and ((l.ip is null and v_ip is not null) or (l.user_agent = '' and v_ua <> ''));
  end if;
  -- 같은 세션의 기록, 또는 세션을 모르는 기록이 15초 안에 있으면 중복이다.
  -- (세션을 아는데 15초 안의 다른 세션 기록만 있으면 다른 기기의 로그인이므로 새로 남긴다.)
  if exists (
    select from public.login_logs l
    where l.user_id = v_uid and l.event = 'login'
      and (
        (v_session is not null and l.session_id = v_session)
        or ((v_session is null or l.session_id is null) and l.occurred_at > pg_catalog.now() - interval '15 seconds')
      )
  ) then
    return pg_catalog.jsonb_build_object('logged', false);
  end if;

  -- auth.users를 읽지 못하는 환경이어도 JWT 클레임으로 채운다. 아이디는 app_metadata를 먼저 본다.
  begin
    select u.email, coalesce(nullif(u.raw_app_meta_data ->> 'login_id', ''), nullif(u.raw_user_meta_data ->> 'login_id', ''))
      into v_email, v_login_id
    from auth.users u where u.id = v_uid;
  exception when others then
    null;
  end;

  insert into public.login_logs (user_id, session_id, email, login_id, event, user_agent, ip)
  values (
    v_uid,
    v_session,
    pg_catalog.left(coalesce(v_email, v_claims ->> 'email', ''), 320),
    pg_catalog.left(coalesce(v_login_id,
                             nullif(v_claims #>> '{app_metadata,login_id}', ''),
                             nullif(v_claims #>> '{user_metadata,login_id}', ''),
                             ''), 200),
    'login',
    v_ua,
    v_ip
  )
  on conflict (session_id) where event = 'login' and session_id is not null do nothing;
  get diagnostics v_count = row_count;
  return pg_catalog.jsonb_build_object('logged', v_count > 0);
end
$$;

-- 화면이 로그아웃 직전에 부른다. 같은 사용자의 'logout' 기록이 최근 2초 안에 있으면(두 번 누름) 넣지 않는다.
-- 돌려주는 값은 log_login과 같다. 기기 정보·IP·세션은 log_login과 같은 규칙으로 읽는다.
create or replace function public.log_logout() returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_claims jsonb;
  v_headers jsonb;
  v_session uuid;
  v_email text;
  v_login_id text;
begin
  if v_uid is null then
    raise exception using message = '로그인이 필요합니다.', errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('login_logs:' || v_uid::text));

  if exists (
    select from public.login_logs l
    where l.user_id = v_uid and l.event = 'logout' and l.occurred_at > pg_catalog.now() - interval '2 seconds'
  ) then
    return pg_catalog.jsonb_build_object('logged', false);
  end if;

  begin
    v_claims := auth.jwt();
  exception when others then
    v_claims := null;
  end;
  begin
    v_headers := nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  begin
    v_session := (v_claims ->> 'session_id')::uuid;
  exception when others then
    v_session := null;
  end;

  begin
    select u.email, coalesce(nullif(u.raw_app_meta_data ->> 'login_id', ''), nullif(u.raw_user_meta_data ->> 'login_id', ''))
      into v_email, v_login_id
    from auth.users u where u.id = v_uid;
  exception when others then
    null;
  end;

  insert into public.login_logs (user_id, session_id, email, login_id, event, user_agent, ip)
  values (
    v_uid,
    v_session,
    pg_catalog.left(coalesce(v_email, v_claims ->> 'email', ''), 320),
    pg_catalog.left(coalesce(v_login_id,
                             nullif(v_claims #>> '{app_metadata,login_id}', ''),
                             nullif(v_claims #>> '{user_metadata,login_id}', ''),
                             ''), 200),
    'logout',
    pg_catalog.left(coalesce(v_headers ->> 'user-agent', ''), 500),
    pg_catalog.left(nullif(pg_catalog.btrim(v_headers ->> 'cf-connecting-ip'), ''), 100)
  );
  return pg_catalog.jsonb_build_object('logged', true);
end
$$;

-- auth.sessions 트리거 함수: 세션이 생기면(= 로그인) 'login' 행을 남긴다. session_id는 그 세션의 id다.
-- IP는 비워 둔다(auth.sessions.ip는 꾸밀 수 있는 x-forwarded-for 값). 화면의 log_login이 cf-connecting-ip로 채운다.
-- GoTrue 버전에 따라 user_agent 칸이 없을 수 있으므로 to_jsonb로 읽는다(칸이 없으면 빈 칸).
-- 어떤 오류가 나도 로그인을 막으면 안 되므로 본문 전체에서 예외를 삼키고 항상 new를 돌려준다.
create or replace function public.login_logs_on_session() returns trigger
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_session uuid;
  v_email text;
  v_login_id text;
begin
  begin
    if new.user_id is not null then
      v_row := pg_catalog.to_jsonb(new);
      begin
        v_session := (v_row ->> 'id')::uuid;
      exception when others then
        v_session := null;
      end;
      select u.email, coalesce(nullif(u.raw_app_meta_data ->> 'login_id', ''), nullif(u.raw_user_meta_data ->> 'login_id', ''))
        into v_email, v_login_id
      from auth.users u where u.id = new.user_id;
      insert into public.login_logs (user_id, session_id, email, login_id, event, user_agent, ip)
      values (
        new.user_id,
        v_session,
        pg_catalog.left(coalesce(v_email, ''), 320),
        pg_catalog.left(coalesce(v_login_id, ''), 200),
        'login',
        pg_catalog.left(coalesce(v_row ->> 'user_agent', ''), 500),
        null
      )
      on conflict (session_id) where event = 'login' and session_id is not null do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
end
$$;

-- 보존 정책: p_keep보다 오래된 로그인 기록을 지우고 지운 행 수를 돌려준다(기본 1년).
-- postgres만 실행한다(대시보드 SQL Editor: select public.purge_login_logs(); 또는 pg_cron으로 매일).
-- 호출자 권한(security invoker)이라 실행 권한이 실수로 열려도 login_logs 삭제 권한이 없는 롤은 지우지 못한다.
create function public.purge_login_logs(p_keep interval default '1 year') returns integer
language plpgsql volatile security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_keep is null or p_keep < interval '0' then
    raise exception using message = '보존 기간은 0 이상이어야 합니다.', errcode = 'P0001';
  end if;
  delete from public.login_logs where occurred_at < now() - p_keep;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- ===================================================================
-- 함수 실행 권한
-- ===================================================================
-- create or replace는 권한을 그대로 두지만 의도를 분명히 하려고 다시 적는다.
revoke all on function
  public.log_login(text),
  public.log_logout(),
  public.login_logs_on_session(),
  public.purge_login_logs(interval)
from public, anon;
revoke all on function public.login_logs_on_session(), public.purge_login_logs(interval) from authenticated;
grant execute on function public.log_login(text), public.log_logout() to authenticated;

do $$
begin
  if exists (select from pg_catalog.pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.login_logs_on_session() to supabase_auth_admin;
  end if;
  -- "자동 노출" 설정이면 service_role에도 기본 실행 권한이 붙는다. 보존 정리는 postgres 전용이다.
  if exists (select from pg_catalog.pg_roles where rolname = 'service_role') then
    revoke all on function public.purge_login_logs(interval) from service_role;
  end if;
end
$$;
