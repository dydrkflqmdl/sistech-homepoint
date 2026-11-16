// [기록 지우기](missions-ui.js missionView·clearMissionRecord)와 clear_mission(가짜 서버), 장소 삭제 뒤 다시 가져오기.
// 관리자·직원에게만 보임(비행팀 없음) · confirm 취소 → 호출 없음 · 성공(호출 인자·창 닫힘·초점·toast·완료 표시·배지·시군 머리글 숫자) ·
// 충돌(창 유지·최신 값·안내) · 비행팀 세션이 RPC를 직접 불러도 거절 · 진행 중 두 번 안 보냄 · 장소 삭제 뒤 같은 CSV를 다시 가져오면 기록 없는 새 장소.
import { launch, prepare, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('ux-mission-clear');
const STAFF = 'staff@sistech.test';
const CON = 'con@sistech.test';
const rows = [{ name: 'SW_01', district: '태안', address: '가람면', lat: 37.277767, lng: 126.717126, mission: 'M_01 ~ _03' }];
const places = [
  { name: 'SW_01', district: '태안', address: '가람면', lat: 37.277767, lng: 126.717126, mission: 'M_01 ~ _03',
    missions: [
      { mission: 'M_01', done: true, worker: '홍길동', flightTime: '12분 30초', batteryNo: '3-4', batteryLeft: '45', version: 3 },
      { mission: 'M_02', done: true, worker: '김철수', flightTime: '5분', batteryNo: '1-2', batteryLeft: '60', version: 1 },
    ] },
  { name: 'SW_02', district: '태안', address: '바람리', lat: 37.167923, lng: 126.815733, mission: 'N_01 ~ _02', missions: [] },
];

const b = await launch('ux-mission-clear', { viewport: [390, 844, true] });
const ev = b.ev;
const calls = (name) => ev(`__fake.calls.filter(c => c.name === ${JSON.stringify(name)}).map(c => c.params)`);
const item = (n) => `document.querySelector('#detail .mission-item[data-mission="${n}"]')`;
const rec = (n) => ev(`__fake.store().find((p) => p.name === 'SW_01').missions.find((m) => m.mission === ${JSON.stringify(n)}) ?? null`);
const view = `(() => {
  const d = document.querySelector('dialog.mission-dialog');
  const btn = d?.querySelector('.btn.clear-record'), edit = d?.querySelector('.btn.edit');
  const r = btn?.getBoundingClientRect(), box = d?.getBoundingClientRect();
  return {
    open: !!d?.open, view: !!d?.querySelector('.mission-view'), form: !!d?.querySelector('.mission-form'),
    clear: btn ? btn.textContent : null, clearDisabled: btn?.disabled ?? null, editDisabled: edit?.disabled ?? null,
    h: r ? Math.round(r.height) : null, color: btn ? getComputedStyle(btn).color : null, inside: r && box ? r.left >= box.left && r.right <= box.right : null,
    summary: d?.querySelector('.mission-summary')?.textContent ?? null, notice: d?.querySelector('.mission-form-notice')?.textContent ?? null,
    active: document.activeElement?.dataset?.mission ?? document.activeElement?.className ?? document.activeElement?.tagName,
    toast: document.querySelector('#toast').textContent, confirms: window.__confirms.slice(), overflowX: document.documentElement.scrollWidth > innerWidth,
  };
})()`;
const list = `(() => {
  const head = document.querySelector('#place-list .group-head[data-district="태안"]');
  const row = [...document.querySelectorAll('#place-list button[data-id]')].find((x) => x.querySelector('.name')?.firstChild?.textContent.trim() === 'SW_01');
  return { group: head?.querySelector('.group-count')?.textContent ?? null, badge: row?.querySelector('.badge')?.textContent ?? null,
    done: [...document.querySelectorAll('#detail .mission-item')].map((i) => i.dataset.mission + ':' + i.classList.contains('done')).join(), detailBadge: document.querySelector('#detail-title .badge')?.textContent ?? null };
})()`;
const confirmWith = (answer) => ev(`window.confirm = (m) => { window.__confirms.push(String(m)); return ${answer}; }`);

// ── 관리자: 보기 화면에 [기록 지우기] ──
await prepare(b, { places });
await ev(`__e2e.row('SW_01').click()`); await sleep(400);
await ev(`${item('M_01')}.click()`); await sleep(300);
let v = await ev(view);
check('저장된 미션 → 보기 화면에 [수정]·[기록 지우기], 처음 초점은 [수정]', v.open && v.view && v.clear === '기록 지우기' && v.active === 'btn edit', v);
check('[기록 지우기]는 위험 색(--danger 계열 글자)·높이 44px 이상·창 안·가로 넘침 없음', v.color === 'rgb(209, 52, 58)' && v.h >= 44 && v.inside && !v.overflowX, v);
await b.shot('ux-mission-clear-390');
await ev(`document.querySelector('dialog.mission-dialog .mission-dialog-close').click()`);
await sleep(200);
await ev(`${item('M_03')}.click()`); await sleep(300);
v = await ev(view);
check('저장 안 한 미션은 입력 화면이라 [기록 지우기]가 없음', v.form && v.clear === null, v);
await ev(`document.querySelector('dialog.mission-dialog .btn.cancel').click()`); await sleep(200);

// ── confirm 취소 → 아무 일도 없음 ──
await ev(`${item('M_01')}.click()`); await sleep(300);
await confirmWith(false);
await ev(`document.querySelector('dialog.mission-dialog .btn.clear-record').click()`); await sleep(500);
v = await ev(view);
check('confirm 취소 → clear_mission 호출 없음·창 그대로·기록 그대로',
  (await calls('clear_mission')).length === 0 && v.open && v.view && (await rec('M_01'))?.version === 3 && v.confirms.at(-1) === '"SW_01"의 M_01 기록을 지울까요?\n지우면 이 미션은 기록이 없는 상태로 돌아갑니다.', v.confirms);

// ── 성공 ──
const before = await ev(list);
check('지우기 전: 태안 총 미션 2/5, 장소 배지 미션 2/3', /2\/5/.test(before.group) && /2\/3/.test(before.badge), before);
await confirmWith(true);
await ev(`__fake.rpcDelay.clear_mission = 400`);
await ev(`document.querySelector('dialog.mission-dialog .btn.clear-record').click()`); await sleep(150);
v = await ev(view);
check('지우는 중에는 [수정]·[기록 지우기]가 disabled', v.clearDisabled === true && v.editDisabled === true, v);
await ev(`document.querySelector('dialog.mission-dialog .btn.clear-record').click()`); // disabled라 무시
await sleep(800);
const sent = await calls('clear_mission');
check('clear_mission은 한 번만, 인자 = 장소 id·미션명·version', sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify({ p_place_id: 1, p_mission: 'M_01', p_base_version: 3 }), sent);
v = await ev(view);
check('성공 → 창 닫힘·초점은 M_01 미션 단추·toast "미션 기록을 지웠습니다."', !v.open && v.active === 'M_01' && v.toast === '미션 기록을 지웠습니다.', v);
const after = await ev(list);
check('M_01 완료 표시 해제(M_02는 그대로), 장소 배지 1/3, 시군 머리글 총 미션 1/5',
  after.done === 'M_01:false,M_02:true,M_03:false' && /1\/3/.test(after.badge) && /1\/5/.test(after.group) && /1\/3/.test(after.detailBadge), after);
check('서버: M_01 기록은 없어지고 M_02는 그대로', (await rec('M_01')) === null && (await rec('M_02'))?.version === 1, await rec('M_02'));
await sleep(900); // 자기 알림(missions DELETE, place_id 없음)으로 전체를 다시 받아도 되살아나지 않음
check('알림으로 전체를 다시 받아 다시 그린 뒤에도 지운 기록이 되살아나지 않고 초점은 M_01 미션 단추 그대로',
  (await ev(list)).done === 'M_01:false,M_02:true,M_03:false' && (await ev(`document.activeElement?.dataset?.mission`)) === 'M_01' && (await calls('list_places')).length >= 2, { list: await ev(list), lists: (await calls('list_places')).length });

// 지운 미션을 다시 열면 기록 없는 입력 화면
await ev(`${item('M_01')}.click()`); await sleep(300);
v = await ev(view);
check('지운 미션을 다시 열면 빈 입력 화면(보기 화면·[기록 지우기] 없음)', v.form && !v.view && v.clear === null, v);
await ev(`document.querySelector('dialog.mission-dialog .btn.cancel').click()`); await sleep(200);

// ── 충돌: 다른 기기가 먼저 고침 ──
await ev(`${item('M_02')}.click()`); await sleep(300);
await ev(`__fake.remoteChange((db) => { const m = db.missions.find((x) => x.placeId === 1 && x.mission === 'M_02'); m.batteryLeft = '99'; m.version = 2; }, { table: 'missions', notify: false })`);
await ev(`document.querySelector('dialog.mission-dialog .btn.clear-record').click()`); await sleep(700);
v = await ev(view);
const c = (await calls('clear_mission')).at(-1);
check('충돌 → 지우지 않고 창 유지, 최신 값(99%)을 보여 주고 안내(창 안 + toast)',
  c.p_mission === 'M_02' && c.p_base_version === 1 && v.open && v.view && /99%/.test(v.summary) && (await rec('M_02'))?.version === 2
  && v.notice === '다른 기기에서 먼저 바뀐 기록입니다. 최신 값을 확인한 뒤 다시 지워 주세요.' && v.toast === v.notice, { c, v });
await ev(`document.querySelector('dialog.mission-dialog .btn.clear-record').click()`); await sleep(700);
v = await ev(view);
check('최신 값을 확인하고 다시 지우면 version 2로 보내 지워짐', (await calls('clear_mission')).at(-1).p_base_version === 2 && !v.open && (await rec('M_02')) === null, v);

// ── 기록이 이미 없을 때(다른 기기가 먼저 지움) ──
await ev(`__fake.remoteChange((db) => { db.missions.push({ id: db.nextMid++, placeId: 1, mission: 'M_03', done: false, worker: '박', flightTime: '', batteryNo: '', batteryLeft: '', version: 1, updatedAt: '' }); }, { table: 'missions' })`);
await sleep(900);
await ev(`${item('M_03')}.click()`); await sleep(300);
await ev(`__fake.remoteChange((db) => { db.missions = db.missions.filter((m) => !(m.placeId === 1 && m.mission === 'M_03')); }, { table: 'missions', notify: false })`);
await ev(`document.querySelector('dialog.mission-dialog .btn.clear-record').click()`); await sleep(700);
v = await ev(view);
const lastResult = await ev(`(async () => (await import('./api.js')).clearMission(1, 'M_03', null))()`);
check('원래 기록이 없으면 { ok, cleared: false }이고 화면은 성공처럼 창을 닫음', lastResult.status === 'ok' && lastResult.cleared === false && !v.open && v.toast === '미션 기록을 지웠습니다.', { lastResult, v });

// ── 오류: 장소가 없어짐 / 서버 오류 ──
await prepare(b, { places });
await ev(`__e2e.row('SW_01').click()`); await sleep(300);
await ev(`${item('M_01')}.click()`); await sleep(300);
await ev(`__fake.remoteChange((db) => { db.places = db.places.filter((p) => p.id !== 1); db.missions = db.missions.filter((m) => m.placeId !== 1); }, { notify: false })`);
await ev(`document.querySelector('dialog.mission-dialog .btn.clear-record').click()`); await sleep(700);
v = await ev(`({ detail: !document.querySelector('#detail').hidden, toast: document.querySelector('#toast').textContent })`);
check('지울 때 장소가 이미 없으면 "다른 기기에서 삭제" 흐름(상세 닫힘·알림)', !v.detail && v.toast === '이 장소는 다른 기기에서 삭제되었습니다.', v);

await prepare(b, { places });
await ev(`__e2e.row('SW_01').click()`); await sleep(300);
await ev(`${item('M_01')}.click()`); await sleep(300);
await ev(`__fake.failNext({ name: 'clear_mission', status: 500, code: 'XX000', message: 'boom' })`);
await ev(`document.querySelector('dialog.mission-dialog .btn.clear-record').click()`); await sleep(700);
v = await ev(view);
check('서버 오류 → 기록 그대로·창 유지·오류 문구(창 안 + toast)·버튼 다시 켜짐', v.open && v.view && /서버 오류가 발생했습니다/.test(v.notice) && v.toast === v.notice && v.clearDisabled === false && (await rec('M_01'))?.version === 3, v);

// ── 1280 사진 ──
await b.setViewport(1280, 800, false);
await sleep(400);
// 서버 오류 뒤라 창은 열려 있다(같은 창을 1280으로 키워 본다).
await sleep(400);
v = await ev(view);
check('1280: [기록 지우기]가 보기 화면에 보이고 가로 넘침 없음', v.open && v.clear === '기록 지우기' && !v.overflowX && v.h >= 44, v);
await b.shot('ux-mission-clear-1280');
await b.setViewport(390, 844, true);

// ── 직원도 보임 ──
await prepare(b, { places, email: STAFF });
await ev(`__e2e.row('SW_01').click()`); await sleep(300);
await ev(`${item('M_01')}.click()`); await sleep(300);
v = await ev(view);
check('직원 화면에도 [기록 지우기]가 보임', v.clear === '기록 지우기', v);

// ── 비행팀: 단추 없음, RPC 직접 호출도 거절 ──
await prepare(b, { places, email: CON, roles: { [CON]: 'contractor' } });
await ev(`__e2e.row('SW_01').click()`); await sleep(300);
await ev(`${item('M_01')}.click()`); await sleep(300);
v = await ev(view);
check('비행팀 화면에는 [기록 지우기]가 없고 [수정]만 있음', v.view && v.clear === null && v.editDisabled === false, v);
const denied = await ev(`(async () => { const { clearMission } = await import('./api.js'); try { await clearMission(1, 'M_01', 3); return { ok: true }; } catch (e) { return { ok: false, message: e.message }; } })()`);
check('비행팀 세션이 clear_mission을 직접 불러도 서버가 거절하고 기록은 그대로',
  !denied.ok && denied.message === '비행팀 계정은 미션 기록과 메모만 할 수 있습니다.' && (await rec('M_01'))?.version === 3, denied);

// ── 장소 삭제 뒤 같은 CSV 다시 가져오기: 기록 없는 새 장소 ──
await prepare(b, { places });
await ev(`__e2e.row('SW_01').click()`); await sleep(300);
await ev(`document.querySelector('#detail .delete-place .link').click()`); await sleep(900);
const gone = await ev(`({ raw: __fake.rawDb().places.filter((p) => p.name === 'SW_01').length, missions: __fake.rawDb().missions.filter((m) => m.placeId === 1).length })`);
check('장소 삭제 → 장소 행과 미션 기록이 실제로 없어짐', gone.raw === 0 && gone.missions === 0, gone);
const imported = await ev(`(async () => { const { importPlaces } = await import('./api.js'); return importPlaces(${JSON.stringify(rows)}); })()`);
const again = await ev(`__fake.store().find((p) => p.name === 'SW_01') ?? null`);
check('같은 이름·좌표를 다시 가져오면 새 id(1이 아님)의 새 장소·미션 기록 없음·imported 1',
  imported.imported === 1 && imported.duplicates === 0 && again && again.id !== 1 && again.missions.length === 0 && again.memo === '', { imported, again });

check('페이지 오류 없음', b.errors.length === 0, b.errors);
await finish(b);
