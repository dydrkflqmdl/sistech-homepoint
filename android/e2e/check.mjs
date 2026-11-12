// 안드로이드 앱(디버그 APK) 에뮬레이터 점검.
// 앱의 WebView에 원격 점검(CDP)으로 붙어 e2e/의 가짜 supabase·카카오를 심고(진짜 서버·지도는 막음),
// 휴대폰 동작([뒤로], 파일 고르기, 다운로드 저장, 기기 확인 창, 바깥 앱 열기, 키보드, 회전)은 adb·uiautomator로 확인한다.
//
// 사용: 에뮬레이터(또는 개발자 모드 휴대폰)를 하나 켜 둔 뒤
//   (cd android && ./gradlew assembleDebug) && node android/e2e/check.mjs [apk 경로]
//   ONLY=back,export node android/e2e/check.mjs   # 일부만(back, export, import, external, beforeunload, keyboard, rotate, location, offline)
// 주의: 설치된 앱을 지우고 다시 깐다(앱 데이터 초기화). 다운로드 폴더의 places-*·missions-* 파일을 지운다.
// 스크린샷은 android/e2e/shots/에 남는다(git에 올리지 않음).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCKED, E2E, MISSION_CSV_HEADER, PAGE_HELPERS, fakeSupabaseSource, q1Rows, sleep } from '../../e2e/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADB = process.env.ADB || path.join(process.env.ANDROID_HOME || path.join(process.env.HOME, 'Library/Android/sdk'), 'platform-tools/adb');
// 점검용 APK는 패키지 이름 끝에 .debug가 붙는다(배포용과 나란히 설치). 화면 클래스 이름은 그대로라 전체 이름으로 적는다.
const PKG = 'org.dpdns.sistech.homepoint.debug';
const ACT = `${PKG}/org.dpdns.sistech.homepoint.MainActivity`;
const PORT = Number(process.env.ANDROID_E2E_PORT) || 4197;
const BASE = `http://localhost:${PORT}/`;
const OUT = path.join(HERE, 'shots');
const DEVTOOLS_PORT = 9333;
const APK = process.argv[2] ?? path.join(HERE, '../app/build/outputs/apk/debug/app-debug.apk');
const ONLY = new Set((process.env.ONLY ?? '').split(',').filter(Boolean));
fs.mkdirSync(OUT, { recursive: true });

// ── adb·화면 도구 ─────────────────────────────────────────
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf-8', maxBuffer: 64 << 20 });
const adbQuiet = (...a) => { try { execFileSync(ADB, a, { stdio: 'ignore' }); } catch { /* 없어도 그만 */ } };
const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  const d = detail === '' ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${d}`);
};
const shot = (name) => fs.writeFileSync(path.join(OUT, name + '.png'), execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }));
const decode = (s) => s.replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function ui() {
  for (let i = 0; i < 5; i++) {
    try {
      const x = execFileSync(ADB, ['exec-out', 'uiautomator', 'dump', '/dev/tty'], { encoding: 'utf-8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
      if (x.includes('<hierarchy')) return x;
    } catch { /* 화면이 움직이는 중이면 다시 */ }
  }
  return '';
}
const nodes = (xml) => [...xml.matchAll(/<node ([^>]*?)\/?>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], decode(a[2])])));
const bounds = (n) => n.bounds.match(/\d+/g).map(Number);
const center = (n) => { const [x1, y1, x2, y2] = bounds(n); return [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)]; };
const tap = (x, y) => adb('shell', 'input', 'tap', String(x), String(y));
const tapNode = (n) => n && tap(...center(n));
const back = () => adb('shell', 'input', 'keyevent', '4');
async function waitUi(pred, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const n = nodes(ui()).find(pred);
    if (n) return n;
    await sleep(300);
  }
  return null;
}
const dialogMessage = () => waitUi((n) => n['resource-id'] === 'android:id/message', 6000);
const dialogButton = (k) => waitUi((n) => n['resource-id'] === `android:id/button${k}`, 3000); // 1 확인, 2 취소, 3 가운데(공유)
const topActivity = () => (adb('shell', 'dumpsys', 'activity', 'activities').match(/topResumedActivity=ActivityRecord\{\S+ \S+ (\S+)/) ?? [])[1] ?? '';
// 화면이 넘어가는 순간에는 맨 위 화면이 비어 있을 수 있어 빈 값은 건너뛴다.
async function waitTop(pred, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const t = topActivity();
    if (t && pred(t)) return t;
    await sleep(300);
  }
  return topActivity();
}
const ours = (t) => t.startsWith(PKG + '/');
const bringBack = () => { adbQuiet('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1'); return waitTop(ours); };

// ── WebView 원격 점검(CDP) ───────────────────────────────
async function connect() {
  let pid = '';
  for (let i = 0; i < 50 && !pid; i++) { pid = adb('shell', 'pidof', PKG).trim(); if (!pid) await sleep(200); }
  adb('forward', `tcp:${DEVTOOLS_PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  let target;
  for (let i = 0; i < 75 && !target; i++) {
    const list = await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json`).then((r) => r.json()).catch(() => null);
    target = list?.find((t) => t.type === 'page');
    if (!target) await sleep(200);
  }
  if (!target) throw new Error('WebView 원격 점검에 붙지 못함(디버그 APK인지 확인)');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  // userGesture: 파일 고르기처럼 사용자 동작이 있어야 열리는 것도 열리게 한다.
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.error) throw new Error('evaluate: ' + JSON.stringify(r.error));
    if (r.result?.exceptionDetails) throw new Error('evaluate: ' + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text));
    return r.result?.result?.value;
  };
  const waitFor = async (expr, timeout = 5000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); }
    return false;
  };
  const navigate = async (url) => {
    await send('Page.navigate', { url });
    await waitFor(`document.readyState === 'complete' && location.href === ${JSON.stringify(url)}`, 10000);
    await sleep(600);
  };
  // e2e/lib.mjs launch()와 같은 순서: Runtime → Network → 차단 → Page → 주입
  await send('Runtime.enable');
  await send('Runtime.addBinding', { name: '__e2eRpc' });
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: BLOCKED });
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(path.join(E2E, 'fake-kakao.js'), 'utf-8') });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: fakeSupabaseSource() });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HELPERS });
  return { ev, waitFor, navigate, errors, close: () => ws.close() };
}

// Q1 샘플(SW_01 등)과 겹치지 않는 이름으로 미션 기록이 있는 장소를 하나 둔다.
const places = [
  { name: 'APP_01', district: '태안', address: '가람면 하늘리', lat: 37.277767, lng: 126.717126, mission: 'M_01 ~ _05',
    missions: [{ mission: 'M_02', done: true, worker: '홍', flightTime: '12분 30초', batteryNo: '1', batteryLeft: '50', version: 1 }] },
];

async function start(url) {
  adb('shell', 'am', 'force-stop', PKG);
  adb('shell', 'am', 'start', '-W', '-n', ACT, '-e', 'url', url);
  await waitTop(ours);
}

async function prepare(c, { signedIn = true } = {}) {
  await c.navigate(BASE);
  const rows = (await q1Rows()).slice(0, 40);
  await c.ev(`(() => { localStorage.clear(); __fake.reset(); __fake.seed(${JSON.stringify(places)}); __fake.importRows(${JSON.stringify(rows)});
    ${signedIn ? `__fake.setSession('admin@sistech.test');` : '__fake.clearSession();'} })()`);
  await c.navigate(BASE);
  if (signedIn) await c.waitFor(`!document.querySelector('.app').hidden && document.querySelectorAll('#place-list .group').length > 0`, 10000);
  else await c.waitFor(`!document.querySelector('#login').hidden`, 10000);
  await sleep(400);
}

const want = (name) => ONLY.size === 0 || ONLY.has(name);
const now = new Date();
const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

// ── 준비: 서버·설치·시작 ──────────────────────────────────
const server = spawn(process.execPath, [path.join(HERE, 'serve.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.once('data', r));
let c;
try {
  adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);
  adbQuiet('uninstall', PKG);
  adb('install', '-r', APK);
  adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
  adb('shell', 'wm', 'user-rotation', 'lock', '0');
  adb('logcat', '-c');
  await start(`${BASE}__blank`);
  c = await connect();

  // 1. 로그인 화면·앱 표시·다리
  await prepare(c, { signedIn: false });
  const info = await c.ev(`({ ua: navigator.userAgent, bridge: Boolean(window.__homePointAppBridge), port: typeof window.HomePointApp, dpr: devicePixelRatio, ih: innerHeight })`);
  check('로그인 화면이 뜬다', await c.ev(`!document.querySelector('#login').hidden`));
  check('사용자 에이전트에 앱 이름이 붙는다', /HomePointNavi\/\d/.test(info.ua), info.ua);
  check('이 사이트 주소에 다리(bridge.js·HomePointApp)가 심긴다', info.bridge && info.port === 'object', info);
  const webNode = nodes(ui()).find((n) => n.class === 'android.webkit.WebView');
  const [, wy1, , wy2] = webNode ? bounds(webNode) : [0, 0, 0, 0];
  check('WebView가 상태 표시줄 아래에서 시작한다', wy1 >= 40, webNode?.bounds);
  check('WebView가 내비게이션 바 위에서 끝나고 페이지 높이와 맞는다', Math.abs(wy2 - wy1 - info.ih * info.dpr) < 4, { webView: webNode?.bounds, cssH: info.ih, dpr: info.dpr });
  shot('a1-login');

  // 2. 로그인 상태 목록
  await prepare(c);
  check('로그인하면 목록이 보인다', await c.ev(`document.querySelectorAll('#place-list .group').length > 0`));
  check('휴대폰 너비라 ☰ 메뉴가 보인다', await c.ev(`getComputedStyle(document.querySelector('#menu-button')).display !== 'none'`));
  shot('a2-list');

  if (want('back')) {
    await c.ev(`window.__marker = 42`);
    back();
    const t1 = await waitTop((t) => !ours(t), 4000);
    check('[뒤로](닫을 것 없음) → 앱이 뒤로 내려간다', !ours(t1), t1);
    const t2 = await bringBack();
    await sleep(500);
    check('다시 열면 같은 화면(새로 불러오지 않음, 로그인 유지)', ours(t2) && (await c.ev(`window.__marker === 42 && !document.querySelector('.app').hidden`)), t2);

    await c.ev(`__e2e.row('APP_01').click()`); await sleep(500);
    check('장소를 누르면 상세 정보', await c.ev(`!document.querySelector('#detail').hidden`));
    back(); await sleep(600);
    check('[뒤로] → 상세 정보가 닫힌다(앱은 그대로)', (await c.ev(`document.querySelector('#detail').hidden`)) && ours(topActivity()));

    const item = `document.querySelector('#detail .mission-item[data-mission="M_01"]')`;
    await c.ev(`__e2e.row('APP_01').click()`); await sleep(500);
    await c.ev(`${item}.click()`); await sleep(500);
    check('미션을 누르면 기록 창(모달)', await c.ev(`Boolean(document.querySelector('dialog.mission-dialog[open]'))`));
    shot('a5-mission');
    back(); await sleep(600);
    check('[뒤로] → 미션 기록 창만 닫힌다', await c.ev(`!document.querySelector('dialog[open]') && !document.querySelector('#detail').hidden`));

    await c.ev(`${item}.click()`); await sleep(500);
    await c.ev(`(() => { const i = document.querySelector('dialog.mission-dialog input[name=flightMin]'); i.value = '5'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    back();
    const msg = await dialogMessage();
    check('고친 값이 있으면 [뒤로] → 기기 확인 창(버릴까요?)', msg?.text?.includes('저장하지 않은 미션 기록'), msg?.text);
    shot('a6-confirm');
    const cancelBtn = await dialogButton(2);
    check('확인 창에 [취소]·[확인]', cancelBtn?.text === '취소' && (await dialogButton(1))?.text === '확인');
    tapNode(cancelBtn); await sleep(500);
    check('[취소] → 기록 창 그대로(쓰던 값 유지)', await c.ev(`Boolean(document.querySelector('dialog.mission-dialog[open]')) && document.querySelector('dialog.mission-dialog input[name=flightMin]').value === '5'`));
    back();
    tapNode(await dialogButton(1)); await sleep(600);
    check('[확인] → 기록 창이 닫힌다', await c.ev(`!document.querySelector('dialog[open]')`));
    back(); await sleep(500);
    check('[뒤로] 한 번 더 → 상세 정보 닫힘', await c.ev(`document.querySelector('#detail').hidden`));

    await c.ev(`document.querySelector('#menu-button').click()`); await sleep(300);
    check('☰ 누르면 메뉴가 펼쳐진다', await c.ev(`document.querySelector('.topbar').classList.contains('menu-open')`));
    back(); await sleep(400);
    check('[뒤로] → ☰ 메뉴가 접힌다', await c.ev(`!document.querySelector('.topbar').classList.contains('menu-open')`));
    await c.ev(`document.querySelector('#menu-button').click()`); await sleep(300);
    await c.ev(`document.querySelector('#export-button').click()`); await sleep(300);
    check('[내보내기] 메뉴가 열린다', await c.ev(`!document.querySelector('#export-menu').hidden`));
    back(); await sleep(400);
    check('[뒤로] → [내보내기] 메뉴만 닫히고 ☰는 펼친 채', await c.ev(`document.querySelector('#export-menu').hidden && document.querySelector('.topbar').classList.contains('menu-open')`));
    back(); await sleep(400);
    check('[뒤로] 한 번 더 → ☰ 접힘, 앱은 그대로', (await c.ev(`!document.querySelector('.topbar').classList.contains('menu-open')`)) && ours(topActivity()));
  }

  if (want('export')) {
    adbQuiet('shell', `content delete --uri content://media/external/downloads --where "_display_name LIKE 'places-%' OR _display_name LIKE 'missions-%'"`);
    const exportItem = async (i) => {
      await c.ev(`document.querySelector('#menu-button').click()`); await sleep(300);
      await c.ev(`document.querySelector('#export-button').click()`); await sleep(300);
      await c.ev(`document.querySelectorAll('#export-menu .menu-item')[${i}].click()`);
    };
    const count = await c.ev(`__fake.store().length`);
    await exportItem(0);
    let m = await dialogMessage();
    check('장소 내보내기 → "다운로드 폴더에 저장했습니다" 창', m?.text?.includes('다운로드 폴더에 저장했습니다') && m.text.includes(`places-${stamp}.csv`), m?.text);
    shot('a8-export');
    const placesCsv = execFileSync(ADB, ['exec-out', 'cat', `/sdcard/Download/places-${stamp}.csv`]);
    const lines = placesCsv.toString('utf-8').replace(/^﻿/, '').trim().split(/\r?\n/);
    check('다운로드 폴더에 CSV가 생긴다(엑셀용 BOM, 머리글 + 장소 수만큼 줄)', placesCsv[0] === 0xef && placesCsv[1] === 0xbb && lines.length === count + 1, { lines: lines.length, places: count, head: lines[0] });
    const share = await dialogButton(3);
    check('저장 창에 [공유]', share?.text === '공유');
    tapNode(share);
    const chooser = await waitTop((t) => !ours(t), 4000);
    check('[공유] → 공유 대상 고르기 화면', /Chooser|Resolver|intentresolver/i.test(chooser), chooser);
    back(); await waitTop(ours, 4000); await sleep(300);

    await exportItem(0);
    m = await dialogMessage();
    check('같은 날 다시 내보내면 이름이 겹치지 않게 저장("(1)")', m?.text?.includes(`places-${stamp} (1).csv`), m?.text);
    tapNode(await dialogButton(1)); await sleep(300);

    await exportItem(1);
    m = await dialogMessage();
    check('미션 기록 내보내기 → missions-날짜.csv', m?.text?.includes(`missions-${stamp}.csv`), m?.text);
    tapNode(await dialogButton(1)); await sleep(300);
    const missionsCsv = adb('exec-out', 'cat', `/sdcard/Download/missions-${stamp}.csv`).replace(/^﻿/, '');
    check('미션 기록 CSV 머리글', missionsCsv.split(/\r?\n/)[0] === MISSION_CSV_HEADER, missionsCsv.split(/\r?\n/)[0]);
    check('내보내기 뒤 앱 화면 그대로(다른 곳으로 넘어가지 않음)', (await c.ev(`location.href`)) === BASE && ours(topActivity()));
  }

  if (want('import')) {
    const name = 'android-import-test.csv';
    const src = path.join(E2E, 'fixtures', 'plain.csv');
    adb('push', src, `/sdcard/Download/${name}`);
    adbQuiet('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file:///sdcard/Download/${name}`);
    await sleep(800);
    const openPicker = async () => {
      await c.ev(`document.querySelector('#menu-button').click()`); await sleep(300);
      await c.ev(`document.querySelector('#import-button').click()`);
      return waitTop((t) => !ours(t), 5000);
    };
    let picker = await openPicker();
    check('[CSV 가져오기] → 파일 고르기 화면', /documentsui/i.test(picker), picker);
    shot('a9-picker');
    back(); await waitTop(ours, 4000); await sleep(400);
    picker = await openPicker();
    check('고르기를 취소한 뒤 다시 눌러도 파일 고르기가 열린다', /documentsui/i.test(picker), picker);
    let file = await waitUi((n) => n.text === name, 4000);
    if (!file) {
      const roots = await waitUi((n) => /Show roots|루트 표시/.test(n['content-desc'] ?? ''), 3000);
      tapNode(roots);
      tapNode(await waitUi((n) => n.text === 'Downloads' || n.text === '다운로드', 3000));
      file = await waitUi((n) => n.text === name, 5000);
    }
    check('다운로드 폴더의 CSV가 목록에 보인다', Boolean(file));
    await c.ev(`window.__picked = null; document.addEventListener('change', (e) => { if (e.target.id === 'csv-input') window.__picked = [...e.target.files].map((f) => f.name + ':' + f.size); }, true)`);
    tapNode(file);
    await waitTop(ours, 5000);
    await c.waitFor(`window.__picked !== null`, 5000);
    check('고른 파일이 페이지에 그대로 전달된다(이름·크기)', JSON.stringify(await c.ev('window.__picked')) === JSON.stringify([`${name}:${fs.statSync(src).size}`]));
    const goBtn = `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '가져오기' && b.offsetParent)`;
    check('사이트의 가져오기 확인 카드가 뜬다', await c.waitFor(`Boolean(${goBtn})`, 5000));
    await c.ev(`${goBtn}?.click()`);
    await c.waitFor(`Boolean(document.querySelector('#import-review-continue')) || __fake.store().some((p) => p.name === 'NEW_02')`, 8000);
    if (await c.ev(`Boolean(document.querySelector('#import-review-continue'))`)) await c.ev(`document.querySelector('#import-review-continue').click()`);
    check('고른 CSV가 가져와진다(NEW_02 추가)', await c.waitFor(`__fake.store().some((p) => p.name === 'NEW_02')`, 8000));
    shot('a9-imported');
    adbQuiet('shell', 'rm', '-f', `/sdcard/Download/${name}`);
  }

  if (want('external')) {
    await c.ev(`__e2e.row('APP_01').click()`); await sleep(500);
    await c.ev(`[...document.querySelectorAll('#detail a')].find((a) => a.textContent.includes('카카오맵에서 보기')).click()`);
    let t = await waitTop((x) => !ours(x), 6000);
    check('[카카오맵에서 보기](새 창 링크) → 바깥 브라우저로 열린다', /chrome|browser/i.test(t), t);
    shot('a10-external');
    await bringBack(); await sleep(500);
    check('돌아오면 앱은 원래 화면 그대로', (await c.ev(`location.href`)) === BASE && (await c.ev(`!document.querySelector('#detail').hidden`)));
    await c.ev(`[...document.querySelectorAll('#detail button')].find((b) => b.textContent.includes('카카오맵 길찾기')).click()`);
    t = await waitTop((x) => !ours(x), 6000);
    check('[카카오맵 길찾기] → 카카오맵 앱이 없으면 웹 길찾기를 바깥 브라우저로', /chrome|browser|kakao/i.test(t), t);
    await bringBack(); await sleep(500);
    check('길찾기 뒤 돌아와도 앱 화면 그대로', (await c.ev(`location.href`)) === BASE);
    back(); await sleep(400);
  }

  if (want('beforeunload')) {
    // 저장 안 한 메모가 있으면 사이트가 beforeunload로 묻는다. 앱은 그 창(영어 "Leave this page")을 띄우지 않고 넘어가야
    // [카카오맵 길찾기](kakaomap://)가 막히지 않는다. 창이 뜨면 페이지 JS가 멈춰 c.ev가 영영 안 돌아오므로 화면부터 본다.
    await c.ev(`__e2e.row('APP_01').click()`); await sleep(500);
    await c.ev(`(() => {
      const memo = document.querySelector('#memo-input');
      memo.focus(); memo.value = '앱 점검 메모 ' + Date.now(); memo.dispatchEvent(new Event('input', { bubbles: true }));
      // 누르기는 이 평가가 끝난 뒤에 한다. 창이 뜨면 누르기 안에서 JS가 멈춰 평가가 안 돌아오기 때문이다.
      const go = [...document.querySelectorAll('#detail button')].find((b) => b.textContent.includes('카카오맵 길찾기'));
      setTimeout(() => go.click(), 0);
    })()`);
    const leaveDialog = (n) => n['resource-id'] === 'android:id/message' || /leave|navigate|나가/i.test(n.text ?? '');
    const stuck = await waitUi(leaveDialog, 3000);
    check('저장 안 한 메모가 있어도 [카카오맵 길찾기]에 "떠날까요?" 창이 뜨지 않는다', !stuck, stuck?.text);
    if (stuck) {
      shot('a10b-beforeunload');
      back(); await sleep(600); // 창을 닫아야 페이지 JS가 다시 돈다.
    }
    const t = await waitTop((x) => !ours(x), 6000);
    check('메모를 쓰던 중에도 길찾기가 바깥으로 열린다', !ours(t), t);
    await bringBack(); await sleep(500);
    // 돌아온 뒤에도 혹시 창이 남아 있으면 닫고 나서 페이지를 본다.
    if (await waitUi(leaveDialog, 1000)) { check('돌아왔을 때 남은 "떠날까요?" 창 없음', false); back(); await sleep(600); }
    check('길찾기 뒤 돌아와도 앱 화면 그대로(메모 쓰던 페이지)', (await c.ev(`location.href`)) === BASE);
    await c.ev(`document.activeElement?.blur()`); await sleep(300);
    back(); await sleep(400);
  }

  if (want('keyboard')) {
    await c.ev(`__e2e.row('APP_01').click()`); await sleep(500);
    const before = await c.ev(`innerHeight`);
    await c.ev(`document.querySelector('#memo-input').scrollIntoView({ block: 'center' })`); await sleep(300);
    const r = await c.ev(`(() => { const r = document.querySelector('#memo-input').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 20), dpr: devicePixelRatio }; })()`);
    const [vx, vy] = bounds(nodes(ui()).find((n) => n.class === 'android.webkit.WebView'));
    tap(Math.round(vx + r.x * r.dpr), Math.round(vy + r.y * r.dpr));
    await sleep(1500);
    const after = await c.ev(`({ ih: innerHeight, focused: document.activeElement?.id, top: document.querySelector('#memo-input').getBoundingClientRect().top })`);
    check('메모 칸을 누르면 키보드가 뜨고 화면이 그만큼 줄어든다', after.focused === 'memo-input' && after.ih < before - 100, { before, after });
    check('메모 칸이 키보드에 가리지 않는다', after.top < after.ih, after);
    shot('a11-keyboard');
    back(); await sleep(600); // 키보드 내리기
    back(); await sleep(400);
  }

  if (want('rotate')) {
    await c.ev(`window.__marker = 7`);
    adb('shell', 'wm', 'user-rotation', 'lock', '1'); await sleep(2500);
    const land = await c.ev(`({ w: innerWidth, h: innerHeight, m: window.__marker })`);
    check('가로로 돌려도 화면을 다시 만들지 않는다(쓰던 상태 유지)', land.w > land.h && land.m === 7, land);
    shot('a12-landscape');
    adb('shell', 'wm', 'user-rotation', 'lock', '0'); await sleep(1500);
  }

  const crashes = adb('logcat', '-d', '-b', 'crash');
  check('앱이 죽은 기록 없음(logcat crash)', !crashes.includes(PKG));
  check('페이지 오류 없음', c.errors.length === 0, c.errors);
  c.close();

  if (want('location')) {
    // 현위치: 페이지가 navigator.geolocation을 부르면 이 사이트 주소에만, 안드로이드 권한을 받은 뒤 허용한다.
    // 웹의 [현위치] 버튼과 같은 API를 직접 부른다. 권한 창이 뜨는 동안 JS를 기다리면 안 되므로 요청만 걸어 두고 결과를 따로 본다.
    const FINE = 'android.permission.ACCESS_FINE_LOCATION';
    const COARSE = 'android.permission.ACCESS_COARSE_LOCATION';
    const SEOUL = { lng: 126.978, lat: 37.5665 };
    const permitted = (perm) => new RegExp(`${perm}: granted=true`).test(adb('shell', 'dumpsys', 'package', PKG));
    // enableHighAccuracy: 에뮬레이터는 GPS(adb emu geo fix)만 좌표를 주고, 대략적 위치(fused)는 좌표를 주지 않아 시간이 다 된다.
    const geoStart = (cc, name) => cc.ev(`(() => {
      window.${name} = null; const t0 = Date.now();
      const done = (r) => { window.${name} = { ...r, ms: Date.now() - t0 }; };
      const timer = setTimeout(() => done({ hang: true }), 25000);
      navigator.geolocation.getCurrentPosition(
        (p) => { clearTimeout(timer); done({ lat: p.coords.latitude, lng: p.coords.longitude }); },
        (e) => { clearTimeout(timer); done({ code: e.code }); },
        { timeout: 20000, maximumAge: 0, enableHighAccuracy: true });
    })()`);
    // 에뮬레이터 GPS는 켜진 뒤에 들어온 좌표만 넘기므로, 기다리는 동안 좌표를 다시 보낸다.
    const geoResult = async (cc, name, timeout = 25000) => {
      for (const end = Date.now() + timeout; Date.now() < end;) {
        if ((await cc.ev(`window.${name} !== null`)) === true) break;
        adbQuiet('emu', 'geo', 'fix', String(SEOUL.lng), String(SEOUL.lat));
        await sleep(1000);
      }
      return cc.ev(`window.${name}`);
    };
    const near = (r) => r && Math.abs(r.lat - SEOUL.lat) < 0.05 && Math.abs(r.lng - SEOUL.lng) < 0.05;
    // [허용 안 함]은 안드로이드 버전에 따라 id가 permission_deny_button 또는 permission_deny_and_dont_ask_again_button이다.
    const permButton = (id, timeout = 8000) => waitUi((n) => {
      const rid = n['resource-id'] ?? '';
      return id === 'deny' ? /:id\/permission_deny(_and_dont_ask_again)?_button$/.test(rid) : rid.endsWith(`:id/${id}`);
    }, timeout);
    // 권한을 거두고 "다시 묻지 않음" 표시도 지운다(두 번 거절하면 시스템이 창 없이 바로 거절하므로).
    const resetPerms = () => {
      for (const perm of [FINE, COARSE]) {
        adb('shell', 'pm', 'revoke', PKG, perm);
        adb('shell', 'pm', 'clear-permission-flags', PKG, perm, 'user-fixed', 'user-set');
      }
    };
    // 앱을 새로 띄워 WebView에 붙는다(권한을 거두면 앱이 죽을 수 있다).
    const geoApp = async () => {
      await start(`${BASE}__blank`);
      const cc = await connect();
      await sleep(500);
      return cc;
    };
    adbQuiet('shell', 'settings', 'put', 'secure', 'location_mode', '3');
    adb('emu', 'geo', 'fix', String(SEOUL.lng), String(SEOUL.lat));

    // 1. 새로 설치한 뒤 첫 요청 → 권한 창 → "앱 사용 중에만 허용"
    check('설치 직후에는 위치 권한이 없다(시작할 때 묻지 않음)', !permitted(FINE) && !permitted(COARSE));
    let g = await geoApp();
    await geoStart(g, '__geo');
    const allow = await permButton('permission_allow_foreground_only_button');
    check('현위치 요청 → 안드로이드 위치 권한 창이 뜬다', Boolean(allow), allow?.text);
    shot('a14-location-dialog');
    tapNode(allow);
    let r = await geoResult(g, '__geo');
    check('[앱 사용 중에만 허용] → 페이지가 좌표를 받는다(설정한 위치 근처)', near(r), r);
    check('허용 뒤 권한이 허용 상태', permitted(FINE) || permitted(COARSE));
    g.close();

    // 2. 이미 허용된 상태(앞 단계 결과 유지): 창 없이 좌표
    g = await geoApp();
    await geoStart(g, '__geo');
    r = await geoResult(g, '__geo');
    check('이미 허용했으면 권한 창 없이 좌표를 받는다', near(r) && !(await permButton('deny', 500)), r);
    g.close();

    // 3. 권한을 거둔 뒤 요청 → "허용 안 함" → 바로 오류 1(PERMISSION_DENIED), 멈춤·꺼짐 없음
    resetPerms();
    check('pm revoke 뒤 권한이 없다', !permitted(FINE) && !permitted(COARSE));
    g = await geoApp();
    await geoStart(g, '__geo');
    const deny = await permButton('deny');
    check('권한을 거둔 뒤 요청하면 권한 창이 다시 뜬다', Boolean(deny));
    const tDeny = Date.now();
    tapNode(deny);
    r = await geoResult(g, '__geo', 8000);
    check('[허용 안 함] → 페이지가 바로 오류 1을 받는다(멈추지 않음)', r?.code === 1 && Date.now() - tDeny < 6000, { r, ms: Date.now() - tDeny });
    check('거절한 뒤에도 앱이 살아 있다', ours(topActivity()));
    g.close();

    // 4. 권한 창이 떠 있는 동안 온 두 번째 요청은 창을 또 띄우지 않고 같은 답을 받는다(둘 다 좌표)
    g = await geoApp();
    await geoStart(g, '__geo');
    const allow2 = await permButton('permission_allow_foreground_only_button');
    await geoStart(g, '__geo2');
    await sleep(500);
    check('두 번째 요청이 와도 권한 창은 그대로 하나, 아직 답 없음(멈춘 것이 아니라 대기)', (await g.ev(`window.__geo === null && window.__geo2 === null`)) && Boolean(await permButton('permission_allow_foreground_only_button', 1000)));
    tapNode(allow2);
    r = await geoResult(g, '__geo');
    const r2 = await geoResult(g, '__geo2');
    check('[허용] → 대기하던 두 요청 모두 좌표를 받는다', near(r) && near(r2), { r, r2 });
    g.close();

    // 5. pm grant로 미리 허용: 창 없이 좌표. 그 상태에서 사이트 주소가 아닌 틀(127.0.0.1)은 거절, 사이트 주소 틀은 허용
    resetPerms();
    adb('shell', 'pm', 'grant', PKG, FINE);
    adb('shell', 'pm', 'grant', PKG, COARSE);
    g = await geoApp();
    await geoStart(g, '__geo');
    r = await geoResult(g, '__geo');
    check('pm grant로 허용한 상태: 권한 창 없이 좌표', near(r) && !(await permButton('deny', 500)), r);
    const frameGeo = async (src) => {
      await g.ev(`(() => { window.__fr = null;
        addEventListener('message', (e) => { if (e.data?.geoframe) window.__fr = { ...e.data.geoframe, from: e.data.origin }; });
        const f = document.createElement('iframe'); f.allow = 'geolocation'; f.src = ${JSON.stringify(src)}; document.body.append(f); })()`);
      await g.waitFor(`window.__fr !== null`, 15000);
      return g.ev(`window.__fr`);
    };
    r = await frameGeo(`http://127.0.0.1:${PORT}/__geoframe`);
    check('권한이 있어도 사이트 주소가 아닌 틀(127.0.0.1)의 위치 요청은 거절된다', r?.code === 1 && r.from === `http://127.0.0.1:${PORT}`, r);
    r = await frameGeo(`${BASE}__geoframe`);
    check('(대조) 사이트 주소의 틀은 같은 조건에서 좌표를 받는다', near(r), r);
    g.close();

    // 6. 앱의 권한 요청 중에 앱이 내려갔다 오거나 닫혀도 안 죽는다
    resetPerms();
    g = await geoApp();
    await geoStart(g, '__geo');
    await permButton('deny');
    adb('shell', 'am', 'force-stop', PKG); // 권한 창이 떠 있는 채로 앱 종료
    await sleep(800);
    g.close();
    g = await geoApp();
    await geoStart(g, '__geo');
    const again = await permButton('deny');
    check('권한 창이 떠 있는 채 앱이 끝나도 다시 요청하면 정상으로 뜬다', Boolean(again));
    tapNode(again);
    r = await geoResult(g, '__geo', 8000);
    check('다시 요청한 것도 거절하면 오류 1', r?.code === 1, r);
    g.close();

    // 7. 사이트의 [현위치] 버튼을 앱에서 실제로 누른다: 권한 창 → 허용 → 지도에 파란 점, 오류 안내 없음
    resetPerms();
    g = await geoApp();
    await prepare(g);
    await g.waitFor(`Boolean(document.querySelector('#locate-btn'))`, 10000); // 버튼은 지도(가짜 카카오)가 준비된 뒤 생긴다
    await g.ev(`document.querySelector('#locate-btn').click()`);
    const allow3 = await permButton('permission_allow_foreground_only_button');
    check('앱에서 [현위치]를 누르면 안드로이드 위치 권한 창', Boolean(allow3));
    if (allow3) tapNode(allow3);
    let dot = false;
    for (const end = Date.now() + 25000; Date.now() < end && !dot;) {
      adbQuiet('emu', 'geo', 'fix', String(SEOUL.lng), String(SEOUL.lat));
      await sleep(1000);
      dot = await g.ev(`Boolean(document.querySelector('.my-location'))`);
    }
    const after = await g.ev(`({ busy: document.querySelector('#locate-btn').getAttribute('aria-busy'), toast: document.querySelector('#toast')?.textContent ?? '' })`);
    check('[허용] → 지도에 내 위치(파란 점)가 그려지고 위치 오류 안내 없음', dot && after.busy === 'false' && !/위치/.test(after.toast), after);
    shot('a15-locate-button');
    g.close();

    const crashes2 = adb('logcat', '-d', '-b', 'crash');
    check('현위치 점검 내내 앱이 죽은 기록 없음(logcat crash)', !crashes2.includes(PKG), crashes2.slice(-300));
  }

  if (want('offline')) {
    // 처음 불러오기 실패 → [다시 시도] 화면. 서버가 살아나면 [다시 시도]로 열린다.
    const deadPort = PORT - 1;
    adbQuiet('reverse', '--remove', `tcp:${deadPort}`);
    await start(`http://localhost:${deadPort}/`);
    check('처음 불러오기에 실패하면 [다시 시도] 화면', Boolean(await waitUi((n) => n.text === '연결할 수 없습니다', 8000)));
    shot('a13-offline');
    adb('reverse', `tcp:${deadPort}`, `tcp:${PORT}`);
    tapNode(await waitUi((n) => n.text === '다시 시도', 3000));
    let gone = false;
    for (let end = Date.now() + 8000; Date.now() < end && !gone;) { gone = !nodes(ui()).some((n) => n.text === '연결할 수 없습니다'); if (!gone) await sleep(400); }
    check('[다시 시도] → 서버가 살아 있으면 화면이 열린다', gone);
    adbQuiet('reverse', '--remove', `tcp:${deadPort}`);
  }
} finally {
  c?.close();
  server.kill();
  adbQuiet('reverse', '--remove', `tcp:${PORT}`);
  adbQuiet('forward', '--remove', `tcp:${DEVTOOLS_PORT}`);
}

const fails = results.filter((r) => !r.ok).length;
console.log(`\n[android] 결과: ${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
