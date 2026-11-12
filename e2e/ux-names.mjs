// 지도 핀 이름표: 8단계(축척 2km) 이하에서만 보임, 이스케이프, 메모 말풍선은 이름표 위, 핀 크기·핀 DOM은 줌으로 안 바뀜.
import { launch, prepare, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('ux-names');
const b = await launch('ux-names');
const ev = b.ev;
const places = [
  { name: 'SW_01', district: '태안', address: '가람면', lat: 37.277767, lng: 126.717126, mission: 'M_01 ~ _03', memo: '메모 내용',
    missions: [{ mission: 'M_01', done: true, worker: '홍', flightTime: '1분', batteryNo: '1', batteryLeft: '50', version: 1 }] },
  { name: '<b>X</b> & "Y"', district: '태안', address: '바람리', lat: 37.167923, lng: 126.815733, mission: '' },
  { name: 'Q1_A_SS_BS_17 / Q1_A_SS_BS_18 / Q1_A_SS_BS_19 / Q1_A_SS_BS_20', district: '보은', address: '보은읍', lat: 36.49, lng: 127.73, mission: '' },
];
await prepare(b, { places });
await b.waitFor(`document.querySelectorAll('.pin').length === 3`, 8000);

const setLevel = async (n) => {
  await ev(`(() => { const m = window.__kakaoMaps[0]; m.setLevel(${n}); })()`);
  await sleep(150);
};
// 이름표가 실제로 보이는지(display:none이면 getClientRects가 비어 있다)
const shown = () => ev(`[...document.querySelectorAll('.pin .name-label')].map((n) => n.getClientRects().length > 0)`);
const pinInfo = () => ev(`[...document.querySelectorAll('.pin')].map((p) => { const r = p.getBoundingClientRect(); return { w: r.width, h: r.height, html: p.innerHTML }; })`);

// 1·2. 단계별 보임/숨김
for (const [lv, want] of [[10, false], [9, false], [8, true], [3, true]]) {
  await setLevel(lv);
  const s = await shown();
  check(`${lv}단계: 이름표 ${want ? '보임' : '숨김'}`, s.length === 3 && s.every((x) => x === want), s);
}

// 3. 글자 = 장소 이름, HTML은 이스케이프
await setLevel(8);
const labels = await ev(`[...document.querySelectorAll('.pin')].map((p) => ({ text: p.querySelector('.name-label')?.textContent, aria: p.querySelector('.name-label')?.getAttribute('aria-hidden'), inner: p.querySelector('.name-label')?.innerHTML, bold: !!p.querySelector('.name-label b') }))`);
check('이름표 글자가 장소 이름과 같음', places.every((p) => labels.some((l) => l.text === p.name)), labels);
check('이름의 HTML은 글자로 보임(요소가 만들어지지 않음)', labels.every((l) => !l.bold) && labels.some((l) => l.inner.includes('&lt;b&gt;')), labels);
check('이름표는 aria-hidden', labels.every((l) => l.aria === 'true'), labels);
const long = await ev(`(() => { const n = [...document.querySelectorAll('.name-label')].find((e) => e.textContent.startsWith('Q1_A')); return { w: n.getBoundingClientRect().width, clipped: n.scrollWidth > n.clientWidth, nowrap: getComputedStyle(n).whiteSpace }; })()`);
check('긴 이름은 폭 상한(≤180px)에서 한 줄로 잘림(…)', long.w <= 180 && long.clipped && long.nowrap === 'nowrap', long);

// 4. 메모 말풍선은 이름표 위(겹침 없음). 7단계는 말풍선 숨김이므로 선택 핀(항상 보임) 또는 5단계에서 확인
await setLevel(5);
const stack = await ev(`(() => { const p = [...document.querySelectorAll('.pin')].find((e) => e.dataset.id && e.querySelector('.memo-label'));
  const m = p.querySelector('.memo-label').getBoundingClientRect(), n = p.querySelector('.name-label').getBoundingClientRect(), pr = p.getBoundingClientRect();
  return { memoBottom: m.bottom, nameTop: n.top, nameBottom: n.bottom, pinTop: pr.top, memoTop: m.top, memoW: m.width }; })()`);
check('5단계: 메모 말풍선이 이름표 위(겹침 없음)', stack.memoBottom <= stack.nameTop && stack.nameBottom <= stack.pinTop, stack);
await setLevel(8);
const hid = await ev(`(() => { const p = document.querySelector('.pin .memo-label')?.closest('.pin'); return p ? getComputedStyle(p.querySelector('.memo-label')).display : 'none'; })()`);
check('8단계: 메모 말풍선은 숨김(선택 안 한 핀)', hid === 'none', hid);
// 선택한 핀은 말풍선이 늘 보이므로 8단계에서도 이름표 위에 있어야 한다
await ev(`document.querySelector('.pin .memo-label').closest('.pin').click()`); await sleep(200);
const sel = await ev(`(() => { const p = document.querySelector('.pin.selected'); const m = p.querySelector('.memo-label').getBoundingClientRect(), n = p.querySelector('.name-label').getBoundingClientRect(); return { memoBottom: m.bottom, nameTop: n.top, nameShown: n.width > 0 }; })()`);
check('8단계 선택 핀: 말풍선이 이름표 위, 이름표도 보임', sel.nameShown && sel.memoBottom <= sel.nameTop, sel);
// 이름이 숨겨지면 말풍선은 원래 자리(핀 위 7px)
await setLevel(9);
const noName = await ev(`(() => { const p = document.querySelector('.pin.selected'); const m = p.querySelector('.memo-label').getBoundingClientRect(), pr = p.getBoundingClientRect(); return { gap: Math.round(pr.top - m.bottom) }; })()`);
check('9단계: 이름표가 없으면 말풍선은 핀 위 7px(원래 자리)', Math.abs(noName.gap - 7) <= 1, noName);

// 5·6. 핀 크기·핀 DOM은 줌(이름 보임/숨김)으로 안 바뀜
await setLevel(10);
await ev(`window.__els = [...document.querySelectorAll('.pin')]; `);
const before = await pinInfo();
const htmls = await ev(`window.__els.map((e) => e.innerHTML)`);
await setLevel(8);
const mid = await pinInfo();
await setLevel(3);
await setLevel(10);
const after = await pinInfo();
check('이름표가 보여도 핀 크기가 그대로', before.every((p, i) => p.w === mid[i].w && p.h === mid[i].h && p.w === after[i].w && p.h === after[i].h), { before: before.map((p) => [p.w, p.h]), mid: mid.map((p) => [p.w, p.h]) });
const same = await ev(`(() => { const now = [...document.querySelectorAll('.pin')]; return now.length === window.__els.length && now.every((e, i) => e === window.__els[i]); })()`);
const htmlSame = await ev(`window.__els.every((e, i) => e.innerHTML === ${JSON.stringify(htmls)}[i])`);
check('줌을 바꿔도 핀 요소·내용을 다시 만들지 않음', same && htmlSame, { same, htmlSame });


// 7. 화면 캡처 390·1280 × 8·9단계
for (const [w, h, mobile] of [[390, 844, true], [1280, 820, false]]) {
  await b.setViewport(w, h, mobile);
  await prepare(b, { places });
  await b.waitFor(`document.querySelectorAll('.pin').length === 3`, 8000);
  // 메모 말풍선이 있는 SW_01을 골라 가운데에 둔다(선택 핀은 말풍선이 늘 보임).
  await ev(`document.querySelector('.pin .memo-label').closest('.pin').click()`);
  await sleep(200);
  for (const lv of [8, 9]) {
    await setLevel(lv);
    await b.shot(`names-${w}-level${lv}`);
    const s = await shown();
    check(`${w}px ${lv}단계: 이름표 ${lv === 8 ? '보임' : '숨김'}`, s.every((x) => x === (lv === 8)), s);
  }
}
await finish(b);
