// 한글 아이디 계정 일괄 생성. Supabase Admin API로 이메일 인증 없이 바로 쓰는 계정을 만든다.
// 사용법: npm run users -- --password <비밀번호> 손두병 황병용 오성민
// 필요한 환경변수(.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (service_role 키는 출력하지 않는다)
import { loginIdToEmail } from '../public/login-id.js';

const HELP = `한글 아이디 계정을 Supabase에 만듭니다.

사용법: npm run users -- --password <비밀번호> [--reset-password] <아이디> [<아이디> ...]

옵션
  --password <비밀번호>   모든 계정에 설정할 비밀번호 (필수)
  --reset-password        이미 있는 계정이면 비밀번호를 위 값으로 바꿉니다
  --help                  이 도움말

환경변수(.env에 넣으세요. 깃에는 올라가지 않습니다)
  SUPABASE_URL                Supabase 프로젝트 URL
  SUPABASE_SERVICE_ROLE_KEY   Project Settings → API의 service_role 키 (이 스크립트에서만 사용)

예시
  npm run users -- --password 비밀번호 손두병 황병용 오성민
  npm run users -- --password 새비밀번호 --reset-password 손두병`;

function parseArgs(argv) {
  const opts = { password: null, reset: false, help: false, ids: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--reset-password') opts.reset = true;
    else if (a === '--password') opts.password = argv[++i] ?? '';
    else if (a.startsWith('--password=')) opts.password = a.slice('--password='.length);
    else if (a.startsWith('--')) throw new Error(`알 수 없는 옵션입니다: ${a}`);
    else opts.ids.push(a);
  }
  return opts;
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(e.message);
  console.error('도움말: npm run users -- --help');
  process.exit(1);
}
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
if (opts.ids.length === 0 || !opts.password) {
  console.error(!opts.password ? '--password <비밀번호>가 필요합니다.' : '만들 아이디를 하나 이상 적어 주세요.');
  console.error('도움말: npm run users -- --help');
  process.exit(1);
}

const baseUrl = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const missing = [];
if (!baseUrl) missing.push('SUPABASE_URL');
if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
if (missing.length) {
  console.error(`${missing.join(', ')} 값이 비어 있습니다.`);
  console.error('.env에 넣어 주세요. service_role 키는 Supabase 대시보드 Project Settings → API에 있습니다.');
  process.exit(1);
}

class ConnectError extends Error {}

// Admin API 호출. 오류 메시지에 URL·헤더를 넣지 않는다.
async function admin(method, path, body) {
  let res;
  try {
    res = await fetch(`${baseUrl}/auth/v1/admin/users${path}`, {
      method,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ConnectError('Supabase에 연결하지 못했습니다.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 본문 없음 */
  }
  return { status: res.status, ok: res.ok, data };
}

function serverMessage(data) {
  return String(data?.msg ?? data?.message ?? data?.error_description ?? data?.error ?? '');
}

const isDuplicate = (r) => /already|exists|registered/i.test(serverMessage(r.data));

// 서버가 주는 영문 문구를 한국어로 풀어 준다.
function explain(r) {
  const msg = serverMessage(r.data);
  if (r.status === 401 || r.status === 403 || /invalid api key|not_admin|jwt/i.test(msg)) {
    return 'service_role 키가 올바르지 않거나 권한이 없습니다.';
  }
  const min = msg.match(/at least (\d+) characters/i);
  if (min) return `비밀번호가 너무 짧습니다. 최소 ${min[1]}자 이상이어야 합니다(Supabase 설정에서 바꿀 수 있습니다).`;
  if (/password/i.test(msg) && /short|least|weak|character/i.test(msg)) {
    return '비밀번호가 너무 짧거나 규칙에 맞지 않습니다. Supabase 설정의 최소 길이(기본 6자) 이상이어야 합니다.';
  }
  return `서버 오류(${r.status})${msg ? `: ${msg}` : ''}`;
}

let usersCache = null;
async function findUserId(email) {
  if (!usersCache) {
    const r = await admin('GET', '?page=1&per_page=1000');
    if (!r.ok) throw new Error(explain(r));
    usersCache = r.data?.users ?? [];
  }
  return usersCache.find((u) => (u.email ?? '').toLowerCase() === email)?.id ?? null;
}

async function createOne(rawId) {
  let email;
  try {
    email = loginIdToEmail(rawId);
  } catch (e) {
    return { id: rawId, email: '-', result: `실패: ${e.message}`, ok: false };
  }
  const loginId = rawId.includes('@') ? rawId.trim() : rawId.normalize('NFC').trim();
  try {
    const r = await admin('POST', '', {
      email,
      password: opts.password,
      email_confirm: true,
      user_metadata: { login_id: loginId },
    });
    if (r.ok) return { id: loginId, email, result: '만듦', ok: true };
    if (!isDuplicate(r)) return { id: loginId, email, result: `실패: ${explain(r)}`, ok: false };
    if (!opts.reset) return { id: loginId, email, result: '이미 있음', ok: true };
    const userId = await findUserId(email);
    if (!userId) return { id: loginId, email, result: '실패: 이미 있다고 하는데 목록에서 찾지 못했습니다.', ok: false };
    const u = await admin('PUT', `/${userId}`, { password: opts.password, user_metadata: { login_id: loginId } });
    if (!u.ok) return { id: loginId, email, result: `실패: ${explain(u)}`, ok: false };
    return { id: loginId, email, result: '비밀번호 변경', ok: true };
  } catch (e) {
    return { id: loginId, email, result: `실패: ${e.message}`, ok: false };
  }
}

const results = [];
for (const id of opts.ids) results.push(await createOne(id));

// 한글은 화면 폭 2칸으로 세어 열을 맞춘다.
const width = (s) => [...s].reduce((n, c) => n + (/[ᄀ-ᇿ㄰-㆏가-힯]/.test(c) ? 2 : 1), 0);
const rows = [['아이디', '이메일', '결과'], ...results.map((r) => [r.id, r.email, r.result])];
const cols = rows[0].map((_, i) => Math.max(...rows.map((r) => width(r[i]))));
for (const r of rows) console.log(r.map((c, i) => c + ' '.repeat(cols[i] - width(c))).join(' | ').trimEnd());

process.exit(results.every((r) => r.ok) ? 0 : 1);
