// 한글 아이디 로그인·로그인 기록(DB에만 남김) 확인. 기록 화면은 사용자 결정으로 없앴다.
// (a) 한글 아이디 → xn-- 이메일 (b) 이메일 입력 (c) 규칙 위반 (d) log_login 1회/새로고침 0회 (f) 로그아웃 순서·2초·만료 시 0회
import fs from 'node:fs';
import path from 'node:path';
import { launch, prepare, PROJECT, reporter, sleep, URL_BASE } from './lib.mjs';

const { loginIdToEmail, emailToLoginId, LOGIN_ID_RULE } = await import(PROJECT + '/public/login-id.js');
const { check, finish } = reporter('login-id');

const places = [
  { name: 'SW_01', district: '태안', address: '소원면 송현리', lat: 36.766667, lng: 126.149826, mission: 'SW_01_01 ~ _03' },
  { name: 'BE_01', district: '보은', address: '보은읍 1리', lat: 36.49, lng: 127.73, mission: '' },
];
const view = `(() => ({
  login: !document.querySelector('#login').hidden, app: !document.querySelector('.app').hidden,
  error: document.querySelector('#login-error').hidden ? null : document.querySelector('#login-error').textContent,
  invalid: [...document.querySelectorAll('#login [aria-invalid="true"]')].map(e => e.id),
  active: document.activeElement?.id || document.activeElement?.tagName,
  name: document.querySelector('#user-name').textContent, nameTitle: document.querySelector('#user-name').title,
  detailOpen: !document.querySelector('#detail').hidden, groups: document.querySelectorAll('#place-list .group').length,
}))()`;
const login = (b, id, pw = 'test1234') => b.ev(`(() => {
  const f = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  f('#login-id', ${JSON.stringify(id)}); f('#login-password', ${JSON.stringify(pw)});
  document.querySelector('#login-submit').click();
})()`);
const sonEmail = loginIdToEmail('손두병');
const kimEmail = loginIdToEmail('김철수');

// 정적 확인: 앱 코드 어디에도 기록 화면·list_login_logs가 없다
const sources = fs.readdirSync(path.join(PROJECT, 'public')).filter((f) => /\.(js|html|css)$/.test(f) && f !== 'config.js')
  .map((f) => [f, fs.readFileSync(path.join(PROJECT, 'public', f), 'utf-8')]);
const leftovers = sources.filter(([, t]) => /list_login_logs|listLoginLogs|login-log-(button|panel|title|status|table)|log-(time|who|event|device)\b/.test(t)).map(([f]) => f);
check('public/ 코드에 list_login_logs·기록 창 흔적 없음', leftovers.length === 0 && !fs.existsSync(path.join(PROJECT, 'public/login-log.js')), leftovers);

const b = await launch('login-id', { viewport: [390, 844, true] });
await prepare(b, { places, signedIn: false });
await b.ev(`__fake.setUsers({ ${JSON.stringify(sonEmail)}: '손두병' })`);

// 로그인 화면 모양
const form = await b.ev(`(() => { const i = document.querySelector('#login-id'); return {
  label: i.closest('label').querySelector('span').textContent, type: i.type, name: i.name, ac: i.autocomplete, cap: i.getAttribute('autocapitalize'),
  ph: i.placeholder, hint: document.querySelector('#login .hint').textContent, oldGone: !document.querySelector('#login-email') }; })()`);
check('로그인 칸: #login-id(name=username)·아이디/text/autocapitalize off/placeholder/안내 문구', form.label === '아이디' && form.type === 'text' && form.name === 'username' && form.ac === 'username' && form.cap === 'off' && form.ph === '예: 홍길동' && form.hint === '아이디와 비밀번호로 로그인해 주세요.' && form.oldGone, form);

// 빈 칸
await b.ev(`document.querySelector('#login-submit').click()`);
await sleep(150);
let v = await b.ev(view);
check('빈 칸 → "아이디와 비밀번호를 입력해 주세요." + 아이디 칸 표시·초점', v.error === '아이디와 비밀번호를 입력해 주세요.' && v.invalid.join() === 'login-id' && v.active === 'login-id', v);

// (c) 규칙 위반: 서버(signIn) 0회
await login(b, '홍 길동');
await sleep(200);
v = await b.ev(view);
check('(c) 공백 포함 아이디 → 규칙 문구, 아이디 칸 표시·초점', v.error === LOGIN_ID_RULE && v.invalid.join() === 'login-id' && v.active === 'login-id', v);
await b.shot('lid-login-bad-id-390');
await login(b, '가나다라마바사아자차카타파하가나다');
await sleep(150);
check('(c) 17자 아이디 → 규칙 문구', (await b.ev(view)).error === LOGIN_ID_RULE);
check('(c) 규칙 위반 두 번 모두 signIn 0회', (await b.ev(`__fake.events.filter(e => e.startsWith('signIn')).length`)) === 0);

// 틀린 비밀번호
await login(b, '손두병', 'wrong');
await b.waitFor(`!document.querySelector('#login-error').hidden && /틀렸/.test(document.querySelector('#login-error').textContent)`, 3000);
v = await b.ev(view);
check('틀린 비밀번호 → "아이디 또는 비밀번호가 틀렸습니다." + 비밀번호 칸 초점', v.error === '아이디 또는 비밀번호가 틀렸습니다.' && v.active === 'login-password', v);

// (a) " 손두병 " 로그인. log_login은 3초 늦게 응답해도 화면 전환을 막지 않아야 한다.
await b.ev(`__fake.rpcDelay.log_login = 3000; __fake.events.length = 0; __fake.calls.length = 0;`);
const t0 = Date.now();
await login(b, ' 손두병 ');
await b.waitFor(`!document.querySelector('.app').hidden`, 3000);
const enterMs = Date.now() - t0;
v = await b.ev(view);
const ev1 = await b.ev(`__fake.events.slice()`);
check('(a) signIn 이메일 = Node loginIdToEmail(\'손두병\')(xn--…@sistech.local), 되돌리면 손두병', ev1[0] === 'signIn:' + sonEmail && /^xn--[a-z0-9-]+@sistech\.local$/.test(sonEmail) && emailToLoginId(sonEmail) === '손두병', ev1[0]);
check('(a) 앱 화면, 머리글 #user-name "손두병"(title도)', v.app && v.name === '손두병' && v.nameTitle === '손두병', v);
check('(d) 로그인 직후 log_login 1회, 응답 3초를 기다리지 않고 화면 전환', ev1.filter((e) => e === 'log_login').length === 1 && enterMs < 1500, { enterMs, ev1 });
const ua = await b.ev(`__fake.calls.find(c => c.name === 'log_login')?.params?.p_user_agent`);
check('(d) p_user_agent = navigator.userAgent', ua && ua === (await b.ev('navigator.userAgent')), ua);
await sleep(3200);
const logged = await b.ev(`__fake.logs().filter(l => l.event === 'login')`);
check('(d) DB 로그인 기록 1건(손두병·user agent)', logged.length === 1 && logged[0].loginId === '손두병' && logged[0].userAgent === ua, logged);
const dom = await b.ev(`({ btn: !!document.querySelector('#login-log-button'), panel: !!document.querySelector('#login-log-panel'), title: !!document.querySelector('#login-log-title'),
  cls: !!document.querySelector('.login-log-status, .login-log-table, .log-time, .log-who, .log-event, .log-device'),
  account: [...document.querySelector('.account').children].map(e => e.id) })`);
check('기록 화면 없음: #login-log-button·#login-log-panel·관련 클래스 없음, 머리글 계정 줄은 #user-name + #logout-button', !dom.btn && !dom.panel && !dom.title && !dom.cls && dom.account.join() === 'user-name,logout-button', dom);
await b.ev(`__fake.rpcDelay.log_login = 0`);

// (d) 새로고침(저장된 세션) → log_login 0회
await b.navigate(URL_BASE, 300);
await b.waitFor(`!document.querySelector('.app').hidden && document.querySelectorAll('#place-list .group').length === 2`, 3000);
await sleep(500);
const reload = await b.ev(`({ logLogin: __fake.calls.filter(c => c.name === 'log_login').length, name: document.querySelector('#user-name').textContent, logs: __fake.logs().filter(l => l.event === 'login').length })`);
check('(d) 새로고침(저장된 세션으로 열림) → log_login 0회, 머리글 유지, 기록 늘지 않음', reload.logLogin === 0 && reload.name === '손두병' && reload.logs === 1, reload);

// 기록 창이 맡던 Esc·패널 배타 대신: 상세 정보의 Esc 닫기와 가져오기 창과의 공존은 그대로
await b.ev(`__e2e.row('SW_01').click()`);
await sleep(200);
check('상세 정보 열림', (await b.ev(view)).detailOpen);
await b.ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(150);
v = await b.ev(view);
check('Esc → 상세 정보 닫힘, 초점은 그 장소 행(또는 시군 머리)', !v.detailOpen && /^(BUTTON)$/.test(await b.ev(`document.activeElement.tagName`)) && (await b.ev(`!!document.activeElement.closest('#place-list')`)), v);

// (f) 로그아웃: log_logout → signOut, DB에 로그아웃 기록, 화면 비움
await b.ev(`__fake.events.length = 0`);
await b.ev(`document.querySelector('#logout-button').click()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 4000);
await sleep(200);
v = await b.ev(view);
const ev2 = await b.ev(`__fake.events.slice()`);
check('(f) log_logout 호출 후 signOut', ev2.indexOf('log_logout') >= 0 && ev2.indexOf('log_logout') < ev2.indexOf('signOut'), ev2);
const lastLog = await b.ev(`__fake.logs().at(-1)`);
check('(f) DB에 손두병 로그아웃 기록', lastLog.event === 'logout' && lastLog.loginId === '손두병', lastLog);
check('(f) 로그인 화면, 이름 비움, 문구 없음, 목록 비움', v.login && v.name === '' && v.error === null && v.groups === 0, v);

// (f) 메타데이터 없는 계정 + log_logout 무응답 → 약 2초 뒤 진행
await login(b, '김철수');
await b.waitFor(`!document.querySelector('.app').hidden`, 3000);
check('메타데이터 없는 계정 → 머리글 "김철수"(xn-- 이메일에서 되살림)', (await b.ev(view)).name === '김철수' && (await b.ev(`__fake.events.find(e => e.startsWith('signIn'))`)) === 'signIn:' + kimEmail);
await b.ev(`__fake.rpcDelay.log_logout = 6000; __fake.events.length = 0;`);
const t1 = Date.now();
await b.ev(`document.querySelector('#logout-button').click()`);
await sleep(100);
const busy = await b.ev(`({ d: document.querySelector('#logout-button').disabled, t: document.querySelector('#logout-button').textContent })`);
await b.waitFor(`!document.querySelector('#login').hidden`, 5000);
const outMs = Date.now() - t1;
const ev3 = await b.ev(`__fake.events.slice()`);
check('(f) log_logout 무응답 → 약 2초 뒤 signOut 진행, 그동안 버튼 잠김 "로그아웃 중…"', outMs >= 1900 && outMs < 3000 && busy.d && busy.t === '로그아웃 중…' && ev3.indexOf('log_logout') < ev3.indexOf('signOut'), { outMs, busy, ev3 });
await b.ev(`__fake.rpcDelay.log_logout = 0`);
await sleep(4500); // 늦게 온 log_logout(세션 없음 → 401)이 화면을 건드리지 않는지
v = await b.ev(view);
check('(f) 늦게 실패한 log_logout이 화면을 건드리지 않음, 버튼 원래대로', v.error === null && v.login && (await b.ev(`document.querySelector('#logout-button').textContent`)) === '로그아웃' && !(await b.ev(`document.querySelector('#logout-button').disabled`)), v);

// (b) 이메일 입력('@')도 그대로 로그인(소문자로)
await b.ev(`__fake.events.length = 0`);
await login(b, 'Admin@SISTECH.test');
await b.waitFor(`!document.querySelector('.app').hidden && document.querySelectorAll('#place-list .group').length === 2`, 3000);
check("(b) '@' 입력은 이메일로 로그인(소문자), 머리글에 이메일", (await b.ev(view)).name === 'admin@sistech.test' && (await b.ev(`__fake.events[0]`)) === 'signIn:admin@sistech.test');

// (f) 세션 만료로 강제 로그아웃 → log_logout 0회
await b.ev(`__fake.events.length = 0; __fake.failNext();`);
await b.ev(`document.querySelector('#place-list .group-head').click()`);
await b.ev(`(() => { const t = document.querySelector('#place-list button[data-id]'); t.click(); })()`);
await sleep(200);
await b.ev(`(() => { const t = document.querySelector('#detail .memo textarea'); t.value = 'x'; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 3000);
await sleep(300);
v = await b.ev(view);
const ev4 = await b.ev(`__fake.events.slice()`);
check('(f) 세션 만료 → 로그인 화면 + 만료 문구, log_logout 0회', v.login && v.error === '로그인이 만료되었습니다. 다시 로그인해 주세요.' && !ev4.includes('log_logout'), { v, ev4 });

// 서버 트리거가 먼저 기록 → log_login {logged:false}여도 기록 1건
await b.ev(`__fake.triggerLog = true; __fake.seedLogs([]);`);
await login(b, '손두병');
await b.waitFor(`!document.querySelector('.app').hidden`, 3000);
await sleep(300);
const logs = await b.ev(`__fake.logs()`);
check('트리거가 먼저 기록해도 로그인 기록은 1건(user agent는 채워짐)', logs.length === 1 && logs[0].userAgent !== '', logs);

// 삭제된 list_login_logs: 가짜가 42883을 돌려주게 해 두었고, 이 스크립트 전체에서 0회
const direct = await b.ev(`(async () => { const bind = window.__e2eRpc; window.__e2eRpc = undefined; try { const r = await window.supabase.createClient('x', 'y').rpc('list_login_logs', { p_limit: 1 }); return r.error; } finally { window.__e2eRpc = bind; } })()`);
check('가짜 list_login_logs는 42883 오류(함수 없음)', direct?.code === '42883', direct);
check('앱이 list_login_logs를 부르지 않음(이 스크립트 전체 0회)', (b.rpcCounts.list_login_logs ?? 0) === 0 && (b.rpcCounts.log_login ?? 0) >= 1, b.rpcCounts);

check('콘솔 오류·예외 0건', b.errors.length === 0, b.errors);
await finish(b);
