// 장소 목록 받기(전체·일부, 한 번에 하나씩 차례로)와 실시간 알림 반영(계약 C2·C3: 바뀐 장소만 다시 받기).
import { toast } from './dom.js';
import { findPlace, hooks, localSeq, localTouch, ownWrites, state, touchPlace, touchedSince } from './state.js';
import { authEpoch, authFailed, signedIn } from './session.js';
import { discardMemo, memoDrafts } from './memo-ui.js';
import { fitToPlaces } from './map-ui.js';
import { missionNames } from './mission.js';
import * as api from './api.js';

// 다시 그리기는 app.js에 있어 hooks로 부른다.
const render = (...args) => hooks.render(...args);
const renderKeepingInput = (...args) => hooks.renderKeepingInput(...args);

// 받은 장소 목록을 넣고 뒷정리한다: 고른 장소·미션·적던 초안이 아직 유효한지 보고, 없어진 장소의 메모 초안은 버린다.
// 전체 받기(applyPlaces)와 일부 받기(applyPartial)가 함께 쓴다.
function commitPlaces(places) {
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
  if (memoDrafts.size > 0) {
    const ids = new Set(places.map((x) => x.id));
    for (const id of [...memoDrafts.keys()]) if (!ids.has(id)) discardMemo(id);
  }
  renderKeepingInput();
  if (hadSelection && state.selectedId === null) toast('이 장소는 다른 기기에서 삭제되었습니다.');
}

// 전체 목록으로 바꾼다. 받았으니 "불러오는 중…"·실패 안내는 지운다.
function applyPlaces(places) {
  state.loaded = true;
  state.loading = false;
  state.loadError = null;
  commitPlaces(places);
}

// 몇 곳만 다시 받은 결과를 끼워 넣는다. ids 중 결과에 없는 장소는 지워진 것이다. 목록은 서버와 같은 id 순서를 지킨다.
function applyPartial(ids, fetched) {
  const byId = new Map(fetched.map((p) => [p.id, p]));
  const known = new Set(state.places.map((p) => p.id));
  const next = state.places.filter((p) => !ids.has(p.id) || byId.has(p.id)).map((p) => byId.get(p.id) ?? p);
  for (const p of fetched) if (!known.has(p.id)) next.push(p);
  next.sort((a, b) => a.id - b.id);
  commitPlaces(next);
}

// 전체 받기 결과를 넣는다. 받기를 시작한 뒤(since) 화면이 바꾼 장소는 화면 값을 두고(지운 장소는 되살리지 않고) 곧 다시 받는다.
function applyFetchedAll(places, since) {
  const skip = touchedSince(since);
  if (skip.size > 0) {
    const local = state.places.filter((p) => skip.has(p.id));
    places = [...places.filter((p) => !skip.has(p.id)), ...local].sort((a, b) => a.id - b.id);
    refetchSoon(local.map((p) => p.id));
  }
  applyPlaces(places);
}

// 일부 받기 결과를 넣는다. 규칙은 applyFetchedAll과 같다.
function applyFetchedSome(ids, places, since) {
  const skip = touchedSince(since);
  if (skip.size > 0) {
    refetchSoon([...ids].filter((id) => skip.has(id) && findPlace(id)));
    ids = new Set([...ids].filter((id) => !skip.has(id)));
    places = places.filter((p) => !skip.has(p.id));
  }
  applyPartial(ids, places);
}

// 이 장소들을 곧(300ms 뒤) 다시 받는다. 실시간 알림과 같은 길로 모은다.
function refetchSoon(ids) {
  if (ids.length === 0) return;
  for (const id of ids) remote.changes.push({ table: 'places', type: 'REFETCH', placeId: id, removed: false, row: null });
  clearTimeout(realtimeTimer);
  realtimeTimer = setTimeout(flushRemote, REALTIME_DEBOUNCE_MS);
}

// 목록 받기(전체·일부)는 한 번에 하나씩 차례로 한다. 겹치면 늦게 끝난 오래된 결과가 새 결과를 덮을 수 있다.
let fetchChain = Promise.resolve();
function queueFetch(task) {
  const run = fetchChain.then(task);
  fetchChain = run.catch(() => {
    // 실패는 부른 쪽이 run으로 받는다. 줄은 끊기지 않게 한다.
  });
  return run;
}

// 장소 전체를 다시 받아 반영한다. 그사이 로그아웃했으면 버린다. 반영했으면 true.
// 같은 로그인에서 아직 시작하지 않은 전체 받기가 줄에 있으면 그것을 같이 기다린다(같은 목록을 두 번 받지 않게).
let lastRefreshAt = 0;
let queuedReload = null; // { epoch, run }
export function reloadPlaces() {
  if (queuedReload?.epoch === authEpoch) return queuedReload.run;
  const epoch = authEpoch;
  const entry = { epoch, run: null };
  entry.run = queueFetch(async () => {
    if (queuedReload === entry) queuedReload = null;
    if (epoch !== authEpoch) return false;
    lastRefreshAt = Date.now();
    const since = localSeq;
    const places = await api.listPlaces();
    if (epoch !== authEpoch) return false;
    applyFetchedAll(places, since);
    return true;
  });
  queuedReload = entry;
  return entry.run;
}

// 로그인 직후·[다시 시도]: "불러오는 중…"을 보이며 전체를 받는다. 실패하면 목록 위에 고정 안내와 [다시 시도].
export async function loadPlaces({ fit = false } = {}) {
  if (!signedIn()) return;
  const epoch = authEpoch;
  state.loading = true;
  state.loadError = null;
  render();
  try {
    if ((await reloadPlaces()) && fit && epoch === authEpoch) fitToPlaces(state.places);
  } catch (err) {
    if (authFailed(err) || epoch !== authEpoch) return;
    api.logCause('장소 목록 받기 실패', err);
    state.loading = false;
    state.loadError = err.timeout ? '응답이 없습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.' : err.message;
    render();
  }
}

// 전체를 다시 받는다(실시간 재연결·일부 받기 실패·오래 자리를 비운 뒤). 너무 자주 받지 않게 force가 아니면 5초에 한 번까지만.
// 가져오는 중에는 끝날 때 한 번 받으므로 건너뛴다.
const REFRESH_INTERVAL_MS = 5000;
// 가져오는 중에 온 실시간 알림. 가져오기가 끝나면 모아 둔 알림을 처리한다.
export let remoteChangedWhileImporting = false;
export async function refreshPlaces({ force = false } = {}) {
  if (!signedIn()) return;
  if (state.importing) {
    if (force) {
      remote.full = true;
      remoteChangedWhileImporting = true;
    }
    return;
  }
  if (!force && Date.now() - lastRefreshAt < REFRESH_INTERVAL_MS) return;
  try {
    await reloadPlaces();
  } catch (err) {
    // 잠깐 연결이 끊긴 경우 등은 화면을 그대로 두고 다음 알림·재연결 때 다시 받는다. 세션이 끝났으면 로그인 화면으로.
    if (!authFailed(err)) api.logCause('장소 목록 다시 받기 실패', err);
  }
}

// 실시간 알림: 300ms 동안 오는 알림을 모아, 바뀐 장소만 get_places로 다시 받는다(계약 C2).
// - places 알림은 그 장소 id, missions 알림은 place_id. 지운 장소(DELETE·deleted_at)는 받지 않고 바로 뺀다(계약 C3).
// - 알림의 값이 화면에 있는 값과 같으면(내가 방금 저장한 변경 등) 건너뛴다.
// - 어느 장소인지 모르는 알림·재연결·일부 받기 실패 때만 전체를 다시 받는다.
const REALTIME_DEBOUNCE_MS = 300;
// 한 번에 일부만 받을 장소 수. 이보다 많이 바뀌면(다른 기기의 대량 가져오기 등) 전체를 받는다.
const PARTIAL_MAX = 200;
let realtimeTimer = null;
const remote = { changes: [], full: false };

export function onRemoteChange(change) {
  if (!signedIn()) return;
  if (!change || change.resync || change.placeId == null) remote.full = true;
  else remote.changes.push(change);
  clearTimeout(realtimeTimer);
  realtimeTimer = setTimeout(flushRemote, REALTIME_DEBOUNCE_MS);
}

// 알림의 새 값이 화면에 있는 값과 같으면 true. 알림에 없는 칸이 있으면 모르는 것으로 보고 다시 받는다.
const PLACE_COLUMNS = ['name', 'district', 'address', 'phone', 'memo', 'mission', 'lat', 'lng'];
function placeRowMatches(row) {
  const p = row && findPlace(row.id);
  return Boolean(p) && PLACE_COLUMNS.every((k) => k in row && row[k] === p[k]);
}
const MISSION_COLUMNS = [
  ['done', 'done'],
  ['worker', 'worker'],
  ['flight_time', 'flightTime'],
  ['battery_no', 'batteryNo'],
  ['battery_left', 'batteryLeft'],
  ['version', 'version'],
];
function missionRowMatches({ placeId, row }) {
  const r = row && findPlace(placeId)?.missions?.find((m) => m.mission === row.mission);
  return Boolean(r) && MISSION_COLUMNS.every(([col, key]) => col in row && row[col] === r[key]);
}

// 알림이 내가 방금 저장한 변경(state.js의 ownWrites)이면 그 기록을 지우고 true.
function takeOwnWrite(c) {
  const i = ownWrites.findIndex((w) =>
    w.placeId === c.placeId && c.row &&
    (c.table === 'places'
      ? Boolean(w.place) && PLACE_COLUMNS.every((k) => k in c.row && c.row[k] === w.place[k])
      : w.mission === c.row.mission && w.version === c.row.version),
  );
  if (i < 0) return false;
  ownWrites.splice(i, 1);
  return true;
}

export async function flushRemote() {
  clearTimeout(realtimeTimer);
  realtimeTimer = null;
  if (!signedIn()) return;
  // 가져오는 중이면 끝날 때 처리한다(모아 둔 알림은 그대로 둔다).
  if (state.importing) {
    remoteChangedWhileImporting = true;
    return;
  }
  const { full, changes } = remote;
  remote.full = false;
  remote.changes = [];
  if (full) {
    await refreshPlaces({ force: true });
    return;
  }
  const fetchIds = new Set();
  const removedIds = new Set();
  for (const c of changes) {
    if (c.table === 'places' && c.removed) {
      removedIds.add(c.placeId);
      fetchIds.delete(c.placeId);
    } else if (takeOwnWrite(c) || (c.table === 'places' ? placeRowMatches(c.row) : missionRowMatches(c))) {
      continue;
    } else {
      fetchIds.add(c.placeId);
      removedIds.delete(c.placeId);
    }
  }
  const gone = new Set([...removedIds].filter((id) => findPlace(id)));
  if (gone.size > 0) {
    for (const id of gone) touchPlace(id);
    commitPlaces(state.places.filter((p) => !gone.has(p.id)));
  }
  if (fetchIds.size === 0) return;
  if (fetchIds.size > PARTIAL_MAX) {
    await refreshPlaces({ force: true });
    return;
  }
  const epoch = authEpoch;
  try {
    await queueFetch(async () => {
      if (epoch !== authEpoch) return;
      const since = localSeq;
      const { places, complete } = await api.getPlaces([...fetchIds]);
      if (epoch !== authEpoch) return;
      if (complete) applyFetchedAll(places, since);
      else applyFetchedSome(fetchIds, places, since);
    });
  } catch (err) {
    if (authFailed(err) || epoch !== authEpoch) return;
    api.logCause('바뀐 장소만 받지 못해 전체를 다시 받습니다.', err);
    await refreshPlaces({ force: true });
  }
}

// 가져오기(import-ui.js)가 시작할 때·끝날 때 "가져오는 중에 온 알림" 표시를 바꾼다.
export const setRemoteChangedWhileImporting = (value) => {
  remoteChangedWhileImporting = value;
};

// 로그아웃할 때 받기·실시간 상태를 모두 비운다.
export function resetSync() {
  clearTimeout(realtimeTimer);
  realtimeTimer = null;
  remote.changes = [];
  remote.full = false;
  remoteChangedWhileImporting = false;
  ownWrites.length = 0;
  // 앞 로그인의 받기가 새 로그인의 받기를 기다리게 하거나 재사용되지 않게 줄을 새로 만든다(늦게 온 결과는 epoch로 버린다).
  fetchChain = Promise.resolve();
  queuedReload = null;
  localTouch.clear();
}
