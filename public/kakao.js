// 카카오맵으로 장소를 넘기는 링크들. 앱 키 없이 URL만으로 열 수 있다.

function isMobile() {
  const ua = navigator.userAgent;
  // iPadOS는 데스크톱 Safari로 자신을 소개하므로 터치 지원 여부로 구분한다.
  return /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// 카카오맵 링크는 "이름,위도,경도" 형식이라 이름 안의 쉼표와 슬래시를 지운다.
const linkName = (name) => encodeURIComponent(name.replace(/[,/]/g, ' ').trim() || '목적지');

export const kakaoMapViewUrl = (p) => `https://map.kakao.com/link/map/${linkName(p.name)},${p.lat},${p.lng}`;
export const kakaoMapRouteUrl = (p) => `https://map.kakao.com/link/to/${linkName(p.name)},${p.lat},${p.lng}`;
const kakaoMapAppRouteUrl = (p) => `kakaomap://route?ep=${p.lat},${p.lng}&by=car`;

// 휴대폰에서는 카카오맵 앱의 자동차 길찾기를 바로 열고, 앱이 없어서 화면이 그대로면 웹 길찾기로 넘어간다.
// PC에서는 웹 길찾기를 새 탭으로 연다.
export function openKakaoMapRoute(place) {
  const webUrl = kakaoMapRouteUrl(place);
  if (!isMobile()) {
    window.open(webUrl, '_blank', 'noopener');
    return;
  }
  const fallback = setTimeout(() => {
    if (!document.hidden) location.href = webUrl;
  }, 1500);
  document.addEventListener('visibilitychange', () => clearTimeout(fallback), { once: true });
  location.href = kakaoMapAppRouteUrl(place);
}
