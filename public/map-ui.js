// 카카오 지도: SDK 불러오기·실패 안내·다시 불러오기, 핀(바뀐 것만 고침), 배경 지도·지적편집도 버튼, 영역 맞추기, 좁은 높이에서 지도 접기.
import { $, fill, focusDetailTitle, h, refocus } from './dom.js';
import { config, hooks, placeColor, readStorage, state, visiblePlaces, writeStorage } from './state.js';
import { colorLabel } from './palette.js';
import { missionProgress } from './mission.js';

// 장소 고르기는 위쪽 모듈(detail-ui.js 등)에 있어 hooks로 부른다.
const requestSelect = (...args) => hooks.requestSelect(...args);

// 카카오맵 SDK는 키를 받아 비동기로 불러오므로, 지도가 준비되기 전에도 목록·상세 정보는 먼저 그린다.
// 준비 전에 들어온 핀 그리기·영역 맞추기는 미뤄 두었다가 준비되면 한 번에 반영한다.
let kmap = null;
let pendingFit = null;
const markers = new Map(); // 장소 id → { overlay, el }

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 지도 칸 안에 안내 문구를 띄운다(키 없음·불러오기 실패). 목록·상세 정보는 그대로 쓸 수 있다.
function showMapMessage(...lines) {
  fill($('#map'), h('div', { class: 'map-message', role: 'status' }, lines.map((t) => h('p', {}, t))));
}

// 지도 상태: 'idle'(아직 안 함) → 'loading' → 'ready' | 'failed'(다시 시도 가능) | 'nokey'(설정 문제라 다시 해도 같음).
export let mapState = 'idle';
const MAP_FAILED_MESSAGE = '지도를 불러오지 못했습니다. 인터넷이 약하면 목록과 길찾기는 그대로 쓸 수 있습니다.';

// 작업자에게는 쉬운 안내와 [지도 다시 불러오기]만 보여 준다. 등록 도메인 같은 관리자용 설명은 콘솔에만 남긴다.
function showMapFailure() {
  fill(
    $('#map'),
    h(
      'div',
      { class: 'map-message', role: 'status' },
      h('p', {}, MAP_FAILED_MESSAGE),
      h('button', { type: 'button', class: 'btn', id: 'map-retry', onclick: () => startMap() }, '지도 다시 불러오기'),
    ),
  );
}

const KAKAO_SDK_TIMEOUT_MS = 15000;
// SDK 주소(sdk.js)는 키가 틀려도 정상으로 내려오는 경우가 있어, 지도 모듈(kakao.maps.load)이 끝내 안 오면 실패로 본다.
// 다시 부르면 앞서 넣은 <script>를 지우고 새로 받는다(앞 시도에서 늦게라도 받아졌으면 그것을 쓴다).
function loadKakaoSdk(key) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error('timeout')), KAKAO_SDK_TIMEOUT_MS);
    function ok(maps) {
      clearTimeout(timer);
      resolve(maps);
    }
    function fail(err) {
      clearTimeout(timer);
      reject(err);
    }
    const ready = () => {
      try {
        window.kakao.maps.load(() => ok(window.kakao.maps));
      } catch (err) {
        fail(err);
      }
    };
    // 자동 점검은 가짜 SDK를 먼저 심어 두므로, 이미 있으면 진짜를 불러오지 않는다.
    if (window.kakao?.maps) {
      ready();
      return;
    }
    document.getElementById('kakao-sdk')?.remove();
    const script = document.createElement('script');
    script.id = 'kakao-sdk';
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false&libraries=services`;
    script.onload = () => (window.kakao?.maps ? ready() : fail(new Error('no kakao.maps')));
    script.onerror = () => fail(new Error('load error'));
    document.head.append(script);
  });
}

// 지도를 (다시) 불러온다. 실패하면 [지도 다시 불러오기]를 보여 주고, 인터넷이 돌아오면(online) 저절로 다시 해 본다.
export function startMap() {
  if (mapState === 'loading' || mapState === 'ready' || mapState === 'nokey') return;
  mapState = 'loading';
  showMapMessage('지도를 불러오는 중…');
  initMap().catch((err) => {
    mapState = 'failed';
    kmap = null;
    console.warn(
      `[홈포인트] 카카오맵을 불러오지 못했습니다. developers.kakao.com에서 이 주소(${location.origin})가 Web 플랫폼에 등록되어 있고 "카카오맵" 사용 설정이 켜져 있는지 확인해 주세요.`,
      err,
    );
    showMapFailure();
  });
}

// 배경 지도 3가지 + 지적편집도(필지 경계) 겹치기. 고른 값은 다음 접속 때도 쓴다.
const BASE_LAYERS = {
  map: { label: '지도', type: 'ROADMAP' },
  satellite: { label: '위성', type: 'SKYVIEW' },
  hybrid: { label: '하이브리드', type: 'HYBRID' },
};
const BASE_LAYER_STORAGE_KEY = 'baseLayer';
const CADASTRAL_STORAGE_KEY = 'cadastral';
let baseLayerKey = 'map';
let cadastralOn = false;

function syncMapToggles() {
  for (const btn of document.querySelectorAll('.layer-toggle [data-layer]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.layer === baseLayerKey));
  }
  const cad = $('.layer-toggle [data-overlay="cadastral"]');
  cad?.setAttribute('aria-pressed', String(cadastralOn));
}

function setBaseLayer(key) {
  if (!BASE_LAYERS[key] || !kmap) return;
  baseLayerKey = key;
  kmap.setMapTypeId(kakao.maps.MapTypeId[BASE_LAYERS[key].type]);
  writeStorage(BASE_LAYER_STORAGE_KEY, key);
  syncMapToggles();
}

function setCadastral(on) {
  if (!kmap) return;
  cadastralOn = on;
  if (on) kmap.addOverlayMapTypeId(kakao.maps.MapTypeId.USE_DISTRICT);
  else kmap.removeOverlayMapTypeId(kakao.maps.MapTypeId.USE_DISTRICT);
  writeStorage(CADASTRAL_STORAGE_KEY, on ? '1' : '0');
  syncMapToggles();
}

// 지도 오른쪽 위 버튼. 카카오 지도 칸 밖(겹친 층)에 두어 지도 끌기·확대와 섞이지 않게 한다.
function mapControls() {
  return h(
    'div',
    { class: 'map-controls' },
    h(
      'div',
      { class: 'layer-toggle', role: 'group', 'aria-label': '배경 지도' },
      Object.entries(BASE_LAYERS).map(([key, { label }]) =>
        h('button', { type: 'button', 'data-layer': key, 'aria-pressed': 'false', onclick: () => setBaseLayer(key) }, label),
      ),
    ),
    h(
      'div',
      { class: 'layer-toggle', role: 'group', 'aria-label': '겹쳐 보기' },
      h(
        'button',
        { type: 'button', 'data-overlay': 'cadastral', 'aria-pressed': 'false', title: '지적편집도(필지 경계)', onclick: () => setCadastral(!cadastralOn) },
        '필지',
      ),
    ),
  );
}

// 멀리서 보면 메모 글씨가 서로 겹치므로, 이만큼 멀어지면 선택한 장소의 메모만 보여 준다.
// 카카오 지도 단계는 숫자가 클수록 멀다(1이 가장 가까움). 7단계쯤이 예전(Leaflet) 12배율과 비슷하다.
const MEMO_LABEL_MAX_LEVEL = 6;
const syncMemoLabels = () => kmap && $('#map').classList.toggle('hide-memo', kmap.getLevel() > MEMO_LABEL_MAX_LEVEL);

// 키가 틀렸거나, 이 주소가 앱에 등록되지 않았거나, 인터넷이 끊기면 loadKakaoSdk가 던진다(startMap이 받아 안내한다).
async function initMap() {
  // 키는 config.js(window.APP_CONFIG.kakaoJsKey)에 들어 있다. 카카오 콘솔에 등록한 도메인에서만 동작하는 공개 키다.
  const key = config.kakaoJsKey;
  if (!key) {
    mapState = 'nokey';
    showMapMessage('카카오맵 키가 없습니다. config.js의 kakaoJsKey(.env의 KAKAO_JS_KEY 또는 배포 설정의 Secrets)를 확인해 주세요.');
    return;
  }
  const maps = await loadKakaoSdk(key);
  const el = $('#map');
  el.replaceChildren();
  kmap = new maps.Map(el, { center: new maps.LatLng(36.4, 127.9), level: 10 });
  mapState = 'ready';
  // 화면 폭이 바뀌어 지도 칸 크기가 달라지면 카카오 지도에 알려 줘야 빈 곳 없이 다시 그린다.
  new ResizeObserver(() => kmap?.relayout()).observe(el);
  maps.event.addListener(kmap, 'zoom_changed', syncMemoLabels);
  $('.map-area').append(mapControls());

  const savedLayer = readStorage(BASE_LAYER_STORAGE_KEY);
  setBaseLayer(BASE_LAYERS[savedLayer] ? savedLayer : 'map');
  if (readStorage(CADASTRAL_STORAGE_KEY) === '1') setCadastral(true);
  syncMapToggles();
  syncMemoLabels();

  renderMarkers(visiblePlaces());
  if (pendingFit) fitToPlaces(pendingFit);
  pendingFit = null;
}

// 핀 모양(SVG)과 메모 말풍선. 메모나 미션이 있는 장소는 핀 바로 위에 미션 진행도(완료/전체)와 메모 내용을 띄운다.
function pinHtml(color, selected, memo, progress = '') {
  const w = selected ? 34 : 26;
  const hgt = Math.round((w * 4) / 3);
  const memoLabel =
    memo || progress
      ? `<span class="memo-label"><svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 4h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-7l-5 4v-4H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" fill="${color}"/></svg>
        ${progress ? `<b class="memo-progress">${escapeHtml(progress)}</b>` : ''}${memo ? `<span class="memo-text">${escapeHtml(memo)}</span>` : ''}</span>`
      : '';
  return `<svg class="pin-shape" viewBox="0 0 24 32" width="${w}" height="${hgt}" aria-hidden="true">
      <path d="M12 1C5.9 1 1 5.8 1 11.8 1 20 12 31 12 31s11-11 11-19.2C23 5.8 18.1 1 12 1z" fill="${color}" stroke="#fff" stroke-width="1.6"/>
      <circle cx="12" cy="11.6" r="4.2" fill="#fff"/></svg>${memoLabel}`;
}

// 핀 하나. 누르거나(클릭) 초점을 둔 채 Enter·Space를 누르면 그 장소를 고르고 상세 정보 제목으로 초점을 옮긴다.
function createPin(p) {
  const el = h('div', { class: 'pin', tabindex: '0', role: 'button', 'data-id': p.id });
  // 지도 끌기·클릭이 핀 아래로 새지 않게 한다.
  for (const type of ['mousedown', 'touchstart', 'dblclick']) el.addEventListener(type, (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (requestSelect(p.id)) focusDetailTitle();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (requestSelect(p.id, { pan: true })) focusDetailTitle();
  });
  const overlay = new kakao.maps.CustomOverlay({
    position: new kakao.maps.LatLng(p.lat, p.lng),
    content: el,
    xAnchor: 0.5,
    yAnchor: 1,
    clickable: true,
  });
  overlay.setMap(kmap);
  return { overlay, el };
}

export function renderMarkers(visible) {
  if (!kmap) return;
  const visibleIds = new Set(visible.map((p) => p.id));
  for (const [id, marker] of markers) {
    if (!visibleIds.has(id)) {
      marker.overlay.setMap(null);
      markers.delete(id);
    }
  }
  // 핀은 그대로 두고, 모양(색·선택·말풍선)·이름표·위치·쌓는 순서 중 바뀐 것만 고친다.
  // 장소 하나를 고를 때 수백 개 핀을 모두 다시 그리지 않게 한다(바뀌는 핀은 앞서 고른 것과 새로 고른 것 둘뿐).
  for (const p of visible) {
    const selected = p.id === state.selectedId;
    let marker = markers.get(p.id);
    if (!marker) {
      marker = createPin(p);
      markers.set(p.id, marker);
    }
    const { el, overlay } = marker;
    const { total, done } = missionProgress(p.mission, p.missions);
    const color = placeColor(p);
    const progress = total > 0 ? `${done}/${total}` : '';
    const memo = p.memo.trim();
    const look = `${color}|${selected}|${progress}|${memo}`;
    if (marker.look !== look) {
      marker.look = look;
      el.className = selected ? 'pin selected' : 'pin';
      el.innerHTML = pinHtml(color, selected, memo, progress);
    }
    // 화면 읽기 프로그램에는 이름과 진행 상태를 함께 알려 준다("SW_01, 진행 중 1/34").
    const label = `${p.name}, ${colorLabel(color)}${progress ? ` ${progress}` : ''}`;
    if (marker.label !== label) {
      marker.label = label;
      el.title = p.name;
      el.setAttribute('aria-label', label);
    }
    const position = `${p.lat},${p.lng}`;
    if (marker.position !== position) {
      marker.position = position;
      overlay.setPosition(new kakao.maps.LatLng(p.lat, p.lng));
    }
    // 고른 핀을 맨 위에.
    if (marker.selected !== selected) {
      marker.selected = selected;
      overlay.setZIndex(selected ? 10 : 1);
    }
  }
}

// 모든 장소가 보이게 맞춘다. 장소가 하나뿐이면 너무 가까워지지 않게 3단계에서 멈춘다.
export function fitToPlaces(places) {
  if (places.length === 0) return;
  if (!kmap) {
    pendingFit = places;
    return;
  }
  const bounds = new kakao.maps.LatLngBounds();
  for (const p of places) bounds.extend(new kakao.maps.LatLng(p.lat, p.lng));
  kmap.setBounds(bounds, 40, 40, 40, 40);
  if (kmap.getLevel() < 3) kmap.setLevel(3);
}

// 고른 장소로 지도를 옮긴다. 멀리 있으면 4단계(예전 15배율쯤)까지 다가간다.
export function panToPlace(p) {
  if (!kmap) return;
  const latlng = new kakao.maps.LatLng(p.lat, p.lng);
  if (kmap.getLevel() > 4) kmap.setLevel(4, { anchor: latlng });
  kmap.panTo(latlng);
}

// 높이가 낮은 화면(가로로 든 휴대폰, 500px 이하)에서는 지도를 접어 목록을 넓게 쓸 수 있다. 고른 값은 기억한다.
const MAP_COLLAPSED_KEY = 'mapCollapsed';
let mapCollapsed = readStorage(MAP_COLLAPSED_KEY) === '1';
function syncMapToggle() {
  $('.app').classList.toggle('map-collapsed', mapCollapsed);
  const btn = $('#map-toggle');
  btn.setAttribute('aria-expanded', String(!mapCollapsed));
  btn.textContent = mapCollapsed ? '지도 펼치기' : '지도 접기';
}
$('#map-toggle').addEventListener('click', () => {
  mapCollapsed = !mapCollapsed;
  writeStorage(MAP_COLLAPSED_KEY, mapCollapsed ? '1' : '0');
  syncMapToggle();
  refocus('#map-toggle');
});
syncMapToggle();
