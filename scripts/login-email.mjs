// 아이디 → 로그인 이메일 변환만 출력한다. 대시보드(Add user)에서 손으로 계정을 만들 때 쓴다.
// 사용법: npm run login-email -- 손두병 황병용
import { loginIdToEmail, LOGIN_ID_RULE } from '../public/login-id.js';

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`아이디를 로그인용 이메일 주소로 바꿔 보여 줍니다.

사용법: npm run login-email -- <아이디> [<아이디> ...]
예시:   npm run login-email -- 손두병 황병용

${LOGIN_ID_RULE}
같은 아이디는 항상 같은 주소가 됩니다.`);
  process.exit(args.length === 0 ? 1 : 0);
}

const rows = [['아이디', '이메일']];
let failed = false;
for (const id of args) {
  try {
    rows.push([id, loginIdToEmail(id)]);
  } catch (e) {
    failed = true;
    rows.push([id, `실패: ${e.message}`]);
  }
}

// 한글은 화면 폭 2칸으로 세어 열을 맞춘다.
const width = (s) => [...s].reduce((n, c) => n + (/[ᄀ-ᇿ㄰-㆏가-힯]/.test(c) ? 2 : 1), 0);
const cols = rows[0].map((_, i) => Math.max(...rows.map((r) => width(r[i]))));
for (const r of rows) {
  console.log(r.map((c, i) => c + ' '.repeat(cols[i] - width(c))).join(' | ').trimEnd());
}
process.exit(failed ? 1 : 0);
