// supabase-js 자체 호스팅 번들 생성기(계약 C9).
// devDependency 로 받은 @supabase/supabase-js 를 esbuild 로 묶어 public/vendor/supabase-js.js(ESM, 자체 완결)를 만들고
// sha256 을 public/vendor/supabase-js.sha256 에 적는다. 생성물은 커밋한다(배포 때 CDN 을 거치지 않게).
// 사용법:
//   npm run vendor             번들을 다시 만들고 sha256 을 갱신한다.
//   npm run vendor -- --check  다시 묶은 결과가 커밋된 파일·sha256 과 같은지만 확인한다(CI용, 파일은 바꾸지 않음).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

export const PKG = '@supabase/supabase-js';
export const VERSION = '2.119.0';
export const OUT_JS = path.join(root, 'public/vendor/supabase-js.js');
export const OUT_SHA = path.join(root, 'public/vendor/supabase-js.sha256');

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function installedVersion() {
  const pkgJson = path.join(path.dirname(require.resolve(`${PKG}/package.json`)), 'package.json');
  return JSON.parse(fs.readFileSync(pkgJson, 'utf8')).version;
}

// 번들 내용(Buffer)을 돌려준다. 파일은 쓰지 않는다.
export async function bundle() {
  const v = installedVersion();
  if (v !== VERSION) {
    throw new Error(`${PKG} 설치 버전이 ${v}입니다. ${VERSION}이어야 합니다. npm ci 를 먼저 실행하세요.`);
  }
  const result = await build({
    stdin: {
      contents: `export { createClient } from '${PKG}';\n`,
      resolveDir: root,
      sourcefile: 'supabase-js-entry.js',
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    legalComments: 'inline',
    write: false,
    logLevel: 'silent',
  });
  const banner = `/* ${PKG}@${VERSION} — scripts/vendor.mjs 로 만든 파일입니다. 직접 고치지 마세요. */\n`;
  return Buffer.from(banner + result.outputFiles[0].text);
}

async function main() {
  const check = process.argv.includes('--check');
  const buf = await bundle();
  const hash = sha256(buf);
  const shaLine = `${hash}  supabase-js.js\n`;
  if (check) {
    const problems = [];
    if (!fs.existsSync(OUT_JS)) problems.push(`${path.relative(root, OUT_JS)} 가 없습니다.`);
    else if (sha256(fs.readFileSync(OUT_JS)) !== hash) problems.push(`${path.relative(root, OUT_JS)} 가 다시 묶은 결과와 다릅니다.`);
    if (!fs.existsSync(OUT_SHA) || fs.readFileSync(OUT_SHA, 'utf8') !== shaLine) {
      problems.push(`${path.relative(root, OUT_SHA)} 가 실제 sha256 과 다릅니다.`);
    }
    if (problems.length) {
      throw new Error(`${problems.join('\n')}\nnpm run vendor 로 다시 만들어 커밋하세요.`);
    }
    console.log(`vendor 확인 완료: ${PKG}@${VERSION} sha256 ${hash}`);
    return;
  }
  fs.mkdirSync(path.dirname(OUT_JS), { recursive: true });
  fs.writeFileSync(OUT_JS, buf);
  fs.writeFileSync(OUT_SHA, shaLine);
  console.log(`vendor 생성: ${path.relative(root, OUT_JS)} (${(buf.length / 1024).toFixed(1)} KiB, sha256 ${hash})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
