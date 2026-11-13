// 로컬 개발 서버. public/ 을 정적으로 서빙하고, config.js만 환경변수로 만들어 메모리에서 내보낸다.
// 사용법: npm start   (포트는 PORT 환경변수, 기본 4100 — 카카오 콘솔에 등록된 주소)
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkedConfigSource } from './write-config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = path.join(root, 'public');
const port = Number(process.env.PORT) || 4100;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

// config.js는 파일로 쓰지 않고 이 서버의 환경변수로 만들어 메모리에서 내보낸다.
// 예전처럼 public/config.js 파일을 쓰면, 자동 점검(e2e)이 띄운 다른 포트의 서버가 같은 파일을 테스트 값으로 덮어쓰거나 지워서
// 사람이 보던 4100 서버 화면이 깨졌다. 이제 서버마다 자기 설정을 따로 낸다(public/config.js 파일이 남아 있어도 읽지 않는다).
let CONFIG;
try {
  CONFIG = checkedConfigSource();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const send = (status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method Not Allowed');

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(400, 'Bad Request');
  }
  if (pathname.includes('\0')) return send(400, 'Bad Request');
  if (pathname.endsWith('/')) pathname += 'index.html';
  if (pathname === '/config.js') return send(200, CONFIG, MIME['.js']);

  // 경로 탐색 차단: public/ 밖으로 나가는 경로는 거절한다.
  const file = path.resolve(publicDir, '.' + pathname);
  if (file !== publicDir && !file.startsWith(publicDir + path.sep)) return send(403, 'Forbidden');

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(404, 'Not Found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`${port}번 포트를 이미 다른 프로그램이 쓰고 있습니다. .env의 PORT를 바꾸거나 그 프로그램을 끄세요.`);
  else console.error(err);
  process.exit(1);
});

server.listen(port, () => {
  console.log(`HOME POINT NAVI(홈포인트 네비): http://localhost:${port}`);
  for (const a of Object.values(os.networkInterfaces()).flat()) {
    if (a.family === 'IPv4' && !a.internal) console.log(`다른 기기에서: http://${a.address}:${port}`);
  }
});
