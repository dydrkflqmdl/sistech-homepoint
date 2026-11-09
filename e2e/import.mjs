// 항목 4: 파일 고르기(DOM.setFileInputFiles)로 실제 CSV 여러 개 → 브라우저 파싱 → import_places 인자 = readPlaces() 결과,
// 파일별·합계 문구, 실패 파일 건너뜀, 빈 파일 안내, 갱신·미션명 바뀜 안내, 행 오류 목록.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { csv, FIXTURES, launch, prepare, PROJECT, Q1_CSV, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('import');
const { readPlaces } = await csv();

// 픽스처
const fx = (name, content) => {
  const p = path.join(FIXTURES, name);
  fs.writeFileSync(p, content);
  return p;
};
const SAMPLE = path.join(PROJECT, 'samples/sample.csv');
const extraUtf8 = '이름,시군,주소,위도,경도,미션명,메모\nMULTI_01,서산,서산 대산읍 인근,36.9,126.4,M__01_01 ~ _03,"쉼표, 메모"\nMULTI_02,서산,부석면 인근,36.8,126.5,M__02_01 ~ _02,\n';
fx('extra-utf8.csv', extraUtf8);
const EUC = path.join(FIXTURES, 'extra-euckr.csv');
fs.writeFileSync(EUC, execFileSync('iconv', ['-f', 'UTF-8', '-t', 'CP949', path.join(FIXTURES, 'extra-utf8.csv')]));
const BAD = fx('bad.csv', '이름,주소,경도\nBAD_01,어딘가,127.0\n');
const EMPTY = fx('empty.csv', '');
const BLANK = fx('blank.csv', '\n\n  \n');
const HEADER_ONLY = fx('header-only.csv', '이름,위도,경도\n');
const ROW_ERRORS = fx('row-errors.csv', '이름,위도,경도\nOK_1,36.1,127.1\n,36.2,127.2\nBAD_COORD,abc,127.3\nZERO,0,0\nOK_1,36.1,127.1\n');
const NOT_CSV = fx('notes.pdf', '%PDF-1.4 fake');
// 같은 장소(Q1 SW_01·SW_02) 다시: SW_01은 주소·미션명이 바뀌고, SW_02는 주소 칸이 비어 있다(addressGiven=false → 주소 유지)
const UPDATE = fx('update.csv', '이름,시군,주소,위도,경도,미션명\nSW_01,태안,가람면 하늘리 바뀜,37.277767,126.717126,Q1_A_TA_SW__01_01 ~ _40\nSW_02,태안,,37.167923,126.815733,\n');

const expectRows = (file) => readPlaces(fs.readFileSync(file)).places;
const b = await launch('import');
const ev = b.ev;
const panelText = () => ev(`document.querySelector('#import-panel')?.textContent.replace(/\\s+/g, ' ') ?? ''`);
const waitImport = async () => {
  await sleep(100);
  await b.waitFor(`!/가져오는 중/.test(document.querySelector('#import-panel')?.textContent ?? '')`, 10000);
  await sleep(400);
};
const importCalls = () => ev(`__fake.calls.filter(c => c.name === 'import_places').map(c => c.params.rows)`);

await prepare(b, {});

// ── A. 여러 파일(실제 경로) ──
const files = [SAMPLE, Q1_CSV, EUC, BAD, EMPTY, NOT_CSV];
await b.setFiles('#csv-input', files);
await sleep(300);
const listed = await panelText();
check('파일 6개 골라 넣기 → CSV 5개 나열 + notes.pdf 건너뜀', /파일 5개/.test(listed) && /sample\.csv/.test(listed) && /홈포인트_Q1\.csv/.test(listed) && /notes\.pdf — 건너뜀: CSV 파일이 아닙니다/.test(listed), listed);
await ev(`document.querySelector('#import-panel .btn.primary').click()`);
await waitImport();
const panel = await panelText();
console.log('결과 패널:', panel);
const calls = await importCalls();
const expected = [SAMPLE, Q1_CSV, EUC].map(expectRows);
check('import_places 3번(장소 있는 파일만, 고른 순서)', calls.length === 3, String(calls.length));
check('import_places 인자 = Node readPlaces() 결과(sample.csv)', JSON.stringify(calls[0]) === JSON.stringify(expected[0]), `${calls[0]?.length}행`);
check('import_places 인자 = readPlaces() 결과(홈포인트_Q1.csv, BOM·괄호 머리글)', JSON.stringify(calls[1]) === JSON.stringify(expected[1]), `${calls[1]?.length}행`);
check('import_places 인자 = readPlaces() 결과(EUC-KR 파일, 시군 접두 주소 제거·따옴표 쉼표)', JSON.stringify(calls[2]) === JSON.stringify(expected[2]) && calls[2]?.[0]?.address === '대산읍 인근' && calls[2]?.[0]?.memo === '쉼표, 메모', JSON.stringify(calls[2]?.[0]));
check('행 객체 키(line·name·district·address·addressGiven·phone·memo·mission·lat·lng)', JSON.stringify(Object.keys(calls[0]?.[0] ?? {})) === JSON.stringify(['line', 'name', 'district', 'address', 'addressGiven', 'phone', 'memo', 'mission', 'lat', 'lng']), JSON.stringify(Object.keys(calls[0]?.[0] ?? {})));
check('파일별 결과: sample.csv 저장 7', /sample\.csv — 저장 7 · 중복 0\(그중 0 갱신\) · 오류 0/.test(panel));
check('파일별 결과: 홈포인트_Q1.csv 저장 10', /홈포인트_Q1\.csv — 저장 10 · 중복 0\(그중 0 갱신\) · 오류 0/.test(panel));
check('파일별 결과: extra-euckr.csv 저장 2', /extra-euckr\.csv — 저장 2 · 중복 0\(그중 0 갱신\) · 오류 0/.test(panel));
check('실패 파일: bad.csv 필수 열(위도) 안내', /bad\.csv — 실패: 필수 열\(위도\)을 찾지 못했습니다\. 현재 머리글: 이름, 주소, 경도/.test(panel));
check('실패 파일: empty.csv "CSV 파일 내용이 없습니다."', /empty\.csv — 실패: CSV 파일 내용이 없습니다\./.test(panel));
check('건너뛴 파일: notes.pdf', /notes\.pdf — 건너뜀: CSV 파일이 아닙니다/.test(panel));
check('합계: 저장 19 · 중복 0 · 오류 0 · 파일 오류 2개', /합계: 저장 19 · 중복 0\(그중 0 갱신\) · 오류 0 · 파일 오류 2개/.test(panel));
const db1 = await ev('__fake.store()');
// 접힌 시군의 줄은 DOM에 없다(화면 성능 개선). 목록 수는 요약 문구로, 펼치면 19줄인지도 본다.
const list1 = await ev(`(() => { const summary = document.querySelector('#list-summary').textContent; const collapsedRows = document.querySelectorAll('#place-list button[data-id]').length; __e2e.openAll(); const rows = document.querySelectorAll('#place-list button[data-id]').length; __e2e.collapseAll(); return { summary, collapsedRows, rows, groups: [...document.querySelectorAll('#place-list .group-name')].map(g => g.textContent) }; })()`);
check('DB 19곳·목록 19곳(다시 받음, 접힌 시군은 줄을 만들지 않고 펼치면 19줄)', db1.length === 19 && list1.summary === '장소 19개' && list1.collapsedRows === 0 && list1.rows === 19, { db: db1.length, list1 });
check('가져온 뒤 지도를 장소에 맞춤(setBounds)', await ev(`window.__kakaoMaps[0].__calls.some(c => c[0] === 'setBounds')`));
await b.shot('import-multi-390');
await ev(`[...document.querySelectorAll('#import-panel .btn')].find(x => x.textContent === '닫기').click()`);
await sleep(200);

// ── B. 같은 장소 다시(갱신·미션명 바뀜). SW_01에 미션 기록·메모를 먼저 남긴다(다른 기기의 변경 → 실시간으로 화면에 들어온다) ──
await ev(`__fake.remoteChange((db) => { const p = db.places.find(x => x.name === 'SW_01'); p.memo = '남길 메모'; p.phone = '010'; db.missions.push({ id: db.nextMid++, placeId: p.id, mission: 'Q1_A_TA_SW__01_01', done: true, worker: 'a', flightTime: 'b', batteryNo: 'c', batteryLeft: '1', version: 1, updatedAt: '' }); })`);
await b.waitFor(`(__e2e.row('SW_01')?.querySelector('.badge')?.textContent ?? '').includes('1/34')`, 3000);
await ev(`__e2e.collapseAll()`);
const before = await ev(`__fake.store().find(p => p.name === 'SW_02').address`);
await b.setFiles('#csv-input', [UPDATE]);
await sleep(200);
const single0 = await panelText();
check('파일 하나 → 파일 이름만(예전 모습)', /CSV 가져오기×update\.csv가져오기취소/.test(single0), single0);
await ev(`document.querySelector('#import-panel .btn.primary').click()`);
await waitImport();
// 가져오기 전 확인(C7): 미션명이 바뀌는 기존 장소와 그 기록 수, 기본 초점은 [취소]. [계속]을 눌러야 보낸다.
const review = await ev(`({ text: document.querySelector('#import-panel .import-review')?.textContent.replace(/\s+/g, ' ') ?? null, active: document.activeElement?.id, sent: __fake.calls.filter(c => c.name === 'import_places').length })`);
const sentBefore = (await importCalls()).length;
check('미션명이 바뀌는 파일 → 보내기 전에 확인 화면(SW_01 _34 → _40 · 기록 1건), 기본 초점 [취소], 아직 안 보냄',
  /미션명이 바뀌는 기존 장소 1곳/.test(review.text ?? '') && /SW_01\(태안\) 2행 · Q1_A_TA_SW__01_01 ~ _34 → Q1_A_TA_SW__01_01 ~ _40 · 기록 1건/.test(review.text ?? '') && review.active === 'import-review-cancel' && review.sent === sentBefore, review);
await ev(`document.querySelector('#import-review-continue').click()`);
await waitImport();
const single = await panelText();
const call = (await importCalls()).at(-1);
check('import_places 인자 = readPlaces()(addressGiven false 포함)', JSON.stringify(call) === JSON.stringify(expectRows(UPDATE)) && call[1].addressGiven === false, JSON.stringify(call?.[1]));
check('단일 결과: "저장 0개 · 중복 2개(그중 1개 갱신) · 오류 0개"', /저장 0개 · 중복 2개\(그중 1개 갱신\) · 오류 0개/.test(single), single);
check('갱신 안내 + 미션명 바뀐 장소 1개 안내', /갱신: CSV의 주소·미션명이 달라 그 값만 바꾼 장소/.test(single) && /미션명이 바뀐 장소 1개/.test(single), single);
const sw = await ev(`(() => { const ps = __fake.store(); return { sw01: ps.find(p => p.name === 'SW_01'), sw02: ps.find(p => p.name === 'SW_02') }; })()`);
check('갱신: 주소·미션명만 바뀌고 메모·전화·미션 기록 보존', sw.sw01.address === '가람면 하늘리 바뀜' && sw.sw01.mission === 'Q1_A_TA_SW__01_01 ~ _40' && sw.sw01.memo === '남길 메모' && sw.sw01.phone === '010' && sw.sw01.missions.length === 1, sw.sw01);
check('주소 칸이 빈 행은 주소를 지우지 않음', sw.sw02.address === before && before !== '', { before, after: sw.sw02.address });
await sleep(400);
const shown = await ev(`(() => { const b = __e2e.row('SW_01'); return { addr: b.querySelector('.addr').textContent, badge: b.querySelector('.badge')?.textContent }; })()`);
check('목록에 바뀐 주소·미션 수(1/40) 반영', shown.addr === '가람면 하늘리 바뀜' && /미션 1\/40/.test(shown.badge ?? ''), shown);
await ev(`[...document.querySelectorAll('#import-panel .btn')].find(x => x.textContent === '닫기').click()`);

// ── C. 빈 파일 하나 / 공백만 / 머리글만 / 행 오류 ──
const singleToast = async (file) => {
  await b.setFiles('#csv-input', [file]);
  await sleep(200);
  const n = (await importCalls()).length;
  await ev(`document.querySelector('#toast').hidden = true; document.querySelector('#import-panel .btn.primary').click()`);
  await waitImport();
  const out = await ev(`({ toast: document.querySelector('#toast').hidden ? null : document.querySelector('#toast').textContent, panel: document.querySelector('#import-panel').textContent.replace(/\\s+/g, ' '), button: document.querySelector('#import-panel .btn.primary')?.textContent })`);
  out.calls = (await importCalls()).length - n;
  return out;
};
const e1 = await singleToast(EMPTY);
check('빈 파일 하나 → 알림 "CSV 파일 내용이 없습니다." + 가져오기 화면에 남음, 호출 없음', e1.toast === 'CSV 파일 내용이 없습니다.' && e1.button === '가져오기' && e1.calls === 0, e1);
await ev(`[...document.querySelectorAll('#import-panel .btn')].find(x => x.textContent === '취소').click()`);
const e2 = await singleToast(BLANK);
check('빈 줄만 있는 파일 → "CSV 파일이 비어 있습니다."', e2.toast === 'CSV 파일이 비어 있습니다.' && e2.calls === 0, e2);
await ev(`[...document.querySelectorAll('#import-panel .btn')].find(x => x.textContent === '취소').click()`);
const e3 = await singleToast(HEADER_ONLY);
check('머리글만 있는 파일 → 저장 0개, import_places 호출 없음', /저장 0개 · 중복 0개 · 오류 0개/.test(e3.panel) && e3.calls === 0, e3);
await ev(`[...document.querySelectorAll('#import-panel .btn')].find(x => x.textContent === '닫기').click()`);
const e4 = await singleToast(ROW_ERRORS);
check('행 오류: 저장 1개 · 오류 4개 + 줄 번호·이유 목록', /저장 1개 · 중복 0개 · 오류 4개/.test(e4.panel) && /3행: 이름이 비어 있습니다\./.test(e4.panel) && /4행: 좌표가 숫자가 아닙니다/.test(e4.panel) && /5행: 좌표가 비어 있습니다\(0, 0\)/.test(e4.panel) && /6행: 2행과 같은 장소/.test(e4.panel) && e4.calls === 1, e4.panel);
await ev(`[...document.querySelectorAll('#import-panel .btn')].find(x => x.textContent === '닫기').click()`);

// ── D. CSV가 아닌 파일만 ──
await ev(`document.querySelector('#toast').hidden = true`);
await b.setFiles('#csv-input', [NOT_CSV]);
await sleep(200);
const d = await ev(`({ toast: document.querySelector('#toast').textContent, panel: !document.querySelector('#import-panel').hidden })`);
check('CSV 아닌 파일만 → 알림 "CSV 파일이 아닙니다." 창 안 열림', d.toast === 'CSV 파일이 아닙니다.' && !d.panel, d);

// ── E. 같은 파일 다시 고르기(입력값 비움 확인) ──
await b.setFiles('#csv-input', [SAMPLE]);
await sleep(200);
check('같은 파일을 다시 골라도 창이 열림(input.value 비움)', await ev(`!document.querySelector('#import-panel').hidden && /sample\\.csv/.test(document.querySelector('#import-panel').textContent)`));

check('콘솔 예외 0건', b.errors.length === 0, b.errors);
await finish(b);
