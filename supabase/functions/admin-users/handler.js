// admin-users Edge Function의 핵심 로직. Deno API나 supabase-js에 직접 기대지 않는 순수 ESM이라
// Node의 node:test 로도 가짜 deps를 넣어 검증할 수 있다. 진입점은 index.ts.
//
// 요청: POST JSON { action: 'list' | 'create' | 'reset_password', login_id?, password?, user_id? }
//       헤더 Authorization: Bearer <로그인 사용자의 access token>
// 관리자(app_metadata.role === 'admin')만 허용하며, 토큰 검증은 서비스 롤 클라이언트의 getUser 로 서버에서 한다.

// ---- 아이디 규칙: public/login-id.js 의 loginIdToEmail 과 같은 결과를 내야 한다 ----
// (배포 번들러가 supabase/functions/ 밖 파일을 포함하지 않아 import 대신 규칙을 그대로 옮겼다.)
export const LOGIN_DOMAIN = 'sistech.local';
export const LOGIN_ID_MAX = 16;
export const LOGIN_ID_RULE = `아이디는 한글·영문·숫자·밑줄 1~${LOGIN_ID_MAX}자여야 합니다.`;
export const PASSWORD_RULE = '비밀번호는 6자 이상이어야 합니다.';
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 72; // bcrypt 한계

const ID_PATTERN = /^[가-힣A-Za-z0-9_]+$/;

// 앞뒤 공백을 떼고 한글 조합 형태를 통일한다. 규칙에 어긋나면 null.
export function normalizeLoginId(raw) {
  const id = String(raw ?? '').normalize('NFC').trim();
  if (id.length < 1 || id.length > LOGIN_ID_MAX || !ID_PATTERN.test(id)) return null;
  return id;
}

// 아이디 → 로그인 이메일. 영문은 소문자로, 한글은 IDNA(xn--) 형태로 바뀐다.
export function loginIdToEmail(raw) {
  const id = normalizeLoginId(raw);
  if (id === null) throw new HttpError(400, LOGIN_ID_RULE);
  let local;
  try {
    local = new URL(`http://${id}/`).hostname;
  } catch {
    throw new HttpError(400, LOGIN_ID_RULE);
  }
  if (!local || local.length > 64) throw new HttpError(400, LOGIN_ID_RULE);
  return `${local}@${LOGIN_DOMAIN}`;
}

function validatePassword(raw) {
  if (typeof raw !== 'string' || raw.length < PASSWORD_MIN || raw.length > PASSWORD_MAX) {
    throw new HttpError(400, PASSWORD_RULE);
  }
  return raw;
}

// ---- 응답 도우미 ----
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 상태 코드가 붙은 오류. 핸들러 바깥으로 나가면 그 코드와 메시지로 응답한다.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function fail(status, error) {
  return json(status, { ok: false, error });
}

// Supabase auth 사용자 → 프런트에 보여 줄 형태
export function toUserInfo(user) {
  return {
    id: user.id,
    login_id: user.user_metadata?.login_id ?? null,
    email: user.email ?? null,
    created_at: user.created_at ?? null,
    last_sign_in_at: user.last_sign_in_at ?? null,
    is_admin: user.app_metadata?.role === 'admin',
  };
}

// 아이디 가나다순(없으면 이메일 순). 아이디 있는 계정이 먼저 온다.
const collator = new Intl.Collator('ko');
export function sortUsers(users) {
  return [...users].sort((a, b) => {
    const ka = a.login_id ?? a.email ?? '';
    const kb = b.login_id ?? b.email ?? '';
    if (a.login_id !== null && b.login_id === null) return -1;
    if (a.login_id === null && b.login_id !== null) return 1;
    return collator.compare(ka, kb) || collator.compare(a.email ?? '', b.email ?? '');
  });
}

function bearerToken(request) {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : '';
}

// Supabase Auth 오류를 우리 상태 코드로 옮긴다. 모르는 오류는 그대로 던져 500이 되게 한다.
function isEmailExists(err) {
  return err?.code === 'email_exists' || /already been registered/i.test(err?.message ?? '');
}

function isUserNotFound(err) {
  return err?.code === 'user_not_found' || /user not found/i.test(err?.message ?? '');
}

/**
 * deps 인터페이스(index.ts 가 supabase-js 서비스 롤 클라이언트로 구현한다):
 *   getUser(token)            → 사용자 객체 또는 null(토큰 무효)
 *   listUsers()               → 사용자 객체 배열(전체)
 *   createUser(attrs)         → 만든 사용자 객체. 중복이면 code 'email_exists' 오류를 던진다
 *   updateUserById(id, attrs) → 없으면 code 'user_not_found' 오류를 던진다
 * 돌려주는 핸들러는 (request: Request) => Promise<Response>.
 */
export function createHandler(deps) {
  const actions = {
    async list() {
      const users = await deps.listUsers();
      return json(200, { ok: true, users: sortUsers(users.map(toUserInfo)) });
    },

    async create(body) {
      const login_id = normalizeLoginId(body.login_id);
      if (login_id === null) throw new HttpError(400, LOGIN_ID_RULE);
      const email = loginIdToEmail(login_id);
      const password = validatePassword(body.password);
      let user;
      try {
        user = await deps.createUser({ email, password, email_confirm: true, user_metadata: { login_id } });
      } catch (err) {
        if (isEmailExists(err)) throw new HttpError(409, '이미 있는 아이디입니다.');
        throw err;
      }
      return json(200, { ok: true, user: toUserInfo(user) });
    },

    async reset_password(body) {
      const user_id = typeof body.user_id === 'string' ? body.user_id.trim() : '';
      if (!user_id) throw new HttpError(400, '대상 계정이 지정되지 않았습니다.');
      const password = validatePassword(body.password);
      try {
        await deps.updateUserById(user_id, { password });
      } catch (err) {
        if (isUserNotFound(err)) throw new HttpError(404, '계정을 찾을 수 없습니다.');
        throw err;
      }
      return json(200, { ok: true });
    },
  };

  return async function handle(request) {
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS_HEADERS });
      if (request.method !== 'POST') throw new HttpError(405, 'POST 요청만 받습니다.');

      // 1) 토큰 검증 → 2) 관리자 확인 → 3) 본문 해석 → 4) 작업 실행
      const token = bearerToken(request);
      if (!token) throw new HttpError(401, '로그인이 필요합니다.');
      const caller = await deps.getUser(token);
      if (!caller) throw new HttpError(401, '로그인 정보가 유효하지 않습니다. 다시 로그인해 주세요.');
      if (caller.app_metadata?.role !== 'admin') throw new HttpError(403, '관리자만 사용할 수 있습니다.');

      let body;
      try {
        body = await request.json();
      } catch {
        throw new HttpError(400, '요청 본문이 올바른 JSON이 아닙니다.');
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, '요청 본문이 올바르지 않습니다.');
      }
      const action = actions[body.action];
      if (!action || !Object.hasOwn(actions, body.action)) throw new HttpError(400, '알 수 없는 작업입니다.');
      return await action(body);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.message);
      console.error('admin-users 처리 중 예외:', err);
      return fail(500, '서버에서 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  };
}
