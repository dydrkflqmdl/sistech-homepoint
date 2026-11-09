// B-10 터치·접근성: 누르는 자리 44px, "이 장소 삭제" 간격·확인 문구(미션 기록 N건), 낮은 화면(가로) 지도 접기,
// 장소를 고르면 상세 제목에 초점, 알림 칸은 늘 DOM(aria-live)에서 글자만 바뀜, 상태 점 기호(○ ◐ ✓)·핀 이름표의 상태,
// 검색 enterkeyhint="search", 계정 표 role.
import { launch, prepare, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('ux-a11y');
const b = await launch('ux-a11y');
const ev = b.ev;
const ADMIN = 'admin@sistech.test';
const places = [
  { name: 'SW_01', district: '태안', address: '소원면', lat: 36.766667, lng: 126.149826, mission: 'M_01 ~ _03', memo: '메모',
    missions: [
      { mission: 'M_01', done: true, worker: '홍', flightTime: '1분', batteryNo: '1', batteryLeft: '50', version: 1 },
      { mission: 'M_02', done: false, worker: '김', flightTime: '', batteryNo: '', batteryLeft: '', version: 1 },
    ] },
  { name: 'SW_02', district: '태안', address: '파도리', lat: 36.741223, lng: 126.144333, mission: 'N_01',
    missions: [{ mission: 'N_01', done: true, worker: '홍', flightTime: '1분', batteryNo: '1', batteryLeft: '50', version: 1 }] },
  { name: 'TB_01', district: '보은', address: '보은읍', lat: 36.49, lng: 127.73, mission: '' },
];
await prepare(b, { places, email: ADMIN, admins: [ADMIN], accounts: [{ id: 'user-' + ADMIN, login_id: null, email: ADMIN, created_at: '2026-10-01T00:00:00Z', last_sign_in_at: null, is_admin: true }] });

// 보이는 단추·칩·핀의 누르는 자리(아이콘은 ::after까지 포함)가 44px 이상인지
const targets = `(() => {
  const hit = (el) => {
    const r = el.getBoundingClientRect();
    const a = getComputedStyle(el, '::after');
    let w = r.width, h = r.height;
    if (a.content !== 'none' && a.position === 'absolute') {
      const n = (v) => parseFloat(v) || 0;
      if (a.width !== 'auto' && n(a.width) > 0) { w = Math.max(w, n(a.width)); h = Math.max(h, n(a.height)); }
      else { w = Math.max(w, r.width - n(a.left) - n(a.right)); h = Math.max(h, r.height - n(a.top) - n(a.bottom)); }
    }
    return { w: Math.round(w), h: Math.round(h) };
  };
  const els = [...document.querySelectorAll('button, .btn, .chip, [role="button"], input[type="search"], #detail input[type="text"]')]
    .filter((el) => el.offsetParent !== null && !el.closest('.sr-only'));
  const small = els.map((el) => ({ el, ...hit(el) })).filter((x) => x.h < 44).map((x) => ({ tag: x.el.tagName, cls: x.el.className, text: x.el.textContent.trim().slice(0, 20), w: x.w, h: x.h }));
  return { count: els.length, small };
})()`;
let t = await ev(targets);
check('390: 머리글·칩·시군 머리 등 보이는 단추가 모두 높이 44px 이상', t.count >= 8 && t.small.length === 0, t);

// ── 장소를 고르면 상세 제목에 초점 ──
await ev(`__e2e.row('SW_01').click()`); await sleep(300);
let v = await ev(`({ id: document.activeElement?.id, tabindex: document.activeElement?.getAttribute('tabindex'), text: document.activeElement?.textContent })`);
check('목록에서 장소를 고르면 상세 제목(tabindex=-1)에 초점', v.id === 'detail-title' && v.tabindex === '-1' && v.text.startsWith('SW_01'), v);
await ev(`document.querySelector('#detail .mission-item[data-mission="M_03"]').click()`); await sleep(150);
t = await ev(targets);
check('상세 정보·미션 입력 칸·닫기(×, ::after로 넓힘)·삭제까지 높이 44px 이상', t.small.length === 0, t);
v = await ev(`(() => { const x = document.querySelector('#detail .icon-btn'); const r = x.getBoundingClientRect(); const a = getComputedStyle(x, '::after'); return { w: r.width, h: r.height, inset: a.top, pos: a.position }; })()`);
check('닫기(×)는 보이는 크기 36px, 누르는 자리 ::after로 44px', v.w === 36 && v.h === 36 && v.inset === '-4px' && v.pos === 'absolute', v);
await ev(`document.querySelector('#detail .mission-form .btn.cancel').click()`); await sleep(100);
await ev(`document.querySelector('.pin[data-id="2"]').click()`); await sleep(300);
check('지도 핀을 눌러 고르면 상세 제목에 초점', (await ev(`document.activeElement?.id`)) === 'detail-title' && (await ev(`document.querySelector('#detail-title').textContent.startsWith('SW_02')`)));

// ── "이 장소 삭제": 다른 단추와 떨어진 자리 + 확인창에 미션 기록 수 ──
await ev(`__e2e.row('SW_01').click()`); await sleep(300);
v = await ev(`(() => { const del = document.querySelector('#detail .delete-place'); const prev = del.previousElementSibling.getBoundingClientRect(); const r = del.getBoundingClientRect(); const st = getComputedStyle(del);
  return { gap: Math.round(r.top - prev.bottom), border: st.borderTopWidth + ' ' + st.borderTopStyle, h: Math.round(del.querySelector('button').getBoundingClientRect().height) }; })()`);
check('"이 장소 삭제"는 구분선 아래 떨어진 자리(간격 ≥ 12px), 높이 44px', v.gap >= 12 && v.border === '1px solid' && v.h >= 44, v);
await ev(`window.confirm = (m) => { window.__confirms.push(String(m)); return false; }`);
await ev(`document.querySelector('#detail .delete-place .link').click()`); await sleep(150);
v = await ev(`({ asked: window.__confirms.at(-1), still: !document.querySelector('#detail').hidden, deleteCalls: __fake.calls.filter(c => c.name === 'delete_place').length })`);
check('삭제 확인창에 "미션 기록 2건도 함께 삭제됩니다", 아니오면 그대로', /"SW_01"을\(를\) 삭제할까요\?/.test(v.asked) && /미션 기록 2건도 함께 삭제됩니다/.test(v.asked) && v.still && v.deleteCalls === 0, v);
await ev(`window.confirm = (m) => { window.__confirms.push(String(m)); return true; }`);
await ev(`__e2e.row('TB_01').click()`); await sleep(200);
await ev(`document.querySelector('#detail .delete-place .link').click()`); await sleep(300);
v = await ev(`window.__confirms.at(-1)`);
check('기록이 없는 장소는 기록 수 문구 없이 묻는다', v === '"TB_01"을(를) 삭제할까요?', v);

// ── 알림 칸(#toast): 늘 DOM에 있고 글자만 바뀜 ──
v = await ev(`(() => { const t = document.querySelector('#toast'); return { exists: !!t, hidden: t.hidden, role: t.getAttribute('role'), live: t.getAttribute('aria-live'), atomic: t.getAttribute('aria-atomic'), text: t.textContent, display: getComputedStyle(t).display }; })()`);
check('알림 칸은 처음부터 DOM에 있고 숨기지 않음(role=status, aria-live=polite)', v.exists && !v.hidden && v.role === 'status' && v.live === 'polite' && v.atomic === 'true' && v.display !== 'none', v);
const toastNode = await ev(`(() => { window.__toastNode = document.querySelector('#toast'); return document.querySelector('#toast').textContent; })()`);
await sleep(3800);
v = await ev(`({ same: window.__toastNode === document.querySelector('#toast'), text: document.querySelector('#toast').textContent, hidden: document.querySelector('#toast').hidden, opacity: getComputedStyle(document.querySelector('#toast')).opacity })`);
check('시간이 지나면 글자만 비우고(투명), 같은 요소가 그대로 남음', toastNode === '삭제했습니다.' && v.same && v.text === '' && !v.hidden && v.opacity === '0', { toastNode, v });

// ── 상태 점 기호와 핀 이름표 ──
v = await ev(`(() => { const g = (sel) => { const d = document.querySelector(sel); return d ? { state: d.dataset.state, glyph: getComputedStyle(d, '::before').content } : null; };
  return { chips: [...document.querySelectorAll('#color-filters .chip .dot')].map((d) => d.dataset.state + ':' + getComputedStyle(d, '::before').content),
    pin1: document.querySelector('.pin[data-id="1"]')?.getAttribute('aria-label'), pin2: document.querySelector('.pin[data-id="2"]')?.getAttribute('aria-label'),
    head: g('#place-list .group-head .dot') }; })()`);
// 기호는 화면 읽기 프로그램이 읽지 않게 대체 글자를 비워 둔다(content: "◐" / "").
check('상태 점에 기호: 미진행 ○, 진행 중 ◐, 완료 ✓(칩·시군 머리), 읽기용 대체 글자는 빈 칸',
  /^doing:"◐" \/ ""$/.test(v.chips[0] ?? '') && /^done:"✓" \/ ""$/.test(v.chips[1] ?? '') && v.chips.length === 2 && v.head?.glyph === '"◐" / ""', v);
check('핀 이름표(aria-label)에 이름과 상태: "SW_01, 진행 중 1/3", "SW_02, 완료 1/1"', v.pin1 === 'SW_01, 진행 중 1/3' && v.pin2 === 'SW_02, 완료 1/1', v);

// ── 검색 enterkeyhint ──
check('검색 칸은 enterkeyhint="search"(휴대폰 키보드에 [검색])', (await ev(`document.querySelector('#search').getAttribute('enterkeyhint')`)) === 'search');

// ── 계정 표 role(표를 block으로 쌓아도 표로 읽히게) ──
await ev(`document.querySelector('#accounts-button').click()`);
await b.waitFor(`!!document.querySelector('#accounts-panel .accounts-row')`, 3000);
v = await ev(`(() => { const t = document.querySelector('.accounts-table'); return { table: t.getAttribute('role'), display: getComputedStyle(t).display, rowgroups: [...t.querySelectorAll('thead, tbody')].map((x) => x.getAttribute('role')),
  rows: [...t.querySelectorAll('tr')].every((r) => r.getAttribute('role') === 'row'), cells: [...t.querySelectorAll('td')].every((c) => c.getAttribute('role') === 'cell'), heads: [...t.querySelectorAll('th')].every((c) => c.getAttribute('role') === 'columnheader') }; })()`);
check('계정 표: display block이어도 role=table/rowgroup/row/cell/columnheader', v.table === 'table' && v.display === 'block' && v.rowgroups.join() === 'rowgroup,rowgroup' && v.rows && v.cells && v.heads, v);
t = await ev(targets);
check('계정 관리 창의 단추(새로 고침·재설정·만들기·보기)도 높이 44px 이상', t.small.length === 0, t);
await ev(`document.querySelector('#accounts-close').click()`);

// ── 낮은 화면(가로로 든 휴대폰): 지도 접기 ──
check('세로 화면에서는 지도 접기 단추가 없음', (await ev(`getComputedStyle(document.querySelector('#map-toggle')).display`)) === 'none');
for (const [w, h] of [[844, 390], [667, 375]]) {
  await b.setViewport(w, h, true);
  await sleep(300);
  v = await ev(`({ shown: getComputedStyle(document.querySelector('#map-toggle')).display !== 'none', text: document.querySelector('#map-toggle').textContent, expanded: document.querySelector('#map-toggle').getAttribute('aria-expanded'), map: Math.round(document.querySelector('.map-area').getBoundingClientRect().height), h: Math.round(document.querySelector('#map-toggle').getBoundingClientRect().height) })`);
  check(`${w}×${h}: [지도 접기] 단추가 보임(aria-expanded=true, 높이 44)`, v.shown && v.text === '지도 접기' && v.expanded === 'true' && v.map > 0 && v.h >= 44, v);
  await ev(`document.querySelector('#map-toggle').click()`); await sleep(200);
  v = await ev(`({ text: document.querySelector('#map-toggle').textContent, expanded: document.querySelector('#map-toggle').getAttribute('aria-expanded'), mapShown: getComputedStyle(document.querySelector('.map-area')).display !== 'none',
    panelW: Math.round(document.querySelector('.panel').getBoundingClientRect().width), panelH: Math.round(document.querySelector('.panel').getBoundingClientRect().height), focus: document.activeElement?.id,
    noScroll: document.scrollingElement.scrollHeight <= document.scrollingElement.clientHeight })`);
  check(`${w}×${h}: 접으면 지도가 사라지고 목록이 화면을 다 씀([지도 펼치기], 초점 유지, 문서 스크롤 없음)`, v.text === '지도 펼치기' && v.expanded === 'false' && !v.mapShown && v.panelW === w && v.focus === 'map-toggle' && v.noScroll, v);
  await b.shot(`ux-map-collapsed-${w}`);
  await ev(`document.querySelector('#map-toggle').click()`); await sleep(200);
  check(`${w}×${h}: 다시 누르면 지도가 돌아옴`, await ev(`getComputedStyle(document.querySelector('.map-area').closest('.map-area')).display !== 'none' && document.querySelector('#map-toggle').textContent === '지도 접기'`));
}
await b.setViewport(390, 844, true);

check('콘솔 오류·예외 0건', b.errors.length === 0, b.errors);
await finish(b);
