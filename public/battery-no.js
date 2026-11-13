// 미션 기록의 사용한 배터리 번호. 화면은 숫자 두 칸 [  ] - [  ]로 받고, 저장 값(DB missions.battery_no, 글자)은 "3-4"처럼 합친다.
// DB·내보내기·옛 기록은 글자 그대로라 바꾸지 않는다. 화면(missions-ui.js)과 테스트가 함께 쓴다.

// 칸마다 숫자 1~3자리.
export const BATTERY_NO_DIGITS = 3;

const digits = (v) => String(v ?? '').trim();

// 두 칸 값을 저장할 글자로: "3"·"4" → "3-4", 둘 다 비면 "".
// 앞자리 0은 그대로 둔다("07"·"2" → "07-2", 배터리 라벨이 "07"일 수 있다).
// 한 칸만 차 있으면 "3-"·"-4"처럼 빈 쪽을 비워 둔 채 돌려준다(숫자 하나만 번호처럼 보이지 않게).
// 화면은 이런 초안을 저장하지 못하게 막는다(두 칸 모두 적어야 한다). 막기 전에도 "고쳤음"으로 보이게 하려는 꼴이다.
export function formatBatteryNo(a, b) {
  const x = digits(a);
  const y = digits(b);
  if (!x && !y) return '';
  return `${x}-${y}`;
}

// 저장된 글자를 두 칸 값으로: "3-4"·"3 - 4"·"3~4"·"３－４"(전각)·"3–4"(긴 대시) → { a: '3', b: '4' }.
// 빈 값은 { a: '', b: '' }. 숫자 1~3자리 두 개가 아니면("3"·"3번"·"A2") null — 화면은 옛 글자를 그대로 두고 알린다.
export function parseBatteryNo(text) {
  const t = String(text ?? '')
    .trim()
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  if (!t) return { a: '', b: '' };
  const m = t.match(new RegExp(`^(\\d{1,${BATTERY_NO_DIGITS}})\\s*[-－–—~～]\\s*(\\d{1,${BATTERY_NO_DIGITS}})$`));
  return m ? { a: m[1], b: m[2] } : null;
}

// 같은 배터리 번호인지 볼 때 쓰는 꼴: 두 칸으로 읽히면 formatBatteryNo 꼴("3 - 4" → "3-4"), 아니면 앞뒤 공백만 뗀 글자.
export function normalizeBatteryNo(text) {
  const parsed = parseBatteryNo(text);
  return parsed ? formatBatteryNo(parsed.a, parsed.b) : String(text ?? '').trim();
}
