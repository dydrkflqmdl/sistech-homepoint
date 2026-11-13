// E2E 공용 도구: 헤드리스 Chrome(CDP), 가짜 카카오·supabase 주입, 데이터 준비, 결과 집계.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 이 폴더(e2e/)와 저장소 뿌리(e2e/의 한 단계 위). E2E_PROJECT로 다른 작업 폴더(worktree 등)를 가리킬 수 있다.
export const E2E = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT = process.env.E2E_PROJECT ? path.resolve(process.env.E2E_PROJECT) : path.resolve(E2E, '..');
export const PORT = Number(process.env.E2E_PORT) || 4198;
export const URL_BASE = `http://localhost:${PORT}/`;
export const SHOTS = path.join(E2E, 'shots');
export const RESULTS = path.join(E2E, 'results');
export const FIXTURES = path.join(E2E, 'fixtures');
export const Q1_CSV = path.join(FIXTURES, '홈포인트_Q1.csv');
// 헤드리스 Chrome 실행 파일. CHROME_BIN이 있으면 그것을, 없으면 운영체제 기본 위치를 쓴다.
export const CHROME_BIN =
  process.env.CHROME_BIN ||
  (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
// 덧붙일 Chrome 옵션(E2E_CHROME_FLAGS, 빈칸으로 구분). CI(GitHub Actions 등, CI=true)에서는 샌드박스를 못 쓰는 경우가 많아
// --no-sandbox를 기본으로 붙인다(외부 주소는 모두 막고 로컬 화면만 여므로 괜찮다).
const EXTRA_CHROME_FLAGS = [
  ...(process.env.CI ? ['--no-sandbox'] : []),
  ...(process.env.E2E_CHROME_FLAGS ?? '').split(/\s+/).filter(Boolean),
];
for (const d of [SHOTS, RESULTS, FIXTURES]) fs.mkdirSync(d, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 공용 지도 서버 보호 + 진짜 supabase-js 차단
export const BLOCKED = ['*dapi.kakao.com*', '*daumcdn.net*', '*openstreetmap.org*', '*cartocdn.com*', '*arcgisonline.com*', '*cdn.jsdelivr.net*'];

export function fakeSupabaseSource() {
  const mission = fs.readFileSync(path.join(PROJECT, 'public/mission.js'), 'utf-8').replace(/^export /gm, '');
  // 가짜 admin-users 함수가 아이디 → 이메일 변환을 앱과 같은 규칙으로 하려고 login-id.js도 붙인다.
  const loginId = fs.readFileSync(path.join(PROJECT, 'public/login-id.js'), 'utf-8').replace(/^export /gm, '');
  const fake = fs.readFileSync(path.join(E2E, 'fake-supabase.js'), 'utf-8');
  return `(() => {\n${mission}\n${loginId}\nwindow.__missionNames = missionNames;\n${fake}\n})();`;
}

// 페이지 안 도우미(window.__e2e). 접힌 시군의 장소 줄은 DOM에 없으므로(화면 성능 개선) 줄을 찾을 때 그 시군을 펼친다.
//   __e2e.row(name)     장소 이름으로 목록 줄(button[data-id])을 찾는다. 시군이 접혀 있으면 머리를 눌러 펼친 뒤 찾는다.
//   __e2e.openAll()     모든 시군을 펼친다.  __e2e.collapseAll()  펼친 시군을 모두 접는다.
//   __e2e.rows()        지금 DOM에 있는 장소 줄 이름 목록
export const PAGE_HELPERS = `(() => {
  const nameOf = (b) => b.querySelector('.name')?.firstChild?.textContent.trim();
  const rows = () => [...document.querySelectorAll('#place-list button[data-id]')];
  window.__e2e = {
    rows: () => rows().map(nameOf),
    row(name) {
      const find = () => rows().find((b) => nameOf(b) === name);
      if (find()) return find();
      const place = window.__fake?.store().find((p) => p.name === name);
      const district = String(place?.district ?? '').trim() || '시군 없음';
      const head = document.querySelector('#place-list .group-head[data-district="' + CSS.escape(district) + '"]');
      if (head && head.getAttribute('aria-expanded') !== 'true') head.click();
      return find() ?? null;
    },
    openAll() { for (const head of document.querySelectorAll('#place-list .group-head[aria-expanded="false"]')) head.click(); },
    collapseAll() { for (const head of document.querySelectorAll('#place-list .group-head[aria-expanded="true"]')) head.click(); },
  };
})();`;

// csv.js를 Node에서 불러온다(브라우저와 같은 파싱 결과를 기준값으로 쓰려고).
export const csv = () => import(path.join(PROJECT, 'public/csv.js'));

// 미션 기록 내보내기 머리글(계약 C11)
export const MISSION_CSV_HEADER = '시군,이름,미션명,완료,작업자,비행시간,배터리 번호,배터리 남은 용량,마지막 저장';

// launch({ csvShim: 'legacy' })로 브라우저가 받는 csv.js에서 toMissionCsv를 감춘다(파일은 그대로).
// 옛 csv.js에서 [내보내기]가 메뉴 없이 바로 장소를 내보내는지 보려고 쓴다.
export function shimCsvSource(src, mode) {
  if (mode === 'legacy') return src.replace(/export\s+(function|const|let)\s+toMissionCsv\b/, '$1 __hiddenToMissionCsv');
  return src;
}

let portSeq = 9450 + Math.floor(Math.random() * 300);
export async function launch(name, { confirm = true, fakeSupabase = true, fakeKakao = true, viewport = [390, 844, true], csvShim = null } = {}) {
  const port = portSeq++;
  const profile = path.join(E2E, 'profiles', `${name}-${Date.now()}`);
  const chrome = spawn(CHROME_BIN, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', ...EXTRA_CHROME_FLAGS, 'about:blank',
  ], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 75 && !targets; i++) {
    await sleep(200);
    targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => null);
  }
  if (!targets) throw new Error('Chrome이 뜨지 않음');
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  const blocked = [];
  const requests = [];
  const listeners = [];
  const rpcCounts = {};
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('[console.error] ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
    if (m.method === 'Network.loadingFailed' && m.params.blockedReason) blocked.push(m.params.requestId);
    if (m.method === 'Runtime.bindingCalled' && m.params.name === '__e2eRpc') rpcCounts[m.params.payload] = (rpcCounts[m.params.payload] ?? 0) + 1;
    for (const l of listeners) l(m);
  });
  const send = (method, params = {}) => new Promise((r) => {
    pending.set(++id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.error) throw new Error('evaluate: ' + JSON.stringify(r.error));
    if (r.result?.exceptionDetails) throw new Error('evaluate: ' + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text));
    return r.result?.result?.value;
  };
  const shot = async (file) => {
    const { result } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, file + '.png'), Buffer.from(result.data, 'base64'));
  };
  const setViewport = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });
  const waitFor = async (expr, timeout = 5000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await ev(expr).catch(() => false)) return true;
      await sleep(50);
    }
    return false;
  };
  const navigate = async (url = URL_BASE, settle = 800) => {
    await send('Page.navigate', { url });
    await waitFor(`document.readyState === 'complete'`, 8000);
    await sleep(settle);
  };
  // 숨은 파일 입력에 실제 파일 경로를 넣는다(브라우저가 change 이벤트를 보낸다).
  const setFiles = async (selector, files) => {
    const { result: { root } } = await send('DOM.getDocument', { depth: 0 });
    const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
    return send('DOM.setFileInputFiles', { nodeId, files });
  };
  const close = async () => {
    fs.writeFileSync(path.join(RESULTS, `rpc-${name}.json`), JSON.stringify(rpcCounts));
    try { ws.close(); } catch { /* 이미 닫혔으면 그만 */ }
    chrome.kill();
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true });
  };

  // 규칙: Runtime → Network → 차단 → Page → 주입 → (그 다음 navigate)
  await send('Runtime.enable');
  // 가짜 supabase가 rpc마다 부른다 → 페이지를 넘어 스크립트 전체의 RPC 호출 수를 센다.
  await send('Runtime.addBinding', { name: '__e2eRpc' });
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: BLOCKED });
  if (csvShim) {
    // 브라우저가 받는 csv.js만 가로채 고친다(위 shimCsvSource).
    await send('Fetch.enable', { patterns: [{ urlPattern: '*/csv.js*', requestStage: 'Response' }] });
    listeners.push(async (m) => {
      if (m.method !== 'Fetch.requestPaused') return;
      const { requestId } = m.params;
      const { result } = await send('Fetch.getResponseBody', { requestId });
      const src = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf-8') : result.body;
      await send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/javascript; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }],
        body: Buffer.from(shimCsvSource(src, csvShim), 'utf-8').toString('base64'),
      });
    });
  }
  await send('Page.enable');
  // 내려받기는 이 테스트용 프로필 폴더 안에만 저장한다(close 때 함께 지워짐). 안 하면 ~/Downloads에 places-….csv가 쌓인다.
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.join(profile, 'downloads') });
  if (fakeKakao) await send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(path.join(E2E, 'fake-kakao.js'), 'utf-8') });
  if (fakeSupabase) await send('Page.addScriptToEvaluateOnNewDocument', { source: fakeSupabaseSource() });
  // confirm은 기본으로 "예". 몇 번, 무슨 문구로 물었는지는 window.__confirms에 남긴다.
  if (confirm) await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__confirms = []; window.confirm = (m) => { window.__confirms.push(String(m)); return true; };' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HELPERS });
  await setViewport(...viewport);

  return { rpcCounts, send, ev, shot, setViewport, waitFor, navigate, setFiles, close, errors, blocked, requests, listeners };
}

// 로그인된 상태 + 데이터로 시작한다. rows는 readPlaces().places(import_places 규칙으로 넣음), after는 DB를 더 손보는 함수 문자열.
// admins는 app_metadata.role = 'admin'을 받을 이메일 목록, accounts는 가짜 admin-users 함수의 계정 목록(계정 관리 시나리오용).
// users는 이메일 → user_metadata.login_id, appLoginIds는 이메일 → app_metadata.login_id(계약 C4).
// roles는 이메일 → 'staff' | 'contractor'(DB의 현재 역할. 세션을 만들기 전에 넣으면 토큰에도 반영된다).
export async function prepare(b, { rows = null, places = null, after = null, email = 'admin@sistech.test', signedIn = true, admins = null, accounts = null, users = null, appLoginIds = null, roles = null } = {}) {
  await b.navigate(URL_BASE, 300);
  await b.ev(`(() => {
    localStorage.clear();
    __fake.reset();
    ${places ? `__fake.seed(${JSON.stringify(places)});` : ''}
    ${rows ? `__fake.importRows(${JSON.stringify(rows)});` : ''}
    ${after ? `__fake.remoteChange(${after}, { notify: false });` : ''}
    ${admins ? `__fake.setAdmins(${JSON.stringify(admins)});` : ''}
    ${roles ? `__fake.setRoles(${JSON.stringify(roles)});` : ''}
    ${accounts ? `__fake.seedAccounts(${JSON.stringify(accounts)});` : ''}
    ${users ? `__fake.setUsers(${JSON.stringify(users)});` : ''}
    ${appLoginIds ? `__fake.setAppLoginIds(${JSON.stringify(appLoginIds)});` : ''}
    ${signedIn ? `__fake.setSession(${JSON.stringify(email)});` : '__fake.clearSession();'}
  })()`);
  await b.navigate(URL_BASE, 300);
  if (signedIn) await b.waitFor(`!document.querySelector('.app').hidden && document.querySelectorAll('#place-list .group').length > 0 || !document.querySelector('#empty').hidden`, 5000);
  await b.waitFor(`document.querySelectorAll('.pin').length > 0 || !document.querySelector('#empty').hidden || document.querySelector('.app').hidden`, 3000);
  await sleep(300);
}

export async function q1Rows() {
  const { readPlaces } = await csv();
  return readPlaces(fs.readFileSync(Q1_CSV)).places;
}

// 결과 모음
export function reporter(name) {
  const results = [];
  const check = (label, ok, detail = '') => {
    results.push({ label, ok: Boolean(ok), detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : ''}`);
  };
  const finish = async (b) => {
    if (b) await b.close();
    const fails = results.filter((r) => !r.ok).length;
    console.log(`\n[${name}] 결과: ${results.length - fails}/${results.length} 통과`);
    fs.writeFileSync(path.join(RESULTS, name + '.json'), JSON.stringify({ name, pass: results.length - fails, total: results.length, results }, null, 1));
    process.exit(fails > 0 ? 1 : 0);
  };
  return { check, finish, results };
}
