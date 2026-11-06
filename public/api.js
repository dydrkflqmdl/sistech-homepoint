// Supabase(로그인·데이터·실시간) 접근을 이 파일 하나에 모은다. app.js는 여기 함수만 부른다.
// 설정은 config.js가 window.APP_CONFIG에 넣어 둔다(git에는 올리지 않고 배포 스크립트가 만든다).

// 버전을 정확히 고정한다. 바꾸면 화면 전체(로그인·저장·실시간)를 다시 확인해야 한다.
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

// supabase-js를 불러와 연결을 만든다. 자동 점검은 가짜 모듈을 window.supabase(공식 UMD 빌드와 같은 이름)에 먼저 심어 두므로,
// 이미 있으면 CDN에서 불러오지 않는다(카카오 SDK와 같은 규칙).
export async function initApi({ supabaseUrl, supabaseAnonKey }) {
  let createClient = window.supabase?.createClient;
  if (typeof createClient !== 'function') {
    try {
      ({ createClient } = await import(SUPABASE_JS_URL));
    } catch {
      throw new Error('로그인 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.');
    }
  }
  try {
    // 세션은 supabase-js 기본값대로 localStorage에 두고, 만료 전에 저절로 새로 받는다.
    client = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  } catch {
    throw new Error('config.js의 Supabase 주소(supabaseUrl)가 올바르지 않습니다. 배포 설정의 Secrets를 확인해 주세요.');
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
    result = await client.auth.signInWithPassword({ email, password });
  } catch {
    throw new Error(NETWORK_MESSAGE);
  }
  if (result.error) throw new Error(signInMessage(result.error));
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

// RPC 하나를 부른다. 실패하면 { status, code, auth } 를 단 Error를 던진다.
// DB 함수가 던진 검증 오류는 문구가 한국어라 그대로 쓰고, 영어로 오는 라이브러리 문구는 내보내지 않는다.
// signOutOn: 이 종류의 인증 실패('expired'·'forbidden')면 세션을 지우고 로그인 화면으로 보낸다(err.auth도 이때만 단다).
// 기록용 RPC처럼 실패해도 화면을 그대로 둬야 하는 호출은 빈 배열을 넘긴다.
async function call(name, params, { signOutOn = ['expired', 'forbidden'] } = {}) {
  let res;
  try {
    res = await client.rpc(name, params);
  } catch {
    res = { error: { message: '' }, status: 0 };
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

  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.auth = auth;
  if (auth) {
    // 세션을 지우면 onAuthChange가 로그인 화면으로 바꾼다. 이유는 그 알림에 실려 간다.
    signOutReason = message;
    client.auth.signOut({ scope: 'local' }).catch(() => {});
  }
  throw err;
}

// 장소 전체(미션 기록 포함). GET /api/places와 같은 모양의 배열.
export const listPlaces = async () => (await call('list_places')) ?? [];

// readPlaces()의 places 배열을 그대로 보낸다. → { imported, duplicates, updated, missionChanged }
export const importPlaces = (rows) => call('import_places', { rows });

// 미션 기록 저장. fields는 { done, worker, flightTime, batteryNo, batteryLeft }, baseVersion은 화면이 본 기록 판(없으면 null).
// → { status: 'ok', record } | { status: 'conflict', record | null }
export const saveMission = (placeId, mission, fields, baseVersion) =>
  call('save_mission', { p_place_id: placeId, p_mission: mission, p_fields: fields, p_base_version: baseVersion ?? null });

// 메모 저장 → 바뀐 장소(없는 장소면 null일 수 있다).
export const updateMemo = (placeId, memo) => call('update_memo', { p_place_id: placeId, p_memo: memo });

// 장소 삭제 → 지웠으면 true, 이미 없으면 false.
export const deletePlace = async (placeId) => Boolean(await call('delete_place', { p_place_id: placeId }));

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
  const request = call(name, params, { signOutOn: [] }).catch(() => null);
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}

// 로그인 성공 직후 한 번. 서버 트리거가 이미 기록했으면 { logged: false }가 온다(정상).
export const logLogin = (userAgent) => callLog('log_login', { p_user_agent: String(userAgent ?? '') });

// 로그아웃 버튼을 눌렀을 때 signOut 전에 한 번. 세션 만료로 내보낼 때는 부르지 않는다.
export const logLogout = () => callLog('log_logout');

// 최신순 로그인 기록 → [{ id, userId, email, loginId, event: 'login'|'logout', userAgent, ip, occurredAt }]
// 세션 만료면 로그인 화면으로 보내지만, 권한이 없을 때는 기록 창에 문구만 보여 주도록 로그아웃시키지 않는다.
export const listLoginLogs = async (limit = 200) =>
  (await call('list_login_logs', { p_limit: limit }, { signOutOn: ['expired'] })) ?? [];

// ── 실시간 ──────────────────────────────────────────────

// places·missions 테이블이 바뀔 때마다 onChange()를 부른다. 연결이 끊겼다가 다시 붙으면 그사이 놓친 변경이 있을 수 있어서 그때도 부른다.
// 돌려받은 함수를 부르면 구독을 끊는다.
export function subscribeChanges(onChange) {
  let subscribedOnce = false;
  const changed = () => onChange();
  const channel = client
    .channel('places-missions')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'places' }, changed)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'missions' }, changed)
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      if (subscribedOnce) onChange();
      subscribedOnce = true;
    });
  return () => {
    client.removeChannel(channel).catch(() => {});
  };
}
