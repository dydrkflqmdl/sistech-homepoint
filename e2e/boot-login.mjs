// 항목 2(시작)·3(로그인): config.js 없음 안내, 로그인 화면 먼저, 빈 칸·틀린 비밀번호, 성공, 새로고침 유지, 로그아웃
import fs from 'node:fs';
import path from 'node:path';
import { BLOCKED, launch, prepare, PROJECT, reporter, sleep, URL_BASE } from './lib.mjs';

const { check, finish } = reporter('boot-login');
const view = `(() => ({
  boot: !document.querySelector('#boot-message').hidden, bootText: document.querySelector('#boot-message').innerText.trim(),
  login: !document.querySelector('#login').hidden, app: !document.querySelector('.app').hidden,
  appDisplay: getComputedStyle(document.querySelector('.app')).display,
  importVisible: document.querySelector('#import-button').offsetParent !== null,
  exportVisible: document.querySelector('#export-button').offsetParent !== null,
  loginError: document.querySelector('#login-error').hidden ? null : document.querySelector('#login-error').textContent,
  invalid: [...document.querySelectorAll('#login [aria-invalid="true"]')].map(e => e.id),
  active: document.activeElement?.id || document.activeElement?.tagName,
  email: document.querySelector('#user-name').textContent,
  groups: document.querySelectorAll('#place-list .group').length,
  listChildren: document.querySelector('#place-list').children.length,
  summary: document.querySelector('#list-summary').textContent,
}))()`;

// ── 2a. config.js 404 ──
{
  const b = await launch('boot-a');
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*config.js*', requestStage: 'Request' }] });
  b.listeners.push((m) => {
    if (m.method === 'Fetch.requestPaused') b.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 404, body: Buffer.from('Not Found').toString('base64') });
  });
  await b.navigate(URL_BASE, 800);
  const v = await b.ev(view);
  check('config.js 404 → 안내 문구만 보임', v.boot && /config\.js가 없습니다/.test(v.bootText) && !v.login && !v.app, v);
  check('config.js 404 → 가져오기 버튼 숨김', !v.importVisible, v);
  await b.shot('boot-no-config-390');
  await b.send('Fetch.disable');

  // config.js에 Supabase 칸이 빈 경우
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*config.js*', requestStage: 'Request' }] });
  b.listeners.length = 0;
  b.listeners.push((m) => {
    if (m.method === 'Fetch.requestPaused') b.send('Fetch.fulfillRequest', {
      requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }],
      body: Buffer.from('window.APP_CONFIG = { kakaoJsKey: "x", supabaseUrl: "", supabaseAnonKey: "" };').toString('base64'),
    });
  });
  await b.navigate(URL_BASE, 800);
  const v2 = await b.ev(view);
  check('Supabase 설정 빈 config.js → 비어 있다는 안내', v2.boot && /비어 있습니다/.test(v2.bootText) && !v2.login && !v2.app, v2.bootText);
  await b.send('Fetch.disable');
  check('콘솔 예외 0건(설정 없음)', b.errors.length === 0, b.errors);
  await b.close();
}

// ── 2b. 가짜가 없고 자체 호스팅 파일(vendor)·CDN이 모두 막혔을 때 → 모듈 불러오기 실패 안내(진짜 supabase-js가 차단되는지도 확인) ──
{
  const b = await launch('boot-b', { fakeSupabase: false });
  await b.send('Network.setBlockedURLs', { urls: [...BLOCKED, '*vendor/supabase-js*'] });
  await b.navigate(URL_BASE, 1500);
  const v = await b.ev(view);
  const jsdelivr = b.requests.filter((u) => u.includes('cdn.jsdelivr.net'));
  check('supabase-js CDN 차단 → "로그인 모듈을 불러오지 못했습니다" 안내', v.boot && /로그인 모듈을 불러오지 못했습니다/.test(v.bootText), v.bootText);
  check('jsdelivr 요청이 차단됨', jsdelivr.length > 0 && b.blocked.length >= jsdelivr.length, { jsdelivr: jsdelivr.length, blocked: b.blocked.length });
  await b.close();
}

// ── 2b'. 가짜가 없고 자체 호스팅 파일(public/vendor/supabase-js.js)이 있으면 CDN 없이 그것으로 연다(계약 C9) ──
if (fs.existsSync(path.join(PROJECT, 'public/vendor/supabase-js.js'))) {
  const b = await launch('boot-v', { fakeSupabase: false });
  await b.navigate(URL_BASE, 300);
  await b.waitFor(`!document.querySelector('#login').hidden`, 8000);
  const v = await b.ev(view);
  const vendor = b.requests.filter((u) => /\/vendor\/supabase-js\.js/.test(u));
  const jsdelivr = b.requests.filter((u) => u.includes('cdn.jsdelivr.net'));
  check('vendor/supabase-js.js가 있으면 그것으로 열고(로그인 화면) CDN은 부르지 않음', v.login && !v.boot && vendor.length >= 1 && jsdelivr.length === 0, { login: v.login, boot: v.bootText, vendor: vendor.length, jsdelivr: jsdelivr.length });
  check('콘솔 예외 0건(vendor로 시작)', b.errors.length === 0, b.errors);
  await b.close();
} else {
  console.log('건너뜀: public/vendor/supabase-js.js가 없음(자체 호스팅 전 판)');
}

// ── 2c·3. 로그인 ──
const b = await launch('login');
const places = [
  { name: 'SW_01', district: '태안', address: '가람면 하늘리', lat: 37.277767, lng: 126.717126, mission: 'SW_01_01 ~ _03' },
  { name: 'BE_01', district: '보은', address: '보은읍 1리', lat: 36.49, lng: 127.73, mission: '' },
];
await prepare(b, { places, signedIn: false });
const v0 = await b.ev(view);
check('config.js 있음 → 로그인 화면 먼저(앱·안내 숨김)', v0.login && !v0.app && !v0.boot && v0.appDisplay === 'none', v0);
check('로그인 전 가져오기·내보내기 버튼 숨김', !v0.importVisible && !v0.exportVisible, v0);
check('로그인 전 list_places 호출 없음', (await b.ev(`__fake.calls.filter(c => c.name === 'list_places').length`)) === 0);
check('createClient에 persistSession·autoRefreshToken', await b.ev(`JSON.stringify(__fake.createClientArgs.opts) === JSON.stringify({ auth: { persistSession: true, autoRefreshToken: true } })`));
await b.shot('login-390');

// 빈 칸 제출
await b.ev(`document.querySelector('#login-submit').click()`);
await sleep(200);
const v1 = await b.ev(view);
check('빈 칸 제출 → "아이디와 비밀번호를 입력해 주세요." + 아이디 칸 표시·초점', v1.loginError === '아이디와 비밀번호를 입력해 주세요.' && v1.invalid.join() === 'login-id' && v1.active === 'login-id', v1);
await b.ev(`document.querySelector('#login-id').value = 'admin@sistech.test'; document.querySelector('#login-submit').click()`);
await sleep(200);
const v1b = await b.ev(view);
check('비밀번호만 빔 → 비밀번호 칸 표시·초점', v1b.invalid.join() === 'login-password' && v1b.active === 'login-password', v1b);

// 틀린 비밀번호(Enter로 제출)
await b.ev(`document.querySelector('#login-password').value = 'wrong'; document.querySelector('#login-password').focus()`);
await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await b.waitFor(`!document.querySelector('#login-error').hidden && /틀렸/.test(document.querySelector('#login-error').textContent)`, 3000);
const v2 = await b.ev(view);
check('틀린 비밀번호 → "아이디 또는 비밀번호가 틀렸습니다."', v2.loginError === '아이디 또는 비밀번호가 틀렸습니다.' && v2.login && !v2.app, v2);
check('틀린 비밀번호 후 비밀번호 칸 초점', v2.active === 'login-password', v2.active);
await b.setViewport(1280, 820, false);
await b.shot('login-error-1280');
await b.setViewport(390, 844, true);

// 성공
await b.ev(`document.querySelector('#login-id').value = '  admin@sistech.test '; document.querySelector('#login-password').value = 'test1234'; document.querySelector('#login-submit').click()`);
await b.waitFor(`!document.querySelector('.app').hidden && document.querySelectorAll('#place-list .group').length === 2`, 3000);
await sleep(200);
const v3 = await b.ev(view);
check('로그인 성공 → 앱 표시·로그인 화면 숨김', v3.app && !v3.login && !v3.boot, v3);
check('머리글에 이메일(앞뒤 공백 제거)', v3.email === 'admin@sistech.test', v3.email);
check('로그인 후 목록 2곳(시군 2묶음)', v3.groups === 2 && v3.summary === '장소 2개', v3);
check('로그인 후 초점이 제목 링크로', v3.active === 'home-link', v3.active);
check('로그인 폼 비움(비밀번호 칸 빈 값)', (await b.ev(`document.querySelector('#login-password').value`)) === '');
check('실시간 구독 1개', (await b.ev(`__fake.channels`)) === 1);
// 휴대폰(390)에서는 버튼이 ☰ 안에 접혀 있으므로 ☰를 펼쳐 본다.
await b.ev(`document.querySelector('#menu-button').click()`);
const v3m = await b.ev(view);
await b.ev(`document.querySelector('#menu-button').click()`);
check('로그인 후 (☰를 펼치면) 가져오기·내보내기 버튼 보임', !v3.importVisible && v3m.importVisible && v3m.exportVisible, { v3, v3m });

// 새로고침 → 로그인 유지
await b.navigate(URL_BASE, 300);
await b.waitFor(`!document.querySelector('.app').hidden && document.querySelectorAll('#place-list .group').length === 2`, 3000);
const v4 = await b.ev(view);
check('새로고침 후에도 로그인 유지(앱·이메일·목록)', v4.app && !v4.login && v4.email === 'admin@sistech.test' && v4.groups === 2, v4);

// 로그아웃
await b.ev(`document.querySelector('#logout-button').click()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 3000);
await sleep(200);
const v5 = await b.ev(view);
const after = await b.ev(`({ removed: __fake.removed, channels: __fake.channels, scope: __fake.lastSignOutScope, session: __fake.session() })`);
check('로그아웃 → 로그인 화면, 앱 숨김', v5.login && !v5.app, v5);
check('로그아웃 → 목록 비움·이메일 지움', v5.listChildren === 0 && v5.email === '' && v5.summary === '', v5);
check('로그아웃 → removeChannel 호출·구독 0개', after.removed.includes('places-missions') && after.channels === 0, after);
check('로그아웃은 이 기기만(scope local)·세션 삭제', after.scope === 'local' && after.session === null, after);
check('직접 로그아웃은 안내 문구 없음', v5.loginError === null, v5.loginError);
check('로그아웃 후 아이디 칸에 초점', v5.active === 'login-id', v5.active);

// 다른 계정으로 다시 로그인 → 이메일 바뀜, 목록 다시 받음
await b.ev(`document.querySelector('#login-id').value = 'other@sistech.test'; document.querySelector('#login-password').value = 'test1234'; document.querySelector('#login-submit').click()`);
await b.waitFor(`!document.querySelector('.app').hidden && document.querySelectorAll('#place-list .group').length === 2`, 3000);
const v6 = await b.ev(view);
check('다른 계정 재로그인 → 새 이메일·목록·구독 1개', v6.email === 'other@sistech.test' && v6.groups === 2 && (await b.ev('__fake.channels')) === 1, v6);

// 로그인 전 끌어다 놓기는 받지 않음
await b.ev(`document.querySelector('#logout-button').click()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 3000);
const dropped = await b.ev(`(() => {
  const dt = new DataTransfer(); dt.items.add(new File(['이름,위도,경도\\nX,36,127\\n'], 'x.csv', { type: 'text/csv' }));
  for (const type of ['dragenter', 'dragover', 'drop']) { const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'dataTransfer', { value: dt }); window.dispatchEvent(e); }
  return { panel: !document.querySelector('#import-panel').hidden, dragging: document.body.classList.contains('dragging') };
})()`);
check('로그인 전 CSV 끌어다 놓기 무시', !dropped.panel && !dropped.dragging, dropped);

check('콘솔 예외 0건(로그인)', b.errors.length === 0, b.errors);
await finish(b);
