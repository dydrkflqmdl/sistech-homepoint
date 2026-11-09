// A-2: 계정 관리를 누르면 생기던 불필요한 스크롤.
// 원인: 패널 안의 position: absolute 요소(.sr-only 글자, 계정 표 머리 줄)가 위치를 잡은 조상이 없어 문서 전체를 기준으로
// 놓였다. 계정 관리 창이 위에 열려 시군 머리가 화면 아래로 밀리면 그 글자들이 문서 높이를 늘려 페이지 전체가 한 번 더
// 스크롤됐다(390: 844→1962px, 1280: 820→1510px). 고친 뒤에는 문서는 늘 화면 크기이고, 스크롤은 패널 안에서만 한다.
import { launch, prepare, q1Rows, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('ux-scroll');
const b = await launch('ux-scroll');
const ADMIN = 'admin@sistech.test';
const accounts = [
  { id: 'user-' + ADMIN, login_id: null, email: ADMIN, created_at: '2026-10-01T00:00:00Z', last_sign_in_at: '2026-11-06T03:12:00Z', is_admin: true },
  ...Array.from({ length: 7 }, (_, i) => ({ id: 'user-w' + i, login_id: '작업자' + (i + 1), email: 'w' + i + '@sistech.local', created_at: '2026-10-20T01:00:00Z', last_sign_in_at: null, is_admin: false })),
];
const rows = await q1Rows();

// 문서(페이지)의 가로·세로 스크롤과, 끝까지 내려 보려 해도 움직이지 않는지.
const docScroll = `(async () => {
  const se = document.scrollingElement;
  const before = { w: se.scrollWidth, h: se.scrollHeight, cw: se.clientWidth, ch: se.clientHeight };
  se.scrollTo(1e6, 1e6);
  await new Promise((r) => setTimeout(r, 100));
  const moved = { x: se.scrollLeft, y: se.scrollTop };
  se.scrollTo(0, 0);
  const p = document.querySelector('.panel');
  return { ...before, moved, noX: before.w <= before.cw, noY: before.h <= before.ch, panelScrolls: p.scrollHeight > p.clientHeight, panelOverflow: getComputedStyle(p).overflowY };
})()`;

for (const [w, h, mobile] of [[390, 844, true], [1280, 820, false], [844, 390, true]]) {
  await b.setViewport(w, h, mobile);
  await prepare(b, { rows, email: ADMIN, admins: [ADMIN], accounts });
  const closed = await b.ev(docScroll);
  await b.ev(`document.querySelector('#accounts-button').click()`);
  await b.waitFor(`document.querySelectorAll('#accounts-panel .accounts-row').length === ${accounts.length}`, 3000);
  await sleep(400);
  const open = await b.ev(docScroll);
  check(`${w}×${h}: 계정 관리를 열어도 문서 가로·세로 스크롤 없음(끝까지 내려도 0)`, closed.noX && closed.noY && open.noX && open.noY && open.moved.x === 0 && open.moved.y === 0, { closed, open });
  check(`${w}×${h}: 긴 계정 목록은 패널 안에서만 스크롤(overflow-y: auto)`, open.panelScrolls && open.panelOverflow === 'auto', open);
  await b.ev(`document.querySelector('.panel').scrollTo(0, 0)`);
  await b.shot(`a2-accounts-${w}`);
  // 같은 자리에서 패널을 끝까지 내리면 계정 목록 아래(새 계정 폼·시군 목록)가 보이고 머리글은 그대로다.
  const bottom = await b.ev(`(async () => { const p = document.querySelector('.panel'); p.scrollTo(0, 1e6); await new Promise((r) => setTimeout(r, 100));
    return { top: Math.round(document.querySelector('.topbar').getBoundingClientRect().top), panelTop: p.scrollTop > 0, doc: document.scrollingElement.scrollTop }; })()`);
  check(`${w}×${h}: 패널을 끝까지 내려도 머리글은 제자리(문서는 움직이지 않음)`, bottom.top === 0 && bottom.panelTop && bottom.doc === 0, bottom);
  await b.shot(`a2-accounts-${w}-panel-bottom`);
}

// 미션이 많은 상세 정보(34개)와 기록 입력 칸을 연 화면도 같은 원리로 문서가 스크롤되지 않아야 한다.
await b.setViewport(390, 844, true);
await prepare(b, { rows });
await b.ev(`__e2e.row('SW_01').click()`);
await sleep(300);
await b.ev(`document.querySelector('#detail .mission-item').click()`);
await sleep(200);
const detail = await b.ev(docScroll);
check('390: 미션 34개 상세 정보 + 입력 칸을 열어도 문서 스크롤 없음', detail.noX && detail.noY && detail.moved.y === 0 && detail.panelScrolls, detail);

check('콘솔 오류·예외 0건', b.errors.length === 0, b.errors);
await finish(b);
