// admin-users Edge Function 핸들러를 가짜 deps 로 검증한다(Supabase 접속 없음).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { domainToASCII } from 'node:url';
import {
  BODY_LIMIT_BYTES,
  BODY_TOO_LARGE_MESSAGE,
  LOGIN_ID_RULE,
  ORIGIN_DENIED_MESSAGE,
  PASSWORD_RULE,
  RATE_LIMIT,
  RATE_LIMIT_MESSAGE,
  createHandler,
  parseAllowedOrigins,
  resolveLoginId,
} from '../supabase/functions/admin-users/handler.js';
import { loginIdToEmail as browserLoginIdToEmail, normalizeLoginId as browserNormalize } from '../public/login-id.js';

const ADMIN_TOKEN = 'token-admin';
const ADMIN2_TOKEN = 'token-admin-2';
const USER_TOKEN = 'token-user';
const PW = 'Passw0rd12'; // 길이 규칙(6자 ~ 72바이트)에 맞는 비밀번호

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
      if (token === ADMIN2_TOKEN) return { id: 'admin-2', app_metadata: { role: 'admin' } };
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
        app_metadata: { provider: 'email', ...attrs.app_metadata }, // GoTrue 처럼 provider 와 병합
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

function post(body, { token = ADMIN_TOKEN, raw, origin, headers: extra = {} } = {}) {
  const headers = { 'content-type': 'application/json', apikey: 'anon', ...extra };
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  return new Request('http://edge/admin-users', {
    method: 'POST',
    headers,
    body: raw ?? JSON.stringify(body),
  });
}

async function call(deps, body, opts = {}, handlerOptions = {}) {
  const handler = opts.handler ?? createHandler(deps, handlerOptions);
  const res = await handler(post(body, opts));
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
  const res = await call(deps, { action: 'create', login_id: '손두병', password: PW }, { token: USER_TOKEN });
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

test('login_id 결정 순서(계약 C4): app_metadata → user_metadata(이메일과 맞을 때만) → 이메일 복호화', () => {
  const kimEmail = `${domainToASCII('김용문')}@sistech.local`;
  const sonEmail = `${domainToASCII('손두병')}@sistech.local`;
  // 1) app_metadata 가 있으면 그것
  assert.equal(resolveLoginId({ id: 'a', email: kimEmail, app_metadata: { login_id: '김용문' }, user_metadata: { login_id: '손두병' } }), '김용문');
  // 2) app_metadata 가 없고 user_metadata 가 이메일과 맞으면 그것(NFC 정리)
  assert.equal(resolveLoginId({ id: 'b', email: kimEmail, user_metadata: { login_id: ' 김용문'.normalize('NFD') } }), '김용문');
  // 본인이 user_metadata 를 남의 이름으로 바꿔도 목록에는 이메일에서 되살린 진짜 아이디가 보인다
  assert.equal(resolveLoginId({ id: 'c', email: sonEmail, app_metadata: {}, user_metadata: { login_id: '김용문' } }), '손두병');
  assert.equal(resolveLoginId({ id: 'd', email: sonEmail, user_metadata: { login_id: 42 } }), '손두병');
  // 3) 메타데이터가 없으면(대시보드에서 만든 계정) 이메일 복호화
  assert.equal(resolveLoginId({ id: 'e', email: kimEmail }), '김용문');
  assert.equal(resolveLoginId({ id: 'f', email: 'ADMIN@SISTECH.LOCAL', app_metadata: null, user_metadata: null }), 'ADMIN');
  // 예전 규칙(숫자 시작)으로 만든 계정도 이메일에서 되살린다
  assert.equal(resolveLoginId({ id: 'g', email: '1abc@sistech.local', user_metadata: { login_id: '1abc' } }), '1abc');
  // 다른 도메인 이메일은 아이디가 없다(화면은 이메일을 보여 준다)
  assert.equal(resolveLoginId({ id: 'h', email: 'zed@example.com', user_metadata: { login_id: 'zed' } }), null);
  assert.equal(resolveLoginId({ id: 'i', email: null }), null);
});

test('list: 위조된 user_metadata 는 무시하고, 메타데이터 없는 계정은 이메일에서 아이디를 되살린다', async () => {
  const seed = [
    ...SEED,
    { id: 'u-6', email: `${domainToASCII('김용문')}@sistech.local`, user_metadata: {}, app_metadata: {} },
    { id: 'u-7', email: `${domainToASCII('오성민')}@sistech.local`, user_metadata: { login_id: '황병용' }, app_metadata: {} },
  ];
  const res = await call(makeFakeDeps(seed), { action: 'list' });
  assert.equal(res.status, 200);
  const byId = Object.fromEntries(res.body.users.map((u) => [u.id, u.login_id]));
  assert.equal(byId['u-6'], '김용문');
  assert.equal(byId['u-7'], '오성민');
  assert.equal(res.body.users.filter((u) => u.login_id === '황병용').length, 1, '같은 이름이 두 번 보이면 안 된다');
});

test('create: 성공하면 email_confirm, user_metadata·app_metadata 의 login_id 를 붙여 만들고 같은 형태로 돌려준다', async () => {
  const deps = makeFakeDeps();
  const res = await call(deps, { action: 'create', login_id: '  손두병 ', password: PW });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const created = deps.calls.find(([name]) => name === 'createUser')[1];
  assert.deepEqual(created, {
    email: `${domainToASCII('손두병')}@sistech.local`,
    password: PW,
    email_confirm: true,
    user_metadata: { login_id: '손두병' },
    app_metadata: { login_id: '손두병' },
  });
  assert.deepEqual(res.body.user, {
    id: 'u-100',
    login_id: '손두병',
    email: `${domainToASCII('손두병')}@sistech.local`,
    created_at: '2026-11-06T00:00:00Z',
    last_sign_in_at: null,
    is_admin: false,
  });
  assert.equal(deps.users[0].app_metadata.provider, 'email', 'app_metadata 는 기존 키와 병합된다');
});

test('create: 이메일 변환이 브라우저 public/login-id.js 의 loginIdToEmail 과 일치한다(거부도 같다)', async () => {
  const ids = ['손두병', '황병용', '오성민', '이순호', '한혁주', '신지섭', '김용문', 'Admin', 'user_01', 'Mixed한글9'];
  // 무작위 아이디(고정 시드). 숫자·밑줄로 시작하는 것은 양쪽 모두 거부해야 한다.
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

  let accepted = 0;
  let rejected = 0;
  for (const id of ids) {
    const deps = makeFakeDeps(); // 아이디마다 새 저장소(조합형·완성형이 중복으로 걸리지 않게)
    const res = await call(deps, { action: 'create', login_id: id, password: PW });
    if (browserNormalize(id) === null) {
      rejected++;
      assert.equal(res.status, 400, JSON.stringify(id));
      assert.equal(res.body.error, LOGIN_ID_RULE);
      assert.throws(() => browserLoginIdToEmail(id), { message: LOGIN_ID_RULE });
      continue;
    }
    accepted++;
    assert.equal(res.status, 200, `${JSON.stringify(id)}: ${res.body.error}`);
    assert.equal(res.body.user.email, browserLoginIdToEmail(id), JSON.stringify(id));
    assert.equal(res.body.user.login_id, id.normalize('NFC').trim());
  }
  assert.ok(accepted > 100 && rejected > 10, `허용 ${accepted}, 거부 ${rejected}`);
});

test('create: 아이디 규칙 위반은 400(숫자·밑줄로 시작하는 아이디 포함)', async () => {
  const deps = makeFakeDeps();
  const bads = ['', '   ', '손 두병', '손두병!', '손두병.', 'a'.repeat(17), 'some@mail.com', null, undefined, {}];
  bads.push('123', '0x7b', '0173', '1abc', '_abc', '9손두병');
  for (const bad of bads) {
    const res = await call(deps, { action: 'create', login_id: bad, password: PW });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, LOGIN_ID_RULE, JSON.stringify(bad));
  }
  assert.equal(deps.users.length, 0);
});

test('create: 비밀번호 길이(6자 ~ 72바이트) 위반은 400 + 같은 문구', async () => {
  assert.equal(PASSWORD_RULE, '비밀번호는 6자 이상 72자 이하여야 합니다.');
  const deps = makeFakeDeps();
  const bads = [
    '', '1', '12345', 'abcde', // 짧음(5자까지)
    'x'.repeat(73), // 73자: 상한 초과도 같은 문구
    'a1' + '가'.repeat(24), // 26자지만 74바이트(bcrypt 한계)
    123456, null, undefined, ['Passw0rd12'],
  ];
  for (const bad of bads) {
    const res = await call(deps, { action: 'create', login_id: '손두병', password: bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.body.error, PASSWORD_RULE, JSON.stringify(bad));
  }
  assert.equal(deps.users.length, 0);
  // 경계: 6자, 72바이트는 통과
  assert.equal((await call(deps, { action: 'create', login_id: 'a6', password: '123456' })).status, 200);
  assert.equal((await call(deps, { action: 'create', login_id: 'a72', password: 'x'.repeat(72) })).status, 200);
});

test('create: 문자 조건 없음 — 관리자가 정한 비밀번호(숫자만·영문만·한글·기호)를 그대로 쓴다', async () => {
  const deps = makeFakeDeps();
  const passwords = ['112233', 'abcdef', '비밀번호여섯', '!@#$%^', 'Pass word 1'];
  for (const [i, password] of passwords.entries()) {
    const res = await call(deps, { action: 'create', login_id: `user${i}`, password });
    assert.equal(res.status, 200, password);
    assert.equal(deps.calls.at(-1)[1].password, password, '손대지 않고 그대로 넘긴다');
  }
});

test('create: 이미 있는 아이디는 409', async () => {
  const deps = makeFakeDeps(SEED);
  const res = await call(deps, { action: 'create', login_id: '손두병', password: PW });
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { ok: false, error: '이미 있는 아이디입니다.' });
  // 메시지로만 알려 주는 경우(code 없음)도 409
  const deps2 = makeFakeDeps();
  deps2.createUser = async () => {
    throw new Error('A user with this email address has already been registered');
  };
  const res2 = await call(deps2, { action: 'create', login_id: '손두병', password: PW });
  assert.equal(res2.status, 409);
});

test('reset_password: 성공 / 없는 user_id 는 404 / user_id 누락은 400 / 길이 위반은 400', async () => {
  const deps = makeFakeDeps(SEED);
  const ok = await call(deps, { action: 'reset_password', user_id: 'u-2', password: 'newpass123' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true });
  assert.deepEqual(deps.calls.at(-1), ['updateUserById', 'u-2', { password: 'newpass123' }]);
  assert.equal(deps.users.find((u) => u.id === 'u-2').password, 'newpass123');

  const missing = await call(deps, { action: 'reset_password', user_id: 'nope', password: 'newpass123' });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.ok, false);

  assert.equal((await call(deps, { action: 'reset_password', user_id: 'u-2', password: '112233' })).status, 200);
  for (const bad of ['12', '12345', 'x1'.repeat(37)]) {
    const res = await call(deps, { action: 'reset_password', user_id: 'u-2', password: bad });
    assert.equal(res.status, 400, bad);
    assert.equal(res.body.error, PASSWORD_RULE);
  }

  const noId = await call(deps, { action: 'reset_password', password: 'newpass123' });
  assert.equal(noId.status, 400);
});

test('잘못된 JSON·본문·action 은 400', async () => {
  const deps = makeFakeDeps();
  const handler = createHandler(deps, { rateLimit: 1000 });
  const broken = await call(deps, null, { raw: '{not json', handler });
  assert.equal(broken.status, 400);
  assert.equal(broken.body.ok, false);
  const empty = await call(deps, null, { raw: '', handler });
  assert.equal(empty.status, 400);
  const array = await call(deps, ['list'], { handler });
  assert.equal(array.status, 400);
  const unknown = await call(deps, { action: 'delete' }, { handler });
  assert.equal(unknown.status, 400);
  const proto = await call(deps, { action: 'toString' }, { handler });
  assert.equal(proto.status, 400);
  const nonString = await call(deps, { action: ['list'] }, { handler });
  assert.equal(nonString.status, 400);
  const none = await call(deps, {}, { handler });
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

// ---- 요청 크기 제한(413) ----

test('본문이 16KB를 넘으면 413: Content-Length 로 밝히면 토큰 검증 전에 거절한다', async () => {
  assert.equal(BODY_LIMIT_BYTES, 16 * 1024);
  const deps = makeFakeDeps();
  const big = JSON.stringify({ action: 'list', pad: 'x'.repeat(BODY_LIMIT_BYTES) });
  const res = await call(deps, null, { raw: big, headers: { 'content-length': String(Buffer.byteLength(big)) } });
  assert.equal(res.status, 413);
  assert.deepEqual(res.body, { ok: false, error: BODY_TOO_LARGE_MESSAGE });
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(deps.calls.length, 0, 'getUser 를 부르지 않는다');
});

test('본문이 16KB를 넘으면 413: Content-Length 가 없어도 읽는 도중 끊는다(작업은 실행되지 않음)', async () => {
  const deps = makeFakeDeps();
  // 한글은 3바이트라 글자 수로는 한도 아래여도 바이트로는 넘는다
  const big = JSON.stringify({ action: 'create', login_id: '손두병', password: PW, pad: '가'.repeat(6000) });
  assert.ok(big.length < BODY_LIMIT_BYTES && Buffer.byteLength(big) > BODY_LIMIT_BYTES);
  const res = await call(deps, null, { raw: big });
  assert.equal(res.status, 413);
  assert.equal(res.body.error, BODY_TOO_LARGE_MESSAGE);
  assert.ok(!deps.calls.some(([name]) => name === 'createUser'));

  // 경계: 정확히 한도까지는 받는다
  const base = JSON.stringify({ action: 'list', pad: '' });
  const exact = JSON.stringify({ action: 'list', pad: 'x'.repeat(BODY_LIMIT_BYTES - Buffer.byteLength(base)) });
  assert.equal(Buffer.byteLength(exact), BODY_LIMIT_BYTES);
  assert.equal((await call(makeFakeDeps(), null, { raw: exact })).status, 200);
});

// ---- 관리자별 요청 횟수 제한(429) ----

test('관리자 한 명이 1분에 20회를 넘기면 429 + Retry-After, 다른 관리자는 따로 센다, 1분 지나면 풀린다', async () => {
  assert.equal(RATE_LIMIT, 20);
  let now = 1_000_000;
  const deps = makeFakeDeps(SEED);
  const handler = createHandler(deps, { now: () => now });
  for (let i = 0; i < RATE_LIMIT; i++) {
    const res = await call(deps, { action: 'list' }, { handler });
    assert.equal(res.status, 200, `${i + 1}번째`);
    now += 1000; // 1초 간격 → 20번째는 19초 시점
  }
  const listCalls = deps.calls.filter(([n]) => n === 'listUsers').length;
  const over = await call(deps, { action: 'list' }, { handler });
  assert.equal(over.status, 429);
  assert.deepEqual(over.body, { ok: false, error: RATE_LIMIT_MESSAGE });
  assert.equal(over.headers.get('retry-after'), '40', '첫 요청(0초)이 60초에 빠지므로 20초 시점에서 40초 남음');
  assert.equal(over.headers.get('access-control-allow-origin'), '*');
  assert.equal(deps.calls.filter(([n]) => n === 'listUsers').length, listCalls, '429 면 작업을 실행하지 않는다');

  // 다른 관리자는 영향 없음
  assert.equal((await call(deps, { action: 'list' }, { handler, token: ADMIN2_TOKEN })).status, 200);

  // 가장 오래된 요청이 창 밖으로 나가면 다시 받는다
  now = 1_000_000 + 60_000;
  assert.equal((await call(deps, { action: 'list' }, { handler })).status, 200);
  assert.equal((await call(deps, { action: 'list' }, { handler })).status, 429, '두 번째로 오래된 요청(1초)은 아직 창 안');
});

test('횟수 제한은 관리자 확인 뒤에 센다(관리자 아닌 요청·토큰 없는 요청은 관리자 몫을 쓰지 않음)', async () => {
  const deps = makeFakeDeps();
  const handler = createHandler(deps, { now: () => 0 });
  for (let i = 0; i < 30; i++) {
    assert.equal((await call(deps, { action: 'list' }, { handler, token: USER_TOKEN })).status, 403);
  }
  assert.equal((await call(deps, { action: 'list' }, { handler })).status, 200);
});

// ---- Origin 제한(ALLOWED_ORIGINS) ----

test('parseAllowedOrigins: 쉼표 구분, 공백·끝 슬래시 정리, 빈 값 무시', () => {
  assert.deepEqual(parseAllowedOrigins(' https://sistech.dpdns.org/ , http://localhost:4100,, '), ['https://sistech.dpdns.org', 'http://localhost:4100']);
  assert.deepEqual(parseAllowedOrigins(''), []);
  assert.deepEqual(parseAllowedOrigins(undefined), []);
});

test('ALLOWED_ORIGINS 미설정이면 지금처럼 * 를 돌려준다(Origin 이 무엇이든)', async () => {
  const res = await call(makeFakeDeps(), { action: 'list' }, { origin: 'https://evil.example' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('vary'), null);
});

test('ALLOWED_ORIGINS 설정 시 일치하는 Origin 만 그 값을 돌려주고, 다른 Origin 은 403(Allow-Origin 없음)', async () => {
  const options = { allowedOrigins: 'https://sistech.dpdns.org, http://localhost:4100' };
  const deps = makeFakeDeps();
  const handler = createHandler(deps, options);

  const ok = await call(deps, { action: 'list' }, { handler, origin: 'https://sistech.dpdns.org' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://sistech.dpdns.org');
  assert.equal(ok.headers.get('vary'), 'Origin');

  const preflight = await handler(new Request('http://edge/admin-users', { method: 'OPTIONS', headers: { origin: 'http://localhost:4100' } }));
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:4100');
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS');

  const callsBefore = deps.calls.length;
  const evil = await call(deps, { action: 'list' }, { handler, origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  assert.equal(evil.body.error, ORIGIN_DENIED_MESSAGE);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  assert.equal(deps.calls.length, callsBefore, '토큰 검증도 하지 않는다');

  const evilPreflight = await handler(new Request('http://edge/admin-users', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
  assert.equal(evilPreflight.status, 403);
  assert.equal(evilPreflight.headers.get('access-control-allow-origin'), null);

  // Origin 헤더가 없는 서버 간 호출은 (관리자 토큰이 있으면) 그대로 받는다
  const noOrigin = await call(deps, { action: 'list' }, { handler });
  assert.equal(noOrigin.status, 200);
  assert.equal(noOrigin.headers.get('access-control-allow-origin'), null);
});
