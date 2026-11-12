// admin-users Edge Function의 핵심 로직. Deno API나 supabase-js에 직접 기대지 않는 순수 ESM이라
// Node의 node:test 로도 가짜 deps를 넣어 검증할 수 있다. 진입점은 index.ts.
//
// 요청: POST JSON { action: 'list' | 'create' | 'reset_password' | 'set_role', login_id?, password?, user_id?, role? }
//       헤더 Authorization: Bearer <로그인 사용자의 access token>
// 관리자(app_metadata.role === 'admin')만 허용하며, 토큰 검증은 서비스 롤 클라이언트의 getUser 로 서버에서 한다.
// 제한: 본문 16KB(초과 413), 관리자별 1분 20회(초과 429), ALLOWED_ORIGINS 가 있으면 그 출처만 허용.

// ---- 아이디·비밀번호 규칙: public/login-id.js 와 같은 상수·같은 결과여야 한다 ----
// (배포 번들러가 supabase/functions/ 밖 파일을 포함하지 않아 import 대신 규칙을 그대로 옮겼다.
//  test/login-id.test.js 가 두 파일의 상수와 허용·거부 결과가 같은지 검사한다.)
export const LOGIN_DOMAIN = 'sistech.local';
export const LOGIN_ID_MAX = 16;
export const LOGIN_ID_RULE = `아이디는 한글 또는 영문으로 시작하는 한글·영문·숫자·밑줄 1~${LOGIN_ID_MAX}자여야 합니다.`;
export const PASSWORD_MIN = 6; // Supabase Auth 최솟값
export const PASSWORD_MAX = 72; // bcrypt 한계(UTF-8 바이트)
export const PASSWORD_RULE = `비밀번호는 ${PASSWORD_MIN}자 이상 ${PASSWORD_MAX}자 이하여야 합니다.`;

// 첫 글자는 한글·영문만(숫자로 시작하면 '123'·'0x7b'·'0173'이 모두 IPv4 '0.0.0.123'이 된다. 계약 C5).
const ID_PATTERN = /^[가-힣A-Za-z][가-힣A-Za-z0-9_]*$/;
const LOCAL_PATTERN = /^[a-z0-9_-]+$/;

// 요청 제한
export const BODY_LIMIT_BYTES = 16 * 1024;
export const RATE_LIMIT = 20; // 관리자 한 명이 RATE_WINDOW_MS 안에 보낼 수 있는 요청 수
export const RATE_WINDOW_MS = 60_000;
export const RATE_LIMIT_MESSAGE = '요청이 너무 많습니다. 1분 뒤에 다시 시도해 주세요.';
export const BODY_TOO_LARGE_MESSAGE = '요청 본문이 너무 큽니다.';
export const ORIGIN_DENIED_MESSAGE = '허용되지 않은 출처에서 온 요청입니다.';

// ---- 계정 권한(app_metadata.role) ----
// 'admin' 관리자, 'staff' 직원, 'contractor' 외주. 값이 없거나 모르는 값이면 직원이다(DB의 public.app_role()과 같은 규칙).
// 이 함수로 고를 수 있는 것은 직원·외주뿐이다. 관리자는 여기서 만들거나 바꾸지 않는다.
export const ROLE_ADMIN = 'admin';
export const ROLE_STAFF = 'staff';
export const ROLE_CONTRACTOR = 'contractor';
export const ASSIGNABLE_ROLES = Object.freeze([ROLE_STAFF, ROLE_CONTRACTOR]);
export const ROLE_RULE = '권한은 직원 또는 외주만 고를 수 있습니다.';
export const ADMIN_ROLE_LOCKED_MESSAGE = '관리자 계정의 권한은 여기서 바꿀 수 없습니다.';
export const ADMIN_PASSWORD_LOCKED_MESSAGE = '관리자 계정은 본인만 비밀번호를 바꿀 수 있습니다.';

// app_metadata → 'admin' | 'staff' | 'contractor'
/** @param {Record<string, any> | null | undefined} appMetadata @returns {'admin' | 'staff' | 'contractor'} */
export function roleOf(appMetadata) {
  const role = appMetadata?.role;
  if (role === ROLE_ADMIN) return ROLE_ADMIN;
  if (role === ROLE_CONTRACTOR) return ROLE_CONTRACTOR;
  return ROLE_STAFF;
}

// 요청의 role 값 검사. 없으면(undefined·null) fallback, 직원·외주가 아니면 400.
/** @param {unknown} raw @param {'staff' | 'contractor' | null} fallback @returns {'staff' | 'contractor'} */
function validateRole(raw, fallback) {
  if ((raw === undefined || raw === null) && fallback !== null) return fallback;
  if (raw === ROLE_STAFF || raw === ROLE_CONTRACTOR) return raw;
  throw new HttpError(400, ROLE_RULE);
}

// 앞뒤 공백을 떼고 한글 조합 형태를 통일한다. 규칙에 어긋나면 null.
/** @param {unknown} raw @returns {string | null} */
export function normalizeLoginId(raw) {
  const id = String(raw ?? '').normalize('NFC').trim();
  if (id.length < 1 || id.length > LOGIN_ID_MAX || !ID_PATTERN.test(id)) return null;
  return id;
}

// 아이디 → 로그인 이메일. 영문은 소문자로, 한글은 IDNA(xn--) 형태로 바뀐다. 규칙에 어긋나면 null.
/** @param {unknown} raw @returns {string | null} */
function emailOrNull(raw) {
  const id = normalizeLoginId(raw);
  if (id === null) return null;
  let local;
  try {
    local = new URL(`http://${id}/`).hostname;
  } catch {
    return null;
  }
  if (!local || local.length > 64 || !LOCAL_PATTERN.test(local)) return null;
  return `${local}@${LOGIN_DOMAIN}`;
}

/** @param {unknown} raw @returns {string} */
export function loginIdToEmail(raw) {
  const email = emailOrNull(raw);
  if (email === null) throw new HttpError(400, LOGIN_ID_RULE);
  return email;
}

// 길이만 본다(문자 조건 없음, 관리자가 정한 비밀번호를 그대로 쓴다). 상한은 UTF-8 바이트.
/** @param {unknown} raw @returns {boolean} */
export function isValidPassword(raw) {
  if (typeof raw !== 'string' || raw.length < PASSWORD_MIN) return false;
  return new TextEncoder().encode(raw).length <= PASSWORD_MAX;
}

/** @param {unknown} raw @returns {string} */
function validatePassword(raw) {
  if (!isValidPassword(raw)) throw new HttpError(400, PASSWORD_RULE);
  return /** @type {string} */ (raw);
}

// 우리 도메인 이메일 → 아이디(xn-- 는 한글로 푼다). 다른 도메인이거나 풀 수 없으면 null.
/** @param {unknown} email @returns {string | null} */
export function emailToLoginId(email) {
  const text = String(email ?? '');
  const at = text.lastIndexOf('@');
  if (at < 1 || text.slice(at + 1).toLowerCase() !== LOGIN_DOMAIN) return null;
  const local = text.slice(0, at);
  if (!local.toLowerCase().startsWith('xn--')) return local;
  try {
    return punycodeDecode(local.slice(4)) || local;
  } catch {
    return local;
  }
}

// RFC 3492 punycode 복호화(public/login-id.js 의 punycodeDecode 와 같은 코드).
const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

/** @param {number} delta @param {number} numPoints @param {boolean} firstTime */
function adapt(delta, numPoints, firstTime) {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

/** @param {number} code */
function digitValue(code) {
  if (code >= 48 && code <= 57) return code - 22;
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97;
  return BASE;
}

/** @param {string} input @returns {string} */
export function punycodeDecode(input) {
  const output = [];
  const basicEnd = Math.max(input.lastIndexOf('-'), 0);
  for (let j = 0; j < basicEnd; j++) {
    const code = input.charCodeAt(j);
    if (code >= 0x80) throw new RangeError('punycode: 잘못된 입력');
    output.push(code);
  }
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  for (let index = basicEnd > 0 ? basicEnd + 1 : 0; index < input.length; ) {
    const oldI = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) throw new RangeError('punycode: 잘린 입력');
      const digit = digitValue(input.charCodeAt(index++));
      if (digit >= BASE || digit > Math.floor((0x7fffffff - i) / w)) throw new RangeError('punycode: 잘못된 입력');
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    const out = output.length + 1;
    bias = adapt(i - oldI, out, oldI === 0);
    n += Math.floor(i / out);
    i %= out;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

// ---- 응답 도우미 ----
// ALLOWED_ORIGINS 를 설정하지 않았을 때의 CORS 헤더(모든 출처 허용). 설정하면 요청마다 corsHeaders 가 바꿔 쓴다.
export const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

// 상태 코드가 붙은 오류. 핸들러 바깥으로 나가면 그 코드와 메시지로 응답한다.
export class HttpError extends Error {
  /** @param {number} status @param {string} message @param {Record<string, string>} [headers] */
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

/** @param {number} status @param {unknown} body @param {Record<string, string>} cors @param {Record<string, string>} [extra] */
function json(status, body, cors, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, ...extra, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// "https://a.example, https://b.example/" → ['https://a.example', 'https://b.example']
/** @param {string | string[] | null | undefined} value @returns {string[]} */
export function parseAllowedOrigins(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  return list.map((o) => String(o).trim().replace(/\/+$/, '')).filter(Boolean);
}

// 허용 목록이 비어 있으면 '*'(지금까지의 동작). 있으면 목록에 든 Origin 일 때만 그 값을 돌려주고,
// 아니면 Allow-Origin 을 빼서 브라우저가 응답을 쓰지 못하게 한다.
/** @param {string | null} origin @param {string[]} allowed @returns {Record<string, string>} */
export function corsHeaders(origin, allowed) {
  if (allowed.length === 0) return { ...CORS_HEADERS };
  /** @type {Record<string, string>} */
  const headers = {
    'Access-Control-Allow-Headers': CORS_HEADERS['Access-Control-Allow-Headers'],
    'Access-Control-Allow-Methods': CORS_HEADERS['Access-Control-Allow-Methods'],
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

// 아이디로 쓸 수 있는 문자열이면 NFC·공백 정리한 값, 아니면 null.
/** @param {unknown} value @returns {string | null} */
function metaId(value) {
  if (typeof value !== 'string') return null;
  const id = value.normalize('NFC').trim();
  return id ? id : null;
}

/**
 * Supabase auth 사용자 중 이 함수가 읽는 부분.
 * @typedef {{ id: string, email?: string | null, created_at?: string | null, last_sign_in_at?: string | null,
 *             app_metadata?: Record<string, any> | null, user_metadata?: Record<string, any> | null }} AuthUser
 */

/**
 * 프런트에 보여 줄 사용자. is_admin 은 예전 화면을 위해 남겨 둔다(role === 'admin' 과 같다).
 * @typedef {{ id: string, login_id: string | null, email: string | null, created_at: string | null,
 *             last_sign_in_at: string | null, is_admin: boolean, role: 'admin' | 'staff' | 'contractor' }} UserInfo
 */

// 목록·생성 응답에 보여 줄 아이디(계약 C4). 순서:
//   1) app_metadata.login_id — 서버(service_role)만 쓸 수 있어 믿을 수 있다.
//   2) user_metadata.login_id — 본인이 바꿀 수 있으므로, 그 아이디를 변환한 주소가 계정 이메일과 같을 때만 쓴다.
//   3) 이메일 복호화 — 우리 도메인(@sistech.local)이면 xn-- 를 한글로 풀어 쓴다. 다른 도메인이면 null.
/** @param {AuthUser} user @returns {string | null} */
export function resolveLoginId(user) {
  const fromApp = metaId(user.app_metadata?.login_id);
  if (fromApp) return fromApp;
  const email = String(user.email ?? '').toLowerCase();
  const fromUser = metaId(user.user_metadata?.login_id);
  if (fromUser && email && emailOrNull(fromUser) === email) return fromUser;
  return emailToLoginId(user.email);
}

// Supabase auth 사용자 → 프런트에 보여 줄 형태
/** @param {AuthUser} user @returns {UserInfo} */
export function toUserInfo(user) {
  return {
    id: user.id,
    login_id: resolveLoginId(user),
    email: user.email ?? null,
    created_at: user.created_at ?? null,
    last_sign_in_at: user.last_sign_in_at ?? null,
    is_admin: user.app_metadata?.role === 'admin',
    role: roleOf(user.app_metadata),
  };
}

// 아이디 가나다순(없으면 이메일 순). 아이디 있는 계정이 먼저 온다.
const collator = new Intl.Collator('ko');
/** @param {UserInfo[]} users @returns {UserInfo[]} */
export function sortUsers(users) {
  return [...users].sort((a, b) => {
    const ka = a.login_id ?? a.email ?? '';
    const kb = b.login_id ?? b.email ?? '';
    if (a.login_id !== null && b.login_id === null) return -1;
    if (a.login_id === null && b.login_id !== null) return 1;
    return collator.compare(ka, kb) || collator.compare(a.email ?? '', b.email ?? '');
  });
}

/** @param {Request} request */
function bearerToken(request) {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : '';
}

// Content-Length 가 한도를 넘는다고 미리 밝힌 요청인가(읽기 전에 거절할 수 있는 경우).
/** @param {Request} request @param {number} limit */
function declaredTooLarge(request, limit) {
  const declared = Number(request.headers.get('content-length'));
  return Number.isFinite(declared) && declared > limit;
}

// 본문을 limit 바이트까지만 읽는다. Content-Length 가 없거나 거짓이어도 읽는 도중 넘으면 413.
/** @param {Request} request @param {number} limit @returns {Promise<string>} */
async function readBodyLimited(request, limit) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, BODY_TOO_LARGE_MESSAGE);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// 관리자별 요청 횟수 제한(이동 창). isolate 메모리에만 두므로 인스턴스가 여러 개이거나 다시 뜨면 따로 센다.
// 정확한 과금 한도가 아니라, 탈취된 관리자 토큰이나 버그로 인한 폭주를 늦추는 대략적인 상한이다.
/** @param {{ limit: number, windowMs: number, now: () => number }} opts */
export function createRateLimiter({ limit, windowMs, now }) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  return {
    /** 받아들이면 0, 넘었으면 다시 시도할 수 있을 때까지 남은 초(1 이상). @param {string} key @returns {number} */
    take(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return Math.max(1, Math.ceil((recent[0] + windowMs - t) / 1000));
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 1000) {
        for (const [k, list] of hits) if (list.every((at) => t - at >= windowMs)) hits.delete(k);
      }
      return 0;
    },
  };
}

// Supabase Auth 오류를 우리 상태 코드로 옮긴다. 모르는 오류는 그대로 던져 500이 되게 한다.
/** @param {any} err */
function isEmailExists(err) {
  return err?.code === 'email_exists' || /already been registered/i.test(err?.message ?? '');
}

/** @param {any} err */
function isUserNotFound(err) {
  return err?.code === 'user_not_found' || /user not found/i.test(err?.message ?? '');
}

/**
 * index.ts 가 supabase-js 서비스 롤 클라이언트로 구현하는 인터페이스.
 * @typedef {object} AdminDeps
 * @property {(token: string) => Promise<AuthUser | null>} getUser  토큰이 무효하면 null
 * @property {() => Promise<AuthUser[]>} listUsers  전체 사용자(페이지를 끝까지)
 * @property {(attrs: CreateUserAttrs) => Promise<AuthUser>} createUser  중복이면 code 'email_exists' 오류를 던진다
 * @property {(id: string) => Promise<AuthUser>} getUserById  없으면 code 'user_not_found' 오류
 * @property {(id: string, attrs: UpdateUserAttrs) => Promise<AuthUser>} updateUserById  없으면 code 'user_not_found' 오류.
 *   app_metadata 는 기존 값에 병합된다(GoTrue 동작). 그래서 role 만 보내도 login_id 는 남는다.
 */

/**
 * @typedef {{ email: string, password: string, email_confirm: boolean,
 *             user_metadata: { login_id: string },
 *             app_metadata: { login_id: string, role: 'staff' | 'contractor' } }} CreateUserAttrs
 * @typedef {{ password: string } | { app_metadata: { role: 'staff' | 'contractor' } }} UpdateUserAttrs
 */

/**
 * @typedef {object} HandlerOptions
 * @property {string | string[]} [allowedOrigins]  ALLOWED_ORIGINS(쉼표 구분). 비우면 모든 출처('*')
 * @property {() => number} [now]  현재 시각(ms). 테스트용
 * @property {number} [rateLimit]  창 안에서 관리자 한 명이 보낼 수 있는 요청 수(기본 20)
 * @property {number} [rateWindowMs]  창 길이(기본 60초)
 * @property {number} [bodyLimit]  본문 최대 바이트(기본 16KB)
 */

/**
 * @param {AdminDeps} deps
 * @param {HandlerOptions} [options]
 * @returns {(request: Request) => Promise<Response>}
 */
export function createHandler(deps, options = {}) {
  const allowed = parseAllowedOrigins(options.allowedOrigins);
  const bodyLimit = options.bodyLimit ?? BODY_LIMIT_BYTES;
  const limiter = createRateLimiter({
    limit: options.rateLimit ?? RATE_LIMIT,
    windowMs: options.rateWindowMs ?? RATE_WINDOW_MS,
    now: options.now ?? (() => Date.now()),
  });

  /** @type {Record<string, (body: Record<string, any>, cors: Record<string, string>, caller: AuthUser) => Promise<Response>>} */
  const actions = {
    async list(_body, cors) {
      const users = await deps.listUsers();
      return json(200, { ok: true, users: sortUsers(users.map(toUserInfo)) }, cors);
    },

    async create(body, cors) {
      const login_id = normalizeLoginId(body.login_id);
      if (login_id === null) throw new HttpError(400, LOGIN_ID_RULE);
      const email = loginIdToEmail(login_id);
      const password = validatePassword(body.password);
      const role = validateRole(body.role, ROLE_STAFF);
      let user;
      try {
        // app_metadata.login_id 는 본인이 바꿀 수 없어 목록 표시의 기준이 된다(계약 C4).
        // 권한(role)도 본인이 못 바꾸는 app_metadata 에 둔다. 관리자는 여기서 만들 수 없다.
        user = await deps.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { login_id },
          app_metadata: { login_id, role },
        });
      } catch (err) {
        if (isEmailExists(err)) throw new HttpError(409, '이미 있는 아이디입니다.');
        throw err;
      }
      return json(200, { ok: true, user: toUserInfo(user) }, cors);
    },

    // 비밀번호 바꾸기. 다른 관리자 계정의 비밀번호는 바꾸지 않는다(본인 것은 된다). 대상 검사는 set_role과 같다.
    async reset_password(body, cors, caller) {
      const user_id = typeof body.user_id === 'string' ? body.user_id.trim() : '';
      if (!user_id) throw new HttpError(400, '대상 계정이 지정되지 않았습니다.');
      const password = validatePassword(body.password);
      try {
        if (user_id !== caller.id) {
          const target = await deps.getUserById(user_id);
          if (roleOf(target.app_metadata) === ROLE_ADMIN) throw new HttpError(400, ADMIN_PASSWORD_LOCKED_MESSAGE);
        }
        await deps.updateUserById(user_id, { password });
      } catch (err) {
        if (isUserNotFound(err)) throw new HttpError(404, '계정을 찾을 수 없습니다.');
        throw err;
      }
      return json(200, { ok: true }, cors);
    },

    // 직원 ↔ 외주 바꾸기. 관리자 계정(자기 자신 포함)은 바꾸지 않는다.
    async set_role(body, cors, caller) {
      const user_id = typeof body.user_id === 'string' ? body.user_id.trim() : '';
      if (!user_id) throw new HttpError(400, '대상 계정이 지정되지 않았습니다.');
      const role = validateRole(body.role, null);
      if (user_id === caller.id) throw new HttpError(400, ADMIN_ROLE_LOCKED_MESSAGE);
      let user;
      try {
        const target = await deps.getUserById(user_id);
        if (roleOf(target.app_metadata) === ROLE_ADMIN) throw new HttpError(400, ADMIN_ROLE_LOCKED_MESSAGE);
        // app_metadata 는 병합되므로 login_id 등 다른 키는 그대로 남는다.
        user = await deps.updateUserById(user_id, { app_metadata: { role } });
      } catch (err) {
        if (isUserNotFound(err)) throw new HttpError(404, '계정을 찾을 수 없습니다.');
        throw err;
      }
      return json(200, { ok: true, user: toUserInfo(user) }, cors);
    },
  };

  return async function handle(request) {
    const origin = request.headers.get('origin');
    const cors = corsHeaders(origin, allowed);
    try {
      // 허용 목록이 있는데 목록 밖 출처에서 온 브라우저 요청이면 아무것도 하지 않는다(Origin 없는 서버 호출은 통과).
      if (allowed.length > 0 && origin && !allowed.includes(origin)) throw new HttpError(403, ORIGIN_DENIED_MESSAGE);
      if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors });
      if (request.method !== 'POST') throw new HttpError(405, 'POST 요청만 받습니다.');
      if (declaredTooLarge(request, bodyLimit)) throw new HttpError(413, BODY_TOO_LARGE_MESSAGE);

      // 1) 토큰 검증 → 2) 관리자 확인 → 3) 횟수 제한 → 4) 본문 읽기(크기 제한)·해석 → 5) 작업 실행
      const token = bearerToken(request);
      if (!token) throw new HttpError(401, '로그인이 필요합니다.');
      const caller = await deps.getUser(token);
      if (!caller) throw new HttpError(401, '로그인 정보가 유효하지 않습니다. 다시 로그인해 주세요.');
      if (caller.app_metadata?.role !== 'admin') throw new HttpError(403, '관리자만 사용할 수 있습니다.');
      const retryAfter = limiter.take(String(caller.id));
      if (retryAfter > 0) throw new HttpError(429, RATE_LIMIT_MESSAGE, { 'Retry-After': String(retryAfter) });

      const text = await readBodyLimited(request, bodyLimit);
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new HttpError(400, '요청 본문이 올바른 JSON이 아닙니다.');
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, '요청 본문이 올바르지 않습니다.');
      }
      if (typeof body.action !== 'string' || !Object.hasOwn(actions, body.action)) {
        throw new HttpError(400, '알 수 없는 작업입니다.');
      }
      return await actions[body.action](body, cors, caller);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { ok: false, error: err.message }, cors, err.headers);
      console.error('admin-users 처리 중 예외:', err);
      return json(500, { ok: false, error: '서버에서 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, cors);
    }
  };
}
