// A-2 재현용 측정(run-all에는 넣지 않는 진단 스크립트): 계정 관리를 열면 문서(페이지) 자체가 세로로 스크롤되는지,
// 원인 요소가 무엇인지 본다. shots/a2-repro-*.png를 만든다.
//   수정 전 화면: 고치기 전 커밋의 public/styles.css로 잠시 바꾼 뒤  A2_TAG=before node e2e/run-one.mjs probe-a2
//   수정 후 화면:                                                   A2_TAG=after  node e2e/run-one.mjs probe-a2
// 수정 전에는 숨은 글자(.sr-only)가 패널 밖 문서 높이를 늘려(390: 844→1962px) 문서를 끝까지 내리면 빈 바탕만 남았다.
import { launch, prepare, q1Rows, sleep } from './lib.mjs';

const tag = process.argv[2] ?? process.env.A2_TAG ?? 'after';
const ADMIN = 'admin@sistech.test';
const accounts = [
  { id: 'user-' + ADMIN, login_id: null, email: ADMIN, created_at: '2026-10-01T00:00:00Z', last_sign_in_at: '2026-11-06T03:12:00Z', is_admin: true },
  { id: 'user-son', login_id: '손두병', email: 'xn--2i0bv7jqyb@sistech.local', created_at: '2026-10-15T06:30:00Z', last_sign_in_at: null, is_admin: false },
  // 실제 현장처럼 계정이 여럿이면 PC(1280)에서도 패널이 넘친다.
  ...Array.from({ length: 6 }, (_, i) => ({ id: 'user-w' + i, login_id: '작업자' + (i + 1), email: 'w' + i + '@sistech.local', created_at: '2026-10-20T01:00:00Z', last_sign_in_at: null, is_admin: false })),
];
const measure = `(() => {
  const se = document.scrollingElement;
  const p = document.querySelector('.panel');
  const escaped = [...document.querySelectorAll('.panel *')].filter((e) => getComputedStyle(e).position === 'absolute')
    .map((e) => { const r = e.getBoundingClientRect(); return { cls: e.className || e.tagName, bottom: Math.round(r.bottom), off: e.offsetParent?.className ?? null }; })
    .filter((x) => x.bottom > innerHeight).slice(0, 8);
  return { inner: [innerWidth, innerHeight], doc: [se.scrollWidth, se.scrollHeight, se.clientWidth, se.clientHeight],
    docScrollY: se.scrollHeight > se.clientHeight, docScrollX: se.scrollWidth > se.clientWidth,
    panel: [p.scrollHeight, p.clientHeight], escaped };
})()`;

const b = await launch('probe-a2');
for (const [w, h, mobile] of [[390, 844, true], [1280, 820, false]]) {
  await b.setViewport(w, h, mobile);
  await prepare(b, { rows: await q1Rows(), email: ADMIN, admins: [ADMIN], accounts });
  const closed = await b.ev(measure);
  await b.ev(`document.querySelector('#accounts-button').click()`);
  await b.waitFor(`document.querySelectorAll('#accounts-panel .accounts-row').length === 8`, 3000);
  await sleep(500);
  const open = await b.ev(measure);
  console.log(w, 'closed', JSON.stringify(closed));
  console.log(w, 'open  ', JSON.stringify(open));
  // 문서를 끝까지 내려 본다: 불필요한 스크롤이 있으면 화면 전체가 위로 밀려 빈 바탕이 보인다.
  await b.ev(`document.scrollingElement.scrollTo(0, 1e6)`);
  await sleep(200);
  console.log(w, 'docScrollTop after scrollTo(bottom)', await b.ev(`document.scrollingElement.scrollTop`));
  await b.shot(`a2-repro-${tag}-${w}-bottom`);
  await b.ev(`document.scrollingElement.scrollTo(0, 260)`);
  await sleep(200);
  await b.shot(`a2-repro-${tag}-${w}-mid`);
  await b.ev(`document.scrollingElement.scrollTo(0, 0)`);
}
console.log('errors', JSON.stringify(b.errors));
await b.close();
