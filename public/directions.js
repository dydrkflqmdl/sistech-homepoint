// 길찾기 링크들: 카카오맵·네이버지도·카카오내비·티맵. 링크를 만드는 함수는 순수 함수(화면을 모른다)라 test/directions.test.js가 확인한다.
// 여는 함수(openRoute)만 브라우저(location·window.open)와 카카오 JavaScript SDK를 쓴다.

// 어떤 기기인지: 'android' | 'ios' | 'pc'. iPadOS는 데스크톱 Safari로 자신을 소개하므로 터치 지원 여부로 구분한다.
export function platformOf(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints) {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ios';
  return 'pc';
}

// 길찾기 단추로 보여 줄 앱 목록(순서대로). icon은 단추 앞의 앱 아이콘(public/icons/, 앱스토어 공식 아이콘 96×96).
// 아이콘은 각 회사 상표라 "그 앱 열기" 단추 표시로만 쓴다.
export const ROUTE_APPS = [
  { id: 'kakaomap', label: '카카오맵', icon: './icons/kakaomap.png' },
  { id: 'navermap', label: '네이버지도', icon: './icons/navermap.png' },
  { id: 'kakaonavi', label: '카카오내비', icon: './icons/kakaonavi.png' },
  { id: 'tmap', label: '티맵', icon: './icons/tmap.png' },
];

// 카카오내비는 SDK로만, 티맵은 앱 주소뿐(웹 길찾기 없음)이라 PC에서는 열 수 없다.
export const needsPhone = (appId, platform) => platform === 'pc' && (appId === 'kakaonavi' || appId === 'tmap');

// ── 링크 만들기(순수 함수) ───────────────────────────────

const PLAY_STORE = (id) => `https://play.google.com/store/apps/details?id=${id}`;
export const TMAP_PACKAGE = 'com.skt.tmap.ku';
export const TMAP_PLAY_URL = PLAY_STORE(TMAP_PACKAGE);
export const TMAP_APPSTORE_URL = 'https://apps.apple.com/kr/app/id431589174';
export const KAKAOMAP_PACKAGE = 'net.daum.android.map';
export const NAVER_PACKAGE = 'com.nhn.android.nmap';

// 이름이 비면 "목적지". 앱 주소(네이버·티맵)에 넣는 이름이다.
const appName = (name) => encodeURIComponent(String(name).trim() || '목적지');
// 카카오맵·네이버 웹 주소는 "이름,위도,경도"처럼 쉼표·슬래시로 칸을 나누므로 이름 안의 쉼표와 슬래시를 지운다.
const linkName = (name) => encodeURIComponent(String(name).replace(/[,/]/g, ' ').trim() || '목적지');

// 카카오맵
export const kakaoMapRouteUrl = (p) => `https://map.kakao.com/link/to/${linkName(p.name)},${p.lat},${p.lng}`;
// 앱 주소(공식 문서는 없지만 쓰던 형식). 이름 칸이 없어 목적지 이름은 앱에 안 넘어간다.
export const kakaoMapAppUrl = (p) => `kakaomap://route?ep=${p.lat},${p.lng}&by=car`;

// 네이버지도: 앱 주소는 공식(https://guide.ncloud-docs.com/docs/maps-url-scheme), appname은 필수(모바일 웹은 웹 페이지 주소).
// 웹 길찾기 주소(공식 아님)는 "도착지만 채우고 자동차" 화면을 연다. 좌표 순서가 경도,위도다.
export const naverMapAppUrl = (p, origin) =>
  `nmap://route/car?dlat=${p.lat}&dlng=${p.lng}&dname=${appName(p.name)}&appname=${encodeURIComponent(origin)}`;
export const naverMapWebUrl = (p) => `https://map.naver.com/p/directions/-/${p.lng},${p.lat},${linkName(p.name)},,/-/car`;

// 티맵(공식 문서 없음). 좌표 순서가 경도(goalx), 위도(goaly)다.
export const tmapAppUrl = (p) => `tmap://route?goalname=${appName(p.name)}&goalx=${p.lng}&goaly=${p.lat}`;

// 안드로이드 intent 주소: 앱이 있으면 그 앱을 열고, 없으면 S.browser_fallback_url로 보낸다(크롬·웹뷰 앱 모두 같다).
// appUrl의 "scheme://" 뒷부분을 그대로 가져온다. 대체 주소는 한 번 더 인코딩해 넣는다.
export function androidIntentUrl(appUrl, pkg, fallbackUrl) {
  const i = appUrl.indexOf('://');
  const [scheme, rest] = [appUrl.slice(0, i), appUrl.slice(i + 3)];
  return (
    `intent://${rest}#Intent;scheme=${scheme};action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;` +
    `package=${pkg};S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`
  );
}

// 앱을 눌렀을 때 무엇을 할지.
//   { type: 'tab', url }                    새 탭으로 웹 길찾기(PC)
//   { type: 'intent', url }                 안드로이드: location.href에 넣으면 앱, 없으면 대체 주소
//   { type: 'scheme', url, fallback }       iOS: 앱 주소로 가 보고 1.5초 뒤에도 화면이 그대로면 대체 주소
//   { type: 'navi' }                        카카오내비(SDK)
//   { type: 'unavailable' }                 PC에서는 못 엶
export function routeTarget(appId, place, { platform, origin }) {
  if (appId === 'kakaonavi') return platform === 'pc' ? { type: 'unavailable' } : { type: 'navi' };
  if (needsPhone(appId, platform)) return { type: 'unavailable' };
  // 웹 길찾기가 있는 앱은 PC에서 새 탭으로, 휴대폰에서는 앱이 없을 때의 대체 주소로 쓴다. 티맵은 웹이 없어 스토어로 보낸다.
  const web = { kakaomap: kakaoMapRouteUrl(place), navermap: naverMapWebUrl(place) }[appId];
  const apps = {
    kakaomap: { app: kakaoMapAppUrl(place), pkg: KAKAOMAP_PACKAGE, android: web, ios: web },
    navermap: { app: naverMapAppUrl(place, origin), pkg: NAVER_PACKAGE, android: web, ios: web },
    tmap: { app: tmapAppUrl(place), pkg: TMAP_PACKAGE, android: TMAP_PLAY_URL, ios: TMAP_APPSTORE_URL },
  };
  const a = apps[appId];
  if (!a) throw new Error(`알 수 없는 길찾기 앱: ${appId}`);
  if (platform === 'pc') return { type: 'tab', url: web };
  if (platform === 'android') return { type: 'intent', url: androidIntentUrl(a.app, a.pkg, a.android) };
  return { type: 'scheme', url: a.app, fallback: a.ios };
}

// ── 카카오내비(Kakao JavaScript SDK) ─────────────────────

// URL 스킴은 공식으로 지원하지 않아 SDK로만 연다. 휴대폰에서 장소 상세를 처음 그릴 때 미리 불러오기 시작한다(preloadKakaoNavi).
export const NAVI_SDK_URL = 'https://t1.kakaocdn.net/kakao_js_sdk/2.8.5/kakao.min.js';
export const NAVI_SDK_INTEGRITY = 'sha384-v6JKY3z4FUkWq21oZDHZe74YvuPk/WUrVLrDHTBojHXClOSa3iXy7sCXPY1jkFbj';
const NAVI_SDK_TIMEOUT_MS = 15000;
let naviSdk = null;

// SDK를 한 번만 불러온다. 실패하면 다음에 눌렀을 때 다시 받도록 비워 둔다.
// 자동 점검은 가짜 window.Kakao를 먼저 심어 두므로, 이미 있으면 진짜를 불러오지 않는다.
function loadNaviSdk() {
  if (window.Kakao?.Navi) return Promise.resolve(window.Kakao);
  if (naviSdk) return naviSdk;
  naviSdk = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), NAVI_SDK_TIMEOUT_MS);
    document.getElementById('kakao-navi-sdk')?.remove();
    const script = document.createElement('script');
    script.id = 'kakao-navi-sdk';
    script.src = NAVI_SDK_URL;
    script.integrity = NAVI_SDK_INTEGRITY;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      clearTimeout(timer);
      if (window.Kakao?.Navi) resolve(window.Kakao);
      else reject(new Error('no Kakao.Navi'));
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('load error'));
    };
    document.head.append(script);
  }).catch((err) => {
    naviSdk = null;
    document.getElementById('kakao-navi-sdk')?.remove();
    throw err;
  });
  return naviSdk;
}

// 미리 불러오기(실패해도 조용히 넘어간다. 실제로 눌렀을 때 다시 시도하고 그때 안내한다).
export const preloadKakaoNavi = () => loadNaviSdk().catch(() => {});

// 카카오내비 앱을 연다. 좌표 종류(coordType)를 'wgs84'로 알려 줘야 한다(빼면 기본값 katec이라 엉뚱한 곳이 된다).
// 앱이 없으면 SDK가 설치 페이지로 보낸다.
export async function startKakaoNavi(place, key) {
  if (!key) throw new Error('카카오 JavaScript 키가 없습니다');
  const Kakao = await loadNaviSdk();
  if (!Kakao.isInitialized()) Kakao.init(key);
  Kakao.Navi.start({ name: String(place.name).trim() || '목적지', x: Number(place.lng), y: Number(place.lat), coordType: 'wgs84' });
}

// ── 열기 ─────────────────────────────────────────────

// 주소로 이동. 자동 점검이 실제 이동 없이 주소만 받아 보도록 window.__e2eGo가 있으면 그것을 대신 부른다.
function go(url) {
  if (typeof window.__e2eGo === 'function') window.__e2eGo(url);
  else location.href = url;
}

// 앱 주소로 가 보고, 앱이 없어서 화면이 그대로면(숨겨지지 않았으면) 1.5초 뒤 대체 주소로 넘어간다.
function openAppThenFallback(appUrl, fallbackUrl) {
  const timer = setTimeout(() => {
    if (!document.hidden) go(fallbackUrl);
  }, 1500);
  document.addEventListener('visibilitychange', () => clearTimeout(timer), { once: true });
  go(appUrl);
}

// 고른 앱으로 목적지(place: { name, lat, lng })의 자동차 길찾기를 연다.
// 카카오내비는 비동기이고 실패할 수 있어 Promise를 돌려준다(나머지는 바로 끝나 resolve).
export async function openRoute(appId, place, { kakaoKey } = {}) {
  const target = routeTarget(appId, place, { platform: platformOf(), origin: location.origin });
  switch (target.type) {
    case 'tab':
      window.open(target.url, '_blank', 'noopener');
      break;
    case 'intent':
      go(target.url);
      break;
    case 'scheme':
      openAppThenFallback(target.url, target.fallback);
      break;
    case 'navi':
      await startKakaoNavi(place, kakaoKey);
      break;
    default:
      break;
  }
}
