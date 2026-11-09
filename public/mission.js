// 화면(상세 정보·내보내기)과 테스트가 함께 쓰는 미션명 풀이.

// 미션 수가 이보다 많으면 오타로 보고 펼치지 않는다.
const MAX_MISSIONS = 500;

// 미션명 "Q1_A_TA_SW__01_01 ~ _34"는 Q1_A_TA_SW__01_01부터 Q1_A_TA_SW__01_34까지 34개 미션이다.
// 물결 앞 이름의 맨 뒤 번호가 첫 미션, 미션명 맨 끝 숫자가 마지막 미션이고, 번호는 첫 미션의 자릿수(01)에 맞춘다.
// 포인트 번호와 미션 번호가 붙은 "Q1DGHGS0101 ~ 10"(포인트 01, 미션 01~10)도 같은 뜻이다. 미션은 늘 01부터
// 시작하므로 물결 뒤 숫자가 곧 미션 개수다: 첫 번호 뒷자리를 물결 뒤 숫자 자릿수만큼만 미션 번호로 보고
// 앞자리(01)는 이름에 붙인다 → Q1DGHGS0101 … Q1DGHGS0110.
// 범위가 아닌 미션명은 미션 하나로 본다.
// 이 규칙은 DB 함수 mission_names(supabase/migrations)와 똑같아야 한다. 바꾸면 양쪽을 함께 바꾼다.
export function missionNames(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  const range = text.match(/^(.*?)(\d+)\s*[~～〜]\s*.*?(\d+)\s*$/);
  if (!range) return [text];

  let [, prefix, firstDigits] = range;
  const lastDigits = range[3];
  let first = Number(firstDigits);
  const last = Number(lastDigits);
  // 붙은 표기: 끝 번호가 첫 번호보다 작은데 첫 번호 자릿수가 더 많으면, 넘치는 앞자리는 포인트 번호다.
  if (last < first && firstDigits.length > lastDigits.length) {
    const cut = firstDigits.length - lastDigits.length;
    prefix += firstDigits.slice(0, cut);
    firstDigits = firstDigits.slice(cut);
    first = Number(firstDigits);
  }
  if (last < first || last - first >= MAX_MISSIONS) return [text];
  return Array.from({ length: last - first + 1 }, (_, i) => prefix + String(first + i).padStart(firstDigits.length, '0'));
}

// 미션 진행도. 장소의 미션명을 바꿔 범위 밖이 된 미션의 기록은 남아 있어도 세지 않는다.
export function missionProgress(missionString, records = []) {
  const names = new Set(missionNames(missionString));
  const done = (records ?? []).filter((r) => r?.done === true && names.has(r.mission)).length;
  return { total: names.size, done };
}
