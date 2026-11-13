// A-1(사용자 결정 반영): 미션 기록의 '이름'(worker)은 고칠 수 없고, 늘 로그인한 사람의 표시 아이디로 기록한다.
// 표시 아이디는 계약 C4 순서(app_metadata.login_id → user_metadata.login_id → 이메일 복호화).
// 폼의 이름 칸은 읽기 전용(회색) + "로그인한 아이디로 기록됩니다". 다른 사람이 저장한 기록이면 그 이름은 보기 화면·충돌 안내에
// 보이고, 폼에는 "지금 기록의 이름은 …, 저장하면 로그인한 아이디(…)로 바뀝니다"를 알린다. 저장할 때 worker는 늘 내 아이디.
import { launch, PROJECT, prepare, reporter, sleep } from './lib.mjs';

const { loginIdToEmail } = await import(PROJECT + '/public/login-id.js');
const { parseFlightTime, formatFlightTime } = await import(PROJECT + '/public/flight-time.js');
const { parseBatteryNo } = await import(PROJECT + '/public/battery-no.js');
const { check, finish } = reporter('ux-worker');
const b = await launch('ux-worker');
const ev = b.ev;

const SON = loginIdToEmail('손두병');
const KIM = loginIdToEmail('김철수');
const places = [
  { name: 'SW_01', district: '태안', address: '가람면', lat: 37.277767, lng: 126.717126, mission: 'M_01 ~ _04',
    missions: [{ mission: 'M_01', done: true, worker: '홍', flightTime: '1분', batteryNo: '1', batteryLeft: '50', version: 1 }] },
  { name: 'TB_01', district: '보은', address: '보은읍', lat: 36.49, lng: 127.73, mission: '' },
];
const form = (m) => `document.querySelector('#detail .mission-form[data-mission="${m}"]')`;
const workerInfo = (m) => ev(`(() => { const f = ${form(m)}; const i = f?.querySelector('input[name=worker]'); if (!i) return null;
  const hintIds = (i.getAttribute('aria-describedby') ?? '').split(' ');
  return { value: i.value, readOnly: i.readOnly, ariaReadonly: i.getAttribute('aria-readonly'), bg: getComputedStyle(i).backgroundColor,
    hint: f.querySelector('.field-hint')?.textContent ?? null, note: f.querySelector('.field-note')?.textContent ?? null,
    describedBy: hintIds.every((id) => !!document.getElementById(id)) && hintIds.includes('worker-hint') }; })()`);
const openMission = (m) => ev(`document.querySelector('#detail .mission-item[data-mission="${m}"]').click()`);
// 비행시간은 분·초 두 칸: fill의 flightTime('10분')은 flightMin·flightSec로 나눠 넣는다.
const splitFlight = (values) => {
  let out = values;
  if ('flightTime' in out) {
    const { flightTime, ...rest } = out;
    const t = parseFlightTime(flightTime);
    out = { ...rest, flightMin: t.min, flightSec: t.sec };
  }
  // 배터리 번호는 숫자 두 칸: fill의 batteryNo('2-1')는 batteryNo1·batteryNo2로 나눠 넣는다.
  if ('batteryNo' in out) {
    const { batteryNo, ...rest } = out;
    const t = parseBatteryNo(batteryNo);
    out = { ...rest, batteryNo1: t.a, batteryNo2: t.b };
  }
  return out;
};
const flight = async (m) => {
  const t = await ev(`(() => { const f = ${form(m)}; return [f.querySelector('input[name=flightMin]').value, f.querySelector('input[name=flightSec]').value]; })()`);
  return formatFlightTime(t[0], t[1]);
};
const fill = (m, values) => ev(`(() => { const f = ${form(m)}; for (const [k, v] of Object.entries(${JSON.stringify(splitFlight(values))})) {
  const i = f.querySelector('input[name="' + k + '"]'); if (i.type === 'checkbox') { if (i.checked !== v) i.click(); } else { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); } } })()`);
const submit = (m) => ev(`${form(m)}.querySelector('button[type=submit]').click()`);
const record = (m) => ev(`__fake.store().find(p => p.name === 'SW_01').missions.find(x => x.mission === ${JSON.stringify(m)}) ?? null`);
const savedWorker = () => ev(`__fake.calls.filter(c => c.name === 'save_mission').at(-1)?.params.p_fields.worker ?? null`);
const confirms = () => ev(`window.__confirms.length`);
const idle = (m) => b.waitFor(`!${form(m)}?.querySelector('button[type=submit]:disabled')`, 3000);

// ── 1. 표시 아이디 우선순위(C4): app_metadata.login_id가 user_metadata보다 먼저 ──
await prepare(b, { places, email: SON, users: { [SON]: '옛이름' }, appLoginIds: { [SON]: '손두병' } });
check('머리글 아이디는 app_metadata.login_id(손두병)가 user_metadata(옛이름)보다 먼저', (await ev(`document.querySelector('#user-name').textContent`)) === '손두병');

// ── 2. 새 미션: 이름 칸은 읽기 전용, 로그인 아이디, 안내 ──
await ev(`__e2e.row('SW_01').click()`); await sleep(250);
await openMission('M_02'); await sleep(150);
let w = await workerInfo('M_02');
check('새 미션 폼의 이름 칸: 로그인 아이디(손두병), 읽기 전용(readonly·aria-readonly)', w?.value === '손두병' && w.readOnly && w.ariaReadonly === 'true', w);
check('이름 칸은 회색 바탕 + 라벨 옆 "로그인한 아이디로 기록됩니다"(aria-describedby로 연결)', w?.bg === 'rgb(245, 245, 243)' && w.hint === '로그인한 아이디로 기록됩니다' && w.describedBy && w.note === null, w);
await fill('M_02', { worker: '다른사람' });
check('이름 칸에 다른 값을 넣으려 해도 로그인 아이디 그대로', (await workerInfo('M_02'))?.value === '손두병');
let c0 = await confirms();
await ev(`document.querySelector('#detail .mission-dialog .mission-dialog-close').click()`); await sleep(150); // 창 닫기(×)
check('이름만 있는(고친 것 없는) 새 미션은 닫을 때 묻지 않음', (await confirms()) === c0 && !(await ev(`!!${form('M_02')}`)), { asked: (await confirms()) - c0 });

// ── 3. 저장: worker는 늘 로그인 아이디 ──
await openMission('M_02'); await sleep(150);
await fill('M_02', { done: true, flightTime: '10분', batteryNo: '2-1', batteryLeft: '40' });
await submit('M_02'); await idle('M_02'); await sleep(200);
check('저장할 때 worker는 로그인 아이디(손두병)로 보내고 그대로 기록됨', (await savedWorker()) === '손두병' && (await record('M_02'))?.worker === '손두병' && (await record('M_02'))?.done === true, await record('M_02'));

// ── 4. 다른 사람이 저장한 기록: 보기 화면에는 그 사람 이름, 폼에는 내 아이디 + "저장하면 바뀝니다" ──
await openMission('M_01'); await sleep(150);
const viewName = await ev(`document.querySelector('#detail .mission-view[data-mission="M_01"] dd:nth-of-type(2)')?.textContent`);
check('보기 화면(기록 요약)에는 저장한 사람 이름(홍)이 그대로', viewName === '홍', viewName);
await ev(`document.querySelector('#detail .mission-view[data-mission="M_01"] .btn.edit').click()`); await sleep(150);
w = await workerInfo('M_01');
check('[수정] 폼: 이름 칸은 로그인 아이디(손두병), "지금 기록의 이름은 홍입니다. 저장하면 로그인한 아이디(손두병)로 바뀝니다." 안내',
  w?.value === '손두병' && w.note === '지금 기록의 이름은 홍입니다. 저장하면 로그인한 아이디(손두병)로 바뀝니다.' && w.describedBy, w);
c0 = await confirms();
await ev(`${form('M_01')}.querySelector('.btn.cancel').click()`); await sleep(150);
check('다른 사람 기록을 열기만 하고 닫으면 묻지 않고 기록도 그대로(홍)', (await confirms()) === c0 && (await record('M_01'))?.worker === '홍');
await ev(`document.querySelector('#detail .mission-view[data-mission="M_01"] .btn.edit').click()`); await sleep(150);
await fill('M_01', { flightTime: '2분' });
await submit('M_01'); await idle('M_01'); await sleep(200);
check('다른 사람 기록을 고쳐 저장하면 이름이 저장한 사람(손두병)으로 바뀜', (await record('M_01'))?.worker === '손두병' && (await record('M_01'))?.flightTime === '2분', await record('M_01'));

// ── 5. 다시 그려도(실시간 갱신) 이름 칸은 로그인 아이디 ──
await openMission('M_03'); await sleep(150);
await ev(`__fake.remoteChange((db) => { db.places.find(p => p.name === 'SW_01').memo = '원격 메모'; })`);
await b.waitFor(`document.querySelector('#detail .memo textarea')?.value === '원격 메모'`, 3000);
check('실시간으로 상세 정보를 다시 그려도 이름 칸은 로그인 아이디', (await workerInfo('M_03'))?.value === '손두병');

// ── 6. 충돌: 최신 저장값에는 그 사람 이름, 이름 칸은 늘 로그인 아이디 ──
await fill('M_03', { flightTime: '7분' });
await ev(`__fake.conflictNext({ done: false, worker: '박', flightTime: '5분', batteryNo: '9', batteryLeft: '10', version: 4, updatedAt: '' })`);
await submit('M_03'); await idle('M_03'); await sleep(150);
let v = await ev(`({ latest: ${form('M_03')}.querySelector('.mission-conflict-latest')?.textContent })`);
v.flight = await flight('M_03');
w = await workerInfo('M_03');
check('충돌 → 최신 저장값에는 저장한 사람(박), 이름 칸은 로그인 아이디, 적던 비행시간은 그대로', v.latest === '최신 저장값: 미완료 · 박 · 5분 · 9 · 10%' && w.value === '손두병' && v.flight === '7분', { v, w });
await ev(`${form('M_03')}.querySelector('.conflict-latest').click()`); await sleep(150);
w = await workerInfo('M_03');
v = await ev(`({ panel: !!${form('M_03')}.querySelector('.mission-conflict'), active: document.activeElement?.name })`);
v.flight = await flight('M_03');
check('[최신값 불러오기] → 최신 값(5분)으로, 이름 칸은 로그인 아이디 + "지금 기록의 이름은 박입니다…" 안내', !v.panel && v.flight === '5분' && w.value === '손두병' && /지금 기록의 이름은 박입니다/.test(w.note ?? '') && v.active === 'done', { v, w });
await fill('M_03', { flightTime: '8분' });
await ev(`__fake.conflictNext({ done: false, worker: '최', flightTime: '6분', batteryNo: '9', batteryLeft: '10', version: 6, updatedAt: '' })`);
await submit('M_03'); await idle('M_03'); await sleep(150);
await ev(`${form('M_03')}.querySelector('.conflict-overwrite').click()`); await idle('M_03'); await sleep(250);
const calls = await ev(`__fake.calls.filter(c => c.name === 'save_mission').map(c => c.params)`);
v = await record('M_03');
check('[내 값으로 덮어쓰기] → 최신 판(6)을 바탕으로 내 값(8분), 이름은 로그인 아이디(손두병)', calls.at(-1).p_base_version === 6 && calls.at(-1).p_fields.worker === '손두병' && v?.worker === '손두병' && v?.flightTime === '8분' && v?.version === 7, { last: calls.at(-1), v });

// ── 7. 메타데이터가 없는 계정은 이메일(xn--)에서 되살린 아이디 ──
await prepare(b, { places, email: KIM });
await ev(`__e2e.row('SW_01').click()`); await sleep(250);
await b.waitFor(`!!document.querySelector('#detail .mission-item[data-mission="M_04"]')`, 3000);
await openMission('M_04'); await sleep(150);
check('메타데이터 없는 계정 → 이메일에서 되살린 김철수가 이름 칸에', (await workerInfo('M_04'))?.value === '김철수');

check('콘솔 오류·예외 0건', b.errors.length === 0, b.errors);
await finish(b);
