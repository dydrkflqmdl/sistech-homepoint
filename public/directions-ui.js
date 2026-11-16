// 길찾기 단추: 상세 카드에 카카오맵·네이버지도·카카오내비·티맵 4개를 바로 둔다. 누르면 그 앱의 자동차 길찾기를 연다.
// 상세 카드는 원격 변경으로 자주 새로 그려지므로, 단추는 그릴 때마다 새로 만들고 목적지(이름·위경도)는 그린 장소에서 복사해 둔다.
// 휴대폰이 아니면(PC) 카카오내비·티맵은 쓸 수 없어 꺼 두고, 묶음 아래 한 줄로 이유를 알려 준다.
import { h, toast } from './dom.js';
import { config, hooks } from './state.js';
import { logCause } from './api.js';
import { needsPhone, openRoute, platformOf, preloadKakaoNavi, ROUTE_APPS } from './directions.js';

// 카카오내비 SDK는 휴대폰에서 장소 상세를 처음 그릴 때 한 번만 불러오기 시작한다(쓸 수 없는 PC에서는 받지 않는다).
// 못 받아도 눌렀을 때 다시 시도하고 그때 알린다(directions.js).
let preloaded = false;

// 앱이 안 열린 것 같을 때(1.5초 뒤에도 화면 그대로) 묶음 아래에 보여 줄 안내: null 또는 { placeId, appId, platform, url }.
let routeHelp = null;

// 안내를 지우고, 화면에 떠 있었으면 다시 그린다.
function clearHelp() {
  if (!routeHelp) return;
  routeHelp = null;
  hooks.renderKeepingInput?.();
}

// 안내가 뜬 뒤 사용자가 앱을 열어 페이지가 숨겨지면 안내를 지운다(돌아왔을 때 남아 있지 않게). 리스너는 한 번만 건다.
let watching = false;
function watchHidden() {
  if (watching) return;
  watching = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearHelp();
  });
}

// 앱을 누르면 연다. 카카오내비는 SDK가 아직 오는 중일 수 있어 끝나는 대로 열리고, 못 열면 알림으로 알린다.
async function choose(appId, place) {
  clearHelp(); // 이전 안내 제거
  watchHidden();
  try {
    await openRoute(appId, place, {
      kakaoKey: config.kakaoJsKey,
      onNotOpened: ({ platform, url }) => {
        if (!url) return;
        routeHelp = { placeId: place.id, appId, platform, url };
        hooks.renderKeepingInput?.();
      },
    });
  } catch (err) {
    logCause(`길찾기(${appId})를 열지 못했습니다.`, err);
    toast(appId === 'kakaonavi' ? '카카오내비를 열지 못했습니다. 잠시 뒤 다시 눌러 주세요.' : '길찾기를 열지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
  }
}

// "앱이 열리지 않으면 [링크]" 한 줄. 링크를 누르면 안내는 지운다(기본 동작은 막지 않는다).
function helpLine({ appId, platform, url }) {
  const text = appId === 'tmap' ? `${platform === 'ios' ? '앱스토어' : '플레이스토어'}에서 티맵 받기` : '웹에서 길찾기 열기';
  return h(
    'p',
    { class: 'route-help', role: 'status' },
    '앱이 열리지 않으면 ',
    h('a', { href: url, target: '_blank', rel: 'noopener', onclick: () => { routeHelp = null; setTimeout(() => hooks.renderKeepingInput?.(), 0); } }, text),
  );
}

// 상세 카드에 넣을 길찾기 묶음(단추 4개 + PC 안내 한 줄)을 만든다.
export function routeActions(p) {
  const place = { id: p.id, name: p.name, lat: p.lat, lng: p.lng };
  const platform = platformOf();
  if (!preloaded && !needsPhone('kakaonavi', platform)) {
    preloaded = true;
    preloadKakaoNavi();
  }
  const anyPhoneOnly = ROUTE_APPS.some((app) => needsPhone(app.id, platform));
  const apps = ROUTE_APPS.map((app) =>
    h(
      'button',
      {
        type: 'button',
        class: 'btn route-app',
        'data-app': app.id,
        disabled: needsPhone(app.id, platform),
        'aria-describedby': needsPhone(app.id, platform) ? 'route-note' : null,
        onclick: () => choose(app.id, place),
      },
      // 앱 이름 글자가 단추 이름이므로 아이콘은 꾸밈(alt="")이다.
      h('img', { class: 'route-icon', src: app.icon, alt: '', width: 24, height: 24, decoding: 'async' }),
      app.label,
    ),
  );
  return [
    h('div', { class: 'route-actions', role: 'group', 'aria-label': '길찾기' }, apps),
    anyPhoneOnly && h('p', { id: 'route-note', class: 'route-note' }, '카카오내비·티맵은 휴대폰에서만 열 수 있습니다.'),
    routeHelp?.placeId === p.id && helpLine(routeHelp),
  ];
}
