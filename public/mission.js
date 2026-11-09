// 화면(상세 정보·내보내기)과 테스트가 함께 쓰는 미션명 풀이.

// 미션 수가 이보다 많으면 오타로 보고 펼치지 않는다.
const MAX_MISSIONS = 500;
// 번호 숫자 묶음이 이보다 길면 범위로 보지 않는다(16자리부터는 JS Number가 정확하지 않다).
const MAX_DIGITS = 15;

// 미션명 "Q1_A_TA_SW__01_01 ~ _34"는 Q1_A_TA_SW__01_01부터 Q1_A_TA_SW__01_34까지 34개 미션이다.
// 물결 앞 이름의 맨 뒤 번호가 첫 미션, 미션명 맨 끝 숫자가 마지막 미션이고, 번호는 첫 미션의 자릿수(01)에 맞춘다.
// 물결(~ ～ 〜 ∼) 뒤에 숫자 말고 글자가 있으면("_34", "Q1_B_BE_TB__03_10") 그 글자(앞뒤 공백 제외)가 물결 앞 이름의
// 끝부분과 같아야 범위다. 즉 물결 뒤는 마지막 미션 이름의 끝부분이어야 한다("…01_01 ~ Q1_A_TA_GH__02_05"는 미션 하나).
// 포인트 번호와 미션 번호가 붙은 "Q1DGHGS0101 ~ 10"(포인트 01, 미션 01~10)도 같은 뜻이다: 끝 번호가 첫 번호보다 작고
// 자릿수가 적을 때, 첫 번호 뒷자리(끝 번호 자릿수만큼)가 정확히 1이면 미션은 01부터 시작한 것으로 보고 앞자리(01)를
// 이름에 붙인다 → Q1DGHGS0101 … Q1DGHGS0110. 뒷자리가 1이 아니면("Q1_A_10 ~ 9", "Q1DGHGS0100 ~ 10") 미션 하나다.
// 전각 숫자(０-９)는 반각으로 바꿔 읽고, 결과 이름도 반각이다. 번호가 15자리를 넘거나 500개 이상이면 펼치지 않는다.
// 범위가 아닌 미션명은 미션 하나로 본다.
// 이 규칙은 DB 함수 mission_names(supabase/migrations)와 똑같아야 한다. 바꾸면 양쪽을 함께 바꾼다.
export function missionNames(raw) {
  const text = String(raw ?? '')
    .trim()
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  if (!text) return [];
  const range = text.match(/^(.*?)(\d+)\s*[~～〜∼]\s*(.*?)(\d+)\s*$/);
  if (!range) return [text];

  let [, prefix, firstDigits, between, lastDigits] = range;
  if (firstDigits.length > MAX_DIGITS || lastDigits.length > MAX_DIGITS) return [text];
  let first = Number(firstDigits);
  const last = Number(lastDigits);
  // 붙은 표기: 끝 번호가 첫 번호보다 작고 자릿수가 적은데, 첫 번호 뒷자리가 정확히 1이면 앞자리는 포인트 번호다.
  if (last < first && firstDigits.length > lastDigits.length) {
    const cut = firstDigits.length - lastDigits.length;
    if (Number(firstDigits.slice(cut)) === 1) {
      prefix += firstDigits.slice(0, cut);
      firstDigits = firstDigits.slice(cut);
      first = 1;
    }
  }
  // 물결 뒤 글자는 (포인트 번호까지 붙인) 이름의 끝부분이어야 한다.
  if (!prefix.endsWith(between.trim())) return [text];
  if (last < first || last - first >= MAX_MISSIONS) return [text];
  return Array.from({ length: last - first + 1 }, (_, i) => prefix + String(first + i).padStart(firstDigits.length, '0'));
}

// 미션 진행도. 장소의 미션명을 바꿔 범위 밖이 된 미션의 기록은 남아 있어도 세지 않는다.
export function missionProgress(missionString, records = []) {
  const names = new Set(missionNames(missionString));
  const done = (records ?? []).filter((r) => r?.done === true && names.has(r.mission)).length;
  return { total: names.size, done };
}
