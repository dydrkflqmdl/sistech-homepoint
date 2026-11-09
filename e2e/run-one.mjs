// 시나리오 하나(또는 몇 개)만 돌린다: E2E_PORT=4198 node e2e/run-one.mjs accounts shots
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
let code = 0;
try {
  for (const s of process.argv.slice(2)) {
    fs.rmSync(path.join(RESULTS, s + '.json'), { force: true });
    const r = spawnSync(process.execPath, [path.join(E2E, s + '.mjs')], { env: { ...process.env, E2E_PORT: String(PORT) }, encoding: 'utf-8', timeout: 300000, stdio: 'inherit' });
    if (r.status !== 0) code = 1;
  }
} finally {
  server.kill();
  fs.rmSync(path.join(PROJECT, 'public/config.js'), { force: true });
  fs.rmSync(path.join(E2E, 'profiles'), { recursive: true, force: true });
}
process.exit(code);
