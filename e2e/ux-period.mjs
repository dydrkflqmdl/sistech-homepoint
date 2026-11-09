// 시기(계약 C10)와 미션 기록 내보내기(계약 C11).
// 시기 칩(기본은 최신·기억·전체), 시기가 목록·칩 수·지도 핀·검색에 모두 적용되는지, 상세 배지, 시기를 바꾸면 상세 닫힘,
// 가져오기 확인창의 "시기별 새 장소", 가져온 뒤 자동 선택, [내보내기] 메뉴(장소 / 미션 기록, 시기 반영 파일명·내용).
// csv.js에 시기·toMissionCsv가 아직 없는 판에서도 돌도록 브라우저가 받는 csv.js에 계약 모양을 덧붙인다(lib.mjs csvShim).
import path from 'node:path';
import { FIXTURES, MISSION_CSV_HEADER, launch, prepare, q1Rows, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('ux-period');
const PERIOD_CSV = path.join(FIXTURES, 'period-q3.csv');
// Q1 3곳, Q2 2곳. SW_01은 두 시기에 같은 이름·좌표로 있다(다른 장소).
const places = [
  { name: 'SW_01', period: 'Q1', district: '태안', address: '가람면 하늘리', lat: 37.277767, lng: 126.717126, mission: 'M_01 ~ _03',
    missions: [{ mission: 'M_01', done: true, worker: '홍', flightTime: '1분', batteryNo: '1', batteryLeft: '50', version: 1 }] },
  { name: 'SW_02', period: 'Q1', district: '태안', address: '가람면 바람리', lat: 37.167923, lng: 126.815733, mission: 'N_01 ~ _02' },
  { name: 'TB_01', period: 'Q1', district: '보은', address: '보은읍', lat: 36.49, lng: 127.73, mission: '' },
  { name: 'SW_01', period: 'Q2', district: '태안', address: '가람면 하늘리', lat: 37.277767, lng: 126.717126, mission: 'M_01 ~ _03',
    missions: [{ mission: 'M_02', done: true, worker: '김', flightTime: '2분', batteryNo: '2', batteryLeft: '40', version: 1 }] },
  { name: 'SW_03', period: 'Q2', district: '태안', address: '가람면 바람리', lat: 37.2, lng: 126.7, mission: 'N_01 ~ _02' },
];

const b = await launch('ux-period', { csvShim: 'contract' });
const ev = b.ev;
const view = () => ev(`(() => {
  const chips = [...document.querySelectorAll('#period-filters .chip')];
  return {
    shown: !document.querySelector('#period-filters').hidden && document.querySelector('#period-filters').offsetParent !== null,
    labels: chips.map((c) => c.firstChild.textContent),
    pressed: chips.filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.firstChild.textContent),
    counts: chips.map((c) => c.querySelector('.count').textContent),
    summary: document.querySelector('#list-summary').textContent,
    allChip: document.querySelector('#color-filters [data-all] .count')?.textContent ?? null,
    pins: document.querySelectorAll('.pin').length,
    groups: [...document.querySelectorAll('#place-list .group-head')].map((g) => g.dataset.district + ':' + g.querySelector('.group-count').textContent),
    stored: localStorage.getItem('period'),
  };
})()`);
const clickPeriod = async (label) => {
  await ev(`[...document.querySelectorAll('#period-filters .chip')].find((c) => c.firstChild.textContent === ${JSON.stringify(label)}).click()`);
  await sleep(200);
};
const rowsWithTags = () => ev(`(() => { __e2e.openAll(); return [...document.querySelectorAll('#place-list button[data-id]')].map((b) => (b.querySelector('.name').firstChild.textContent.trim()) + '/' + (b.querySelector('.period-tag')?.textContent ?? '')); })()`);
const search = async (q) => {
  await ev(`(() => { const s = document.querySelector('#search'); s.value = ${JSON.stringify(q)}; s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await sleep(200);
};

// ── 시기 칩: 기본은 최신(Q2), 시기가 목록·칩 수·지도 핀에 적용 ──
await prepare(b, { places });
let v = await view();
check('시기 칩 줄이 보이고 [전체][Q2][Q1] 순서(내림차순), 수 5·2·3', v.shown && v.labels.join() === '전체,Q2,Q1' && v.counts.join() === '5,2,3', v);
check('기본 선택은 가장 최신(Q2), 아직 기억한 값 없음', v.pressed.join() === 'Q2' && v.stored === null, v);
check('Q2: 목록 요약·상태 칩 [전체] 수·지도 핀·시군 묶음 수가 모두 2곳', v.summary === '장소 2개' && v.allChip === '2' && v.pins === 2 && v.groups.join() === '태안:2미션', v);
await b.shot('ux-period-q2-390');

await clickPeriod('Q1');
v = await view();
check('[Q1]을 누른 시기 칩에 초점', await ev(`Boolean(document.activeElement?.closest('#period-filters')) && document.activeElement.getAttribute('aria-pressed') === 'true'`));
check('[Q1] → 3곳(요약·칩 수·핀·시군 묶음), 기억 {"value":"Q1"}', v.pressed.join() === 'Q1' && v.summary === '장소 3개' && v.allChip === '3' && v.pins === 3 && v.groups.join() === '태안:2미션,보은:1미션' && v.stored === '{"value":"Q1"}', v);
check('[Q1] 보기에서는 목록 줄에 시기 표시 없음', (await rowsWithTags()).every((r) => r.endsWith('/')), await rowsWithTags());
check('시기 칩 누르는 자리 44px 이상', await ev(`[...document.querySelectorAll('#period-filters .chip')].every((c) => c.getBoundingClientRect().height >= 44)`));

// 새로고침해도 기억
await b.navigate(); await b.waitFor(`document.querySelectorAll('#period-filters .chip').length > 0`, 5000); await sleep(300);
v = await view();
check('새로고침 → 고른 시기(Q1) 그대로', v.pressed.join() === 'Q1' && v.summary === '장소 3개' && v.pins === 3, v);

// 전체: 모든 장소, 같은 이름이 두 시기에 있으니 목록 줄에 시기를 작게 붙인다
await clickPeriod('전체');
v = await view();
check('[전체] → 5곳·핀 5개, 기억 {"all":true}', v.pressed.join() === '전체' && v.summary === '장소 5개' && v.allChip === '5' && v.pins === 5 && v.stored === '{"all":true}', v);
const tagged = await rowsWithTags();
check('[전체] 목록 줄에 시기 표시(SW_01/Q1, SW_01/Q2)', tagged.includes('SW_01/Q1') && tagged.includes('SW_01/Q2') && tagged.length === 5 && tagged.every((r) => /\/Q[12]$/.test(r)), tagged);

// 검색도 시기 안에서
await search('SW_01');
v = await view();
check('[전체]에서 "SW_01" 검색 → 2곳(두 시기)', v.summary === '2개 / 전체 5개', v);
await clickPeriod('Q2');
v = await view();
check('[Q2]로 바꾸면 검색 결과 1곳·핀 1개', v.summary === '1개 / 전체 2개' && v.pins === 1, v);
await search('');

// ── 상세 배지, 시기를 바꾸면 그 시기에 없는 장소의 상세 정보는 닫힘 ──
await ev(`__e2e.row('SW_01').click()`); await sleep(300);
v = await ev(`({ open: !document.querySelector('#detail').hidden, title: document.querySelector('#detail-title').firstChild.textContent, badge: document.querySelector('#detail-title .period-badge')?.textContent ?? null })`);
check('상세 정보 제목 옆에 시기 배지(Q2)', v.open && v.title === 'SW_01' && v.badge === 'Q2', v);
await clickPeriod('Q1');
v = await ev(`({ open: !document.querySelector('#detail').hidden, pressed: document.querySelector('#period-filters [aria-pressed="true"]')?.firstChild.textContent })`);
check('[Q1]로 바꾸면 Q2 장소의 상세 정보는 닫힘', !v.open && v.pressed === 'Q1', v);
// 전체로 바꿀 때는 고른 장소가 그대로 보이므로 닫지 않는다
await ev(`__e2e.row('TB_01').click()`); await sleep(300);
await clickPeriod('전체');
v = await ev(`({ open: !document.querySelector('#detail').hidden, title: document.querySelector('#detail-title')?.firstChild.textContent, badge: document.querySelector('#detail-title .period-badge')?.textContent })`);
check('[전체]로 바꾸면 상세 정보는 그대로(TB_01, 배지 Q1)', v.open && v.title === 'TB_01' && v.badge === 'Q1', v);
await ev(`document.querySelector('#detail .icon-btn').click()`); await sleep(150);

// ── [내보내기] 메뉴: 장소 / 미션 기록, 시기 반영 ──
await clickPeriod('Q2');
await ev(`(() => {
  window.__exports = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { const url = orig(blob); window.__exports.push({ blob, url }); return url; };
  HTMLAnchorElement.prototype.click = function () { const e = window.__exports.at(-1); if (e && this.href === e.url) e.download = this.download; };
})()`);
const lastExport = () => ev(`(async () => { const e = window.__exports.at(-1); return e ? { download: e.download, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(await e.blob.arrayBuffer()) } : null; })()`);
const topbarH = () => ev(`Math.round(document.querySelector('.topbar').getBoundingClientRect().height)`);
const h0 = await topbarH();
await ev(`document.querySelector('#export-button').click()`); await sleep(150);
v = await ev(`(() => {
  const m = document.querySelector('#export-menu'), r = m.getBoundingClientRect(), btn = document.querySelector('#export-button');
  return { shown: !m.hidden, items: [...m.querySelectorAll('[role=menuitem]')].map((x) => x.textContent), expanded: btn.getAttribute('aria-expanded'), popup: btn.getAttribute('aria-haspopup'),
    inside: r.left >= 0 && r.right <= innerWidth, below: r.top >= btn.getBoundingClientRect().bottom, focus: document.activeElement?.id,
    itemH: Math.min(...[...m.querySelectorAll('.menu-item')].map((x) => x.getBoundingClientRect().height)), overflowX: document.documentElement.scrollWidth > innerWidth };
})()`);
check('[내보내기] → 메뉴 두 항목 "장소 내보내기(Q2)"·"미션 기록 내보내기(Q2)", 첫 항목에 초점', v.shown && v.items.join('|') === '장소 내보내기(Q2)|미션 기록 내보내기(Q2)' && v.focus === 'export-places' && v.expanded === 'true' && v.popup === 'menu', v);
check('메뉴는 단추 아래 화면 안에 겹쳐 뜨고 머리글 높이·가로 넘침은 그대로, 항목 44px', v.inside && v.below && !v.overflowX && (await topbarH()) === h0 && v.itemH >= 44, { ...v, h0 });
await b.shot('ux-period-export-menu-390');
// 키보드: ↓로 다음 항목, Esc는 메뉴만 닫고 [내보내기]로
await ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
const focus2 = await ev(`document.activeElement?.id`);
await ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(100);
v = await ev(`({ hidden: document.querySelector('#export-menu').hidden, focus: document.activeElement?.id, expanded: document.querySelector('#export-button').getAttribute('aria-expanded') })`);
check('↓ → 미션 기록 항목, Esc → 메뉴 닫힘·초점 [내보내기]', focus2 === 'export-missions' && v.hidden && v.focus === 'export-button' && v.expanded === 'false', { focus2, v });
// 메뉴 밖을 누르면 닫힘
await ev(`document.querySelector('#export-button').click()`); await sleep(100);
await ev(`document.querySelector('#search').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`); await sleep(100);
check('메뉴 밖을 누르면 닫힘', await ev(`document.querySelector('#export-menu').hidden`));

const today = await ev(`(() => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })()`);
// 기대값: 같은 csv 모듈의 toMissionCsv에 Q2 장소(서버 목록)를 넣은 결과
const expectedMissions = (period) => ev(`(async () => { const c = await import('./csv.js'); const all = __fake.store(); return c.toMissionCsv(${period === null ? 'all' : `all.filter((p) => p.period === ${JSON.stringify(period)})`}); })()`);
const splitRows = (text) => text.replace(/^﻿/, '').split('\r\n').filter((l) => l !== '');

await ev(`document.querySelector('#export-button').click()`); await sleep(100);
await ev(`document.querySelector('#export-missions').click()`); await sleep(200);
let exp = await lastExport();
let rows = splitRows(exp.text);
let want = splitRows(await expectedMissions('Q2'));
check('미션 기록 내보내기(Q2): 파일명 missions-Q2-YYYY-MM-DD.csv', exp.download === `missions-Q2-${today}.csv`, exp.download);
check('미션 기록 CSV: BOM·머리글이 계약 C11과 같음', exp.text.startsWith('﻿') && rows[0] === MISSION_CSV_HEADER, rows[0]);
check('미션 기록 CSV: Q2 장소만(행 수가 Q2 기대값과 같고 모두 Q2)', rows.length === want.length && rows.length > 1 && rows.slice(1).every((r) => r.startsWith('Q2,')) && exp.text === (await expectedMissions('Q2')), { got: rows.length, want: want.length });

await ev(`document.querySelector('#export-button').click()`); await sleep(100);
await ev(`document.querySelector('#export-places').click()`); await sleep(200);
exp = await lastExport();
rows = splitRows(exp.text);
check('장소 내보내기(Q2): 파일명 places-Q2-YYYY-MM-DD.csv, Q2 장소 2곳 + 머리글', exp.download === `places-Q2-${today}.csv` && rows.length === 3 && rows.slice(1).every((r) => /^SW_0[13],/.test(r)), { download: exp.download, rows });

await clickPeriod('전체');
await ev(`document.querySelector('#export-button').click()`); await sleep(100);
const items = await ev(`[...document.querySelectorAll('#export-menu .menu-item')].map((x) => x.textContent).join('|')`);
await ev(`document.querySelector('#export-missions').click()`); await sleep(200);
exp = await lastExport();
want = splitRows(await expectedMissions(null));
check('[전체]: 메뉴 문구 "(전체)", 파일명 missions-YYYY-MM-DD.csv, 전체 장소의 미션 행', items === '장소 내보내기(전체)|미션 기록 내보내기(전체)' && exp.download === `missions-${today}.csv` && splitRows(exp.text).length === want.length, { items, download: exp.download });

// ── 가져오기: 시기별 새 장소 수, 가져온 뒤 최신 시기 자동 선택 ──
await prepare(b, { places });
await ev(`__e2e.row('SW_01').click()`); await sleep(300);
const before = await ev(`__fake.store().length`);
await b.setFiles('#csv-input', [PERIOD_CSV]); await sleep(200);
await ev(`document.querySelector('#import-panel .btn.primary').click()`);
await b.waitFor(`!!document.querySelector('#import-panel .import-review')`, 5000);
const review = await ev(`document.querySelector('#import-panel .review-periods')?.textContent.replace(/\\s+/g, ' ') ?? null`);
check('확인창: "시기별 새 장소 · Q3 새 장소 3개 · Q2 새 장소 1개"(이미 있는 Q2 SW_03은 빼고 셈)', review !== null && /Q3 새 장소 3개.*Q2 새 장소 1개/.test(review) && !/Q1/.test(review), review);
check('확인창: 시기가 같은 장소만 같은 장소로 봄 → 미션명 변경·근접 중복 없음', await ev(`!document.querySelector('#import-panel .review-changes') && !document.querySelector('#import-panel .review-near')`));
await ev(`document.querySelector('#import-review-continue').click()`);
await b.waitFor(`!/가져오는 중/.test(document.querySelector('#import-panel')?.textContent ?? '') && !!document.querySelector('#period-filters [data-period="Q3"]')`, 8000);
await sleep(300);
v = await view();
const store = await ev(`__fake.store()`);
check('가져온 뒤 DB: 새 장소 4곳(Q3 3 + Q2 1), Q3 SW_01은 Q2 SW_01과 다른 장소', store.length === before + 4 && store.filter((p) => p.name === 'SW_01').map((p) => p.period).sort().join() === 'Q1,Q2,Q3', store.map((p) => `${p.name}/${p.period}`));
check('가져온 파일의 최신 시기(Q3)를 자동 선택·기억, 핀 3개', v.labels.join() === '전체,Q3,Q2,Q1' && v.pressed.join() === 'Q3' && v.stored === '{"value":"Q3"}' && v.summary === '장소 3개' && v.pins === 3, v);
check('열어 두었던 Q2 장소의 상세 정보는 닫힘', await ev(`document.querySelector('#detail').hidden`));

// ── 시기가 없는 데이터: 칩 줄 없음(예전 화면) ──
await prepare(b, { rows: await q1Rows() });
v = await view();
check('시기가 모두 빈 데이터 → 시기 칩 줄 숨김, 목록은 전체', !v.shown && v.labels.length === 0 && /^장소 \d+개$/.test(v.summary), v);
await ev(`document.querySelector('#export-button').click()`); await sleep(100);
check('시기가 없으면 메뉴 문구에 시기 표시 없음', (await ev(`[...document.querySelectorAll('#export-menu .menu-item')].map((x) => x.textContent).join('|')`)) === '장소 내보내기|미션 기록 내보내기');
await ev(`document.querySelector('#export-button').click()`);

// 시기가 빈 장소가 섞여 있으면 맨 뒤에 [시기 없음]
await prepare(b, { places: [...places, { name: 'OLD_01', district: '서산', address: '대산읍', lat: 36.9, lng: 126.4, mission: '' }] });
await clickPeriod('시기 없음');
v = await view();
check('시기가 빈 장소가 섞이면 [시기 없음] 칩(맨 뒤)으로 고를 수 있음', v.labels.join() === '전체,Q2,Q1,시기 없음' && v.summary === '장소 1개' && v.pins === 1, v);

check('콘솔 예외 0건', b.errors.length === 0, b.errors);
await b.close();

// ── 옛 csv.js(toMissionCsv 없음): [내보내기]는 메뉴 없이 바로 장소를 내보낸다 ──
const old = await launch('ux-period-legacy', { csvShim: 'legacy' });
await prepare(old, { places });
await old.ev(`(() => {
  window.__exports = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { const url = orig(blob); window.__exports.push({ blob, url }); return url; };
  HTMLAnchorElement.prototype.click = function () { const e = window.__exports.at(-1); if (e && this.href === e.url) e.download = this.download; };
  document.querySelector('#export-button').click();
})()`);
await sleep(200);
v = await old.ev(`({ menu: !document.querySelector('#export-menu').hidden, popup: document.querySelector('#export-button').getAttribute('aria-haspopup'), download: window.__exports.at(-1)?.download ?? null })`);
const today2 = await old.ev(`(() => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })()`);
check('toMissionCsv가 없는 csv.js: 메뉴 없이 바로 장소 내보내기(시기 Q2 반영 파일명)', !v.menu && v.popup === null && v.download === `places-Q2-${today2}.csv`, v);
check('옛 csv.js 판 콘솔 예외 0건', old.errors.length === 0, old.errors);
await finish(old);
