import test from 'node:test';
import assert from 'node:assert/strict';
import { stampHtml, stampJs, stampRef } from '../scripts/build.mjs';

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
