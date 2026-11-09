// 전체 E2E 실행: dev 서버를 띄우고(public/config.js 생성) 스크립트를 차례로 돌린 뒤 서버를 내리고 config.js를 지운다.
// 사용(저장소 뿌리에서): E2E_PORT=4198 node e2e/run-all.mjs   (4100은 사용자 서버라 쓰지 않는다. 자세한 것은 e2e/README.md)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { E2E, PORT, PROJECT, RESULTS, sleep } from './lib.mjs';

if (PORT === 4100) throw new Error('4100은 사용자 서버 포트입니다.');
const server = spawn(process.execPath, ['scripts/dev.mjs'], {
  cwd: PROJECT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), SUPABASE_URL: `http://localhost:${PORT}`, SUPABASE_ANON_KEY: 'test', KAKAO_JS_KEY: 'test' },
});
let ready = false;
server.stdout.on('data', (d) => { if (/localhost/.test(String(d))) ready = true; });
server.stderr.on('data', (d) => process.stderr.write(d));
for (let i = 0; i < 50 && !ready; i++) await sleep(100);
if (!ready) { server.kill(); throw new Error('dev 서버가 뜨지 않음'); }

const scripts = [
  'boot-login', 'missions', 'regress', 'multi-import', 'import', 'features', 'login-id', 'accounts', 'shots',
  // 화면 개선(사용자 요청 A-1·A-2, 리뷰 B-3~B-12)
  'ux-worker', 'ux-scroll', 'ux-memo', 'ux-sync', 'ux-perf', 'ux-map', 'ux-a11y', 'ux-accounts', 'ux-import',
];
for (const f of fs.readdirSync(RESULTS)) if (f.startsWith('rpc-')) fs.rmSync(path.join(RESULTS, f));
const rows = [];
try {
  for (const s of scripts) {
    fs.rmSync(path.join(RESULTS, s + '.json'), { force: true });
    const r = spawnSync(process.execPath, [path.join(E2E, s + '.mjs')], { env: { ...process.env, E2E_PORT: String(PORT) }, encoding: 'utf-8', timeout: 300000 });
    fs.writeFileSync(path.join(RESULTS, s + '.log'), (r.stdout ?? '') + (r.stderr ?? ''));
    const file = path.join(RESULTS, s + '.json');
    // 스크립트가 도중에 죽으면 결과 파일이 없다 → 실패로 센다(예전 결과를 읽지 않게 위에서 지웠다).
    const j = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : { pass: 0, total: 1, results: [{ ok: false, label: `스크립트가 끝나지 않음(종료 코드 ${r.status}) — results/${s}.log 참고` }] };
    rows.push({ s, pass: j.pass, total: j.total, fails: j.results.filter((x) => !x.ok).map((x) => x.label) });
    console.log(`${j.pass === j.total ? 'OK  ' : 'FAIL'} ${s}: ${j.pass}/${j.total}${j.pass === j.total ? '' : ' — ' + rows.at(-1).fails.join(' / ')}`);
  }
} finally {
  server.kill();
  fs.rmSync(path.join(PROJECT, 'public/config.js'), { force: true });
  fs.rmSync(path.join(E2E, 'profiles'), { recursive: true, force: true });
}
// 삭제된 list_login_logs: 모든 스크립트·브라우저를 합쳐 0회여야 한다.
const rpc = {};
for (const f of fs.readdirSync(RESULTS).filter((f) => f.startsWith('rpc-'))) for (const [k, n] of Object.entries(JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf-8')))) rpc[k] = (rpc[k] ?? 0) + n;
const listLogs = rpc.list_login_logs ?? 0;
console.log(`${listLogs === 0 ? 'OK  ' : 'FAIL'} 전체: list_login_logs 호출 ${listLogs}회 (RPC 합계 ${JSON.stringify(rpc)})`);
rows.push({ s: 'rpc', pass: listLogs === 0 ? 1 : 0, total: 1 });
const pass = rows.reduce((n, r) => n + r.pass, 0), total = rows.reduce((n, r) => n + r.total, 0);
console.log(`\n합계: ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
