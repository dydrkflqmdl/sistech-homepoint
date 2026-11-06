// 로그인 기록 화면에 보여 줄 글자를 만든다(시각·동작·기기). 화면(app.js)과 단위 테스트가 같이 쓴다.

// ISO 시각 → 기기 시간대 기준 "YYYY-MM-DD HH:mm". 읽을 수 없으면 '-'.
export function formatLogTime(iso) {
  const d = new Date(iso ?? '');
  if (iso == null || iso === '' || Number.isNaN(d.getTime())) return '-';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EVENT_LABELS = { login: '로그인', logout: '로그아웃' };

// 'login' → 로그인, 'logout' → 로그아웃. 모르는 값은 그대로.
export const eventLabel = (event) => EVENT_LABELS[event] ?? String(event ?? '-');

// 위에서부터 먼저 맞는 것을 쓴다. iPadOS는 기본 설정에서 Mac처럼 보이므로 Mac으로 나온다.
const OS_RULES = [
  [/iPhone|iPod/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Macintosh|Mac OS X/, 'Mac'],
  [/Linux/, 'Linux'],
];

// 다른 브라우저도 이름에 Chrome·Safari를 같이 적어 보내므로, 특정한 것부터 본다.
const BROWSER_RULES = [
  [/SamsungBrowser/, 'Samsung'],
  [/KAKAOTALK/i, '카카오톡'],
  [/NAVER\(/, '네이버'],
  [/Whale/, 'Whale'],
  [/EdgA?\/|EdgiOS/, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox|FxiOS/, 'Firefox'],
  [/CriOS|Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const pick = (rules, ua) => rules.find(([re]) => re.test(ua))?.[1] ?? null;

// user agent → "iPhone · Safari"처럼 짧게. 비었으면 '-', 아무것도 못 알아보면 '기타'.
export function shortUserAgent(ua) {
  const text = String(ua ?? '').trim();
  if (!text) return '-';
  const parts = [pick(OS_RULES, text), pick(BROWSER_RULES, text)].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '기타';
}
