// 휴대폰 아래 창 높이 조절 바(sheet-ui.js, map-ui.js resizeMapKeepingTop).
// 390: 바는 지도와 아래 창 사이(role=separator, 기본 지도 42%). 실제 포인터로 끌면 끄는 동안 지도 칸은 아래 끝까지 늘어난 채
// 아래 창이 덮으며 움직이고(지도 다시 그리기 1번만), 손을 떼면 지도 칸이 바 위 끝까지로 맞춰지며(다시 그리기 1번) 보이던 지도는 제자리.
// 최소(지도 72px·창 160px), 새로고침해도 기억, 두 번 누르기·Enter로 기본, 키보드 ↑↓·Home·End. 1280에서는 바 없음.
import { launch, prepare, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('ux-sheet');
const places = Array.from({ length: 6 }, (_, i) => ({ name: `SW_0${i + 1}`, district: '태안', address: `가람면 ${i + 1}리`, lat: 37.2 + i * 0.01, lng: 126.7 + i * 0.01, mission: 'M_01 ~ _03' }));

const b = await launch('ux-sheet', { viewport: [390, 844, true] });
const ev = b.ev;
await prepare(b, { places });
await ev(`localStorage.removeItem('sheetMapRatio')`);
await prepare(b, { places });

const geo = `(() => {
  const r = (s) => document.querySelector(s).getBoundingClientRect();
  const L = r('.layout'), M = r('#map-area'), H = r('#sheet-handle'), P = r('.panel');
  const map = window.__kakaoMaps?.[0];
  return { layoutH: Math.round(L.height), mapH: Math.round(M.height), handleTop: Math.round(H.top - L.top), handleH: Math.round(H.height), panelTop: Math.round(P.top - L.top), panelBottom: Math.round(P.bottom - L.top),
    dragging: document.querySelector('.app').classList.contains('sheet-dragging'), now: document.querySelector('#sheet-handle').getAttribute('aria-valuenow'),
    relayouts: map ? map.__calls.filter((c) => c[0] === 'relayout').length : null, stored: localStorage.getItem('sheetMapRatio') };
})()`;
// 지도 칸 위쪽 한 점(가운데 x, y=40)에 있던 위경도가 크기를 바꾼 뒤에도 같은 칸 좌표에 있는지(보이던 지도가 제자리인지)
const pinTop = `(() => { const m = window.__kakaoMaps[0], p = m.getProjection(); window.__probe = p.coordsFromContainerPoint(new kakao.maps.Point(195, 40)); return true; })()`;
const probeY = `(() => { const m = window.__kakaoMaps[0]; return Math.round(m.getProjection().containerPointFromCoords(window.__probe).y); })()`;

let v = await ev(geo);
check('390: 바는 지도 바로 아래·아래 창 바로 위(28px), 지도 기본 42%, role=separator', await ev(`document.querySelector('#sheet-handle').getAttribute('role') === 'separator'`) &&
  v.handleTop === v.mapH && v.handleH === 28 && v.panelTop === v.mapH + 28 && v.panelBottom === v.layoutH && Math.abs(v.mapH - Math.round(v.layoutH * 0.42)) <= 1 && v.now === '42', v);
await b.shot('ux-sheet-default-390');

// ── 실제 포인터로 끌기(위로 200px) ──
const mouse = (type, x, y) => b.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });
const hb = await ev(`(() => { const r = document.querySelector('#sheet-handle').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
await ev(pinTop);
const y0 = await ev(probeY);
const before = await ev(geo);
await mouse('mousePressed', hb.x, hb.y);
for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', hb.x, hb.y - i * 20); await sleep(20); }
await sleep(80);
v = await ev(geo);
const yDrag = await ev(probeY);
check('끄는 동안: 지도 칸은 아래 끝까지(덮는 방식), 바·아래 창이 손가락을 따라 200px 위로', v.dragging && v.mapH === v.layoutH && Math.abs(v.handleTop - (before.handleTop - 200)) <= 2 && v.panelTop === v.handleTop + 28, { before, v });
check('끄는 동안 지도 다시 그리기는 시작할 때 1번뿐, 보이던 지도는 제자리', v.relayouts - before.relayouts <= 2 && Math.abs(yDrag - y0) <= 1, { relayouts: [before.relayouts, v.relayouts], y0, yDrag });
await b.shot('ux-sheet-dragging-390');
const mid = await ev(geo);
await mouse('mouseReleased', hb.x, hb.y - 200);
await sleep(150);
v = await ev(geo);
const yEnd = await ev(probeY);
check('손을 떼면: 지도 칸이 바 위 끝까지로 맞춰짐(로고가 창에 안 가려짐), 바 위치 그대로', !v.dragging && v.mapH === v.handleTop && Math.abs(v.handleTop - mid.handleTop) <= 1 && v.panelTop === v.handleTop + 28 && v.panelBottom === v.layoutH, { mid, v });
check('손을 뗄 때도 다시 그리기 한 번, 보이던 지도는 제자리', v.relayouts - mid.relayouts >= 1 && Math.abs(yEnd - y0) <= 1, { relayouts: [mid.relayouts, v.relayouts], y0, yEnd });
check('정한 높이는 비율로 기억(localStorage)', Math.abs(Number(v.stored) - v.mapH / v.layoutH) < 0.01 && v.now === String(Math.round((v.mapH / v.layoutH) * 100)), v);
await b.shot('ux-sheet-after-390');

// 새로고침해도 그대로
const keep = v.mapH;
await b.navigate(await ev(`location.href`), 300);
await b.waitFor(`!document.querySelector('.app').hidden && document.querySelectorAll('#place-list .group').length > 0`, 5000);
v = await ev(geo);
check('새로고침해도 같은 높이', Math.abs(v.mapH - keep) <= 1, { keep, v });

// ── 끝까지: 지도 최소 72px, 창 최소 160px ──
const drag = async (dy) => {
  const h = await ev(`(() => { const r = document.querySelector('#sheet-handle').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await mouse('mousePressed', h.x, h.y);
  const n = 8;
  for (let i = 1; i <= n; i++) { await mouse('mouseMoved', h.x, Math.max(1, Math.min(843, h.y + (dy * i) / n))); await sleep(16); }
  await mouse('mouseReleased', h.x, Math.max(1, Math.min(843, h.y + dy)));
  await sleep(150);
  return ev(geo);
};
v = await drag(-900);
check('위로 끝까지 → 지도 최소 72px', v.mapH === 72 && v.handleTop === 72, v);
v = await drag(900);
check('아래로 끝까지 → 아래 창 최소 160px(바 포함)', v.layoutH - v.handleTop === 160 && v.mapH === v.handleTop, v);

// ── 두 번 누르기 → 기본 ──
const h2 = await ev(`(() => { const r = document.querySelector('#sheet-handle').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
for (let i = 0; i < 2; i++) { await mouse('mousePressed', h2.x, h2.y); await mouse('mouseReleased', h2.x, h2.y); await sleep(60); }
await sleep(150);
v = await ev(geo);
check('바를 두 번 누르면 기본(지도 42%)', Math.abs(v.mapH - Math.round(v.layoutH * 0.42)) <= 1 && v.now === '42', v);

// ── 키보드 ──
await ev(`document.querySelector('#sheet-handle').focus()`);
const key = (k) => ev(`document.querySelector('#sheet-handle').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
await key('ArrowUp'); await sleep(50);
v = await ev(geo);
check('↑ → 창이 5% 커짐(지도 37%)', v.now === '37', v);
await key('Home'); await sleep(50);
check('Home → 창 최대(지도 72px)', (await ev(geo)).mapH === 72);
await key('End'); await sleep(50);
v = await ev(geo);
check('End → 창 최소(160px)', v.layoutH - v.handleTop === 160, v);
await key('Enter'); await sleep(50);
check('Enter → 기본(지도 42%)', (await ev(geo)).now === '42');

// ── 상세 정보·미션 창과 함께 ──
await ev(`__e2e.row('SW_02').click()`); await sleep(600);
await ev(`document.querySelector('#detail .mission-item').click()`); await sleep(200);
check('아래 창 안에서 상세 정보·미션 기록 창(모달)은 그대로 동작', await ev(`!!document.querySelector('dialog.mission-dialog')?.open`));
await ev(`document.querySelector('dialog.mission-dialog .mission-dialog-close').click()`); await sleep(150);

// ── 1280: 바 없음 ──
await b.setViewport(1280, 800, false); await sleep(300);
v = await ev(`(() => { const h = document.querySelector('#sheet-handle'); const p = document.querySelector('.panel').getBoundingClientRect(), m = document.querySelector('#map-area').getBoundingClientRect(); return { handle: getComputedStyle(h).display, panelW: Math.round(p.width), side: p.right <= m.left + 1, mapH: Math.round(m.height) }; })()`);
check('1280: 바 숨김, 목록 왼쪽 400px·지도 오른쪽 전체 높이(예전 그대로)', v.handle === 'none' && v.panelW === 400 && v.side && v.mapH > 600, v);
check('콘솔 예외 0건', b.errors.length === 0, b.errors);
await finish(b);
