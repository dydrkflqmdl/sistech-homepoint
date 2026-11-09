import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildDist, buildMarker, contentHash, findUnstampedImports, stampHtml, stampJs, stampRef } from '../scripts/build.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SHA = 'abc1234';

test('stampRef: 상대 경로에만 붙이고 이미 ?가 있으면 건드리지 않는다', () => {
  assert.equal(stampRef('./app.js', SHA), './app.js?v=abc1234');
  assert.equal(stampRef('./app.js?v=old', SHA), './app.js?v=old');
  assert.equal(stampRef('https://cdn.example.com/a.js', SHA), 'https://cdn.example.com/a.js');
  assert.equal(stampRef('//cdn.example.com/a.js', SHA), '//cdn.example.com/a.js');
  assert.equal(stampRef('/abs.js', SHA), '/abs.js');
});

test('stampHtml: 상대 자산만 바꾸고 CDN 절대 URL·앵커는 그대로 둔다', () => {
  const html = [
    '<link rel="stylesheet" href="./styles.css" />',
    '<script src="./config.js"></script>',
    '<script type="module" src="./app.js"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/x@1/dist/x.js"></script>',
    '<a href="#top">위로</a><a href="/">홈</a>',
  ].join('\n');
  const out = stampHtml(html, SHA);
  assert.match(out, /href="\.\/styles\.css\?v=abc1234"/);
  assert.match(out, /src="\.\/config\.js\?v=abc1234"/);
  assert.match(out, /src="\.\/app\.js\?v=abc1234"/);
  assert.match(out, /src="https:\/\/cdn\.jsdelivr\.net\/npm\/x@1\/dist\/x\.js"/);
  assert.match(out, /href="#top"/);
  assert.match(out, /<a href="\/">/);
});

test('stampHtml: 두 번 돌려도 ?v=가 중복되지 않는다', () => {
  const once = stampHtml('<script src="./app.js"></script>', SHA);
  assert.equal(stampHtml(once, 'zzz'), once);
  assert.equal(once.match(/\?v=/g).length, 1);
});

test('stampJs: import/from/동적 import 의 상대 모듈 지정자에 모두 붙인다', () => {
  const js = [
    "import { PALETTE } from './palette.js';",
    'import { a } from "../lib/a.js";',
    "import './side.js';",
    "const m = await import('./lazy.js');",
    "import { x } from './keep.js?v=old';",
    "import { c } from 'https://esm.sh/c';",
    "import { d } from '/abs.js';",
  ].join('\n');
  const out = stampJs(js, SHA);
  assert.match(out, /from '\.\/palette\.js\?v=abc1234'/);
  assert.match(out, /from "\.\.\/lib\/a\.js\?v=abc1234"/);
  assert.match(out, /import '\.\/side\.js\?v=abc1234'/);
  assert.match(out, /import\('\.\/lazy\.js\?v=abc1234'\)/);
  assert.match(out, /'\.\/keep\.js\?v=old'/);
  assert.match(out, /'https:\/\/esm\.sh\/c'/);
  assert.match(out, /'\/abs\.js'/);
  assert.equal(stampJs(out, 'zzz'), out);
});

test('stampJs: 여러 줄 import·템플릿 문자열·주석 낀 동적 import 도 잡는다', () => {
  const js = [
    'import {',
    '  a,',
    '  b,',
    "} from './multi.js';",
    'export {',
    '  x',
    '} from',
    "  './re.js';",
    'const m = await import(',
    "  './lazy.js'",
    ');',
    'const t = await import(`./tpl.js`);',
    "const c = await import(/* 지연 */ './cm.js');",
  ].join('\n');
  const out = stampJs(js, SHA);
  assert.match(out, /from '\.\/multi\.js\?v=abc1234'/);
  assert.match(out, /'\.\/re\.js\?v=abc1234'/);
  assert.match(out, /'\.\/lazy\.js\?v=abc1234'/);
  assert.match(out, /`\.\/tpl\.js\?v=abc1234`/);
  assert.match(out, /'\.\/cm\.js\?v=abc1234'/);
  assert.deepEqual(findUnstampedImports(out), []);
});

test('findUnstampedImports: ?v= 없는 상대 지정자만 돌려준다', () => {
  const js = [
    "import { a } from './a.js?v=1';",
    "import { b } from './b.js';",
    "import { c } from 'https://cdn.example.com/c.js';",
    'const d = await import(`./${name}.js`);',
  ].join('\n');
  assert.deepEqual(findUnstampedImports(js), ['./b.js', './${name}.js']);
  // ${…} 템플릿은 고칠 수 없으므로 stampJs 뒤에도 남는다 → 빌드가 실패해야 한다.
  assert.deepEqual(findUnstampedImports(stampJs(js, SHA)), ['./${name}.js']);
});

test('stampHtml: 파일별 버전표가 있으면 그 버전을 쓴다(config.js 내용 해시)', () => {
  const html = '<script src="./config.js"></script><script type="module" src="./app.js"></script>';
  const out = stampHtml(html, SHA, { 'config.js': `${SHA}-deadbeef` });
  assert.match(out, /src="\.\/config\.js\?v=abc1234-deadbeef"/);
  assert.match(out, /src="\.\/app\.js\?v=abc1234"/);
});

test('contentHash·buildMarker: 8자 해시와 APP_BUILD 한 줄', () => {
  assert.match(contentHash('x'), /^[0-9a-f]{8}$/);
  assert.notEqual(contentHash('a'), contentHash('b'));
  assert.equal(buildMarker('abc1234'), 'window.APP_BUILD = "abc1234";\n');
});

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hpn-build-'));
}

function fakePublic(dir, appJs = "import { x } from './lib.js';\nconst l = await import('./lazy.js');\n") {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<script src="./config.js"></script>\n<script type="module" src="./app.js"></script>\n');
  fs.writeFileSync(path.join(dir, 'app.js'), appJs);
  fs.writeFileSync(path.join(dir, 'lib.js'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(dir, 'lazy.js'), 'export default 1;\n');
}

const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon', KAKAO_JS_KEY: 'kakao' };

test('buildDist: APP_BUILD·version.json·config.js 해시 스탬프를 만든다', () => {
  const base = tmpDir();
  try {
    const pub = path.join(base, 'public');
    const dist = path.join(base, 'dist');
    fakePublic(pub);
    const r1 = buildDist({ sha: 'test123', dist, publicDir: pub, env: ENV });
    const config = fs.readFileSync(path.join(dist, 'config.js'), 'utf8');
    assert.match(config, /window\.APP_CONFIG = /);
    assert.match(config, /window\.APP_BUILD = "test123";\n$/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dist, 'version.json'), 'utf8')), { build: 'test123' });
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    assert.match(r1.configVer, /^test123-[0-9a-f]{8}$/);
    assert.ok(html.includes(`src="./config.js?v=${r1.configVer}"`));
    assert.ok(html.includes('src="./app.js?v=test123"'));
    const app = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');
    assert.ok(app.includes("'./lib.js?v=test123'") && app.includes("'./lazy.js?v=test123'"));

    // 같은 커밋이라도 Secrets(설정 값)가 바뀌면 config.js 주소가 달라진다.
    const r2 = buildDist({ sha: 'test123', dist, publicDir: pub, env: { ...ENV, KAKAO_JS_KEY: 'other' } });
    assert.notEqual(r2.configVer, r1.configVer);
    const r3 = buildDist({ sha: 'test123', dist, publicDir: pub, env: { ...ENV, KAKAO_JS_KEY: 'other' } });
    assert.equal(r3.configVer, r2.configVer);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('buildDist: 스탬프를 붙일 수 없는 상대 import 가 남으면 실패한다', () => {
  const base = tmpDir();
  try {
    const pub = path.join(base, 'public');
    fakePublic(pub, 'const n = "lazy";\nawait import(`./${n}.js`);\n');
    assert.throws(
      () => buildDist({ sha: 'test123', dist: path.join(base, 'dist'), publicDir: pub, env: ENV }),
      /캐시 스탬프\(\?v=\)가 빠진 상대 import[\s\S]*app\.js: \.\/\$\{n\}\.js/,
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('buildDist: 빌드 표시에 이상한 글자가 있으면 거절한다', () => {
  assert.throws(() => buildDist({ sha: 'a"b', dist: path.join(os.tmpdir(), 'hpn-never'), env: ENV }), /영문·숫자/);
});

test('vendor: public/vendor/supabase-js.js 는 자체 완결 ESM 이고 sha256 이 맞다', async () => {
  const file = path.join(ROOT, 'public/vendor/supabase-js.js');
  const buf = fs.readFileSync(file);
  const line = fs.readFileSync(path.join(ROOT, 'public/vendor/supabase-js.sha256'), 'utf8');
  assert.equal(line, `${crypto.createHash('sha256').update(buf).digest('hex')}  supabase-js.js\n`);
  const text = buf.toString('utf8');
  assert.deepEqual(findUnstampedImports(text), []);
  // 바깥 모듈을 부르는 import 문·동적 import 가 없어야 브라우저에서 단독으로 뜬다(node_modules 없이).
  assert.doesNotMatch(text, /(?:^|[;}\n])\s*import\s*[{*\w"']/);
  assert.doesNotMatch(text, /\bimport\s*\(/);
  const mod = await import(pathToFileURL(file).href);
  assert.deepEqual(Object.keys(mod), ['createClient']);
  assert.equal(typeof mod.createClient, 'function');
  const client = mod.createClient('https://example.supabase.co', 'anon', { auth: { persistSession: false, autoRefreshToken: false } });
  assert.equal(typeof client.rpc, 'function');
  assert.equal(typeof client.auth.signInWithPassword, 'function');
  assert.equal(typeof client.channel, 'function');
  assert.equal(typeof client.functions.invoke, 'function');
});
