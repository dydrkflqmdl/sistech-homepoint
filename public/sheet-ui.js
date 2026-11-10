// 휴대폰(767px 이하) 아래 창(목록·상세 정보) 높이 조절 바. 지도와 아래 창 사이의 손잡이(#sheet-handle)를 위아래로 끈다.
// 끄는 동안에는 지도 칸을 화면 끝까지 늘려 둔 채 아래 창이 지도를 덮으며 움직인다(지도를 다시 그리지 않아 부드럽다).
// 손을 떼면 지도 칸을 창 위 끝까지로 한 번만 맞춘다. 카카오 로고·저작권 표시가 창에 가려지지 않고, 고른 핀이 보이는
// 지도 가운데에 온다. 지도 칸 크기를 바꿀 때 보이던 지도는 제자리(map-ui.js resizeMapKeepingTop).
// 정한 높이는 지도 칸의 비율로 이 브라우저에 기억한다. 손잡이를 두 번 누르면(또는 Enter) 기본값(지도 42%)으로.
// 키보드: ↑ 창을 키움, ↓ 창을 줄임(5%씩), Home 창 최대, End 창 최소. 넓은 화면에서는 CSS가 손잡이를 숨긴다.
import { $ } from './dom.js';
import { readStorage, writeStorage } from './state.js';
import { resizeMapKeepingTop } from './map-ui.js';

const DEFAULT_RATIO = 0.42;
// 지도 칸 최소 높이(지도 종류 버튼·카카오 로고가 들어감)와 아래 창 최소 높이(손잡이 + 검색 칸). styles.css의 clamp와 같다.
const MIN_MAP = 72;
const MIN_SHEET = 160;
const STEP = 0.05;
const STORAGE_KEY = 'sheetMapRatio';
// 이만큼(px) 움직여야 끌기로 본다. 그 전에 떼면 누르기(두 번 누르기 판단).
const DRAG_THRESHOLD = 4;
const DOUBLE_TAP_MS = 350;

const app = $('.app');
const layout = $('.layout');
const handle = $('#sheet-handle');
const mapArea = $('#map-area');
const narrow = matchMedia('(max-width: 767px)');

const saved = Number(readStorage(STORAGE_KEY));
let ratio = saved > 0 && saved < 1 ? saved : DEFAULT_RATIO;

// 지금 화면 높이에서 허용되는 지도 칸 비율.
function bounds() {
  const h = layout.getBoundingClientRect().height;
  if (h <= MIN_MAP + MIN_SHEET) return { min: 0, max: 1, h };
  return { min: MIN_MAP / h, max: (h - MIN_SHEET) / h, h };
}

const writeRatio = () => layout.style.setProperty('--map-h', `${(ratio * 100).toFixed(2)}%`);

// 화면 읽기 프로그램용 값: 지도 칸이 차지하는 비율(%).
function syncAria() {
  const h = layout.getBoundingClientRect().height;
  const now = h > 0 ? Math.round((mapArea.getBoundingClientRect().height / h) * 100) : Math.round(ratio * 100);
  handle.setAttribute('aria-valuenow', String(now));
  handle.setAttribute('aria-valuetext', `지도 ${now}%, 목록 ${100 - now}%`);
}

export function setSheetRatio(next, { save = true } = {}) {
  const { min, max } = bounds();
  ratio = Math.min(max, Math.max(min, next));
  if (save) writeStorage(STORAGE_KEY, ratio.toFixed(4));
  resizeMapKeepingTop(writeRatio);
  syncAria();
}

// ── 끌기 ──
let drag = null;
let lastTap = 0;
let frame = 0;

handle.addEventListener('pointerdown', (e) => {
  if (!narrow.matches || e.button !== 0 || drag) return;
  e.preventDefault();
  handle.setPointerCapture?.(e.pointerId);
  const box = layout.getBoundingClientRect();
  drag = { id: e.pointerId, startY: e.clientY, startTop: mapArea.getBoundingClientRect().height, height: box.height, moved: false, top: null };
});

handle.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dy = e.clientY - drag.startY;
  if (!drag.moved) {
    if (Math.abs(dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    layout.style.setProperty('--sheet-top', `${drag.startTop}px`);
    // 끄는 동안: 지도 칸을 아래 끝까지 늘려 두고(여기서 한 번만 다시 그림) 아래 창이 그 위를 덮으며 움직인다.
    resizeMapKeepingTop(() => app.classList.add('sheet-dragging'));
  }
  const { min, max } = bounds();
  drag.top = Math.min(max * drag.height, Math.max(min * drag.height, drag.startTop + dy));
  if (!frame) {
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (drag?.top != null) layout.style.setProperty('--sheet-top', `${drag.top}px`);
    });
  }
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  if (!d.moved) {
    // 누르기: 두 번 누르면 기본 높이로.
    const now = e.timeStamp;
    if (now - lastTap < DOUBLE_TAP_MS) {
      lastTap = 0;
      setSheetRatio(DEFAULT_RATIO);
    } else lastTap = now;
    return;
  }
  cancelAnimationFrame(frame);
  frame = 0;
  ratio = (d.top ?? d.startTop) / d.height;
  writeStorage(STORAGE_KEY, ratio.toFixed(4));
  // 손을 떼면: 지도 칸을 창 위 끝까지로 한 번만 맞춘다(보이던 지도는 제자리).
  resizeMapKeepingTop(() => {
    writeRatio();
    app.classList.remove('sheet-dragging');
    layout.style.removeProperty('--sheet-top');
  });
  syncAria();
}
handle.addEventListener('pointerup', endDrag);
handle.addEventListener('pointercancel', endDrag);
// 손잡이 위에서 휴대폰이 화면을 스크롤하거나 길게 누름 메뉴를 띄우지 않게 한다(CSS touch-action: none과 함께).
handle.addEventListener('contextmenu', (e) => e.preventDefault());

// ── 키보드 ──
handle.addEventListener('keydown', (e) => {
  const { min, max } = bounds();
  const next = { ArrowUp: ratio - STEP, ArrowDown: ratio + STEP, Home: min, End: max, Enter: DEFAULT_RATIO, ' ': DEFAULT_RATIO }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  setSheetRatio(next);
});

writeRatio();
syncAria();
// 화면 크기가 바뀌면(돌림·주소창) 비율은 그대로 두고 화면 읽기 값만 다시 잰다. 넓은 화면으로 가면 끌던 것을 끝낸다.
window.addEventListener('resize', syncAria);
narrow.addEventListener('change', () => {
  if (!drag) return;
  drag = null;
  app.classList.remove('sheet-dragging');
  layout.style.removeProperty('--sheet-top');
});
