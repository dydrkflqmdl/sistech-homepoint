// 한글 아이디 계정 일괄 생성(비상용). Supabase Admin API로 이메일 인증 없이 바로 쓰는 계정을 만든다.
// 평소에는 화면의 "계정 관리"(Edge Function admin-users)를 쓰고, 이 스크립트는 관리자 계정이 없거나 잠겼을 때만 쓴다.
// 사용법: npm run users -- 손두병 황병용 오성민          (비밀번호는 대화형으로 묻는다)
//        USERS_PASSWORD=... npm run users -- 손두병     (비대화형)
//        npm run users -- --admin 김용문                (이미 있는 계정을 관리자로 지정)
//        npm run users -- --role 외주 홍길동            (새 계정을 외주로 만들기. 직원|외주|staff|contractor)
// 비밀번호는 명령줄 인자로 받지 않는다(셸 기록·프로세스 목록에 남기 때문). --password 를 주면 거부한다.
// 관리자 표시는 app_metadata.role = 'admin'. app_metadata는 사용자가 스스로 못 바꾸고 service_role만 쓸 수 있다.
// 권한은 app_metadata.role에 둔다: admin(관리자), staff(직원), contractor(외주). 값이 없으면 직원이다.
// 필요한 환경변수(.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (service_role 키는 출력하지 않는다)
import { PASSWORD_RULE, isValidPassword, loginIdToEmail } from '../public/login-id.js';

const HELP = `한글 아이디 계정을 Supabase에 만듭니다(비상용. 평소에는 화면의 "계정 관리"를 쓰세요).

사용법: npm run users -- [--reset-password] [--admin | --role 직원|외주] <아이디> [<아이디> ...]
        npm run users -- --admin <아이디> [<아이디> ...]

비밀번호
  명령줄 인자로는 받지 않습니다(셸 기록과 프로세스 목록에 남습니다).
  환경변수 USERS_PASSWORD가 있으면 그 값을, 없으면 화면에서 두 번 물어봅니다(입력은 보이지 않습니다).
  ${PASSWORD_RULE}

옵션
  --reset-password        이미 있는 계정이면 비밀번호를 새 값으로 바꿉니다
  --admin                 적은 아이디들을 관리자로 지정합니다(app_metadata.role = admin).
                          USERS_PASSWORD 없이 --admin만 쓰면 비밀번호를 묻지 않고 이미 있는 계정만 지정합니다.
                          USERS_PASSWORD를 주거나 --reset-password와 함께 쓰면 만들거나 비밀번호를 바꾼 뒤 지정합니다.
  --role 직원|외주        새로 만드는 계정의 권한(app_metadata.role). staff|contractor로 적어도 됩니다.
                          주지 않으면 role 없이 만들고, role이 없으면 직원입니다.
                          외주는 장소 보기와 미션 기록만 할 수 있습니다(CSV 가져오기·메모·지우기 불가).
                          이미 있는 계정의 권한은 바꾸지 않습니다. 화면의 "계정 관리"에서 바꾸세요.
                          --admin과 함께 쓸 수 없습니다.
  --help                  이 도움말

환경변수(.env에 넣으세요. 깃에는 올라가지 않습니다)
  SUPABASE_URL                Supabase 프로젝트 URL
  SUPABASE_SERVICE_ROLE_KEY   Project Settings → API Keys의 service_role 키 (이 스크립트에서만 사용)
  USERS_PASSWORD              (선택) 비대화형으로 쓸 비밀번호. 쓰고 나면 지우세요

예시
  npm run users -- 손두병 황병용 오성민
  npm run users -- --reset-password 손두병
  npm run users -- --admin 김용문
  npm run users -- --role 외주 홍길동
  USERS_PASSWORD='새비밀번호' npm run users -- --admin 김용문`;

const PASSWORD_ARG_REFUSED = `--password 옵션은 더 이상 쓰지 않습니다. 비밀번호가 셸 기록과 프로세스 목록에 남기 때문입니다.
방금 입력한 비밀번호는 노출됐다고 보고 다른 값을 쓰세요.
비밀번호는 실행 중에 묻는 화면에 입력하거나, 환경변수 USERS_PASSWORD로 넘기세요.`;

// --role 값 → app_metadata.role. 한글(직원·외주)과 영문(staff·contractor)을 받는다. 관리자는 --admin으로만 지정한다.
const ROLE_NAMES = { 직원: 'staff', 외주: 'contractor', staff: 'staff', contractor: 'contractor' };
const ROLE_LABELS = { staff: '직원', contractor: '외주' };

function parseRole(value) {
  const role = Object.hasOwn(ROLE_NAMES, value ?? '') ? ROLE_NAMES[value] : null;
  if (!role) throw new Error(`--role 값은 직원, 외주(또는 staff, contractor)만 쓸 수 있습니다: ${value ?? '(없음)'}`);
  return role;
}

function parseArgs(argv) {
  const opts = { reset: false, admin: false, role: null, help: false, passwordArg: false, ids: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--reset-password') opts.reset = true;
    else if (a === '--admin') opts.admin = true;
    else if (a === '--role') opts.role = parseRole(argv[++i]?.normalize('NFC').trim());
    else if (a.startsWith('--role=')) opts.role = parseRole(a.slice('--role='.length).normalize('NFC').trim());
    else if (a === '--password' || a.startsWith('--password=')) {
      opts.passwordArg = true;
      if (a === '--password') i++; // 값은 읽지도 않고 건너뛴다
    } else if (a.startsWith('--')) throw new Error(`알 수 없는 옵션입니다: ${a}`);
    else opts.ids.push(a);
  }
  return opts;
}

function usageError(message) {
  console.error(message);
  console.error('도움말: npm run users -- --help');
  process.exit(1);
}

// 입력을 화면에 보이지 않게 한 줄 읽는다(터미널일 때만).
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
    };
    function onData(chunk) {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          cleanup();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          reject(new Error('입력을 취소했습니다.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = [...value].slice(0, -1).join('');
        else value += ch;
      }
    }
    stdin.on('data', onData);
  });
}

async function readPassword() {
  const fromEnv = process.env.USERS_PASSWORD;
  if (fromEnv !== undefined && fromEnv !== '') return { password: fromEnv, source: 'env' };
  if (!process.stdin.isTTY) {
    throw new Error('비밀번호를 물어볼 터미널이 없습니다. 환경변수 USERS_PASSWORD로 넘겨 주세요.');
  }
  const first = await promptHidden('비밀번호: ');
  if (!isValidPassword(first)) throw new Error(PASSWORD_RULE);
  const second = await promptHidden('비밀번호 확인: ');
  if (first !== second) throw new Error('두 번 입력한 비밀번호가 다릅니다.');
  return { password: first, source: 'prompt' };
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (e) {
  usageError(e.message);
}
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
if (opts.passwordArg) usageError(PASSWORD_ARG_REFUSED);
if (opts.ids.length === 0) usageError('아이디를 하나 이상 적어 주세요.');
if (opts.admin && opts.role) usageError('--admin과 --role은 함께 쓸 수 없습니다.');

// --admin만 쓰고 USERS_PASSWORD도 --reset-password도 없으면 비밀번호 없이 관리자 지정만 한다.
const adminOnly = opts.admin && !opts.reset && !process.env.USERS_PASSWORD;
let password = null;
if (!adminOnly) {
  try {
    ({ password } = await readPassword());
  } catch (e) {
    usageError(e.message);
  }
  if (!isValidPassword(password)) usageError(PASSWORD_RULE);
}

const baseUrl = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const missing = [];
if (!baseUrl) missing.push('SUPABASE_URL');
if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
if (missing.length) {
  console.error(`${missing.join(', ')} 값이 비어 있습니다.`);
  console.error('.env에 넣어 주세요. service_role 키는 Supabase 대시보드 Project Settings → API Keys에 있습니다.');
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
  if (r.data?.error_code === 'weak_password' || (/password/i.test(msg) && /short|least|weak|character|long/i.test(msg))) {
    return `${PASSWORD_RULE} (Supabase 설정과 맞지 않으면 README의 대시보드 설정 표를 확인하세요.)`;
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

// 관리자 지정: GoTrue는 PUT의 app_metadata를 기존 값에 병합하므로 provider·login_id 등 다른 키는 남는다.
async function makeAdmin(userId) {
  const u = await admin('PUT', `/${userId}`, { app_metadata: { role: 'admin' } });
  if (!u.ok) throw new Error(explain(u));
}

// 한 아이디 처리. 비밀번호가 있으면 만들기/비밀번호 변경, --admin이 있으면 이어서 관리자 지정.
// 돌려주는 result는 단계별 결과를 ', '로 이은 문구(예: "만듦, 관리자 지정").
async function createOne(rawId) {
  let email;
  try {
    email = loginIdToEmail(rawId);
  } catch (e) {
    return { id: rawId, email: '-', result: `실패: ${e.message}`, ok: false };
  }
  const loginId = rawId.includes('@') ? rawId.trim() : rawId.normalize('NFC').trim();
  // 아이디는 본인이 못 바꾸는 app_metadata에도 넣는다(계정 목록 표시 기준, 계약 C4). 이메일 계정은 넣지 않는다.
  const meta = rawId.includes('@') ? {} : { user_metadata: { login_id: loginId }, app_metadata: { login_id: loginId } };
  // 권한(--role)은 새로 만들 때만 넣는다. 이미 있는 계정(관리자일 수도 있음)의 권한은 덮지 않는다.
  const createMeta = opts.role ? { ...meta, app_metadata: { ...meta.app_metadata, role: opts.role } } : meta;
  const steps = [];
  const fail = (msg) => ({ id: loginId, email, result: [...steps, `실패: ${msg}`].join(', '), ok: false });
  try {
    let userId = null; // 알게 되면 채운다(관리자 지정에 쓴다)
    if (password !== null) {
      const r = await admin('POST', '', { email, password, email_confirm: true, ...createMeta });
      if (r.ok) {
        steps.push(opts.role ? `만듦(${ROLE_LABELS[opts.role]})` : '만듦');
        userId = r.data?.id ?? null;
      } else if (!isDuplicate(r)) {
        return fail(explain(r));
      } else if (!opts.reset) {
        steps.push(opts.role ? '이미 있음(권한은 그대로)' : '이미 있음');
      } else {
        userId = await findUserId(email);
        if (!userId) return fail('이미 있다고 하는데 목록에서 찾지 못했습니다.');
        const u = await admin('PUT', `/${userId}`, { password, ...meta });
        if (!u.ok) return fail(explain(u));
        steps.push(opts.role ? '비밀번호 변경(권한은 그대로)' : '비밀번호 변경');
      }
    }
    if (opts.admin) {
      userId = userId ?? (await findUserId(email));
      if (!userId) {
        return fail(password !== null ? '목록에서 찾지 못해 관리자로 지정하지 못했습니다.' : '계정이 없습니다. 먼저 비밀번호와 함께 만드세요.');
      }
      await makeAdmin(userId);
      steps.push('관리자 지정');
    }
    return { id: loginId, email, result: steps.join(', '), ok: true };
  } catch (e) {
    return fail(e.message);
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
