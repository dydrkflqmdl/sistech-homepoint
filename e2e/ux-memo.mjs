// B-4: 메모 자동 저장과 상태 표시, 충돌(C1).
// 입력 후 1초 뒤 저장(디바운스), 칸을 떠나거나(change)·페이지를 떠나거나(pagehide)·화면을 벗어나면(visibilitychange) 바로 저장.
// 메모 아래 "저장됨/저장 중…/저장 안 됨 [다시 저장]" 고정 표시. 저장 못 한 메모는 닫기·장소 이동 전에 묻는다.
// 실시간 갱신이 저장 안 한 글을 덮지 않고, 다른 기기가 먼저 바꿨으면 "다른 기기에서 메모가 바뀌었습니다" + 두 갈래.
import { launch, prepare, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('ux-memo');
const b = await launch('ux-memo');
const ev = b.ev;
const places = [
  { name: 'SW_01', district: '태안', address: '소원면', lat: 36.766667, lng: 126.149826, mission: '', memo: '' },
  { name: 'SW_02', district: '태안', address: '파도리', lat: 36.741223, lng: 126.144333, mission: '', memo: '원래' },
  { name: 'TB_01', district: '보은', address: '보은읍', lat: 36.49, lng: 127.73, mission: '', memo: '' },
];
const memoCalls = () => ev(`__fake.calls.filter(c => c.name === 'update_memo').map(c => c.params)`);
const typeMemo = (text) => ev(`(() => { const t = document.querySelector('#memo-input'); t.focus(); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const status = () => ev(`document.querySelector('#memo-status')?.textContent.trim() ?? null`);
const dbMemo = (name) => ev(`__fake.store().find(p => p.name === ${JSON.stringify(name)}).memo`);
const confirmAnswer = (yes) => ev(`window.confirm = (m) => { window.__confirms.push(String(m)); return ${yes}; }`);

await prepare(b, { places });
await ev(`__e2e.row('SW_01').click()`); await sleep(250);

// ── 1초 디바운스 ──
let n = (await memoCalls()).length;
await typeMemo('a'); await sleep(80);
await typeMemo('ab'); await sleep(80);
await typeMemo('abc');
const typing = await status();
await sleep(600);
const midCalls = (await memoCalls()).length - n;
await sleep(700);
let calls = await memoCalls();
check('연달아 치는 동안은 "입력 중…", 1초가 지나기 전에는 보내지 않음', typing === '입력 중…' && midCalls === 0, { typing, midCalls });
check('마지막 입력 1초 뒤 한 번만 저장(update_memo 3인자: base는 원래 메모 "")', calls.length === n + 1 && calls.at(-1).p_memo === 'abc' && calls.at(-1).p_base_memo === '', calls.at(-1));
await b.waitFor(`document.querySelector('#memo-status')?.textContent.trim() === '저장됨'`, 2000);
check('저장 뒤 메모 아래 "저장됨" 고정 표시·DB 반영·목록 메모 표시 켜짐', (await status()) === '저장됨' && (await dbMemo('SW_01')) === 'abc' && (await ev(`__e2e.row('SW_01').querySelector('.memo-icon').classList.contains('on')`)), await status());
check('저장하는 동안 메모 칸은 그대로(다시 만들지 않아 초점·커서 유지)', await ev(`document.activeElement === document.querySelector('#memo-input')`));
await sleep(3600);
check('"저장됨"은 알림처럼 사라지지 않음(3.6초 뒤에도)', (await status()) === '저장됨');

// ── 칸을 떠나면(change) 바로 저장 ──
n = (await memoCalls()).length;
await ev(`(() => { const t = document.querySelector('#memo-input'); t.value = 'abcd'; t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await sleep(200);
calls = await memoCalls();
check('칸을 떠나면(change) 1초를 기다리지 않고 바로 저장(base는 앞서 저장한 abc)', calls.length === n + 1 && calls.at(-1).p_memo === 'abcd' && calls.at(-1).p_base_memo === 'abc', calls.at(-1));

// ── pagehide·visibilitychange(hidden)에서 바로 저장 ──
n = (await memoCalls()).length;
await typeMemo('abcde');
await ev(`window.dispatchEvent(new Event('pagehide'))`);
await sleep(150);
check('pagehide에서 기다리던 메모를 바로 저장', (await memoCalls()).length === n + 1 && (await memoCalls()).at(-1).p_memo === 'abcde');
n = (await memoCalls()).length;
await typeMemo('abcdef');
await ev(`(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState; })()`);
await sleep(150);
check('화면을 벗어나면(visibilitychange hidden) 바로 저장', (await memoCalls()).length === n + 1 && (await memoCalls()).at(-1).p_memo === 'abcdef');
await b.waitFor(`document.querySelector('#memo-status')?.textContent.trim() === '저장됨'`, 2000);

// ── 실패: "저장 안 됨 [다시 저장]", 닫기 전에 묻기 ──
await ev(`__fake.failNext({ status: 500, code: 'XX000', message: 'boom', name: 'update_memo' })`);
await typeMemo('실패할 메모');
await b.waitFor(`/저장 안 됨/.test(document.querySelector('#memo-status')?.textContent ?? '')`, 3000);
let v = await ev(`({ text: document.querySelector('#memo-status').textContent, retry: !!document.querySelector('#memo-status .memo-retry'), value: document.querySelector('#memo-input').value })`);
check('저장 실패 → "저장 안 됨" + 이유 + [다시 저장], 적던 글은 그대로', /저장 안 됨/.test(v.text) && /서버 오류가 발생했습니다\. \(XX000\)/.test(v.text) && v.retry && v.value === '실패할 메모', v);
await confirmAnswer(false);
let c0 = await ev(`window.__confirms.length`);
await ev(`document.querySelector('#detail .detail-head .icon-btn').click()`); await sleep(150);
v = await ev(`({ open: !document.querySelector('#detail').hidden, asked: window.__confirms.slice(${c0}) })`);
check('저장 못 한 메모가 있으면 닫기 전에 묻고(메모 문구), 아니오면 그대로', v.open && v.asked.length === 1 && /저장하지 않은 메모가 있습니다/.test(v.asked[0]), v);
await ev(`__fake.rpcDelay.get_places = 0`);
c0 = await ev(`window.__confirms.length`);
await ev(`__e2e.row('SW_02').click()`); await sleep(150);
check('다른 장소를 눌러도 먼저 묻고, 아니오면 이 장소에 남음', (await ev(`document.querySelector('#detail-title').textContent.startsWith('SW_01')`)) && (await ev(`window.__confirms.length`)) === c0 + 1);
await confirmAnswer(true);

// ── 실시간 갱신이 저장 안 한 글을 덮지 않음 → [다시 저장]하면 충돌로 알림 ──
await ev(`__fake.remoteChange((db) => { db.places.find(p => p.name === 'SW_01').memo = '원격에서 바꿈'; })`);
await sleep(700);
v = await ev(`({ value: document.querySelector('#memo-input').value, status: document.querySelector('#memo-status').textContent })`);
check('실시간으로 다른 기기 메모가 와도 저장 안 한 글(실패할 메모)을 덮지 않음', v.value === '실패할 메모' && /저장 안 됨/.test(v.status), v);
n = (await memoCalls()).length;
await ev(`document.querySelector('#memo-status .memo-retry').click()`); await sleep(200);
v = await ev(`({ msg: document.querySelector('#memo-status .memo-conflict-message')?.textContent, latest: document.querySelector('#memo-status .memo-latest')?.textContent, role: document.querySelector('#memo-status .memo-conflict')?.getAttribute('role') })`);
check('[다시 저장] → 이미 받은 최신 메모와 달라 보내기 전에 충돌 안내("다른 기기에서 메모가 바뀌었습니다", 최신 메모 표시)',
  v.msg === '다른 기기에서 메모가 바뀌었습니다.' && v.latest === '최신 메모: 원격에서 바꿈' && v.role === 'alert' && (await memoCalls()).length === n, v);
// [최신 메모 보기]
await ev(`document.querySelector('#memo-status .memo-take-latest').click()`); await sleep(150);
v = await ev(`({ value: document.querySelector('#memo-input').value, status: document.querySelector('#memo-status').textContent.trim(), active: document.activeElement?.id })`);
check('[최신 메모 보기] → 칸에 최신 메모, "저장됨", 초점은 메모 칸', v.value === '원격에서 바꿈' && v.status === '저장됨' && v.active === 'memo-input', v);

// ── 서버가 충돌을 알림(C1): 그사이 다른 기기가 바꾼 것을 화면이 아직 모를 때 ──
await ev(`__e2e.row('SW_02').click()`); await sleep(250);
await typeMemo('내 메모');
await ev(`__fake.remoteChange((db) => { db.places.find(p => p.name === 'SW_02').memo = '서버가 바꿈'; }, { notify: false })`);
await b.waitFor(`!!document.querySelector('#memo-status .memo-conflict')`, 3000);
calls = await memoCalls();
v = await ev(`({ latest: document.querySelector('#memo-status .memo-latest')?.textContent, value: document.querySelector('#memo-input').value })`);
check('서버가 base(원래)와 달라 conflict → 안내, 내 글은 칸에 그대로', calls.at(-1).p_base_memo === '원래' && v.latest === '최신 메모: 서버가 바꿈' && v.value === '내 메모' && (await dbMemo('SW_02')) === '서버가 바꿈', { last: calls.at(-1), v });
// [내 메모로 저장]
await ev(`document.querySelector('#memo-status .memo-keep-mine').click()`);
await b.waitFor(`document.querySelector('#memo-status')?.textContent.trim() === '저장됨'`, 3000);
calls = await memoCalls();
check('[내 메모로 저장] → 최신 메모를 base로 덮어씀(DB "내 메모")', calls.at(-1).p_base_memo === '서버가 바꿈' && calls.at(-1).p_memo === '내 메모' && (await dbMemo('SW_02')) === '내 메모', calls.at(-1));

// ── 옛 서버(update_memo 인자 2개): 3인자가 없으면 2인자로 다시 저장 ──
await ev(`__fake.legacyMemo = true`);
n = (await memoCalls()).length;
await typeMemo('옛 서버에 저장');
await b.waitFor(`document.querySelector('#memo-status')?.textContent.trim() === '저장됨'`, 3000);
calls = (await memoCalls()).slice(n);
check('옛 서버: p_base_memo가 있는 호출이 PGRST202 → 2인자로 다시 불러 저장, 응답(장소 그대로)은 저장됨으로', calls.length === 2 && 'p_base_memo' in calls[0] && !('p_base_memo' in calls[1]) && (await dbMemo('SW_02')) === '옛 서버에 저장', calls);
n = (await memoCalls()).length;
await typeMemo('옛 서버 두 번째');
await b.waitFor(`document.querySelector('#memo-status')?.textContent.trim() === '저장됨'`, 3000);
calls = (await memoCalls()).slice(n);
check('한 번 2인자로 바뀐 뒤에는 처음부터 2인자로 보냄', calls.length === 1 && !('p_base_memo' in calls[0]), calls);
await ev(`__fake.legacyMemo = false`);

// ── 시간 초과: "응답이 없습니다…" + [다시 저장] ──
await ev(`import('./api.js').then((m) => m.setCallTimeout(700))`);
await ev(`__fake.rpcDelay.update_memo = 5000`);
await typeMemo('느린 연결');
await b.waitFor(`/저장 안 됨/.test(document.querySelector('#memo-status')?.textContent ?? '')`, 4000);
v = await status();
check('응답이 20초(점검에서는 0.7초) 안에 없으면 "저장 안 됨 · 응답이 없습니다. 입력한 내용은 그대로 있습니다."', /응답이 없습니다\. 입력한 내용은 그대로 있습니다\./.test(v ?? ''), v);
await ev(`__fake.rpcDelay.update_memo = 0`);
await ev(`import('./api.js').then((m) => m.setCallTimeout(20000))`);
await ev(`document.querySelector('#memo-status .memo-retry').click()`);
await b.waitFor(`document.querySelector('#memo-status')?.textContent.trim() === '저장됨'`, 3000);
check('[다시 저장] → 저장됨', (await status()) === '저장됨' && (await dbMemo('SW_02')) === '느린 연결');

// ── 다른 장소로 옮겨 가면 기다리던 메모를 바로 저장(묻지 않음) ──
n = (await memoCalls()).length;
c0 = await ev(`window.__confirms.length`);
await typeMemo('옮기기 직전');
await ev(`__e2e.row('TB_01').click()`); await sleep(300);
check('입력 직후(1초 전) 다른 장소를 누르면 묻지 않고 바로 저장하고 옮겨 감', (await memoCalls()).length === n + 1 && (await ev(`window.__confirms.length`)) === c0 && (await dbMemo('SW_02')) === '옮기기 직전' && (await ev(`document.querySelector('#detail-title').textContent.startsWith('TB_01')`)));

check('콘솔 오류·예외 0건', b.errors.length === 0, b.errors);
await finish(b);
