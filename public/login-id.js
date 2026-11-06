// 한글 아이디 ↔ Supabase 이메일 변환. 로그인 화면과 계정 생성 스크립트가 같은 규칙을 쓴다.
// Supabase 로그인은 이메일 형식이 필요하므로, 아이디를 국제화 도메인 규칙(IDNA/punycode)으로 영문화해 가짜 도메인을 붙인다.
//   손두병 → xn--... @sistech.local   (브라우저와 Node 모두 URL 파서가 같은 결과를 낸다)
// 이 주소로는 메일이 가지 않으므로 비밀번호 재설정은 관리자가 대시보드에서 한다.

export const LOGIN_DOMAIN = 'sistech.local';
export const LOGIN_ID_MAX = 16;
export const LOGIN_ID_RULE = `아이디는 한글·영문·숫자·밑줄 1~${LOGIN_ID_MAX}자여야 합니다.`;

const ID_PATTERN = /^[가-힣A-Za-z0-9_]+$/;

// 앞뒤 공백을 떼고 한글 조합 형태를 통일한다. 규칙에 어긋나면 null.
export function normalizeLoginId(raw) {
  const id = String(raw ?? '').normalize('NFC').trim();
  if (id.length < 1 || id.length > LOGIN_ID_MAX || !ID_PATTERN.test(id)) return null;
  return id;
}

// 아이디 → 로그인에 쓸 이메일. '@'가 들어 있으면 이메일로 보고 그대로 돌려준다(이메일 계정도 허용).
export function loginIdToEmail(raw) {
  const text = String(raw ?? '').trim();
  if (text.includes('@')) return text.toLowerCase();
  const id = normalizeLoginId(text);
  if (id === null) throw new Error(LOGIN_ID_RULE);
  let local;
  try {
    local = new URL(`http://${id}/`).hostname; // IDNA 처리: 영문은 소문자로, 한글은 xn-- 형태로
  } catch {
    throw new Error(LOGIN_ID_RULE);
  }
  if (!local || local.length > 64) throw new Error(LOGIN_ID_RULE);
  return `${local}@${LOGIN_DOMAIN}`;
}

// 이메일 → 화면에 보여 줄 아이디. 우리 도메인이면 xn--를 다시 한글로 풀고, 다른 이메일은 그대로 보여 준다.
export function emailToLoginId(email) {
  const text = String(email ?? '');
  const at = text.lastIndexOf('@');
  if (at < 0 || text.slice(at + 1).toLowerCase() !== LOGIN_DOMAIN) return text;
  const local = text.slice(0, at);
  if (!local.toLowerCase().startsWith('xn--')) return local;
  try {
    return punycodeDecode(local.slice(4)) || local;
  } catch {
    return local;
  }
}

// RFC 3492 punycode 복호화. 브라우저 URL API는 한글로 되돌리는 기능이 없어서 직접 푼다.
const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta, numPoints, firstTime) {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

function digitValue(code) {
  if (code >= 48 && code <= 57) return code - 22; // 0-9 → 26..35
  if (code >= 65 && code <= 90) return code - 65; // A-Z
  if (code >= 97 && code <= 122) return code - 97; // a-z
  return BASE;
}

export function punycodeDecode(input) {
  const output = [];
  const basicEnd = Math.max(input.lastIndexOf('-'), 0);
  for (let j = 0; j < basicEnd; j++) {
    const code = input.charCodeAt(j);
    if (code >= 0x80) throw new RangeError('punycode: 잘못된 입력');
    output.push(code);
  }
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  for (let index = basicEnd > 0 ? basicEnd + 1 : 0; index < input.length; ) {
    const oldI = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) throw new RangeError('punycode: 잘린 입력');
      const digit = digitValue(input.charCodeAt(index++));
      if (digit >= BASE || digit > Math.floor((0x7fffffff - i) / w)) throw new RangeError('punycode: 잘못된 입력');
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    const out = output.length + 1;
    bias = adapt(i - oldI, out, oldI === 0);
    n += Math.floor(i / out);
    i %= out;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}
