import { PALETTE, colorLabel, paletteEntry } from './palette.js';
import { kakaoMapViewUrl, openKakaoMapRoute } from './kakao.js';
import { missionNames, missionProgress } from './mission.js';
// csv.js·login-id.js는 다른 담당이 함수를 더해 가는 파일이라 이름공간으로 가져온다.
// 아직 없는 이름(nearDuplicates·isValidPassword 등)을 이름으로 가져오면 모듈 전체가 안 열리므로, 쓸 때 있는지 보고 쓴다.
import * as csv from './csv.js';
import * as loginId from './login-id.js';
import * as api from './api.js';
import { $, fill, focusDetailTitle, h, refocus, toast } from './dom.js';
import {
  collapseAllGroups,
  config,
  findPlace,
  hooks,
  isPlaceGone,
  placeColor,
  rememberOwnWrite,
  replacePlace,
  state,
  touchPlace,
  visiblePlaces,
} from './state.js';
import {
  LOGIN_ENDED_MESSAGE,
  authEpoch,
  authFailed,
  bumpAuthEpoch,
  currentUser,
  currentWorkerName,
  displayName,
  loggingOut,
  setCurrentUser,
  setLoggingOut,
  setLoginError,
  setLoginNotice,
  setLoginPasswordShown,
  showBootMessage,
  showUserName,
  showView,
  signedIn,
} from './session.js';
import { fitToPlaces, mapState, panToPlace, renderMarkers, startMap } from './map-ui.js';
import {
  anyUnsavedMemo,
  discardMemo,
  flushAllMemos,
  flushMemo,
  memoDrafts,
  memoStatusView,
  memoText,
  memoUnsaved,
  onMemoInput,
  retryFailedMemos,
  saveAllMemos,
} from './memo-ui.js';
import {
  flushRemote,
  loadPlaces,
  onRemoteChange,
  refreshPlaces,
  reloadPlaces,
  remoteChangedWhileImporting,
  resetSync,
  setRemoteChangedWhileImporting,
} from './sync.js';

// 아래쪽 모듈이 부르는 함수를 넘겨준다(state.js의 hooks 설명 참고).
Object.assign(hooks, { dropGonePlace, leaveApp, render, renderKeepingInput, renderListAndMap, requestSelect });

let unsubscribeChanges = null;

// ── 화면 그리기 ───────────────────────────────────────────

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
function placeDot(p) {
  const color = placeColor(p);
  const label = colorLabel(color);
  const { total } = missionProgress(p.mission, p.missions);
  return stateDot(color, { title: label }, total === 0 && h('span', { class: 'sr-only' }, label));
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
function renderList(visible) {
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

function renderDetail() {
  const box = $('#detail');
  const p = state.places.find((x) => x.id === state.selectedId);
  box.hidden = !p;
  if (!p) {
    box.replaceChildren();
    delete box.dataset.placeId;
    return;
  }
  box.dataset.placeId = p.id;

  // 저장하지 않은(또는 저장 중인) 메모가 있으면 서버 값 대신 그것을 보여 준다. 실시간으로 다시 그려도 적던 글이 덮이지 않는다.
  const memo = h(
    'textarea',
    {
      id: 'memo-input',
      rows: 2,
      maxlength: 2000,
      placeholder: '메모를 남겨 두세요',
      'aria-describedby': 'memo-status',
      oninput: (e) => onMemoInput(p.id, e.target.value),
      // 칸을 떠나면(change) 1초를 기다리지 않고 바로 저장한다.
      onchange: (e) => flushMemo(p.id, e.target.value),
    },
    memoText(p),
  );
  const missions = missionNames(p.mission);
  const progress = missionProgress(p.mission, p.missions);

  fill(
    box,
    h(
      'div',
      { class: 'detail-head' },
      placeDot(p),
      // 장소를 고르면 초점이 여기로 온다(tabindex=-1: 탭 순서에는 넣지 않고 초점만 받을 수 있게).
      h('h2', { id: 'detail-title', tabindex: '-1' }, p.name, missionBadge(p)),
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
    h(
      'div',
      { class: 'memo' },
      h('label', { for: 'memo-input' }, '메모'),
      memo,
      // 저장 상태는 메모 아래에 고정해 보여 준다(알림처럼 사라지지 않는다).
      h('div', { id: 'memo-status', class: 'memo-status', role: 'status' }, memoStatusView(p.id)),
    ),
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
    // 실수로 누르지 않게 다른 버튼과 떨어뜨려 맨 아래에 둔다(styles.css .delete-place).
    h('div', { class: 'delete-place' }, h('button', { type: 'button', class: 'link danger', onclick: () => removePlace(p) }, '이 장소 삭제')),
  );
}

// 기록이 없는 미션은 빈 기록으로 본다. 서버는 한 번이라도 저장한 미션만 돌려준다.
const missionRecord = (p, name) =>
  p.missions?.find((m) => m.mission === name) ?? { mission: name, done: false, worker: '', flightTime: '', batteryNo: '', batteryLeft: '' };

// '이름'(worker)은 고칠 수 없다(readonly): 늘 지금 로그인한 사람의 표시 아이디로 기록한다.
const MISSION_FIELDS = [
  { key: 'worker', label: '이름', placeholder: '작업자', inputmode: 'text', readonly: true },
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

// 사람이 고칠 수 있는 칸(이름은 빠진다). 초안을 고쳤는지 볼 때 쓴다.
const EDITABLE_MISSION_FIELDS = MISSION_FIELDS.filter((f) => !f.readonly);

function newMissionDraft(p, name) {
  const r = missionRecord(p, name);
  return {
    placeId: p.id,
    mission: name,
    done: Boolean(r.done),
    // 이름은 늘 지금 로그인한 아이디다. 저장하면 저장한 사람의 아이디로 기록된다.
    worker: currentWorkerName(),
    // 저장된 기록의 이름(다른 사람일 수 있다). 폼에 "지금 기록의 이름은 …, 저장하면 내 아이디로 바뀝니다"를 보일 때 쓴다.
    savedWorker: String(r.worker ?? '').trim(),
    flightTime: r.flightTime ?? '',
    batteryNo: r.batteryNo ?? '',
    batteryLeft: r.batteryLeft ?? '',
    // 저장하려다 막힌 칸: { 칸 이름: 'required' | 'range' }. 다시 그려도 빨간 테두리가 남도록 초안에 둔다.
    invalid: {},
    // 이 값을 바탕으로 고쳤다는 기록 판(version). 기록이 없으면 null. 그사이 다른 기기가 저장했으면 save_mission이 conflict로 막는다.
    baseVersion: r.version ?? null,
    // conflict를 받았을 때 서버의 최신 기록(없으면 null). undefined면 충돌 없음.
    conflict: undefined,
    // 저장이 끝나지 못했을 때(시간 초과·연결 실패·취소) 폼 안에 남기는 안내 { message, retry }. 없으면 null.
    error: null,
  };
}

// 입력 화면에 보일 값. 고치는 중인 값이 없으면 저장된 기록으로 만든다(아직 state에 넣지는 않는다).
const missionDraftFor = (p, name) => (draftMatches(p, name) ? state.missionDraft : newMissionDraft(p, name));

// 미션 초안이 저장된 기록(새 미션이면 빈 기록)과 다르면 true. 이름은 사람이 고칠 수 없는 칸이라 보지 않는다
// (다른 사람이 저장한 기록을 열기만 해도 "저장하지 않은 기록"으로 묻지 않게).
function missionDraftDirty() {
  const d = state.missionDraft;
  const p = d && findPlace(d.placeId);
  if (!p) return false;
  const r = missionRecord(p, d.mission);
  return (
    Boolean(d.done) !== Boolean(r.done) ||
    EDITABLE_MISSION_FIELDS.some(({ key }) => String(d[key] ?? '').trim() !== String(r[key] ?? '').trim())
  );
}

// 저장하지 않은 것이 있으면 true: 미션 초안, 또는 고른 장소의 메모(저장 실패·충돌). 버리기 전에 물어볼지 정한다.
// 입력만 하고 1초가 안 지난 메모는 묻지 않고 바로 저장을 시작한다(confirmDiscardDraft).
const draftDirty = () => missionDraftDirty() || memoUnsaved(state.selectedId);

const confirmDiscardMissionDraft = () => !missionDraftDirty() || confirm('저장하지 않은 미션 기록이 있습니다. 버릴까요?');

// 장소를 떠나기(닫기·다른 장소·처음 화면·로그아웃 등) 전에 부른다. 그만두면 false.
function confirmDiscardDraft() {
  flushMemo(state.selectedId);
  const mission = missionDraftDirty();
  const memo = memoUnsaved(state.selectedId);
  if (!mission && !memo) return true;
  const what = mission && memo ? '미션 기록과 메모가' : mission ? '미션 기록이' : '메모가';
  if (!confirm(`저장하지 않은 ${what} 있습니다. 버릴까요?`)) return false;
  if (memo) discardMemo(state.selectedId);
  return true;
}

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

// 고치기 시작한 칸은 바로 빨간 표시를 지운다. 이름 칸은 읽기 전용이라 무엇이 와도 초안에 넣지 않는다.
function onMissionFieldInput(p, name, key, e) {
  const input = e.target;
  if (key === 'worker') {
    input.value = currentWorkerName();
    return;
  }
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
    MISSION_FIELDS.map(({ key, label, placeholder, inputmode, unit, readonly }) =>
      readonly
        ? workerField(draft)
        : h(
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
    // 다른 기기가 먼저 저장해 막혔을 때: 알림 대신 폼 안에 고정 안내를 두고, 서버의 최신 값과 두 가지 길을 보여 준다.
    // [저장]을 다시 눌러도 [내 값으로 덮어쓰기]와 같다(초안의 기록 판을 최신으로 맞춰 두었다).
    draft.conflict !== undefined &&
      h(
        'div',
        { class: 'mission-conflict', role: 'alert' },
        h('p', { class: 'mission-conflict-message' }, MISSION_CONFLICT_MESSAGE),
        h('p', { class: 'mission-conflict-latest' }, `최신 저장값: ${draft.conflict ? missionSummaryLine(draft.conflict) : '없음'}`),
        h(
          'div',
          { class: 'button-row' },
          h('button', { type: 'button', class: 'btn conflict-latest', disabled: saving, onclick: () => loadLatestMission(p.id, name) }, '최신값 불러오기'),
          h('button', { type: 'button', class: 'btn conflict-overwrite', disabled: saving, onclick: () => saveMissionDraft(p.id, name) }, '내 값으로 덮어쓰기'),
        ),
      ),
    // 시간 초과·연결 실패·[취소]로 저장이 끝나지 못했을 때. 적던 값은 그대로 있고 [다시 시도]로 다시 보낸다.
    draft.error &&
      h(
        'div',
        { class: 'mission-error' },
        h('p', {}, draft.error.message),
        draft.error.retry &&
          h('button', { type: 'button', class: 'btn small mission-retry', disabled: saving, onclick: () => saveMissionDraft(p.id, name) }, '다시 시도'),
      ),
    h(
      'div',
      { class: 'button-row' },
      h('button', { type: 'submit', class: 'btn primary', disabled: saving }, saving ? '저장 중…' : '저장'),
      // 저장 중에도 누를 수 있다: 기다리기를 그만두고 입력 화면으로 돌아온다(적던 값은 그대로).
      h(
        'button',
        { type: 'button', class: 'btn cancel', onclick: () => (missionSaving.has(missionKey(p.id, name)) ? stopMissionSave(p.id, name) : cancelMissionDraft(p, name)) },
        '취소',
      ),
    ),
  );
}

const MISSION_CONFLICT_MESSAGE = '다른 기기에서 먼저 저장된 기록이 있습니다. 내가 적은 값은 그대로 두었습니다.';

// 이름 칸: 읽기 전용(회색). 늘 지금 로그인한 아이디를 보이고, 라벨 옆에 그렇게 기록된다고 알린다.
// 저장된 기록의 이름이 다른 사람이면 그 이름과, 저장하면 내 아이디로 바뀐다는 것을 함께 알린다.
function workerField(draft) {
  const me = currentWorkerName();
  const other = draft.savedWorker && draft.savedWorker !== me ? draft.savedWorker : '';
  return h(
    'label',
    { class: 'field readonly' },
    h('span', {}, '이름 ', h('small', { class: 'field-hint', id: 'worker-hint' }, '로그인한 아이디로 기록됩니다')),
    h('input', {
      type: 'text',
      name: 'worker',
      value: me,
      readonly: true,
      'aria-readonly': 'true',
      'aria-describedby': other ? 'worker-hint worker-note' : 'worker-hint',
      autocomplete: 'off',
      oninput: (e) => {
        e.target.value = me;
      },
    }),
    other && h('small', { class: 'field-note', id: 'worker-note' }, `지금 기록의 이름은 ${other}입니다. 저장하면 로그인한 아이디(${me})로 바뀝니다.`),
  );
}

// 충돌 안내의 [최신값 불러오기]: 서버의 최신 기록으로 초안을 다시 만든다(이름이 비어 있으면 내 아이디를 다시 넣는다).
function loadLatestMission(placeId, name) {
  const p = findPlace(placeId);
  if (!p || !draftMatches(p, name) || missionSaving.has(missionKey(placeId, name))) return;
  state.missionDraft = newMissionDraft(p, name);
  renderKeepingInput();
  refocus(`${missionFormSelector(name)} input[name="done"]`);
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

// 근접 중복 거리: 1km 미만은 m, 넘으면 km(소수 한 자리).
const formatDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`);

// 가져오기 전 확인 화면(계약 C7): 미션명이 바뀌는 기존 장소(기록 수), 이름·시군이 같은데 위치가 다른 장소(거리), 행 경고.
// [계속]을 눌러야 보낸다. 미션명 변경이 있으면 기본 초점은 [취소](runImport가 옮긴다).
function importReviewView(review) {
  const MAX = 30;
  const list = (items, line) =>
    h(
      'ul',
      { class: 'review-list' },
      items.slice(0, MAX).map((x) => h('li', {}, line(x))),
      items.length > MAX && h('li', { class: 'review-more' }, `외 ${items.length - MAX}건`),
    );
  const where = (x) => `${x.file ? `${x.file} ` : ''}${x.line}행`;
  const placeName = (x) => `${x.name}${x.district ? `(${x.district})` : ''}`;
  return h(
    'section',
    { class: 'import-review', 'aria-labelledby': 'import-review-title' },
    h('h3', { id: 'import-review-title' }, '가져오기 전에 확인해 주세요'),
    review.changes.length > 0 &&
      h(
        'div',
        { class: 'review-group review-changes' },
        h('h4', {}, `미션명이 바뀌는 기존 장소 ${review.changes.length}곳`),
        h('p', { class: 'hint' }, '바뀐 미션명에 없는 미션의 기록은 지워지지 않지만 화면 진행도에서 빠집니다.'),
        list(review.changes, (c) => [h('b', {}, placeName(c)), ` ${where(c)} · ${c.from || '(없음)'} → ${c.to} · 기록 ${c.recordCount}건`]),
      ),
    review.near.length > 0 &&
      h(
        'div',
        { class: 'review-group review-near' },
        h('h4', {}, `이름·시군이 같은데 위치가 다른 기존 장소 ${review.near.length}건`),
        h('p', { class: 'hint' }, '가져오면 같은 이름의 장소가 하나 더 생깁니다.'),
        list(review.near, (n) => [h('b', {}, placeName(n)), ` ${where(n)} · 기존 장소와 ${formatDistance(n.distanceM)} 떨어짐`]),
      ),
    review.warnings.length > 0 &&
      h(
        'div',
        { class: 'review-group review-warnings' },
        h('h4', {}, `확인할 점 ${review.warnings.length}건`),
        list(review.warnings, (w) => `${where(w)}: ${w.reason}`),
      ),
    h(
      'div',
      { class: 'button-row' },
      h('button', { type: 'button', class: 'btn primary', id: 'import-review-continue', onclick: continueImport }, '계속'),
      h('button', { type: 'button', class: 'btn', id: 'import-review-cancel', onclick: cancelImportReview }, '취소'),
    ),
  );
}

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
    state.importReview = null;
    renderImport();
  };
  const results = state.importResults;
  const skipped = state.importSkipped;
  // 파일 하나(건너뛴 파일도 없음)는 예전 모습 그대로 둔다.
  const single = files.length === 1 && skipped.length === 0;
  // 파일을 읽는 동안(진행 0)은 번호 없이, 보내는 동안은 "(2/5)"처럼 보여 준다.
  const busyLabel = single || state.importProgress === 0 ? '가져오는 중…' : `가져오는 중… (${state.importProgress}/${files.length})`;

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
      : state.importReview
      ? [importReviewView(state.importReview)]
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

// ── 계정 관리(관리자만) ─────────────────────────────────

// 비밀번호 규칙은 login-id.js(인증 담당)를 따른다. 아직 그 값이 없는 판에서도 열리도록 같은 규칙(길이만)으로 대신한다.
// 화면 검사는 미리 막는 용도이고, 최종 판정과 문구는 서버(Edge Function) 응답을 그대로 보여 준다.
const PASSWORD_MIN = loginId.PASSWORD_MIN ?? 6;
const PASSWORD_MAX_BYTES = loginId.PASSWORD_MAX ?? 72;
const PASSWORD_RULE = loginId.PASSWORD_RULE ?? '비밀번호는 6자 이상 72자 이하여야 합니다.';
const passwordOk = (pw) =>
  loginId.isValidPassword?.(pw) ??
  (typeof pw === 'string' && pw.length >= PASSWORD_MIN && new TextEncoder().encode(pw).length <= PASSWORD_MAX_BYTES);
const SELF_RESET_NOTICE = '본인 비밀번호를 바꾸면 모든 기기에서 로그아웃됩니다.';
// 본인 비밀번호를 바꾼 뒤 로그인 화면에 띄우는 안내(만료 안내와 다른 칸·다른 모양).
const PASSWORD_CHANGED_NOTICE = '비밀번호를 바꿨습니다. 새 비밀번호로 다시 로그인해 주세요.';

// 계정 관리 창의 상태. 장소 목록(state)과는 별개라 로그아웃하면 통째로 비운다.
const accounts = {
  open: false,
  loading: false, // 목록을 받는 중
  busy: false, // 만들기·재설정 요청 중(그동안 버튼을 모두 잠근다)
  users: null, // 서버가 준 계정 목록. 아직 못 받았으면 null
  error: null, // 창 안 메시지 영역에 빨갛게
  notice: null, // 창 안 메시지 영역에 보통 글씨로(성공 안내)
  resetId: null, // 비밀번호를 바꾸는 중인 계정 id
  resetPassword: '',
  resetInvalid: false,
  resetShown: false, // 재설정 비밀번호 칸 [보기]
  // 새 계정 폼. 다시 그려도 적던 글자가 남게 여기에 둔다.
  create: { loginId: '', password: '', invalid: null, shown: false },
};

const accountsReset = () =>
  Object.assign(accounts, {
    open: false,
    loading: false,
    busy: false,
    users: null,
    error: null,
    notice: null,
    resetId: null,
    resetPassword: '',
    resetInvalid: false,
    resetShown: false,
    create: { loginId: '', password: '', invalid: null, shown: false },
  });

// 계정 목록에 보여 줄 아이디. 서버가 login_id를 못 주면(대시보드에서 만든 계정 등) 이메일에서 되살린다.
const accountName = (u) => String(u.login_id ?? '').trim() || loginId.emailToLoginId(u.email ?? '');

// ISO 시각 → 한국 표기. 없거나 읽을 수 없으면 "-". withTime이면 시:분까지.
function formatWhen(iso, { withTime = false } = {}) {
  if (!iso) return '-';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '-';
  const opts = { year: 'numeric', month: 'numeric', day: 'numeric' };
  if (withTime) Object.assign(opts, { hour: 'numeric', minute: '2-digit' });
  return t.toLocaleString('ko-KR', opts);
}

function setAccountsMessage({ error = null, notice = null } = {}) {
  accounts.error = error;
  accounts.notice = notice;
}

// 비밀번호 칸 + [보기] 단추. 누르면 글자가 보이고(aria-pressed="true") 다시 누르면 가린다.
// 다시 그려도 상태가 남도록 보이는지 여부는 호출하는 쪽 상태(shown)에 둔다.
function passwordField({ id, name, autocomplete, value, placeholder, shown, disabled, invalid, oninput, onToggle }) {
  return h(
    'span',
    { class: 'pw-field' },
    h('input', {
      id,
      type: shown ? 'text' : 'password',
      name,
      autocomplete,
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      placeholder,
      value,
      disabled,
      'aria-invalid': invalid ? 'true' : null,
      oninput,
    }),
    h(
      'button',
      {
        type: 'button',
        class: 'pw-toggle',
        'aria-controls': id,
        'aria-pressed': String(Boolean(shown)),
        'aria-label': '비밀번호 보기',
        disabled,
        onclick: () => {
          onToggle();
          refocus(`#${id} + .pw-toggle`);
        },
      },
      '보기',
    ),
  );
}

// 창을 열고 목록을 받는다. 이미 열려 있으면 목록만 새로 받는다.
function openAccounts() {
  if (!currentUser?.admin) return;
  accounts.open = true;
  renderAccounts();
  $('.panel').scrollTo({ top: 0, behavior: 'smooth' });
  loadAccounts().then(() => refocus('#accounts-close'));
}

function closeAccounts() {
  if (accounts.busy) return;
  accountsReset();
  renderAccounts();
  refocus('#accounts-button');
}

// 목록을 새로 받는다. 세션이 끝났으면 로그인 화면으로 가고, 다른 실패는 창 안에 보여 준다.
async function loadAccounts() {
  const epoch = authEpoch;
  accounts.loading = true;
  renderAccounts();
  try {
    const users = await api.listAccounts();
    if (epoch !== authEpoch || !accounts.open) return;
    accounts.users = users;
    accounts.error = null;
  } catch (err) {
    if (authFailed(err) || epoch !== authEpoch || !accounts.open) return;
    accounts.error = err.message;
  }
  accounts.loading = false;
  renderAccounts();
}

// 새 계정 폼의 입력을 검사한다. 어긋난 칸 이름('loginId' | 'password')과 문구를 돌려주고, 괜찮으면 null.
function createFormProblem(id, password) {
  if (loginId.normalizeLoginId(id) === null) return { field: 'loginId', message: loginId.LOGIN_ID_RULE };
  if (!passwordOk(password)) return { field: 'password', message: PASSWORD_RULE };
  return null;
}

async function submitCreate() {
  if (accounts.busy || accounts.loading) return;
  const id = loginId.normalizeLoginId(accounts.create.loginId);
  const problem = createFormProblem(accounts.create.loginId, accounts.create.password);
  if (problem) {
    accounts.create.invalid = problem.field;
    setAccountsMessage({ error: problem.message });
    renderAccounts();
    refocus(`#accounts-new-${problem.field === 'loginId' ? 'id' : 'password'}`);
    return;
  }
  const epoch = authEpoch;
  accounts.busy = true;
  accounts.create.invalid = null;
  setAccountsMessage();
  renderAccounts();
  try {
    await api.createAccount(id, accounts.create.password);
    if (epoch !== authEpoch || !accounts.open) return;
    accounts.create = { loginId: '', password: '', invalid: null, shown: false };
    accounts.busy = false;
    setAccountsMessage({ notice: `${id} 계정을 만들었습니다.` });
    await loadAccounts();
    if (epoch === authEpoch && accounts.open) refocus('#accounts-new-id');
  } catch (err) {
    if (authFailed(err) || epoch !== authEpoch || !accounts.open) return;
    accounts.busy = false;
    setAccountsMessage({ error: err.message });
    renderAccounts();
    refocus('#accounts-new-id');
  }
}

function startReset(userId) {
  if (accounts.busy) return;
  accounts.resetId = userId;
  accounts.resetPassword = '';
  accounts.resetInvalid = false;
  accounts.resetShown = false;
  setAccountsMessage();
  renderAccounts();
  refocus('#accounts-reset-password');
}

function cancelReset() {
  if (accounts.busy) return;
  const id = accounts.resetId;
  accounts.resetId = null;
  accounts.resetPassword = '';
  accounts.resetInvalid = false;
  accounts.resetShown = false;
  renderAccounts();
  refocus(`#accounts-panel button[data-reset="${CSS.escape(String(id))}"]`);
}

// 본인 비밀번호를 바꿨으면 이 기기에서도 로그아웃하고, 로그인 화면에 "새 비밀번호로 다시 로그인" 안내를 띄운다.
async function signOutAfterOwnPasswordChange() {
  setLoggingOut(true);
  try {
    await api.signOut();
  } catch (err) {
    // 서버가 이미 모든 세션을 끊었으면 실패할 수 있다. 이 기기의 화면은 어차피 로그인으로 돌린다.
    api.logCause('본인 비밀번호 변경 뒤 로그아웃 실패(무시)', err);
  } finally {
    setLoggingOut(false);
  }
  leaveApp(null, { notice: PASSWORD_CHANGED_NOTICE });
}

async function submitReset() {
  if (accounts.busy || accounts.resetId === null) return;
  const user = accounts.users?.find((u) => u.id === accounts.resetId);
  if (!user) return;
  if (!passwordOk(accounts.resetPassword)) {
    accounts.resetInvalid = true;
    setAccountsMessage({ error: PASSWORD_RULE });
    renderAccounts();
    refocus('#accounts-reset-password');
    return;
  }
  const self = user.id === currentUser?.id;
  // 다른 사람 계정은 한 번 더 확인한다(그 사람이 모든 기기에서 로그아웃된다). 본인은 단추 이름이 [바꾸고 로그아웃]이라 묻지 않는다.
  if (!self && !confirm(`${accountName(user)} 계정의 비밀번호를 바꿀까요? 그 계정은 모든 기기에서 로그아웃됩니다.`)) {
    refocus('#accounts-reset-password');
    return;
  }
  // 본인이면 곧 로그아웃되므로, 바꾸기 전에 저장하지 않은 미션 기록을 묻고 메모는 끝까지 저장해 둔다.
  if (self) {
    if (!confirmDiscardDraft()) {
      refocus('#accounts-reset-password');
      return;
    }
    await saveAllMemos();
  }
  const epoch = authEpoch;
  accounts.busy = true;
  accounts.resetInvalid = false;
  setAccountsMessage();
  renderAccounts();
  try {
    await api.resetAccountPassword(user.id, accounts.resetPassword);
    if (epoch !== authEpoch || !accounts.open) return;
    if (self) {
      await signOutAfterOwnPasswordChange();
      return;
    }
    accounts.busy = false;
    accounts.resetId = null;
    accounts.resetPassword = '';
    accounts.resetShown = false;
    setAccountsMessage({ notice: `${accountName(user)} 계정의 비밀번호를 바꿨습니다.` });
    renderAccounts();
    refocus(`#accounts-panel button[data-reset="${CSS.escape(String(user.id))}"]`);
  } catch (err) {
    if (authFailed(err) || epoch !== authEpoch || !accounts.open) return;
    accounts.busy = false;
    setAccountsMessage({ error: err.message });
    renderAccounts();
    refocus('#accounts-reset-password');
  }
}

// 표를 display: block으로 쌓아 보이면 화면 읽기 프로그램이 표 구조를 잃는다. role을 직접 달아 표로 읽히게 한다.
const cell = (props, ...children) => h('td', { role: 'cell', ...props }, ...children);

// 비밀번호를 바꾸는 중인 계정의 행: 아이디 + (본인이면 경고) + 새 비밀번호 입력 + 확인·취소.
function accountResetRow(u, self) {
  const disabled = accounts.busy;
  return h(
    'tr',
    { class: 'accounts-row resetting', 'data-user-id': u.id, role: 'row' },
    cell(
      { colspan: 4 },
      h(
        'form',
        {
          class: self ? 'accounts-reset self' : 'accounts-reset',
          onsubmit: (e) => {
            e.preventDefault();
            submitReset();
          },
        },
        h('p', { class: 'accounts-reset-title' }, h('b', {}, accountName(u)), ' 비밀번호 재설정'),
        self && h('p', { class: 'accounts-self-notice', role: 'note' }, SELF_RESET_NOTICE),
        // [보기] 단추가 label 안에 들어가지 않게 칸 이름(label)과 입력 묶음을 나란히 둔다.
        h(
          'div',
          { class: 'field' },
          h('label', { for: 'accounts-reset-password' }, '새 비밀번호'),
          passwordField({
            id: 'accounts-reset-password',
            name: 'new-password',
            autocomplete: 'new-password',
            value: accounts.resetPassword,
            placeholder: `${PASSWORD_MIN}자 이상`,
            shown: accounts.resetShown,
            disabled,
            invalid: accounts.resetInvalid,
            oninput: (e) => {
              accounts.resetPassword = e.target.value;
              if (accounts.resetInvalid) {
                accounts.resetInvalid = false;
                e.target.removeAttribute('aria-invalid');
              }
            },
            onToggle: () => {
              accounts.resetShown = !accounts.resetShown;
              renderAccounts();
            },
          }),
        ),
        h(
          'div',
          { class: 'button-row' },
          h('button', { type: 'submit', class: self ? 'btn primary danger' : 'btn primary', disabled }, disabled ? '바꾸는 중…' : self ? '바꾸고 로그아웃' : '확인'),
          h('button', { type: 'button', class: 'btn', disabled, onclick: cancelReset }, '취소'),
        ),
      ),
    ),
  );
}

function accountRow(u) {
  const self = u.id === currentUser?.id;
  if (accounts.resetId === u.id) return accountResetRow(u, self);
  return h(
    'tr',
    { class: 'accounts-row', 'data-user-id': u.id, role: 'row' },
    cell(
      { class: 'accounts-id', 'data-label': '아이디' },
      h('span', { class: 'accounts-name' }, accountName(u)),
      u.is_admin && h('span', { class: 'badge accounts-admin' }, '관리자'),
      self && h('span', { class: 'accounts-self' }, '(본인)'),
    ),
    cell({ class: 'accounts-when', 'data-label': '만든 날' }, formatWhen(u.created_at)),
    cell({ class: 'accounts-when', 'data-label': '마지막 로그인' }, formatWhen(u.last_sign_in_at, { withTime: true })),
    cell(
      { class: 'accounts-actions' },
      h('button', { type: 'button', class: 'btn small', 'data-reset': u.id, disabled: accounts.busy || accounts.loading, onclick: () => startReset(u.id) }, '비밀번호 재설정'),
    ),
  );
}

function accountsTable() {
  const users = accounts.users;
  if (!users) return accounts.loading ? h('p', { class: 'hint accounts-status' }, '계정 목록을 불러오는 중…') : null;
  if (users.length === 0) return h('p', { class: 'hint accounts-status' }, '계정이 없습니다.');
  const head = (text) => h('th', { scope: 'col', role: 'columnheader' }, text);
  return h(
    'table',
    { class: 'accounts-table', role: 'table', 'aria-label': '계정 목록' },
    h(
      'thead',
      { role: 'rowgroup' },
      h('tr', { role: 'row' }, head('아이디'), head('만든 날'), head('마지막 로그인'), head(h('span', { class: 'sr-only' }, '동작'))),
    ),
    h('tbody', { role: 'rowgroup' }, users.map(accountRow)),
  );
}

function accountsCreateForm() {
  const disabled = accounts.busy;
  const { create } = accounts;
  return h(
    'form',
    {
      class: 'accounts-create',
      autocomplete: 'off',
      onsubmit: (e) => {
        e.preventDefault();
        submitCreate();
      },
    },
    h('h3', {}, '새 계정'),
    h(
      'div',
      { class: 'accounts-create-fields' },
      h(
        'label',
        { class: 'field' },
        h('span', {}, '아이디'),
        h('input', {
          id: 'accounts-new-id',
          type: 'text',
          name: 'new-login-id',
          autocomplete: 'off',
          autocapitalize: 'off',
          autocorrect: 'off',
          spellcheck: 'false',
          placeholder: '예: 홍길동',
          value: create.loginId,
          disabled,
          'aria-invalid': create.invalid === 'loginId' ? 'true' : null,
          oninput: (e) => {
            create.loginId = e.target.value;
            if (create.invalid === 'loginId') {
              create.invalid = null;
              e.target.removeAttribute('aria-invalid');
            }
          },
        }),
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'accounts-new-password' }, '비밀번호'),
        passwordField({
          id: 'accounts-new-password',
          name: 'new-password',
          autocomplete: 'new-password',
          value: create.password,
          placeholder: `${PASSWORD_MIN}자 이상`,
          shown: create.shown,
          disabled,
          invalid: create.invalid === 'password',
          oninput: (e) => {
            create.password = e.target.value;
            if (create.invalid === 'password') {
              create.invalid = null;
              e.target.removeAttribute('aria-invalid');
            }
          },
          onToggle: () => {
            create.shown = !create.shown;
            renderAccounts();
          },
        }),
      ),
    ),
    h('div', { class: 'button-row' }, h('button', { id: 'accounts-create-button', type: 'submit', class: 'btn primary', disabled }, disabled ? '만드는 중…' : '만들기')),
  );
}

function renderAccounts() {
  const box = $('#accounts-panel');
  box.hidden = !accounts.open;
  if (!accounts.open) {
    box.replaceChildren();
    return;
  }
  const message = accounts.error ?? accounts.notice;
  fill(
    box,
    h(
      'div',
      { class: 'accounts-head' },
      h('h2', { id: 'accounts-title' }, '계정 관리'),
      h(
        'div',
        { class: 'accounts-head-buttons' },
        h('button', { type: 'button', class: 'btn small', id: 'accounts-refresh', disabled: accounts.busy || accounts.loading, onclick: () => loadAccounts() }, '새로 고침'),
        h('button', { type: 'button', class: 'icon-btn', id: 'accounts-close', 'aria-label': '닫기', disabled: accounts.busy, onclick: closeAccounts }, '×'),
      ),
    ),
    h('p', { id: 'accounts-message', class: accounts.error ? 'accounts-message error' : 'accounts-message', role: accounts.error ? 'alert' : 'status', hidden: !message }, message ?? ''),
    accountsTable(),
    accountsCreateForm(),
  );
}

$('#accounts-button').addEventListener('click', openAccounts);

// 창 안에서 Esc: 비밀번호를 바꾸는 중이면 그것부터 접고, 아니면 창을 닫는다.
$('#accounts-panel').addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || accounts.busy) return;
  e.stopPropagation();
  if (accounts.resetId !== null) cancelReset();
  else closeAccounts();
});

// 상세 정보 안에서 한글을 조합하는 중이면(IME) 상세 정보는 다시 그리지 않고 미뤄 둔다.
// 조합 중에 입력 칸을 새로 만들면 휴대폰 키보드에서 글자가 겹치거나 사라진다. 조합이 끝나면 그때 그린다.
let detailComposing = false;
let detailRenderPending = false;
$('#detail').addEventListener('compositionstart', () => {
  detailComposing = true;
});
function endDetailComposing() {
  detailComposing = false;
  if (!detailRenderPending) return;
  detailRenderPending = false;
  // compositionend 바로 뒤에 오는 input을 먼저 받게 한 박자 늦춘다.
  setTimeout(renderKeepingInput, 0);
}
$('#detail').addEventListener('compositionend', endDetailComposing);
// 조합 중이던 칸에서 초점이 빠지면 조합은 끝난 것이다(칸이 사라지거나 브라우저에 따라 compositionend가 안 올 수 있다).
$('#detail').addEventListener('focusout', () => {
  if (detailComposing) endDetailComposing();
});

function renderDetailUnlessComposing() {
  // 고른 장소가 바뀌었거나 상세 정보가 닫히는 경우, 초점이 상세 정보 밖에 있는 경우는 미루지 않는다.
  const shown = Number($('#detail').dataset.placeId);
  if (detailComposing && shown === state.selectedId && $('#detail').contains(document.activeElement)) {
    detailRenderPending = true;
    return;
  }
  detailRenderPending = false;
  renderDetail();
}

function render() {
  // 미션 저장으로 그 상태의 장소가 하나도 안 남으면 칩도 사라지므로, 아무 칩도 눌리지 않은 채 걸러지지 않게 전체로 되돌린다.
  if (state.filterColor && !state.places.some((p) => placeColor(p) === state.filterColor)) state.filterColor = null;
  const visible = visiblePlaces();
  renderFilters();
  renderList(visible);
  renderMarkers(visible);
  renderDetailUnlessComposing();
}

// ── 동작 ────────────────────────────────────────────────

function select(id, { pan = false } = {}) {
  if (id !== state.selectedId) {
    state.selectedMission = null;
    state.missionDraft = null;
    // 떠나는 장소의 메모가 이미 저장됐으면 초안을 지운다(다시 열 때 옛 "저장됨"이 남지 않게). 저장 중·실패한 것은 둔다.
    if (memoDrafts.get(state.selectedId)?.status === 'saved') discardMemo(state.selectedId);
  }
  state.selectedId = id;
  render();
  const p = state.places.find((x) => x.id === id);
  if (!p) return;
  if (pan) panToPlace(p);
  $('.panel').scrollTo({ top: 0, behavior: 'smooth' });
}

// 사람이 다른 장소를 고를 때 쓴다. 저장 안 한 미션 기록·메모가 버려지면 먼저 묻고, 그만두면 false.
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
function dropGonePlace(id) {
  state.places = state.places.filter((p) => p.id !== id);
  touchPlace(id);
  discardMemo(id);
  if (state.selectedId === id) select(null);
  else render();
  toast('이 장소는 다른 기기에서 삭제되었습니다.');
}

// render()는 상세 정보를 새로 만들므로, 사용자가 쓰고 있던 칸의 초점이 사라진다(휴대폰에서는 키보드까지 닫힌다).
// 그 칸을 기억해 두었다가 다시 그린 뒤 같은 칸에 커서·초점을 돌려놓는다.
// 값은 되돌려 넣지 않는다: 칸의 값은 상태(메모 초안·미션 초안, 없으면 서버 값)로 다시 그렸다. 옛 칸의 값을 넣으면
// 초안이 없는 메모 칸에 옛 메모가 남아, 그사이 받은 다른 기기의 메모를 이어 쓴 글로 덮어쓰게 된다.
function renderKeepingInput() {
  const el = document.activeElement;
  const form = el?.closest?.('#detail .mission-form');
  let selector = null;
  if (el?.matches?.('#detail .memo textarea')) selector = '#detail .memo textarea';
  else if (form && el.tagName === 'INPUT' && el.name) {
    selector = `#detail .mission-form[data-mission="${CSS.escape(form.dataset.mission)}"] input[name="${CSS.escape(el.name)}"]`;
  }
  const caret = selector && el.type !== 'checkbox' && { start: el.selectionStart, end: el.selectionEnd };

  render();
  if (!selector) return;
  const next = $(selector);
  // 같은 칸이 그대로 있으면(한글 조합 중이라 다시 그리지 않음 등) 손대지 않는다.
  if (!next || next === el) return;
  if (caret && caret.start != null) {
    const n = next.value.length;
    next.setSelectionRange(Math.min(caret.start, n), Math.min(caret.end ?? caret.start, n));
  }
  next.focus({ preventScroll: true });
}

// 다른 미션을 열거나 닫으면 고치던 값은 버린다. 아직 저장 안 한 미션은 바로 입력 화면으로 연다.
function toggleMission(name) {
  // 미션을 바꿀 때는 미션 초안만 묻는다(메모는 같은 장소라 그대로 둔다).
  if (!confirmDiscardMissionDraft()) return;
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

// 저장 중인 미션의 끊개. 저장 중 [취소]를 누르면 기다리기를 그만둔다.
const missionAborts = new Map();

// 서버 기록이 보낸 값과 같은지(남은 용량은 숫자로 맞춘 값끼리). 이름은 늘 저장한 사람이라 비교하지 않는다
// (서버가 저장자 아이디로 정해 기록해도 같은 저장으로 본다).
const sameMissionFields = (r, f) =>
  Boolean(r.done) === Boolean(f.done) &&
  ['flightTime', 'batteryNo', 'batteryLeft'].every((k) => String(r[k] ?? '').trim() === String(f[k] ?? '').trim());

// 저장 중 [취소]: 응답을 더 기다리지 않고 입력 화면으로 돌아온다(적던 값은 그대로, [다시 시도]로 다시 보낼 수 있다).
function stopMissionSave(id, name) {
  missionAborts.get(missionKey(id, name))?.abort();
}

// 고치던 다섯 칸을 한 번에 저장한다. 성공하면 보기 화면으로, 실패하면 적던 값을 그대로 둔 채 입력 화면에 남는다.
async function saveMissionDraft(id, name) {
  const place = state.places.find((p) => p.id === id);
  const key = missionKey(id, name);
  if (!place || missionSaving.has(key)) return;
  // 이름은 늘 지금 로그인한 아이디로 보낸다(사람이 바꿀 길이 없다).
  const draft = { ...missionDraftFor(place, name), worker: currentWorkerName() };
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
    worker: draft.worker,
    flightTime: draft.flightTime.trim(),
    batteryNo: draft.batteryNo.trim(),
    // "045"처럼 앞에 0을 붙여 적어도 45로 보낸다.
    batteryLeft: left ? String(Number(left)) : '',
  };
  // 저장 중에는 입력 칸이 잠기므로, 실패하면 초점을 돌려놓을 칸을 기억해 둔다.
  const focusedField = $(missionFormSelector(name))?.contains(document.activeElement) ? document.activeElement.name : null;
  const refocusForm = () => refocus(`${missionFormSelector(name)} ${focusedField ? `input[name="${focusedField}"]` : '.btn.primary'}`);
  // 앞서 남은 실패 안내는 다시 보낼 때 지운다.
  state.missionDraft = { ...draft, error: null };

  const abort = new AbortController();
  missionAborts.set(key, abort);
  missionSaving.add(key);
  renderKeepingInput();
  const epoch = authEpoch;
  let result;
  try {
    result = await api.saveMission(id, name, fields, draft.baseVersion ?? null, { signal: abort.signal });
  } catch (err) {
    missionSaving.delete(key);
    missionAborts.delete(key);
    // 세션이 끝났으면 로그인 화면으로 이미 넘어갔다.
    if (authFailed(err) || epoch !== authEpoch) return;
    if (isPlaceGone(err)) {
      dropGonePlace(id);
      return;
    }
    // 시간 초과·연결 실패·[취소]는 폼 안에 남겨 두고 [다시 시도]를 붙인다. 다른 오류(검증 등)는 알림만.
    const retry = Boolean(err.timeout || err.aborted || !err.status);
    if (retry && draftMatches(place, name)) state.missionDraft = { ...state.missionDraft, error: { message: err.message, retry: true } };
    renderKeepingInput();
    if (err.aborted) refocus(`${missionFormSelector(name)} .btn.primary`);
    else refocusForm();
    if (!err.aborted) toast(err.message);
    return;
  }
  missionSaving.delete(key);
  missionAborts.delete(key);
  if (epoch !== authEpoch) return;

  // 시간 초과·[취소]로 끊긴 앞 저장이 사실은 들어갔던 경우: 최신 기록이 지금 보낸 값과 같으면 저장된 것으로 본다.
  if (result?.status === 'conflict' && result.record && sameMissionFields(result.record, fields)) {
    result = { status: 'ok', record: result.record };
  }
  if (result?.status === 'conflict') {
    // 다른 기기가 먼저 저장했다. 적던 값은 그대로 두고, 최신 기록을 바탕으로 다시 저장할 수 있게 판을 맞춘다.
    // 알림 대신 폼 안의 고정 안내([최신값 불러오기]/[내 값으로 덮어쓰기])로 알린다.
    const latest = result.record ?? null;
    const p = state.places.find((x) => x.id === id);
    if (latest) setMissionRecord(id, latest);
    else if (p) replacePlace({ ...p, missions: (p.missions ?? []).filter((m) => m.mission !== name) });
    if (state.missionDraft?.placeId === id && state.missionDraft.mission === name) {
      state.missionDraft = { ...state.missionDraft, baseVersion: latest?.version ?? null, conflict: latest, error: null };
    }
    renderKeepingInput();
    refocusForm();
    return;
  }

  setMissionRecord(id, result.record);
  rememberOwnWrite({ placeId: id, mission: name, version: result.record?.version });
  // 저장하는 사이 다른 미션으로 옮겨 갔으면 그쪽에서 쓰는 값은 건드리지 않는다.
  if (state.missionDraft?.placeId === id && state.missionDraft.mission === name) state.missionDraft = null;
  const hadFocus = $(missionFormSelector(name))?.contains(document.activeElement);
  renderKeepingInput();
  if (hadFocus || document.activeElement === document.body) refocus(`${missionViewSelector(name)} .btn.edit`);
  toast('미션 기록을 저장했습니다.');
}

// ── 메모: 입력 후 1초 뒤 저절로 저장 ─────────────────────────

async function removePlace(place) {
  if (!confirmDiscardDraft()) return;
  // 미션 기록도 함께 지워지므로 몇 건인지 같이 알린다.
  const records = place.missions?.length ?? 0;
  const question = `"${place.name}"을(를) 삭제할까요?${records > 0 ? `\n미션 기록 ${records}건도 함께 삭제됩니다.` : ''}`;
  if (!confirm(question)) return;
  const epoch = authEpoch;
  try {
    const removed = await api.deletePlace(place.id);
    if (epoch !== authEpoch) return;
    if (!removed) {
      dropGonePlace(place.id);
      return;
    }
    state.places = state.places.filter((p) => p.id !== place.id);
    touchPlace(place.id);
    discardMemo(place.id);
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
  state.importFiles = files;
  state.importSkipped = all.filter((f) => !isCsvFile(f)).map((f) => ({ name: f.name, reason: 'CSV 파일이 아닙니다' }));
  state.importResults = null;
  state.importReview = null;
  renderImport();
  $('.panel').scrollTo({ top: 0, behavior: 'smooth' });
}

// 서버가 받던 크기 제한(10MB)을 그대로 지킨다. 너무 큰 파일은 브라우저에서 읽기 전에 막는다.
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const EMPTY_COUNTS = { imported: 0, duplicates: 0, updated: 0, missionChanged: 0 };

// 파일 하나를 브라우저에서 읽는다(readPlaces → { columns, total, places, errors, warnings? }).
// 실패하면 화면에 그대로 보여 줄 한국어 문구를 담은 Error를 던진다.
async function readImportFile(file) {
  if (file.size === 0) throw new Error('CSV 파일 내용이 없습니다.');
  if (file.size > MAX_IMPORT_BYTES) throw new Error('CSV 파일이 너무 큽니다. (최대 10MB)');
  let bytes;
  try {
    bytes = await file.arrayBuffer();
  } catch (err) {
    // 고른 뒤 파일이 지워지거나 바뀐 경우
    api.logCause('파일 읽기 실패', err);
    throw new Error('파일을 읽지 못했습니다. 다시 골라 주세요.', { cause: err });
  }
  try {
    return csv.readPlaces(bytes);
  } catch (err) {
    if (err instanceof csv.CsvFormatError) throw err;
    api.logCause('CSV 읽기 실패', err);
    throw new Error('CSV 파일을 읽지 못했습니다.', { cause: err });
  }
}

// 읽은 장소만 import_places로 보낸다. 결과는 예전 서버 응답과 같은 모양이다.
async function sendImportFile(parsed) {
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

// 가져오기 전에 확인받을 것(계약 C7): 행 경고, 같은 이름·시군인데 좌표가 다른 기존 장소(근접 중복), 미션명이 바뀌는 기존 장소.
// csv.js에 탐지 함수가 아직 없으면 그 항목은 건너뛴다. 확인할 것이 없으면 null.
function importReview(parsedFiles) {
  const multi = parsedFiles.length > 1;
  const existing = state.places;
  const warnings = [];
  const near = [];
  const changes = [];
  for (const { file, parsed } of parsedFiles) {
    if (!parsed) continue;
    const tag = (item) => ({ ...item, file: multi ? file.name : null });
    for (const w of parsed.warnings ?? []) warnings.push(tag(w));
    try {
      if (typeof csv.nearDuplicates === 'function') for (const n of csv.nearDuplicates(parsed.places, existing)) near.push(tag(n));
      if (typeof csv.missionChanges === 'function') for (const c of csv.missionChanges(parsed.places, existing)) changes.push(tag(c));
    } catch (err) {
      api.logCause('가져오기 전 확인(근접 중복·미션명 변경) 실패 — 확인 없이 진행', err);
    }
  }
  return warnings.length || near.length || changes.length ? { warnings, near, changes } : null;
}

// 파일을 하나씩 읽고, 확인할 것이 있으면 멈춰 묻고, 없으면 바로 보낸다.
async function runImport() {
  const files = state.importFiles;
  if (!files?.length || state.importing) return;
  const epoch = authEpoch;
  state.importing = true;
  state.importProgress = 0;
  state.importReview = null;
  renderImport();
  const parsedFiles = [];
  for (const file of files) {
    try {
      parsedFiles.push({ file, parsed: await readImportFile(file) });
    } catch (err) {
      parsedFiles.push({ file, error: err.message });
    }
    if (epoch !== authEpoch) return;
  }
  // 그사이 창을 닫았으면(처음 화면으로 등) 그만둔다.
  if (state.importFiles !== files) {
    state.importing = false;
    renderImport();
    return;
  }
  const single = files.length === 1 && state.importSkipped.length === 0;
  // 파일 하나가 읽히지 않으면 예전처럼 알림만 띄우고 [가져오기] 화면에 남는다.
  if (single && parsedFiles[0].error) {
    state.importing = false;
    renderImport();
    toast(parsedFiles[0].error);
    return;
  }
  const review = importReview(parsedFiles);
  if (review) {
    state.importing = false;
    state.importReview = { parsed: parsedFiles, ...review };
    renderImport();
    // 기록이 화면에서 빠질 수 있는 미션명 변경이 있으면 [취소]에 먼저 초점을 둔다.
    refocus(review.changes.length > 0 ? '#import-review-cancel' : '#import-review-continue');
    return;
  }
  await sendImport(parsedFiles, epoch);
}

// 확인 화면의 [계속]
function continueImport() {
  const review = state.importReview;
  if (!review || state.importing) return;
  state.importReview = null;
  sendImport(review.parsed, authEpoch);
}

// 확인 화면의 [취소]: 아무것도 보내지 않고 파일 목록 화면으로 돌아간다.
function cancelImportReview() {
  if (!state.importReview) return;
  state.importReview = null;
  renderImport();
  refocus('#import-panel .btn.primary');
}

// 읽은 파일을 차례로 보낸다. 한 파일이 실패해도 나머지는 계속하고, 끝나면 장소를 한 번만 새로 받는다.
async function sendImport(parsedFiles, epoch) {
  const files = state.importFiles;
  if (!files || epoch !== authEpoch) return;
  state.importing = true;
  setRemoteChangedWhileImporting(false);
  const wasEmpty = state.places.length === 0;
  const results = [];
  for (const [i, item] of parsedFiles.entries()) {
    state.importProgress = i + 1;
    renderImport();
    if (item.error) {
      results.push({ file: item.file, error: item.error });
      continue;
    }
    try {
      results.push({ file: item.file, result: await sendImportFile(item.parsed) });
    } catch (err) {
      // 세션이 끝났으면 로그인 화면으로 넘어가며 가져오기 창도 닫힌다.
      if (authFailed(err) || epoch !== authEpoch) return;
      results.push({ file: item.file, error: err.message });
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
  // 가져오는 동안 온 실시간 알림을 이제 처리한다(가져온 뒤 받은 목록과 같은 내용이면 다시 받지 않는다).
  if (remoteChangedWhileImporting) {
    setRemoteChangedWhileImporting(false);
    flushRemote();
  }
}

// ── 목록 받기·실시간 반영 ────────────────────────────────

// 다른 앱에 오래(1분 이상) 가 있다 돌아오면 실시간 연결이 끊겼을 수 있어 한 번 다시 받는다.
// 잠깐 다녀온 것(길찾기 앱 확인 등)은 연결이 그대로라 다시 받지 않는다. 약한 인터넷에서 전체 목록을 자주 받지 않게 한다.
const STALE_AFTER_HIDDEN_MS = 60000;
let hiddenAt = null;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    // 화면을 벗어나면(앱 전환·잠금) 기다리던 메모를 바로 저장한다.
    flushAllMemos();
    return;
  }
  if (hiddenAt !== null && Date.now() - hiddenAt >= STALE_AFTER_HIDDEN_MS) refreshPlaces();
  hiddenAt = null;
  checkVersion();
});
// 페이지를 떠날 때도(새로고침·탭 닫기) 기다리던 메모를 저장해 본다.
window.addEventListener('pagehide', () => flushAllMemos());

// 목록·지도·칩만 다시 그린다(상세 정보의 입력 칸은 건드리지 않는다). 메모 저장 뒤 등에 쓴다.
function renderListAndMap() {
  const visible = visiblePlaces();
  renderFilters();
  renderList(visible);
  renderMarkers(visible);
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
  const blob = new Blob([csv.toCsv(state.places)], { type: 'text/csv;charset=utf-8' });
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

// Esc: 미션 기록을 고치는 중이면 먼저 [취소], 그다음 Esc에 상세 정보를 닫는다.
// 미션 입력 칸 안에서는 아무것도 안 고쳤을 때만 취소한다(적던 값을 실수로 날리지 않게). 다른 입력 칸에서는 아무것도 안 한다.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || state.selectedId === null) return;
  const inField = e.target.closest?.('input, textarea, select');
  const p = state.places.find((x) => x.id === state.selectedId);
  const d = state.missionDraft;
  if (p && d && draftMatches(p, state.selectedMission)) {
    if (inField && (!e.target.closest('.mission-form') || missionDraftDirty())) return;
    if (missionSaving.has(missionKey(p.id, d.mission))) return;
    if (!confirmDiscardMissionDraft()) return;
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

// ── 처음 화면 ───────────────────────────────────────────

// 제목을 누르면 처음 화면으로 돌아간다: 선택·검색·필터·가져오기 창을 모두 닫고 지도를 전체 장소에 맞춘다.
// 새로고침과 달리 다시 받지 않으므로 바로 바뀐다.
function goHome() {
  if (!confirmDiscardDraft()) return;
  clearTimeout(searchTimer);
  searchTimer = null;
  state.selectedId = null;
  state.selectedMission = null;
  state.missionDraft = null;
  state.filterColor = null;
  state.query = '';
  state.importFiles = null;
  state.importSkipped = [];
  state.importResults = null;
  state.importReview = null;
  // 처음 화면은 시군을 모두 접은 상태다.
  collapseAllGroups();
  // 계정 관리 창도 닫는다(요청 중이면 끝날 때까지 둔다).
  if (accounts.open && !accounts.busy) accountsReset();
  $('#search').value = '';
  renderImport();
  renderAccounts();
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

function enterApp(session) {
  const user = session.user;
  if (currentUser?.id === user.id) {
    // 토큰을 새로 받은 것 등. 화면은 그대로 둔다.
    currentUser.email = user.email ?? '';
    currentUser.name = displayName(user);
    currentUser.admin = api.isAdmin(user);
    showUserName();
    // 관리자 권한이 빠진 토큰을 받았으면 열려 있던 계정 관리 창도 닫는다.
    if (!currentUser.admin && accounts.open) {
      accountsReset();
      renderAccounts();
    }
    return;
  }
  if (currentUser) leaveApp(null);
  bumpAuthEpoch();
  setCurrentUser({ id: user.id, email: user.email ?? '', name: displayName(user), admin: api.isAdmin(user) });
  showUserName();
  // 로그인 폼에서 왔으면 초점이 숨는 칸에 남지 않게 제목으로 옮긴다(저장된 세션으로 바로 열 때는 건드리지 않는다).
  const fromLogin = $('#login').contains(document.activeElement);
  setLoginError(null);
  setLoginNotice(null);
  $('#login-form').reset();
  setLoginPasswordShown(false);
  // 목록을 받기 전에 "불러오는 중…"으로 그려 두고 나서 앱을 보인다. 앞 사람 화면·"저장한 장소가 없습니다"가 잠깐 비치지 않게 한다.
  state.loading = true;
  state.loadError = null;
  state.loaded = false;
  render();
  showView('app');
  if (fromLogin) refocus('#home-link');

  // 지도는 처음 로그인할 때 만든다(칸이 보여야 크기를 제대로 잡는다). 앞서 실패했으면 다시 해 본다. 그동안에도 목록은 먼저 그린다.
  startMap();
  unsubscribeChanges = api.subscribeChanges(onRemoteChange);
  loadPlaces({ fit: true });
}

// 로그인 화면으로 돌아간다. 다음 사람에게 앞 사람의 화면(목록·고르던 장소·적던 기록)이 남지 않게 모두 비운다.
// errorMessage는 빨간 오류 칸에, notice는 보통 안내 칸에 보인다.
function leaveApp(errorMessage, { notice = null } = {}) {
  if (signedIn()) {
    bumpAuthEpoch();
    setCurrentUser(null);
    unsubscribeChanges?.();
    unsubscribeChanges = null;
    resetSync();
    clearTimeout(searchTimer);
    searchTimer = null;
    for (const ctrl of missionAborts.values()) ctrl.abort();
    missionAborts.clear();
    missionSaving.clear();
    for (const id of [...memoDrafts.keys()]) discardMemo(id);
    Object.assign(state, {
      places: [],
      loading: false,
      loadError: null,
      loaded: false,
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
      importReview: null,
    });
    collapseAllGroups();
    accountsReset();
    $('#search').value = '';
    showUserName();
    renderImport();
    renderAccounts();
    render();
  }
  if (errorMessage) setLoginError(errorMessage);
  if (notice) setLoginNotice(notice);
  setLoginPasswordShown(false);
  showView('login');
  if (!$('#login').contains(document.activeElement)) $('#login-id').focus();
}

let loginBusy = false;
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (loginBusy) return;
  const idText = $('#login-id').value.trim();
  const password = $('#login-password').value;
  setLoginNotice(null);
  if (!idText || !password) {
    const field = idText ? 'password' : 'id';
    setLoginError('아이디와 비밀번호를 입력해 주세요.', field);
    $(`#login-${field}`).focus();
    return;
  }
  // 아이디를 Supabase 로그인용 이메일로 바꾼다('@'가 있으면 이메일 그대로). 규칙에 어긋나면 서버에 보내지 않는다.
  let email;
  try {
    email = loginId.loginIdToEmail(idText);
  } catch {
    setLoginError(loginId.LOGIN_ID_RULE, 'id');
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
  setLoggingOut(true);
  const button = $('#logout-button');
  button.disabled = true;
  button.textContent = '로그아웃 중…';
  const restore = () => {
    setLoggingOut(false);
    button.disabled = false;
    button.textContent = '로그아웃';
  };
  // 기다리던·저장 중인 메모를 끝까지 저장한다(저장하는 사이 더 친 글까지). 그래도 남으면 버릴지 묻는다.
  await saveAllMemos();
  if (anyUnsavedMemo() && !confirm('저장하지 못한 메모가 있습니다. 버리고 로그아웃할까요?')) {
    restore();
    return;
  }
  try {
    // 로그아웃 기록은 세션이 살아 있을 때 남겨야 하므로 signOut 전에 부른다. 실패하거나 2초가 넘으면 그냥 넘어간다.
    // (세션 만료·다른 창 로그아웃으로 내보낼 때는 이 버튼을 거치지 않으므로 기록하지 않는다.)
    await api.logLogout();
    await api.signOut();
  } catch (err) {
    // 이 기기의 세션만 지우는 것이라 실패해도 화면은 로그인으로 돌린다.
    api.logCause('로그아웃 요청 실패(화면은 로그인으로 돌림)', err);
  } finally {
    restore();
  }
  leaveApp(null);
});

// ── 연결 상태·새 버전·좁은 높이 ─────────────────────────────

// 인터넷이 끊기면 화면 위에 띠를 보인다. 다시 붙으면 띠를 숨기고, 실패했던 지도·메모·목록을 다시 해 본다.
function syncOnline() {
  $('#offline-band').hidden = navigator.onLine !== false;
}
window.addEventListener('offline', syncOnline);
window.addEventListener('online', () => {
  syncOnline();
  if (!signedIn()) return;
  if (mapState === 'failed') startMap();
  retryFailedMemos();
  if (state.loadError) loadPlaces({ fit: !state.loaded });
});
syncOnline();

// 새 배포 알림(계약 C8): 빌드가 config.js에 window.APP_BUILD를 넣어 둔 경우에만, 탭이 다시 보일 때와 10분마다
// ./version.json을 받아 빌드가 다르면 "새 버전이 있습니다 [새로고침]" 띠를 보인다.
const APP_BUILD = typeof window.APP_BUILD === 'string' && window.APP_BUILD.trim() ? window.APP_BUILD.trim() : null;
const VERSION_CHECK_MS = 10 * 60 * 1000;
let versionChecking = false;
async function checkVersion() {
  if (!APP_BUILD || versionChecking || !$('#update-banner').hidden) return;
  versionChecking = true;
  try {
    const res = await fetch('./version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const build = (await res.json())?.build;
    if (typeof build === 'string' && build.trim() && build.trim() !== APP_BUILD) $('#update-banner').hidden = false;
  } catch (err) {
    api.logCause('새 버전 확인 실패', err);
  } finally {
    versionChecking = false;
  }
}
if (APP_BUILD) setInterval(checkVersion, VERSION_CHECK_MS);
$('#update-reload').addEventListener('click', async () => {
  if (!confirmDiscardMissionDraft()) return;
  await saveAllMemos();
  if (anyUnsavedMemo() && !confirm('저장하지 못한 메모가 있습니다. 버리고 새로고침할까요?')) return;
  leavingOnPurpose = true;
  location.reload();
});

// 탭을 닫거나 새로고침할 때 저장하지 않은 것이 있으면 브라우저가 한 번 묻게 한다(휴대폰 브라우저는 묻지 않을 수 있다).
// 기다리던 메모는 이때 바로 저장을 시작한다.
let leavingOnPurpose = false;
window.addEventListener('beforeunload', (e) => {
  if (!signedIn() || leavingOnPurpose) return;
  flushAllMemos();
  if (missionDraftDirty() || anyUnsavedMemo()) {
    e.preventDefault();
    e.returnValue = '';
  }
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

boot().catch((err) => {
  api.logCause('시작 실패', err);
  showBootMessage(err.message);
});
