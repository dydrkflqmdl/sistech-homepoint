import assert from 'node:assert/strict';
import { test } from 'node:test';
import { domainToASCII, domainToUnicode } from 'node:url';
import { LOGIN_DOMAIN, LOGIN_ID_RULE, emailToLoginId, loginIdToEmail, normalizeLoginId, punycodeDecode } from '../public/login-id.js';

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
