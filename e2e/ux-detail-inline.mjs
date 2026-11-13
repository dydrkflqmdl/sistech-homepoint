// 상세 정보는 고른 장소 줄 바로 아래(li.detail-slot)에 펼쳐진다(list-ui.js renderList, detail-ui.js revealSelected).
// 고른 장소 줄은 늘 패널 맨 위(아래 창 높이·상세 정보 길이·누른 자리와 상관없이), 애니메이션 없이 누른 순간 바로. 다시 그려도(원격 변경)
// 상세 정보를 떼었다 붙이지 않아 미션 기록 창(모달)·쓰던 칸 초점이 그대로. 시군을 접으면 원래 자리(목록 위)로, 닫으면 자리 없음.
// 목록 줄 스타일(.list button 등)이 상세 정보 안 버튼에 번지지 않음.
import { launch, prepare, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('ux-detail-inline');
const places = Array.from({ length: 12 }, (_, i) => ({
  name: `SW_${String(i + 1).padStart(2, '0')}`, district: '태안', address: `가람면 ${i + 1}리`, lat: 37.2 + i * 0.01, lng: 126.7 + i * 0.01, mission: 'M_01 ~ _06',
}));
places.push({ name: 'TB_01', district: '보은', address: '보은읍', lat: 36.49, lng: 127.73, mission: 'N_01 ~ _02' });

const b = await launch('ux-detail-inline', { viewport: [390, 844, true] });
const ev = b.ev;
await prepare(b, { places });
const info = (n) => ev(`(() => {
  const panel = document.querySelector('.panel'), v = panel.getBoundingClientRect(), row = __e2e.row(${JSON.stringify(n)}), d = document.querySelector('#detail');
  const r = row.getBoundingClientRect(), slot = d.parentElement;
  return { inSlot: slot?.classList.contains('detail-slot'), afterRow: !!slot?.previousElementSibling?.contains(row), slots: document.querySelectorAll('.detail-slot').length,
    rowTop: Math.round(r.top - v.top), rowVisible: r.top >= v.top && r.bottom <= v.bottom, detailTop: Math.round(d.getBoundingClientRect().top - r.bottom),
    scrollTop: Math.round(panel.scrollTop), active: document.activeElement?.id, title: document.querySelector('#detail-title')?.firstChild?.textContent ?? null };
})()`);

// ── 아래쪽 장소 누르기 ──
await ev(`__e2e.row('SW_01')`); await sleep(200);
const before = await ev(`(() => { const panel = document.querySelector('.panel'); const row = __e2e.row('SW_10'); panel.scrollTop += row.getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom + 4; return Math.round(panel.scrollTop); })()`);
await ev(`__e2e.row('SW_10').click()`); await sleep(900);
let v = await info('SW_10');
check('아래쪽 장소(SW_10) 누르기 → 상세 정보가 그 줄 바로 아래(li.detail-slot)에 펼쳐짐', v.inSlot && v.afterRow && v.slots === 1 && v.title === 'SW_10' && v.detailTop >= 0 && v.detailTop <= 20, v);
check('목록 맨 위로 튀지 않고(스크롤이 내려감) 그 줄이 패널 위쪽에 보임, 초점은 상세 제목', v.scrollTop > before && v.rowVisible && v.rowTop >= 0 && v.rowTop <= 20 && v.active === 'detail-title', { before, v });
await b.shot('ux-detail-inline-390');
const styles = await ev(`(() => { const btn = document.querySelector('#detail .route-actions .btn, #detail .btn'); const mi = document.querySelector('#detail .mission-item'); const cs = (e) => getComputedStyle(e);
  return { btnBorder: cs(btn).borderTopWidth, btnRadius: cs(btn).borderTopLeftRadius, missionBg: cs(mi).backgroundColor, missionLiBorder: cs(mi.closest('li')).borderTopWidth, missionPad: cs(mi).paddingLeft }; })()`);
check('목록 줄 스타일이 상세 정보 안에 번지지 않음(버튼 테두리·둥근 모서리, 미션 칸 사이 줄 없음, 들여쓰기 없음)', styles.btnBorder === '1px' && styles.btnRadius !== '0px' && styles.missionLiBorder === '0px' && styles.missionPad === '8px', styles);

// ── 다시 그려도 떼었다 붙이지 않음 ──
await ev(`document.querySelector('#detail .mission-item').click()`); await sleep(200);
await ev(`(() => { const i = document.querySelector('dialog.mission-dialog input[name=batteryNo1]'); i.focus(); i.value = '123'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await ev(`__fake.remoteChange((db) => { db.places.find((p) => p.name === 'SW_03').memo = '원격메모'; })`); await sleep(600);
v = await ev(`({ open: document.querySelector('dialog.mission-dialog')?.open, active: document.activeElement?.name, val: document.querySelector('dialog.mission-dialog input[name=batteryNo1]')?.value, inSlot: document.querySelector('#detail').parentElement?.classList.contains('detail-slot') })`);
check('미션 기록 창을 연 채 다른 장소가 원격으로 바뀌어 목록을 다시 그려도 창·입력값·초점 그대로', v.open && v.active === 'batteryNo1' && v.val === '123' && v.inSlot, v);
await ev(`document.querySelector('dialog.mission-dialog .mission-dialog-close').click()`); await sleep(200);
await ev(`document.querySelector('#memo-input').focus()`);
await ev(`__fake.remoteChange((db) => { db.places.find((p) => p.name === 'SW_04').memo = '원격2'; })`); await sleep(600);
check('메모 칸에 초점을 둔 채 목록을 다시 그려도 초점 그대로', (await ev(`document.activeElement?.id`)) === 'memo-input');

// ── 위쪽 장소로 옮기기, 지도 핀으로 고르기 ──
await ev(`__e2e.row('SW_02').click()`); await sleep(900);
v = await info('SW_02');
check('다른 장소(SW_02)를 누르면 상세 정보가 그 줄 아래로 옮겨 가고 자리는 하나', v.inSlot && v.afterRow && v.slots === 1 && v.title === 'SW_02' && v.rowVisible, v);

// ── 위쪽 장소의 상세 정보가 열린 채 아래 장소를 누르기(BS_8 → BS_19 증상) ──
// 위의 상세 정보가 닫히며 아래 줄이 당겨 올라가도, 누른 줄은 손가락 자리에 그대로 있고 위로 끌려 올라가지 않는다.
const tapAndWatch = (n, at) => ev(`new Promise((res) => {
  const panel = document.querySelector('.panel'), v = () => panel.getBoundingClientRect();
  const find = () => [...document.querySelectorAll('#place-list button[data-id]')].find((x) => x.querySelector('.name')?.firstChild?.textContent.trim() === ${JSON.stringify(n)});
  panel.scrollTop += find().getBoundingClientRect().top - v().top - ${at};
  const top = () => Math.round(find().getBoundingClientRect().top - v().top);
  const out = [{ t: 'before', scroll: Math.round(panel.scrollTop), row: top() }];
  find().click();
  out.push({ t: 0, scroll: Math.round(panel.scrollTop), row: top() });
  for (const t of [50, 150, 300, 600, 900]) setTimeout(() => { out.push({ t, scroll: Math.round(panel.scrollTop), row: top() }); if (t === 900) res(out); }, t);
})`);
const detailUnder = (n) => ev(`(() => { const d = document.querySelector('#detail'); return d.parentElement?.classList.contains('detail-slot') && d.parentElement.previousElementSibling?.querySelector('.name')?.firstChild?.textContent.trim() === ${JSON.stringify(n)}; })()`);
// 애니메이션 없음: 누른 그 순간(같은 틱) 이미 줄이 패널 맨 위이고, 그 뒤로 움직이지 않는다.
const instantTop = (tl) => tl.slice(1).every((x) => x.row >= 0 && x.row <= 20 && x.row === tl[1].row && x.scroll === tl[1].scroll);
let tl = await tapAndWatch('SW_08', 160);
check('위(SW_02) 상세 정보가 열린 채 화면 위쪽의 SW_08 누르기 → 누른 순간 바로 줄이 패널 맨 위(애니메이션 없음), 그 뒤 움직이지 않음',
  instantTop(tl) && (await detailUnder('SW_08')), tl);
const panelH = await ev(`document.querySelector('.panel').getBoundingClientRect().height`);
tl = await tapAndWatch('SW_11', Math.round(panelH * 0.75));
check('위(SW_08) 상세 정보가 열린 채 화면 아래쪽의 SW_11 누르기 → 누른 순간 바로 줄이 패널 맨 위(위로 튀는 움직임 없음)',
  instantTop(tl) && (await detailUnder('SW_11')), tl);
// 아래 창 높이(바 맨 위·기본·맨 아래) × 상세 정보 길이(미션 1개·34개) × 누른 자리(위쪽·아래쪽)와 상관없이 같은 결과(PB_06 증상)
await ev(`document.querySelector('#detail .icon-btn').click()`); await sleep(300);
await ev(`__fake.remoteChange((db) => { db.places.find((p) => p.name === 'SW_05').mission = 'S_01'; db.places.find((p) => p.name === 'SW_06').mission = 'L_01 ~ _34'; })`); await sleep(500);
const results = [];
for (const [sheet, keyName] of [['바 맨 위', 'Home'], ['기본', 'Enter'], ['바 맨 아래', 'End']]) {
  await ev(`document.querySelector('#sheet-handle').dispatchEvent(new KeyboardEvent('keydown', { key: '${keyName}', bubbles: true, cancelable: true }))`); await sleep(100);
  for (const name of ['SW_05', 'SW_06']) {
    for (const [where, at] of [['위쪽', 40], ['아래쪽', null]]) {
      await ev(`document.querySelector('#detail:not([hidden]) .icon-btn')?.click()`); await sleep(250);
      const ph = await ev(`document.querySelector('.panel').getBoundingClientRect().height`);
      const t = await tapAndWatch(name, at ?? Math.max(0, Math.round(ph - 80)));
      results.push({ sheet, name, where, panelH: Math.round(ph), before: t[0].row, end: t.at(-1).row, ok: instantTop(t) });
    }
  }
}
check('바 높이 3가지 × 상세 정보 짧음(미션 1개)·김(34개) × 누른 자리 위·아래 → 모두 누른 순간 바로 줄이 패널 맨 위(같은 규칙)',
  results.every((r) => r.ok), results);
await ev(`document.querySelector('#sheet-handle').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`); await sleep(100);
await ev(`__e2e.row('SW_02').click()`); await sleep(900);
await ev(`document.querySelector('.panel').scrollTop = 0`); await sleep(100);
await ev(`(() => { const m = document.querySelector('.pin[title="SW_12"]'); m.focus(); for (const t of ['keydown', 'keypress', 'keyup']) m.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', keyCode: 13, bubbles: true })); })()`); await sleep(900);
v = await info('SW_12');
check('지도 핀(SW_12)으로 고르면 화면 밖에 있던 그 줄로 스크롤되고 바로 아래에 상세 정보', v.inSlot && v.afterRow && v.title === 'SW_12' && v.rowVisible && v.rowTop <= 20, v);

// ── 시군을 접으면 원래 자리, 닫으면 자리 없음 ──
await ev(`document.querySelector('#place-list .group-head[data-district="태안"]').click()`); await sleep(300);
v = await ev(`({ home: document.querySelector('#detail').nextElementSibling?.classList.contains('filters') ?? false, hidden: document.querySelector('#detail').hidden, slots: document.querySelectorAll('.detail-slot').length })`);
check('고른 장소의 시군을 접으면 상세 정보는 원래 자리(검색 칸 위)에 보임', v.home && !v.hidden && v.slots === 0, v);
await ev(`document.querySelector('#place-list .group-head[data-district="태안"]').click()`); await sleep(300);
check('다시 펼치면 그 줄 아래로 돌아감', (await info('SW_12')).inSlot);
await ev(`document.querySelector('#detail .icon-btn').click()`); await sleep(300);
v = await ev(`({ home: document.querySelector('#detail').nextElementSibling?.classList.contains('filters') ?? false, hidden: document.querySelector('#detail').hidden, slots: document.querySelectorAll('.detail-slot').length, active: document.activeElement?.dataset?.id ?? document.activeElement?.id })`);
check('× 닫기 → 상세 정보 숨고 원래 자리로, 목록에 빈 자리 없음', v.home && v.hidden && v.slots === 0, v);

// ── 1280 ──
await b.setViewport(1280, 800, false); await sleep(300);
await ev(`__e2e.row('SW_11').click()`); await sleep(900);
v = await info('SW_11');
check('1280: 왼쪽 목록에서도 그 줄 바로 아래에 상세 정보', v.inSlot && v.afterRow && v.rowVisible, v);
await b.shot('ux-detail-inline-1280');
check('콘솔 예외 0건', b.errors.length === 0, b.errors);
await finish(b);
