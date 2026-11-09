// 항목 5(내보내기)·6(미션 저장)·7(실시간)·8(세션 만료)
// [화면 개선 반영] 충돌은 알림 대신 폼 안 고정 안내(B-5). 실시간 알림은 바뀐 장소만 get_places로 받는다(B-7, C2).
// 접힌 시군의 줄은 DOM에 없으므로 __e2e.row()로 펼쳐 찾고, 목록 수는 요약 문구로 본다.
import { csv, launch, prepare, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('features');
const b = await launch('features');
const ev = b.ev;
const REQUIRED = '완료로 저장하려면 이름, 비행시간, 사용한 배터리 번호, 마지막 배터리 남은 용량을 모두 적어야 합니다.';
const places = [
  { name: 'SW_01', district: '태안', address: '가람면 하늘리', phone: '010-1', lat: 37.277767, lng: 126.717126, mission: 'M_01 ~ _03', memo: '=1+1',
    missions: [{ mission: 'M_01', done: true, worker: '홍', flightTime: '1분', batteryNo: '1', batteryLeft: '50', version: 1 }] },
  { name: 'SW_02', district: '태안', address: '가람면 바람리', lat: 37.167923, lng: 126.815733, mission: 'N_01 ~ _02', memo: '줄\n바꿈, "따옴표"' },
  { name: 'TB_01', district: '보은', address: '보은읍', lat: 36.49, lng: 127.73, mission: '' },
];
const toastText = () => ev(`document.querySelector('#toast').hidden ? null : document.querySelector('#toast').textContent`);
const clearToast = () => ev(`document.querySelector('#toast').hidden = true`);
const selectPlace = (name) => ev(`__e2e.row(${JSON.stringify(name)}).click()`);
const openMission = (m) => ev(`document.querySelector('#detail .mission-item[data-mission=${JSON.stringify(m)}]').click()`);
const fill = (values) => ev(`(() => { const f = document.querySelector('#detail .mission-form'); for (const [k, v] of Object.entries(${JSON.stringify(values)})) {
  const i = f.querySelector('input[name="' + k + '"]'); if (i.type === 'checkbox') { if (i.checked !== v) i.click(); } else { i.focus(); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); } } })()`);
const submit = () => ev(`document.querySelector('#detail .mission-form button[type=submit]').click()`);
const saveCalls = () => ev(`__fake.calls.filter(c => c.name === 'save_mission').map(c => c.params)`);
const listCalls = () => ev(`__fake.calls.filter(c => c.name === 'list_places').length`);
const getCalls = () => ev(`__fake.calls.filter(c => c.name === 'get_places').map(c => c.params.p_ids)`);
const record = (place, m) => ev(`__fake.store().find(p => p.name === ${JSON.stringify(place)}).missions.find(x => x.mission === ${JSON.stringify(m)}) ?? null`);
const waitIdle = () => b.waitFor(`!document.querySelector('#detail .mission-form button[type=submit]:disabled')`, 3000);

// ══ 5. 내보내기 ══
await prepare(b, { places });
await ev(`(() => {
  window.__exports = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { const url = orig(blob); window.__exports.push({ blob, url }); return url; };
  HTMLAnchorElement.prototype.click = function () { const e = window.__exports.at(-1); if (e && this.href === e.url) e.download = this.download; };
})()`);
await ev(`document.querySelector('#export-button').click()`);
await sleep(200);
const exp = await ev(`(async () => {
  const e = window.__exports.at(-1);
  const bytes = new Uint8Array(await e.blob.arrayBuffer());
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  return { type: e.blob.type, download: e.download, head: [...bytes.slice(0, 3)], boms: (text.match(/\\uFEFF/g) ?? []).length, text, anchors: document.querySelectorAll('a[download]').length };
})()`);
const lines = exp.text.replace(/^﻿/, '').split('\r\n');
const today = (d) => d.toISOString().slice(0, 10);
check('내보내기 Blob 형식 text/csv;charset=utf-8', exp.type === 'text/csv;charset=utf-8', exp.type);
check('BOM은 맨 앞에 1번만(EF BB BF)', JSON.stringify(exp.head) === '[239,187,191]' && exp.boms === 1, { head: exp.head, boms: exp.boms });
check('머리글 "이름,시군,주소,전화번호,위도,경도,상태,완료/전체,메모,미션명"', lines[0] === '이름,시군,주소,전화번호,위도,경도,상태,완료/전체,메모,미션명', lines[0]);
check('파일명 places-YYYY-MM-DD.csv(오늘)', /^places-\d{4}-\d{2}-\d{2}\.csv$/.test(exp.download) && exp.download === `places-${today(new Date())}.csv`, exp.download);
check('행: 진행 상태·완료/전체·수식 방어(\'=1+1)', lines[1] === "SW_01,태안,가람면 하늘리,010-1,37.277767,126.717126,진행 중,1/3,'=1+1,M_01 ~ _03", lines[1]);
check('행: 줄바꿈·따옴표 메모는 따옴표로 감쌈', lines[2] === 'SW_02,태안,가람면 바람리,,37.167923,126.815733,미진행,0/2,"줄\n바꿈, ""따옴표""",N_01 ~ _02', JSON.stringify(lines[2]));
check('행: 미션 없는 장소는 완료/전체 빈 칸', lines[3] === 'TB_01,보은,보은읍,,36.49,127.73,미진행,,,', lines[3]);
check('CRLF로 끝나고 행 수 = 장소 + 1', lines.length === 5 && lines[4] === '', lines.length);
check('임시 링크는 바로 제거', exp.anchors === 0, exp.anchors);
// 내보낸 CSV를 다시 읽으면 같은 장소(수식 방어 ' 제거)
const { readPlaces } = await csv();
const back = readPlaces(new TextEncoder().encode(exp.text));
check('내보낸 CSV를 readPlaces로 다시 읽으면 3곳·메모 원래대로', back.places.length === 3 && back.places[0].memo === '=1+1' && back.places[1].memo === '줄\n바꿈, "따옴표"' && back.errors.length === 0, back.places.map((p) => p.memo));
// 한국 시간 아침(UTC로는 전날)에 내보내면? — 관찰용(판정에는 넣지 않음)
const kstMorning = await ev(`(() => { const RealDate = Date; const fixed = new RealDate('2026-11-07T08:00:00+09:00'); class D extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed.getTime(); } }
  window.Date = D; document.querySelector('#export-button').click(); window.Date = RealDate; return window.__exports.at(-1).download; })()`);
console.log('관찰: 한국 시간 2026-11-07 08:00에 내보낸 파일명 =', kstMorning);

// ══ 6. 미션 저장 ══
await prepare(b, { places });
await selectPlace('SW_01'); await sleep(300);
await openMission('M_02'); await sleep(200);
check('새 미션은 바로 입력 화면', await ev(`!!document.querySelector('#detail .mission-form[data-mission="M_02"]')`));
await fill({ worker: '김', flightTime: '10분', batteryNo: '2', batteryLeft: '045' });
await submit();
await waitIdle(); await sleep(150);
let calls = await saveCalls();
let v = await ev(`({ view: !!document.querySelector('#detail .mission-view[data-mission="M_02"]'), summary: [...document.querySelectorAll('#detail .mission-view dd')].map(d => d.textContent).join('|'), toast: document.querySelector('#toast').textContent, active: document.activeElement?.textContent })`);
check('정상 저장 → save_mission 인자(5칸, base null, 045→45)', JSON.stringify(calls.at(-1)) === JSON.stringify({ p_place_id: 1, p_mission: 'M_02', p_fields: { done: false, worker: '김', flightTime: '10분', batteryNo: '2', batteryLeft: '45' }, p_base_version: null }), calls.at(-1));
check('정상 저장 → 보기 모드·저장값·알림·[수정]에 초점', v.view && v.summary === '미완료|김|10분|2|45%' && v.toast === '미션 기록을 저장했습니다.' && v.active === '수정', v);
check('DB 기록 version 1', (await record('SW_01', 'M_02'))?.version === 1);
await ev(`document.querySelector('#detail .mission-view[data-mission="M_02"] .btn.edit').click()`); await sleep(100);
await fill({ done: true });
await submit(); await waitIdle(); await sleep(150);
calls = await saveCalls();
check('다시 저장하면 화면이 받은 version(1)을 base로 보냄 → DB version 2', calls.at(-1).p_base_version === 1 && (await record('SW_01', 'M_02'))?.version === 2 && calls.at(-1).p_fields.done === true, calls.at(-1));
check('완료 저장 → 목록 배지 2/3·완료 표시', await ev(`/미션 2\\/3/.test(document.querySelector('#detail .detail-head .badge').textContent) && document.querySelector('#detail .mission-item[data-mission="M_02"]').classList.contains('done')`));

// 충돌: conflictNext(최신 기록)
await ev(`document.querySelector('#detail .mission-view[data-mission="M_02"] .btn.edit').click()`); await sleep(100);
await fill({ worker: '내 값' });
await ev(`__fake.conflictNext({ done: false, worker: '다른사람', flightTime: '5분', batteryNo: '9', batteryLeft: '10', version: 7, updatedAt: '' })`);
await clearToast();
await submit(); await waitIdle(); await sleep(150);
v = await ev(`({ conflict: document.querySelector('#detail .mission-conflict-latest')?.textContent, message: document.querySelector('#detail .mission-conflict-message')?.textContent, role: document.querySelector('#detail .mission-conflict')?.getAttribute('role'),
  form: !!document.querySelector('#detail .mission-form[data-mission="M_02"]'), worker: document.querySelector('#detail .mission-form input[name=worker]')?.value, done: document.querySelector('#detail .mission-form input[name=done]')?.checked, toast: document.querySelector('#toast').textContent })`);
check('충돌 → 폼 안 고정 안내에 최신값 "미완료 · 다른사람 · 5분 · 9 · 10%"', v.conflict === '최신 저장값: 미완료 · 다른사람 · 5분 · 9 · 10%', v);
check('충돌 → 입력 화면 유지·적던 값 보존·폼 안 안내(role=alert, 알림 칸은 쓰지 않음)', v.form && v.worker === '내 값' && v.done === true && v.message === '다른 기기에서 먼저 저장된 기록이 있습니다. 내가 적은 값은 그대로 두었습니다.' && v.role === 'alert' && !/다른 기기/.test(v.toast), v);
check('충돌 → 목록 진행도는 최신 기록 기준(완료 풀림 → 1/3)', await ev(`/미션 1\\/3/.test(document.querySelector('#detail .detail-head .badge').textContent)`));
await submit(); await waitIdle(); await sleep(150);
calls = await saveCalls();
check('충돌 뒤 다시 저장 → base 7로 보내 성공(version 8), 안내 사라짐', calls.at(-1).p_base_version === 7 && (await record('SW_01', 'M_02'))?.version === 8 && (await ev(`!document.querySelector('#detail .mission-conflict') && !!document.querySelector('#detail .mission-view[data-mission="M_02"]')`)), calls.at(-1));
// 기록 없는 미션의 충돌(record null)
await openMission('M_03'); await sleep(100);
await fill({ worker: '새' });
await ev(`__fake.conflictNext(null)`);
await submit(); await waitIdle(); await sleep(150);
check('기록 없는 미션 충돌 → "최신 저장값: 없음"', (await ev(`document.querySelector('#detail .mission-conflict-latest')?.textContent`)) === '최신 저장값: 없음');
await submit(); await waitIdle(); await sleep(150);
check('다시 저장 → base null로 새 기록 version 1', (await saveCalls()).at(-1).p_base_version === null && (await record('SW_01', 'M_03'))?.version === 1);

// 완료 규칙: 화면 검사(서버 호출 없이 막음)와 서버 오류 문구
await ev(`document.querySelector('#detail .mission-view[data-mission="M_03"] .btn.edit').click()`); await sleep(100);
await fill({ done: true });
await clearToast();
let n = (await saveCalls()).length;
await submit(); await sleep(200);
check('완료 + 빈 칸 → 화면에서 막고 문구 알림, save_mission 호출 없음', (await toastText()) === REQUIRED && (await saveCalls()).length === n && (await ev(`document.querySelectorAll('#detail .mission-form [aria-invalid=true]').length`)) === 3, await toastText());
await fill({ done: false, batteryLeft: '150' });
await clearToast(); await submit(); await sleep(200);
check('남은 용량 150 → "0~100 사이 숫자" 알림, 호출 없음', (await toastText()) === '마지막 배터리 남은 용량은 0~100 사이 숫자만 적어 주세요.' && (await saveCalls()).length === n, await toastText());
await fill({ batteryLeft: '20' });
await ev(`__fake.failNext({ status: 400, code: 'P0001', message: ${JSON.stringify(REQUIRED)} })`);
await clearToast(); await submit(); await waitIdle(); await sleep(150);
v = await ev(`({ form: !!document.querySelector('#detail .mission-form[data-mission="M_03"]'), left: document.querySelector('#detail .mission-form input[name=batteryLeft]').value, disabled: document.querySelector('#detail .mission-form input[name=worker]').disabled })`);
check('서버가 완료 규칙 오류를 내면 그 한국어 문구를 알림·입력 유지', (await toastText()) === REQUIRED && v.form && v.left === '20' && !v.disabled, { toast: await toastText(), v });
// 바꿀 내용이 없습니다(화면은 늘 5칸을 보내므로 api.js를 직접 부른다)
const noChange = await ev(`import('./api.js').then(m => m.saveMission(1, 'M_01', {}, 1)).then(() => 'resolved', e => ({ message: e.message, code: e.code, status: e.status, auth: e.auth }))`);
check('save_mission에 칸 없음 → "바꿀 내용이 없습니다."(api.js가 그대로 전달)', noChange.message === '바꿀 내용이 없습니다.' && noChange.code === 'P0001' && noChange.status === 400 && noChange.auth === null, noChange);
await ev(`__fake.failNext({ status: 400, code: 'P0001', message: '바꿀 내용이 없습니다.' })`);
await clearToast(); await submit(); await waitIdle(); await sleep(150);
check('서버가 "바꿀 내용이 없습니다."를 내면 그대로 알림', (await toastText()) === '바꿀 내용이 없습니다.', await toastText());
const noMission = await ev(`import('./api.js').then(m => m.saveMission(1, 'X_99', { done: false }, null)).then(() => 'resolved', e => e.message)`);
check('없는 미션 → "이 장소에 없는 미션입니다."', noMission === '이 장소에 없는 미션입니다.', noMission);
await ev(`__fake.failNext({ status: 500, code: 'XX000', message: 'internal error' })`);
await clearToast(); await submit(); await waitIdle(); await sleep(150);
check('영어 서버 오류 → "서버 오류가 발생했습니다. (XX000)"', (await toastText()) === '서버 오류가 발생했습니다. (XX000)', await toastText());
await ev(`__fake.failNext({ status: 0, code: '', message: 'TypeError: Failed to fetch' })`);
await clearToast(); await submit(); await waitIdle(); await sleep(150);
check('연결 실패(status 0) → "서버에 연결하지 못했습니다…"', (await toastText()) === '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.', await toastText());
// 다른 기기에서 지워진 장소에 저장
await ev(`__fake.remoteChange((db) => { db.places = db.places.filter(p => p.id !== 1); db.missions = db.missions.filter(m => m.placeId !== 1); }, { notify: false })`);
await clearToast(); await submit(); await sleep(300);
v = await ev(`({ detail: !document.querySelector('#detail').hidden, summary: document.querySelector('#list-summary').textContent, toast: document.querySelector('#toast').textContent })`);
check('지워진 장소에 저장 → "다른 기기에서 삭제" 알림·상세 닫힘·목록에서 뺌', !v.detail && v.summary === '장소 2개' && v.toast === '이 장소는 다른 기기에서 삭제되었습니다.', v);

// ══ 7. 실시간 ══
await prepare(b, { places });
await ev(`__fake.echo = false`);
await selectPlace('SW_01'); await sleep(300);
await openMission('M_02'); await sleep(200);
await fill({ worker: '초안작성중' });
await ev(`(() => { const i = document.querySelector('#detail .mission-form input[name=worker]'); i.focus(); i.setSelectionRange(2, 2); })()`);
let n0 = await listCalls();
let g0 = (await getCalls()).length;
await ev(`__fake.remoteChange((db) => { db.places.find(p => p.name === 'SW_02').memo = '원격메모'; })`);
await sleep(150);
const early = (await getCalls()).length + (await listCalls());
await sleep(450);
v = await ev(`(() => { const i = document.querySelector('#detail .mission-form input[name=worker]');
  const sw02 = [...document.querySelectorAll('#place-list button[data-id]')].find(b => b.querySelector('.name').firstChild.textContent.trim() === 'SW_02');
  return { value: i?.value, focused: document.activeElement === i, caret: i?.selectionStart, memoOn: sw02?.querySelector('.memo-icon').classList.contains('on'), title: sw02?.querySelector('.memo-icon').title }; })()`);
check('원격 변경 → 300ms 동안은 다시 받지 않음(150ms 시점)', early === n0 + g0, { n0, g0, early });
let gets = await getCalls();
check('원격 변경 → 300ms 뒤 바뀐 장소(SW_02)만 get_places로 1번 받아 반영, 전체(list_places)는 다시 받지 않음', gets.length === g0 + 1 && JSON.stringify(gets.at(-1)) === '[2]' && (await listCalls()) === n0 && v.memoOn && v.title === '메모: 원격메모', { gets, v });
check('원격 변경 뒤에도 적던 초안 값·초점·커서 유지', v.value === '초안작성중' && v.focused && v.caret === 2, v);
n0 = await listCalls();
g0 = (await getCalls()).length;
await ev(`(async () => { for (let i = 0; i < 5; i++) { __fake.remoteChange((db) => { db.places.find(p => p.name === 'TB_01').memo = 'm' + i; }, { table: i % 2 ? 'missions' : 'places' }); await new Promise(r => setTimeout(r, 40)); } })()`);
await sleep(700);
gets = await getCalls();
check('연달아 온 알림 5번 → 모아서 한 번만, 그 장소(TB_01)만 받음', gets.length === g0 + 1 && JSON.stringify(gets.at(-1)) === '[3]' && (await listCalls()) === n0, { gets, list: await listCalls(), n0 });
// 같은 미션 기록이 다른 기기에서 바뀜
await clearToast();
await ev(`__fake.remoteChange((db) => { db.missions.push({ id: db.nextMid++, placeId: 1, mission: 'M_02', done: false, worker: '원격', flightTime: '3분', batteryNo: '7', batteryLeft: '30', version: 1, updatedAt: '' }); }, { table: 'missions' })`);
await sleep(600);
v = await ev(`({ value: document.querySelector('#detail .mission-form input[name=worker]')?.value, conflict: document.querySelector('#detail .mission-conflict')?.textContent ?? null, toast: document.querySelector('#toast').hidden ? null : document.querySelector('#toast').textContent })`);
check('같은 미션 기록이 원격으로 바뀌어도 적던 초안은 덮이지 않음', v.value === '초안작성중', v);
console.log('관찰: 같은 미션 원격 변경 직후 즉시 안내 =', JSON.stringify({ conflict: v.conflict, toast: v.toast }));
await submit(); await waitIdle(); await sleep(150);
v = await ev(`({ conflict: document.querySelector('#detail .mission-conflict-latest')?.textContent ?? null, message: document.querySelector('#detail .mission-conflict-message')?.textContent ?? null, value: document.querySelector('#detail .mission-form input[name=worker]')?.value })`);
check('그 상태로 저장 → 폼 안 충돌 안내(최신값 "원격")·초안 유지', v.conflict === '최신 저장값: 미완료 · 원격 · 3분 · 7 · 30%' && /다른 기기에서 먼저 저장된 기록/.test(v.message ?? '') && v.value === '초안작성중', v);
// 미션명이 바뀌어 고른 미션이 사라짐 → 입력 칸 닫힘
await ev(`__fake.remoteChange((db) => { db.places.find(p => p.id === 1).mission = 'Z_01'; })`);
await sleep(600);
v = await ev(`({ editor: !!document.querySelector('#detail .mission-editor'), items: [...document.querySelectorAll('#detail .mission-item')].map(x => x.dataset.mission) })`);
check('원격으로 미션명이 바뀌어 고른 미션이 없어지면 입력 칸 닫힘', !v.editor && v.items.join() === 'Z_01', v);
// 연결이 다시 붙으면(SUBSCRIBED 두 번째) 놓친 변경을 다시 받음
n0 = await listCalls();
await ev(`__fake.resubscribe()`);
await sleep(150);
const reEarly = await listCalls();
await sleep(550);
check('재연결(SUBSCRIBED 다시) → 300ms 뒤 한 번 다시 받음(첫 SUBSCRIBED는 안 받음)', reEarly === n0 && (await listCalls()) === n0 + 1, { n0, reEarly, after: await listCalls() });
// 고른 장소가 원격 삭제
await clearToast();
await ev(`__fake.remoteChange((db) => { db.places = db.places.filter(p => p.id !== 1); })`);
await sleep(600);
v = await ev(`({ detail: !document.querySelector('#detail').hidden, toast: document.querySelector('#toast').textContent, summary: document.querySelector('#list-summary').textContent, gets: __fake.calls.filter(c => c.name === 'get_places').length })`);
check('고른 장소가 원격 삭제(DELETE 알림) → 다시 받지 않고 바로 빼고 상세 닫힘·알림', !v.detail && v.toast === '이 장소는 다른 기기에서 삭제되었습니다.' && v.summary === '장소 2개', v);
// 가져오는 중 온 알림 → 끝난 뒤 한 번 더 받음
await ev(`__fake.delay = 400`);
n0 = await listCalls();
g0 = (await getCalls()).length;
await ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['이름,위도,경도\\nRT_1,35.1,128.1\\n'], 'rt.csv', { type: 'text/csv' }));
  for (const type of ['dragenter', 'dragover', 'drop']) { const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'dataTransfer', { value: dt }); window.dispatchEvent(e); }
  document.querySelector('#import-panel .btn.primary').click(); })()`);
await sleep(100);
await ev(`__fake.remoteChange((db) => { db.places.find(p => p.name === 'TB_01').memo = '가져오는중원격'; })`);
await sleep(2500);
await ev(`__fake.delay = 20`);
v = await ev(`({ calls: __fake.calls.filter(c => c.name === 'list_places').length, gets: __fake.calls.filter(c => c.name === 'get_places').length, memo: __e2e.row('TB_01')?.querySelector('.memo-icon').title, rt: !!__e2e.row('RT_1') })`);
// 가져오는 동안 온 알림은 모아 두었다가, 가져오기 끝에 받은 전체 목록에 이미 들어 있으면 다시 받지 않는다.
check('가져오는 중 온 알림 → 가져오기 끝에 전체 1번, 그 목록에 이미 반영돼 더 받지 않음, 둘 다 반영', v.calls === n0 + 1 && v.gets === g0 && v.memo === '메모: 가져오는중원격' && v.rt, { ...v, n0, g0 });
await ev(`[...document.querySelectorAll('#import-panel .btn')].find(x => x.textContent === '닫기')?.click()`);

// ══ 8. 세션 만료 ══
await prepare(b, { places });
await selectPlace('SW_02'); await sleep(300);
await openMission('N_01'); await sleep(200);
await fill({ worker: '만료전' });
await ev(`__fake.failNext({ status: 401, code: 'PGRST301', message: 'JWT expired' })`);
await submit();
await b.waitFor(`!document.querySelector('#login').hidden`, 3000);
await sleep(200);
v = await ev(`({ login: !document.querySelector('#login').hidden, app: !document.querySelector('.app').hidden, error: document.querySelector('#login-error').hidden ? null : document.querySelector('#login-error').textContent,
  rows: document.querySelector('#place-list').children.length, detail: !document.querySelector('#detail').hidden, email: document.querySelector('#user-name').textContent,
  removed: __fake.removed.length, channels: __fake.channels, session: __fake.session(), active: document.activeElement?.id })`);
check('저장 중 401(PGRST301) → 로그인 화면 + "로그인이 만료되었습니다. 다시 로그인해 주세요."', v.login && !v.app && v.error === '로그인이 만료되었습니다. 다시 로그인해 주세요.', v);
check('만료 → 목록·상세·이메일 비움, 구독 해제, 세션 삭제, 아이디 칸 초점', v.rows === 0 && !v.detail && v.email === '' && v.removed >= 1 && v.channels === 0 && v.session === null && v.active === 'login-id', v);
await ev(`document.querySelector('#login-id').value = 'admin@sistech.test'; document.querySelector('#login-password').value = 'test1234'; document.querySelector('#login-submit').click()`);
await b.waitFor(`!document.querySelector('.app').hidden && document.querySelectorAll('#place-list .group').length === 2`, 3000);
v = await ev(`({ error: document.querySelector('#login-error').hidden, detail: !document.querySelector('#detail').hidden, draft: !!document.querySelector('#detail .mission-form'), channels: __fake.channels })`);
check('다시 로그인 → 안내 지움, 앞 화면(상세·초안) 남지 않음, 구독 1개', v.error && !v.detail && !v.draft && v.channels === 1, v);
// 권한 없음(403) — 실시간 알림으로 다시 받다가
await ev(`__fake.failNext({ status: 403, code: '42501', message: 'permission denied for function list_places' })`);
await ev(`__fake.remoteChange(() => {})`);
await b.waitFor(`!document.querySelector('#login').hidden`, 3000);
check('목록 다시 받기 403(42501) → 로그인 화면 + 권한 없음 문구', (await ev(`document.querySelector('#login-error').textContent`)) === '이 계정에는 권한이 없습니다. 다시 로그인하거나 관리자에게 문의해 주세요.', await ev(`document.querySelector('#login-error').textContent`));
// 메모 저장 중 만료
await ev(`document.querySelector('#login-id').value = 'admin@sistech.test'; document.querySelector('#login-password').value = 'test1234'; document.querySelector('#login-submit').click()`);
await b.waitFor(`!document.querySelector('.app').hidden && document.querySelectorAll('#place-list .group').length === 2`, 3000);
await selectPlace('TB_01'); await sleep(200);
await ev(`__fake.failNext({ status: 401, code: 'PGRST303', message: 'JWT expired' })`);
await ev(`(() => { const t = document.querySelector('#detail .memo textarea'); t.value = 'x'; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 3000);
check('메모 저장 중 만료 → 로그인 화면 + 만료 문구', (await ev(`document.querySelector('#login-error').textContent`)) === '로그인이 만료되었습니다. 다시 로그인해 주세요.');
// 가져오기 중 만료
await ev(`document.querySelector('#login-id').value = 'admin@sistech.test'; document.querySelector('#login-password').value = 'test1234'; document.querySelector('#login-submit').click()`);
await b.waitFor(`!document.querySelector('.app').hidden && document.querySelectorAll('#place-list .group').length === 2`, 3000);
await ev(`__fake.failNext({ status: 401, code: 'PGRST301', message: 'JWT expired' })`);
await ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['이름,위도,경도\\nEX_1,35.1,128.1\\n'], 'ex.csv', { type: 'text/csv' }));
  for (const type of ['dragenter', 'dragover', 'drop']) { const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'dataTransfer', { value: dt }); window.dispatchEvent(e); }
  document.querySelector('#import-panel .btn.primary').click(); })()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 3000);
await sleep(200);
v = await ev(`({ error: document.querySelector('#login-error').textContent, panel: !document.querySelector('#import-panel').hidden })`);
check('가져오기 중 만료 → 로그인 화면 + 만료 문구, 가져오기 창 닫힘', v.error === '로그인이 만료되었습니다. 다시 로그인해 주세요.' && !v.panel, v);
// 다른 창에서 로그아웃
await ev(`document.querySelector('#login-id').value = 'admin@sistech.test'; document.querySelector('#login-password').value = 'test1234'; document.querySelector('#login-submit').click()`);
await b.waitFor(`!document.querySelector('.app').hidden && document.querySelectorAll('#place-list .group').length === 2`, 3000);
check('가져오기 중 만료 후 다시 로그인하면 가져오기 상태가 풀려 있음(다시 가져오기 가능)', await ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['이름,위도,경도\\nEX_2,35.2,128.2\\n'], 'ex2.csv', { type: 'text/csv' }));
  const e = new Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'dataTransfer', { value: dt }); window.dispatchEvent(e);
  return !document.querySelector('#import-panel').hidden && /ex2\\.csv/.test(document.querySelector('#import-panel').textContent) && document.querySelector('#import-panel .btn.primary').textContent === '가져오기'; })()`));
await ev(`[...document.querySelectorAll('#import-panel .btn')].find(x => x.textContent === '취소')?.click()`);
await ev(`__fake.externalSignOut()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 3000);
check('다른 창에서 로그아웃(SIGNED_OUT) → "로그인이 만료되었거나 다른 창에서 로그아웃했습니다…"', (await ev(`document.querySelector('#login-error').textContent`)) === '로그인이 만료되었거나 다른 창에서 로그아웃했습니다. 다시 로그인해 주세요.', await ev(`document.querySelector('#login-error').textContent`));

check('콘솔 예외 0건', b.errors.length === 0, b.errors);
await finish(b);
