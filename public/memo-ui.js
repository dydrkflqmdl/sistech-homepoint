// 상세 정보의 메모: 입력 후 1초 뒤 자동 저장, 바로 저장(칸 떠남·화면 숨김·떠나기 전), 상태 줄, 실패·충돌(C1) 처리.
import { $, fill, h, refocus, toast } from './dom.js';
import { findPlace, hooks, isPlaceGone, mergePlace, rememberOwnWrite, state } from './state.js';
import { authEpoch, authFailed } from './session.js';
import * as api from './api.js';

// 위쪽 모듈(app.js·detail-ui.js)의 함수는 hooks로 부른다.
const dropGonePlace = (...args) => hooks.dropGonePlace(...args);
const renderListAndMap = (...args) => hooks.renderListAndMap(...args);

// 장소마다 초안을 둔다: { text(적은 글), base(고치기 시작할 때 서버 메모), status, error, latest, timer, promise, again }
// status: 'dirty'(1초 기다리는 중) | 'saving' | 'saved' | 'error'(저장 안 됨) | 'conflict'(다른 기기에서 바뀜)
// 저장이 끝난(saved) 초안도 상태 표시("저장됨")를 위해 남겨 두고, 장소를 떠나면 지운다.
const MEMO_SAVE_DELAY_MS = 1000;
export const memoDrafts = new Map();

// 화면에 보여 줄 메모: 아직 서버에 안 들어간 글이 있으면 그것, 아니면 서버 값.
export function memoText(p) {
  const d = memoDrafts.get(p.id);
  return d && d.status !== 'saved' ? d.text : p.memo;
}

// 이 장소에 버리면 사라질 메모가 있는지(저장 실패·충돌). 입력 직후(dirty)·저장 중은 곧 저장되므로 묻지 않는다.
export const memoUnsaved = (id) => ['error', 'conflict'].includes(memoDrafts.get(id)?.status);

function memoDraftFor(id) {
  let d = memoDrafts.get(id);
  if (!d) {
    const p = findPlace(id);
    d = { text: p?.memo ?? '', base: p?.memo ?? '', status: 'saved', error: null, latest: null, timer: null, promise: null, again: false };
    memoDrafts.set(id, d);
  }
  return d;
}

export function discardMemo(id) {
  const d = memoDrafts.get(id);
  if (!d) return;
  clearTimeout(d.timer);
  memoDrafts.delete(id);
}

// 메모 아래 상태 줄: "입력 중…" / "저장 중…" / "저장됨" / "저장 안 됨 [다시 저장]" / 충돌 안내.
export function memoStatusView(id) {
  const d = memoDrafts.get(id);
  if (!d) return null;
  if (d.status === 'dirty') return h('span', { class: 'memo-state' }, '입력 중…');
  if (d.status === 'saving') return h('span', { class: 'memo-state' }, '저장 중…');
  if (d.status === 'saved') return h('span', { class: 'memo-state saved' }, '저장됨');
  if (d.status === 'error') {
    return [
      h('span', { class: 'memo-state error' }, '저장 안 됨'),
      d.error && h('span', { class: 'memo-reason' }, d.error),
      h('button', { type: 'button', class: 'btn small memo-retry', onclick: () => saveMemoNow(id) }, '다시 저장'),
    ];
  }
  return h(
    'div',
    { class: 'memo-conflict', role: 'alert' },
    h('p', { class: 'memo-conflict-message' }, '다른 기기에서 메모가 바뀌었습니다.'),
    h('p', { class: 'memo-latest' }, `최신 메모: ${d.latest?.trim() ? d.latest : '(비어 있음)'}`),
    h(
      'div',
      { class: 'button-row' },
      h('button', { type: 'button', class: 'btn small memo-take-latest', onclick: () => takeLatestMemo(id) }, '최신 메모 보기'),
      h('button', { type: 'button', class: 'btn small memo-keep-mine', onclick: () => keepMyMemo(id) }, '내 메모로 저장'),
    ),
  );
}

// 상태 줄만 바꾼다(입력 칸은 그대로 두어 한글 조합·커서가 끊기지 않게). 같은 상태면 건드리지 않는다.
function syncMemoStatus(id) {
  if (state.selectedId !== id) return;
  const box = $('#memo-status');
  const d = memoDrafts.get(id);
  const key = d ? `${d.status}|${d.error ?? ''}|${d.latest ?? ''}` : '';
  if (!box || box.dataset.key === key) return;
  box.dataset.key = key;
  fill(box, memoStatusView(id));
}

// 글자를 칠 때마다: 초안에 적고 1초 뒤 저장을 예약한다.
export function onMemoInput(id, text) {
  const d = memoDraftFor(id);
  // 저장이 끝난 초안이면 칸에는 지금 서버 메모가 보이고 있었다. 그것을 바탕으로 고치기 시작한 것이다.
  if (d.status === 'saved') d.base = findPlace(id)?.memo ?? d.base;
  d.text = text;
  // 충돌 중에는 사람이 고르기 전까지 저절로 저장하지 않는다(적던 글은 계속 고칠 수 있다).
  if (d.status === 'conflict') return;
  clearTimeout(d.timer);
  if (d.status === 'saving') {
    d.again = true;
    return;
  }
  d.status = 'dirty';
  d.timer = setTimeout(() => saveMemoNow(id), MEMO_SAVE_DELAY_MS);
  syncMemoStatus(id);
}

// 기다리던 메모를 지금 바로 저장한다(칸을 떠날 때·화면을 벗어날 때·장소를 떠날 때). text를 주면 그 글로 맞춘다.
// 저장에 실패했거나(error) 충돌 중(conflict)인 메모는 여기서 다시 보내지 않는다. 떠나기 전에 버릴지 묻고([다시 저장]은 사람이 누른다).
export function flushMemo(id, text) {
  if (id == null) return;
  if (text !== undefined) {
    const d0 = memoDraftFor(id);
    if (d0.status === 'saved') d0.base = findPlace(id)?.memo ?? d0.base;
    d0.text = text;
  }
  const d = memoDrafts.get(id);
  if (!d) return;
  if (d.status === 'saving') {
    if (text !== undefined && text !== d.base) d.again = true;
    return;
  }
  if (d.status === 'dirty' || (d.status === 'saved' && d.text !== d.base)) saveMemoNow(id);
}

export const flushAllMemos = () => {
  for (const [id, d] of memoDrafts) if (d.status === 'dirty') saveMemoNow(id);
};

// 저장 중인 메모가 모두 끝나기를 기다린다.
const settleMemos = () => Promise.allSettled([...memoDrafts.values()].map((d) => d.promise).filter(Boolean));

// 기다리던·저장 중인 메모를 모두 저장하고 끝나기를 기다린다(로그아웃·새로고침·본인 비밀번호 변경 전).
// 저장하는 사이 더 친 글이 있으면 그것도 이어서 저장한다(최대 3번).
export async function saveAllMemos() {
  for (let i = 0; i < 3; i++) {
    flushAllMemos();
    await settleMemos();
    if (![...memoDrafts.values()].some((d) => d.status === 'dirty' || d.status === 'saving')) return;
  }
}

// 저장되지 않은 메모(입력 중·저장 중·실패·충돌)가 남아 있는지.
export const anyUnsavedMemo = () => [...memoDrafts.values()].some((d) => d.status !== 'saved');

function saveMemoNow(id) {
  const d = memoDrafts.get(id);
  if (!d) return Promise.resolve();
  clearTimeout(d.timer);
  d.timer = null;
  if (d.status === 'saving') {
    d.again = true;
    return d.promise;
  }
  d.promise = saveMemoDraft(id, d).finally(() => {
    d.promise = null;
  });
  return d.promise;
}

async function saveMemoDraft(id, d) {
  const p = findPlace(id);
  if (!p) {
    discardMemo(id);
    return;
  }
  // 다른 기기가 바꾼 것을 이미 받아 두었으면(실시간) 보내기 전에 충돌로 알린다. 서버도 base로 한 번 더 확인한다(C1).
  if (p.memo !== d.base && p.memo !== d.text) {
    d.status = 'conflict';
    d.latest = p.memo;
    syncMemoStatus(id);
    memoConflictElsewhere(id, p);
    return;
  }
  if (p.memo === d.text) {
    d.base = p.memo;
    d.status = 'saved';
    d.error = null;
    syncMemoStatus(id);
    return;
  }
  const text = d.text;
  d.status = 'saving';
  d.error = null;
  d.again = false;
  syncMemoStatus(id);
  const epoch = authEpoch;
  let res;
  try {
    res = await api.updateMemo(id, text, d.base);
  } catch (err) {
    if (authFailed(err) || epoch !== authEpoch) return;
    if (isPlaceGone(err)) {
      dropGonePlace(id);
      return;
    }
    d.status = 'error';
    d.error = err.message;
    syncMemoStatus(id);
    // 고른 장소가 아니면 상태 줄이 안 보이므로 알림으로 알린다(돌아가면 적던 글과 [다시 저장]이 남아 있다).
    if (state.selectedId !== id) toast(`메모를 저장하지 못했습니다: ${err.message}`);
    return;
  }
  if (epoch !== authEpoch || memoDrafts.get(id) !== d) return;
  if (!res.place) {
    dropGonePlace(id);
    return;
  }
  mergePlace(res.place);
  // 최신 메모가 보낸 글과 같으면(끊긴 앞 저장이 들어갔던 것 등) 저장된 것으로 본다.
  if (res.status === 'conflict' && res.place.memo !== text) {
    d.status = 'conflict';
    d.latest = res.place.memo;
    memoConflictElsewhere(id, res.place);
  } else {
    rememberOwnWrite({ placeId: id, place: res.place });
    d.base = res.place.memo;
    // 저장하는 사이 더 적었으면 이어서 저장한다.
    if (d.again || d.text !== text) {
      d.status = 'dirty';
      d.timer = setTimeout(() => saveMemoNow(id), MEMO_SAVE_DELAY_MS);
    } else {
      d.status = 'saved';
    }
  }
  d.again = false;
  // 이미 떠난 장소의 메모가 뒤늦게 저장됐으면 초안을 지운다(실패했으면 남겨 두어 돌아왔을 때 [다시 저장]).
  if (state.selectedId !== id && d.status === 'saved') discardMemo(id);
  // 목록의 메모 표시·지도 말풍선을 고친다. 메모 칸은 다시 만들지 않는다(쓰는 중일 수 있다).
  renderListAndMap();
  syncMemoStatus(id);
}

// 이미 떠난 장소의 메모가 충돌하면 상태 줄이 안 보이므로 알림으로 알린다(돌아가면 안내와 두 갈래가 남아 있다).
function memoConflictElsewhere(id, place) {
  if (state.selectedId !== id) toast(`다른 기기에서 "${place.name}" 메모가 바뀌어 저장하지 못했습니다. 다시 열어 확인해 주세요.`);
}

// 충돌 안내의 [최신 메모 보기]: 내 글을 버리고 서버의 최신 메모를 칸에 넣는다.
function takeLatestMemo(id) {
  const d = memoDrafts.get(id);
  const p = findPlace(id);
  if (!d || !p) return;
  d.text = p.memo;
  d.base = p.memo;
  d.status = 'saved';
  d.latest = null;
  const ta = $('#memo-input');
  if (ta && state.selectedId === id) ta.value = p.memo;
  syncMemoStatus(id);
  refocus('#memo-input');
}

// 충돌 안내의 [내 메모로 저장]: 최신 메모를 알고 덮어쓴다.
function keepMyMemo(id) {
  const d = memoDrafts.get(id);
  const p = findPlace(id);
  if (!d || !p) return;
  d.base = p.memo;
  d.latest = null;
  d.status = 'dirty';
  saveMemoNow(id);
  refocus('#memo-input');
}

// 실패한 메모를 다시 보낸다(인터넷이 돌아왔을 때).
export function retryFailedMemos() {
  for (const [id, d] of memoDrafts) if (d.status === 'error') saveMemoNow(id);
}
