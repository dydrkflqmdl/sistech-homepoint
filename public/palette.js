// 장소 색은 손으로 고르지 않고 미션 진행 상태로 정해진다. 내보내기(csv.js)와 화면이 함께 쓴다.
export const PALETTE = [
  { hex: '#e5484d', label: '미진행' }, // 완료한 미션이 하나도 없음(미션이 없는 장소 포함)
  { hex: '#f76b15', label: '진행 중' }, // 일부만 완료
  { hex: '#30a46c', label: '완료' }, // 전부 완료
];

export const DEFAULT_COLOR = PALETTE[0].hex;

// missionProgress()가 돌려주는 { total, done }으로 색을 정한다.
export function progressColor({ total, done }) {
  if (total > 0 && done >= total) return PALETTE[2].hex;
  if (done > 0) return PALETTE[1].hex;
  return PALETTE[0].hex;
}

export function colorLabel(hex) {
  return PALETTE.find((p) => p.hex === hex)?.label ?? hex;
}
