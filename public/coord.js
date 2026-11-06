// 좌표를 소수 7자리(약 1cm)로 반올림한다. 같은 장소(이름·좌표)인지 가릴 때 쓰며, DB의 판정 기준과 같아야 한다.
export const roundCoord = (n) => Math.round(n * 1e7) / 1e7;
