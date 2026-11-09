// 옛 check-home.mjs(1건)·check-filter-collapsed.mjs(4건)·check-memo-icon.mjs(1건) 이식. 판정 기준은 그대로 두었다.
// 데이터: 홈포인트_Q1.csv(10곳) + SW_02 메모 '테스트메모' + SW_01 미션 1개 완료(옛 스크립트들이 차례로 돌며 쌓던 상태).
// [화면 개선 반영] 접힌 시군의 줄은 DOM에 없다(B-7). 줄 수는 요약 문구로 보고, 메모 아이콘은 모두 펼친 뒤 본다.
import { launch, prepare, q1Rows, reporter, sleep, URL_BASE } from './lib.mjs';

const { check, finish } = reporter('regress');
const b = await launch('regress');
const ev = b.ev;
const after = `(db) => {
  db.places.find(p => p.name === 'SW_02').memo = '테스트메모';
  const sw01 = db.places.find(p => p.name === 'SW_01');
  db.missions.push({ id: db.nextMid++, placeId: sw01.id, mission: 'Q1_A_TA_SW__01_01', done: true, worker: '홍길동', flightTime: '12분', batteryNo: '3', batteryLeft: '45', version: 1, updatedAt: new Date().toISOString() });
}`;
const rows = await q1Rows();
console.log('Q1 이름:', rows.map((r) => `${r.district}/${r.name}`).join(', '));

// ── 홈 복귀 ──
await prepare(b, { rows, after });
await ev(`__e2e.row('SW_02').click()`); await sleep(400);
await ev(`[...document.querySelectorAll('#detail .mission-list .mission-item')][0].click()`); await sleep(300);
await ev(`(() => { const s = document.querySelector('#search'); s.value = 'SW'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(200);
await ev(`[...document.querySelectorAll('#color-filters .chip')].find(c => /미진행/.test(c.textContent))?.click()`); await sleep(300);
const before = await ev(`(() => ({ detail: !document.querySelector('#detail').hidden, editor: !!document.querySelector('#detail .mission-editor'), search: document.querySelector('#search').value, pressed: [...document.querySelectorAll('#color-filters .chip[aria-pressed="true"]')].map(c => c.textContent.trim()) }))()`);
const urlBefore = await ev('location.href');
const listCallsBefore = await ev(`__fake.calls.filter(c => c.name === 'list_places').length`);
await ev(`document.querySelector('#home-link').click()`); await sleep(900);
const home = await ev(`(() => ({ detail: !document.querySelector('#detail').hidden, editor: !!document.querySelector('#detail .mission-editor'), search: document.querySelector('#search').value, pressed: [...document.querySelectorAll('#color-filters .chip[aria-pressed="true"]')].map(c => c.textContent.trim()), listCount: document.querySelectorAll('#place-list button .name').length, openGroups: document.querySelectorAll('#place-list .group-head[aria-expanded="true"]').length, summary: document.querySelector('#list-summary').textContent }))()`);
const urlAfter = await ev('location.href');
const listCallsAfter = await ev(`__fake.calls.filter(c => c.name === 'list_places').length`);
// 처음 화면은 모두 접혀 있어 장소 줄은 DOM에 없고(listCount 0), 요약에 10곳이 보인다.
const okHome = before.detail && before.editor && before.search === 'SW' && !home.detail && !home.editor && home.search === '' && home.pressed.length === 1 && /^전체/.test(home.pressed[0]) && home.listCount === 0 && home.summary === '장소 10개' && home.openGroups === 0 && urlBefore === urlAfter;
check('제목 클릭 → 처음 화면(선택·미션·검색·필터 초기화, 새로고침 없음)', okHome, { before, home });
check('제목 클릭은 다시 받지 않음(list_places 호출 그대로)', listCallsAfter === listCallsBefore, { listCallsBefore, listCallsAfter });

// ── 필터 접힘 ──
await prepare(b, { rows, after });
const snap = (label) => ev(`(() => ({ label: ${JSON.stringify(label)}, heads: [...document.querySelectorAll('#place-list .group-head')].map(h => h.querySelector('.group-name').textContent.trim() + ' ' + h.querySelector('.group-count').textContent + ' open=' + h.getAttribute('aria-expanded')), visibleRows: [...document.querySelectorAll('#place-list button .name')].filter(n => n.offsetParent !== null).length, summary: document.querySelector('#list-summary').textContent }))()`);
const s0 = await snap('초기');
await ev(`[...document.querySelectorAll('#color-filters .chip')].find(c => /진행 중/.test(c.textContent)).click()`); await sleep(400);
const s1 = await snap('진행 중 칩');
await ev(`[...document.querySelectorAll('#color-filters .chip')].find(c => /전체/.test(c.textContent)).click()`); await sleep(300);
await ev(`(() => { const s = document.querySelector('#search'); s.value = 'TB_0'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(400);
const s2 = await snap('검색 TB_0');
await ev(`(() => { const s = document.querySelector('#search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(300);
await ev(`[...document.querySelectorAll('#place-list .group-head')].find(h => h.querySelector('.group-name').textContent.trim() === '보은').click()`); await sleep(300);
const s3 = await snap('보은 수동 펼침');
await ev(`[...document.querySelectorAll('#color-filters .chip')].find(c => /미진행/.test(c.textContent)).click()`); await sleep(400);
const s4 = await snap('미진행 칩 후');
await ev(`[...document.querySelectorAll('#color-filters .chip')].find(c => /전체/.test(c.textContent)).click()`); await sleep(300);
await ev(`[...document.querySelectorAll('#place-list .group-head')].find(h => h.querySelector('.group-name').textContent.trim() === '태안').click()`); await sleep(300);
await b.navigate(URL_BASE, 300);
await b.waitFor(`document.querySelectorAll('#place-list .group').length > 0`);
await sleep(300);
const s5 = await snap('새로고침 후');
const ok3 = s3.heads.some((h) => /^보은 .* open=true/.test(h)) && s4.heads.every((h) => /open=false/.test(h)) && s4.visibleRows === 0 && s5.heads.every((h) => /open=false/.test(h));
const ok0 = ok3 && s0.heads.every((h) => /미션 open=false/.test(h)) && s0.heads.some((h) => /^태안 2미션/.test(h)) && s0.visibleRows === 0;
const ok1 = s1.heads.length === 1 && /^태안 1미션 open=false/.test(s1.heads[0]) && s1.visibleRows === 0;
const ok2 = s2.heads.length === 1 && /^보은 .* open=true/.test(s2.heads[0]) && s2.visibleRows === 8;
check('초기: 모두 접힘, 단위 "미션"', ok0, s0);
check('분류 칩: 걸러지지만 접힌 채', ok1, s1);
check('검색: 자동 펼침 유지', ok2, s2);
check('손으로 펼친 뒤 분류 칩 → 모두 접힘, 새로고침 → 접힌 채 시작', ok3, { s3, s4, s5 });

// ── 메모 아이콘 ──
await prepare(b, { rows, after });
const msnap = () => ev(`(() => { __e2e.openAll(); return [...document.querySelectorAll('#place-list button[data-id]')].map(b => ({ name: b.querySelector('.name').firstChild.textContent.trim(), on: b.querySelector('.memo-icon')?.classList.contains('on'), title: b.querySelector('.memo-icon')?.getAttribute('title') })); })()`);
const m0 = await msnap();
const sw02 = m0.find((r) => r.name === 'SW_02');
await ev(`[...document.querySelectorAll('#place-list button[data-id]')].find(b => b.querySelector('.name').textContent.startsWith('SW_01')).click()`); await sleep(400);
await ev(`(() => { const t = document.querySelector('#detail .memo textarea'); t.value = '새 메모'; t.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(800);
const sw01b = (await msnap()).find((r) => r.name === 'SW_01');
const memoSaved = await ev(`__fake.store().find(p => p.name === 'SW_01').memo`);
await ev(`(() => { const t = document.querySelector('#detail .memo textarea'); t.value = ''; t.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(800);
const sw01c = (await msnap()).find((r) => r.name === 'SW_01');
await ev(`document.querySelector('#place-list button[data-id]').scrollIntoView()`);
await b.shot('memo-icon');
const okMemo = m0.length === 10 && m0.every((r) => r.on !== undefined) && sw02.on === true && /테스트메모/.test(sw02.title) && sw01b.on === true && /새 메모/.test(sw01b.title) && sw01c.on === false;
check('메모 아이콘: 모든 행에 존재, 메모 있는 행만 활성, 저장/삭제 즉시 반영', okMemo, { sw02, sw01b, sw01c, count: m0.length });
check('메모 저장이 update_memo로 DB에 반영', memoSaved === '새 메모', memoSaved);

check('콘솔 예외 0건', b.errors.length === 0, b.errors);
await finish(b);
