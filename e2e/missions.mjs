// 미션 진행 기능 E2E(옛 check-missions-v5.mjs 46건 이식). 데이터: 홈포인트_Q1.csv를 import_places 규칙으로 넣고 SW_02에 메모.
// 서버 확인(fetch /api/places)은 가짜 DB(__fake.store())로, "다른 기기 저장"은 __fake.remoteChange로 바꿨다.
// [화면 개선 반영] 접힌 시군의 줄은 DOM에 없으므로 __e2e.row()로 펼쳐 찾는다. 이름 칸은 로그인 아이디로 미리 채워진다(A-1).
// 충돌은 알림 대신 폼 안 고정 안내로 보인다(B-5). 이름(worker)은 고칠 수 없는 칸이라 늘 로그인 아이디로 저장된다.
import { launch, prepare, q1Rows, sleep, URL_BASE } from './lib.mjs';
const url = URL_BASE;
const b = await launch('missions');
const { send, errors } = b;
const evaluate = b.ev;
const shot = (name) => b.shot('m-' + name);
const results = [];
const check = (label, ok, detail = '') => { results.push({ label, ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); };
const store = () => evaluate('__fake.store()');
await prepare(b, { rows: await q1Rows(), after: `(db) => { db.places.find(p => p.name === 'SW_02').memo = '테스트메모'; }` });
await sleep(1500);

// 0. 핀에 Tab 초점 후 Enter → 상세가 열려야 한다
const pinEnter = await evaluate(`(() => {
  const m = document.querySelector('.pin[title="SW_02"]');
  if (!m) return { found: false };
  m.focus();
  for (const t of ['keydown', 'keypress', 'keyup']) m.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', keyCode: 13, bubbles: true }));
  return { found: true, opened: !document.querySelector('#detail').hidden, name: document.querySelector('#detail h2')?.textContent };
})()`);
check('지도 핀에서 Enter → 상세 열림', pinEnter.found && pinEnter.opened && /SW_02/.test(pinEnter.name ?? ''), JSON.stringify(pinEnter));
await evaluate(`document.querySelector('#detail .icon-btn').click()`); await sleep(300);

// 1. 목록 배지: 남은 34/34
const badge = await evaluate(`(() => { const b = __e2e.row('SW_01'); const t = b?.querySelector('.badge')?.textContent ?? null; __e2e.collapseAll(); return t; })()`);
check('목록 배지 미션 0/34 ┃ 남은 미션 개수 34', badge !== null && /미션\s*0\s*\/\s*34/.test(badge) && /남은 미션 개수\s*34/.test(badge), JSON.stringify(badge));
const panelFalse = await evaluate(`/false/.test(document.querySelector('.panel').textContent)`);
check('패널에 "false" 없음', panelFalse === false);

// 1a. 시군 그룹: 처음엔 모두 접힘, 태안 2곳·보은 8곳, 머리글 클릭으로 펼침, 장소 선택 시 그 그룹 자동 펼침
const groups = await evaluate(`(() => ({
  heads: [...document.querySelectorAll('#place-list .group-head')].map(h => ({ name: h.querySelector('.group-name')?.textContent.trim(), text: h.textContent.replace(/\s+/g, ' ').trim(), open: h.getAttribute('aria-expanded') })),
  visibleRows: [...document.querySelectorAll('#place-list button .name')].filter(n => n.offsetParent !== null).length,
}))()`);
check('시군 그룹 2개(태안·보은) 처음엔 접힘', groups.heads.length === 2 && groups.heads.every((h) => h.open === 'false') && groups.heads.some((h) => h.name === '태안' && /2미션/.test(h.text)) && groups.heads.some((h) => h.name === '보은' && /8미션/.test(h.text)) && groups.visibleRows === 0, JSON.stringify(groups));
await evaluate(`[...document.querySelectorAll('#place-list .group-head')].find(h => h.querySelector('.group-name')?.textContent.trim() === '보은').click()`); await sleep(300);
const opened = await evaluate(`(() => { const h = [...document.querySelectorAll('#place-list .group-head')].find(h => h.querySelector('.group-name')?.textContent.trim() === '보은'); return { open: h.getAttribute('aria-expanded'), rows: [...document.querySelectorAll('#place-list button .name')].filter(n => n.offsetParent !== null).length }; })()`);
check('보은 머리글 클릭 → 8곳 펼침', opened.open === 'true' && opened.rows === 8, JSON.stringify(opened));
await evaluate(`[...document.querySelectorAll('#place-list .group-head')].find(h => h.querySelector('.group-name')?.textContent.trim() === '보은').click()`); await sleep(300);

// 1b. 색상 자동화: 선택 UI 없음, 핀 전부 빨강, 필터 칩 '미진행', 주소에 시군
const colorInit = await evaluate(`(() => ({
  swatches: document.querySelectorAll('.swatch, .swatches').length,
  pinFills: [...new Set([...document.querySelectorAll('.pin .pin-shape path')].map(p => p.getAttribute('fill')))],
  chips: [...document.querySelectorAll('#color-filters .chip')].map(c => c.textContent.trim()),
  addr: (() => { const t = __e2e.row('SW_01')?.querySelector('.addr')?.textContent; __e2e.collapseAll(); return t; })(),
}))()`);
check('색상 선택 UI 없음', colorInit.swatches === 0, String(colorInit.swatches));
check('처음엔 핀 전부 빨강(미진행)', colorInit.pinFills.length === 1 && colorInit.pinFills[0] === '#e5484d', JSON.stringify(colorInit.pinFills));
check('필터 칩 라벨 전체/미진행', colorInit.chips.some((c) => /^전체/.test(c)) && colorInit.chips.some((c) => /^미진행/.test(c)) && !colorInit.chips.some((c) => /빨강|파랑/.test(c)), JSON.stringify(colorInit.chips));
check('목록 주소에 시군 없음(가람면 …)', /^가람면 /.test(colorInit.addr ?? ''), JSON.stringify(colorInit.addr));

// 2. SW_01 선택 → 미션 0/34
await evaluate(`__e2e.row('SW_01').click()`);
await sleep(600);
const h3 = await evaluate(`document.querySelector('#detail .missions h3')?.textContent`);
check('상세 제목 미션 0/34', /0\s*\/\s*34/.test(h3 ?? ''), JSON.stringify(h3));
const autoOpen = await evaluate(`(() => { const h = [...document.querySelectorAll('#place-list .group-head')].find(h => h.querySelector('.group-name')?.textContent.trim() === '태안'); const row = [...document.querySelectorAll('#place-list button')].find(b => b.querySelector('.name')?.textContent.startsWith('SW_01')); return { open: h?.getAttribute('aria-expanded'), rowVisible: row?.offsetParent !== null, current: row?.getAttribute('aria-current') }; })()`);
check('장소 선택 시 그 시군 그룹 자동 펼침 + 행 강조', autoOpen.open === 'true' && autoOpen.rowVisible && autoOpen.current === 'true', JSON.stringify(autoOpen));
const btnCount = await evaluate(`document.querySelectorAll('#detail .mission-list .mission-item').length`);
check('미션 버튼 34개', btnCount === 34, String(btnCount));

// 3. 미션 01 선택 → 편집 폼이 바로 아래에
await evaluate(`[...document.querySelectorAll('#detail .mission-list .mission-item')].find(b => b.textContent.includes('01_01')).click()`);
await sleep(400);
const editorInfo = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('#detail .mission-list .mission-item')].find(b => b.textContent.includes('01_01'));
  const li = btn.closest('li');
  const next = li.nextElementSibling;
  const ed = document.querySelector('#detail .mission-editor');
  return { current: btn.getAttribute('aria-current'), nextIsEditor: next?.classList.contains('mission-editor') ?? false,
           hasCheckbox: !!ed?.querySelector('input[type=checkbox]'), textInputs: ed?.querySelectorAll('input:not([type=checkbox])').length ?? 0,
           inputNames: [...(ed?.querySelectorAll('input:not([type=checkbox])') ?? [])].map(i => i.name).join(),
           labels: [...(ed?.querySelectorAll('label, #flight-label') ?? [])].map(l => l.textContent.trim()).join(' | '),
           dialogOpen: !!ed?.querySelector('dialog.mission-dialog')?.open, title: ed?.querySelector('#mission-dialog-title')?.textContent, place: ed?.querySelector('.mission-dialog-place')?.textContent,
           active: document.activeElement?.name,
           saveBtn: ed?.querySelector('form.mission-form button.btn.primary[type=submit]')?.textContent.trim(), cancelBtn: ed?.querySelector('form.mission-form button.btn.cancel')?.textContent.trim(),
           colSpan: ed ? getComputedStyle(ed).gridColumn : null };
})()`);
check('선택한 미션 aria-current=true', editorInfo.current === 'true', JSON.stringify(editorInfo.current));
check('편집 폼이 선택한 미션 바로 아래', editorInfo.nextIsEditor);
check('미션 기록 창(모달)이 열림: 제목 미션명·장소명, 초점 완료 체크', editorInfo.dialogOpen && editorInfo.title === 'Q1_A_TA_SW__01_01' && editorInfo.place === 'SW_01' && editorInfo.active === 'done', JSON.stringify([editorInfo.dialogOpen, editorInfo.title, editorInfo.place, editorInfo.active]));
// 비행시간은 분·초 두 칸이라 글자 칸은 이름·분·초·배터리 번호·용량 5개다.
check('완료 체크박스 + 입력 5개(비행시간 분·초 두 칸)', editorInfo.hasCheckbox && editorInfo.textInputs === 5 && editorInfo.inputNames === 'worker,flightMin,flightSec,batteryNo,batteryLeft', `inputs=${editorInfo.inputNames}`);
check('새 미션은 편집 모드 + 저장/취소 버튼', editorInfo.saveBtn === '저장' && editorInfo.cancelBtn === '취소', JSON.stringify([editorInfo.saveBtn, editorInfo.cancelBtn]));
check('라벨 한국어(이름/비행시간/배터리/용량)', /이름/.test(editorInfo.labels) && /비행시간/.test(editorInfo.labels) && /배터리/.test(editorInfo.labels) && /용량/.test(editorInfo.labels), editorInfo.labels);
await shot('phone-editor');

// 4. 값 입력 + 완료 체크 → 저장
const setInput = async (labelRe, value) => evaluate(`(() => {
  const ed = document.querySelector('#detail .mission-editor');
  const label = [...ed.querySelectorAll('label')].find(l => ${labelRe}.test(l.textContent));
  const input = label.querySelector('input') ?? document.getElementById(label.htmlFor);
  input.value = ${JSON.stringify(value)};
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return !!input;
})()`);
// 이름(name)으로 칸을 찾아 값을 넣는다. 비행시간 분·초 칸은 라벨 글자가 '분'·'초'뿐이라 이것으로 넣는다.
const setByName = async (name, value) => evaluate(`(() => {
  const input = document.querySelector('#detail .mission-editor input[name="${name}"]');
  input.value = ${JSON.stringify(value)};
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return input.value;
})()`);
const setFlight = async (min, sec) => { await setByName('flightMin', min); await setByName('flightSec', sec); };
// 완료만 체크하고 저장 → 차단되어야 한다
await evaluate(`(() => { const cb = document.querySelector('#detail .mission-editor input[type=checkbox]'); cb.click(); return cb.checked; })()`);
await sleep(200);
await evaluate(`document.querySelector('#detail .mission-editor form.mission-form button.btn.primary[type=submit]').click()`);
await sleep(600);
const blocked = await evaluate(`(() => ({ toast: document.querySelector('#toast')?.textContent, hidden: document.querySelector('#toast')?.hidden,
  notice: (() => { const n = document.querySelector('#detail .mission-editor .mission-form-notice'); return n && !n.hidden ? n.textContent : null; })(), active: document.activeElement?.name,
  invalid: [...document.querySelectorAll('#detail .mission-editor input[aria-invalid="true"]')].map(i => i.name), stillEdit: !!document.querySelector('#detail .mission-editor form.mission-form'),
  worker: document.querySelector('#detail .mission-editor input[name="worker"]')?.value }))()`);
// 이름 칸은 로그인 아이디(이 계정은 login_id가 없어 이메일)로 미리 채워져 있으므로 빈 칸은 나머지(비행시간 분·초, 배터리 둘)다.
// 막힌 까닭은 알림(토스트)이 아니라 창 안 안내(.mission-form-notice)로 보이고, 초점은 첫 빨간 칸(분)으로 간다.
check('완료 체크 + 빈 칸이면 저장 차단(창 안 안내·빨간 칸 4개·첫 칸 초점·편집 유지, 토스트 없음, 이름은 로그인 아이디로 고정)', /모두 적어야/.test(blocked.notice ?? '') && !(blocked.hidden === false && /모두 적어야/.test(blocked.toast ?? '')) && blocked.invalid.join() === 'flightMin,flightSec,batteryNo,batteryLeft' && blocked.active === 'flightMin' && blocked.worker === 'admin@sistech.test' && blocked.stillEdit, JSON.stringify(blocked));
const blockedApi = await store();
check('차단 시 서버에 기록 없음', (blockedApi.find((p) => p.name === 'SW_01')?.missions ?? []).length === 0);
// 이름 칸은 읽기 전용: 값을 바꾸려 해도 로그인 아이디로 남는다.
await setInput('/이름/', '홍길동'); await sleep(300);
const workerLocked = await evaluate(`(() => { const i = document.querySelector('#detail .mission-editor input[name="worker"]'); return { readOnly: i.readOnly, value: i.value }; })()`);
check('이름 칸은 읽기 전용이고 값을 넣어도 로그인 아이디 그대로', workerLocked.readOnly && workerLocked.value === 'admin@sistech.test', JSON.stringify(workerLocked));
await setFlight('12', '30'); await sleep(300);
await setInput('/배터리 번호/', '3'); await sleep(300);
await setInput('/남은 용량/', '45%'); await sleep(300);
const unit = await evaluate(`(() => { const i = [...document.querySelectorAll('#detail .mission-editor label')].find(l => /남은 용량/.test(l.textContent)).querySelector('input'); return { value: i.value, inputmode: i.getAttribute('inputmode'), unit: !!i.closest('label').querySelector('.unit-label'), invalidLeft: document.querySelectorAll('#detail .mission-editor input[aria-invalid="true"]').length }; })()`);
check('용량 입력은 숫자만 남고(45) % 표시는 별도', unit.value === '45' && unit.inputmode === 'numeric' && unit.unit === true, JSON.stringify(unit));
check('입력하면 빨간 표시 해제', unit.invalidLeft === 0, String(unit.invalidLeft));
const noticeGone = await evaluate(`document.querySelector('#detail .mission-editor .mission-form-notice')?.hidden`);
check('막힌 칸을 고치면 창 안 안내가 사라짐', noticeGone === true, String(noticeGone));
// 저장 전에는 서버에 아무것도 없어야 한다
const preSave = await store();
check('저장 버튼 전에는 서버에 기록 없음', (preSave.find((p) => p.name === 'SW_01')?.missions ?? []).length === 0);
await evaluate(`document.querySelector('#detail .mission-editor form.mission-form button.btn.primary[type=submit]').click()`);
await sleep(900);

const api = await store();
const sw01 = api.find((p) => p.name === 'SW_01');
const rec = sw01?.missions?.find((m) => m.mission === 'Q1_A_TA_SW__01_01');
check('API에 기록 저장(done/worker/flightTime/batteryNo/batteryLeft)',
  !!rec && rec.done === true && rec.worker === 'admin@sistech.test' && rec.flightTime === '12분 30초' && rec.batteryNo === '3' && rec.batteryLeft === '45',
  JSON.stringify(rec));

// 5. 완료 반영: 제목 1/34, 완료 미션 색상, 목록 배지 남은 33/34, 지도 말풍선 1/34
const after = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('#detail .mission-list .mission-item')].find(b => b.textContent.includes('01_01'));
  const other = [...document.querySelectorAll('#detail .mission-list .mission-item')].find(b => b.textContent.includes('01_02'));
  const list = [...document.querySelectorAll('#place-list button')].find(b => b.querySelector('.name')?.textContent.startsWith('SW_01'));
  const label = [...document.querySelectorAll('.pin')].map(p => p.querySelector('.memo-progress')?.textContent).filter(Boolean);
  return { h3: document.querySelector('#detail .missions h3')?.textContent, doneClass: btn.classList.contains('done'),
           doneBg: getComputedStyle(btn).backgroundColor, otherBg: getComputedStyle(other).backgroundColor,
           dialogOpen: !!document.querySelector('#detail dialog.mission-dialog')?.open, focusMission: document.activeElement?.dataset?.mission ?? null, toast: document.querySelector('#toast')?.textContent,
           badge: list?.querySelector('.badge')?.textContent, headBadge: document.querySelector('#detail .detail-head h2 .badge')?.textContent, sepBorder: (() => { const r = document.querySelector('#detail .detail-head h2 .badge .rest'); return r ? getComputedStyle(r).borderLeftWidth + ' ' + getComputedStyle(r).borderLeftStyle : null; })(), checked: document.querySelector('#detail .mission-editor input[type=checkbox]')?.checked,
           labels: label, falseText: /false/.test(document.querySelector('.panel').textContent) };
})()`);
check('상세 제목 미션 1/34', /1\s*\/\s*34/.test(after.h3 ?? ''), JSON.stringify(after.h3));
check('완료 미션에 done 클래스 + 다른 배경색', after.doneClass && after.doneBg !== after.otherBg, `${after.doneBg} vs ${after.otherBg}`);
check('목록 배지 미션 1/34 ┃ 남은 미션 개수 33', /미션\s*1\s*\/\s*34/.test(after.badge ?? '') && /남은 미션 개수\s*33/.test(after.badge ?? ''), JSON.stringify(after.badge));
const colorAfter = await evaluate(`(() => {
  const list = [...document.querySelectorAll('#place-list button')].find(b => b.querySelector('.name')?.textContent.startsWith('SW_01'));
  const dot = list?.querySelector('.dot'); const c = dot ? getComputedStyle(dot).backgroundColor : null;
  const chips = [...document.querySelectorAll('#color-filters .chip')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
  const head = document.querySelector('#detail .detail-head .dot'); const hc = head ? getComputedStyle(head).backgroundColor : null;
  return { listDot: c, headDot: hc, chips };
})()`);
check('미션 1개 완료 → 목록·상세 점 주황(진행 중)', colorAfter.listDot === 'rgb(247, 107, 21)' && colorAfter.headDot === 'rgb(247, 107, 21)', JSON.stringify([colorAfter.listDot, colorAfter.headDot]));
check('필터 칩에 진행 중 1', colorAfter.chips.some((c) => /^진행 중\s*1$/.test(c)), JSON.stringify(colorAfter.chips));
// 저장하면 창이 닫히고 초점은 그 미션 버튼으로 돌아간다. 보기 화면은 미션 버튼을 다시 눌러 확인한다.
check('저장 후 창 닫힘 + 초점은 미션 버튼 + "저장했습니다" 알림', after.dialogOpen === false && after.focusMission === 'Q1_A_TA_SW__01_01' && /미션 기록을 저장했습니다/.test(after.toast ?? ''), JSON.stringify([after.dialogOpen, after.focusMission, after.toast]));
const openMission = (n) => evaluate(`document.querySelector('#detail .mission-item[data-mission="${n}"]').click()`);
await openMission('Q1_A_TA_SW__01_01'); await sleep(300);
const reopened = await evaluate(`(() => ({ view: !!document.querySelector('#detail .mission-editor .mission-view'), editBtn: document.querySelector('#detail .mission-editor .mission-view button.btn.edit')?.textContent.trim(),
  active: document.activeElement?.classList.contains('edit') ?? false,
  summary: [...document.querySelectorAll('#detail .mission-editor .mission-summary dd')].map(d => d.textContent.trim()).join(' | ') }))()`);
check('미션 버튼을 다시 누르면 보기 화면 + 수정 버튼(초점)', reopened.view === true && reopened.editBtn === '수정' && reopened.active, JSON.stringify(reopened));
check('보기 모드 요약에 저장값 표시(이름은 로그인 아이디, 용량은 45%로)', /admin@sistech\.test/.test(reopened.summary) && /12분 30초/.test(reopened.summary) && /45%/.test(reopened.summary), reopened.summary);
check('상세 제목 옆 배지 미션 1/34 ┃ 남은 미션 개수 33', /미션\s*1\s*\/\s*34/.test(after.headBadge ?? '') && /남은 미션 개수\s*33/.test(after.headBadge ?? ''), JSON.stringify(after.headBadge));
check('남은 미션 개수 앞 구분선', after.sepBorder === '1px solid', JSON.stringify(after.sepBorder));
check('지도 말풍선에 1/34', after.labels.some((t) => /1\s*\/\s*34/.test(t)), JSON.stringify(after.labels));
check('패널에 "false" 없음(저장 후)', after.falseText === false);
await shot('phone-done');

// 5b. (보기 화면에서 [수정]) 메모를 저장한 직후 다른 입력 칸으로 옮겨 타이핑 중 → 메모 응답이 와서 다시 그려도 초점·입력이 유지되고 미션 상태가 덮이지 않아야 한다
await evaluate(`document.querySelector('#detail .mission-editor .mission-view button.btn.edit').click()`);
await sleep(300);
const focusKept = await evaluate(`(async () => {
  const ta = document.querySelector('#detail .memo textarea');
  ta.focus(); ta.value = '메모수정'; ta.dispatchEvent(new Event('change', { bubbles: true }));
  const field = document.querySelector('#detail .mission-editor input[name="batteryNo"]');
  field.focus(); field.value = '입력중'; field.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 900));
  const now = document.querySelector('#detail .mission-editor input[name="batteryNo"]');
  return { focused: document.activeElement === now, value: now?.value, h3: document.querySelector('#detail .missions h3')?.textContent,
           doneBtn: !!document.querySelector('#detail .mission-list .mission-item.done'), memo: document.querySelector('#detail .memo textarea')?.value };
})()`);
check('수정 모드에서 메모 저장 후 입력 중인 칸 초점·텍스트 유지', focusKept.focused === true && focusKept.value === '입력중', JSON.stringify(focusKept));
check('메모 응답이 미션 완료 상태를 덮지 않음', /1\s*\/\s*34/.test(focusKept.h3 ?? '') && focusKept.doneBtn && focusKept.memo === '메모수정', JSON.stringify({ h3: focusKept.h3, done: focusKept.doneBtn }));
// 취소 → 보기 모드로 돌아가고 저장값(12분 30초) 유지
await evaluate(`document.querySelector('#detail .mission-editor form.mission-form button.btn.cancel').click()`);
await sleep(300);
const cancelled = await evaluate(`(() => ({ view: !!document.querySelector('#detail .mission-editor .mission-view'), summary: [...document.querySelectorAll('#detail .mission-editor .mission-summary dd')].map(d => d.textContent.trim()).join(' | ') }))()`);
check('취소하면 보기 모드로 돌아가고 저장값 유지', cancelled.view && /12분 30초/.test(cancelled.summary) && !/입력중/.test(cancelled.summary) && / 3 /.test(' ' + cancelled.summary + ' '), JSON.stringify(cancelled));
// 다시 수정 → 비행시간 변경(분 15, 초 비움) → 저장(Enter 대신 버튼) → 서버 확인
await evaluate(`document.querySelector('#detail .mission-editor .mission-view button.btn.edit').click()`);
await sleep(300);
await setFlight('15', '');
await evaluate(`document.querySelector('#detail .mission-editor form.mission-form button.btn.primary[type=submit]').click()`);
await sleep(900);
const api2 = await store();
const rec2 = api2.find((p) => p.name === 'SW_01')?.missions?.find((m) => m.mission === 'Q1_A_TA_SW__01_01');
check('이어서 저장한 값이 서버에 반영(완료·이름은 유지)', rec2?.flightTime === '15분' && rec2?.worker === 'admin@sistech.test' && rec2?.done === true, JSON.stringify(rec2));

// 5c. 충돌 감지: 수정 모드로 연 뒤 다른 기기(API)가 먼저 저장 → 저장 시 409 안내, 다시 저장하면 성공
// 저장하면 창이 닫히므로 미션 버튼으로 다시 열고 [수정]을 누른다.
await openMission('Q1_A_TA_SW__01_01'); await sleep(300);
await evaluate(`document.querySelector('#detail .mission-editor .mission-view button.btn.edit').click()`);
await sleep(300);
const sw01Id = api2.find((p) => p.name === 'SW_01').id;
// 다른 기기가 같은 기록을 먼저 저장(version+1) → 실시간 알림. 앱은 300ms 뒤 목록을 다시 받지만 적던 초안(baseVersion)은 그대로다.
const otherVersion = await evaluate(`__fake.remoteChange((db) => { const m = db.missions.find(x => x.placeId === ${sw01Id} && x.mission === 'Q1_A_TA_SW__01_01'); m.worker = '다른기기'; m.version += 1; return m.version; }, { table: 'missions' })`);
await sleep(600);
check('다른 기기 저장(가짜 DB) 성공', otherVersion >= 3, String(otherVersion));
await setFlight('20', '');
await evaluate(`document.querySelector('#detail .mission-editor form.mission-form button.btn.primary[type=submit]').click()`);
await sleep(900);
const conflict = await evaluate(`(() => ({ panel: document.querySelector('#detail .mission-editor .mission-conflict-message')?.textContent, stillEdit: !!document.querySelector('#detail .mission-editor form.mission-form'),
  flight: [document.querySelector('#detail .mission-editor input[name="flightMin"]')?.value, document.querySelector('#detail .mission-editor input[name="flightSec"]')?.value].join('|'),
  latest: document.querySelector('#detail .mission-editor')?.textContent.includes('다른기기') }))()`);
check('충돌 시 폼 안 고정 안내 + 편집 유지 + 입력값 보존 + 최신값 표시', /다른 기기에서 먼저 저장된 기록이 있습니다/.test(conflict.panel ?? '') && conflict.stillEdit && conflict.flight === '20|' && conflict.latest === true, JSON.stringify(conflict));
await evaluate(`document.querySelector('#detail .mission-editor form.mission-form button.btn.primary[type=submit]').click()`);
await sleep(900);
const resolved = await store().then((ps) => ps.find((p) => p.name === 'SW_01').missions.find((m) => m.mission === 'Q1_A_TA_SW__01_01'));
check('다시 저장하면 성공(비행시간 20분, version 증가)', resolved?.flightTime === '20분' && resolved?.version >= 3 && resolved?.done === true, JSON.stringify(resolved));
const viewAgain = await evaluate(`({ open: !!document.querySelector('#detail dialog.mission-dialog')?.open, focus: document.activeElement?.dataset?.mission ?? null })`);
check('재저장 후 창 닫힘 + 초점은 미션 버튼', viewAgain.open === false && viewAgain.focus === 'Q1_A_TA_SW__01_01', JSON.stringify(viewAgain));

// 6. 메모가 있는 장소의 말풍선: "진행 + 메모" (SW_02에 메모를 API로 넣어 두었음)
const memoLabel = await evaluate(`(() => {
  const pins = [...document.querySelectorAll('.pin .memo-label')];
  return pins.map(l => ({ progress: l.querySelector('.memo-progress')?.textContent, text: l.querySelector('.memo-text')?.textContent }));
})()`);
check('메모 있는 장소: 0/27 + 메모 텍스트', memoLabel.some((l) => /0\s*\/\s*27/.test(l.progress ?? '') && /테스트메모/.test(l.text ?? '')), JSON.stringify(memoLabel));

// 7. 새로고침 후에도 유지 + 다른 장소 선택 시 미션 선택 해제
await b.navigate(url, 300);
await b.waitFor(`document.querySelectorAll('#place-list .group').length > 0 && document.querySelectorAll('.pin').length > 0`);
await sleep(500);
await evaluate(`__e2e.row('SW_01').click()`);
await sleep(600);
const reload = await evaluate(`(() => ({ h3: document.querySelector('#detail .missions h3')?.textContent, editor: !!document.querySelector('#detail .mission-editor'),
  done: [...document.querySelectorAll('#detail .mission-list .mission-item.done')].length }))()`);
check('새로고침 후 미션 1/34 유지, 완료 1개, 편집 폼은 닫힘', /1\s*\/\s*34/.test(reload.h3 ?? '') && reload.done === 1 && reload.editor === false, JSON.stringify(reload));

// 8. PC 폭
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 2, mobile: false });
await sleep(500);
await evaluate(`[...document.querySelectorAll('#detail .mission-list .mission-item')].find(b => b.textContent.includes('01_03')).click()`);
await sleep(400);
const overflow = await evaluate(`document.documentElement.scrollWidth > innerWidth`);
check('PC 폭 가로 넘침 없음', overflow === false);
await shot('desktop-editor');

console.log('js errors:', JSON.stringify(errors));
check('JS 오류 없음', errors.length === 0);
const fails = results.filter((r) => !r.ok).length;
console.log(`\n결과: ${results.length - fails}/${results.length} 통과`);
const fs = await import('node:fs');
fs.writeFileSync(new URL('./results/missions.json', import.meta.url), JSON.stringify({ name: 'missions', pass: results.length - fails, total: results.length, results }, null, 1));
await b.close();
process.exit(fails > 0 || errors.length > 0 ? 1 : 0);
