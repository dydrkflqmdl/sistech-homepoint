// B-11 가져오기 전 확인(계약 C7: csv.js의 readPlaces().warnings, nearDuplicates, missionChanges).
// 경고·근접 중복(거리)·미션명이 바뀌는 기존 장소(기록 수)를 보여 주고 [계속]/[취소]. 미션명 변경이 있으면 기본 초점은 [취소].
// csv.js에 탐지 함수가 없는 판에서도 깨지지 않는지(확인 없이 바로 가져옴) 함께 본다.
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES, launch, PROJECT, prepare, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('ux-import');
const csvSource = fs.readFileSync(path.join(PROJECT, 'public/csv.js'), 'utf-8');
const hasC7 = /export function nearDuplicates/.test(csvSource) && /export function missionChanges/.test(csvSource);
const fx = (name, content) => {
  const p = path.join(FIXTURES, name);
  fs.writeFileSync(p, content);
  return p;
};
const places = [
  { name: 'SW_01', district: '태안', address: '가람면', lat: 37.277767, lng: 126.717126, mission: 'Q1_A_TA_SW__01_01 ~ _34',
    missions: [
      { mission: 'Q1_A_TA_SW__01_01', done: true, worker: '홍', flightTime: '1분', batteryNo: '1', batteryLeft: '50', version: 1 },
      { mission: 'Q1_A_TA_SW__01_02', done: false, worker: '김', flightTime: '', batteryNo: '', batteryLeft: '', version: 1 },
    ] },
  { name: 'TB_01', district: '보은', address: '보은읍', lat: 36.49, lng: 127.73, mission: '' },
];
// SW_01: 같은 장소인데 미션명이 _40으로 → 미션명 변경(기록 2건). TB_01: 같은 이름·시군, 좌표가 약 11m 떨어짐 → 근접 중복.
// FAR_01: 대한민국 밖 좌표 → 경고. NEW_01: 새 장소(확인할 것 없음).
const REVIEW = fx('review.csv', [
  '이름,시군,주소,위도,경도,미션명',
  'SW_01,태안,가람면,37.277767,126.717126,Q1_A_TA_SW__01_01 ~ _40',
  'TB_01,보은,보은읍,36.4901,127.73,',
  'FAR_01,해외,어딘가,10.5,100.5,',
  'NEW_01,서산,대산읍,36.9,126.4,',
].join('\n') + '\n');
// 앞 파일로 TB_01이 36.4901에 하나 더 생기므로, 근접 중복만 있는 파일은 또 다른 좌표(36.4902)를 쓴다.
const NEAR_ONLY = fx('near-only.csv', '이름,시군,주소,위도,경도\nTB_01,보은,보은읍,36.4902,127.73\n');
const PLAIN = fx('plain.csv', '이름,시군,주소,위도,경도\nNEW_02,서산,부석면,36.8,126.5\n');

const b = await launch('ux-import');
const ev = b.ev;
const importCalls = () => ev(`__fake.calls.filter(c => c.name === 'import_places').length`);
const reviewText = () => ev(`document.querySelector('#import-panel .import-review')?.textContent.replace(/\\s+/g, ' ') ?? null`);
const waitIdle = () => b.waitFor(`!/가져오는 중/.test(document.querySelector('#import-panel')?.textContent ?? '')`, 8000);

await prepare(b, { places });
if (!hasC7) console.log('csv.js에 C7 탐지 함수가 없어 확인 화면 검사 일부를 건너뜁니다.');

// ── 경고·근접 중복·미션명 변경이 모두 있는 파일 ──
await b.setFiles('#csv-input', [REVIEW]);
await sleep(200);
let n = await importCalls();
await ev(`document.querySelector('#import-panel .btn.primary').click()`);
await sleep(300); await waitIdle();
let text = await reviewText();
let v = await ev(`({ active: document.activeElement?.id, buttons: [...document.querySelectorAll('#import-panel .import-review .button-row .btn')].map(x => x.textContent) })`);
check('보내기 전에 확인 화면: [계속]/[취소], 아직 import_places 0회', text !== null && v.buttons.join() === '계속,취소' && (await importCalls()) === n, { text, v });
check('미션명이 바뀌는 기존 장소: "SW_01(태안) 2행 · … ~ _34 → … ~ _40 · 기록 2건"', !hasC7 || /미션명이 바뀌는 기존 장소 1곳/.test(text) && /SW_01\(태안\) 2행 · Q1_A_TA_SW__01_01 ~ _34 → Q1_A_TA_SW__01_01 ~ _40 · 기록 2건/.test(text), text);
check('근접 중복: "TB_01(보은) 3행 · 기존 장소와 11m 떨어짐"', !hasC7 || /이름·시군이 같은데 위치가 다른 기존 장소 1건/.test(text) && /TB_01\(보은\) 3행 · 기존 장소와 11m 떨어짐/.test(text), text);
check('행 경고: "4행: 좌표가 대한민국 범위 … 밖입니다"', /확인할 점 1건/.test(text) && /4행: 좌표가 대한민국 범위/.test(text), text);
check('미션명 변경이 있으면 기본 초점은 [취소]', !hasC7 || v.active === 'import-review-cancel', v);
await b.shot('ux-import-review-390');

// [취소] → 보내지 않고 파일 화면으로
await ev(`document.querySelector('#import-review-cancel').click()`); await sleep(150);
v = await ev(`({ review: !!document.querySelector('#import-panel .import-review'), primary: document.querySelector('#import-panel .btn.primary')?.textContent, active: document.activeElement?.textContent })`);
check('[취소] → 아무것도 보내지 않고 [가져오기] 화면으로(초점 [가져오기])', !v.review && v.primary === '가져오기' && v.active === '가져오기' && (await importCalls()) === n, v);

// 다시 [가져오기] → [계속] → 보냄
await ev(`document.querySelector('#import-panel .btn.primary').click()`);
await sleep(300); await waitIdle();
await ev(`document.querySelector('#import-review-continue').click()`);
await sleep(300); await waitIdle();
const panel = await ev(`document.querySelector('#import-panel').textContent.replace(/\\s+/g, ' ')`);
const store = await ev(`__fake.store()`);
check('[계속] → import_places 1회, 결과 문구(저장 3 · 중복 1 중 1 갱신, 미션명 바뀐 장소 1개)', (await importCalls()) === n + 1 && /저장 3개 · 중복 1개\(그중 1개 갱신\)/.test(panel) && /미션명이 바뀐 장소 1개/.test(panel), panel);
check('가져온 뒤 DB: 미션명 _40, 근접 중복 TB_01이 하나 더 생김, 새 장소 들어옴', store.find((p) => p.name === 'SW_01').mission.endsWith('_40') && store.filter((p) => p.name === 'TB_01').length === 2 && store.some((p) => p.name === 'NEW_01'), store.map((p) => p.name));
await ev(`[...document.querySelectorAll('#import-panel .btn')].find(x => x.textContent === '닫기').click()`);

// ── 근접 중복만 있으면 기본 초점은 [계속] ──
if (hasC7) {
  await b.setFiles('#csv-input', [NEAR_ONLY]);
  await sleep(200);
  await ev(`document.querySelector('#import-panel .btn.primary').click()`);
  await sleep(300); await waitIdle();
  text = await reviewText();
  check('근접 중복만 있는 파일 → 확인 화면, 미션명 변경이 없어 기본 초점은 [계속]', /이름·시군이 같은데 위치가 다른 기존 장소/.test(text ?? '') && !/미션명이 바뀌는/.test(text ?? '') && (await ev(`document.activeElement?.id`)) === 'import-review-continue', text);
  await ev(`document.querySelector('#import-review-cancel').click()`); await sleep(100);
  await ev(`[...document.querySelectorAll('#import-panel .btn')].find(x => x.textContent === '취소').click()`);
}

// ── 여러 파일: 항목마다 파일 이름 ──
await b.setFiles('#csv-input', [PLAIN, NEAR_ONLY]);
await sleep(200);
await ev(`document.querySelector('#import-panel .btn.primary').click()`);
await sleep(300); await waitIdle();
text = await reviewText();
check('여러 파일 → 확인 항목에 파일 이름(near-only.csv 2행)', !hasC7 || /near-only\.csv 2행/.test(text ?? ''), text);
await ev(`document.querySelector('#import-review-cancel')?.click()`); await sleep(100);
await ev(`[...document.querySelectorAll('#import-panel .btn')].find(x => x.textContent === '취소')?.click()`);

// ── 확인할 것이 없으면 묻지 않고 바로 ──
n = await importCalls();
await b.setFiles('#csv-input', [PLAIN]);
await sleep(200);
await ev(`document.querySelector('#import-panel .btn.primary').click()`);
await sleep(300); await waitIdle();
check('확인할 것이 없는 파일은 확인 화면 없이 바로 가져옴', (await importCalls()) === n + 1 && !(await reviewText()), await reviewText());
await ev(`[...document.querySelectorAll('#import-panel .btn')].find(x => x.textContent === '닫기')?.click()`);
check('콘솔 오류·예외 0건', b.errors.length === 0, b.errors);
await b.close();

// ── csv.js에 C7 함수가 없는 판(옛 csv.js): 깨지지 않고 확인 없이 가져옴 ──
{
  const b2 = await launch('ux-import-old');
  // csv.js를 가로채 탐지 함수 export를 지운 판을 준다(readPlaces의 warnings도 빼서 아주 옛 모양으로).
  const oldCsv = csvSource
    .replace(/export function nearDuplicates/, 'function nearDuplicates_')
    .replace(/export function missionChanges/, 'function missionChanges_')
    .replace(/warnings: capped\(warnings\),/, '');
  await b2.send('Fetch.enable', { patterns: [{ urlPattern: '*/csv.js*', requestStage: 'Request' }] });
  b2.listeners.push((m) => {
    if (m.method !== 'Fetch.requestPaused') return;
    b2.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript; charset=utf-8' }], body: Buffer.from(oldCsv).toString('base64') });
  });
  await prepare(b2, { places });
  const exported = await b2.ev(`import('./csv.js').then((m) => ({ near: typeof m.nearDuplicates, changes: typeof m.missionChanges }))`);
  await b2.setFiles('#csv-input', [REVIEW]);
  await sleep(200);
  await b2.ev(`document.querySelector('#import-panel .btn.primary').click()`);
  await sleep(300);
  await b2.waitFor(`!/가져오는 중/.test(document.querySelector('#import-panel')?.textContent ?? '')`, 8000);
  const r = await b2.ev(`({ review: !!document.querySelector('#import-panel .import-review'), calls: __fake.calls.filter(c => c.name === 'import_places').length, panel: document.querySelector('#import-panel').textContent.replace(/\\s+/g, ' ') })`);
  check('옛 csv.js(탐지 함수·warnings 없음) → 앱이 열리고, 확인 화면 없이 그대로 가져옴', exported.near === 'undefined' && exported.changes === 'undefined' && !r.review && r.calls === 1 && /저장 3개/.test(r.panel), { exported, r });
  check('콘솔 오류·예외 0건(옛 csv.js)', b2.errors.length === 0, b2.errors);
  await b2.send('Fetch.disable');
  await finish(b2);
}
