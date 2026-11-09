// [내보내기] 메뉴: 장소 / 미션 기록(계약 C11).
// 메뉴 두 항목·초점·키보드(↓·Esc)·바깥 누르기, 머리글 높이 그대로, 파일명, 미션 기록 CSV 머리글·행, 장소 CSV.
// 옛 csv.js(toMissionCsv 없음)에서의 동작은 브라우저가 받는 csv.js에서 그 함수를 감춰 본다(lib.mjs csvShim 'legacy').
import { MISSION_CSV_HEADER, launch, prepare, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('ux-export');
const places = [
  { name: 'SW_01', district: '태안', address: '가람면 하늘리', lat: 37.277767, lng: 126.717126, mission: 'M_01 ~ _03',
    missions: [{ mission: 'M_01', done: true, worker: '홍', flightTime: '1분', batteryNo: '1', batteryLeft: '50', version: 1 }] },
  { name: 'SW_02', district: '태안', address: '가람면 바람리', lat: 37.167923, lng: 126.815733, mission: 'N_01 ~ _02' },
  { name: 'TB_01', district: '보은', address: '보은읍', lat: 36.49, lng: 127.73, mission: '' },
];
const captureExports = `(() => {
  window.__exports = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { const url = orig(blob); window.__exports.push({ blob, url }); return url; };
  HTMLAnchorElement.prototype.click = function () { const e = window.__exports.at(-1); if (e && this.href === e.url) e.download = this.download; };
})()`;
const todayExpr = `(() => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })()`;
const splitRows = (text) => text.replace(/^﻿/, '').split('\r\n').filter((l) => l !== '');

const b = await launch('ux-export');
const ev = b.ev;
await prepare(b, { places });
await ev(captureExports);
const lastExport = () => ev(`(async () => { const e = window.__exports.at(-1); return e ? { download: e.download, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(await e.blob.arrayBuffer()) } : null; })()`);
const topbarH = () => ev(`Math.round(document.querySelector('.topbar').getBoundingClientRect().height)`);

// ── 메뉴 모양·초점 ──
const h0 = await topbarH();
await ev(`document.querySelector('#export-button').click()`); await sleep(150);
let v = await ev(`(() => {
  const m = document.querySelector('#export-menu'), r = m.getBoundingClientRect(), btn = document.querySelector('#export-button');
  return { shown: !m.hidden, items: [...m.querySelectorAll('[role=menuitem]')].map((x) => x.textContent), expanded: btn.getAttribute('aria-expanded'), popup: btn.getAttribute('aria-haspopup'),
    inside: r.left >= 0 && r.right <= innerWidth, below: r.top >= btn.getBoundingClientRect().bottom, focus: document.activeElement?.id,
    itemH: Math.min(...[...m.querySelectorAll('.menu-item')].map((x) => x.getBoundingClientRect().height)), overflowX: document.documentElement.scrollWidth > innerWidth };
})()`);
check('[내보내기] → 메뉴 두 항목 "장소 내보내기"·"미션 기록 내보내기", 첫 항목에 초점', v.shown && v.items.join('|') === '장소 내보내기|미션 기록 내보내기' && v.focus === 'export-places' && v.expanded === 'true' && v.popup === 'menu', v);
check('메뉴는 단추 아래 화면 안에 겹쳐 뜨고 머리글 높이·가로 넘침은 그대로, 항목 44px', v.inside && v.below && !v.overflowX && (await topbarH()) === h0 && v.itemH >= 44, { ...v, h0 });
await b.shot('ux-export-menu-390');

// ── 키보드: ↓로 다음 항목, Esc는 메뉴만 닫고 [내보내기]로 ──
await ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
const focus2 = await ev(`document.activeElement?.id`);
await ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(100);
v = await ev(`({ hidden: document.querySelector('#export-menu').hidden, focus: document.activeElement?.id, expanded: document.querySelector('#export-button').getAttribute('aria-expanded') })`);
check('↓ → 미션 기록 항목, Esc → 메뉴 닫힘·초점 [내보내기]', focus2 === 'export-missions' && v.hidden && v.focus === 'export-button' && v.expanded === 'false', { focus2, v });
// 메뉴 밖을 누르면 닫힘
await ev(`document.querySelector('#export-button').click()`); await sleep(100);
await ev(`document.querySelector('#search').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`); await sleep(100);
check('메뉴 밖을 누르면 닫힘', await ev(`document.querySelector('#export-menu').hidden`));

// ── 미션 기록 내보내기 ──
const today = await ev(todayExpr);
// 기대값: 같은 csv 모듈의 toMissionCsv에 서버 목록 전체를 넣은 결과
const expectedMissions = () => ev(`(async () => { const c = await import('./csv.js'); return c.toMissionCsv(__fake.store()); })()`);
await ev(`document.querySelector('#export-button').click()`); await sleep(100);
await ev(`document.querySelector('#export-missions').click()`); await sleep(200);
let exp = await lastExport();
let rows = splitRows(exp.text);
const want = await expectedMissions();
check('미션 기록 내보내기: 파일명 missions-YYYY-MM-DD.csv', exp.download === `missions-${today}.csv`, exp.download);
check('미션 기록 CSV: BOM·머리글이 계약 C11과 같음', exp.text.startsWith('﻿') && rows[0] === MISSION_CSV_HEADER, rows[0]);
check('미션 기록 CSV: 전체 장소의 미션 행(toMissionCsv 결과와 같음, 미션 5개 + 머리글)', exp.text === want && rows.length === 6, { got: rows.length, want: splitRows(want).length });

// ── 장소 내보내기 ──
await ev(`document.querySelector('#export-button').click()`); await sleep(100);
await ev(`document.querySelector('#export-places').click()`); await sleep(200);
exp = await lastExport();
rows = splitRows(exp.text);
check('장소 내보내기: 파일명 places-YYYY-MM-DD.csv, 장소 3곳 + 머리글', exp.download === `places-${today}.csv` && rows.length === 4 && /^SW_01,/.test(rows[1]) && /^TB_01,/.test(rows[3]), { download: exp.download, rows });
check('콘솔 예외 0건', b.errors.length === 0, b.errors);
await b.close();

// ── 옛 csv.js(toMissionCsv 없음): [내보내기]는 메뉴 없이 바로 장소를 내보낸다 ──
const old = await launch('ux-export-legacy', { csvShim: 'legacy' });
await prepare(old, { places });
await old.ev(captureExports);
await old.ev(`document.querySelector('#export-button').click()`);
await sleep(200);
v = await old.ev(`({ menu: !document.querySelector('#export-menu').hidden, popup: document.querySelector('#export-button').getAttribute('aria-haspopup'), download: window.__exports.at(-1)?.download ?? null })`);
const today2 = await old.ev(todayExpr);
check('toMissionCsv가 없는 csv.js: 메뉴 없이 바로 장소 내보내기(places-YYYY-MM-DD.csv)', !v.menu && v.popup === null && v.download === `places-${today2}.csv`, v);
check('옛 csv.js 판 콘솔 예외 0건', old.errors.length === 0, old.errors);
await finish(old);
