// 코드 검토에서 나온 경쟁 조건·데이터 손실 경로를 막았는지 확인한다.
// 1) 메모 칸에 초점만 둔 채 원격 변경이 오면 옛 값을 되돌려 넣어 다른 기기 메모를 덮어쓰던 문제
// 2) "저장됨" 뒤 원격 변경 → 이어 쓰면 거짓 충돌  3) 늦게 온 옛 받기 결과가 방금 저장한 기록을 되돌리던 문제
// 4) 로그아웃·새로고침·탭 닫기 때 저장 중 더 친 메모 손실  5) 다시 로그인하면 "불러오는 중…"에 멈추던 문제
// 6) [취소] 뒤 [다시 시도]가 거짓 충돌  7) 떠난 장소의 메모 충돌을 알리지 않던 문제  8) 한글 조합 상태가 굳던 문제
// 9) 본인 비밀번호 변경 → 로그아웃이 메모를 버리던 문제  10) 미션을 열고 닫을 때 메모까지 묻던 문제
import { launch, prepare, reporter, sleep, URL_BASE } from './lib.mjs';

const { check, finish } = reporter('ux-review');
const b = await launch('ux-review');
const ev = b.ev;
const ADMIN = 'admin@sistech.test';
const places = [
  { name: 'SW_01', district: '태안', address: '가람면', lat: 37.277767, lng: 126.717126, mission: 'M_01 ~ _02', memo: '옛 메모' },
  { name: 'SW_02', district: '태안', address: '바람리', lat: 37.167923, lng: 126.815733, mission: '', memo: '' },
];
const memoCalls = () => ev(`__fake.calls.filter(c => c.name === 'update_memo').map(c => c.params)`);
const dbMemo = (name) => ev(`__fake.store().find(p => p.name === ${JSON.stringify(name)}).memo`);
const typeMemo = (text) => ev(`(() => { const t = document.querySelector('#memo-input'); t.focus(); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const status = () => ev(`document.querySelector('#memo-status')?.textContent.trim() ?? null`);
const waitSaved = () => b.waitFor(`document.querySelector('#memo-status')?.textContent.trim() === '저장됨'`, 4000);
const confirms = () => ev(`window.__confirms.length`);
const form = (m) => `document.querySelector('#detail .mission-form[data-mission="${m}"]')`;
const fill = (m, values) => ev(`(() => { const f = ${form(m)}; for (const [k, v] of Object.entries(${JSON.stringify(values)})) {
  const i = f.querySelector('input[name="' + k + '"]'); if (i.type === 'checkbox') { if (i.checked !== v) i.click(); } else { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); } } })()`);

// ── 1. 메모 칸에 초점만(입력 없음) → 원격 변경 → 칸에 원격 메모, 이어 쓰면 원격 메모에 덧붙여 저장 ──
await prepare(b, { places, email: ADMIN, admins: [ADMIN], accounts: [{ id: 'user-' + ADMIN, login_id: null, email: ADMIN, created_at: '2026-10-01T00:00:00Z', last_sign_in_at: null, is_admin: true }] });
await ev(`__e2e.row('SW_01').click()`); await sleep(250);
await ev(`document.querySelector('#memo-input').focus()`);
await ev(`__fake.remoteChange((db) => { db.places.find(p => p.name === 'SW_01').memo = '다른 기기 메모'; })`);
await sleep(700);
let v = await ev(`({ value: document.querySelector('#memo-input').value, focused: document.activeElement === document.querySelector('#memo-input') })`);
check('메모 칸에 초점만 둔 채 다른 기기 메모가 오면 칸에 새 메모가 보이고 초점은 그대로(옛 값을 되돌려 넣지 않음)', v.value === '다른 기기 메모' && v.focused, v);
await typeMemo('다른 기기 메모 + 내 글');
await waitSaved();
let calls = await memoCalls();
check('이어 쓰면 새 메모를 바탕(base)으로 저장 → 다른 기기 메모가 사라지지 않음', calls.at(-1).p_base_memo === '다른 기기 메모' && (await dbMemo('SW_01')) === '다른 기기 메모 + 내 글', calls.at(-1));

// ── 2. "저장됨" 뒤 원격 변경 → 이어 쓰면 거짓 충돌 없이 저장 ──
await ev(`__fake.remoteChange((db) => { db.places.find(p => p.name === 'SW_01').memo = '원격 두 번째'; })`);
await sleep(700);
check('"저장됨" 상태에서 원격 메모가 오면 칸에 새 메모', (await ev(`document.querySelector('#memo-input').value`)) === '원격 두 번째');
await typeMemo('원격 두 번째 + 이어 씀');
await sleep(1300);
v = { status: await status(), conflict: await ev(`!!document.querySelector('#memo-status .memo-conflict')`), base: (await memoCalls()).at(-1).p_base_memo };
check('이어 써도 거짓 충돌 없이 "저장됨"(base는 원격 두 번째)', v.status === '저장됨' && !v.conflict && v.base === '원격 두 번째' && (await dbMemo('SW_01')) === '원격 두 번째 + 이어 씀', v);

// ── 3. 늦게 온 옛 받기 결과가 방금 저장한 미션 기록을 되돌리지 않음(그사이 다른 기기 변경도 놓치지 않음) ──
await ev(`__fake.snapshotAtCall = ['get_places']; __fake.rpcDelay.get_places = 900;`);
await ev(`document.querySelector('#detail .mission-item[data-mission="M_01"]').click()`); await sleep(150);
await fill('M_01', { worker: '내기록', flightTime: '5분' });
const g0 = await ev(`__fake.calls.filter(c => c.name === 'get_places').length`);
await ev(`__fake.remoteChange((db) => { db.missions.push({ id: db.nextMid++, placeId: 1, mission: 'M_02', done: true, worker: '다른기기', flightTime: '1', batteryNo: '1', batteryLeft: '1', version: 1, updatedAt: '' }); }, { table: 'missions' })`);
await b.waitFor(`__fake.calls.filter(c => c.name === 'get_places').length > ${g0}`, 2000);
await ev(`${form('M_01')}.querySelector('button[type=submit]').click()`);
await b.waitFor(`!!document.querySelector('#detail .mission-view[data-mission="M_01"]')`, 2000);
await sleep(1100); // 옛 결과(내 저장 전 스냅숏)가 도착한 뒤
v = await ev(`({ view: !!document.querySelector('#detail .mission-view[data-mission="M_01"]'), worker: document.querySelector('#detail .mission-view[data-mission="M_01"] dd:nth-of-type(2)')?.textContent })`);
check('내 저장 전에 시작한 받기 결과가 늦게 와도 방금 저장한 기록(보기 화면·내기록)이 되돌아가지 않음', v.view && v.worker === '내기록', v);
await b.waitFor(`document.querySelector('#detail .mission-item[data-mission="M_02"]')?.classList.contains('done')`, 4000);
v = await ev(`({ m2: document.querySelector('#detail .mission-item[data-mission="M_02"]').classList.contains('done'), m1: !!document.querySelector('#detail .mission-view[data-mission="M_01"]'), gets: __fake.calls.filter(c => c.name === 'get_places').length - ${g0} })`);
check('그 장소만 다시 받아 그사이 다른 기기의 변경(M_02 완료)도 반영', v.m2 && v.m1 && v.gets === 2, v);
await ev(`__fake.snapshotAtCall = []; __fake.rpcDelay.get_places = 20;`);

// ── 6. 저장 중 [취소] 뒤 [다시 시도]: 앞 요청이 이미 들어갔으면 거짓 충돌 대신 저장된 것으로 ──
await ev(`document.querySelector('#detail .mission-item[data-mission="M_02"]').click()`); await sleep(150); // M_02 보기 화면(다른 기기 기록)
await ev(`document.querySelector('#detail .mission-item[data-mission="M_01"]').click()`); await sleep(150);
await ev(`document.querySelector('#detail .mission-view[data-mission="M_01"] .btn.edit').click()`); await sleep(100);
await fill('M_01', { flightTime: '6분' });
await ev(`__fake.rpcDelay.save_mission = 1200`);
await ev(`${form('M_01')}.querySelector('button[type=submit]').click()`); await sleep(300);
await ev(`${form('M_01')}.querySelector('.btn.cancel').click()`); await sleep(1300); // 가짜 서버는 끊겨도 저장을 마친다
await ev(`__fake.rpcDelay.save_mission = 20`);
check('끊었지만 서버에는 들어간 상태(version 2)', (await ev(`__fake.store()[0].missions.find(m => m.mission === 'M_01').version`)) === 2);
await ev(`document.querySelector('#toast').textContent = ''`);
await ev(`${form('M_01')}.querySelector('.mission-retry').click()`);
await b.waitFor(`!!document.querySelector('#detail .mission-view[data-mission="M_01"]')`, 3000);
v = await ev(`({ conflict: !!document.querySelector('#detail .mission-conflict'), toast: document.querySelector('#toast').textContent, version: __fake.store()[0].missions.find(m => m.mission === 'M_01').version })`);
check('[다시 시도] → 최신 기록이 내 값과 같아 충돌 대신 "저장했습니다"(보기 화면)', !v.conflict && v.toast === '미션 기록을 저장했습니다.' && v.version === 2, v);

// ── 10. 미션을 열고 닫을 때는 메모를 묻지 않음 ──
await ev(`__fake.failNext({ status: 500, code: 'XX000', message: 'boom', name: 'update_memo' })`);
await typeMemo('실패할 메모');
await b.waitFor(`/저장 안 됨/.test(document.querySelector('#memo-status')?.textContent ?? '')`, 3000);
let c0 = await confirms();
await ev(`document.querySelector('#detail .mission-item[data-mission="M_02"]').click()`); await sleep(150);
v = { asked: (await confirms()) - c0, memo: await status() };
check('저장 못 한 메모가 있어도 미션을 바꿀 때는 메모를 묻지 않고 그대로 둠', v.asked === 0 && /저장 안 됨/.test(v.memo), v);
await ev(`document.querySelector('#memo-status .memo-retry').click()`);
await waitSaved();

// ── 7. 떠난 장소의 메모가 서버에서 충돌하면 알림 ──
await typeMemo('떠나기 전 메모');
await ev(`__fake.remoteChange((db) => { db.places.find(p => p.name === 'SW_01').memo = '그사이 바뀜'; }, { notify: false })`);
await ev(`document.querySelector('#toast').textContent = ''`);
await ev(`__e2e.row('SW_02').click()`);
await b.waitFor(`/SW_01/.test(document.querySelector('#toast').textContent)`, 3000);
check('떠난 장소의 메모가 충돌하면 알림("다른 기기에서 "SW_01" 메모가 바뀌어 저장하지 못했습니다…")', /다른 기기에서 "SW_01" 메모가 바뀌어 저장하지 못했습니다/.test(await ev(`document.querySelector('#toast').textContent`)));
await ev(`__e2e.row('SW_01').click()`); await sleep(250);
check('돌아가면 충돌 안내와 내 글이 남아 있음', (await ev(`!!document.querySelector('#memo-status .memo-conflict') && document.querySelector('#memo-input').value === '떠나기 전 메모'`)));
await ev(`document.querySelector('#memo-status .memo-take-latest').click()`); await sleep(100);

// ── 8. 한글 조합 중 초점이 빠지면 미뤄 둔 다시 그리기를 함 ──
await ev(`(() => { const t = document.querySelector('#memo-input'); t.focus(); t.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); })()`);
await ev(`__fake.remoteChange((db) => { db.places.find(p => p.name === 'SW_01').address = '바뀐 주소'; })`);
await sleep(700);
const deferred = await ev(`document.querySelector('#detail .meta').textContent.includes('바뀐 주소')`);
// compositionend 없이 초점만 빠짐. 헤드리스 페이지는 창 초점이 없어(document.hasFocus() false) focus()만으로는
// focusout이 나지 않으므로, 실제 브라우저가 보내는 focusout을 직접 보낸다.
await ev(`(() => { const t = document.querySelector('#memo-input'); t.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.querySelector('#search') })); document.querySelector('#search').focus(); })()`);
await sleep(200);
v = { deferred, now: await ev(`document.querySelector('#detail .meta').textContent.includes('바뀐 주소')`) };
check('조합 중에는 상세 정보 다시 그리기를 미루고, compositionend 없이 초점이 빠져도 다시 그림', v.deferred === false && v.now === true, v);

// ── 4. 로그아웃: 저장 중에 더 친 메모까지 저장하고 나감(묻지 않음) ──
await ev(`__e2e.row('SW_02').click()`); await sleep(250);
await ev(`__fake.rpcDelay.update_memo = 800`);
await typeMemo('가');
await sleep(1150); // 첫 저장이 시작됨(800ms 걸림)
await typeMemo('가나'); // 저장 중에 더 침
c0 = await confirms();
await ev(`document.querySelector('#logout-button').click()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 6000);
await ev(`__fake.rpcDelay.update_memo = 20`);
check('로그아웃: 저장 중에 더 친 메모까지 저장한 뒤 나감(확인 창 없음)', (await dbMemo('SW_02')) === '가나' && (await confirms()) === c0, { memo: await dbMemo('SW_02'), asked: (await confirms()) - c0 });

// ── 5. 앞 로그인의 느린 받기가 줄에 있어도 다시 로그인하면 바로 목록 ──
await ev(`document.querySelector('#login-id').value = ${JSON.stringify(ADMIN)}; document.querySelector('#login-password').value = 'test1234'; document.querySelector('#login-submit').click()`);
await b.waitFor(`document.querySelectorAll('#place-list .group').length === 1`, 3000);
await ev(`__fake.rpcDelay.get_places = 3000`);
await ev(`__fake.remoteChange((db) => { db.places.find(p => p.name === 'SW_02').memo = '느린 받기'; })`);
await b.waitFor(`__fake.calls.filter(c => c.name === 'get_places').length > 0`, 2000);
await sleep(400);
await ev(`__fake.resubscribe()`); // 재연결 → 전체 받기가 느린 받기 뒤에 줄을 섬
await sleep(500);
await ev(`document.querySelector('#logout-button').click()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 4000);
const t0 = Date.now();
await ev(`document.querySelector('#login-id').value = ${JSON.stringify(ADMIN)}; document.querySelector('#login-password').value = 'test1234'; document.querySelector('#login-submit').click()`);
const loaded = await b.waitFor(`document.querySelectorAll('#place-list .group').length === 1 && document.querySelector('#list-status').hidden`, 2500);
v = { loaded, ms: Date.now() - t0, status: await ev(`document.querySelector('#list-status').textContent`) };
check('다시 로그인하면 앞 로그인의 느린 받기를 기다리지 않고 바로 목록("불러오는 중…"에 멈추지 않음)', v.loaded && v.ms < 2500, v);
await ev(`__fake.rpcDelay.get_places = 20`);
await sleep(3000);

// ── 4b. 탭 닫기·새로고침: 저장 안 된 메모가 있으면 브라우저가 묻게 하고 저장을 시작 ──
await ev(`__e2e.row('SW_02').click()`); await sleep(250);
let n = (await memoCalls()).length;
await typeMemo('닫기 직전');
v = await ev(`(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()`);
await sleep(200);
check('입력 직후 탭을 닫으려 하면 beforeunload로 묻고(기본 동작 막음) 메모 저장을 바로 시작', v === true && (await memoCalls()).length === n + 1, { prevented: v, calls: (await memoCalls()).length - n });
await waitSaved();
v = await ev(`(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()`);
check('다 저장된 뒤에는 묻지 않음', v === false);

// ── 4c. 새 버전 [새로고침]: 기다리던 메모를 저장하고 나서 새로고침 ──
await ev(`__fake.rpcDelay.update_memo = 700`);
await typeMemo('새로고침 직전');
await ev(`document.querySelector('#update-banner').hidden = false`);
await ev(`document.querySelector('#update-reload').click()`);
await b.waitFor(`performance.getEntriesByType('navigation')[0]?.type === 'reload' && !document.querySelector('.app').hidden`, 6000);
await ev(`__fake.rpcDelay.update_memo = 20`);
check('[새로고침]은 기다리던 메모 저장이 끝난 뒤 새로고침(메모가 DB에 남음)', (await dbMemo('SW_02')) === '새로고침 직전', await dbMemo('SW_02'));
await b.navigate(URL_BASE, 300);

// ── 9. 본인 비밀번호 변경 → 로그아웃 전에 메모 저장 ──
await b.waitFor(`document.querySelectorAll('#place-list .group').length === 1`, 3000);
await ev(`__e2e.row('SW_01').click()`); await sleep(250);
await typeMemo('비번 바꾸기 전 메모');
await ev(`document.querySelector('#accounts-button').click()`);
await b.waitFor(`!!document.querySelector('#accounts-panel button[data-reset]')`, 3000);
await ev(`document.querySelector('#accounts-panel button[data-reset]').click()`); await sleep(100);
await ev(`(() => { const el = document.querySelector('#accounts-reset-password'); el.value = 'mynewpass1'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await ev(`document.querySelector('#accounts-panel .accounts-row.resetting .btn.primary').click()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 5000);
check('본인 비밀번호를 바꾸고 로그아웃하기 전에 기다리던 메모를 저장', (await dbMemo('SW_01')) === '비번 바꾸기 전 메모' && (await ev(`document.querySelector('#login-notice').textContent`)) === '비밀번호를 바꿨습니다. 새 비밀번호로 다시 로그인해 주세요.');

check('콘솔 오류·예외 0건', b.errors.length === 0, b.errors);
await finish(b);
