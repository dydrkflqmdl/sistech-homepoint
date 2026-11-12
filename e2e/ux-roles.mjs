// 계정 권한 3단계(관리자·직원·외주) 화면 확인. 서버는 가짜 supabase(fake-supabase.js: my_role·외주 거절·admin-users set_role).
// 1) 외주: 가져오기·내보내기·계정 관리·장소 삭제가 없고(390·1280), 끌어다 놓기·숨은 입력·강제 클릭도 아무 일 없음, 메모는 직원처럼 쓰고 저장됨(지도 말풍선에도 보임), 미션 기록은 저장됨, 머리글 "· 외주"
// 2) 직원: 계정 관리만 없고 나머지는 예전 그대로  3) 관리자: 권한 열·외주로 만들기·직원↔외주 바꾸기(요청 중 잠금)·관리자 행은 못 바꿈·서버 오류 문구
// 4) 낡은 화면(토큰은 직원, DB는 외주): 메모는 저장되고, 삭제·가져오기는 서버가 거절하면 한국어 문구를 알리고 화면이 외주로 바뀜(예전 서버 문구도 알아봄)
//    5) 외주 → 직원으로 같은 탭에서 바꿔 로그인하면 단추가 돌아옴
// 6) 처음 열 때 my_role이 실패하면 토큰의 역할로 연 화면을 그대로 둠
// 7) 다시 받을 때(refreshRole) my_role이 실패하거나 null이면 지금 역할을 그대로 둠(토큰이 외주여도 직원 화면·고치던 메모 유지)
//    지운 계정(my_role null)의 메모 저장은 서버 문구(계정을 찾을 수 없음)를 그대로 보이고 역할은 바꾸지 않음. 외주로 바뀌어도 고치던 메모는 남음
import path from 'node:path';
import { FIXTURES, launch, prepare, PROJECT, Q1_CSV, reporter, sleep, URL_BASE } from './lib.mjs';

// 확인 화면(미션명 변경 등) 없이 바로 보내지는 작은 CSV
const SMALL_CSV = path.join(FIXTURES, 'roles-import.csv');

const { loginIdToEmail } = await import(PROJECT + '/public/login-id.js');
const { check, finish } = reporter('ux-roles');

const REJECT = '외주 계정은 미션 기록과 메모만 할 수 있습니다.';
// 예전 서버의 외주 거절 문구. 배포하는 사이 화면만 새것이어도 외주 거절로 알아봐야 한다.
const OLD_REJECT = '외주 계정은 미션 기록만 할 수 있습니다.';
const GONE = '로그인한 계정을 찾을 수 없습니다. 다시 로그인해 주세요.';
const ADMIN = 'admin@sistech.test';
const CON = loginIdToEmail('홍외주');
const STAFF = loginIdToEmail('김직원');
const places = [
  { name: 'SW_01', district: '태안', address: '가람면 하늘리', phone: '010-1234-5678', memo: '현장 메모: 정문 열쇠는 관리실', lat: 37.277767, lng: 126.717126, mission: 'M_01 ~ _03' },
  { name: 'SW_02', district: '태안', address: '바람리', lat: 37.167923, lng: 126.815733, mission: '', memo: '' },
  { name: 'BE_01', district: '보은', address: '보은읍 1리', lat: 36.49, lng: 127.73, mission: '', memo: '' },
];
const accountsSeed = [
  { id: 'user-' + ADMIN, login_id: null, email: ADMIN, created_at: '2026-10-01T00:00:00Z', last_sign_in_at: '2026-11-06T03:12:00Z', is_admin: true },
  { id: 'user-son', login_id: '손두병', email: loginIdToEmail('손두병'), created_at: '2026-10-15T06:30:00Z', last_sign_in_at: null, is_admin: false },
  { id: 'user-con', login_id: '홍외주', email: CON, created_at: '2026-10-20T01:00:00Z', last_sign_in_at: null, is_admin: false, role: 'contractor' },
];

const b = await launch('ux-roles', { viewport: [390, 844, true] });
const ev = b.ev;
const calls = (name) => ev(`__fake.calls.filter((c) => c.name === ${JSON.stringify(name)}).length`);
const toastText = () => ev(`document.querySelector('#toast').textContent`);
const login = (id) => ev(`(() => {
  const f = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  f('#login-id', ${JSON.stringify(id)}); f('#login-password', 'test1234');
  document.querySelector('#login-submit').click();
})()`);
const waitApp = () => b.waitFor(`!document.querySelector('.app').hidden && document.querySelectorAll('#place-list .group').length > 0`, 5000);
const openPlace = async (name) => { await ev(`__e2e.row(${JSON.stringify(name)}).click()`); await sleep(400); };

// 머리글 단추·머리글 글자·상세 정보를 한꺼번에 본다. 휴대폰이면 ☰를 펼쳐서 본다(접힌 칸 안은 어차피 안 보이므로).
const view = `(() => {
  const q = (s) => document.querySelector(s);
  const menu = q('#menu-button');
  const narrow = menu.offsetParent !== null;
  const wasOpen = q('.topbar').classList.contains('menu-open');
  if (narrow && !wasOpen) menu.click();
  const vis = (s) => { const el = q(s); return !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0; };
  const out = {
    narrow, body: document.body.className, dataRole: document.body.dataset.role ?? null,
    import: vis('#import-button'), csv: vis('#csv-input'), export: vis('#export-button'), accounts: vis('#accounts-button'), logout: vis('#logout-button'),
    header: narrow ? q('#topbar-user-name').textContent : q('#user-name').textContent,
    headerLabel: narrow ? q('#topbar-user').getAttribute('aria-label') : null,
    headerTitle: narrow ? q('#topbar-user').title : q('#user-name').title,
    tagRight: (() => { const t = q(narrow ? '#topbar-user .role-tag' : '#user-name .role-tag'); return t ? Math.round(t.getBoundingClientRect().right) : null; })(),
    menuLeft: Math.round(menu.getBoundingClientRect().left),
    detail: !q('#detail').hidden,
    memoInput: !!q('#memo-input'), memoValue: q('#memo-input')?.value ?? null, memoReadonly: !!q('#detail .memo-readonly, #memo-text'),
    deleteBtn: !!q('#detail .delete-place') || [...document.querySelectorAll('#detail button')].some((x) => /삭제/.test(x.textContent)),
    route: [...document.querySelectorAll('#detail .route-actions .btn')].map((x) => x.textContent),
    missions: document.querySelectorAll('#detail .mission-item').length,
    panels: { import: !q('#import-panel').hidden, accounts: !q('#accounts-panel').hidden, exportMenu: !q('#export-menu').hidden },
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
  if (narrow && !wasOpen) menu.click();
  return out;
})()`;

// 숨겨진 길을 강제로 두드려 본다: 숨은 단추 클릭, 숨은 파일 입력에 파일 넣기, 끌어다 놓기. 내려받기는 URL.createObjectURL 횟수로 센다.
const hostile = async (label) => {
  await ev(`(() => { window.__downloads = 0; if (!window.__origCOU) { window.__origCOU = URL.createObjectURL.bind(URL); URL.createObjectURL = (x) => { window.__downloads++; return window.__origCOU(x); }; } })()`);
  const before = { rpc: await calls('import_places'), fn: await ev(`__fake.fnCalls.length`) };
  await ev(`document.querySelector('#import-button').click(); document.querySelector('#export-button').click(); document.querySelector('#accounts-button').click();`);
  await sleep(250);
  await b.setFiles('#csv-input', [Q1_CSV]);
  await sleep(500);
  await ev(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['이름,위도,경도\\nDROP_01,36.1,127.1\\n'], 'drop.csv', { type: 'text/csv' }));
    for (const type of ['dragenter', 'dragover', 'drop']) {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'dataTransfer', { value: dt });
      window.dispatchEvent(e);
    }
  })()`);
  await sleep(500);
  const v = await ev(`({ importPanel: !document.querySelector('#import-panel').hidden, files: document.querySelector('#import-panel').children.length, accountsPanel: !document.querySelector('#accounts-panel').hidden,
    exportMenu: !document.querySelector('#export-menu').hidden, dragging: document.body.classList.contains('dragging'), downloads: window.__downloads, toast: document.querySelector('#toast').textContent,
    names: __fake.store().map((p) => p.name) })`);
  const after = { rpc: await calls('import_places'), fn: await ev(`__fake.fnCalls.length`) };
  check(`${label}: 숨은 가져오기·내보내기·계정 관리 단추를 눌러도, 숨은 파일 입력·끌어다 놓기로도 창·메뉴·내려받기·서버 호출 없음`,
    !v.importPanel && v.files === 0 && !v.accountsPanel && !v.exportMenu && !v.dragging && v.downloads === 0 && after.rpc === before.rpc && after.fn === before.fn && !v.names.includes('DROP_01') && v.names.length === places.length, { v, before, after });
  check(`${label}: 파일을 놓으면 한국어 안내`, v.toast === REJECT, v.toast);
};

// ── 1) 외주 ──
await prepare(b, { places, email: CON, roles: { [CON]: 'contractor' } });
const jwtRole = await ev(`__fake.session().user.app_metadata.role ?? null`);
check('외주 세션: 토큰의 app_metadata.role = contractor, 로그인 직후 my_role 호출', jwtRole === 'contractor' && (await calls('my_role')) >= 1, { jwtRole, myRole: await calls('my_role') });
let v = await ev(view);
check('390 외주: body.role-contractor·data-role, 머리글 "홍외주 · 외주"(☰ 왼쪽·aria-label·title)',
  v.body.includes('role-contractor') && v.dataRole === 'contractor' && v.header === '홍외주 · 외주' && v.headerLabel === '로그인: 홍외주 · 외주' && v.headerTitle === '홍외주 · 외주' && v.tagRight <= v.menuLeft, v);
check('390 외주: ☰ 안에 가져오기·내보내기·계정 관리 없음(로그아웃만), 가로 넘침 없음', !v.import && !v.csv && !v.export && !v.accounts && v.logout && !v.overflowX, v);
await hostile('390 외주');
await openPlace('SW_01');
v = await ev(view);
check('390 외주 상세: 메모 입력 칸(지금 메모가 들어 있음, 읽기 전용 글 없음), 삭제 없음, 길찾기·카카오맵 보기·미션 목록은 있음',
  v.detail && v.memoInput && !v.memoReadonly && v.memoValue === places[0].memo && !v.deleteBtn && v.route.join() === '카카오맵 길찾기,카카오맵에서 보기' && v.missions === 3, v);
const focusable = await ev(`[...document.querySelectorAll('#detail textarea, #detail input:not([type=hidden]), #detail button, #detail a')].map((e) => e.id || e.textContent.trim() || e.className).filter((t) => /삭제|memo-input/.test(t))`);
check('390 외주 상세: 초점 갈 수 있는 곳에 메모 입력은 있고 삭제는 없음', focusable.join() === 'memo-input', focusable);
await ev(`document.querySelector('#toast').textContent = ''`);
await b.shot('roles-contractor-390');

// 외주도 메모를 쓴다: 메모 없는 장소에 적으면 1초 뒤 저장되고(서버 반영), 지도 말풍선에도 보인다.
await openPlace('SW_02');
v = await ev(view);
check('390 외주: 메모가 빈 장소도 빈 메모 입력 칸이 있음', v.detail && v.memoInput && !v.memoReadonly && v.memoValue === '', v);
const memoBefore = await calls('update_memo');
const typeMemo = (text) => ev(`(() => { const t = document.querySelector('#memo-input'); t.focus(); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await typeMemo('외주가 남긴 메모');
await b.waitFor(`document.querySelector('#memo-status')?.textContent.trim() === '저장됨'`, 4000);
const conMemo = await ev(`({ memo: __fake.store().find((p) => p.name === 'SW_02').memo, toast: document.querySelector('#toast').textContent,
  last: __fake.calls.filter((c) => c.name === 'update_memo').at(-1)?.params ?? null })`);
check('390 외주: 메모를 적으면 저절로 저장됨(update_memo 1번, 서버 메모 반영, "저장됨", 거절 알림 없음)',
  conMemo.memo === '외주가 남긴 메모' && (await calls('update_memo')) - memoBefore === 1 && conMemo.last?.p_memo === '외주가 남긴 메모' && conMemo.last?.p_base_memo === '' && conMemo.toast !== REJECT,
  { conMemo, n: (await calls('update_memo')) - memoBefore });
const label = await ev(`[...document.querySelectorAll('.pin .memo-text')].map((e) => e.textContent)`);
check('390 외주: 저장한 메모가 지도 핀 말풍선에 보임', label.includes('외주가 남긴 메모'), label);
// 화면을 떠날 때(pagehide) 기다리던 메모를 바로 저장하는 것도 직원과 같다.
await typeMemo('외주가 남긴 메모 2');
await ev(`window.dispatchEvent(new Event('pagehide'))`);
await b.waitFor(`document.querySelector('#memo-status')?.textContent.trim() === '저장됨'`, 4000);
check('390 외주: pagehide에서 기다리던 메모를 1초 기다리지 않고 바로 저장',
  (await ev(`__fake.store().find((p) => p.name === 'SW_02').memo`)) === '외주가 남긴 메모 2' && (await calls('update_memo')) - memoBefore === 2);
// 다른 기기가 그 사이 메모를 바꿨으면 직원처럼 충돌 안내가 나오고, [내 메모로 저장]으로 덮어쓸 수 있다(C1).
await typeMemo('외주 충돌 메모');
await ev(`__fake.remoteChange((db) => { db.places.find((p) => p.name === 'SW_02').memo = '다른 기기 메모'; }, { notify: false })`);
await b.waitFor(`!!document.querySelector('#memo-status .memo-conflict')`, 4000);
const conflict = await ev(`({ latest: document.querySelector('#memo-status .memo-latest')?.textContent, value: document.querySelector('#memo-input').value,
  db: __fake.store().find((p) => p.name === 'SW_02').memo, base: __fake.calls.filter((c) => c.name === 'update_memo').at(-1)?.params?.p_base_memo })`);
check('390 외주: 다른 기기가 바꾼 메모와 충돌하면 안내가 나오고 내 글은 칸에 그대로, 서버 메모는 그대로',
  conflict.latest === '최신 메모: 다른 기기 메모' && conflict.value === '외주 충돌 메모' && conflict.db === '다른 기기 메모' && conflict.base === '외주가 남긴 메모 2', conflict);
await ev(`document.querySelector('#memo-status .memo-keep-mine').click()`);
await b.waitFor(`document.querySelector('#memo-status')?.textContent.trim() === '저장됨'`, 4000);
check('390 외주: [내 메모로 저장] → 서버 메모가 내 글로 바뀜', (await ev(`__fake.store().find((p) => p.name === 'SW_02').memo`)) === '외주 충돌 메모');

// 미션 기록은 된다
await openPlace('SW_01');
await ev(`document.querySelector('#detail .mission-item[data-mission="M_02"]').click()`); await sleep(300);
const typeIn = (n, val) => ev(`(() => { const i = document.querySelector('dialog.mission-dialog input[name=${n}]'); i.value = ${JSON.stringify(val)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await ev(`document.querySelector('dialog.mission-dialog input[name=done]').click()`);
await typeIn('flightMin', '5'); await typeIn('flightSec', '10'); await typeIn('batteryNo', '2'); await typeIn('batteryLeft', '40');
await ev(`document.querySelector('dialog.mission-dialog button[type=submit]').click()`); await sleep(600);
let rec = await ev(`__fake.store().find((p) => p.name === 'SW_01').missions.find((m) => m.mission === 'M_02') ?? null`);
const dlg = await ev(`({ open: !!document.querySelector('dialog.mission-dialog')?.open, toast: document.querySelector('#toast').textContent })`);
check('390 외주: 미션 기록 저장됨(완료·5분 10초·배터리 2번 40%·작업자 = 로그인 아이디), 창 닫힘',
  rec?.done === true && rec.flightTime === '5분 10초' && rec.batteryNo === '2' && rec.batteryLeft === '40' && rec.worker === '홍외주' && !dlg.open && /저장했습니다/.test(dlg.toast), { rec, dlg });
check('390 외주: 장소 목록 검색은 메모까지 찾음', await (async () => {
  await ev(`document.querySelector('#detail .icon-btn').click()`);
  await sleep(300);
  await ev(`(() => { const s = document.querySelector('#search'); s.value = '정문 열쇠'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(500);
  const rows = await ev(`__e2e.rows()`);
  await ev(`(() => { const s = document.querySelector('#search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300);
  return rows.join() === 'SW_01';
})());

// 1280
await b.setViewport(1280, 800, false);
await sleep(400);
v = await ev(view);
check('1280 외주: 머리글 #user-name "홍외주 · 외주", 가져오기·내보내기·계정 관리 없음, 로그아웃은 보임',
  !v.narrow && v.header === '홍외주 · 외주' && v.headerTitle === '홍외주 · 외주' && !v.import && !v.csv && !v.export && !v.accounts && v.logout && !v.overflowX, v);
await hostile('1280 외주');
await openPlace('SW_01');
v = await ev(view);
check('1280 외주 상세: 메모 입력 칸 있음, 삭제 없음, 미션 목록 있음', v.detail && v.memoInput && !v.memoReadonly && v.memoValue === places[0].memo && !v.deleteBtn && v.missions === 3, v);
await ev(`document.querySelector('#toast').textContent = ''`);
await b.shot('roles-contractor-1280');
const tab = await ev(`(() => { document.activeElement?.blur(); const out = []; return [...document.querySelectorAll('.topbar button, .topbar input, .topbar a')].filter((e) => e.offsetParent !== null).map((e) => e.id || e.textContent.trim()); })()`);
check('1280 외주: 머리글에서 초점 갈 수 있는 것은 제목 링크·로그아웃뿐', tab.join() === 'home-link,logout-button', tab);

// 빈 화면 안내
await ev(`__fake.remoteChange((db) => { db.places = []; db.missions = []; })`);
await b.waitFor(`!document.querySelector('#empty').hidden`, 4000);
const empty = await ev(`(() => { const e = document.querySelector('#empty'); const shown = (el) => getComputedStyle(el).display !== 'none'; return { title: shown(e.querySelector('h2')), hint: shown(e.querySelector('.contractor-only')), pre: shown(e.querySelector('pre')), list: shown(e.querySelector('ul')) }; })()`);
check('외주: 장소가 없을 때 가져오기 안내(CSV 열 설명)는 숨고 "관리자나 직원이 가져오면" 한 줄만', empty.title && empty.hint && !empty.pre && !empty.list, empty);

// ── 5) 외주 → 직원 같은 탭 전환(+ 2) 직원) ──
await b.ev(`__fake.seed(${JSON.stringify(places)})`);
await ev(`document.querySelector('#logout-button').click()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 4000);
v = await ev(`({ body: document.body.className, dataRole: document.body.dataset.role ?? null, imp: document.querySelector('#import-button').hidden, exp: document.querySelector('#export-button').hidden, topUser: document.querySelector('#topbar-user').hidden })`);
check('외주 로그아웃 → 로그인 화면: body 역할 클래스·data-role 없음, 가져오기·내보내기 단추 hidden 해제, 머리글 아이디 숨김', !v.body.includes('role-') && v.dataRole === null && !v.imp && !v.exp && v.topUser, v);
await login('김직원');
await waitApp();
await sleep(300);
v = await ev(view);
check('같은 탭에서 직원으로 로그인: 가져오기·내보내기가 돌아오고 계정 관리는 없음, 머리글은 아이디만(역할 글자 없음)',
  !v.body.includes('role-contractor') && v.import && v.export && !v.accounts && v.header === '김직원' && v.headerTitle === '김직원' && (await calls('my_role')) >= 2, v);
await openPlace('SW_01');
v = await ev(view);
check('직원 상세: 메모 입력 칸(편집 가능)과 "이 장소 삭제"가 돌아옴', v.memoInput && !v.memoReadonly && v.deleteBtn, v);
const staffMemoBefore = await calls('update_memo');
await b.shot('roles-staff-1280');
// 직원은 예전처럼 쓴다: 메모 저장, 내보내기 메뉴, 가져오기 창, 미션 저장
await ev(`(() => { const t = document.querySelector('#memo-input'); t.focus(); t.value = '직원이 고친 메모'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await b.waitFor(`document.querySelector('#memo-status')?.textContent.trim() === '저장됨'`, 3000);
check('직원: 메모 저장됨(update_memo, DB 반영)', (await ev(`__fake.store().find((p) => p.name === 'SW_01').memo`)) === '직원이 고친 메모' && (await calls('update_memo')) - staffMemoBefore === 1);
await ev(`document.querySelector('#export-button').click()`); await sleep(200);
check('직원: [내보내기] 메뉴가 열림(장소 / 미션 기록)', (await ev(`[...document.querySelectorAll('#export-menu .menu-item')].map((e) => e.textContent).join()`)) === '장소 내보내기,미션 기록 내보내기');
await ev(`document.querySelector('#export-menu .menu-item').click()`); await sleep(150);
await b.setFiles('#csv-input', [Q1_CSV]); await sleep(500);
check('직원: CSV 파일을 고르면 가져오기 창이 열림', await ev(`!document.querySelector('#import-panel').hidden && /CSV 가져오기/.test(document.querySelector('#import-panel').textContent)`));
await ev(`document.querySelector('#import-panel .icon-btn').click()`);
await ev(`document.querySelector('#accounts-button').click()`); await sleep(200);
check('직원: 숨은 계정 관리 단추를 눌러도 창이 안 열리고 admin-users 호출 0회', (await ev(`document.querySelector('#accounts-panel').hidden && __fake.fnCalls.length === 0`)));

// ── 6) 처음 열 때 my_role 실패 → 토큰의 역할로 연 화면을 그대로 둠 ──
await ev(`document.querySelector('#logout-button').click()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 4000);
await ev(`__fake.setRoles({ ${JSON.stringify(CON)}: 'contractor' }); __fake.failNext({ name: 'my_role', status: 500, code: 'XX000', message: 'boom' })`);
const myRoleBefore = await calls('my_role');
await login('홍외주');
await waitApp();
await sleep(400);
v = await ev(view);
check('my_role가 500으로 실패해도 로그아웃되지 않고 처음 연 토큰의 역할(외주) 그대로: 단추 숨김·머리글 "· 외주"', v.body.includes('role-contractor') && !v.import && !v.export && v.header === '홍외주 · 외주', v);
check('실패한 my_role는 한 번만 부르고 다시 부르지 않음', (await calls('my_role')) - myRoleBefore === 1, (await calls('my_role')) - myRoleBefore);

// ── 4) 낡은 화면: 토큰은 직원, DB는 외주 ──
const staleSetup = async () => {
  await prepare(b, { places, email: STAFF });
  await b.setViewport(1280, 800, false);
  await ev(`__fake.setRoles({ ${JSON.stringify(STAFF)}: 'contractor' })`);
  await openPlace('SW_01');
};
await staleSetup();
v = await ev(view);
check('낡은 화면 준비: 토큰은 직원이라 메모 입력·삭제 단추가 보임(DB는 외주)', v.memoInput && v.deleteBtn && v.import && !v.body.includes('role-contractor'), v);
let roleCallsStale = await calls('my_role');
await ev(`(() => { const t = document.querySelector('#memo-input'); t.focus(); t.value = '낡은 화면에서 고친 메모'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await b.waitFor(`document.querySelector('#memo-status')?.textContent.trim() === '저장됨'`, 4000);
await sleep(300);
check('낡은 화면에서도 메모는 저장됨(외주도 메모를 쓸 수 있음): DB 반영, 거절 알림 없음, 역할을 다시 받지 않음',
  (await ev(`__fake.store().find((p) => p.name === 'SW_01').memo`)) === '낡은 화면에서 고친 메모' && (await toastText()) !== REJECT
  && !(await ev(`document.body.classList.contains('role-contractor')`)) && (await calls('my_role')) === roleCallsStale, await toastText());
await ev(`window.confirm = () => true; document.querySelector('#detail .delete-place button').click()`);
await b.waitFor(`document.querySelector('#toast').textContent === ${JSON.stringify(REJECT)}`, 4000);
check('낡은 화면에서 장소를 삭제하면 거절 문구가 알림으로 보이고 장소는 그대로', (await toastText()) === REJECT && (await ev(`__fake.store().some((p) => p.name === 'SW_01')`)));
await b.waitFor(`document.body.classList.contains('role-contractor')`, 4000);
v = await ev(view);
check('거절을 받으면 my_role로 역할을 다시 받아 화면이 외주로 바뀜(가져오기·내보내기 숨김, 삭제 없음, 메모 입력은 그대로, 머리글 "· 외주")',
  v.body.includes('role-contractor') && !v.import && !v.export && v.memoInput && !v.memoReadonly && v.memoValue === '낡은 화면에서 고친 메모' && !v.deleteBtn && v.header === '김직원 · 외주', v);

// 예전 서버 문구('미션 기록만')로 거절해도(배포하는 사이 화면만 새것) 외주 거절로 알아보고 역할을 다시 받는다.
await staleSetup();
await ev(`__fake.contractorMessage = ${JSON.stringify(OLD_REJECT)}`);
roleCallsStale = await calls('my_role');
await ev(`window.confirm = () => true; document.querySelector('#detail .delete-place button').click()`);
await b.waitFor(`document.body.classList.contains('role-contractor')`, 4000);
const oldToast = await toastText();
check('예전 서버 문구로 거절해도 역할을 다시 받아 외주 화면으로 바뀜(my_role 다시 부름, 장소 그대로, 거절 문구 알림)',
  (await calls('my_role')) > roleCallsStale && (await ev(`__fake.store().some((p) => p.name === 'SW_01')`)) && [REJECT, OLD_REJECT].includes(oldToast), { oldToast });
await ev(`__fake.contractorMessage = undefined`);

await staleSetup();
await b.setFiles('#csv-input', [SMALL_CSV]); await sleep(500);
await ev(`document.querySelector('#import-panel .btn.primary').click()`);
await b.waitFor(`document.querySelector('#toast').textContent === ${JSON.stringify(REJECT)}`, 6000);
check('낡은 화면에서 CSV를 가져오면 거절 문구가 알림으로 보이고 장소는 그대로', (await toastText()) === REJECT && (await ev(`__fake.store().length`)) === places.length, await toastText());

// ── 7) 다시 받기에서 my_role 실패·null → 지금 역할 그대로 ──
// 토큰은 외주, DB는 직원(관리자가 외주 → 직원으로 바꾼 직후, 토큰은 아직 묵음). 처음엔 토큰 값(외주)으로 열고 my_role로 직원이 된다.
// 그 뒤 다시 받기(화면을 1분 넘게 벗어났다 돌아옴)에서 my_role이 실패하거나 null이면 토큰의 외주로 바꾸지 않는다.
const refreshSetup = async () => {
  await prepare(b, { places, email: STAFF, roles: { [STAFF]: 'contractor' } });
  await b.setViewport(1280, 800, false);
  await ev(`__fake.setRoles({ ${JSON.stringify(STAFF)}: 'staff' })`);
  await b.navigate(URL_BASE, 300);
  await waitApp();
  await b.waitFor(`!document.body.classList.contains('role-contractor') && !!document.querySelector('#import-button') && !document.querySelector('#import-button').hidden`, 4000);
  await openPlace('SW_01');
  // 저장에 실패한 메모(저장 안 됨) 하나를 남겨 둔다. 역할이 바뀌어도(외주도 메모를 쓴다) 남아야 하는 글이다.
  await ev(`__fake.failNext({ status: 500, code: 'XX000', message: 'boom', name: 'update_memo' })`);
  await ev(`(() => { const t = document.querySelector('#memo-input'); t.focus(); t.value = '고치던 메모'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await b.waitFor(`/저장 안 됨/.test(document.querySelector('#memo-status')?.textContent ?? '')`, 4000);
};
// 화면을 벗어났다가 1분 넘게 지나 돌아온 것처럼 한다(visibilitychange → refreshRole).
const comeBackLater = () => ev(`(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  delete document.visibilityState;
  const realNow = Date.now;
  Date.now = () => realNow.call(Date) + 61000;
  try { document.dispatchEvent(new Event('visibilitychange')); } finally { Date.now = realNow; }
})()`);
const memoState = `({ value: document.querySelector('#memo-input')?.value ?? null, status: document.querySelector('#memo-status')?.textContent ?? '' })`;

await refreshSetup();
const jwtOfStaff = await ev(`__fake.session().user.app_metadata.role ?? null`);
v = await ev(view);
check('다시 받기 준비: 토큰은 외주인데 my_role(직원)로 직원 화면(가져오기·메모 입력·삭제 보임), 고치던 메모는 "저장 안 됨"',
  jwtOfStaff === 'contractor' && v.import && v.memoInput && v.deleteBtn && !v.body.includes('role-contractor') && v.header === '김직원', { jwtOfStaff, v });
await ev(`__fake.failNext({ name: 'my_role', status: 500, code: 'XX000', message: 'boom' })`);
let roleCalls = await calls('my_role');
await comeBackLater();
await b.waitFor(`__fake.calls.filter((c) => c.name === 'my_role').length > ${roleCalls}`, 4000);
await sleep(400);
v = await ev(view);
let memo = await ev(memoState);
check('다시 받기에서 my_role가 실패하면 토큰의 외주로 바꾸지 않고 직원 그대로(가져오기·내보내기·메모 입력·삭제 보임)',
  !v.body.includes('role-contractor') && v.import && v.export && v.memoInput && v.deleteBtn && v.header === '김직원', v);
check('my_role 실패 뒤에도 고치던 메모가 남음(입력 칸 글·"저장 안 됨" 그대로)', memo.value === '고치던 메모' && /저장 안 됨/.test(memo.status), memo);
check('실패한 my_role는 한 번만 부름', (await calls('my_role')) - roleCalls === 1, (await calls('my_role')) - roleCalls);

await refreshSetup();
await ev(`__fake.myRoleValue = null`);
roleCalls = await calls('my_role');
await comeBackLater();
await b.waitFor(`__fake.calls.filter((c) => c.name === 'my_role').length > ${roleCalls}`, 4000);
await sleep(400);
v = await ev(view);
memo = await ev(memoState);
check('다시 받기에서 my_role이 null(지운 계정)이면 역할을 바꾸지 않음: 직원 그대로', !v.body.includes('role-contractor') && v.import && v.memoInput && v.deleteBtn && v.header === '김직원', v);
check('my_role null 뒤에도 고치던 메모가 남음', memo.value === '고치던 메모' && /저장 안 됨/.test(memo.status), memo);
// 지운 계정(my_role null)에서 [다시 저장]: 서버가 "계정을 찾을 수 없음"으로 거절하고, 그 문구를 그대로 보인다. 외주 거절이 아니므로 역할은 다시 받지 않는다.
roleCalls = await calls('my_role');
const memoCallsBefore = await calls('update_memo');
await ev(`document.querySelector('#memo-status .memo-retry').click()`);
await b.waitFor(`__fake.calls.filter((c) => c.name === 'update_memo').length > ${memoCallsBefore} && /저장 안 됨/.test(document.querySelector('#memo-status')?.textContent ?? '')`, 4000);
await sleep(400);
const gone = await ev(`({ reason: document.querySelector('#memo-status .memo-reason')?.textContent ?? null, value: document.querySelector('#memo-input')?.value ?? null,
  db: __fake.store().find((p) => p.name === 'SW_01').memo, toast: document.querySelector('#toast').textContent })`);
v = await ev(view);
check('지운 계정의 메모 저장: 서버 문구를 그대로 보임("저장 안 됨" 옆), DB 메모 그대로, 글은 칸에 남음',
  gone.reason === GONE && gone.value === '고치던 메모' && gone.db === places[0].memo, gone);
check('지운 계정의 메모 거절은 외주 흐름이 아님: 외주 알림 없음, my_role 다시 안 부름, 직원 화면 그대로',
  gone.toast !== REJECT && (await calls('my_role')) === roleCalls && !v.body.includes('role-contractor') && v.import && v.deleteBtn, { gone, v });
await ev(`__fake.myRoleValue = 'contractor'`);
roleCalls = await calls('my_role');
await comeBackLater();
await b.waitFor(`document.body.classList.contains('role-contractor')`, 4000);
v = await ev(view);
memo = await ev(memoState);
check('my_role이 다시 값(외주)을 주면 그때 외주로 바뀜(다시 받기는 계속 동작), 삭제는 사라지고 메모 입력은 남음',
  v.body.includes('role-contractor') && !v.import && !v.deleteBtn && v.memoInput && (await calls('my_role')) - roleCalls === 1, v);
check('외주로 바뀌어도 고치던 메모(저장 안 됨)를 버리지 않음', memo.value === '고치던 메모' && /저장 안 됨/.test(memo.status), memo);
await ev(`__fake.myRoleValue = null`);
roleCalls = await calls('my_role');
await comeBackLater();
await b.waitFor(`__fake.calls.filter((c) => c.name === 'my_role').length > ${roleCalls}`, 4000);
await sleep(400);
v = await ev(view);
check('외주 화면에서 my_role이 null이면 직원으로 풀리지 않고 외주 그대로(가져오기·삭제 없음)', v.body.includes('role-contractor') && !v.import && !v.deleteBtn && v.header === '김직원 · 외주', v);

// ── 3) 관리자: 계정 관리 ──
await prepare(b, { places, email: ADMIN, admins: [ADMIN], accounts: accountsSeed });
await b.setViewport(1280, 800, false);
await sleep(300);
v = await ev(view);
check('관리자: 가져오기·내보내기·계정 관리 보임, 머리글 "· 관리자", 메모·삭제는 그대로(직원과 같음)', v.import && v.export && v.accounts && v.header === `${ADMIN} · 관리자` && v.dataRole === 'admin', v);
await ev(`document.querySelector('#accounts-button').click()`);
await b.waitFor(`document.querySelectorAll('#accounts-panel .accounts-row').length === 3`, 4000);
const acct = `(() => {
  const q = (s) => document.querySelector(s);
  const msg = q('#accounts-message');
  return {
    heads: [...document.querySelectorAll('#accounts-panel thead th')].map((t) => t.textContent.trim()),
    tableRole: q('.accounts-table').getAttribute('role'), cellRoles: [...new Set([...document.querySelectorAll('#accounts-panel td')].map((t) => t.getAttribute('role')))].join(),
    rows: [...document.querySelectorAll('#accounts-panel .accounts-row')].map((tr) => ({
      id: tr.dataset.userId, label: tr.querySelector('.accounts-role')?.dataset.label ?? null,
      text: tr.querySelector('.accounts-role')?.textContent.trim(), select: tr.querySelector('select') ? tr.querySelector('select').value : null,
      options: tr.querySelector('select') ? [...tr.querySelectorAll('option')].map((o) => o.textContent).join() : null,
      selectH: tr.querySelector('select') ? Math.round(tr.querySelector('select').getBoundingClientRect().height) : null,
      selectLabel: tr.querySelector('select')?.getAttribute('aria-label') ?? null, disabled: tr.querySelector('select')?.disabled ?? null,
    })),
    createRole: q('#accounts-new-role')?.value ?? null, createRoleOptions: q('#accounts-new-role') ? [...q('#accounts-new-role').options].map((o) => o.textContent).join() : null,
    createRoleH: q('#accounts-new-role') ? Math.round(q('#accounts-new-role').getBoundingClientRect().height) : null,
    createRoleLabel: q('#accounts-new-role')?.closest('label')?.textContent.trim() ?? null,
    message: msg && !msg.hidden ? msg.textContent : null, messageRole: msg?.getAttribute('role') ?? null, messageError: !!msg?.classList.contains('error'),
    active: document.activeElement?.dataset?.roleUser ?? document.activeElement?.id ?? document.activeElement?.tagName,
    allSelectsDisabled: [...document.querySelectorAll('#accounts-panel select')].every((s) => s.disabled),
    createDisabled: q('#accounts-create-button')?.disabled,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    tableFits: (() => { const t = q('.accounts-table'), c = q('#accounts-panel').getBoundingClientRect(); return t.getBoundingClientRect().right <= c.right + 0.5 && t.scrollWidth <= t.clientWidth; })(),
  };
})()`;
v = await ev(acct);
check('관리자 계정 표: 머리 줄 아이디·권한·만든 날·마지막 로그인·동작, role=table·cell 유지', v.heads.join() === '아이디,권한,만든 날,마지막 로그인,동작' && v.tableRole === 'table' && v.cellRoles === 'cell', v);
check('권한 열: 관리자 행은 글자 "관리자"(바꾸는 칸 없음), 손두병은 직원, 홍외주는 외주(칸 값 일치)',
  v.rows[0].text === '관리자' && v.rows[0].select === null && v.rows[1].select === 'staff' && v.rows[2].select === 'contractor' && v.rows.every((r) => r.label === '권한'), v.rows);
check('바꾸는 칸: 직원/외주 두 가지만, 높이 44px 이상, 칸 이름 "손두병 권한"', v.rows[1].options === '직원,외주' && v.rows[1].selectH >= 44 && v.rows[1].selectLabel === '손두병 권한', v.rows[1]);
check('새 계정 폼에 권한 칸(기본 직원, 직원/외주, 높이 44px, 이름 "권한")', v.createRole === 'staff' && v.createRoleOptions === '직원,외주' && v.createRoleH >= 44 && /^권한/.test(v.createRoleLabel), v);
check('1280: 표·창 가로 넘침 없음', !v.overflow && v.tableFits, v);
await b.shot('roles-admin-accounts-1280');

// 새 계정: 기본(직원)
const typeAcct = (sel, val) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(val)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await ev(`__fake.fnCalls.length = 0`);
await typeAcct('#accounts-new-id', '박직원'); await typeAcct('#accounts-new-password', 'abcdef');
await ev(`document.querySelector('#accounts-create-button').click()`);
await b.waitFor(`/계정을 만들었습니다/.test(document.querySelector('#accounts-message')?.textContent ?? '')`, 3000);
let body = (await ev(`__fake.fnCalls.find((c) => c.body.action === 'create').body`));
v = await ev(acct);
check('권한을 안 고르고 만들면 role: staff로 보냄, 안내 "박직원 계정을 만들었습니다.", 목록에 직원으로 나타남', body.role === 'staff' && v.message === '박직원 계정을 만들었습니다.' && v.rows.at(-1).select === 'staff', { body, v: v.message, rows: v.rows });

// 새 계정: 외주
await ev(`__fake.fnCalls.length = 0`);
await typeAcct('#accounts-new-id', '이외주'); await typeAcct('#accounts-new-password', 'abcdef');
await ev(`(() => { const s = document.querySelector('#accounts-new-role'); s.value = 'contractor'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await ev(`document.querySelector('#accounts-create-button').click()`);
await b.waitFor(`/외주로 만들었습니다/.test(document.querySelector('#accounts-message')?.textContent ?? '')`, 3000);
body = await ev(`__fake.fnCalls.find((c) => c.body.action === 'create').body`);
v = await ev(acct);
check('권한을 외주로 골라 만들면 role: contractor로 보냄, 안내 "이외주 계정을 외주로 만들었습니다.", 목록에 외주, 폼 권한은 다시 직원',
  body.role === 'contractor' && v.message === '이외주 계정을 외주로 만들었습니다.' && v.rows.at(-1).select === 'contractor' && v.createRole === 'staff', { body, v });
check('가짜 서버에도 외주로 저장됨(accounts() role)', (await ev(`__fake.accounts().find((u) => u.login_id === '이외주')?.role`)) === 'contractor');

// 직원 → 외주 → 직원(set_role). 요청 중에는 잠김.
await ev(`__fake.fnCalls.length = 0; __fake.fnDelay = 400`);
const pick = (id, role) => ev(`(() => { const s = document.querySelector('select[data-role-user="${id}"]'); s.focus(); s.value = ${JSON.stringify(role)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await pick('user-son', 'contractor');
await sleep(120);
v = await ev(acct);
check('권한을 바꾸는 요청 중에는 표의 모든 권한 칸·만들기 단추가 잠기고, 칸에는 새 값이 보임', v.allSelectsDisabled && v.createDisabled && v.rows[1].select === 'contractor', v);
await b.waitFor(`/권한을 외주로 바꿨습니다/.test(document.querySelector('#accounts-message')?.textContent ?? '')`, 3000);
await ev(`__fake.fnDelay = null`);
v = await ev(acct);
body = await ev(`__fake.fnCalls.find((c) => c.body.action === 'set_role').body`);
check('직원 → 외주: set_role {user_id, role: contractor}, 안내 "손두병 계정의 권한을 외주로 바꿨습니다."(상태 알림), 칸 값 외주, 다시 쓸 수 있고 초점은 그 칸',
  body.user_id === 'user-son' && body.role === 'contractor' && v.message === '손두병 계정의 권한을 외주로 바꿨습니다.' && v.messageRole === 'status' && !v.messageError && v.rows[1].select === 'contractor' && !v.rows[1].disabled && v.active === 'user-son', { body, v });
check('가짜 서버에 반영됨(accounts() role = contractor)', (await ev(`__fake.accounts().find((u) => u.id === 'user-son').role`)) === 'contractor');
await pick('user-son', 'staff');
await b.waitFor(`/권한을 직원으로 바꿨습니다/.test(document.querySelector('#accounts-message')?.textContent ?? '')`, 3000);
v = await ev(acct);
check('외주 → 직원: 안내 "손두병 계정의 권한을 직원으로 바꿨습니다.", 칸 값 직원', v.message === '손두병 계정의 권한을 직원으로 바꿨습니다.' && v.rows[1].select === 'staff' && (await ev(`__fake.accounts().find((u) => u.id === 'user-son').role`)) === 'staff', v);

// 서버 오류 문구(바꾸기 실패 → 문구 표시, 칸은 이전 값으로 돌아감)
await ev(`__fake.fnFailNext({ status: 400, error: '권한은 직원 또는 외주만 고를 수 있습니다.' })`);
await pick('user-son', 'contractor');
await b.waitFor(`document.querySelector('#accounts-message')?.classList.contains('error')`, 3000);
v = await ev(acct);
check('서버가 400을 주면 "권한은 직원 또는 외주만 고를 수 있습니다." 빨간 알림(alert), 칸은 직원으로 되돌아가고 다시 쓸 수 있음',
  v.message === '권한은 직원 또는 외주만 고를 수 있습니다.' && v.messageRole === 'alert' && v.rows[1].select === 'staff' && !v.rows[1].disabled && v.active === 'user-son', v);
await ev(`__fake.fnFailNext({ status: 403, error: '관리자 계정의 권한은 여기서 바꿀 수 없습니다.' })`);
await pick('user-con', 'staff');
await b.waitFor(`/관리자 계정의 권한/.test(document.querySelector('#accounts-message')?.textContent ?? '')`, 3000);
v = await ev(acct);
check('403 "관리자 계정의 권한은 여기서 바꿀 수 없습니다."도 그대로 보이고 칸은 외주로 되돌아감, 로그아웃되지 않음',
  v.messageError && v.rows[2].select === 'contractor' && (await ev(`!document.querySelector('.app').hidden`)), v);
// 가짜 서버의 계약: 관리자 계정·잘못된 권한 값은 거절(문구는 계약대로)
const direct = (body) => ev(`(async () => { const c = window.supabase.createClient('x', 'y'); const r = await c.functions.invoke('admin-users', { body: ${JSON.stringify(body)} }); return r.error ? await r.error.context.json() : r.data; })()`);
const rAdmin = await direct({ action: 'set_role', user_id: 'user-' + ADMIN, role: 'contractor' });
const rBad = await direct({ action: 'set_role', user_id: 'user-son', role: 'admin' });
check('서버 계약: 관리자 계정은 "관리자 계정의 권한은 여기서 바꿀 수 없습니다.", 값이 staff·contractor가 아니면 "권한은 직원 또는 외주만 고를 수 있습니다."',
  rAdmin.ok === false && rAdmin.error === '관리자 계정의 권한은 여기서 바꿀 수 없습니다.' && rBad.ok === false && rBad.error === '권한은 직원 또는 외주만 고를 수 있습니다.', { rAdmin, rBad });

// 휴대폰 폭에서도 권한 열이 들어가고 넘치지 않음
await b.setViewport(390, 844, true);
await sleep(400);
v = await ev(acct);
check('390: 계정 표에 권한 열이 있고 가로 넘침 없음', v.heads.includes('권한') && !v.overflow && v.tableFits && v.rows[1].selectH >= 44, v);
await b.shot('roles-admin-accounts-390');

// 권한이 바뀐 계정으로 로그인하면 그대로 적용(DB의 현재 역할)
await b.setViewport(1280, 800, false);
await ev(`document.querySelector('#logout-button').click()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 4000);
await login('이외주');
await waitApp();
await sleep(300);
v = await ev(view);
check('관리자가 외주로 만든 계정(이외주)으로 로그인하면 외주 화면(단추 숨김, "이외주 · 외주")', v.body.includes('role-contractor') && !v.import && !v.export && !v.accounts && v.header === '이외주 · 외주', v);

check('콘솔 예외 0건', b.errors.length === 0, b.errors);
await finish(b);
