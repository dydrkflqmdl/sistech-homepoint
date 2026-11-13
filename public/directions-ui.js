// 길찾기 단추: 상세 카드에 카카오맵·네이버지도·카카오내비·티맵 4개를 바로 둔다. 누르면 그 앱의 자동차 길찾기를 연다.
// 상세 카드는 원격 변경으로 자주 새로 그려지므로, 단추는 그릴 때마다 새로 만들고 목적지(이름·위경도)는 그린 장소에서 복사해 둔다.
// 휴대폰이 아니면(PC) 카카오내비·티맵은 쓸 수 없어 꺼 두고, 묶음 아래 한 줄로 이유를 알려 준다.
import { h, toast } from './dom.js';
import { config } from './state.js';
import { logCause } from './api.js';
import { needsPhone, openRoute, platformOf, preloadKakaoNavi, ROUTE_APPS } from './directions.js';

// 카카오내비 SDK는 휴대폰에서 장소 상세를 처음 그릴 때 한 번만 불러오기 시작한다(쓸 수 없는 PC에서는 받지 않는다).
// 못 받아도 눌렀을 때 다시 시도하고 그때 알린다(directions.js).
let preloaded = false;

// 앱을 누르면 연다. 카카오내비는 SDK가 아직 오는 중일 수 있어 끝나는 대로 열리고, 못 열면 알림으로 알린다.
async function choose(appId, place) {
  try {
    await openRoute(appId, place, { kakaoKey: config.kakaoJsKey });
  } catch (err) {
    logCause(`길찾기(${appId})를 열지 못했습니다.`, err);
    toast(appId === 'kakaonavi' ? '카카오내비를 열지 못했습니다. 잠시 뒤 다시 눌러 주세요.' : '길찾기를 열지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
  }
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
  ];
}
