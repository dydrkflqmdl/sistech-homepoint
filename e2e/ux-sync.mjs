// B-3 목록 불러오는 중·실패, B-6 응답 시간 제한·저장 중 취소, B-5 미션 충돌 두 갈래,
// B-7 실시간: 내가 방금 저장한 변경은 건너뜀, 바뀐 장소만 get_places(C2), 지운 장소(C3 deleted_at·DELETE)는 바로 뺌, get_places가 없으면 전체로.
import { launch, PROJECT, prepare, reporter, sleep } from './lib.mjs';

const { parseFlightTime, formatFlightTime } = await import(PROJECT + '/public/flight-time.js');

const { check, finish } = reporter('ux-sync');
const b = await launch('ux-sync');
const ev = b.ev;
const places = [
  { name: 'SW_01', district: '태안', address: '가람면', lat: 37.277767, lng: 126.717126, mission: 'M_01 ~ _03' },
  { name: 'SW_02', district: '태안', address: '바람리', lat: 37.167923, lng: 126.815733, mission: 'N_01 ~ _02' },
  { name: 'TB_01', district: '보은', address: '보은읍', lat: 36.49, lng: 127.73, mission: '' },
];
const calls = (name) => ev(`__fake.calls.filter(c => c.name === ${JSON.stringify(name)}).length`);
const login = () => ev(`(() => { document.querySelector('#login-id').value = 'admin@sistech.test'; document.querySelector('#login-password').value = 'test1234'; document.querySelector('#login-submit').click(); })()`);
const listState = `({ status: document.querySelector('#list-status').hidden ? null : document.querySelector('#list-status').textContent.trim(),
  empty: !document.querySelector('#empty').hidden, groups: document.querySelectorAll('#place-list .group').length, summary: document.querySelector('#list-summary').textContent,
  retry: !!document.querySelector('#list-retry') })`;
const form = (m) => `document.querySelector('#detail .mission-form[data-mission="${m}"]')`;
// 비행시간은 분·초 두 칸: fill의 flightTime('10분')은 flightMin·flightSec로 나눠 넣는다.
const splitFlight = (values) => {
  if (!('flightTime' in values)) return values;
  const { flightTime, ...rest } = values;
  const t = parseFlightTime(flightTime);
  return { ...rest, flightMin: t.min, flightSec: t.sec };
};
const flight = async (m) => {
  const t = await ev(`(() => { const f = ${form(m)}; return [f.querySelector('input[name=flightMin]').value, f.querySelector('input[name=flightSec]').value]; })()`);
  return formatFlightTime(t[0], t[1]);
};
// 미션 기록 창(모달)이 닫혔는지. 저장에 성공하면 창이 닫히고 초점은 그 미션 버튼으로 간다.
const dialogClosed = `!document.querySelector('#detail .mission-dialog')`;
const closeDialog = () => ev(`document.querySelector('#detail .mission-dialog .mission-dialog-close')?.click()`);
const fill = (m, values) => ev(`(() => { const f = ${form(m)}; for (const [k, v] of Object.entries(${JSON.stringify(splitFlight(values))})) {
  const i = f.querySelector('input[name="' + k + '"]'); if (i.type === 'checkbox') { if (i.checked !== v) i.click(); } else { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); } } })()`);
const submit = (m) => ev(`${form(m)}.querySelector('button[type=submit]').click()`);
const setTimeoutMs = (ms) => ev(`import('./api.js').then((m) => m.setCallTimeout(${ms}))`);

// ── B-3: 로그인 직후 "불러오는 중…", 받은 뒤 목록 ──
await prepare(b, { places, signedIn: false });
await ev(`__fake.rpcDelay.list_places = 1200`);
await login();
await b.waitFor(`!document.querySelector('.app').hidden`, 3000);
let v = await ev(listState);
check('로그인 직후(목록 받는 중) "불러오는 중…"이 보이고 "저장한 장소가 없습니다"는 숨김', v.status === '불러오는 중…' && !v.empty && v.groups === 0, v);
await b.waitFor(`document.querySelectorAll('#place-list .group').length === 2`, 4000);
v = await ev(listState);
check('받은 뒤 상태 줄은 사라지고 목록(시군 2)', v.status === null && !v.empty && v.groups === 2 && v.summary === '장소 3개', v);

// 재로그인: 앞 사람 화면이 먼저 보이지 않음
await ev(`document.querySelector('#logout-button').click()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 4000);
await login();
await b.waitFor(`!document.querySelector('.app').hidden`, 3000);
v = await ev(listState);
check('다시 로그인하면 앞 목록 없이 "불러오는 중…"부터(옛 화면이 먼저 비치지 않음)', v.status === '불러오는 중…' && v.groups === 0 && !v.empty && v.summary === '', v);
await b.waitFor(`document.querySelectorAll('#place-list .group').length === 2`, 4000);
await ev(`__fake.rpcDelay.list_places = 20`);

// ── B-3: 실패 → 고정 안내 + [다시 시도] ──
await prepare(b, { places, signedIn: false });
await ev(`__fake.failNext({ status: 500, code: 'XX000', message: 'boom', name: 'list_places' })`);
await login();
await b.waitFor(`!!document.querySelector('#list-retry')`, 3000);
v = await ev(listState);
check('목록을 못 받으면 목록 위에 고정 안내 + [다시 시도], "저장한 장소가 없습니다"는 안 보임', v.status?.startsWith('장소 목록을 불러오지 못했습니다. 서버 오류가 발생했습니다. (XX000)') && v.retry && !v.empty && v.groups === 0, v);
await sleep(3800);
check('실패 안내는 알림처럼 사라지지 않음(3.8초 뒤에도)', (await ev(listState)).retry);
await ev(`document.querySelector('#list-retry').click()`);
await b.waitFor(`document.querySelectorAll('#place-list .group').length === 2`, 3000);
v = await ev(listState);
check('[다시 시도] → 목록을 받고 안내가 사라짐', v.status === null && v.groups === 2, v);

// 시간 초과
await setTimeoutMs(700);
await ev(`__fake.rpcDelay.list_places = 3000`);
await ev(`document.querySelector('#logout-button').click()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 4000);
await login();
await b.waitFor(`!!document.querySelector('#list-retry')`, 4000);
v = await ev(listState);
check('목록 응답이 시간 안에 없으면 "응답이 없습니다. 인터넷 연결을 확인하고 다시 시도해 주세요." + [다시 시도]', /응답이 없습니다\. 인터넷 연결을 확인하고 다시 시도해 주세요\./.test(v.status ?? '') && v.retry, v);
await ev(`__fake.rpcDelay.list_places = 20`);
await setTimeoutMs(20000);
await ev(`document.querySelector('#list-retry').click()`);
await b.waitFor(`document.querySelectorAll('#place-list .group').length === 2`, 3000);

// 빈 DB → 받은 뒤에만 "아직 저장한 장소가 없습니다"
await prepare(b, { places: [], signedIn: false });
await ev(`__fake.rpcDelay.list_places = 800`);
await login();
await b.waitFor(`!document.querySelector('.app').hidden`, 3000);
const beforeLoad = await ev(listState);
await b.waitFor(`!document.querySelector('#empty').hidden`, 3000);
const afterLoad = await ev(listState);
check('장소가 0곳이면 받기 전에는 "불러오는 중…", 받은 뒤에만 "아직 저장한 장소가 없습니다"', !beforeLoad.empty && beforeLoad.status === '불러오는 중…' && afterLoad.empty && afterLoad.status === null, { beforeLoad, afterLoad });
await ev(`__fake.rpcDelay.list_places = 20`);

// ── B-6: 미션 저장 시간 초과 → 폼 안 안내 + [다시 시도], 저장 중에도 [취소] ──
await prepare(b, { places });
await ev(`__e2e.row('SW_01').click()`); await sleep(250);
await ev(`document.querySelector('#detail .mission-item[data-mission="M_01"]').click()`); await sleep(150);
await fill('M_01', { flightTime: '10분', batteryNo: '2', batteryLeft: '40' });
await setTimeoutMs(700);
await ev(`__fake.rpcDelay.save_mission = 3000`);
await submit('M_01'); await sleep(150);
v = await ev(`({ saving: ${form('M_01')}.querySelector('button[type=submit]').textContent, submitDisabled: ${form('M_01')}.querySelector('button[type=submit]').disabled, cancelDisabled: ${form('M_01')}.querySelector('.btn.cancel').disabled, inputsDisabled: ${form('M_01')}.querySelector('input[name=flightMin]').disabled && ${form('M_01')}.querySelector('input[name=flightSec]').disabled })`);
check('저장 중: [저장 중…]·입력 잠김, [취소]는 누를 수 있음', v.saving === '저장 중…' && v.submitDisabled && !v.cancelDisabled && v.inputsDisabled, v);
await b.waitFor(`!!${form('M_01')}?.querySelector('.mission-error')`, 3000);
v = await ev(`({ error: ${form('M_01')}.querySelector('.mission-error p')?.textContent, retry: !!${form('M_01')}.querySelector('.mission-retry'), disabled: ${form('M_01')}.querySelector('input[name=worker]').disabled, toast: document.querySelector('#toast').textContent })`);
v.flight = await flight('M_01');
check('시간 초과 → 창 안 폼에 "응답이 없습니다. 입력한 내용은 그대로 있습니다." + [다시 시도], 적던 값 그대로·다시 고칠 수 있음, 알림(토스트)은 띄우지 않음',
  v.error === '응답이 없습니다. 입력한 내용은 그대로 있습니다.' && v.retry && v.flight === '10분' && !v.disabled && v.toast !== v.error, v);
await ev(`__fake.rpcDelay.save_mission = 20`);
await setTimeoutMs(20000);
await ev(`${form('M_01')}.querySelector('.mission-retry').click()`);
await b.waitFor(dialogClosed, 3000); await sleep(100);
v = await ev(`({ rec: (() => { const m = __fake.store().find(p => p.name === 'SW_01').missions.find(m => m.mission === 'M_01'); return m?.flightTime + '|' + m?.worker; })(), active: document.activeElement?.dataset?.mission ?? null })`);
check('[다시 시도] → 저장되어 창 닫힘, 초점은 M_01 버튼(이름은 로그인 아이디)', v.rec === '10분|admin@sistech.test' && v.active === 'M_01', v);

// 저장 중 [취소]: 기다리기를 그만두고 입력 화면으로(값 그대로)
await ev(`document.querySelector('#detail .mission-item[data-mission="M_02"]').click()`); await sleep(150);
await fill('M_02', { flightTime: '3분', batteryNo: '7' });
await ev(`__fake.rpcDelay.save_mission = 4000`);
await submit('M_02'); await sleep(200);
await ev(`${form('M_02')}.querySelector('.btn.cancel').click()`); await sleep(150);
v = await ev(`({ form: !!${form('M_02')}, error: ${form('M_02')}?.querySelector('.mission-error p')?.textContent, worker: ${form('M_02')}?.querySelector('input[name=batteryNo]').value, disabled: ${form('M_02')}?.querySelector('input[name=worker]').disabled, submit: ${form('M_02')}?.querySelector('button[type=submit]').textContent, active: document.activeElement?.textContent })`);
check('저장 중 [취소] → 바로 입력 화면으로(값 그대로, "저장을 멈췄습니다(이미 저장됐을 수도…)" + [다시 시도]), 저장 단추에 초점', v.form && v.error === '저장을 멈췄습니다(이미 저장됐을 수도 있습니다). 입력한 내용은 그대로 있습니다.' && v.worker === '7' && !v.disabled && v.submit === '저장' && v.active === '저장', v);
await ev(`__fake.rpcDelay.save_mission = 20`);
await sleep(4200);
await ev(`${form('M_02')}.querySelector('.btn.cancel').click()`); await sleep(150);
await closeDialog(); await sleep(150); // 저장된 미션이면 [취소] 뒤 창 안 보기 화면이 남는다 → ×로 닫음

// ── B-5: 충돌 두 갈래 ──
await ev(`document.querySelector('#detail .mission-item[data-mission="M_03"]').click()`); await sleep(150);
await fill('M_03', { flightTime: '9분', batteryNo: '내값' });
await ev(`document.querySelector('#toast').textContent = ''`);
await ev(`__fake.conflictNext({ done: false, worker: '최신', flightTime: '1분', batteryNo: '5', batteryLeft: '50', version: 3, updatedAt: '' })`);
await submit('M_03'); await sleep(300);
v = await ev(`({ msg: ${form('M_03')}.querySelector('.mission-conflict-message')?.textContent, buttons: [...${form('M_03')}.querySelectorAll('.mission-conflict button')].map(x => x.textContent), toast: document.querySelector('#toast').textContent, worker: ${form('M_03')}.querySelector('input[name=batteryNo]').value })`);
check('충돌 → 폼 안 고정 안내 문구 + [최신값 불러오기]·[내 값으로 덮어쓰기], 알림(토스트) 없음, 내 값 그대로',
  v.msg === '다른 기기에서 먼저 저장된 기록이 있습니다. 내가 적은 값은 그대로 두었습니다.' && v.buttons.join() === '최신값 불러오기,내 값으로 덮어쓰기' && v.toast === '' && v.worker === '내값', v);
await sleep(3800);
check('충돌 안내는 사라지지 않음(3.8초 뒤에도)', await ev(`!!${form('M_03')}.querySelector('.mission-conflict')`));
await ev(`${form('M_03')}.querySelector('.conflict-latest').click()`); await sleep(150);
v = await ev(`({ panel: !!${form('M_03')}.querySelector('.mission-conflict'), worker: ${form('M_03')}.querySelector('input[name=worker]').value, battery: ${form('M_03')}.querySelector('input[name=batteryNo]').value })`);
v.flight = await flight('M_03');
check('[최신값 불러오기] → 서버 최신 값으로 바꾸고 안내 닫음(이름 칸은 로그인 아이디 그대로)', !v.panel && v.worker === 'admin@sistech.test' && v.flight === '1분' && v.battery === '5', v);
await fill('M_03', { flightTime: '2분' });
await ev(`__fake.conflictNext({ done: false, worker: '또다른', flightTime: '4분', batteryNo: '5', batteryLeft: '50', version: 5, updatedAt: '' })`);
await submit('M_03'); await sleep(300);
await ev(`${form('M_03')}.querySelector('.conflict-overwrite').click()`);
await b.waitFor(dialogClosed, 3000);
v = await ev(`__fake.store().find(p => p.name === 'SW_01').missions.find(m => m.mission === 'M_03')`);
check('[내 값으로 덮어쓰기] → 최신 판(5)을 바탕으로 내 값 저장(version 6, 이름은 로그인 아이디)', v.worker === 'admin@sistech.test' && v.flightTime === '2분' && v.version === 6, v);

// ── B-7 실시간: 내가 방금 저장한 변경은 다시 받지 않음 ──
await sleep(500);
let list0 = await calls('list_places');
let get0 = await calls('get_places');
await ev(`document.querySelector('#detail .mission-item[data-mission="M_01"]').click()`); await sleep(100);
await ev(`document.querySelector('#detail .mission-view[data-mission="M_01"] .btn.edit').click()`); await sleep(100);
await fill('M_01', { flightTime: '11분' });
await submit('M_01');
await b.waitFor(dialogClosed, 3000);
await ev(`(() => { const t = document.querySelector('#memo-input'); t.value = '내 메모'; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await sleep(900);
const echoes = await ev(`__fake.emitted.filter(e => e.table === 'missions' || e.table === 'places').length`);
check('내 미션·메모 저장의 실시간 알림(echo)이 와도 다시 받지 않음(get_places·list_places 0회)', echoes > 0 && (await calls('get_places')) === get0 && (await calls('list_places')) === list0, { echoes, get: (await calls('get_places')) - get0, list: (await calls('list_places')) - list0 });

// 다른 기기의 미션 변경 → 그 장소만(missions 알림의 place_id)
get0 = await calls('get_places');
await ev(`__fake.remoteChange((db) => { db.missions.push({ id: db.nextMid++, placeId: 2, mission: 'N_01', done: true, worker: '원격', flightTime: '1', batteryNo: '1', batteryLeft: '1', version: 1, updatedAt: '' }); }, { table: 'missions' })`);
await sleep(700);
let ids = await ev(`__fake.calls.filter(c => c.name === 'get_places').map(c => c.params.p_ids)`);
check('다른 기기의 미션 기록 변경 → missions 알림의 place_id(2)만 get_places로 받아 반영', ids.length === get0 + 1 && JSON.stringify(ids.at(-1)) === '[2]' && (await ev(`/미션 1\\/2/.test(__e2e.row('SW_02').querySelector('.badge').textContent)`)), ids.at(-1));

// C3: 지운 표시(deleted_at) → 받지 않고 바로 뺌
get0 = await calls('get_places');
list0 = await calls('list_places');
await ev(`__fake.remoteChange((db) => { db.places.find(p => p.name === 'TB_01').deletedAt = new Date().toISOString(); })`);
await sleep(700);
v = await ev(`({ summary: document.querySelector('#list-summary').textContent, groups: [...document.querySelectorAll('#place-list .group-name')].map(g => g.textContent) })`);
check('C3: deleted_at이 찍힌 UPDATE → 다시 받지 않고 목록에서 바로 뺌', v.summary === '장소 2개' && !v.groups.includes('보은') && (await calls('get_places')) === get0 && (await calls('list_places')) === list0, v);

// 내가 지움(soft delete 서버): 목록에서 빠지고 알림 뒤에도 다시 받지 않음
await ev(`__fake.softDelete = true`);
await ev(`__e2e.row('SW_02').click()`); await sleep(250);
get0 = await calls('get_places');
list0 = await calls('list_places');
await ev(`document.querySelector('#detail .delete-place .link').click()`);
await sleep(800);
v = await ev(`({ summary: document.querySelector('#list-summary').textContent, detail: !document.querySelector('#detail').hidden, deleted: !!__fake.rawDb().places.find(p => p.name === 'SW_02').deletedAt })`);
check('soft delete 서버에서 장소 삭제 → 목록에서 빠지고, 자기 알림(deleted_at)으로 다시 받지 않음', v.summary === '장소 1개' && !v.detail && v.deleted && (await calls('get_places')) === get0 && (await calls('list_places')) === list0, v);
await ev(`__fake.softDelete = false`);

// C2가 없는 서버: get_places → PGRST202 → 전체(list_places)로 대신, 다음부터는 바로 전체
await ev(`__fake.noGetPlaces = true`);
list0 = await calls('list_places');
await ev(`__fake.remoteChange((db) => { db.places.find(p => p.name === 'SW_01').memo = 'C2 없음'; })`);
await sleep(700);
const c2a = { list: (await calls('list_places')) - list0, memo: await ev(`__e2e.row('SW_01').querySelector('.memo-icon').title`) };
const get1 = await calls('get_places');
await ev(`__fake.remoteChange((db) => { db.places.find(p => p.name === 'SW_01').memo = 'C2 없음 2'; })`);
await sleep(700);
check('get_places가 없으면(PGRST202) list_places로 대신 받아 반영하고, 그다음부터는 get_places를 부르지 않음',
  c2a.list === 1 && c2a.memo === '메모: C2 없음' && (await calls('get_places')) === get1 && (await ev(`__e2e.row('SW_01').querySelector('.memo-icon').title`)) === '메모: C2 없음 2', c2a);

check('콘솔 오류·예외 0건', b.errors.length === 0, b.errors);
await finish(b);
