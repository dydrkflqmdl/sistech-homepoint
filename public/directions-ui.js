// 길찾기 창(모달): [길찾기]를 누르면 카카오맵·네이버지도·카카오내비·티맵 중 하나를 고르게 하고, 고른 앱의 자동차 길찾기를 연다.
// 미션 기록 창(missions-ui.js)과 같은 방식·같은 모양이다(showModal, ×·Esc·바깥 누르기로 닫기, 닫으면 초점은 [길찾기]로).
// 미션 기록 창과 달리 상세 정보 안이 아니라 <body>에 한 번만 만들어 둔다: 상세 정보는 원격 변경으로 자주 새로 그려지는데,
// 그때마다 창이 닫히거나 다시 뜨지 않게 하려는 것이다. 목적지는 연 순간의 장소(이름·위경도)를 복사해 둔다.
import { h, refocus, toast } from './dom.js';
import { config } from './state.js';
import { logCause } from './api.js';
import { needsPhone, openRoute, platformOf, preloadKakaoNavi, ROUTE_APPS } from './directions.js';

let dialog = null;
let dialogPlaceId = null;

export const directionsDialogOpen = () => dialog !== null;

// [길찾기]가 있는 자리(상세 카드는 새로 그려지므로 고를 때마다 찾는다).
const OPENER = '#detail .route-open';

// 창 닫기(× · Esc · 바깥 누르기 · 앱을 고른 뒤). restoreFocus가 거짓이면 초점을 옮기지 않는다(장소가 바뀌어 닫을 때).
export function closeDirectionsDialog({ restoreFocus = true } = {}) {
  if (!dialog) return;
  const d = dialog;
  dialog = null;
  dialogPlaceId = null;
  if (d.open) d.close();
  d.remove();
  if (restoreFocus) refocus(OPENER);
}

// 상세 정보를 그릴 때 부른다: 창을 연 장소가 더는 고른 장소가 아니면(다른 장소를 골랐거나 닫힘·삭제·로그아웃) 창도 닫는다.
export function syncDirectionsDialog(selectedPlaceId) {
  if (dialog && dialogPlaceId !== selectedPlaceId) closeDirectionsDialog({ restoreFocus: false });
}

// 앱을 고르면 창을 먼저 닫고 연다. 카카오내비는 SDK가 아직 오는 중일 수 있어 끝나는 대로 열리고, 못 열면 창 밖 알림으로 알린다.
async function choose(appId, place) {
  closeDirectionsDialog();
  try {
    await openRoute(appId, place, { kakaoKey: config.kakaoJsKey });
  } catch (err) {
    logCause(`길찾기(${appId})를 열지 못했습니다.`, err);
    toast(appId === 'kakaonavi' ? '카카오내비를 열지 못했습니다. 잠시 뒤 다시 눌러 주세요.' : '길찾기를 열지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
  }
}

export function openDirections(p) {
  closeDirectionsDialog({ restoreFocus: false });
  const place = { id: p.id, name: p.name, lat: p.lat, lng: p.lng };
  const platform = platformOf();
  // 카카오내비 SDK는 이 창을 열 때부터 불러온다(한 번만). 처음부터 모든 사람이 받지 않고, 쓸 수 없는 PC에서는 받지 않는다.
  if (!needsPhone('kakaonavi', platform)) preloadKakaoNavi();
  const apps = ROUTE_APPS.map((app, i) => {
    const phoneOnly = needsPhone(app.id, platform);
    return h(
      'button',
      {
        type: 'button',
        class: 'btn route-app',
        'data-app': app.id,
        disabled: phoneOnly,
        // 처음 초점은 열 수 있는 첫 앱에(키보드·화면 읽기 프로그램이 바로 이어서 쓴다).
        autofocus: i === 0 ? true : null,
        onclick: () => choose(app.id, place),
      },
      h('span', { class: 'route-app-name' }, h('span', { class: 'route-dot', style: `background:${app.color}`, 'aria-hidden': 'true' }), app.label),
      phoneOnly && h('span', { class: 'route-app-note' }, '휴대폰에서만 열 수 있습니다'),
    );
  });
  dialog = h(
    'dialog',
    {
      class: 'directions-dialog',
      'aria-labelledby': 'directions-dialog-title',
      // 휴대폰 뒤로 가기 등 브라우저가 닫으려 할 때도 같은 길로 닫는다. Esc는 detail-ui.js가 먼저 받는다.
      oncancel: (e) => {
        e.preventDefault();
        closeDirectionsDialog();
      },
      // 창 바깥(어두운 배경)을 누르면 닫는다. 창 안은 .mission-dialog-body가 꽉 채우므로 dialog 자신이 눌린 것이 바깥이다.
      onclick: (e) => {
        if (e.target === e.currentTarget) closeDirectionsDialog();
      },
    },
    h(
      'div',
      { class: 'mission-dialog-body' },
      h(
        'div',
        { class: 'mission-dialog-head' },
        h('div', {}, h('h3', { id: 'directions-dialog-title' }, '길찾기'), h('p', { class: 'mission-dialog-place' }, place.name)),
        h('button', { type: 'button', class: 'icon-btn directions-dialog-close', 'aria-label': '닫기', onclick: () => closeDirectionsDialog() }, '×'),
      ),
      h('div', { class: 'route-apps' }, apps),
    ),
  );
  dialogPlaceId = place.id;
  document.body.append(dialog);
  dialog.showModal();
}
