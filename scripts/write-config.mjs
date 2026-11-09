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

const SECRET_KEY_MESSAGE =
  'SUPABASE_ANON_KEY 자리에 비밀 키(service_role 또는 sb_secret_)가 들어 있습니다. 이 값이 config.js로 나가면 누구나 모든 데이터를 지울 수 있어 빌드를 멈춥니다. ' +
  'Project Settings → API Keys의 anon(공개) 또는 publishable 키로 바꾸고, 비밀 키는 노출됐다고 보고 대시보드에서 새로 발급(rotate)하세요.';

// JWT 가운데 부분(payload)을 읽는다. JWT가 아니거나 읽을 수 없으면 null.
function jwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0].startsWith('eyJ')) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

// 브라우저에 실어도 되는 공개 키인지 검사한다. 문제가 있으면 오류를 던진다(키 값은 메시지에 넣지 않는다).
//   sb_secret_...            → 거부(새 형식 비밀 키)
//   JWT(eyJ...)              → payload.role 이 'anon' 일 때만 허용(service_role 등은 거부)
//   sb_publishable_... 등    → 허용
export function assertPublicAnonKey(key) {
  const value = String(key ?? '').trim();
  if (value.startsWith('sb_secret_')) throw new Error(SECRET_KEY_MESSAGE);
  if (value.startsWith('eyJ')) {
    const payload = jwtPayload(value);
    if (payload?.role === 'service_role') throw new Error(SECRET_KEY_MESSAGE);
    if (payload?.role !== 'anon') {
      throw new Error('SUPABASE_ANON_KEY가 anon 키로 보이지 않습니다(JWT의 role이 anon이 아님). Project Settings → API Keys의 anon(공개) 키를 넣으세요.');
    }
  }
}

// 설정 파일을 쓰고 경로를 돌려준다. Supabase 값이 비어 있거나 anon 자리에 비밀 키가 있으면 오류를 던진다.
export function writeConfig(outPath = 'public/config.js', env = process.env) {
  const { cfg, source } = buildConfigSource(env);
  const missing = [];
  if (!cfg.supabaseUrl) missing.push('SUPABASE_URL');
  if (!cfg.supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
  if (missing.length) {
    throw new Error(`${missing.join(', ')} 값이 비어 있습니다. .env(로컬) 또는 GitHub Secrets(배포)에 설정하세요.`);
  }
  assertPublicAnonKey(cfg.supabaseAnonKey);
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
