// A-1: 미션 기록의 '이름'(worker) 자동 입력.
// 폼을 열 때 비어 있으면 로그인 아이디(계약 C4: app_metadata.login_id → user_metadata.login_id → 이메일 복호화)를 넣고,
// 고칠 수 있으며, 그것만으로는 "저장하지 않은 기록"으로 묻지 않는다. 완료를 체크할 때 비어 있으면 다시 채운다.
// 초안(다시 그리기·실시간 갱신)과 충돌 처리([최신값 불러오기]·[내 값으로 덮어쓰기])에서도 유지된다.
import { launch, PROJECT, prepare, reporter, sleep } from './lib.mjs';

const { loginIdToEmail } = await import(PROJECT + '/public/login-id.js');
const { check, finish } = reporter('ux-worker');
const b = await launch('ux-worker');
const ev = b.ev;

const SON = loginIdToEmail('손두병');
const KIM = loginIdToEmail('김철수');
const places = [
  { name: 'SW_01', district: '태안', address: '소원면', lat: 36.766667, lng: 126.149826, mission: 'M_01 ~ _04',
    missions: [{ mission: 'M_01', done: true, worker: '홍', flightTime: '1분', batteryNo: '1', batteryLeft: '50', version: 1 }] },
  { name: 'TB_01', district: '보은', address: '보은읍', lat: 36.49, lng: 127.73, mission: '' },
];
const form = (m) => `document.querySelector('#detail .mission-form[data-mission="${m}"]')`;
const worker = (m) => ev(`${form(m)}?.querySelector('input[name=worker]')?.value ?? null`);
const openMission = (m) => ev(`document.querySelector('#detail .mission-item[data-mission="${m}"]').click()`);
const fill = (m, values) => ev(`(() => { const f = ${form(m)}; for (const [k, v] of Object.entries(${JSON.stringify(values)})) {
  const i = f.querySelector('input[name="' + k + '"]'); if (i.type === 'checkbox') { if (i.checked !== v) i.click(); } else { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); } } })()`);
const submit = (m) => ev(`${form(m)}.querySelector('button[type=submit]').click()`);
const record = (m) => ev(`__fake.store().find(p => p.name === 'SW_01').missions.find(x => x.mission === ${JSON.stringify(m)}) ?? null`);
const confirms = () => ev(`window.__confirms.length`);
const idle = (m) => b.waitFor(`!${form(m)}?.querySelector('button[type=submit]:disabled')`, 3000);

// ── 1. 표시 아이디 우선순위(C4): app_metadata.login_id가 user_metadata보다 먼저 ──
await prepare(b, { places, email: SON, users: { [SON]: '옛이름' }, appLoginIds: { [SON]: '손두병' } });
check('머리글 아이디는 app_metadata.login_id(손두병)가 user_metadata(옛이름)보다 먼저', (await ev(`document.querySelector('#user-name').textContent`)) === '손두병');

// ── 2. 새 미션: 폼을 열면 이름 칸에 로그인 아이디 ──
await ev(`__e2e.row('SW_01').click()`); await sleep(250);
await openMission('M_02'); await sleep(150);
check('새 미션 폼을 열면 이름 칸에 로그인 아이디(손두병)가 들어 있음', (await worker('M_02')) === '손두병', await worker('M_02'));
check('이름 칸은 고칠 수 있는 입력 칸(잠기지 않음)', await ev(`!${form('M_02')}.querySelector('input[name=worker]').disabled && !${form('M_02')}.querySelector('input[name=worker]').readOnly`));
let c0 = await confirms();
await openMission('M_02'); await sleep(150); // 같은 미션을 눌러 닫기
check('저절로 넣은 이름만 있으면 닫을 때 "저장하지 않은 기록"을 묻지 않음', (await confirms()) === c0 && !(await ev(`!!${form('M_02')}`)), { confirms: await confirms(), c0 });

// ── 3. 고친 이름은 묻는다, 비우고 완료를 체크하면 다시 채운다 ──
await openMission('M_02'); await sleep(150);
await fill('M_02', { worker: '다른사람' });
c0 = await confirms();
await ev(`window.confirm = (m) => { window.__confirms.push(String(m)); return false; }`);
await openMission('M_03'); await sleep(150);
check('이름을 고친 뒤 다른 미션을 누르면 버릴지 묻고, 아니오면 그대로', (await confirms()) === c0 + 1 && (await worker('M_02')) === '다른사람', { confirms: await confirms() });
await ev(`window.confirm = (m) => { window.__confirms.push(String(m)); return true; }`);
await fill('M_02', { worker: '' });
await fill('M_02', { done: true });
check('이름을 비운 채 완료를 체크하면 로그인 아이디로 다시 채움', (await worker('M_02')) === '손두병', await worker('M_02'));
await fill('M_02', { flightTime: '10분', batteryNo: '2', batteryLeft: '40' });
await submit('M_02'); await idle('M_02'); await sleep(200);
check('저장하면 이름이 손두병으로 저장됨(완료 기록)', (await record('M_02'))?.worker === '손두병' && (await record('M_02'))?.done === true, await record('M_02'));

// ── 4. 이미 이름이 있는 기록은 건드리지 않음 ──
await openMission('M_01'); await sleep(150);
await ev(`document.querySelector('#detail .mission-view[data-mission="M_01"] .btn.edit').click()`); await sleep(150);
check('저장된 이름(홍)이 있는 기록을 고칠 때는 이름을 바꾸지 않음', (await worker('M_01')) === '홍', await worker('M_01'));
await ev(`${form('M_01')}.querySelector('.btn.cancel').click()`); await sleep(150);

// ── 5. 다시 그려도(실시간 갱신) 초안의 이름 유지 ──
await openMission('M_03'); await sleep(150);
await ev(`__fake.remoteChange((db) => { db.places.find(p => p.name === 'SW_01').memo = '원격 메모'; })`);
await b.waitFor(`document.querySelector('#detail .memo textarea')?.value === '원격 메모'`, 3000);
check('실시간으로 상세 정보를 다시 그려도 이름 칸의 자동 값 유지', (await worker('M_03')) === '손두병', await worker('M_03'));

// ── 6. 충돌: 초안 유지 → [최신값 불러오기](최신 이름이 비면 다시 채움) → [내 값으로 덮어쓰기] ──
await fill('M_03', { flightTime: '7분' });
await ev(`__fake.conflictNext({ done: false, worker: '', flightTime: '5분', batteryNo: '9', batteryLeft: '10', version: 4, updatedAt: '' })`);
await submit('M_03'); await idle('M_03'); await sleep(150);
let v = await ev(`({ panel: !!${form('M_03')}.querySelector('.mission-conflict'), worker: ${form('M_03')}.querySelector('input[name=worker]').value, flight: ${form('M_03')}.querySelector('input[name=flightTime]').value })`);
check('충돌 → 폼 안 안내, 적던 이름(자동 값)과 비행시간은 그대로', v.panel && v.worker === '손두병' && v.flight === '7분', v);
await ev(`${form('M_03')}.querySelector('.conflict-latest').click()`); await sleep(150);
v = await ev(`({ panel: !!${form('M_03')}.querySelector('.mission-conflict'), worker: ${form('M_03')}.querySelector('input[name=worker]').value, flight: ${form('M_03')}.querySelector('input[name=flightTime]').value, active: document.activeElement?.name })`);
check('[최신값 불러오기] → 최신 값(5분)으로, 최신 이름이 비어 있어 로그인 아이디로 다시 채움, 안내 닫힘', !v.panel && v.worker === '손두병' && v.flight === '5분' && v.active === 'done', v);
await fill('M_03', { flightTime: '8분' });
await ev(`__fake.conflictNext({ done: false, worker: '박', flightTime: '6분', batteryNo: '9', batteryLeft: '10', version: 6, updatedAt: '' })`);
await submit('M_03'); await idle('M_03'); await sleep(150);
await ev(`${form('M_03')}.querySelector('.conflict-overwrite').click()`); await idle('M_03'); await sleep(250);
const calls = await ev(`__fake.calls.filter(c => c.name === 'save_mission').map(c => c.params)`);
v = await record('M_03');
check('[내 값으로 덮어쓰기] → 최신 판(6)을 바탕으로 내 값(손두병·8분) 저장', calls.at(-1).p_base_version === 6 && v?.worker === '손두병' && v?.flightTime === '8분' && v?.version === 7, { last: calls.at(-1), v });

// ── 7. 메타데이터가 없는 계정은 이메일(xn--)에서 되살린 아이디 ──
await prepare(b, { places, email: KIM });
await ev(`__e2e.row('SW_01').click()`); await sleep(250);
await openMission('M_04'); await sleep(150);
check('메타데이터 없는 계정 → 이메일에서 되살린 김철수가 이름 칸에', (await worker('M_04')) === '김철수', await worker('M_04'));

check('콘솔 오류·예외 0건', b.errors.length === 0, b.errors);
await finish(b);
