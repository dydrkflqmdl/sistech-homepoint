import { PALETTE, colorLabel, progressColor } from './palette.js';
import { kakaoMapViewUrl, openKakaoMapRoute } from './kakao.js';
import { missionNames, missionProgress } from './mission.js';
import { CsvFormatError, readPlaces, toCsv } from './csv.js';
import { LOGIN_ID_RULE, emailToLoginId, loginIdToEmail } from './login-id.js';
import { eventLabel, formatLogTime, shortUserAgent } from './login-log.js';
import * as api from './api.js';

// 로그인 기록 창의 처음 상태(닫힘). 열 때마다 새로 불러온다.
const freshLoginLog = () => ({ open: false, loading: false, rows: [], error: null });

const state = {
  places: [],
  selectedId: null,
  // 상세 정보에서 펼쳐 둔 미션 이름. 다른 장소를 고르면 닫는다.
  selectedMission: null,
  // 미션 기록을 고치는 중인 값. 저장 버튼을 누르기 전까지는 서버에 보내지 않는다.
  // 상세 정보를 다시 그려도(메모 저장·색 바꾸기 등) 적던 글자가 남도록 화면이 아니라 여기에 둔다.
  missionDraft: null,
  filterColor: null,
  query: '',
  // 가져올 CSV 파일들(고른 순서). 여러 개를 한꺼번에 고르거나 끌어다 놓을 수 있다.
  importFiles: null,
  // CSV가 아니라서 건너뛴 파일: [{ name, reason }]
  importSkipped: [],
  // 파일마다의 결과: [{ file, result } | { file, error }]. 아직 안 가져왔으면 null.
  importResults: null,
  // 가져오는 중인 파일 번호(1부터). 단추에 "가져오는 중… (2/5)"로 보여 준다.
  importProgress: 0,
  importing: false,
  // 목록에서 사람이 펼쳐 둔 시군. 기준은 "모두 접힘"이라 새로고침·상태 분류·처음 화면에서는 전부 접힌다(저장하지 않는다).
  openGroups: new Set(),
  // 저절로 펼쳐진 묶음(고른 장소·검색)을 사람이 접은 것. 검색어·거르기·선택이 바뀌면 잊는다.
  closedGroups: new Set(),
  // 로그인 기록 창. 가져오기 창·상세 정보와 동시에 열지 않는다.
  loginLog: freshLoginLog(),
};

// config.js가 window.APP_CONFIG에 넣어 둔 설정(카카오 키·Supabase 주소와 공개 키).
const config = api.readConfig();

// 로그인할 때마다 하나씩 올린다. 응답을 기다리는 사이 로그아웃·다른 계정 로그인이 있었으면 그 응답은 버린다.
let authEpoch = 0;
let currentUser = null; // { id, email, name } — name은 머리글에 보여 줄 아이디
let unsubscribeChanges = null;
let mapStarted = false;
let loggingOut = false;
const signedIn = () => currentUser !== null;

// 그룹을 모두 접는다. 상태 분류를 바꾸거나 처음 화면으로 갈 때 쓴다.
function collapseAllGroups() {
  state.openGroups.clear();
  state.closedGroups.clear();
}

const $ = (selector) => document.querySelector(selector);

// `조건 && h(...)` 꼴로 넣은 자식 중 거짓 값(false, null, '')을 버린다.
// DOM의 append/replaceChildren에 false를 그대로 넘기면 "false"라는 글자가 화면에 찍히므로 반드시 거쳐야 한다.
// 배열 안의 배열도 끝까지 펼친다. 한 단계만 펼치면 안쪽 배열이 "false,false" 같은 글자로 찍힌다.
const compact = (children) => children.flat(Infinity).filter((c) => c != null && c !== false && c !== '');

// 작은 DOM 생성 도우미. 문자열은 모두 텍스트로 들어가므로 CSV에서 온 값이 HTML로 해석되지 않는다.
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...compact(children));
  return el;
}

// el의 자식을 통째로 바꾼다. h()와 같은 규칙으로 거짓 값을 버린다.
const fill = (el, ...children) => el.replaceChildren(...compact(children));

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

// ── 지도 (카카오맵) ─────────────────────────────────────

// 카카오맵 SDK는 키를 받아 비동기로 불러오므로, 지도가 준비되기 전에도 목록·상세 정보는 먼저 그린다.
// 준비 전에 들어온 핀 그리기·영역 맞추기는 미뤄 두었다가 준비되면 한 번에 반영한다.
let kmap = null;
let pendingFit = null;
const markers = new Map(); // 장소 id → { overlay, el }

// 장소 색은 손으로 고르지 않고 미션 진행 상태(미진행·진행 중·완료)로 정한다. 저장된 p.color는 쓰지 않는다.
const placeColor = (p) => progressColor(missionProgress(p.mission, p.missions));

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 지도 칸 안에 안내 문구를 띄운다(키 없음·불러오기 실패). 목록·상세 정보는 그대로 쓸 수 있다.
function showMapMessage(...lines) {
  fill($('#map'), h('div', { class: 'map-message', role: 'status' }, lines.map((t) => h('p', {}, t))));
}

const KAKAO_SDK_TIMEOUT_MS = 15000;
// SDK 주소(sdk.js)는 키가 틀려도 정상으로 내려오는 경우가 있어, 지도 모듈(kakao.maps.load)이 끝내 안 오면 실패로 본다.
function loadKakaoSdk(key) {
  return new Promise((resolve, reject) => {
    const ready = () => window.kakao.maps.load(() => resolve(window.kakao.maps));
    const timer = setTimeout(() => reject(new Error('timeout')), KAKAO_SDK_TIMEOUT_MS);
    const done = (fn) => (...a) => {
      clearTimeout(timer);
      fn(...a);
    };
    resolve = done(resolve);
    reject = done(reject);
    // 자동 점검은 가짜 SDK를 먼저 심어 두므로, 이미 있으면 진짜를 불러오지 않는다.
    if (window.kakao?.maps) return ready();
    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false&libraries=services`;
    script.onload = () => (window.kakao?.maps ? ready() : reject(new Error('no kakao.maps')));
    script.onerror = () => reject(new Error('load error'));
    document.head.append(script);
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

const readStorage = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    // 저장이 막힌 브라우저(사생활 보호 모드 등)에서는 기본값으로 시작한다.
    return null;
  }
};
const writeStorage = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 위와 같음
  }
};

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

async function initMap() {
  // 키는 config.js(window.APP_CONFIG.kakaoJsKey)에 들어 있다. 카카오 콘솔에 등록한 도메인에서만 동작하는 공개 키다.
  const key = config.kakaoJsKey;
  if (!key) {
    showMapMessage('카카오맵 키가 없습니다. config.js의 kakaoJsKey(.env의 KAKAO_JS_KEY 또는 배포 설정의 Secrets)를 확인해 주세요.');
    return;
  }
  let maps;
  try {
    maps = await loadKakaoSdk(key);
  } catch {
    // 키가 틀렸거나, 이 주소가 앱에 등록되지 않았거나, 인터넷이 끊긴 경우다.
    showMapMessage(
      '카카오맵을 불러오지 못했습니다.',
      `developers.kakao.com에서 이 주소(${location.origin})가 Web 플랫폼에 등록되어 있고 "카카오맵" 사용 설정이 켜져 있는지 확인해 주세요.`,
    );
    return;
  }
  const el = $('#map');
  el.replaceChildren();
  kmap = new maps.Map(el, { center: new maps.LatLng(36.4, 127.9), level: 10 });
  // 화면 폭이 바뀌어 지도 칸 크기가 달라지면 카카오 지도에 알려 줘야 빈 곳 없이 다시 그린다.
  new ResizeObserver(() => kmap.relayout()).observe(el);
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

// 핀 하나. 누르거나(클릭) 초점을 둔 채 Enter·Space를 누르면 그 장소를 고른다.
function createPin(p) {
  const el = h('div', { class: 'pin', tabindex: '0', role: 'button' });
  // 지도 끌기·클릭이 핀 아래로 새지 않게 한다.
  for (const type of ['mousedown', 'touchstart', 'dblclick']) el.addEventListener(type, (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    requestSelect(p.id);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    requestSelect(p.id, { pan: true });
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

function renderMarkers(visible) {
  if (!kmap) return;
  const visibleIds = new Set(visible.map((p) => p.id));
  for (const [id, marker] of markers) {
    if (!visibleIds.has(id)) {
      marker.overlay.setMap(null);
      markers.delete(id);
    }
  }
  for (const p of visible) {
    const selected = p.id === state.selectedId;
    let marker = markers.get(p.id);
    if (!marker) {
      marker = createPin(p);
      markers.set(p.id, marker);
    }
    // 핀 요소는 그대로 두고 내용만 바꾼다. 그래야 키보드로 고른 뒤에도 초점이 핀에 남는다.
    const { el, overlay } = marker;
    const { total, done } = missionProgress(p.mission, p.missions);
    el.className = selected ? 'pin selected' : 'pin';
    el.dataset.id = p.id;
    el.title = p.name;
    el.setAttribute('aria-label', p.name);
    el.innerHTML = pinHtml(placeColor(p), selected, p.memo.trim(), total > 0 ? `${done}/${total}` : '');
    overlay.setPosition(new kakao.maps.LatLng(p.lat, p.lng));
    // 고른 핀을 맨 위에.
    overlay.setZIndex(selected ? 10 : 1);
  }
}

// 모든 장소가 보이게 맞춘다. 장소가 하나뿐이면 너무 가까워지지 않게 3단계에서 멈춘다.
function fitToPlaces(places) {
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
function panToPlace(p) {
  if (!kmap) return;
  const latlng = new kakao.maps.LatLng(p.lat, p.lng);
  if (kmap.getLevel() > 4) kmap.setLevel(4, { anchor: latlng });
  kmap.panTo(latlng);
}

// ── 화면 그리기 ───────────────────────────────────────────

function visiblePlaces() {
  const q = state.query.trim().toLowerCase();
  // 고르고 있는 장소는 거르기·검색과 상관없이 보여 준다. 미션을 저장해 진행 상태가 바뀌어도 열어 둔 상세 정보 밑에서 사라지지 않게 한다.
  return state.places.filter(
    (p) =>
      p.id === state.selectedId ||
      ((!state.filterColor || placeColor(p) === state.filterColor) &&
        (!q || [p.name, p.address, p.phone, p.memo].some((v) => v.toLowerCase().includes(q)))),
  );
}

function renderFilters() {
  const counts = new Map();
  for (const p of state.places) {
    const color = placeColor(p);
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  // 미진행 → 진행 중 → 완료 순서로, 장소가 있는 상태만 보여 준다.
  const colors = PALETTE.map((c) => c.hex).filter((hex) => counts.has(hex));

  const chip = (color, label, count) =>
    h(
      'button',
      {
        type: 'button',
        class: 'chip',
        'data-color': color,
        'data-all': color === null ? 'true' : null,
        'aria-pressed': String(state.filterColor === color),
        onclick: () => {
          state.filterColor = state.filterColor === color || color === null ? null : color;
          // 분류를 바꾸면 펼쳐 둔 그룹도 모두 접힌다. 결과는 머리글의 개수·점으로 보고, 필요한 그룹만 다시 펼친다.
          collapseAllGroups();
          render();
          refocus(color === null ? '#color-filters [data-all]' : `#color-filters [data-color="${CSS.escape(color)}"]`);
        },
      },
      color && h('span', { class: 'dot', style: `--c:${color}` }),
      label,
      h('span', { class: 'count' }, String(count)),
    );

  fill(
    $('#color-filters'),
    state.places.length > 0 && [chip(null, '전체', state.places.length), ...colors.map((c) => chip(c, colorLabel(c), counts.get(c)))],
  );
}

// 진행 상태 색 점. 미션이 없는 장소는 배지가 없어서 상태(미진행)를 화면 읽기 프로그램에도 알려 준다.
function placeDot(p) {
  const label = colorLabel(placeColor(p));
  const { total } = missionProgress(p.mission, p.missions);
  return h('span', { class: 'dot', style: `--c:${placeColor(p)}`, title: label }, total === 0 && h('span', { class: 'sr-only' }, label));
}

const listItemSelector = (id) => `#place-list button[data-id="${id}"]`;

// 목록과 상세 정보 제목 옆에 붙는 미션 배지: "미션 완료/전체 ┃ 남은 미션 개수 N". 미션이 없는 장소는 배지를 달지 않는다.
function missionBadge(p) {
  const { total, done } = missionProgress(p.mission, p.missions);
  if (total === 0) return null;
  const remaining = total - done;
  return h(
    'span',
    { class: remaining === 0 ? 'badge done' : 'badge' },
    `미션 ${done}/${total}`,
    h('span', { class: 'rest' }, `남은 미션 개수 ${remaining}`),
  );
}

const UNKNOWN_DISTRICT = '시군 없음';
const districtOf = (p) => String(p.district ?? '').trim() || UNKNOWN_DISTRICT;
const groupHeadSelector = (district) => `#place-list .group-head[data-district="${CSS.escape(district)}"]`;

// 저절로 펼치는 규칙: 고른 장소가 든 시군, 그리고 검색 중에는 맞는 장소가 있는 모든 시군. 이 규칙은 저장하지 않는다.
// 상태 분류(미진행·진행 중·완료)는 접힌 채로 걸러만 낸다. 머리글의 개수·점으로 결과를 볼 수 있고, 펼치는 건 사용자가 고른다.
const autoOpen = (district, places) => state.query.trim() !== '' || places.some((p) => p.id === state.selectedId);
const groupOpen = (district, places) =>
  (autoOpen(district, places) || state.openGroups.has(district)) && !state.closedGroups.has(district);

function toggleGroup(district, places) {
  if (groupOpen(district, places)) {
    state.openGroups.delete(district);
    // 저절로 펼쳐진 묶음은 기억한 목록에서 빼도 그대로 열려 있으므로, 이번만 접어 둔다.
    if (autoOpen(district, places)) state.closedGroups.add(district);
  } else {
    state.closedGroups.delete(district);
    state.openGroups.add(district);
  }
  render();
  refocus(groupHeadSelector(district));
}

function placeRow(p) {
  return h(
    'li',
    {},
    h(
      'button',
      {
        type: 'button',
        'data-id': p.id,
        'aria-current': String(p.id === state.selectedId),
        onclick: () => {
          if (requestSelect(p.id, { pan: true })) refocus(listItemSelector(p.id));
        },
      },
      placeDot(p),
      h('span', { class: 'text' }, h('span', { class: 'name' }, p.name, missionBadge(p)), h('span', { class: 'addr' }, p.address)),
      memoIcon(p),
    ),
  );
}

// 목록 오른쪽 끝의 메모 말풍선. 메모가 있으면 진하게 켜지고 툴팁으로 내용을 보여 준다. 없으면 흐리게 자리만 지킨다.
function memoIcon(p) {
  const memo = p.memo.trim();
  const icon = h('span', {
    class: memo ? 'memo-icon on' : 'memo-icon',
    title: memo ? `메모: ${memo}` : '메모 없음',
    'aria-hidden': memo ? null : 'true',
    role: memo ? 'img' : null,
    'aria-label': memo ? `메모 있음: ${memo}` : null,
  });
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-7l-5 4v-4H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"/></svg>';
  return icon;
}

// 시군 머리: "태안 2미션 ●2 ●1 ▸". 홈포인트 하나를 미션 하나로 센다. 상태 점은 장소가 있는 상태만, 미진행 → 진행 중 → 완료 순서로.
function groupHead(district, places, open, listId) {
  const counts = new Map();
  for (const p of places) counts.set(placeColor(p), (counts.get(placeColor(p)) ?? 0) + 1);
  return h(
    'button',
    {
      type: 'button',
      class: 'group-head',
      'data-district': district,
      'aria-expanded': String(open),
      'aria-controls': listId,
      title: '펼치기/접기',
      onclick: () => toggleGroup(district, places),
    },
    h('span', { class: 'group-name' }, district),
    h('span', { class: 'group-count' }, `${places.length}미션`),
    h(
      'span',
      { class: 'group-states' },
      PALETTE.filter(({ hex }) => counts.has(hex)).map(({ hex, label }) =>
        h(
          'span',
          { class: 'group-state', title: `${label} ${counts.get(hex)}미션` },
          h('span', { class: 'dot', style: `--c:${hex}`, 'aria-hidden': 'true' }),
          h('span', { class: 'sr-only' }, `${label} `),
          String(counts.get(hex)),
        ),
      ),
    ),
    h('span', { class: 'chevron', 'aria-hidden': 'true' }, '▸'),
  );
}

let lastListKey = null;
function renderList(visible) {
  const total = state.places.length;
  $('#empty').hidden = total > 0;
  $('#list-summary').textContent =
    total === 0 ? ''
    : visible.length === total ? `장소 ${total}개`
    : visible.length === 0 ? '조건에 맞는 장소가 없습니다.'
    : `${visible.length}개 / 전체 ${total}개`;

  // 검색어·거르기·선택이 바뀌면 "이번만 접어 둔" 묶음을 잊고 저절로 펼치는 규칙을 다시 따른다.
  const listKey = `${state.query.trim()}|${state.filterColor}|${state.selectedId}`;
  if (listKey !== lastListKey) state.closedGroups.clear();
  lastListKey = listKey;

  // 시군은 CSV(저장된) 순서대로, 시군을 모르는 장소는 맨 뒤에 묶는다.
  const order = [...new Set(state.places.map(districtOf))].sort(
    (a, b) => (a === UNKNOWN_DISTRICT) - (b === UNKNOWN_DISTRICT),
  );
  const groups = new Map(order.map((d) => [d, []]));
  for (const p of visible) groups.get(districtOf(p))?.push(p);

  fill(
    $('#place-list'),
    [...groups]
      .filter(([, places]) => places.length > 0)
      .map(([district, places], i) => {
        const open = groupOpen(district, places);
        const listId = `group-${i}`;
        return h(
          'li',
          { class: 'group' },
          groupHead(district, places, open, listId),
          h('ul', { class: 'group-items', id: listId, hidden: !open }, places.map(placeRow)),
        );
      }),
  );
}

function renderDetail() {
  const box = $('#detail');
  const p = state.places.find((x) => x.id === state.selectedId);
  box.hidden = !p;
  if (!p) {
    box.replaceChildren();
    return;
  }

  const memo = h('textarea', { rows: 2, placeholder: '메모를 남겨 두세요', onchange: (e) => saveMemo(p.id, e.target.value) }, p.memo);
  const missions = missionNames(p.mission);
  const progress = missionProgress(p.mission, p.missions);

  fill(
    box,
    h(
      'div',
      { class: 'detail-head' },
      placeDot(p),
      h('h2', {}, p.name, missionBadge(p)),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onclick: closeDetail }, '×'),
    ),
    // 주소에는 시군이 들어 있지 않다(목록은 시군별로 묶여 보이므로). 상세 카드만 시군을 작은 표시로 앞에 붙인다.
    (p.address || p.phone || p.district) &&
      h(
        'div',
        { class: 'meta' },
        (p.address || p.district) &&
          h('span', { class: 'addr-line' }, p.district && h('span', { class: 'district' }, p.district), p.address && h('span', {}, p.address)),
        p.phone && h('a', { href: `tel:${p.phone}` }, p.phone),
      ),
    h(
      'div',
      { class: 'route-actions' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => openKakaoMapRoute(p) }, '카카오맵 길찾기'),
      h('a', { class: 'btn', href: kakaoMapViewUrl(p), target: '_blank', rel: 'noopener' }, '카카오맵에서 보기'),
    ),
    h('label', { class: 'memo' }, '메모', memo),
    missions.length > 0 &&
      h(
        'section',
        { class: 'missions' },
        h('h3', {}, `미션 ${progress.done}/${progress.total}`),
        // 이름이 거의 같아서 맨 뒤 번호를 굵게 보여 준다. 고른 미션 바로 아래 줄에 기록 입력 칸을 펼친다.
        h(
          'ol',
          { class: 'mission-list' },
          missions.flatMap((m) => {
            const [, head, num] = m.match(/^(.*?)(\d+)$/) ?? [m, m, ''];
            const record = missionRecord(p, m);
            const open = m === state.selectedMission;
            return [
              h(
                'li',
                {},
                h(
                  'button',
                  {
                    type: 'button',
                    // 아래 입력 칸 안의 버튼과 구분되도록 미션 버튼에만 붙인다.
                    class: record.done ? 'mission-item done' : 'mission-item',
                    'data-mission': m,
                    'aria-current': open ? 'true' : null,
                    'aria-expanded': String(open),
                    onclick: () => toggleMission(m),
                  },
                  h('span', { class: 'mission-name' }, head, num && h('b', {}, num)),
                  record.done && [h('span', { class: 'mission-check', 'aria-hidden': 'true' }, '✓'), h('span', { class: 'sr-only' }, '완료')],
                ),
              ),
              open && h('li', { class: 'mission-editor' }, missionEditing(p, m) ? missionForm(p, missionDraftFor(p, m)) : missionView(p, record)),
            ];
          }),
        ),
      ),
    h('button', { type: 'button', class: 'link danger', onclick: () => removePlace(p) }, '이 장소 삭제'),
  );
}

// 기록이 없는 미션은 빈 기록으로 본다. 서버는 한 번이라도 저장한 미션만 돌려준다.
const missionRecord = (p, name) =>
  p.missions?.find((m) => m.mission === name) ?? { mission: name, done: false, worker: '', flightTime: '', batteryNo: '', batteryLeft: '' };

const MISSION_FIELDS = [
  { key: 'worker', label: '이름', placeholder: '작업자', inputmode: 'text' },
  { key: 'flightTime', label: '비행시간', placeholder: '예: 12분 30초', inputmode: 'text' },
  { key: 'batteryNo', label: '사용한 배터리 번호', placeholder: '예: 3', inputmode: 'text' },
  // 숫자(0~100)만 받고 %는 칸 옆에 붙여 보여 준다. 값에는 %를 넣지 않는다.
  { key: 'batteryLeft', label: '마지막 배터리 남은 용량', placeholder: '예: 45', inputmode: 'numeric', unit: '%' },
];

const MISSION_REQUIRED_MESSAGE = '완료로 저장하려면 이름, 비행시간, 사용한 배터리 번호, 마지막 배터리 남은 용량을 모두 적어야 합니다.';
const BATTERY_LEFT_MESSAGE = '마지막 배터리 남은 용량은 0~100 사이 숫자만 적어 주세요.';

// 보기 화면 등에서 남은 용량을 보여 줄 때 쓴다. 비어 있으면 ''.
const batteryLeftText = (v) => (String(v ?? '').trim() ? `${String(v).trim()}%` : '');

const isMissionSaved = (p, name) => Boolean(p.missions?.some((m) => m.mission === name));
const draftMatches = (p, name) => state.missionDraft?.placeId === p.id && state.missionDraft.mission === name;

// 아직 저장한 적 없는 미션은 바로 입력 화면, 저장한 미션은 [수정]을 누르기 전까지 보기 화면이다.
const missionEditing = (p, name) => draftMatches(p, name) || !isMissionSaved(p, name);

function newMissionDraft(p, name) {
  const r = missionRecord(p, name);
  return {
    placeId: p.id,
    mission: name,
    done: Boolean(r.done),
    worker: r.worker ?? '',
    flightTime: r.flightTime ?? '',
    batteryNo: r.batteryNo ?? '',
    batteryLeft: r.batteryLeft ?? '',
    // 저장하려다 막힌 칸: { 칸 이름: 'required' | 'range' }. 다시 그려도 빨간 테두리가 남도록 초안에 둔다.
    invalid: {},
    // 이 값을 바탕으로 고쳤다는 기록 판(version). 기록이 없으면 null. 그사이 다른 기기가 저장했으면 save_mission이 conflict로 막는다.
    baseVersion: r.version ?? null,
    // conflict를 받았을 때 서버의 최신 기록(없으면 null). undefined면 충돌 없음.
    conflict: undefined,
  };
}

// 입력 화면에 보일 값. 고치는 중인 값이 없으면 저장된 기록으로 만든다(아직 state에 넣지는 않는다).
const missionDraftFor = (p, name) => (draftMatches(p, name) ? state.missionDraft : newMissionDraft(p, name));

// 초안이 저장된 기록(새 미션이면 빈 기록)과 다르면 true. 버리기 전에 물어볼지 정한다.
function draftDirty() {
  const d = state.missionDraft;
  const p = d && state.places.find((x) => x.id === d.placeId);
  if (!p) return false;
  const r = missionRecord(p, d.mission);
  return Boolean(d.done) !== Boolean(r.done) || MISSION_FIELDS.some(({ key }) => String(d[key] ?? '').trim() !== String(r[key] ?? '').trim());
}

const confirmDiscardDraft = () => !draftDirty() || confirm('저장하지 않은 미션 기록이 있습니다. 버릴까요?');

// 기록을 한 줄로: "완료 · 홍길동 · 12분 · 3 · 45%". 빈 칸은 —.
function missionSummaryLine(r) {
  const show = (v) => (String(v ?? '').trim() ? String(v).trim() : '—');
  return [r.done ? '완료' : '미완료', show(r.worker), show(r.flightTime), show(r.batteryNo), show(batteryLeftText(r.batteryLeft))].join(' · ');
}

// 입력할 때마다 state에만 적는다. 서버에는 [저장]을 눌러야 보낸다.
function updateMissionDraft(p, name, key, value) {
  if (!draftMatches(p, name)) state.missionDraft = newMissionDraft(p, name);
  state.missionDraft[key] = value;
}

// 초안에 적힌 막힌 칸을 화면의 aria-invalid에 맞춘다. 글자마다 다시 그리지 않으려고 속성만 바꾼다.
function syncMissionInvalid(name) {
  const form = $(missionFormSelector(name));
  const invalid = state.missionDraft?.mission === name ? state.missionDraft.invalid : {};
  for (const { key } of MISSION_FIELDS) {
    const input = form?.querySelector(`input[name="${key}"]`);
    if (!input) continue;
    if (invalid[key]) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

// 고치기 시작한 칸은 바로 빨간 표시를 지운다.
function onMissionFieldInput(p, name, key, e) {
  const input = e.target;
  if (key === 'batteryLeft') {
    // 숫자만 남긴다("45%" → "45"). 지운 글자만큼 커서를 앞으로 당긴다.
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret).replace(/\D/g, '');
    const digits = input.value.replace(/\D/g, '');
    if (digits !== input.value) {
      input.value = digits;
      input.setSelectionRange(before.length, before.length);
    }
  }
  updateMissionDraft(p, name, key, input.value);
  delete state.missionDraft.invalid[key];
  syncMissionInvalid(name);
}

// 저장 전에 확인한다. 완료면 네 칸 모두 필요하고, 남은 용량은 적었다면 0~100 정수여야 한다.
function validateMissionDraft(draft) {
  const invalid = {};
  if (draft.done) {
    for (const { key } of MISSION_FIELDS) if (!String(draft[key] ?? '').trim()) invalid[key] = 'required';
  }
  const left = String(draft.batteryLeft ?? '').trim();
  if (left && !(/^\d+$/.test(left) && Number(left) <= 100)) invalid.batteryLeft = 'range';
  const reasons = Object.values(invalid);
  const message = reasons.includes('required') ? MISSION_REQUIRED_MESSAGE : reasons.includes('range') ? BATTERY_LEFT_MESSAGE : null;
  return { invalid, message };
}

// 저장 중인 (장소, 미션). [저장]을 두 번 눌러도 요청이 한 번만 가게 한다.
const missionSaving = new Set();
const missionKey = (id, name) => `${id}|${name}`;

function missionForm(p, draft) {
  const name = draft.mission;
  const saving = missionSaving.has(missionKey(p.id, name));
  return h(
    'form',
    {
      class: 'mission-form',
      'data-mission': name,
      // 입력 칸에서 Enter를 눌러도 저장한다.
      onsubmit: (e) => {
        e.preventDefault();
        saveMissionDraft(p.id, name);
      },
    },
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        name: 'done',
        checked: draft.done,
        disabled: saving,
        onchange: (e) => {
          updateMissionDraft(p, name, 'done', e.target.checked);
          // 완료를 풀면 "모두 적어야 함" 표시는 더 이상 맞지 않으므로 지운다(숫자 범위 표시는 남긴다).
          if (!e.target.checked) {
            const invalid = state.missionDraft.invalid;
            for (const k of Object.keys(invalid)) if (invalid[k] === 'required') delete invalid[k];
            syncMissionInvalid(name);
          }
        },
      }),
      '완료',
    ),
    MISSION_FIELDS.map(({ key, label, placeholder, inputmode, unit }) =>
      h(
        'label',
        { class: unit ? 'field unit' : 'field' },
        h('span', {}, label),
        h('input', {
          type: 'text',
          name: key,
          value: draft[key] ?? '',
          placeholder,
          inputmode,
          pattern: inputmode === 'numeric' ? '[0-9]*' : null,
          autocomplete: 'off',
          disabled: saving,
          'aria-invalid': draft.invalid?.[key] ? 'true' : null,
          oninput: (e) => onMissionFieldInput(p, name, key, e),
        }),
        unit && h('span', { class: 'unit-label', 'aria-hidden': 'true' }, unit),
      ),
    ),
    // 다른 기기가 먼저 저장해 막혔을 때, 다시 저장하기 전에 견줘 볼 수 있게 서버의 최신 값을 보여 준다.
    draft.conflict !== undefined &&
      h('p', { class: 'mission-conflict' }, `최신 저장값: ${draft.conflict ? missionSummaryLine(draft.conflict) : '없음'}`),
    h(
      'div',
      { class: 'button-row' },
      h('button', { type: 'submit', class: 'btn primary', disabled: saving }, saving ? '저장 중…' : '저장'),
      h('button', { type: 'button', class: 'btn cancel', disabled: saving, onclick: () => cancelMissionDraft(p, name) }, '취소'),
    ),
  );
}

function missionView(p, record) {
  const show = (v) => (String(v ?? '').trim() ? String(v) : '—');
  return h(
    'div',
    { class: 'mission-view', 'data-mission': record.mission },
    h(
      'dl',
      { class: 'mission-summary' },
      h('dt', {}, '완료'),
      h('dd', { class: record.done ? 'done' : null }, record.done ? '✓ 완료' : '미완료'),
      MISSION_FIELDS.map(({ key, label }) => [
        h('dt', {}, label),
        h('dd', {}, show(key === 'batteryLeft' ? batteryLeftText(record[key]) : record[key])),
      ]).flat(),
    ),
    h(
      'div',
      { class: 'button-row' },
      h('button', { type: 'button', class: 'btn edit', onclick: () => editMission(p, record.mission) }, '수정'),
    ),
  );
}

// "저장 10 · 중복 0(그중 0 갱신) · 오류 0". 서버의 중복 수에는 갱신한 장소도 들어 있어서 괄호로 묶는다.
// 좁은 화면에서 "오류 / 0"처럼 숫자만 다음 줄로 떨어지지 않게 항목마다 묶는다.
const nowrap = (text) => h('span', { class: 'nowrap' }, text);
const importCounts = ({ imported, duplicates, updated, errors }) => [
  nowrap(`저장 ${imported}`),
  ' · ',
  nowrap(`중복 ${duplicates}(그중 ${updated} 갱신)`),
  ' · ',
  nowrap(`오류 ${errors}`),
];

const rowErrors = (errors) =>
  h(
    'ul',
    { class: 'errors' },
    errors.slice(0, 50).map((e) => h('li', {}, `${e.line}행: ${e.reason}`)),
    errors.length > 50 && h('li', {}, `외 ${errors.length - 50}건`),
  );

// 갱신·미션명 바뀜 안내. 여러 파일이면 합친 수로 한 번만 보여 준다.
const importHints = (updated, missionChanged) => [
  updated > 0 && h('p', { class: 'hint' }, '갱신: CSV의 주소·미션명이 달라 그 값만 바꾼 장소'),
  missionChanged > 0 && h('p', { class: 'hint' }, `미션명이 바뀐 장소 ${missionChanged}개 — 이전 미션의 기록은 화면에서 보이지 않습니다.`),
];

// 파일 하나: 예전과 똑같이 보여 준다.
function singleImportResult(result) {
  return [
    h(
      'p',
      { class: 'result-line' },
      `저장 ${result.imported}개 · 중복 ${result.duplicates}개${result.updated > 0 ? `(그중 ${result.updated}개 갱신)` : ''} · 오류 ${result.errors.length}개`,
    ),
    importHints(result.updated, result.missionChanged),
    result.errors.length > 0 && rowErrors(result.errors),
  ];
}

// 여러 파일: 파일마다 한 줄, 행 오류는 접어 두고, 맨 아래에 합계.
function multiImportResult(results, skipped) {
  const ok = results.filter((r) => r.result).map((r) => r.result);
  const sum = (k) => ok.reduce((n, r) => n + (k === 'errors' ? r.errors.length : r[k] ?? 0), 0);
  const failed = results.filter((r) => r.error).length;
  return [
    h(
      'ul',
      { class: 'import-files' },
      results.map(({ file, result, error }) =>
        h(
          'li',
          { class: error ? 'import-file failed' : 'import-file' },
          h('span', { class: 'import-file-name' }, file.name),
          ' — ',
          h(
            'span',
            { class: 'import-file-summary' },
            error ? `실패: ${error}` : importCounts({ ...result, errors: result.errors.length }),
          ),
          result?.errors.length > 0 &&
            h('details', { class: 'import-file-errors' }, h('summary', {}, `오류 ${result.errors.length}건 보기`), rowErrors(result.errors)),
        ),
      ),
      skippedFiles(skipped),
    ),
    h(
      'p',
      { class: 'import-total' },
      '합계: ',
      importCounts({ imported: sum('imported'), duplicates: sum('duplicates'), updated: sum('updated'), errors: sum('errors') }),
      failed > 0 && [' · ', nowrap(`파일 오류 ${failed}개`)],
    ),
    importHints(sum('updated'), sum('missionChanged')),
  ];
}

const skippedFiles = (skipped) =>
  skipped.map(({ name, reason }) =>
    h(
      'li',
      { class: 'import-file skipped' },
      h('span', { class: 'import-file-name' }, name),
      ' — ',
      h('span', { class: 'import-file-summary' }, `건너뜀: ${reason}`),
    ),
  );

function renderImport() {
  const box = $('#import-panel');
  const files = state.importFiles;
  box.hidden = !files;
  if (!files) {
    box.replaceChildren();
    return;
  }

  const close = () => {
    state.importFiles = null;
    state.importSkipped = [];
    state.importResults = null;
    renderImport();
  };
  const results = state.importResults;
  const skipped = state.importSkipped;
  // 파일 하나(건너뛴 파일도 없음)는 예전 모습 그대로 둔다.
  const single = files.length === 1 && skipped.length === 0;
  const busyLabel = single ? '가져오는 중…' : `가져오는 중… (${state.importProgress}/${files.length})`;

  fill(
    box,
    h(
      'div',
      { class: 'import-head' },
      h('h2', {}, 'CSV 가져오기'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', disabled: state.importing, onclick: close }, '×'),
    ),
    single
      ? h('p', { class: 'file-name' }, files[0].name)
      : !results && [
          h('p', { class: 'file-count' }, `파일 ${files.length}개`),
          h(
            'ol',
            { class: 'import-files' },
            files.map((f) => h('li', { class: 'import-file' }, h('span', { class: 'import-file-name' }, f.name))),
            skippedFiles(skipped),
          ),
        ],
    ...(results
      ? [
          single ? singleImportResult(results[0].result) : multiImportResult(results, skipped),
          h('div', { class: 'button-row' }, h('button', { type: 'button', class: 'btn', onclick: close }, '닫기')),
        ]
      : [
          h(
            'div',
            { class: 'button-row' },
            h('button', { type: 'button', class: 'btn primary', disabled: state.importing, onclick: runImport }, state.importing ? busyLabel : '가져오기'),
            h('button', { type: 'button', class: 'btn', disabled: state.importing, onclick: close }, '취소'),
          ),
        ]),
  );
}

function render() {
  // 미션 저장으로 그 상태의 장소가 하나도 안 남으면 칩도 사라지므로, 아무 칩도 눌리지 않은 채 걸러지지 않게 전체로 되돌린다.
  if (state.filterColor && !state.places.some((p) => placeColor(p) === state.filterColor)) state.filterColor = null;
  const visible = visiblePlaces();
  renderFilters();
  renderList(visible);
  renderMarkers(visible);
  renderDetail();
}

// ── 동작 ────────────────────────────────────────────────

function select(id, { pan = false } = {}) {
  // 장소를 고르면 상세 정보가 그 자리에 열리므로 로그인 기록 창은 닫는다.
  if (id !== null) closeLoginLog();
  if (id !== state.selectedId) {
    state.selectedMission = null;
    state.missionDraft = null;
  }
  state.selectedId = id;
  render();
  const p = state.places.find((x) => x.id === id);
  if (!p) return;
  if (pan) panToPlace(p);
  $('.panel').scrollTo({ top: 0, behavior: 'smooth' });
}

// 사람이 다른 장소를 고를 때 쓴다. 저장 안 한 미션 기록이 버려지면 먼저 묻고, 그만두면 false.
function requestSelect(id, opts) {
  if (id !== state.selectedId && !confirmDiscardDraft()) return false;
  select(id, opts);
  return true;
}

// 상세 정보를 닫고(×·Esc) 그 장소의 목록 항목으로, 목록에 없으면 검색 칸으로 초점을 옮긴다.
function closeDetail() {
  const id = state.selectedId;
  if (id === null || !confirmDiscardDraft()) return;
  const district = districtOf(state.places.find((p) => p.id === id) ?? {});
  select(null);
  // 닫으면 그 시군이 다시 접힐 수 있어서, 줄이 안 보이면 시군 머리로 초점을 옮긴다.
  const row = $(listItemSelector(id));
  if (row && row.offsetParent !== null) refocus(listItemSelector(id));
  else if ($(groupHeadSelector(district))) refocus(groupHeadSelector(district));
  else refocus('#search');
}

// 다른 기기에서 지워진 장소: 목록에서 빼고 상세 정보를 닫는다. DB 함수는 "장소를 찾을 수 없습니다." 예외를 던진다.
const isPlaceGone = (err) => /장소를 찾을 수 없습니다/.test(err.message);
function dropGonePlace(id) {
  state.places = state.places.filter((p) => p.id !== id);
  if (state.selectedId === id) select(null);
  else render();
  toast('이 장소는 다른 기기에서 삭제되었습니다.');
}

function replacePlace(updated) {
  state.places = state.places.map((p) => (p.id === updated.id ? updated : p));
}

// 메모 저장 응답을 반영한다. 응답의 미션 기록은 그사이 화면에서 먼저 바꾼 기록보다 오래됐을 수 있어서 화면 쪽을 남긴다.
function mergePlace(updated) {
  const current = state.places.find((p) => p.id === updated.id);
  replacePlace({ ...updated, missions: current?.missions ?? updated.missions });
}

// 다시 그리면 누른 버튼·체크 상자가 새로 만들어지므로, 키보드로 쓰던 사람을 위해 같은 자리로 초점을 돌려놓는다.
function refocus(selector) {
  $(selector)?.focus({ preventScroll: true });
}

// render()는 상세 정보를 새로 만들므로, 사용자가 이미 옮겨 가서 쓰는 중인(아직 change 전인) 칸의 글자와 초점이 사라진다.
// 휴대폰에서는 키보드까지 닫힌다. 그 칸을 기억해 두었다가 다시 그린 뒤 같은 칸에 글자·커서·초점을 돌려놓는다.
function renderKeepingInput() {
  const el = document.activeElement;
  const form = el?.closest?.('#detail .mission-form');
  let selector = null;
  if (el?.matches?.('#detail .memo textarea')) selector = '#detail .memo textarea';
  else if (form && el.tagName === 'INPUT' && el.name) {
    selector = `#detail .mission-form[data-mission="${CSS.escape(form.dataset.mission)}"] input[name="${CSS.escape(el.name)}"]`;
  }
  const isText = selector && el.type !== 'checkbox';
  const saved = isText && { value: el.value, start: el.selectionStart, end: el.selectionEnd };

  render();
  if (!selector) return;
  const next = $(selector);
  if (!next) return;
  // 체크 상자는 상태에 이미 반영돼 있으므로 값을 덮어쓰지 않는다.
  if (saved) {
    next.value = saved.value;
    if (saved.start != null) next.setSelectionRange(saved.start, saved.end);
  }
  next.focus({ preventScroll: true });
}

// 다른 미션을 열거나 닫으면 고치던 값은 버린다. 아직 저장 안 한 미션은 바로 입력 화면으로 연다.
function toggleMission(name) {
  if (!confirmDiscardDraft()) return;
  state.selectedMission = state.selectedMission === name ? null : name;
  state.missionDraft = null;
  const p = state.places.find((x) => x.id === state.selectedId);
  if (p && state.selectedMission && !isMissionSaved(p, name)) state.missionDraft = newMissionDraft(p, name);
  renderDetail();
  refocus(`#detail .mission-item[data-mission="${CSS.escape(name)}"]`);
}

const missionViewSelector = (name) => `#detail .mission-view[data-mission="${CSS.escape(name)}"]`;
const missionFormSelector = (name) => `#detail .mission-form[data-mission="${CSS.escape(name)}"]`;

function editMission(p, name) {
  state.missionDraft = newMissionDraft(p, name);
  renderDetail();
  // 휴대폰 키보드가 바로 뜨지 않도록 글자 칸이 아니라 완료 체크 상자로 초점을 옮긴다.
  refocus(`${missionFormSelector(name)} input[name="done"]`);
}

// 저장한 적 있는 미션은 보기 화면으로 돌아가고, 처음 쓰던 미션은 입력 칸을 닫는다.
function cancelMissionDraft(p, name) {
  state.missionDraft = null;
  const saved = isMissionSaved(p, name);
  if (!saved) state.selectedMission = null;
  renderDetail();
  refocus(saved ? `${missionViewSelector(name)} .btn.edit` : `#detail .mission-item[data-mission="${CSS.escape(name)}"]`);
}

function setMissionRecord(id, record) {
  const place = state.places.find((p) => p.id === id);
  if (!place) return;
  const others = (place.missions ?? []).filter((m) => m.mission !== record.mission);
  replacePlace({ ...place, missions: [...others, record] });
}

// 고치던 다섯 칸을 한 번에 저장한다. 성공하면 보기 화면으로, 실패하면 적던 값을 그대로 둔 채 입력 화면에 남는다.
async function saveMissionDraft(id, name) {
  const place = state.places.find((p) => p.id === id);
  const key = missionKey(id, name);
  if (!place || missionSaving.has(key)) return;
  const draft = missionDraftFor(place, name);
  const { invalid, message } = validateMissionDraft(draft);
  if (message) {
    // 막힌 칸 표시가 다시 그려도 남도록 초안을 state에 둔다.
    state.missionDraft = { ...draft, invalid };
    syncMissionInvalid(name);
    const first = MISSION_FIELDS.find(({ key }) => invalid[key]);
    if (first) refocus(`${missionFormSelector(name)} input[name="${first.key}"]`);
    toast(message);
    return;
  }
  const left = draft.batteryLeft.trim();
  const fields = {
    done: Boolean(draft.done),
    worker: draft.worker.trim(),
    flightTime: draft.flightTime.trim(),
    batteryNo: draft.batteryNo.trim(),
    // "045"처럼 앞에 0을 붙여 적어도 45로 보낸다.
    batteryLeft: left ? String(Number(left)) : '',
  };
  // 저장 중에는 입력 칸이 잠기므로, 실패하면 초점을 돌려놓을 칸을 기억해 둔다.
  const focusedField = $(missionFormSelector(name))?.contains(document.activeElement) ? document.activeElement.name : null;

  missionSaving.add(key);
  renderKeepingInput();
  const epoch = authEpoch;
  let result;
  try {
    result = await api.saveMission(id, name, fields, draft.baseVersion ?? null);
  } catch (err) {
    missionSaving.delete(key);
    // 세션이 끝났으면 로그인 화면으로 이미 넘어갔다.
    if (authFailed(err) || epoch !== authEpoch) return;
    if (isPlaceGone(err)) {
      dropGonePlace(id);
      return;
    }
    renderKeepingInput();
    refocus(`${missionFormSelector(name)} ${focusedField ? `input[name="${focusedField}"]` : '.btn.primary'}`);
    toast(err.message);
    return;
  }
  missionSaving.delete(key);
  if (epoch !== authEpoch) return;

  if (result?.status === 'conflict') {
    // 다른 기기가 먼저 저장했다. 적던 값은 그대로 두고, 최신 기록을 바탕으로 다시 저장할 수 있게 판을 맞춘다.
    const latest = result.record ?? null;
    const p = state.places.find((x) => x.id === id);
    if (latest) setMissionRecord(id, latest);
    else if (p) replacePlace({ ...p, missions: (p.missions ?? []).filter((m) => m.mission !== name) });
    if (state.missionDraft?.placeId === id && state.missionDraft.mission === name) {
      state.missionDraft = { ...state.missionDraft, baseVersion: latest?.version ?? null, conflict: latest };
    }
    renderKeepingInput();
    refocus(`${missionFormSelector(name)} ${focusedField ? `input[name="${focusedField}"]` : '.btn.primary'}`);
    toast('다른 기기에서 먼저 바뀐 기록입니다. 아래 값은 최신 내용으로 바뀌었으니 확인 후 다시 저장하세요.');
    return;
  }

  setMissionRecord(id, result.record);
  // 저장하는 사이 다른 미션으로 옮겨 갔으면 그쪽에서 쓰는 값은 건드리지 않는다.
  if (state.missionDraft?.placeId === id && state.missionDraft.mission === name) state.missionDraft = null;
  const hadFocus = $(missionFormSelector(name))?.contains(document.activeElement);
  renderKeepingInput();
  if (hadFocus || document.activeElement === document.body) refocus(`${missionViewSelector(name)} .btn.edit`);
  toast('미션 기록을 저장했습니다.');
}

async function saveMemo(id, memo) {
  const epoch = authEpoch;
  try {
    const updated = await api.updateMemo(id, memo);
    if (epoch !== authEpoch) return;
    if (!updated) {
      dropGonePlace(id);
      return;
    }
    mergePlace(updated);
    renderKeepingInput();
    toast('메모를 저장했습니다.');
  } catch (err) {
    if (authFailed(err) || epoch !== authEpoch) return;
    if (isPlaceGone(err)) dropGonePlace(id);
    else toast(err.message);
  }
}

async function removePlace(place) {
  if (!confirmDiscardDraft()) return;
  if (!confirm(`"${place.name}"을(를) 삭제할까요?`)) return;
  const epoch = authEpoch;
  try {
    const removed = await api.deletePlace(place.id);
    if (epoch !== authEpoch) return;
    if (!removed) {
      dropGonePlace(place.id);
      return;
    }
    state.places = state.places.filter((p) => p.id !== place.id);
    state.selectedId = null;
    state.selectedMission = null;
    state.missionDraft = null;
    render();
    refocus('#search');
    toast('삭제했습니다.');
  } catch (err) {
    if (authFailed(err) || epoch !== authEpoch) return;
    if (isPlaceGone(err)) dropGonePlace(place.id);
    else toast(err.message);
  }
}

const isCsvFile = (f) => /\.(csv|tsv|txt)$/i.test(f.name) || f.type === 'text/csv';

// 고르거나 끌어다 놓은 파일들로 가져오기 창을 연다. CSV가 아닌 파일은 건너뛴 것으로 보여 준다.
function startImport(fileList) {
  if (!signedIn()) return;
  // 가져오는 중에 새 파일이 오면 앞 결과와 섞이지 않게 받지 않는다.
  if (state.importing) {
    toast('가져오는 중입니다. 끝난 뒤 다시 시도해 주세요.');
    return;
  }
  const all = [...fileList];
  const files = all.filter(isCsvFile);
  if (files.length === 0) {
    if (all.length > 0) toast('CSV 파일이 아닙니다.');
    return;
  }
  if (draftDirty()) {
    if (!confirmDiscardDraft()) return;
    state.missionDraft = null;
    render();
  }
  closeLoginLog();
  state.importFiles = files;
  state.importSkipped = all.filter((f) => !isCsvFile(f)).map((f) => ({ name: f.name, reason: 'CSV 파일이 아닙니다' }));
  state.importResults = null;
  renderImport();
  $('.panel').scrollTo({ top: 0, behavior: 'smooth' });
}

// 서버가 받던 크기 제한(10MB)을 그대로 지킨다. 너무 큰 파일은 브라우저에서 읽기 전에 막는다.
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const EMPTY_COUNTS = { imported: 0, duplicates: 0, updated: 0, missionChanged: 0 };

// 파일 하나를 브라우저에서 읽어(readPlaces) 장소만 import_places로 보낸다. 결과는 예전 서버 응답과 같은 모양이다.
// 실패하면 화면에 그대로 보여 줄 한국어 문구를 담은 Error를 던진다.
async function importFile(file) {
  if (file.size === 0) throw new Error('CSV 파일 내용이 없습니다.');
  if (file.size > MAX_IMPORT_BYTES) throw new Error('CSV 파일이 너무 큽니다. (최대 10MB)');
  let bytes;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    // 고른 뒤 파일이 지워지거나 바뀐 경우
    throw new Error('파일을 읽지 못했습니다. 다시 골라 주세요.');
  }
  let parsed;
  try {
    parsed = readPlaces(bytes);
  } catch (err) {
    throw err instanceof CsvFormatError ? err : new Error('CSV 파일을 읽지 못했습니다.');
  }
  // 저장할 행이 하나도 없으면(모두 오류) 보낼 것이 없다.
  const counts = parsed.places.length > 0 ? { ...EMPTY_COUNTS, ...(await api.importPlaces(parsed.places)) } : EMPTY_COUNTS;
  return {
    columns: parsed.columns,
    total: parsed.total,
    imported: counts.imported,
    duplicates: counts.duplicates,
    updated: counts.updated,
    missionChanged: counts.missionChanged,
    errors: parsed.errors,
  };
}

// 파일을 하나씩 차례로 가져온다. 한 파일이 실패해도 나머지는 계속하고, 끝나면 장소를 한 번만 새로 받는다.
async function runImport() {
  const files = state.importFiles;
  if (!files?.length || state.importing) return;
  state.importing = true;
  remoteChangedWhileImporting = false;
  const epoch = authEpoch;
  const wasEmpty = state.places.length === 0;
  const results = [];
  for (const [i, file] of files.entries()) {
    state.importProgress = i + 1;
    renderImport();
    try {
      results.push({ file, result: await importFile(file) });
    } catch (err) {
      // 세션이 끝났으면 로그인 화면으로 넘어가며 가져오기 창도 닫힌다.
      if (authFailed(err) || epoch !== authEpoch) return;
      results.push({ file, error: err.message });
    }
    if (epoch !== authEpoch) return;
  }
  try {
    if ((await reloadPlaces()) && (wasEmpty || results.some((r) => r.result?.imported > 0))) fitToPlaces(visiblePlaces());
  } catch (err) {
    if (!authFailed(err)) toast(err.message);
  }
  if (epoch !== authEpoch) return;
  // 그사이 창을 닫았으면(처음 화면으로 등) 결과는 버린다.
  if (state.importFiles === files) {
    const single = files.length === 1 && state.importSkipped.length === 0;
    // 파일 하나가 실패하면 예전처럼 알림만 띄우고 [가져오기] 화면에 남는다.
    if (single && results[0].error) toast(results[0].error);
    else state.importResults = results;
  }
  state.importing = false;
  state.importProgress = 0;
  renderImport();
  if (remoteChangedWhileImporting) {
    remoteChangedWhileImporting = false;
    refreshPlaces({ force: true });
  }
}

// 새로 받은 장소로 바꾼다. 고른 장소·미션·적던 초안은 아직 유효하면 그대로 둔다.
function applyPlaces(places) {
  const hadSelection = state.selectedId !== null;
  state.places = places;
  const p = places.find((x) => x.id === state.selectedId);
  if (!p) {
    state.selectedId = null;
    state.selectedMission = null;
    state.missionDraft = null;
  } else if (state.selectedMission && !missionNames(p.mission).includes(state.selectedMission)) {
    // 가져오기 등으로 미션명이 바뀌어 고른 미션이 없어졌다.
    state.selectedMission = null;
    state.missionDraft = null;
  }
  const d = state.missionDraft;
  if (d && (d.placeId !== state.selectedId || d.mission !== state.selectedMission)) state.missionDraft = null;
  renderKeepingInput();
  if (hadSelection && state.selectedId === null) toast('이 장소는 다른 기기에서 삭제되었습니다.');
}

// 장소 전체를 다시 받아 반영한다. 그사이 로그아웃했거나 더 나중에 받기 시작한 요청이 있으면 이 결과는 버린다. 반영했으면 true.
let reloadSeq = 0;
let lastRefreshAt = 0;
async function reloadPlaces() {
  const epoch = authEpoch;
  const seq = ++reloadSeq;
  lastRefreshAt = Date.now();
  const places = await api.listPlaces();
  if (epoch !== authEpoch || seq !== reloadSeq) return false;
  applyPlaces(places);
  return true;
}

// 다른 기기에서 바꾼 내용을 보도록, 화면으로 돌아올 때 다시 받는다. 너무 자주 받지 않게 5초에 한 번까지만.
// 실시간 알림(force)은 이 간격과 상관없이 받는다. 가져오는 중에는 끝날 때 한 번 받으므로 건너뛴다.
const REFRESH_INTERVAL_MS = 5000;
// 가져오는 중에 온 실시간 알림. 다른 기기의 변경일 수도 있어서 가져오기가 끝나면 한 번 더 받는다.
let remoteChangedWhileImporting = false;
async function refreshPlaces({ force = false } = {}) {
  if (!signedIn()) return;
  if (state.importing) {
    if (force) remoteChangedWhileImporting = true;
    return;
  }
  if (!force && Date.now() - lastRefreshAt < REFRESH_INTERVAL_MS) return;
  try {
    await reloadPlaces();
  } catch (err) {
    // 잠깐 연결이 끊긴 경우 등은 조용히 넘기고 다음에 다시 받는다. 세션이 끝났으면 로그인 화면으로.
    authFailed(err);
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshPlaces();
});
window.addEventListener('focus', () => refreshPlaces());

// 실시간 알림: places·missions가 바뀌면 300ms 동안 더 오는 알림을 모아 한 번만 다시 받는다(가져오기는 행마다 알림이 온다).
const REALTIME_DEBOUNCE_MS = 300;
let realtimeTimer = null;
function onRemoteChange() {
  clearTimeout(realtimeTimer);
  realtimeTimer = setTimeout(() => refreshPlaces({ force: true }), REALTIME_DEBOUNCE_MS);
}

$('#import-button').addEventListener('click', () => $('#csv-input').click());

// 파일명에 넣을 오늘 날짜(YYYY-MM-DD). UTC가 아니라 기기 시간대 기준이라 한국에서 아침에 내보내도 전날 날짜가 되지 않는다.
function localDateStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 내보내기: 지금 목록을 CSV로 만들어 내려받게 한다. toCsv가 엑셀용 UTF-8 BOM을 앞에 붙여 준다.
$('#export-button').addEventListener('click', () => {
  if (!signedIn()) return;
  const blob = new Blob([toCsv(state.places)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: `places-${localDateStamp()}.csv`, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  // 바로 지우면 일부 브라우저에서 내려받기가 끊긴다.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});

$('#csv-input').addEventListener('change', (e) => {
  if (e.target.files.length > 0) startImport(e.target.files);
  e.target.value = '';
});

$('#search').addEventListener('input', (e) => {
  state.query = e.target.value;
  render();
});

// Esc: 미션 기록을 고치는 중이면 먼저 [취소], 그다음 Esc에 상세 정보를 닫는다.
// 미션 입력 칸 안에서는 아무것도 안 고쳤을 때만 취소한다(적던 값을 실수로 날리지 않게). 다른 입력 칸에서는 아무것도 안 한다.
// 로그인 기록 창이 열려 있으면(이때는 상세 정보가 닫혀 있다) Esc로 닫는다.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.loginLog.open && !e.target.closest?.('input, textarea, select')) {
    closeLoginLog({ focus: true });
    return;
  }
  if (e.key !== 'Escape' || state.selectedId === null) return;
  const inField = e.target.closest?.('input, textarea, select');
  const p = state.places.find((x) => x.id === state.selectedId);
  const d = state.missionDraft;
  if (p && d && draftMatches(p, state.selectedMission)) {
    if (inField && (!e.target.closest('.mission-form') || draftDirty())) return;
    if (!confirmDiscardDraft()) return;
    cancelMissionDraft(p, d.mission);
    return;
  }
  if (inField) return;
  closeDetail();
});

// 화면 어디든 CSV를 끌어다 놓으면 가져오기를 시작한다. 로그인 전에는 받지 않는다(놓은 파일로 페이지가 바뀌지 않게 기본 동작만 막는다).
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer?.types.includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || !signedIn()) return;
  dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove('dragging');
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  if (e.dataTransfer.files.length > 0) startImport(e.dataTransfer.files);
});

// ── 로그인 기록 ─────────────────────────────────────────

const LOGIN_LOG_LIMIT = 200;
// 불러오는 사이 창을 닫았다가 다시 열었으면 앞 응답은 버린다.
let loginLogSeq = 0;

function loginLogRow(r) {
  const who = r.loginId || emailToLoginId(r.email) || '-';
  // 클래스 이름에 쓰므로 두 값으로만 좁힌다(.login은 로그인 화면 클래스라 그대로 쓰면 안 된다).
  const event = r.event === 'logout' ? 'logout' : 'login';
  return h(
    'tr',
    { 'data-event': event },
    h('td', { class: 'log-time' }, h('time', { datetime: r.occurredAt || null }, formatLogTime(r.occurredAt))),
    h('td', { class: 'log-who', title: who }, who),
    h('td', { class: 'log-event' }, h('span', { class: `log-event-tag event-${event}` }, eventLabel(r.event))),
    // 짧게 줄인 기기 이름 위에 마우스를 올리면 전체 user agent와 IP를 볼 수 있다.
    h('td', { class: 'log-device', title: [r.userAgent, r.ip].filter(Boolean).join('\n') || null }, shortUserAgent(r.userAgent)),
  );
}

function renderLoginLog() {
  const box = $('#login-log-panel');
  const log = state.loginLog;
  $('#login-log-button').setAttribute('aria-expanded', String(log.open));
  // 다시 그리면 버튼이 새로 만들어지므로, 창 안에 있던 초점을 같은 버튼으로 돌려놓는다.
  const focused = box.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
  box.hidden = !log.open;
  if (!log.open) {
    box.replaceChildren();
    return;
  }
  const status = log.loading ? '불러오는 중…' : log.error ? log.error : log.rows.length === 0 ? '기록이 없습니다.' : `최근 ${log.rows.length}건`;
  fill(
    box,
    h(
      'div',
      { class: 'import-head' },
      h('h2', { id: 'login-log-title' }, '로그인 기록'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', 'data-focus-key': 'close', onclick: () => closeLoginLog({ focus: true }) }, '×'),
    ),
    h('p', { class: log.error ? 'login-log-status error' : 'login-log-status', role: 'status' }, status),
    log.error &&
      h('div', { class: 'button-row' }, h('button', { type: 'button', class: 'btn', 'data-focus-key': 'retry', onclick: loadLoginLog }, '다시 불러오기')),
    log.rows.length > 0 &&
      h(
        'table',
        { class: 'login-log-table' },
        h('caption', { class: 'sr-only' }, `로그인 기록 최근 ${log.rows.length}건, 최신순`),
        h('thead', {}, h('tr', {}, ['시각', '아이디', '동작', '기기'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, log.rows.map(loginLogRow)),
      ),
  );
  if (focused) refocus(`#login-log-panel [data-focus-key="${focused}"]`);
}

async function loadLoginLog() {
  const seq = ++loginLogSeq;
  const epoch = authEpoch;
  state.loginLog = { ...state.loginLog, loading: true, error: null };
  renderLoginLog();
  let next;
  try {
    const rows = await api.listLoginLogs(LOGIN_LOG_LIMIT);
    next = { open: true, loading: false, rows: Array.isArray(rows) ? rows : [], error: null };
  } catch (err) {
    // 세션이 끝났으면 로그인 화면으로 넘어가며 창도 닫힌다.
    if (authFailed(err)) return;
    next = { open: true, loading: false, rows: [], error: err.message };
  }
  if (seq !== loginLogSeq || epoch !== authEpoch || !state.loginLog.open) return;
  state.loginLog = next;
  renderLoginLog();
}

// 가져오기 창·상세 정보가 있던 자리(목록 위)에 연다. 가져오는 중이거나 적던 미션 기록을 버리지 않기로 했으면 열지 않는다.
function openLoginLog() {
  if (!signedIn()) return;
  if (state.importing) {
    toast('가져오는 중입니다. 끝난 뒤 다시 시도해 주세요.');
    return;
  }
  if (!confirmDiscardDraft()) return;
  state.importFiles = null;
  state.importSkipped = [];
  state.importResults = null;
  renderImport();
  if (state.selectedId !== null) select(null);
  state.loginLog = { ...freshLoginLog(), open: true };
  loadLoginLog();
  $('.panel').scrollTo({ top: 0, behavior: 'smooth' });
}

function closeLoginLog({ focus = false } = {}) {
  if (!state.loginLog.open) return;
  loginLogSeq++;
  state.loginLog = freshLoginLog();
  renderLoginLog();
  if (focus) refocus('#login-log-button');
}

$('#login-log-button').addEventListener('click', () => (state.loginLog.open ? closeLoginLog() : openLoginLog()));

// ── 처음 화면 ───────────────────────────────────────────

// 제목을 누르면 처음 화면으로 돌아간다: 선택·검색·필터·가져오기 창을 모두 닫고 지도를 전체 장소에 맞춘다.
// 새로고침과 달리 다시 받지 않으므로 바로 바뀐다.
function goHome() {
  if (!confirmDiscardDraft()) return;
  state.selectedId = null;
  state.selectedMission = null;
  state.missionDraft = null;
  state.filterColor = null;
  state.query = '';
  state.importFiles = null;
  state.importSkipped = [];
  state.importResults = null;
  // 처음 화면은 시군을 모두 접은 상태다.
  collapseAllGroups();
  $('#search').value = '';
  closeLoginLog();
  renderImport();
  render();
  fitToPlaces(state.places);
  $('.panel').scrollTo({ top: 0, behavior: 'smooth' });
}

$('#home-link').addEventListener('click', (e) => {
  // 새 탭·새 창으로 열기(⌘·Ctrl·Shift·Alt 클릭, 가운데 버튼)는 브라우저에 맡긴다.
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  goHome();
});

// ── 로그인 ──────────────────────────────────────────────

const LOGIN_ENDED_MESSAGE = '로그인이 만료되었거나 다른 창에서 로그아웃했습니다. 다시 로그인해 주세요.';

// 한 번에 하나만 보인다: 'boot'(설정 없음·불러오는 중), 'login', 'app'.
function showView(view) {
  $('#boot-message').hidden = view !== 'boot';
  $('#login').hidden = view !== 'login';
  $('.app').hidden = view !== 'app';
}

function showBootMessage(...lines) {
  fill($('#boot-message'), lines.map((t) => h('p', {}, t)));
  showView('boot');
}

function setLoginError(message, invalidField = null) {
  const el = $('#login-error');
  el.textContent = message ?? '';
  el.hidden = !message;
  for (const name of ['id', 'password']) {
    const input = $(`#login-${name}`);
    if (invalidField === name) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

// RPC가 세션 만료·권한 없음으로 실패했으면 로그인 화면으로 보내고 true.
function authFailed(err) {
  if (!err?.auth) return false;
  leaveApp(err.message);
  return true;
}

// 머리글에 보여 줄 아이디. 계정 생성 스크립트가 user_metadata.login_id에 넣어 둔 한글 아이디를 먼저 쓰고,
// 없으면(대시보드에서 만든 계정 등) 이메일에서 되살린다.
const displayName = (user) => String(user.user_metadata?.login_id ?? '').trim() || emailToLoginId(user.email ?? '');

function showUserName() {
  const el = $('#user-name');
  el.textContent = currentUser?.name ?? '';
  el.title = currentUser?.name ?? '';
}

function enterApp(session) {
  const user = session.user;
  if (currentUser?.id === user.id) {
    // 토큰을 새로 받은 것 등. 화면은 그대로 둔다.
    currentUser.email = user.email ?? '';
    currentUser.name = displayName(user);
    showUserName();
    return;
  }
  if (currentUser) leaveApp(null);
  authEpoch++;
  currentUser = { id: user.id, email: user.email ?? '', name: displayName(user) };
  showUserName();
  // 로그인 폼에서 왔으면 초점이 숨는 칸에 남지 않게 제목으로 옮긴다(저장된 세션으로 바로 열 때는 건드리지 않는다).
  const fromLogin = $('#login').contains(document.activeElement);
  setLoginError(null);
  $('#login-form').reset();
  showView('app');
  if (fromLogin) refocus('#home-link');

  // 지도는 처음 로그인할 때 한 번만 만든다(칸이 보여야 크기를 제대로 잡는다). 그동안에도 목록은 먼저 그린다.
  if (!mapStarted) {
    mapStarted = true;
    initMap().catch(() =>
      showMapMessage(
        '카카오맵을 불러오지 못했습니다.',
        `developers.kakao.com에서 이 주소(${location.origin})가 Web 플랫폼에 등록되어 있고 "카카오맵" 사용 설정이 켜져 있는지 확인해 주세요.`,
      ),
    );
  }
  unsubscribeChanges = api.subscribeChanges(onRemoteChange);
  reloadPlaces()
    .then((applied) => applied && fitToPlaces(state.places))
    .catch((err) => {
      if (!authFailed(err)) toast(err.message);
    });
}

// 로그인 화면으로 돌아간다. 다음 사람에게 앞 사람의 화면(목록·고르던 장소·적던 기록)이 남지 않게 모두 비운다.
function leaveApp(notice) {
  if (signedIn()) {
    authEpoch++;
    currentUser = null;
    unsubscribeChanges?.();
    unsubscribeChanges = null;
    clearTimeout(realtimeTimer);
    missionSaving.clear();
    Object.assign(state, {
      places: [],
      selectedId: null,
      selectedMission: null,
      missionDraft: null,
      filterColor: null,
      query: '',
      importFiles: null,
      importSkipped: [],
      importResults: null,
      importProgress: 0,
      importing: false,
      loginLog: freshLoginLog(),
    });
    loginLogSeq++;
    collapseAllGroups();
    $('#search').value = '';
    showUserName();
    renderLoginLog();
    renderImport();
    render();
  }
  if (notice) setLoginError(notice);
  showView('login');
  if (!$('#login').contains(document.activeElement)) $('#login-id').focus();
}

let loginBusy = false;
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (loginBusy) return;
  const loginId = $('#login-id').value.trim();
  const password = $('#login-password').value;
  if (!loginId || !password) {
    const field = loginId ? 'password' : 'id';
    setLoginError('아이디와 비밀번호를 입력해 주세요.', field);
    $(`#login-${field}`).focus();
    return;
  }
  // 아이디를 Supabase 로그인용 이메일로 바꾼다('@'가 있으면 이메일 그대로). 규칙에 어긋나면 서버에 보내지 않는다.
  let email;
  try {
    email = loginIdToEmail(loginId);
  } catch {
    setLoginError(LOGIN_ID_RULE, 'id');
    $('#login-id').select();
    $('#login-id').focus();
    return;
  }
  loginBusy = true;
  const button = $('#login-submit');
  button.disabled = true;
  button.textContent = '로그인 중…';
  setLoginError(null);
  try {
    // 로그인 알림(onAuthChange)으로도 화면이 바뀌지만, 먼저 바꿔 둔다. 같은 계정이면 두 번째는 그냥 넘어간다.
    enterApp(await api.signIn(email, password));
    // 로그인 기록을 남긴다. 기다리지 않고, 실패해도 무시한다(서버 트리거도 기록하므로 { logged: false }가 올 수 있다).
    api.logLogin(navigator.userAgent);
  } catch (err) {
    setLoginError(err.message);
    $('#login-password').select();
    $('#login-password').focus();
  } finally {
    loginBusy = false;
    button.disabled = false;
    button.textContent = '로그인';
  }
});

$('#logout-button').addEventListener('click', async () => {
  if (loggingOut) return;
  if (state.importing) {
    toast('가져오는 중입니다. 끝난 뒤 다시 시도해 주세요.');
    return;
  }
  if (!confirmDiscardDraft()) return;
  loggingOut = true;
  const button = $('#logout-button');
  button.disabled = true;
  button.textContent = '로그아웃 중…';
  try {
    // 로그아웃 기록은 세션이 살아 있을 때 남겨야 하므로 signOut 전에 부른다. 실패하거나 2초가 넘으면 그냥 넘어간다.
    // (세션 만료·다른 창 로그아웃으로 내보낼 때는 이 버튼을 거치지 않으므로 기록하지 않는다.)
    await api.logLogout();
    await api.signOut();
  } catch {
    // 이 기기의 세션만 지우는 것이라 실패해도 화면은 로그인으로 돌린다.
  } finally {
    loggingOut = false;
    button.disabled = false;
    button.textContent = '로그아웃';
  }
  leaveApp(null);
});

// ── 시작 ────────────────────────────────────────────────

async function boot() {
  if (!config.found) {
    showBootMessage('config.js가 없습니다. npm start로 실행하거나 배포 설정의 Secrets를 확인해 주세요.');
    return;
  }
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    showBootMessage(
      'config.js에 Supabase 설정(supabaseUrl, supabaseAnonKey)이 비어 있습니다.',
      '.env를 채워 npm start로 실행하거나 배포 설정의 Secrets를 확인해 주세요.',
    );
    return;
  }
  await api.initApi(config);
  // 저장된 세션이 있으면 바로 앱을, 없으면 로그인 화면을 띄운다. 다른 창에서 로그인·로그아웃해도 따라간다.
  api.onAuthChange((session, { reason }) => {
    if (session) enterApp(session);
    else leaveApp(reason ?? (signedIn() && !loggingOut ? LOGIN_ENDED_MESSAGE : null));
  });
}

boot().catch((err) => showBootMessage(err.message));
