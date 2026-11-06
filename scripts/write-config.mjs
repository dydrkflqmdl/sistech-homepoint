// public/config.js 생성기. 환경변수 값을 브라우저용 설정 파일로 쓴다.
// 사용법: node scripts/write-config.mjs [출력경로]   (기본: public/config.js)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// 환경변수에서 설정 파일 내용을 만든다. 값은 JSON.stringify로 넣어 따옴표·개행에도 깨지지 않는다.
export function buildConfigSource(env = process.env) {
  const val = (k) => (env[k] ?? '').trim();
  const cfg = {
    kakaoJsKey: val('KAKAO_JS_KEY'),
    supabaseUrl: val('SUPABASE_URL'),
    supabaseAnonKey: val('SUPABASE_ANON_KEY'),
  };
  const body = Object.entries(cfg)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(', ');
  return { cfg, source: `window.APP_CONFIG = { ${body} };\n` };
}

// 설정 파일을 쓰고 경로를 돌려준다. Supabase 값이 비어 있으면 오류를 던진다.
export function writeConfig(outPath = 'public/config.js', env = process.env) {
  const { cfg, source } = buildConfigSource(env);
  const missing = [];
  if (!cfg.supabaseUrl) missing.push('SUPABASE_URL');
  if (!cfg.supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
  if (missing.length) {
    throw new Error(`${missing.join(', ')} 값이 비어 있습니다. .env(로컬) 또는 GitHub Secrets(배포)에 설정하세요.`);
  }
  if (!cfg.kakaoJsKey) console.warn('경고: KAKAO_JS_KEY가 비어 있어 지도가 뜨지 않습니다.');
  const abs = path.resolve(root, outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, source);
  return abs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const abs = writeConfig(process.argv[2] || 'public/config.js');
    console.log(`설정 파일 생성: ${abs}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
