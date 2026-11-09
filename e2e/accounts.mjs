// 계정 관리(관리자만) 화면 확인. 서버는 가짜 Edge Function admin-users(fake-supabase.js).
// 비관리자: 버튼 없음·함수 호출 없음 / 관리자: 목록(한글 아이디·관리자 표시·본인) / 새 계정(성공·규칙 위반·짧은 비밀번호·중복 409)
// / 비밀번호 재설정(행 안 입력·본인 안내·성공·짧은 비밀번호) / 403·네트워크 실패는 로그아웃 없음, 401은 로그아웃 / 요청 중 버튼 잠금
// / 390px 머리글 넘침 없음 / 로그아웃 뒤 창 닫힘·상태 초기화 / 콘솔 오류 0건
import { launch, prepare, PROJECT, reporter, sleep } from './lib.mjs';

const loginIdModule = await import(PROJECT + '/public/login-id.js');
const { loginIdToEmail, LOGIN_ID_RULE } = loginIdModule;
const { check, finish } = reporter('accounts');

const ADMIN = 'admin@sistech.test';
const STAFF = 'staff@sistech.test';
// 비밀번호 규칙 문구는 인증 담당의 login-id.js를 따른다(없던 판에서는 화면의 대체 문구와 같다).
const PASSWORD_RULE = loginIdModule.PASSWORD_RULE ?? '비밀번호는 6자 이상 72자 이하여야 합니다.';
const places = [
  { name: 'SW_01', district: '태안', address: '소원면 송현리', lat: 36.766667, lng: 126.149826, mission: 'SW_01_01 ~ _03' },
  { name: 'BE_01', district: '보은', address: '보은읍 1리', lat: 36.49, lng: 127.73, mission: '' },
];
const sonEmail = loginIdToEmail('손두병');
const kimEmail = loginIdToEmail('김철수');
const accountsSeed = [
  { id: 'user-' + ADMIN, login_id: null, email: ADMIN, created_at: '2026-10-01T00:00:00Z', last_sign_in_at: '2026-11-06T03:12:00Z', is_admin: true },
  { id: 'user-son', login_id: '손두병', email: sonEmail, created_at: '2026-10-15T06:30:00Z', last_sign_in_at: null, is_admin: false },
  // login_id가 null → 화면은 이메일(xn--)에서 되살려 "김철수"
  { id: 'user-kim', login_id: null, email: kimEmail, created_at: '2026-10-20T01:00:00Z', last_sign_in_at: '2026-11-05T22:40:00Z', is_admin: false },
];

const view = `(() => {
  const q = (s) => document.querySelector(s);
  const panel = q('#accounts-panel');
  const msg = q('#accounts-message');
  return {
    login: !q('#login').hidden, app: !q('.app').hidden,
    loginError: q('#login-error').hidden ? null : q('#login-error').textContent,
    buttonShown: !!q('#accounts-button') && !q('#accounts-button').hidden && q('#accounts-button').offsetParent !== null,
    panelOpen: !panel.hidden, panelChildren: panel.children.length,
    message: msg && !msg.hidden ? msg.textContent : null, messageError: !!msg?.classList.contains('error'), messageRole: msg?.getAttribute('role') ?? null,
    rows: [...document.querySelectorAll('#accounts-panel .accounts-row')].map((tr) => ({
      id: tr.dataset.userId, resetting: tr.classList.contains('resetting'),
      name: tr.querySelector('.accounts-name')?.textContent ?? null, admin: !!tr.querySelector('.accounts-admin'), self: !!tr.querySelector('.accounts-self'),
      cells: [...tr.querySelectorAll('.accounts-when')].map((td) => td.textContent),
      resetBtn: tr.querySelector('button[data-reset]')?.textContent ?? null, resetDisabled: tr.querySelector('button[data-reset]')?.disabled ?? null,
      selfNotice: tr.querySelector('.accounts-self-notice')?.textContent ?? null,
    })),
    newId: q('#accounts-new-id')?.value ?? null, newPw: q('#accounts-new-password')?.value ?? null,
    invalid: [...document.querySelectorAll('#accounts-panel [aria-invalid="true"]')].map((e) => e.id),
    createDisabled: q('#accounts-create-button')?.disabled ?? null, createText: q('#accounts-create-button')?.textContent ?? null,
    closeDisabled: q('#accounts-close')?.disabled ?? null, refreshDisabled: q('#accounts-refresh')?.disabled ?? null,
    active: document.activeElement?.id || document.activeElement?.tagName,
    userName: q('#user-name').textContent,
    headerOverflow: q('.topbar').scrollWidth > q('.topbar').clientWidth || document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()`;
const fnCalls = (b) => b.ev(`__fake.fnCalls.map(c => ({ name: c.name, action: c.body?.action, login_id: c.body?.login_id, password: c.body?.password, user_id: c.body?.user_id }))`);
const clearCalls = (b) => b.ev(`__fake.fnCalls.length = 0; __fake.events.length = 0;`);
const type = (b, sel, value) => b.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const click = (b, sel) => b.ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const waitPanel = (b, cond, ms = 3000) => b.waitFor(`(() => { const q = (s) => document.querySelector(s); const msg = q('#accounts-message'); const message = msg && !msg.hidden ? msg.textContent : null; return ${cond}; })()`, ms);
const login = (b, id, pw = 'test1234') => b.ev(`(() => {
  const f = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  f('#login-id', ${JSON.stringify(id)}); f('#login-password', ${JSON.stringify(pw)});
  document.querySelector('#login-submit').click();
})()`);

const b = await launch('accounts', { viewport: [390, 844, true] });

// ── 비관리자 ──
await prepare(b, { places, email: STAFF, admins: [ADMIN], accounts: accountsSeed });
let v = await b.ev(view);
check('비관리자: 앱 화면, #accounts-button 숨김, 창 닫힘', v.app && !v.buttonShown && !v.panelOpen, v);
await b.ev(`document.querySelector('#accounts-button').click()`); // 숨은 버튼을 억지로 눌러도
await sleep(300);
v = await b.ev(view);
check('비관리자: 숨은 버튼을 눌러도 창이 열리지 않고 admin-users 호출 0회', !v.panelOpen && (await fnCalls(b)).length === 0, v);
const staffRole = await b.ev(`__fake.session()?.user?.app_metadata?.role ?? null`);
check('비관리자 세션에는 app_metadata.role 없음', staffRole === null, staffRole);

// ── 관리자: 창 열기·목록 ──
await prepare(b, { places, email: ADMIN, admins: [ADMIN], accounts: accountsSeed });
v = await b.ev(view);
check('관리자: #accounts-button 보임("계정 관리"), .actions 바로 아래(.account 밖)', v.buttonShown && (await b.ev(`document.querySelector('#accounts-button').textContent === '계정 관리' && document.querySelector('#accounts-button').parentElement.classList.contains('actions')`)), v);
check('관리자: 열기 전에는 admin-users 호출 0회', (await fnCalls(b)).length === 0);
await click(b, '#accounts-button');
await waitPanel(b, `document.querySelectorAll('#accounts-panel .accounts-row').length === 3`);
v = await b.ev(view);
const calls1 = await fnCalls(b);
check('창 열림: admin-users {action: list} 1회', v.panelOpen && calls1.length === 1 && calls1[0].name === 'admin-users' && calls1[0].action === 'list', calls1);
check('목록 3행: admin@sistech.test(관리자·본인)·손두병·김철수(login_id null → 이메일에서 되살림)',
  v.rows.map((r) => r.name).join() === 'admin@sistech.test,손두병,김철수' && v.rows[0].admin && v.rows[0].self && !v.rows[1].admin && !v.rows[1].self && !v.rows[2].admin, v.rows);
const expectWhen = await b.ev(`(() => {
  const d = (iso) => new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' });
  const t = (iso) => new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return { adminCreated: d('2026-10-01T00:00:00Z'), adminLast: t('2026-11-06T03:12:00Z'), sonCreated: d('2026-10-15T06:30:00Z') };
})()`);
check('날짜: 만든 날·마지막 로그인은 ko-KR 로컬 시간, 마지막 로그인 없으면 "-"',
  v.rows[0].cells.join('|') === `${expectWhen.adminCreated}|${expectWhen.adminLast}` && v.rows[1].cells.join('|') === `${expectWhen.sonCreated}|-` && /^\d{4}\. \d{1,2}\. \d{1,2}\.$/.test(expectWhen.adminCreated), { cells: v.rows.map((r) => r.cells), expectWhen });
check('각 행에 "비밀번호 재설정" 버튼, 새 계정 폼(아이디·비밀번호·만들기), 문구 없음', v.rows.every((r) => r.resetBtn === '비밀번호 재설정') && v.newId === '' && v.newPw === '' && v.createText === '만들기' && v.message === null, v);
check('열린 뒤 초점은 닫기 버튼', v.active === 'accounts-close', v.active);
await b.shot('accounts-list-390');
check('390px: 머리글·문서 가로 넘침 없음(scrollWidth <= clientWidth)', !v.headerOverflow, v.headerOverflow);
const panelScroll = await b.ev(`(() => { const p = document.querySelector('.panel'); const a = document.querySelector('#accounts-panel').getBoundingClientRect(); const pr = p.getBoundingClientRect(); return { scrollable: p.scrollHeight > p.clientHeight, overflowY: getComputedStyle(p).overflowY, inside: a.left >= pr.left - 0.5 && a.right <= pr.right + 0.5, panelW: Math.round(a.width), tableW: document.querySelector('.accounts-table').scrollWidth, tableClient: document.querySelector('.accounts-table').clientWidth }; })()`);
check('390px: 창이 패널 폭 안에 있고 패널은 세로 스크롤, 표 가로 넘침 없음', panelScroll.inside && panelScroll.overflowY === 'auto' && panelScroll.tableW <= panelScroll.tableClient, panelScroll);

// ── 새 계정: 규칙 위반 아이디 → 서버 호출 없음 ──
await clearCalls(b);
await type(b, '#accounts-new-id', '홍 길동');
await type(b, '#accounts-new-password', 'abcdef');
await click(b, '#accounts-create-button');
await sleep(150);
v = await b.ev(view);
check('규칙 위반 아이디 → LOGIN_ID_RULE 문구(빨강·alert), 아이디 칸 표시·초점, 호출 0회', v.message === LOGIN_ID_RULE && v.messageError && v.messageRole === 'alert' && v.invalid.join() === 'accounts-new-id' && v.active === 'accounts-new-id' && (await fnCalls(b)).length === 0, v);
await type(b, '#accounts-new-id', '홍길동');
check('아이디를 고치면 빨간 표시가 바로 사라짐', (await b.ev(view)).invalid.length === 0);

// 짧은 비밀번호
await type(b, '#accounts-new-password', '12345');
await click(b, '#accounts-create-button');
await sleep(150);
v = await b.ev(view);
check('5자 비밀번호 → 비밀번호 규칙 문구, 비밀번호 칸 표시·초점, 호출 0회', v.message === PASSWORD_RULE && v.invalid.join() === 'accounts-new-password' && v.active === 'accounts-new-password' && (await fnCalls(b)).length === 0, v);

// 중복(409) → 서버 문구 그대로
await type(b, '#accounts-new-id', ' 손두병 ');
await type(b, '#accounts-new-password', '123456');
await click(b, '#accounts-create-button');
await waitPanel(b, `message !== null`);
v = await b.ev(view);
let calls = await fnCalls(b);
check('중복 아이디(409) → 서버 문구 그대로, 입력은 남음, 로그아웃 없음', v.message === '이미 있는 아이디입니다: 손두병' && v.messageError && v.app && v.newId === ' 손두병 ' && v.newPw === '123456' && calls.length === 1 && calls[0].action === 'create' && calls[0].login_id === '손두병', { v, calls });

// 성공: 요청 중 버튼 잠금 → 목록에 추가 + 문구 + 폼 비움
await clearCalls(b);
await b.ev(`__fake.fnDelay = 700`);
await type(b, '#accounts-new-id', '김용문');
await type(b, '#accounts-new-password', 'pw123456');
await click(b, '#accounts-create-button');
await sleep(150);
const busy = await b.ev(view);
check('요청 중: 만들기 "만드는 중…"·닫기·새로 고침·재설정 버튼 모두 잠김, 문구 비움', busy.createDisabled && busy.createText === '만드는 중…' && busy.closeDisabled && busy.refreshDisabled && busy.rows.every((r) => r.resetDisabled) && busy.message === null, busy);
await waitPanel(b, `document.querySelectorAll('#accounts-panel .accounts-row').length === 4 && message !== null`, 4000);
await b.ev(`__fake.fnDelay = null`);
v = await b.ev(view);
calls = await fnCalls(b);
check('새 계정 성공 → "김용문 계정을 만들었습니다."(status), 목록 4행(김용문 추가), 폼 비움, 버튼 풀림, 초점 아이디 칸',
  v.message === '김용문 계정을 만들었습니다.' && !v.messageError && v.messageRole === 'status' && v.rows.map((r) => r.name).join() === 'admin@sistech.test,손두병,김철수,김용문' && v.newId === '' && v.newPw === '' && !v.createDisabled && v.createText === '만들기' && v.active === 'accounts-new-id', v);
check('호출 순서: create(login_id 김용문, password) → list', calls.map((c) => c.action).join() === 'create,list' && calls[0].login_id === '김용문' && calls[0].password === 'pw123456', calls);
const stored = await b.ev(`__fake.accounts().at(-1)`);
check('가짜 서버에 김용문 계정(xn-- 이메일) 저장', stored.login_id === '김용문' && stored.email === loginIdToEmail('김용문'), stored);
await b.shot('accounts-created-390');

// ── 비밀번호 재설정 ──
await clearCalls(b);
await click(b, '#accounts-panel button[data-reset="user-son"]');
await sleep(150);
v = await b.ev(view);
const sonRow = v.rows.find((r) => r.id === 'user-son');
check('손두병 행의 [비밀번호 재설정] → 그 행 안에 새 비밀번호 입력·확인·취소, 본인 안내 없음, 초점 입력 칸, 다른 행 그대로',
  sonRow.resetting && sonRow.selfNotice === null && v.active === 'accounts-reset-password' && v.rows.filter((r) => r.resetting).length === 1 && v.rows.length === 4 &&
    (await b.ev(`(() => { const tr = document.querySelector('#accounts-panel .accounts-row.resetting'); return tr.querySelector('.accounts-reset-title').textContent === '손두병 비밀번호 재설정' && [...tr.querySelectorAll('.button-row .btn')].map(x => x.textContent).join() === '확인,취소'; })()`)), { sonRow, active: v.active });
// 취소
await click(b, '#accounts-panel .accounts-row.resetting .button-row .btn:not(.primary)');
await sleep(100);
v = await b.ev(view);
check('[취소] → 행이 원래대로, 초점은 그 행의 재설정 버튼, 호출 0회', v.rows.every((r) => !r.resetting) && (await b.ev(`document.activeElement?.dataset?.reset`)) === 'user-son' && (await fnCalls(b)).length === 0, v.rows);
// 본인 행
await click(b, `#accounts-panel button[data-reset="user-${ADMIN}"]`);
await sleep(100);
v = await b.ev(view);
check('본인 행 → "본인 비밀번호를 바꾸면 모든 기기에서 로그아웃됩니다." 안내', v.rows[0].resetting && v.rows[0].selfNotice === '본인 비밀번호를 바꾸면 모든 기기에서 로그아웃됩니다.', v.rows[0]);
await b.shot('accounts-reset-self-390');
// Esc → 재설정 접기(창은 열린 채)
await b.ev(`document.querySelector('#accounts-reset-password').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(100);
v = await b.ev(view);
check('재설정 칸에서 Esc → 재설정만 접히고 창은 열린 채', v.panelOpen && v.rows.every((r) => !r.resetting), v);
// 짧은 비밀번호
await click(b, '#accounts-panel button[data-reset="user-son"]');
await sleep(100);
await type(b, '#accounts-reset-password', '12345');
await click(b, '#accounts-panel .accounts-row.resetting .btn.primary');
await sleep(150);
v = await b.ev(view);
check('재설정 5자 → 문구·빨간 표시·초점, 호출 0회', v.message === PASSWORD_RULE && v.invalid.join() === 'accounts-reset-password' && v.active === 'accounts-reset-password' && (await fnCalls(b)).length === 0, v);
// 성공
await type(b, '#accounts-reset-password', 'newpass1');
await b.ev(`document.querySelector('#accounts-reset-password').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); document.querySelector('#accounts-panel .accounts-row.resetting form').requestSubmit();`);
await waitPanel(b, `message !== null && !document.querySelector('#accounts-panel .accounts-row.resetting')`);
v = await b.ev(view);
calls = await fnCalls(b);
const resets = await b.ev(`__fake.resetPasswords`);
check('재설정 성공 → reset_password {user_id: user-son, password} 1회, "손두병 계정의 비밀번호를 바꿨습니다.", 행 원래대로, 로그아웃 없음',
  calls.length === 1 && calls[0].action === 'reset_password' && calls[0].user_id === 'user-son' && calls[0].password === 'newpass1' && resets.length === 1 && v.message === '손두병 계정의 비밀번호를 바꿨습니다.' && !v.messageError && v.rows.every((r) => !r.resetting) && v.app, { calls, v });
const accountsSource = await b.ev(`fetch('./app.js').then(r => r.text()).then(t => t.slice(t.indexOf('계정 관리(관리자만)'), t.indexOf('function render()')))`);
// 다른 사람 계정의 비밀번호 재설정만 한 번 확인한다(B-9). 그 밖에는 창 안에서 처리하고 브라우저 대화 상자를 쓰지 않는다.
check('계정 관리 코드에 prompt·alert 없음, confirm은 다른 계정 재설정 확인 한 곳뿐(앱 코드 정적 확인)',
  accountsSource.length > 1000 && !/\b(prompt|alert)\(/.test(accountsSource) && (accountsSource.match(/\bconfirm\(/g) ?? []).length === 1 && /!self && !confirm\(/.test(accountsSource), accountsSource.length);

// ── 403: 로그아웃 없이 문구만 ──
await clearCalls(b);
await b.ev(`__fake.fnFailNext({ status: 403, error: '관리자만 쓸 수 있는 기능입니다.' })`);
await click(b, '#accounts-refresh');
await waitPanel(b, `message !== null && message !== '손두병 계정의 비밀번호를 바꿨습니다.'`);
v = await b.ev(view);
check('403 응답 → 창 안에 서버 문구, 앱 화면 유지(로그아웃 없음), 목록 유지', v.message === '관리자만 쓸 수 있는 기능입니다.' && v.messageError && v.app && !v.login && v.rows.length === 4 && (await b.ev(`__fake.events.includes('signOut')`)) === false, v);

// 네트워크 실패(context가 Response가 아님)
await b.ev(`__fake.fnFailNext({ status: 0 })`);
await type(b, '#accounts-new-id', '박영희');
await type(b, '#accounts-new-password', 'abcdef');
await click(b, '#accounts-create-button');
await waitPanel(b, `message === '계정 서버에 연결할 수 없습니다.'`);
v = await b.ev(view);
check('네트워크 실패 → "계정 서버에 연결할 수 없습니다.", 입력 남음, 로그아웃 없음', v.message === '계정 서버에 연결할 수 없습니다.' && v.newId === '박영희' && v.app, v);

// 500 + 한국어 문구 → 그대로
await b.ev(`__fake.fnFailNext({ status: 500, error: '계정 서버 내부 오류입니다.' })`);
await click(b, '#accounts-create-button');
await waitPanel(b, `message === '계정 서버 내부 오류입니다.'`);
check('500 응답의 한국어 문구도 그대로', (await b.ev(view)).message === '계정 서버 내부 오류입니다.');

// ── 로그아웃 → 창 닫힘·상태 초기화 ──
await b.ev(`__fake.events.length = 0`);
await click(b, '#logout-button');
await b.waitFor(`!document.querySelector('#login').hidden`, 4000);
await sleep(200);
v = await b.ev(view);
check('로그아웃 → 로그인 화면, 창 닫힘(비움), 버튼 숨김', v.login && !v.panelOpen && v.panelChildren === 0 && !v.buttonShown, v);
await login(b, ADMIN);
await b.waitFor(`!document.querySelector('.app').hidden`, 3000);
await sleep(200);
v = await b.ev(view);
check('다시 로그인(관리자) → 창은 닫힌 채, 버튼 보임', v.app && !v.panelOpen && v.buttonShown, v);
await clearCalls(b);
await click(b, '#accounts-button');
await waitPanel(b, `document.querySelectorAll('#accounts-panel .accounts-row').length === 4`);
v = await b.ev(view);
check('다시 열면 새 계정 폼 비어 있음·앞 문구 없음·목록 새로 받음(list 1회)', v.newId === '' && v.newPw === '' && v.message === null && (await fnCalls(b)).length === 1, v);

// 처음 화면(제목)으로 → 창 닫힘
await click(b, '#home-link');
await sleep(150);
check('제목(처음 화면) → 계정 관리 창 닫힘', !(await b.ev(view)).panelOpen);

// 닫기 버튼 → 초점은 머리글 버튼
await click(b, '#accounts-button');
await waitPanel(b, `document.querySelectorAll('#accounts-panel .accounts-row').length === 4`);
await click(b, '#accounts-close');
await sleep(100);
v = await b.ev(view);
check('[닫기] → 창 닫힘, 초점은 #accounts-button', !v.panelOpen && v.active === 'accounts-button', v);

// ── 401 → 세션 만료로 로그아웃 ──
await click(b, '#accounts-button');
await waitPanel(b, `document.querySelectorAll('#accounts-panel .accounts-row').length === 4`);
await b.ev(`__fake.fnFailNext({ status: 401, error: '로그인이 필요합니다.' })`);
await click(b, '#accounts-refresh');
await b.waitFor(`!document.querySelector('#login').hidden`, 3000);
await sleep(200);
v = await b.ev(view);
check('401 응답 → 로그인 화면 + "로그인이 만료되었습니다. 다시 로그인해 주세요.", 창 닫힘', v.login && v.loginError === '로그인이 만료되었습니다. 다시 로그인해 주세요.' && !v.panelOpen, v);

// ── PC 폭 스크린샷 ──
await b.setViewport(1280, 820, false);
await prepare(b, { places, email: ADMIN, admins: [ADMIN], accounts: accountsSeed });
await click(b, '#accounts-button');
await waitPanel(b, `document.querySelectorAll('#accounts-panel .accounts-row').length === 3`);
await click(b, `#accounts-panel button[data-reset="user-${ADMIN}"]`);
await sleep(150);
await b.shot('accounts-1280');
const pc = await b.ev(`(() => {
  const t = document.querySelector('.accounts-table'); const card = document.querySelector('#accounts-panel').getBoundingClientRect(); const tr = t.getBoundingClientRect();
  const inside = (el) => { const r = el.getBoundingClientRect(); return r.right <= card.right + 0.5 && r.left >= card.left - 0.5; };
  return { cols: t.querySelectorAll('thead th').length, headHidden: t.querySelector('thead').getBoundingClientRect().width <= 1,
    tableFits: tr.right <= card.right + 0.5 && t.scrollWidth <= t.clientWidth, buttonsInside: [...t.querySelectorAll('button, input')].every(inside),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
})()`);
check('1280px: 표(머리 줄 4칸은 화면 읽기용)가 카드 안에 들어가고(버튼·입력 칸 포함), 가로 넘침 없음', pc.cols === 4 && pc.headHidden && pc.tableFits && pc.buttonsInside && !pc.overflow, pc);

check('콘솔 오류·예외 0건', b.errors.length === 0, b.errors);
await finish(b);
