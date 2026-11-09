import assert from 'node:assert/strict';
import { test } from 'node:test';
import { domainToASCII, domainToUnicode } from 'node:url';
import * as browser from '../public/login-id.js';
import * as edge from '../supabase/functions/admin-users/handler.js';

const { LOGIN_DOMAIN, LOGIN_ID_RULE, emailToLoginId, loginIdToEmail, normalizeLoginId, punycodeDecode } = browser;

test('한글 아이디는 Node의 IDNA 결과와 같은 이메일이 된다', () => {
  for (const id of ['손두병', '황병용', '오성민', '이순호', '한혁주', '신지섭', '김철수1', '박_영희']) {
    assert.equal(loginIdToEmail(id), `${domainToASCII(id)}@${LOGIN_DOMAIN}`);
  }
});

test('영문 아이디는 소문자로만 바뀌고 그대로 쓰인다', () => {
  assert.equal(loginIdToEmail('Admin'), `admin@${LOGIN_DOMAIN}`);
  assert.equal(loginIdToEmail('  user_01 '), `user_01@${LOGIN_DOMAIN}`);
});

test('이메일을 넣으면 그대로 돌려준다(이메일 계정 허용)', () => {
  assert.equal(loginIdToEmail('Someone@Example.com'), 'someone@example.com');
  assert.equal(emailToLoginId('someone@example.com'), 'someone@example.com');
});

test('규칙에 어긋나는 아이디는 거부한다', () => {
  for (const bad of ['', '   ', '손 두병', '손두병!', '손두병.', 'a'.repeat(17), '한글이름이너무길어서열여섯자를넘긴다', null, undefined]) {
    assert.equal(normalizeLoginId(bad), null, JSON.stringify(bad));
    assert.throws(() => loginIdToEmail(bad), { message: LOGIN_ID_RULE }, JSON.stringify(bad));
  }
});

test('조합형 한글도 완성형으로 맞춰 같은 이메일이 된다', () => {
  const composed = '손두병';
  const decomposed = composed.normalize('NFD');
  assert.notEqual(composed, decomposed);
  assert.equal(loginIdToEmail(decomposed), loginIdToEmail(composed));
});

test('이메일에서 아이디를 되살린다(왕복)', () => {
  for (const id of ['손두병', '황병용', '김철수1', '박_영희', 'admin', 'Mixed한글9']) {
    const email = loginIdToEmail(id);
    assert.equal(emailToLoginId(email), domainToUnicode(email.split('@')[0]));
  }
  assert.equal(emailToLoginId('손두병'), '손두병'); // '@'가 없으면 그대로
  assert.equal(emailToLoginId(''), '');
});

test('punycode 복호화가 Node와 같다(무작위 한글·영문 혼합 300개)', () => {
  let seed = 20261106;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pool = '가나다라마바사아자차카타파하손두병황용오성민이순호한혁주신지섭abcxyz0189_';
  for (let n = 0; n < 300; n++) {
    const len = 1 + Math.floor(rand() * 16);
    let id = '';
    for (let j = 0; j < len; j++) id += pool[Math.floor(rand() * pool.length)];
    const ascii = domainToASCII(id);
    if (!ascii.startsWith('xn--')) continue;
    assert.equal(punycodeDecode(ascii.slice(4)), domainToUnicode(ascii), id);
  }
});

test('깨진 punycode는 원문을 그대로 보여 준다', () => {
  assert.equal(emailToLoginId(`xn--@${LOGIN_DOMAIN}`), 'xn--');
  assert.equal(emailToLoginId(`xn--!!!@${LOGIN_DOMAIN}`), 'xn--!!!');
});

// ---- 아이디 첫 글자 규칙(계약 C5) ----

test('숫자·밑줄로 시작하는 아이디는 거부한다(IPv4로 읽혀 0x7b·0173·123이 한 계정이 되던 문제)', () => {
  for (const bad of ['123', '0x7b', '0173', '0', '1abc', '9손두병', '_abc', '_', '0.0.0.123', '1.2.3.4']) {
    assert.equal(normalizeLoginId(bad), null, bad);
    assert.throws(() => loginIdToEmail(bad), { message: LOGIN_ID_RULE }, bad);
  }
  // 한글·영문으로 시작하면 뒤에 숫자·밑줄은 괜찮다
  assert.equal(loginIdToEmail('a123'), `a123@${LOGIN_DOMAIN}`);
  assert.equal(loginIdToEmail('x7b'), `x7b@${LOGIN_DOMAIN}`);
  assert.equal(loginIdToEmail('김_1'), `${domainToASCII('김_1')}@${LOGIN_DOMAIN}`);
});

test('기존 계정 7개(한글 이름)의 로그인 이메일은 규칙 변경 뒤에도 그대로다', () => {
  const existing = {
    손두병: 'xn--hu1b84nd3d@sistech.local',
    황병용: 'xn--om3b23pt7m@sistech.local',
    오성민: 'xn--lg3b78guye@sistech.local',
    이순호: 'xn--eq4bt1hb4o@sistech.local',
    한혁주: 'xn--o55b99tfoa@sistech.local',
    신지섭: 'xn--kj4b34a43l@sistech.local',
    김용문: 'xn--4k0bz9vb1i@sistech.local',
  };
  for (const [id, email] of Object.entries(existing)) {
    assert.equal(loginIdToEmail(id), email, id);
    assert.equal(edge.loginIdToEmail(id), email, id);
    assert.equal(emailToLoginId(email), id);
    assert.equal(edge.emailToLoginId(email), id);
  }
});

// ---- 두 구현(public/login-id.js ↔ supabase/functions/admin-users/handler.js) 동기화 ----

test('두 구현의 상수가 같다', () => {
  for (const key of ['LOGIN_DOMAIN', 'LOGIN_ID_MAX', 'LOGIN_ID_RULE', 'PASSWORD_MIN', 'PASSWORD_MAX', 'PASSWORD_RULE']) {
    assert.ok(key in browser && key in edge, `${key}가 두 파일 모두에서 export 되어야 한다`);
    assert.equal(edge[key], browser[key], key);
  }
  assert.equal(browser.PASSWORD_MIN, 6);
  assert.equal(browser.PASSWORD_MAX, 72);
  assert.equal(browser.PASSWORD_RULE, '비밀번호는 6자 이상 72자 이하여야 합니다.');
});

// 결과를 { ok, value | message } 로 바꿔 두 구현을 비교한다.
function attempt(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

const ID_CASES = [
  // 허용(10개)
  '손두병', '김용문', 'Admin', '  user_01 ', 'Mixed한글9', 'a', 'x7b', '가'.repeat(16), 'a'.repeat(16),
  '손두병'.normalize('NFD'), // 조합형 한글(NFD) → 완성형으로 맞춰 허용
  // 거부
  '', '   ', '\t', '손 두병', '손두병!', '손두병.', 'a-b', 'a.b', 'a'.repeat(17), '가'.repeat(17),
  '1abc', '_abc', '123', '0x7b', '0173', '0.0.0.123', 'ａｂｃ', 'é', 'ㄱㄴ', '손두병\u0000',
  null, undefined, 123, {}, [],
];

test('아이디 허용·거부와 정규화 값이 두 구현에서 같다', () => {
  let accepted = 0;
  for (const raw of ID_CASES) {
    const label = JSON.stringify(raw) ?? String(raw);
    assert.equal(edge.normalizeLoginId(raw), normalizeLoginId(raw), label);
    const b = attempt(() => loginIdToEmail(raw));
    const e = attempt(() => edge.loginIdToEmail(raw));
    assert.deepEqual(e, b, label);
    if (b.ok) accepted++;
    else assert.equal(b.message, LOGIN_ID_RULE, label);
  }
  assert.equal(accepted, 10, '허용 사례 수가 바뀌었다면 목록을 다시 확인할 것');
});

test('아이디 → 이메일 → 아이디 복원이 두 구현에서 같다(무작위 400개, 거부 포함)', () => {
  let seed = 20261109;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pool = '가나다라손두병황용김문abcXYZ0189_ -.!';
  let accepted = 0;
  for (let n = 0; n < 400; n++) {
    const len = Math.floor(rand() * 18);
    let id = '';
    for (let j = 0; j < len; j++) id += pool[Math.floor(rand() * pool.length)];
    const b = attempt(() => loginIdToEmail(id));
    assert.deepEqual(attempt(() => edge.loginIdToEmail(id)), b, JSON.stringify(id));
    if (!b.ok) continue;
    accepted++;
    assert.equal(edge.emailToLoginId(b.value), emailToLoginId(b.value), b.value);
  }
  assert.ok(accepted > 20 && accepted < 400, `허용 ${accepted}개: 허용·거부가 모두 섞여야 의미 있는 비교다`);
});

test('punycode 복호화 코드가 두 구현에서 같다', () => {
  for (const id of ['손두병', '김용문', 'Mixed한글9', '박_영희', '가'.repeat(16)]) {
    const local = domainToASCII(id);
    assert.equal(edge.punycodeDecode(local.slice(4)), punycodeDecode(local.slice(4)), id);
  }
  assert.throws(() => edge.punycodeDecode('!!!'));
  assert.throws(() => punycodeDecode('!!!'));
});

// ---- 비밀번호 규칙 ----

const PASSWORD_CASES = [
  // [값, 허용 여부]
  ['123456', true], // 6자 경계, 숫자만이어도 된다(문자 조건 없음)
  ['abcdef', true], // 영문만
  ['!@#$%^', true], // 기호만
  ['      ', true], // 공백도 관리자가 정한 그대로
  ['비밀번호여섯', true], // 한글만 6자(18바이트)
  ['a'.repeat(72), true], // 72바이트 경계
  ['a' + '가'.repeat(23), true], // 24자, 1+69 = 70바이트
  ['12345', false], // 5자
  ['', false],
  ['a'.repeat(73), false], // 73바이트
  ['a1' + '가'.repeat(24), false], // 26자지만 74바이트(bcrypt 한계 초과)
  [null, false],
  [undefined, false],
  [1234567890, false], // 문자열이 아님
];

test('비밀번호 규칙이 두 구현에서 같다(6~72바이트, 문자 조건 없음)', () => {
  for (const [pw, expected] of PASSWORD_CASES) {
    const label = JSON.stringify(pw) ?? String(pw);
    assert.equal(browser.isValidPassword(pw), expected, label);
    assert.equal(edge.isValidPassword(pw), expected, label);
  }
});
