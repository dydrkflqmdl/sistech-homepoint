// Supabase(로그인·데이터·실시간) 접근을 이 파일 하나에 모은다. app.js는 여기 함수만 부른다.
// 설정은 config.js가 window.APP_CONFIG에 넣어 둔다(git에는 올리지 않고 배포 스크립트가 만든다).

// 자체 호스팅 파일(public/vendor/supabase-js.js)을 못 불러올 때 쓰는 예비 주소. 버전을 정확히 고정한다.
// 바꾸면 화면 전체(로그인·저장·실시간)를 다시 확인해야 한다.
export const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';

let client = null;

// config.js에서 읽은 설정. 파일이 없으면 found가 false다.
export function readConfig() {
  const raw = window.APP_CONFIG;
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    found: raw != null && typeof raw === 'object',
    kakaoJsKey: text(raw?.kakaoJsKey),
    supabaseUrl: text(raw?.supabaseUrl),
    supabaseAnonKey: text(raw?.supabaseAnonKey),
  };
}

// 원인을 콘솔에만 남긴다. 화면에는 한국어 문구만 보여 주므로, 문제를 찾을 때는 여기 남은 원인(err.cause)을 본다.
export function logCause(where, err) {
  console.warn(`[홈포인트] ${where}`, err?.cause ?? err);
}

// supabase-js의 createClient를 찾는다(계약 C9).
// 1) 자동 점검은 가짜 모듈을 window.supabase(공식 UMD 빌드와 같은 이름)에 먼저 심어 둔다.
// 2) 자체 호스팅 파일 public/vendor/supabase-js.js(배포 빌드가 ?v=<sha>를 붙이도록 지정자를 글자 그대로 적는다).
// 3) 그것도 안 되면 CDN(jsdelivr).
async function findCreateClient() {
  if (typeof window.supabase?.createClient === 'function') return window.supabase.createClient;
  const loaders = [
    ['자체 호스팅 supabase-js', () => import('./vendor/supabase-js.js')],
    ['CDN supabase-js', () => import(SUPABASE_JS_URL)],
  ];
  let lastError = null;
  for (const [label, load] of loaders) {
    try {
      const mod = await load();
      const createClient = mod?.createClient ?? mod?.default?.createClient;
      if (typeof createClient === 'function') return createClient;
      lastError = new Error(`${label}에 createClient가 없습니다.`);
    } catch (err) {
      lastError = err;
    }
    logCause(`${label}를 불러오지 못했습니다.`, lastError);
  }
  throw new Error('로그인 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.', { cause: lastError });
}

// supabase-js를 불러와 연결을 만든다.
export async function initApi({ supabaseUrl, supabaseAnonKey }) {
  const createClient = await findCreateClient();
  try {
    // 세션은 supabase-js 기본값대로 localStorage에 두고, 만료 전에 저절로 새로 받는다.
    client = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  } catch (err) {
    throw new Error('config.js의 Supabase 주소(supabaseUrl)가 올바르지 않습니다. 배포 설정의 Secrets를 확인해 주세요.', { cause: err });
  }
}

// ── 응답 시간 제한 ──────────────────────────────────────

// 서버가 이 시간 안에 답하지 않으면 기다리기를 그만두고 안내한다. 화면의 입력값은 건드리지 않는다.
let callTimeoutMs = 20000;
export const TIMEOUT_MESSAGE = '응답이 없습니다. 입력한 내용은 그대로 있습니다.';
// 끊어도 요청이 이미 서버에 닿았으면 저장됐을 수 있다([다시 시도]하면 화면이 같은 값인지 보고 저장된 것으로 처리한다).
export const ABORT_MESSAGE = '저장을 멈췄습니다(이미 저장됐을 수도 있습니다). 입력한 내용은 그대로 있습니다.';

// 시간 제한을 바꾼다(자동 점검이 20초를 기다리지 않으려고 쓴다).
export function setCallTimeout(ms) {
  callTimeoutMs = Math.max(1, Number(ms) || 20000);
}

// promise를 기다리되, signal이 끊기면 바로 거절한다. supabase-js의 abortSignal은 요청 자체를 끊고,
// 가짜 모듈처럼 끊기를 모르는 thenable도 여기서 기다리기를 그만둔다.
function untilAborted(promise, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

// run(signal)을 시간 제한과 사람의 취소(outer signal)를 걸어 부른다.
// 시간이 지나면 { timeout: true }, 사람이 취소하면 { aborted: true }를 단 Error를 던진다.
async function withTimeout(run, outer) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort(new Error('timeout'));
  }, callTimeoutMs);
  const onOuterAbort = () => ctrl.abort(new Error('aborted'));
  if (outer?.aborted) onOuterAbort();
  else outer?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    return await untilAborted(run(ctrl.signal), ctrl.signal);
  } catch (err) {
    if (!ctrl.signal.aborted) throw err;
    const e = new Error(timedOut ? TIMEOUT_MESSAGE : ABORT_MESSAGE, { cause: err });
    e.status = 0;
    e.code = timedOut ? 'TIMEOUT' : 'ABORTED';
    e.auth = null;
    e.timeout = timedOut;
    e.aborted = !timedOut;
    throw e;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

// ── 로그인 ──────────────────────────────────────────────

// 세션 만료·권한 없음으로 이쪽에서 로그아웃시킨 이유. 다음 로그아웃 알림에 한 번만 실어 보낸다.
let signOutReason = null;

// 로그인 상태가 바뀔 때마다 cb(session | null, { reason })을 부른다. 구독하자마자 지금 상태로도 한 번 부른다.
// supabase-js는 이 알림 안에서 바로 다른 Supabase 호출을 기다리면 멈출 수 있다고 안내하므로, 다음 차례로 미뤄서 부른다.
export function onAuthChange(cb) {
  const { data } = client.auth.onAuthStateChange((event, session) => {
    const reason = session ? null : signOutReason;
    if (!session) signOutReason = null;
    setTimeout(() => cb(session ?? null, { event, reason }), 0);
  });
  return () => data.subscription.unsubscribe();
}

const NETWORK_MESSAGE = '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.';
const hasHangul = (s) => /[가-힣]/.test(String(s ?? ''));

function signInMessage(error) {
  const code = error.code ?? '';
  const message = String(error.message ?? '');
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) return '아이디 또는 비밀번호가 틀렸습니다.';
  if (code === 'email_not_confirmed') return '인증이 끝나지 않은 계정입니다. 관리자에게 문의해 주세요.';
  if (code === 'user_banned') return '사용이 막힌 계정입니다. 관리자에게 문의해 주세요.';
  if (error.status === 429 || /rate limit/i.test(code)) return '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (error.name === 'AuthRetryableFetchError' || !error.status) return NETWORK_MESSAGE;
  return '로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

// Supabase 이메일+비밀번호로 로그인한다. 화면의 아이디는 app.js가 loginIdToEmail로 이메일로 바꿔서 넘긴다.
// 실패하면 한국어 문구를 담은 Error를 던진다. 계정은 관리자가 만든다(가입 화면 없음).
export async function signIn(email, password) {
  let result;
  try {
    result = await withTimeout(() => client.auth.signInWithPassword({ email, password }));
  } catch (err) {
    logCause('로그인 요청 실패', err);
    if (err.timeout) throw new Error('응답이 없습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.', { cause: err });
    throw new Error(NETWORK_MESSAGE, { cause: err });
  }
  if (result.error) {
    const err = new Error(signInMessage(result.error), { cause: result.error });
    if (!result.error.status || result.error.status >= 500) logCause('로그인 실패', err);
    throw err;
  }
  return result.data.session;
}

// 이 기기에서만 로그아웃한다(기본값 global은 같은 계정으로 들어온 다른 기기까지 모두 내보낸다).
export async function signOut() {
  await client.auth.signOut({ scope: 'local' });
}

// ── 데이터(RPC) ─────────────────────────────────────────

// 401·JWT 오류는 세션 만료, 403·42501은 권한 없음이다. 둘 다 로그인 화면으로 돌려보낸다.
const EXPIRED_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303']);
const authKind = (status, code) =>
  status === 401 || EXPIRED_CODES.has(code) ? 'expired' : status === 403 || code === '42501' ? 'forbidden' : null;

const AUTH_MESSAGES = {
  expired: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  forbidden: '이 계정에는 권한이 없습니다. 다시 로그인하거나 관리자에게 문의해 주세요.',
};

// RPC 하나를 부른다. 실패하면 { status, code, auth } 를 단 Error를 던진다(원인은 err.cause).
// DB 함수가 던진 검증 오류는 문구가 한국어라 그대로 쓰고, 영어로 오는 라이브러리 문구는 내보내지 않는다.
// signOutOn: 이 종류의 인증 실패('expired'·'forbidden')면 세션을 지우고 로그인 화면으로 보낸다(err.auth도 이때만 단다).
// 기록용 RPC처럼 실패해도 화면을 그대로 둬야 하는 호출은 빈 배열을 넘긴다.
// signal: 사람이 [취소]를 누르면 끊는다. 응답이 20초 안에 없으면 err.timeout을 단 Error를 던진다.
async function call(name, params, { signOutOn = ['expired', 'forbidden'], signal } = {}) {
  let res;
  try {
    res = await withTimeout((sig) => {
      const query = client.rpc(name, params);
      return typeof query?.abortSignal === 'function' ? query.abortSignal(sig) : query;
    }, signal);
  } catch (err) {
    if (err.timeout || err.aborted) {
      if (err.timeout) logCause(`${name}: 응답 시간 초과`, err);
      throw err;
    }
    res = { error: { message: '' }, status: 0, cause: err };
  }
  if (!res.error) return res.data;

  const { status = 0 } = res;
  const code = res.error.code ?? '';
  const kind = authKind(status, code);
  const auth = kind && signOutOn.includes(kind) ? kind : null;
  let message;
  if (auth) message = AUTH_MESSAGES[auth];
  else if (hasHangul(res.error.message)) message = res.error.message;
  else if (kind) message = AUTH_MESSAGES[kind];
  else if (!status) message = NETWORK_MESSAGE;
  else message = `서버 오류가 발생했습니다.${code ? ` (${code})` : ''}`;

  const err = new Error(message, { cause: res.cause ?? res.error });
  err.status = status;
  err.code = code;
  err.auth = auth;
  // 화면 문구로 바꿔 버리는 실패(연결·서버 오류)는 원인을 콘솔에 남긴다. 한국어 검증 문구는 그대로 보여 주므로 남기지 않는다.
  if (!hasHangul(res.error.message)) logCause(`${name} 실패 (${status}${code ? ` ${code}` : ''})`, err);
  if (auth) {
    // 세션을 지우면 onAuthChange가 로그인 화면으로 바꾼다. 이유는 그 알림에 실려 간다.
    signOutReason = message;
    client.auth.signOut({ scope: 'local' }).catch((e) => logCause('세션 정리 실패', e));
  }
  throw err;
}

// 함수가 DB에 없을 때(아직 배포 전인 새 RPC)의 오류인지. PostgREST는 PGRST202, Postgres는 42883을 준다.
const isMissingFunction = (err) => err?.code === 'PGRST202' || err?.code === '42883';

// 장소 전체(미션 기록 포함). 삭제 표시된 장소는 서버가 빼고 준다.
export const listPlaces = async (opts) => (await call('list_places', undefined, opts)) ?? [];

// 장소 몇 곳만 다시 받는다(계약 C2: get_places(p_ids bigint[]) → list_places 원소 배열). 없는(지워진) 장소는 빠진다.
// get_places가 아직 없으면 전체를 받아 { complete: true }로 알린다(화면은 전체로 바꿔 넣는다).
let getPlacesMissing = false;
export async function getPlaces(ids, opts) {
  if (!getPlacesMissing) {
    try {
      return { places: (await call('get_places', { p_ids: ids }, opts)) ?? [], complete: false };
    } catch (err) {
      if (!isMissingFunction(err)) throw err;
      getPlacesMissing = true;
      logCause('get_places가 없어 list_places로 대신 받습니다.', err);
    }
  }
  return { places: await listPlaces(opts), complete: true };
}

// readPlaces()의 places 배열을 그대로 보낸다. → { imported, duplicates, updated, missionChanged }
export const importPlaces = (rows) => call('import_places', { rows });

// 미션 기록 저장. fields는 { done, worker, flightTime, batteryNo, batteryLeft }, baseVersion은 화면이 본 기록 판(없으면 null).
// → { status: 'ok', record } | { status: 'conflict', record | null }
export const saveMission = (placeId, mission, fields, baseVersion, opts) =>
  call('save_mission', { p_place_id: placeId, p_mission: mission, p_fields: fields, p_base_version: baseVersion ?? null }, opts);

// 메모 저장(계약 C1: update_memo(p_place_id, p_memo, p_base_memo) → { status: 'ok' | 'conflict', place }).
// baseMemo는 고치기 시작할 때 서버에 있던 메모. 그사이 다른 기기가 바꿨으면 서버가 conflict와 최신 장소를 준다.
// 옛 함수(인자 2개, 장소를 그대로 돌려줌)도 받아 준다: 응답이 장소 객체면 ok로, 3인자 함수가 없으면 2인자로 다시 부른다.
// → { status, place } (없는 장소면 place는 null)
let memoBaseMissing = false;
export async function updateMemo(placeId, memo, baseMemo, opts) {
  const params = { p_place_id: placeId, p_memo: memo };
  if (!memoBaseMissing && typeof baseMemo === 'string') params.p_base_memo = baseMemo;
  let res;
  try {
    res = await call('update_memo', params, opts);
  } catch (err) {
    if (!('p_base_memo' in params) || !isMissingFunction(err)) throw err;
    memoBaseMissing = true;
    logCause('update_memo에 p_base_memo가 없어 옛 방식(인자 2개)으로 저장합니다.', err);
    res = await call('update_memo', { p_place_id: placeId, p_memo: memo }, opts);
  }
  if (res && typeof res === 'object' && (res.status === 'ok' || res.status === 'conflict') && 'place' in res) {
    return { status: res.status, place: res.place ?? null };
  }
  return { status: 'ok', place: res ?? null };
}

// 장소 삭제 → 지웠으면 true, 이미 없으면 false.
export const deletePlace = async (placeId) => Boolean(await call('delete_place', { p_place_id: placeId }));

// ── 계정 관리(Edge Function admin-users) ───────────────

// 관리자 계정인지. 역할은 Supabase가 서명한 JWT의 app_metadata.role에 있다(user_metadata는 사용자가 바꿀 수 있어서 쓰지 않는다).
export const isAdmin = (user) => user?.app_metadata?.role === 'admin';

const ACCOUNT_NETWORK_MESSAGE = '계정 서버에 연결할 수 없습니다.';
const ACCOUNT_FORBIDDEN_MESSAGE = '관리자만 쓸 수 있는 기능입니다.';

// admin-users 함수를 한 번 부른다. 성공하면 응답 본문({ ok: true, ... })을 돌려주고, 실패하면 한국어 문구를 담은 Error를 던진다.
// supabase-js는 2xx가 아니면 error를 주고 error.context가 Response다(본문 { ok: false, error: '한국어 문구' }를 꺼내 그대로 보여 준다).
// context가 Response가 아니면(연결 실패·중계 오류) 네트워크 문구를 쓴다. 오류 클래스는 CDN 동적 로드·가짜 주입 때문에 import하지 않고 모양으로 가린다.
// 401은 RPC와 같이 세션 만료로 보고 로그아웃시키지만, 403(관리자 아님)은 로그아웃시키지 않고 문구만 보여 준다.
async function callAdmin(body) {
  let res;
  try {
    res = await withTimeout(() => client.functions.invoke('admin-users', { body }));
  } catch (err) {
    if (err.timeout) {
      logCause('admin-users: 응답 시간 초과', err);
      throw err;
    }
    res = { data: null, error: { context: null, cause: err } };
  }
  if (!res.error) return res.data ?? {};

  const ctx = res.error.context;
  if (typeof ctx?.json !== 'function') {
    const err = new Error(ACCOUNT_NETWORK_MESSAGE, { cause: res.error.cause ?? res.error });
    logCause('admin-users 연결 실패', err);
    throw err;
  }
  const status = Number(ctx.status) || 0;
  let payload = null;
  try {
    payload = await ctx.json();
  } catch (err) {
    logCause('admin-users 응답 본문을 읽지 못했습니다.', err);
    payload = null;
  }
  const serverMessage = typeof payload?.error === 'string' && hasHangul(payload.error) ? payload.error : '';
  const auth = status === 401 ? 'expired' : null;
  let message;
  if (auth) message = AUTH_MESSAGES.expired;
  else if (serverMessage) message = serverMessage;
  else if (status === 403) message = ACCOUNT_FORBIDDEN_MESSAGE;
  else message = `계정 서버 오류가 발생했습니다. (${status})`;

  const err = new Error(message, { cause: res.error });
  err.status = status;
  err.auth = auth;
  if (!serverMessage) logCause(`admin-users 실패 (${status})`, err);
  if (auth) {
    signOutReason = message;
    client.auth.signOut({ scope: 'local' }).catch((e) => logCause('세션 정리 실패', e));
  }
  throw err;
}

// 계정 목록 → [{ id, login_id, email, created_at, last_sign_in_at, is_admin }]. login_id는 null일 수 있다(화면에서 이메일로 되살린다).
export const listAccounts = async () => (await callAdmin({ action: 'list' })).users ?? [];

// 새 계정을 만든다 → 만든 계정. 아이디·비밀번호 규칙은 화면에서 먼저 검사하고, 서버가 다시 검사한다.
export const createAccount = async (loginId, password) =>
  (await callAdmin({ action: 'create', login_id: loginId, password })).user ?? null;

// 계정의 비밀번호를 바꾼다. 그 계정은 모든 기기에서 로그아웃된다(본인 것도 마찬가지).
export const resetAccountPassword = async (userId, password) => {
  await callAdmin({ action: 'reset_password', user_id: userId, password });
};

// ── 로그인 기록 ─────────────────────────────────────────

// 기록 RPC는 화면 전환·로그아웃을 막지 않도록 이 시간까지만 기다린다.
const LOG_TIMEOUT_MS = 2000;

// 기록 RPC를 부르되 절대 던지지 않는다. 결과({ logged }) 또는 실패·시간 초과면 null.
// 세션이 막 끝났더라도 기록 실패 때문에 로그아웃시키지 않는다(signOutOn: []).
function callLog(name, params) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), LOG_TIMEOUT_MS);
  });
  const request = call(name, params, { signOutOn: [] }).catch((err) => {
    logCause(`${name} 기록 실패(무시)`, err);
    return null;
  });
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}

// 로그인 성공 직후 한 번. 서버 트리거가 이미 기록했으면 { logged: false }가 온다(정상).
export const logLogin = (userAgent) => callLog('log_login', { p_user_agent: String(userAgent ?? '') });

// 로그아웃 버튼을 눌렀을 때 signOut 전에 한 번. 세션 만료로 내보낼 때는 부르지 않는다.
export const logLogout = () => callLog('log_logout');

// ── 실시간 ──────────────────────────────────────────────

const hasKeys = (o) => o != null && typeof o === 'object' && Object.keys(o).length > 0;

// postgres_changes 알림을 화면이 쓰기 좋은 모양으로 바꾼다.
// places: { table, type, placeId, removed(삭제·삭제 표시), row(새 값) }
// missions: { table, type, placeId(new.place_id, 지울 때는 old에 있을 때만), mission, row }
// placeId가 null이면 어느 장소인지 모르는 알림이다(화면은 전체를 다시 받는다).
function changeOf(table, payload) {
  const row = hasKeys(payload?.new) ? payload.new : null;
  const old = hasKeys(payload?.old) ? payload.old : null;
  const type = payload?.eventType ?? null;
  if (table === 'places') {
    const id = row?.id ?? old?.id ?? null;
    // 계약 C3: 지우면 deleted_at이 찍힌 UPDATE가 온다(완전히 지우는 DELETE도 계속 받는다).
    return { table, type, placeId: id, removed: type === 'DELETE' || Boolean(row?.deleted_at), row };
  }
  return { table, type, placeId: row?.place_id ?? old?.place_id ?? null, mission: row?.mission ?? null, row };
}

// places·missions 테이블이 바뀔 때마다 onChange(change)를 부른다(changeOf 모양).
// 연결이 끊겼다가 다시 붙으면 그사이 놓친 변경이 있을 수 있어서 onChange({ resync: true })를 부른다.
// 돌려받은 함수를 부르면 구독을 끊는다.
export function subscribeChanges(onChange) {
  let subscribedOnce = false;
  const channel = client
    .channel('places-missions')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'places' }, (payload) => onChange(changeOf('places', payload)))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'missions' }, (payload) => onChange(changeOf('missions', payload)))
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        if (subscribedOnce) onChange({ resync: true });
        subscribedOnce = true;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        logCause(`실시간 연결 상태: ${status}`, err ?? null);
      }
    });
  return () => {
    client.removeChannel(channel).catch((e) => logCause('실시간 구독 해제 실패', e));
  };
}
