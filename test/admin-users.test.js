// admin-users Edge Function 핸들러를 가짜 deps 로 검증한다(Supabase 접속 없음).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { domainToASCII } from 'node:url';
import { LOGIN_ID_RULE, PASSWORD_RULE, createHandler } from '../supabase/functions/admin-users/handler.js';
import { loginIdToEmail as browserLoginIdToEmail } from '../public/login-id.js';

const ADMIN_TOKEN = 'token-admin';
const USER_TOKEN = 'token-user';

// 메모리 안의 가짜 Auth 서버. 호출 기록도 남긴다.
function makeFakeDeps(seed = []) {
  const users = seed.map((u) => ({ ...u }));
  let nextId = 100;
  const calls = [];
  const deps = {
    users,
    calls,
    async getUser(token) {
      calls.push(['getUser', token]);
      if (token === ADMIN_TOKEN) return { id: 'admin-1', app_metadata: { role: 'admin' } };
      if (token === USER_TOKEN) return { id: 'user-1', app_metadata: {} };
      return null;
    },
    async listUsers() {
      calls.push(['listUsers']);
      return users.map((u) => ({ ...u }));
    },
    async createUser(attrs) {
      calls.push(['createUser', attrs]);
      if (users.some((u) => u.email === attrs.email)) {
        throw Object.assign(new Error('A user with this email address has already been registered'), {
          code: 'email_exists',
          status: 422,
        });
      }
      const user = {
        id: `u-${nextId++}`,
        email: attrs.email,
        created_at: '2026-11-06T00:00:00Z',
        last_sign_in_at: null,
        user_metadata: attrs.user_metadata,
        app_metadata: { provider: 'email' },
      };
      users.push(user);
      return { ...user };
    },
    async updateUserById(id, attrs) {
      calls.push(['updateUserById', id, attrs]);
      const user = users.find((u) => u.id === id);
      if (!user) throw Object.assign(new Error('User not found'), { code: 'user_not_found', status: 404 });
      Object.assign(user, attrs);
      return { ...user };
    },
  };
  return deps;
}

function post(body, { token = ADMIN_TOKEN, raw } = {}) {
  const headers = { 'content-type': 'application/json', apikey: 'anon' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request('http://edge/admin-users', {
    method: 'POST',
    headers,
    body: raw ?? JSON.stringify(body),
  });
}

async function call(deps, ...args) {
  const res = await createHandler(deps)(post(...args));
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const SEED = [
  { id: 'u-1', email: `${domainToASCII('황병용')}@sistech.local`, created_at: '2026-01-01T00:00:00Z', last_sign_in_at: '2026-02-01T00:00:00Z', user_metadata: { login_id: '황병용' }, app_metadata: { role: 'admin' } },
  { id: 'u-2', email: `${domainToASCII('손두병')}@sistech.local`, created_at: '2026-01-02T00:00:00Z', last_sign_in_at: null, user_metadata: { login_id: '손두병' }, app_metadata: {} },
  { id: 'u-3', email: 'zed@example.com', created_at: '2026-01-03T00:00:00Z', last_sign_in_at: null, user_metadata: {}, app_metadata: {} },
  { id: 'u-4', email: 'admin@sistech.local', created_at: '2026-01-04T00:00:00Z', last_sign_in_at: null, user_metadata: { login_id: 'admin' }, app_metadata: {} },
  { id: 'u-5', email: 'alpha@example.com', created_at: '2026-01-05T00:00:00Z', last_sign_in_at: null, user_metadata: null, app_metadata: null },
];

test('OPTIONS 는 CORS 헤더가 붙은 200 빈 응답', async () => {
  const res = await createHandler(makeFakeDeps())(new Request('http://edge/admin-users', { method: 'OPTIONS' }));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('access-control-allow-headers'), 'authorization, x-client-info, apikey, content-type');
  assert.equal(res.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
});

test('POST 가 아니면 405', async () => {
  const deps = makeFakeDeps();
  const res = await createHandler(deps)(new Request('http://edge/admin-users', { method: 'GET', headers: { authorization: `Bearer ${ADMIN_TOKEN}` } }));
  assert.equal(res.status, 405);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /POST/);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(deps.calls.length, 0, '토큰 검증 전에 거절해야 한다');
});

test('토큰이 없거나 무효하면 401', async () => {
  const deps = makeFakeDeps();
  const none = await call(deps, { action: 'list' }, { token: null });
  assert.equal(none.status, 401);
  assert.equal(none.body.ok, false);
  const bad = await call(deps, { action: 'list' }, { token: 'nope' });
  assert.equal(bad.status, 401);
  assert.deepEqual(deps.calls, [['getUser', 'nope']], '빈 토큰으로는 getUser 를 부르지 않는다');
});

test('관리자가 아니면 403, 작업은 실행되지 않는다', async () => {
  const deps = makeFakeDeps();
  const res = await call(deps, { action: 'create', login_id: '손두병', password: '123456' }, { token: USER_TOKEN });
  assert.equal(res.status, 403);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, '관리자만 사용할 수 있습니다.');
  assert.ok(!deps.calls.some(([name]) => name === 'createUser'));
  assert.equal(deps.users.length, 0);
});

test('list: 형태와 정렬(아이디 가나다순, 아이디 없는 계정은 이메일 순으로 뒤)', async () => {
  const res = await call(makeFakeDeps(SEED), { action: 'list' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(
    res.body.users.map((u) => u.login_id ?? u.email),
    ['손두병', '황병용', 'admin', 'alpha@example.com', 'zed@example.com'], // 한국어 정렬: 한글이 영문보다 앞
  );
  const first = res.body.users.find((u) => u.id === 'u-1');
  assert.deepEqual(first, {
    id: 'u-1',
    login_id: '황병용',
    email: `${domainToASCII('황병용')}@sistech.local`,
    created_at: '2026-01-01T00:00:00Z',
    last_sign_in_at: '2026-02-01T00:00:00Z',
    is_admin: true,
  });
  for (const u of res.body.users) {
    assert.deepEqual(Object.keys(u).sort(), ['created_at', 'email', 'id', 'is_admin', 'last_sign_in_at', 'login_id']);
    if (u.id !== 'u-1') assert.equal(u.is_admin, false);
  }
  const noMeta = res.body.users.find((u) => u.id === 'u-5');
  assert.equal(noMeta.login_id, null);
});

test('create: 성공하면 email_confirm 과 login_id 메타데이터를 붙여 만들고 같은 형태로 돌려준다', async () => {
  const deps = makeFakeDeps();
  const res = await call(deps, { action: 'create', login_id: '  손두병 ', password: '123456' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const created = deps.calls.find(([name]) => name === 'createUser')[1];
  assert.deepEqual(created, {
    email: `${domainToASCII('손두병')}@sistech.local`,
    password: '123456',
    email_confirm: true,
    user_metadata: { login_id: '손두병' },
  });
  assert.deepEqual(res.body.user, {
    id: 'u-100',
    login_id: '손두병',
    email: `${domainToASCII('손두병')}@sistech.local`,
    created_at: '2026-11-06T00:00:00Z',
    last_sign_in_at: null,
    is_admin: false,
  });
});

test('create: 이메일 변환이 브라우저 public/login-id.js 의 loginIdToEmail 과 일치한다', async () => {
  const ids = ['손두병', '황병용', '오성민', '이순호', '한혁주', '신지섭', '김용문', 'Admin', 'user_01', 'Mixed한글9'];
  // 무작위 아이디(고정 시드)
  let seed = 20261106;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pool = '가나다라마바사아자차카타파하손두병황용오성민이순호한혁주신지섭abcXYZ0189_';
  for (let n = 0; n < 200; n++) {
    const len = 1 + Math.floor(rand() * 16);
    let id = '';
    for (let j = 0; j < len; j++) id += pool[Math.floor(rand() * pool.length)];
    ids.push(id);
  }
  // 조합형 한글도 같은 결과여야 한다
  ids.push('손두병'.normalize('NFD'));

  for (const id of ids) {
    const deps = makeFakeDeps(); // 아이디마다 새 저장소(조합형·완성형이 중복으로 걸리지 않게)
    const res = await call(deps, { action: 'create', login_id: id, password: 'secret-pw' });
    assert.equal(res.status, 200, `${JSON.stringify(id)}: ${res.body.error}`);
    assert.equal(res.body.user.email, browserLoginIdToEmail(id), JSON.stringify(id));
    assert.equal(res.body.user.login_id, id.normalize('NFC').trim());
  }
});

test('create: 아이디 규칙 위반은 400', async () => {
  const deps = makeFakeDeps();
  for (const bad of ['', '   ', '손 두병', '손두병!', '손두병.', 'a'.repeat(17), 'some@mail.com', null, undefined, {}]) {
    const res = await call(deps, { action: 'create', login_id: bad, password: '123456' });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, LOGIN_ID_RULE, JSON.stringify(bad));
  }
  assert.equal(deps.users.length, 0);
});

test('create: 짧거나 잘못된 비밀번호는 400', async () => {
  const deps = makeFakeDeps();
  for (const bad of ['', '12345', 'x'.repeat(73), 123456, null, undefined]) {
    const res = await call(deps, { action: 'create', login_id: '손두병', password: bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.body.error, PASSWORD_RULE, JSON.stringify(bad));
  }
  assert.equal(deps.users.length, 0);
  // 경계: 6자, 72자는 통과
  assert.equal((await call(deps, { action: 'create', login_id: 'a6', password: '123456' })).status, 200);
  assert.equal((await call(deps, { action: 'create', login_id: 'a72', password: 'x'.repeat(72) })).status, 200);
});

test('create: 이미 있는 아이디는 409', async () => {
  const deps = makeFakeDeps(SEED);
  const res = await call(deps, { action: 'create', login_id: '손두병', password: '123456' });
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { ok: false, error: '이미 있는 아이디입니다.' });
  // 메시지로만 알려 주는 경우(code 없음)도 409
  const deps2 = makeFakeDeps();
  deps2.createUser = async () => {
    throw new Error('A user with this email address has already been registered');
  };
  const res2 = await call(deps2, { action: 'create', login_id: '손두병', password: '123456' });
  assert.equal(res2.status, 409);
});

test('reset_password: 성공 / 없는 user_id 는 404 / user_id 누락은 400', async () => {
  const deps = makeFakeDeps(SEED);
  const ok = await call(deps, { action: 'reset_password', user_id: 'u-2', password: 'newpass' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true });
  assert.deepEqual(deps.calls.at(-1), ['updateUserById', 'u-2', { password: 'newpass' }]);
  assert.equal(deps.users.find((u) => u.id === 'u-2').password, 'newpass');

  const missing = await call(deps, { action: 'reset_password', user_id: 'nope', password: 'newpass' });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.ok, false);

  const short = await call(deps, { action: 'reset_password', user_id: 'u-2', password: '12' });
  assert.equal(short.status, 400);
  assert.equal(short.body.error, PASSWORD_RULE);

  const noId = await call(deps, { action: 'reset_password', password: 'newpass' });
  assert.equal(noId.status, 400);
});

test('잘못된 JSON·본문·action 은 400', async () => {
  const deps = makeFakeDeps();
  const broken = await call(deps, null, { raw: '{not json' });
  assert.equal(broken.status, 400);
  assert.equal(broken.body.ok, false);
  const array = await call(deps, ['list']);
  assert.equal(array.status, 400);
  const unknown = await call(deps, { action: 'delete' });
  assert.equal(unknown.status, 400);
  const proto = await call(deps, { action: 'toString' });
  assert.equal(proto.status, 400);
  const none = await call(deps, {});
  assert.equal(none.status, 400);
});

test('예상 못 한 예외는 500 + 일반 메시지(상세는 console.error)', async () => {
  const deps = makeFakeDeps();
  deps.listUsers = async () => {
    throw new Error('연결 끊김 (비밀 상세)');
  };
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    const res = await call(deps, { action: 'list' });
    assert.equal(res.status, 500);
    assert.equal(res.body.ok, false);
    assert.ok(!res.body.error.includes('비밀 상세'), '상세 메시지는 응답에 나가면 안 된다');
    assert.equal(logged.length, 1);
  } finally {
    console.error = original;
  }
});
