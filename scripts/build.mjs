// 배포용 빌드: public/ → dist/ 복사, config.js 생성, 캐시 스탬프(?v=<sha>) 부착.
// 사용법: node scripts/build.mjs [GIT_SHA]   (생략하면 git rev-parse --short HEAD)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeConfig } from './write-config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

// 상대 참조인지: 스킴(http:, data: 등), //, /, # 로 시작하지 않으면 상대 경로.
function isRelative(ref) {
  return ref !== '' && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(ref);
}

// 참조에 ?v=<sha>를 붙인다. 이미 ?가 있으면 그대로 둔다. #해시는 뒤로 보낸다.
export function stampRef(ref, sha) {
  if (!isRelative(ref) || ref.includes('?')) return ref;
  const i = ref.indexOf('#');
  return i === -1 ? `${ref}?v=${sha}` : `${ref.slice(0, i)}?v=${sha}${ref.slice(i)}`;
}

const ASSET_EXT = /\.(?:m?js|css|svg|png|jpe?g|gif|webp|ico|json|webmanifest)$/i;

// index.html 의 src/href 중 상대 경로 자산 파일에 스탬프를 붙인다.
export function stampHtml(html, sha) {
  return html.replace(/(\b(?:src|href)\s*=\s*)(["'])([^"']*)\2/gi, (m, pre, q, ref) => {
    const bare = ref.split('#')[0];
    if (!isRelative(ref) || !ASSET_EXT.test(bare)) return m;
    return `${pre}${q}${stampRef(ref, sha)}${q}`;
  });
}

// JS 의 상대 모듈 지정자(from '...', import '...', import('...'))에 스탬프를 붙인다.
export function stampJs(js, sha) {
  const re = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"'\n]*)\2/g;
  return js.replace(re, (m, pre, q, ref) => `${pre}${q}${stampRef(ref, sha)}${q}`);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

function main() {
  let sha = process.argv[2] || process.env.GIT_SHA;
  if (!sha) {
    try {
      sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    } catch {
      sha = String(Date.now());
      console.warn(`경고: git 커밋 해시를 얻지 못해 시각(${sha})을 캐시 스탬프로 씁니다.`);
    }
  }
  const dist = path.join(root, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  copyDir(path.join(root, 'public'), dist);
  // public/config.js 가 복사됐더라도 dist 쪽을 새로 만든다.
  writeConfig('dist/config.js');

  for (const file of walk(dist)) {
    const ext = path.extname(file);
    if (ext !== '.html' && ext !== '.js' && ext !== '.mjs') continue;
    const src = fs.readFileSync(file, 'utf8');
    const out = ext === '.html' ? stampHtml(src, sha) : stampJs(src, sha);
    if (out !== src) fs.writeFileSync(file, out);
  }
  console.log(`빌드 완료: ${dist} (스탬프 ?v=${sha})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
