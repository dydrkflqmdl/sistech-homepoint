// B-7 화면 성능: 검색 150ms 디바운스 + 한글 조합(IME) 중 무시, 접힌 시군은 줄 DOM을 만들지 않음,
// 검색 자동 펼침은 결과 100곳 이하일 때만, 핀은 바뀐 것만 고침(장소를 골라도 전체를 다시 그리지 않음).
import { launch, prepare, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('ux-perf');
const b = await launch('ux-perf');
const ev = b.ev;

// 12개 시군 × 100곳 = 1,200곳. 이름은 P0001…, 시군 D01…D12. 몇 곳만 미션을 둔다.
const places = Array.from({ length: 1200 }, (_, i) => ({
  name: `P${String(i + 1).padStart(4, '0')}`,
  district: `D${String((i % 12) + 1).padStart(2, '0')}`,
  address: `주소 ${i + 1}`,
  lat: 35 + (i % 40) * 0.05,
  lng: 126.5 + Math.floor(i / 40) * 0.05,
  mission: i < 3 ? 'M_01 ~ _02' : '',
}));
await prepare(b, { places });
await b.waitFor(`document.querySelectorAll('.pin').length === 1200`, 8000);

// 목록을 다시 그린 횟수: #place-list의 자식을 통째로 바꾼 횟수로 센다.
await ev(`(() => { window.__listRenders = 0; new MutationObserver((ms) => { if (ms.some((m) => m.target.id === 'place-list' && m.type === 'childList')) window.__listRenders++; }).observe(document.querySelector('#place-list'), { childList: true }); })()`);
const renders = () => ev(`window.__listRenders`);

let v = await ev(`({ heads: document.querySelectorAll('#place-list .group-head').length, rows: document.querySelectorAll('#place-list button[data-id]').length, summary: document.querySelector('#list-summary').textContent })`);
check('1,200곳·12개 시군: 처음엔 시군 머리 12개만, 장소 줄 DOM은 0개', v.heads === 12 && v.rows === 0 && v.summary === '장소 1200개', v);
await ev(`document.querySelector('#place-list .group-head').click()`); await sleep(100);
v = await ev(`({ rows: document.querySelectorAll('#place-list button[data-id]').length, open: document.querySelectorAll('#place-list .group-head[aria-expanded="true"]').length })`);
check('시군 하나를 펼치면 그 시군의 100줄만 만든다', v.rows === 100 && v.open === 1, v);
await ev(`document.querySelector('#place-list .group-head').click()`); await sleep(100);

// ── 검색 150ms 디바운스 ──
const typeSearch = (value, composing = false) => ev(`(() => { const s = document.querySelector('#search'); s.value = ${JSON.stringify(value)};
  s.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: ${composing} })); })()`);
let r0 = await renders();
await typeSearch('P'); await sleep(40);
await typeSearch('P0'); await sleep(40);
await typeSearch('P00'); await sleep(40);
await typeSearch('P001');
await sleep(80);
const during = (await renders()) - r0;
await sleep(200);
v = await ev(`({ summary: document.querySelector('#list-summary').textContent, rows: document.querySelectorAll('#place-list button[data-id]').length })`);
check('연달아 친 4글자 동안 목록을 다시 그리지 않고(0번), 멈춘 뒤 150ms에 한 번만 그림', during === 0 && (await renders()) - r0 === 1 && v.summary === '10개 / 전체 1200개', { during, total: (await renders()) - r0, v });
check('검색 결과 10곳(100곳 이하) → 맞는 시군을 저절로 펼쳐 10줄', v.rows === 10, v);

// Enter(키보드 [검색])는 기다리지 않고 바로
r0 = await renders();
await ev(`(() => { const s = document.querySelector('#search'); s.value = 'P0011'; s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
check('Enter는 기다리지 않고 바로 거름', (await renders()) - r0 === 1 && (await ev(`document.querySelector('#list-summary').textContent`)) === '1개 / 전체 1200개');
await sleep(250);

// ── IME 조합 중 무시 ──
r0 = await renders();
await ev(`document.querySelector('#search').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))`);
await typeSearch('주', true); await sleep(60);
await typeSearch('주소', true);
await sleep(400);
const composing = (await renders()) - r0;
await ev(`(() => { const s = document.querySelector('#search'); s.value = '주소 1'; s.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '1' })); })()`);
await sleep(300);
check('한글 조합 중(isComposing)에는 거르지 않고, 조합이 끝나면 한 번 거름', composing === 0 && (await renders()) - r0 === 1 && /전체 1200개/.test(await ev(`document.querySelector('#list-summary').textContent`)), { composing, after: (await renders()) - r0 });

// ── 결과가 100곳보다 많으면 저절로 펼치지 않음 ──
await typeSearch('P0'); await sleep(300);
v = await ev(`({ summary: document.querySelector('#list-summary').textContent, rows: document.querySelectorAll('#place-list button[data-id]').length, open: document.querySelectorAll('#place-list .group-head[aria-expanded="true"]').length })`);
check('검색 결과 999곳(100곳 초과) → 시군을 저절로 펼치지 않아 줄 DOM 0개', v.summary === '999개 / 전체 1200개' && v.rows === 0 && v.open === 0, v);
await typeSearch(''); await sleep(300);

// ── 핀: 장소를 골라도 바뀐 핀만 고친다 ──
await ev(`(() => {
  window.__pinsBefore = new Map([...document.querySelectorAll('.pin')].map((p) => [p.dataset.id, p]));
  window.__pinTouched = new Set();
  new MutationObserver((ms) => { for (const m of ms) { const pin = (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.('.pin'); if (pin) window.__pinTouched.add(pin.dataset.id); } })
    .observe(document.querySelector('.fake-kakao-pane'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-label'] });
})()`);
await ev(`__e2e.row('P0005').click()`); await sleep(300);
let touched = await ev(`[...window.__pinTouched]`);
check('장소 하나를 고르면 그 핀 하나만 고침(1,200개 중 1개)', touched.length === 1 && touched[0] === '5', touched);
await ev(`window.__pinTouched.clear()`);
await ev(`__e2e.row('P0006').click()`); await sleep(300);
touched = (await ev(`[...window.__pinTouched]`)).sort();
check('다른 장소로 옮기면 앞서 고른 핀과 새 핀 둘만 고침', touched.join() === '5,6', touched);
check('핀 요소는 새로 만들지 않고 그대로(1,200개 모두 같은 요소)', await ev(`[...document.querySelectorAll('.pin')].every((p) => window.__pinsBefore.get(p.dataset.id) === p) && document.querySelectorAll('.pin').length === 1200`));
await ev(`window.__pinTouched.clear()`);
await ev(`__fake.remoteChange((db) => { db.places.find((p) => p.name === 'P0100').memo = '원격'; })`);
await sleep(700);
touched = await ev(`[...window.__pinTouched]`);
check('다른 기기가 한 곳을 바꾸면 그 핀만 고침', touched.join() === '100', touched);

check('콘솔 오류·예외 0건', b.errors.length === 0, b.errors);
await finish(b);
