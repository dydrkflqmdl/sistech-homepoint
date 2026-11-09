// 좌표를 소수 7자리(약 1cm)로 반올림한다. 같은 장소(이름·좌표)인지 가릴 때 쓰며, DB의 판정 기준과 같아야 한다.
// DB의 round_coord(x)는 round(x::numeric, 7)::double precision이다. Postgres는 double을 numeric으로 바꿀 때
// 유효숫자 15자리 십진수로 만들고(0.30000000000000004 → 0.3), round는 십진수에서 0에서 먼 쪽으로 반올림한다
// (35.12345685 → 35.1234569, -0.00000005 → -0.0000001). 여기서도 같은 순서로 십진수 문자열을 다룬다.
// Math.round(n * 1e7) / 1e7은 이진 오차로 35.12345685를 35.1234568로 만들어 DB와 달라진다.
// NaN·Infinity는 그대로, 0과 -0 및 0으로 반올림되는 값은 0(+0)을 돌려준다(numeric에는 -0이 없다).
export function roundCoord(n) {
  const x = Number(n);
  if (x === 0) return 0;
  if (!Number.isFinite(x)) return x;
  // 절댓값을 유효숫자 15자리로: "35.1234568500000", "1.00000000000000e-7" 같은 모양
  const [mantissa, exp = '0'] = Math.abs(x).toPrecision(15).split('e');
  const dot = mantissa.indexOf('.');
  const digits = dot < 0 ? mantissa : mantissa.slice(0, dot) + mantissa.slice(dot + 1);
  // 소수점이 digits 앞에서 몇 번째 자리 뒤에 있는지
  const point = (dot < 0 ? mantissa.length : dot) + Number(exp);
  const keep = point + 7; // 소수 7자리까지 남길 숫자 개수
  let text;
  if (keep >= digits.length) {
    text = `${digits}e${point - digits.length}`; // 7자리 아래가 없다
  } else if (keep < 0) {
    text = '0'; // 첫 유효숫자가 소수 8자리보다 아래
  } else {
    let head = BigInt(digits.slice(0, keep) || '0');
    if (digits[keep] >= '5') head += 1n;
    text = `${head}e-7`;
  }
  const r = Number(text) * Math.sign(x);
  return r === 0 ? 0 : r;
}
