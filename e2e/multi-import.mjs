// 옛 check-multi-import.mjs(12건) 이식: 3개 파일 끌어다 놓기 → 파일별 결과 + 합계, 실패 파일 건너뜀, 다시 놓으면 중복.
// 서버 확인(fetch /api/places)은 __fake.store()로 바꿨다. 파싱은 이제 브라우저(csv.js)에서 한다.
import fs from 'node:fs';
import { launch, prepare, Q1_CSV, sleep } from './lib.mjs';

const b = await launch('multi');
const { errors } = b;
const ev = b.ev;
const results = [];
const check = (label, ok, detail = '') => { results.push({ label, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); };
const store = () => ev('__fake.store()');

await prepare(b, {});

const q1 = fs.readFileSync(Q1_CSV, 'utf-8');
const good = '이름,시군,주소,위도,경도,미션명\nMULTI_01,서산,대산읍 인근,36.9,126.4,M__01_01 ~ _03\nMULTI_02,서산,부석면 인근,36.8,126.5,M__02_01 ~ _02\n';
const bad = '이름,주소,경도\nBAD_01,어딘가,127.0\n';
const dropFiles = async () => ev(`(() => {
  const dt = new DataTransfer();
  dt.items.add(new File([${JSON.stringify(q1)}], '홈포인트_Q1.csv', { type: 'text/csv' }));
  dt.items.add(new File([${JSON.stringify(good)}], 'extra.csv', { type: 'text/csv' }));
  dt.items.add(new File([${JSON.stringify(bad)}], 'bad.csv', { type: 'text/csv' }));
  for (const type of ['dragenter', 'dragover', 'drop']) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: dt });
    window.dispatchEvent(e);
  }
  return true;
})()`);
const waitDone = async () => {
  for (let i = 0; i < 40; i++) { await sleep(300); if (!(await ev(`!!document.querySelector('#import-panel .btn.primary:disabled') || /가져오는 중/.test(document.querySelector('#import-panel')?.textContent ?? '')`))) break; }
  await sleep(500);
};
await dropFiles(); await sleep(400);
const panelBefore = await ev(`document.querySelector('#import-panel')?.textContent.replace(/\\s+/g, ' ')`);
check('3개 파일이 패널에 나열됨', /홈포인트_Q1\.csv/.test(panelBefore) && /extra\.csv/.test(panelBefore) && /bad\.csv/.test(panelBefore) && /3개/.test(panelBefore), panelBefore?.slice(0, 160));

await ev(`document.querySelector('#import-panel .btn.primary').click()`);
await waitDone();
const panel = await ev(`document.querySelector('#import-panel')?.textContent.replace(/\\s+/g, ' ')`);
console.log('결과 패널:', panel?.slice(0, 400));
check('파일1 홈포인트_Q1: 저장 10', /홈포인트_Q1\.csv[^|]*?저장\s*10/.test(panel ?? ''));
check('파일2 extra: 저장 2', /extra\.csv[^|]*?저장\s*2/.test(panel ?? ''));
check('파일3 bad: 실패 + 한국어 메시지', /bad\.csv[^|]*?(실패|오류)[^|]*?(위도)/.test(panel ?? ''));
check('합계 줄: 저장 12', /합계[^|]*?저장\s*12/.test(panel ?? ''));
check('패널에 "false" 없음', !/false/.test(panel ?? ''));
const api = await store();
check('DB 장소 12곳(10 + 2)', api.length === 12, String(api.length));
// 접힌 시군의 줄은 DOM에 없으므로(화면 성능 개선) 목록 수는 요약 문구와 시군 머리의 수로 본다.
const listCount = await ev(`document.querySelector('#list-summary').textContent`);
const groups = await ev(`[...document.querySelectorAll('#place-list .group-head .group-name')].map(g => g.textContent.trim())`);
check('목록 12곳, 서산 그룹 추가', listCount === '장소 12개' && groups.includes('서산'), JSON.stringify({ listCount, groups }));

await ev(`document.querySelector('#import-panel .button-row .btn:not(.primary), #import-panel .btn:not(.primary)')?.click()`); await sleep(300);
await dropFiles(); await sleep(400);
await ev(`document.querySelector('#import-panel .btn.primary').click()`);
await waitDone();
const panel2 = await ev(`document.querySelector('#import-panel')?.textContent.replace(/\\s+/g, ' ')`);
console.log('재드롭 패널:', panel2?.slice(0, 300));
check('재드롭: 합계 저장 0 · 중복 12', /합계[^|]*?저장\s*0/.test(panel2 ?? '') && /중복\s*12/.test(panel2 ?? ''));
check('재드롭: bad 여전히 실패', /bad\.csv[^|]*?(실패|오류)/.test(panel2 ?? ''));
const api2 = await store();
check('DB 여전히 12곳', api2.length === 12, String(api2.length));
await ev(`document.querySelector('.panel').scrollTo(0, 0)`);
await b.shot('multi-import');
console.log('js errors:', JSON.stringify(errors));
check('JS 오류 없음', errors.length === 0);
const fails = results.filter((r) => !r.ok).length;
console.log(`\n결과: ${results.length - fails}/${results.length} 통과`);
fs.writeFileSync(new URL('./results/multi-import.json', import.meta.url), JSON.stringify({ name: 'multi-import', pass: results.length - fails, total: results.length, results }, null, 1));
await b.close();
process.exit(fails > 0 ? 1 : 0);
