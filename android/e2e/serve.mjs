// 에뮬레이터 점검용 정적 서버: public/을 그대로 내보내되 config.js만 가짜 값으로 바꿔 준다.
// public/config.js(사람이 쓰는 개발 서버 설정)는 읽지도 쓰지도 않는다.
// 사용: node android/e2e/serve.mjs [포트=4197]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const port = Number(process.argv[2] || 4197);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};
const CONFIG = `window.APP_CONFIG = { kakaoJsKey: "test", supabaseUrl: "http://localhost:${port}", supabaseAnonKey: "test" };\n`;

http
  .createServer((req, res) => {
    const send = (code, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    };
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/config.js') return send(200, CONFIG, MIME['.js']);
    if (p === '/__blank') return send(200, '<!doctype html><title>blank</title>', MIME['.html']);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, path.normalize(p));
    if (!file.startsWith(root + path.sep)) return send(403, 'forbidden');
    fs.readFile(file, (err, data) => (err ? send(404, 'not found') : send(200, data, MIME[path.extname(file)] ?? 'application/octet-stream')));
  })
  .listen(port, '127.0.0.1', () => console.log('ready', port));
