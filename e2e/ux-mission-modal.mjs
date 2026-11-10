// 미션 기록 창(모달, missions-ui.js missionDialog)과 비행시간 분·초 두 칸(flight-time.js).
// 미션 버튼 → 모달(dialog.showModal, 제목 = 미션명 + 장소명, 초점 완료 체크), 뒤쪽은 누를 수 없음(inert),
// ×·Esc·바깥 누르기로 닫힘(고친 값이 있으면 버릴지 묻기), 저장하면 닫히고 초점은 미션 버튼, 저장 중에는 닫히지 않음.
// 비행시간: 분·초 숫자만, "12분 30초"로 저장, 분만/초만, 초 60 이상은 막힘, 옛 기록(12분30초·약 10분) 읽기.
import { launch, prepare, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('ux-mission-modal');
const places = [
  { name: 'SW_01', district: '태안', address: '가람면 하늘리', lat: 37.277767, lng: 126.717126, mission: 'M_01 ~ _20',
    missions: [
      { mission: 'M_10', done: true, worker: '홍', flightTime: '12분30초', batteryNo: '1', batteryLeft: '50', version: 1 },
      { mission: 'M_11', done: false, worker: '홍', flightTime: '약 10분', batteryNo: '', batteryLeft: '', version: 1 },
    ] },
];

const b = await launch('ux-mission-modal', { viewport: [390, 844, true] });
const ev = b.ev;
await prepare(b, { places });
await ev(`__e2e.row('SW_01').click()`); await sleep(400);

const item = (n) => `document.querySelector('#detail .mission-item[data-mission="${n}"]')`;
const type = (n, v) => ev(`(() => { const i = document.querySelector('dialog.mission-dialog input[name=${n}]'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return i.value; })()`);
const state = `(() => {
  const d = document.querySelector('dialog.mission-dialog'), r = d?.getBoundingClientRect();
  const notice = d?.querySelector('.mission-form-notice');
  return {
    open: !!d?.open, modal: !!d?.matches(':modal'), title: d?.querySelector('#mission-dialog-title')?.textContent ?? null, place: d?.querySelector('.mission-dialog-place')?.textContent ?? null,
    form: !!d?.querySelector('.mission-form'), view: !!d?.querySelector('.mission-view'),
    inside: r ? r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight : null,
    active: document.activeElement?.name || document.activeElement?.dataset?.mission || document.activeElement?.className || document.activeElement?.tagName,
    notice: notice && !notice.hidden ? notice.textContent : null,
    invalid: [...(d?.querySelectorAll('[aria-invalid=true]') ?? [])].map((e) => e.name),
    min: d?.querySelector('input[name=flightMin]')?.value ?? null, sec: d?.querySelector('input[name=flightSec]')?.value ?? null,
    flightNote: d?.querySelector('.flight .field-note')?.textContent ?? null,
    confirms: window.__confirms.length, toast: document.querySelector('#toast').textContent,
  };
})()`;
const record = (n) => ev(`__fake.store()[0].missions.find((m) => m.mission === ${JSON.stringify(n)}) ?? null`);

// ── 새 미션: 모달로 열림 ──
await ev(`${item('M_17')}.click()`); await sleep(300);
let v = await ev(state);
check('미션 버튼 → 모달 창(showModal), 제목 M_17·장소 SW_01, 입력 화면, 화면 안', v.open && v.modal && v.title === 'M_17' && v.place === 'SW_01' && v.form && v.inside, v);
check('창이 뜨면 초점은 완료 체크(키보드가 바로 뜨지 않게)', v.active === 'done', v);
const inert = await ev(`(() => { const r = document.querySelector('#search').getBoundingClientRect(); const top = document.elementFromPoint(r.left + 5, r.top + 5); return !document.querySelector('#search').contains(top); })()`);
check('창 뒤쪽(검색 칸)은 누를 수 없음', inert, inert);
const parts = await ev(`(() => { const d = document.querySelector('dialog.mission-dialog'); const m = d.querySelector('input[name=flightMin]'), s = d.querySelector('input[name=flightSec]');
  return { labels: [m.getAttribute('aria-label'), s.getAttribute('aria-label')], units: [...d.querySelectorAll('.flight .unit-label')].map((u) => u.textContent), mode: [m.inputMode, s.inputMode], max: [m.maxLength, s.maxLength],
    sameRow: Math.abs(m.getBoundingClientRect().top - s.getBoundingClientRect().top) < 1, h: Math.min(m.getBoundingClientRect().height, s.getBoundingClientRect().height), old: !!d.querySelector('input[name=flightTime]') }; })()`);
check('비행시간은 분·초 두 칸(한 줄, 숫자 키패드, 분 3자리·초 2자리, 높이 44px), 옛 한 칸 없음',
  parts.labels.join() === '비행시간 분,비행시간 초' && parts.units.join() === '분,초' && parts.mode.join() === 'numeric,numeric' && parts.max.join() === '3,2' && parts.sameRow && parts.h >= 44 && !parts.old, parts);
await b.shot('ux-mission-modal-new-390');

// 빈 칸으로 완료 저장 → 창 안 안내, 비행시간 두 칸 모두 빨갛게
await ev(`document.querySelector('dialog.mission-dialog input[name=done]').click()`);
await ev(`document.querySelector('dialog.mission-dialog button[type=submit]').click()`); await sleep(200);
v = await ev(state);
check('완료 + 빈 칸 저장 → 창 안에 "모두 적어야" 안내, 분·초·배터리 칸 빨강, 초점 분 칸, 알림(토스트)은 띄우지 않음',
  /모두 적어야/.test(v.notice ?? '') && v.invalid.join() === 'flightMin,flightSec,batteryNo,batteryLeft' && v.active === 'flightMin' && !/모두 적어야/.test(v.toast), v);
await b.shot('ux-mission-modal-invalid-390');
// 숫자 아닌 글자는 지워짐, 분만 적어도 비행시간 빨강이 둘 다 풀림
const typed = await type('flightMin', '12분');
v = await ev(state);
check('분 칸에 "12분" → 숫자만 남음(12), 분·초 빈 칸 표시 함께 풀림', typed === '12' && !v.invalid.includes('flightMin') && !v.invalid.includes('flightSec'), { typed, v });
// 초 60 이상 → 막힘
await type('flightSec', '75'); await type('batteryNo', '3'); await type('batteryLeft', '45');
await ev(`document.querySelector('dialog.mission-dialog button[type=submit]').click()`); await sleep(200);
v = await ev(state);
check('초 75 → 저장 막힘, "초는 0~59" 안내, 초 칸만 빨강', /초는 0~59/.test(v.notice ?? '') && v.invalid.join() === 'flightSec' && v.open && (await record('M_17')) === null, v);
await type('flightSec', '30');
v = await ev(state);
check('막힌 칸을 고치면 창 안 안내가 사라짐', v.notice === null && v.invalid.length === 0, v);
await ev(`document.querySelector('dialog.mission-dialog button[type=submit]').click()`); await sleep(500);
v = await ev(state);
let rec = await record('M_17');
check('저장 → "12분 30초"로 저장, 창 닫힘, 초점은 M_17 버튼(✓), 알림 "저장했습니다"',
  rec?.flightTime === '12분 30초' && rec.done === true && !v.open && v.active === 'M_17' && /저장했습니다/.test(v.toast) && (await ev(`${item('M_17')}.classList.contains('done')`)), { rec, v });

// 분만 / 초만
await ev(`${item('M_18')}.click()`); await sleep(200);
await type('flightMin', '7');
await ev(`document.querySelector('dialog.mission-dialog button[type=submit]').click()`); await sleep(400);
await ev(`${item('M_19')}.click()`); await sleep(200);
await type('flightSec', '45');
await ev(`document.querySelector('dialog.mission-dialog button[type=submit]').click()`); await sleep(400);
check('분만 → "7분", 초만 → "45초"', (await record('M_18'))?.flightTime === '7분' && (await record('M_19'))?.flightTime === '45초', { m18: await record('M_18'), m19: await record('M_19') });

// ── 닫기: ×·Esc·바깥, 고친 값이 있으면 묻기 ──
await ev(`${item('M_01')}.click()`); await sleep(200);
await ev(`document.querySelector('dialog.mission-dialog .mission-dialog-close').click()`); await sleep(200);
v = await ev(state);
check('× → 닫힘(고친 것 없으면 묻지 않음), 초점 M_01 버튼', !v.open && v.confirms === 0 && v.active === 'M_01', v);
await ev(`${item('M_01')}.click()`); await sleep(200);
await ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`); await sleep(200);
v = await ev(state);
check('Esc → 창만 닫힘(상세 정보는 그대로)', !v.open && !(await ev(`document.querySelector('#detail').hidden`)), v);
await ev(`${item('M_01')}.click()`); await sleep(200);
await type('flightMin', '3');
await ev(`document.querySelector('dialog.mission-dialog').click()`); await sleep(200);
v = await ev(state);
const asked = await ev(`window.__confirms.at(-1) ?? null`);
check('고친 뒤 바깥(배경) 누르기 → "저장하지 않은 미션 기록" 묻고 닫힘', !v.open && v.confirms === 1 && /저장하지 않은 미션 기록/.test(asked ?? ''), { v, asked });

// 저장 중에는 ×·Esc로 닫히지 않음
await ev(`${item('M_02')}.click()`); await sleep(200);
await type('flightMin', '4');
await ev(`__fake.rpcDelay.save_mission = 1500`);
await ev(`document.querySelector('dialog.mission-dialog button[type=submit]').click()`); await sleep(150);
await ev(`document.querySelector('dialog.mission-dialog .mission-dialog-close').click()`);
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`); await sleep(100);
v = await ev(state);
const closeDisabled = await ev(`document.querySelector('dialog.mission-dialog .mission-dialog-close')?.disabled ?? null`);
check('저장 중에는 ×(비활성)·Esc로 닫히지 않음', v.open && closeDisabled === true, { v, closeDisabled });
await sleep(1800);
await ev(`delete __fake.rpcDelay.save_mission`);
check('저장이 끝나면 창 닫힘·"4분" 저장', !(await ev(state)).open && (await record('M_02'))?.flightTime === '4분', await record('M_02'));

// ── 옛 기록 읽기 ──
await ev(`${item('M_10')}.click()`); await sleep(200);
v = await ev(state);
check('저장한 미션 → 창 안 보기 화면(초점 [수정])', v.open && v.view && !v.form && /edit/.test(v.active), v);
await ev(`document.querySelector('dialog.mission-dialog .mission-view .btn.edit').click()`); await sleep(200);
v = await ev(state);
check('옛 기록 "12분30초" → 분 12·초 30으로 읽음', v.form && v.min === '12' && v.sec === '30', v);
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`); await sleep(200);
v = await ev(state);
check('읽기만 하고 Esc → 묻지 않고 닫힘(같은 시간을 다르게 적은 옛 기록도 고친 것으로 보지 않음)', !v.open && v.confirms === 1, v);
await ev(`${item('M_11')}.click()`); await sleep(200);
await ev(`document.querySelector('dialog.mission-dialog .mission-view .btn.edit').click()`); await sleep(200);
v = await ev(state);
check('분·초로 읽을 수 없는 옛 기록("약 10분") → 칸은 비우고 "지금 기록: 약 10분" 안내', v.min === '' && v.sec === '' && /지금 기록: 약 10분/.test(v.flightNote ?? ''), v);
await b.shot('ux-mission-modal-legacy-390');
await type('batteryNo', '5');
await ev(`document.querySelector('dialog.mission-dialog button[type=submit]').click()`); await sleep(400);
rec = await record('M_11');
check('비행시간 칸을 안 건드리고 저장 → 옛 글자 그대로 저장', rec?.flightTime === '약 10분' && rec?.batteryNo === '5', rec);

// ── 1280 ──
await b.setViewport(1280, 800, false); await sleep(300);
await ev(`${item('M_03')}.click()`); await sleep(200);
v = await ev(state);
check('1280: 같은 모달이 화면 가운데(폭 440px 이하)', v.open && v.inside && (await ev(`document.querySelector('dialog.mission-dialog').getBoundingClientRect().width`)) <= 440, v);
await b.shot('ux-mission-modal-1280');
check('콘솔 예외 0건', b.errors.length === 0, b.errors);
await finish(b);
