// 미션 기록의 비행시간. 화면은 분·초 두 칸으로 받고, 저장 값(DB missions.flight_time, 글자)은 "12분 30초"처럼 합친다.
// DB·내보내기·옛 기록은 글자 그대로라 바꾸지 않는다. 화면(missions-ui.js)과 테스트가 함께 쓴다.

// 분은 세 자리(999분)까지, 초는 0~59.
export const FLIGHT_MIN_DIGITS = 3;
export const FLIGHT_SEC_DIGITS = 2;

const digits = (v) => String(v ?? '').trim();
const num = (v) => String(Number(v));

// 분·초 칸 값을 저장할 글자로: "12"·"30" → "12분 30초", "12"·"" → "12분", ""·"30" → "30초", 둘 다 비면 "".
// 앞자리 0은 뗀다("05" → "5"). 칸에는 숫자만 들어온다(missions-ui.js가 숫자 아닌 글자를 지운다).
export function formatFlightTime(min, sec) {
  const m = digits(min);
  const s = digits(sec);
  if (!m && !s) return '';
  if (!s) return `${num(m)}분`;
  if (!m) return `${num(s)}초`;
  return `${num(m)}분 ${num(s)}초`;
}

// 저장된 글자를 분·초 칸 값으로: "12분 30초"·"12분30초"·"12분"·"30초"·"12:30"·"12"(분) → { min, sec } (없는 쪽은 '').
// 빈 값은 { min: '', sec: '' }. 이 꼴이 아니거나 초가 60 이상인 옛 기록("약 10분" 등)은 null — 화면은 옛 값을 그대로 두고 알린다.
export function parseFlightTime(text) {
  const t = String(text ?? '')
    .trim()
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  if (!t) return { min: '', sec: '' };
  let m;
  if ((m = t.match(/^(\d{1,3})\s*분(?:\s*(\d{1,2})\s*초)?$/))) return secOk(m[1], m[2] ?? '');
  if ((m = t.match(/^(\d{1,2})\s*초$/))) return secOk('', m[1]);
  if ((m = t.match(/^(\d{1,3})\s*:\s*(\d{1,2})$/))) return secOk(m[1], m[2]);
  if ((m = t.match(/^(\d{1,3})$/))) return { min: num(m[1]), sec: '' };
  return null;
}

function secOk(min, sec) {
  if (sec !== '' && Number(sec) > 59) return null;
  return { min: min === '' ? '' : num(min), sec: sec === '' ? '' : num(sec) };
}

// 같은 비행시간인지 볼 때 쓰는 꼴: 분·초로 읽히면 formatFlightTime 꼴("12분30초" → "12분 30초"), 아니면 앞뒤 공백만 뗀 글자.
export function normalizeFlightTime(text) {
  const parsed = parseFlightTime(text);
  return parsed ? formatFlightTime(parsed.min, parsed.sec) : String(text ?? '').trim();
}
