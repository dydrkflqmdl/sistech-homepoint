// B-9 계정 관리: 본인 비밀번호 재설정은 [바꾸고 로그아웃] + 눈에 띄는 경고, 성공하면 로그인 화면에 "비밀번호를 바꿨습니다…" 안내
// (만료 안내와 다른 칸·모양), 다른 계정 재설정은 한 번 확인, 비밀번호 칸 [보기](aria-pressed), 규칙 검사는 길이만(6자~72바이트),
// 서버 문구는 그대로.
import { launch, PROJECT, prepare, reporter, sleep } from './lib.mjs';

const loginIdModule = await import(PROJECT + '/public/login-id.js');
const PASSWORD_RULE = loginIdModule.PASSWORD_RULE ?? '비밀번호는 6자 이상 72자 이하여야 합니다.';
const { check, finish } = reporter('ux-accounts');
const b = await launch('ux-accounts');
const ev = b.ev;
const ADMIN = 'admin@sistech.test';
const son = loginIdModule.loginIdToEmail('손두병');
const accounts = [
  { id: 'user-' + ADMIN, login_id: null, email: ADMIN, created_at: '2026-10-01T00:00:00Z', last_sign_in_at: null, is_admin: true },
  { id: 'user-son', login_id: '손두병', email: son, created_at: '2026-10-15T06:30:00Z', last_sign_in_at: null, is_admin: false },
];
const places = [{ name: 'SW_01', district: '태안', address: '소원면', lat: 36.766667, lng: 126.149826, mission: '' }];
const type = (sel, value) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const message = () => ev(`(() => { const m = document.querySelector('#accounts-message'); return m && !m.hidden ? m.textContent : null; })()`);
const fnCalls = () => ev(`__fake.fnCalls.map(c => c.body?.action)`);
const openPanel = async () => {
  await ev(`document.querySelector('#accounts-button').click()`);
  await b.waitFor(`document.querySelectorAll('#accounts-panel .accounts-row').length === 2`, 3000);
};

// ── 로그인 화면의 [보기] ──
await prepare(b, { places, signedIn: false, admins: [ADMIN], accounts });
let v = await ev(`({ type: document.querySelector('#login-password').type, pressed: document.querySelector('#login-password-toggle').getAttribute('aria-pressed'), name: document.querySelector('#login-password-toggle').getAttribute('aria-label'), controls: document.querySelector('#login-password-toggle').getAttribute('aria-controls'), inLabel: !!document.querySelector('#login-password-toggle').closest('label') })`);
check('로그인 비밀번호 칸 옆 [보기](aria-pressed=false, aria-controls, label 밖), 처음엔 가려짐', v.type === 'password' && v.pressed === 'false' && v.name === '비밀번호 보기' && v.controls === 'login-password' && !v.inLabel, v);
await ev(`document.querySelector('#login-password').value = 'test1234'; document.querySelector('#login-password-toggle').click()`);
v = await ev(`({ type: document.querySelector('#login-password').type, pressed: document.querySelector('#login-password-toggle').getAttribute('aria-pressed'), value: document.querySelector('#login-password').value })`);
check('[보기]를 누르면 글자가 보임(type=text, aria-pressed=true), 적은 값 그대로', v.type === 'text' && v.pressed === 'true' && v.value === 'test1234', v);
await b.shot('ux-login-password-shown-390');
await ev(`document.querySelector('#login-password-toggle').click()`);
check('다시 누르면 가림', (await ev(`document.querySelector('#login-password').type`)) === 'password');
await ev(`document.querySelector('#login-password-toggle').click()`);
await ev(`document.querySelector('#login-id').value = ${JSON.stringify(ADMIN)}; document.querySelector('#login-submit').click()`);
await b.waitFor(`!document.querySelector('.app').hidden`, 3000);
check('로그인하면 비밀번호 칸은 다시 가린 상태로 돌아감', (await ev(`document.querySelector('#login-password').type === 'password' && document.querySelector('#login-password-toggle').getAttribute('aria-pressed') === 'false'`)));
await b.waitFor(`document.querySelectorAll('#place-list .group').length === 1`, 3000);

// ── 새 계정 폼: [보기], 길이 규칙(72바이트), 서버 문구 그대로 ──
await openPanel();
await type('#accounts-new-password', 'abcdef');
await ev(`document.querySelector('#accounts-new-password + .pw-toggle').click()`);
v = await ev(`({ type: document.querySelector('#accounts-new-password').type, pressed: document.querySelector('#accounts-new-password + .pw-toggle').getAttribute('aria-pressed'), value: document.querySelector('#accounts-new-password').value, focus: document.activeElement?.classList.contains('pw-toggle') })`);
check('새 계정 비밀번호 [보기] → 글자 보임(다시 그려도 적은 값·초점 유지)', v.type === 'text' && v.pressed === 'true' && v.value === 'abcdef' && v.focus, v);
await type('#accounts-new-id', '홍길동');
await type('#accounts-new-password', '가'.repeat(25));
await ev(`document.querySelector('#accounts-create-button').click()`); await sleep(150);
v = { message: await message(), calls: await fnCalls(), invalid: await ev(`document.querySelector('#accounts-new-password').getAttribute('aria-invalid')`) };
check('한글 25자(75바이트) 비밀번호 → 72바이트를 넘어 화면에서 막음(규칙 문구), 서버 호출 없음', v.message === PASSWORD_RULE && v.invalid === 'true' && !v.calls.includes('create'), v);
await type('#accounts-new-password', 'abcdef');
await ev(`__fake.fnFailNext({ status: 400, error: '서버가 정한 비밀번호 규칙 문구' })`);
await ev(`document.querySelector('#accounts-create-button').click()`);
await b.waitFor(`document.querySelector('#accounts-message')?.textContent === '서버가 정한 비밀번호 규칙 문구'`, 3000);
check('화면 검사를 통과해도 서버가 거절하면 서버 문구를 그대로 보여 줌', (await message()) === '서버가 정한 비밀번호 규칙 문구');

// ── 다른 계정 재설정: 한 번 확인 ──
await ev(`document.querySelector('#accounts-panel button[data-reset="user-son"]').click()`); await sleep(100);
v = await ev(`({ button: document.querySelector('#accounts-panel .accounts-row.resetting .btn.primary').textContent, warn: !!document.querySelector('#accounts-panel .accounts-self-notice') })`);
check('다른 계정 재설정 단추는 [확인], 본인 경고 없음', v.button === '확인' && !v.warn, v);
await type('#accounts-reset-password', 'newpass1');
await ev(`document.querySelector('#accounts-reset-password + .pw-toggle').click()`);
check('재설정 비밀번호 [보기]', (await ev(`document.querySelector('#accounts-reset-password').type === 'text' && document.querySelector('#accounts-reset-password + .pw-toggle').getAttribute('aria-pressed') === 'true'`)));
await ev(`window.confirm = (m) => { window.__confirms.push(String(m)); return false; }`);
let c0 = await ev(`window.__confirms.length`);
await ev(`document.querySelector('#accounts-panel .accounts-row.resetting .btn.primary').click()`); await sleep(200);
v = { asked: await ev(`window.__confirms.slice(${c0})`), calls: await fnCalls(), still: await ev(`!!document.querySelector('#accounts-panel .accounts-row.resetting')`) };
check('다른 계정 비밀번호를 바꿀 때 한 번 묻고(이름·로그아웃 안내), 아니오면 보내지 않음', v.asked.length === 1 && v.asked[0] === '손두병 계정의 비밀번호를 바꿀까요? 그 계정은 모든 기기에서 로그아웃됩니다.' && !v.calls.includes('reset_password') && v.still, v);
await ev(`window.confirm = (m) => { window.__confirms.push(String(m)); return true; }`);
c0 = await ev(`window.__confirms.length`);
await ev(`document.querySelector('#accounts-panel .accounts-row.resetting .btn.primary').click()`);
await b.waitFor(`document.querySelector('#accounts-message')?.textContent === '손두병 계정의 비밀번호를 바꿨습니다.'`, 3000);
v = { asked: (await ev(`window.__confirms.length`)) - c0, resets: await ev(`__fake.resetPasswords`), app: await ev(`!document.querySelector('.app').hidden`) };
check('예 → 확인은 한 번뿐, 재설정되고 로그인은 그대로', v.asked === 1 && v.resets.length === 1 && v.resets[0].user_id === 'user-son' && v.app, v);

// ── 본인 재설정: [바꾸고 로그아웃] + 경고 상자, 묻지 않음, 성공하면 로그인 화면에 안내 ──
await ev(`document.querySelector('#accounts-panel button[data-reset="user-${ADMIN}"]').click()`); await sleep(100);
v = await ev(`(() => { const n = document.querySelector('#accounts-panel .accounts-self-notice'); const st = n && getComputedStyle(n); const btn = document.querySelector('#accounts-panel .accounts-row.resetting .btn.primary');
  return { text: n?.textContent, border: st?.borderTopStyle, bg: st?.backgroundColor, color: st?.color, button: btn.textContent, btnBg: getComputedStyle(btn).backgroundColor }; })()`);
check('본인 재설정: 경고 상자(빨간 테두리·배경) "본인 비밀번호를 바꾸면 모든 기기에서 로그아웃됩니다." + 단추 [바꾸고 로그아웃](빨강)',
  v.text === '본인 비밀번호를 바꾸면 모든 기기에서 로그아웃됩니다.' && v.border === 'solid' && v.bg === 'rgb(253, 236, 236)' && v.color === 'rgb(209, 52, 58)' && v.button === '바꾸고 로그아웃' && v.btnBg === 'rgb(209, 52, 58)', v);
await b.shot('ux-accounts-self-reset-390');
await type('#accounts-reset-password', 'mynewpass1');
c0 = await ev(`window.__confirms.length`);
await ev(`__fake.events.length = 0`);
await ev(`document.querySelector('#accounts-panel .accounts-row.resetting .btn.primary').click()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 4000);
await sleep(300);
v = await ev(`({ notice: document.querySelector('#login-notice').hidden ? null : document.querySelector('#login-notice').textContent, noticeRole: document.querySelector('#login-notice').getAttribute('role'),
  error: document.querySelector('#login-error').hidden ? null : document.querySelector('#login-error').textContent, session: __fake.session(), events: __fake.events.slice(),
  asked: window.__confirms.length - ${c0}, panel: !document.querySelector('#accounts-panel').hidden, rows: document.querySelector('#place-list').children.length })`);
check('본인 재설정 성공 → 묻지 않고 바꾼 뒤 이 기기도 로그아웃, 로그인 화면', v.asked === 0 && v.events.indexOf('fn:admin-users:reset_password') >= 0 && v.events.indexOf('signOut') > v.events.indexOf('fn:admin-users:reset_password') && v.session === null && !v.panel && v.rows === 0, v);
check('로그인 화면 안내(role=status): "비밀번호를 바꿨습니다. 새 비밀번호로 다시 로그인해 주세요." — 오류(만료) 칸은 비어 있음',
  v.notice === '비밀번호를 바꿨습니다. 새 비밀번호로 다시 로그인해 주세요.' && v.noticeRole === 'status' && v.error === null, v);
v = await ev(`(() => { const n = getComputedStyle(document.querySelector('#login-notice')); const e = document.querySelector('#login-error'); e.hidden = false; const es = getComputedStyle(e); const out = { noticeColor: n.color, errorColor: es.color }; e.hidden = true; return out; })()`);
check('안내 칸과 오류 칸은 모양이 다름(초록 안내 / 빨간 오류)', v.noticeColor !== v.errorColor && v.noticeColor === 'rgb(29, 122, 76)', v);
await b.shot('ux-login-password-changed-390');
await ev(`document.querySelector('#login-id').value = ${JSON.stringify(ADMIN)}; document.querySelector('#login-password').value = 'test1234'; document.querySelector('#login-submit').click()`);
await b.waitFor(`!document.querySelector('.app').hidden`, 3000);
await ev(`document.querySelector('#logout-button').click()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 4000);
check('다시 로그인하면 안내는 사라지고, 직접 로그아웃 뒤에도 안내·오류 없음', await ev(`document.querySelector('#login-notice').hidden && document.querySelector('#login-error').hidden`));

check('콘솔 오류·예외 0건', b.errors.length === 0, b.errors);
await finish(b);
