// 장소 목록: 상태 칩(거르기), 시군 묶음(펼치기·접기), 목록 줄·배지·메모 아이콘, 불러오는 중·실패 줄, 검색(디바운스·IME).
import { $, fill, focusDetailTitle, h, refocus } from './dom.js';
import { collapseAllGroups, hooks, placeColor, state } from './state.js';
import { loadPlaces } from './sync.js';
import { PALETTE, colorLabel, paletteEntry } from './palette.js';
import { missionProgress } from './mission.js';

// 다시 그리기(app.js)·장소 고르기(detail-ui.js)는 위쪽 모듈에 있어 hooks로 부른다.
const render = (...args) => hooks.render(...args);
const requestSelect = (...args) => hooks.requestSelect(...args);

export function renderFilters() {
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
      color && stateDot(color, { 'aria-hidden': 'true' }),
      label,
      h('span', { class: 'count' }, String(count)),
    );

  fill(
    $('#color-filters'),
    state.places.length > 0 && [chip(null, '전체', state.places.length), ...colors.map((c) => chip(c, colorLabel(c), counts.get(c)))],
  );
}

// 진행 상태 점: 색에 기호(미진행 ○, 진행 중 ◐, 완료 ✓)를 함께 그린다(styles.css의 data-state). 색만으로 구별하지 않게 한다.
const stateDot = (hex, props = {}, ...children) =>
  h('span', { class: 'dot', 'data-state': paletteEntry(hex)?.key, style: `--c:${hex}`, ...props }, ...children);

// 장소의 상태 점. 미션이 없는 장소는 배지가 없어서 상태(미진행)를 화면 읽기 프로그램에도 알려 준다.
export function placeDot(p) {
  const color = placeColor(p);
  const label = colorLabel(color);
  const { total } = missionProgress(p.mission, p.missions);
  return stateDot(color, { title: label }, total === 0 && h('span', { class: 'sr-only' }, label));
}

export const listItemSelector = (id) => `#place-list button[data-id="${id}"]`;

// 목록과 상세 정보 제목 옆에 붙는 미션 배지: "미션 완료/전체 ┃ 남은 미션 개수 N". 미션이 없는 장소는 배지를 달지 않는다.
export function missionBadge(p) {
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
export const districtOf = (p) => String(p.district ?? '').trim() || UNKNOWN_DISTRICT;
export const groupHeadSelector = (district) => `#place-list .group-head[data-district="${CSS.escape(district)}"]`;

// 저절로 펼치는 규칙: 고른 장소가 든 시군, 그리고 검색 결과가 SEARCH_OPEN_MAX곳 이하이면 맞는 장소가 있는 모든 시군.
// 결과가 많으면(예: 한 글자 검색) 수천 줄을 한꺼번에 그리지 않도록 접힌 채 둔다. 이 규칙은 저장하지 않는다.
// 상태 분류(미진행·진행 중·완료)는 접힌 채로 걸러만 낸다. 머리글의 개수·점으로 결과를 볼 수 있고, 펼치는 건 사용자가 고른다.
const SEARCH_OPEN_MAX = 100;
// 마지막으로 그린 목록이 검색 때문에 저절로 펼쳐졌는지. 머리를 눌러 접고 펼칠 때 같은 기준을 쓴다.
let searchOpensGroups = false;
const autoOpen = (district, places) => searchOpensGroups || places.some((p) => p.id === state.selectedId);
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
          if (requestSelect(p.id, { pan: true })) focusDetailTitle();
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
          stateDot(hex, { 'aria-hidden': 'true' }),
          h('span', { class: 'sr-only' }, `${label} `),
          String(counts.get(hex)),
        ),
      ),
    ),
    h('span', { class: 'chevron', 'aria-hidden': 'true' }, '▸'),
  );
}

// 목록 위의 상태 줄: 받는 중이면 "불러오는 중…", 못 받았으면 고정 안내와 [다시 시도]. 받은 뒤에는 숨긴다.
function renderListStatus() {
  const box = $('#list-status');
  if (state.loadError) {
    box.hidden = false;
    box.className = 'list-status card failed';
    fill(
      box,
      h('p', { class: 'list-status-text', role: 'alert' }, '장소 목록을 불러오지 못했습니다. ', state.loadError),
      h('button', { type: 'button', class: 'btn', id: 'list-retry', onclick: () => loadPlaces({ fit: true }) }, '다시 시도'),
    );
  } else if (state.loading && state.places.length === 0) {
    box.hidden = false;
    box.className = 'list-status';
    fill(box, h('p', { class: 'list-status-text', role: 'status' }, '불러오는 중…'));
  } else {
    box.hidden = true;
    box.className = 'list-status';
    box.replaceChildren();
  }
}

let lastListKey = null;
export function renderList(visible) {
  const total = state.places.length;
  renderListStatus();
  // "아직 저장한 장소가 없습니다"는 목록을 받은 뒤 0곳일 때만. 받는 중·실패 중에 보이면 데이터가 지워진 것처럼 보인다.
  $('#empty').hidden = !(state.loaded && !state.loading && !state.loadError && total === 0);
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
  searchOpensGroups = state.query.trim() !== '' && visible.length <= SEARCH_OPEN_MAX;

  // 접힌 시군은 줄(DOM)을 만들지 않는다. 장소가 수천 곳이어도 펼친 시군만 그린다.
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
          h('ul', { class: 'group-items', id: listId, hidden: !open }, open && places.map(placeRow)),
        );
      }),
  );
}

// 검색: 150ms 동안 더 치지 않으면 걸러 그린다. 한글을 조합하는 중(IME)에는 기다렸다가 조합이 끝나면 그린다.
// 글자마다 목록·지도를 다시 그리지 않게 한다. Enter(휴대폰 키보드의 [검색])는 기다리지 않고 바로 거른다.
const SEARCH_DELAY_MS = 150;
let searchTimer = null;
let searchComposing = false;

function applySearch(value) {
  clearTimeout(searchTimer);
  searchTimer = null;
  if (state.query === value) return;
  state.query = value;
  render();
}

function scheduleSearch(value) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => applySearch(value), SEARCH_DELAY_MS);
}

const searchInput = $('#search');
searchInput.addEventListener('compositionstart', () => {
  searchComposing = true;
});
searchInput.addEventListener('compositionend', (e) => {
  searchComposing = false;
  scheduleSearch(e.target.value);
});
searchInput.addEventListener('input', (e) => {
  if (searchComposing || e.isComposing) return;
  scheduleSearch(e.target.value);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault();
  applySearch(e.target.value);
});

// 기다리던 검색을 그만둔다(처음 화면으로 갈 때·로그아웃할 때).
export function cancelSearch() {
  clearTimeout(searchTimer);
  searchTimer = null;
}
