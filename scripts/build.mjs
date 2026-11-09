// 배포용 빌드: public/ → dist/ 복사, config.js 생성, 캐시 스탬프(?v=<sha>) 부착.
// 사용법: node scripts/build.mjs [GIT_SHA]   (생략하면 git rev-parse --short HEAD)
//
// 만드는 것
// - dist/config.js       Secrets 값(window.APP_CONFIG) + 빌드 표시(window.APP_BUILD = "<sha>")
// - dist/version.json    {"build":"<sha>"}  (계약 C8: 화면이 새 배포를 알아채는 데 쓴다)
// - 스탬프               HTML 의 상대 자산과 JS 의 상대 import 에 ?v=<sha> 를 붙인다.
//                        config.js 만은 ?v=<sha>-<내용 해시 8자>: Secrets 만 바꿔 같은 커밋을 다시 배포해도 주소가 바뀐다.
// - 검사                 스탬프 뒤에도 ?v= 없는 상대 import 가 dist/*.js 에 남아 있으면 빌드를 실패시킨다.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeConfig } from './write-config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

// 상대 참조인지: 스킴(http:, data: 등), //, /, # 로 시작하지 않으면 상대 경로.
function isRelative(ref) {
  return ref !== '' && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(ref);
}

// 참조에 ?v=<ver>를 붙인다. 이미 ?가 있으면 그대로 둔다. #해시는 뒤로 보낸다.
export function stampRef(ref, ver) {
  if (!isRelative(ref) || ref.includes('?')) return ref;
  const i = ref.indexOf('#');
  return i === -1 ? `${ref}?v=${ver}` : `${ref.slice(0, i)}?v=${ver}${ref.slice(i)}`;
}

// './a/../b.js#x' → 'b.js' (스탬프 버전표의 열쇠)
function refKey(ref) {
  return path.posix.normalize(ref.split('#')[0]).replace(/^\.\//, '');
}

const ASSET_EXT = /\.(?:m?js|css|svg|png|jpe?g|gif|webp|ico|json|webmanifest)$/i;

// index.html 의 src/href 중 상대 경로 자산 파일에 스탬프를 붙인다.
// versions: { 'config.js': '<sha>-<hash>' } 처럼 파일별로 다른 버전을 줄 때(열쇠는 HTML 파일 기준 상대 경로).
export function stampHtml(html, sha, versions = {}) {
  return html.replace(/(\b(?:src|href)\s*=\s*)(["'])([^"']*)\2/gi, (m, pre, q, ref) => {
    const bare = ref.split('#')[0];
    if (!isRelative(ref) || !ASSET_EXT.test(bare)) return m;
    return `${pre}${q}${stampRef(ref, versions[refKey(ref)] ?? sha)}${q}`;
  });
}

// 상대 모듈 지정자 자리: from '…', import '…', import('…') / import(`…`) / import(/* 주석 */ '…').
// 여러 줄에 걸친 import { a, b } from './x.js' 도 from 뒤만 보므로 잡힌다.
const SPECIFIER_RE = /(\bfrom\s*|\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)*|\bimport\s+)(["'`])(\.{1,2}\/[^"'`\n]*)\2/g;

// JS 의 상대 모듈 지정자에 스탬프를 붙인다. ${…} 가 든 템플릿 문자열은 고칠 수 없어 그대로 둔다(아래 검사에서 걸린다).
export function stampJs(js, sha) {
  return js.replace(SPECIFIER_RE, (m, pre, q, ref) => {
    if (q === '`' && ref.includes('${')) return m;
    return `${pre}${q}${stampRef(ref, sha)}${q}`;
  });
}

// ?v= 가 없는 상대 모듈 지정자 목록. 비어 있어야 정상이다.
export function findUnstampedImports(js) {
  const found = [];
  for (const m of js.matchAll(SPECIFIER_RE)) {
    if (!/\?v=/.test(m[3])) found.push(m[3]);
  }
  return found;
}

// 내용 해시 앞 8자(config.js 스탬프용).
export function contentHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 8);
}

// config.js 끝에 붙일 빌드 표시 한 줄.
export function buildMarker(sha) {
  return `window.APP_BUILD = ${JSON.stringify(sha)};\n`;
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

const isJs = (f) => /\.m?js$/.test(f);

// dist 폴더를 만든다. 결과 요약을 돌려준다. 스탬프가 빠진 import 가 있으면 오류를 던진다.
export function buildDist({ sha, dist = path.join(root, 'dist'), publicDir = path.join(root, 'public'), env = process.env } = {}) {
  if (!/^[A-Za-z0-9._-]+$/.test(sha)) throw new Error(`빌드 표시(${sha})에는 영문·숫자·._- 만 쓸 수 있습니다.`);
  fs.rmSync(dist, { recursive: true, force: true });
  copyDir(publicDir, dist);
  // public/config.js 가 복사됐더라도 dist 쪽을 새로 만들고, 끝에 빌드 표시를 붙인다.
  const configPath = path.join(dist, 'config.js');
  writeConfig(configPath, env);
  fs.appendFileSync(configPath, buildMarker(sha));
  const configVer = `${sha}-${contentHash(fs.readFileSync(configPath))}`;
  fs.writeFileSync(path.join(dist, 'version.json'), `${JSON.stringify({ build: sha })}\n`);

  for (const file of walk(dist)) {
    const ext = path.extname(file);
    if (ext !== '.html' && !isJs(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    let out;
    if (ext === '.html') {
      const rel = path.relative(path.dirname(file), configPath).split(path.sep).join('/');
      out = stampHtml(src, sha, { [refKey(rel)]: configVer });
    } else {
      out = stampJs(src, sha);
    }
    if (out !== src) fs.writeFileSync(file, out);
  }

  const missing = [];
  for (const file of walk(dist).filter(isJs)) {
    for (const ref of findUnstampedImports(fs.readFileSync(file, 'utf8'))) {
      missing.push(`${path.relative(dist, file)}: ${ref}`);
    }
  }
  if (missing.length) {
    throw new Error(`캐시 스탬프(?v=)가 빠진 상대 import 가 있습니다. 동적 경로(\`./\${x}.js\`)는 쓰지 말고 고정 경로로 바꾸세요.\n  ${missing.join('\n  ')}`);
  }
  return { dist, sha, configVer };
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
  const { dist, configVer } = buildDist({ sha });
  console.log(`빌드 완료: ${dist} (스탬프 ?v=${sha}, config.js ?v=${configVer})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
