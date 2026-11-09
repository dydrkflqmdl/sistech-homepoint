// 상세 카드: 그리기(길찾기·메모·미션 목록·삭제), 한글 조합 중 다시 그리기 미루기, 장소 고르기·닫기·삭제, Esc 처리.
import { $, fill, h, refocus, toast } from './dom.js';
import { hooks, isPlaceGone, state, touchPlace } from './state.js';
import { authEpoch, authFailed } from './session.js';
import { panToPlace } from './map-ui.js';
import { discardMemo, flushMemo, memoDrafts, memoStatusView, memoText, onMemoInput } from './memo-ui.js';
import { districtOf, groupHeadSelector, listItemSelector, missionBadge, placeDot } from './list-ui.js';
import {
  cancelMissionDraft,
  confirmDiscardDraft,
  confirmDiscardMissionDraft,
  draftMatches,
  missionDraftDirty,
  missionDraftFor,
  missionEditing,
  missionForm,
  missionKey,
  missionRecord,
  missionSaving,
  missionView,
  toggleMission,
} from './missions-ui.js';
import { kakaoMapViewUrl, openKakaoMapRoute } from './kakao.js';
import { missionNames, missionProgress } from './mission.js';
import * as api from './api.js';

// 다시 그리기는 app.js에 있어 hooks로 부른다.
const render = (...args) => hooks.render(...args);
const renderKeepingInput = (...args) => hooks.renderKeepingInput(...args);

export function renderDetail() {
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

export function renderDetailUnlessComposing() {
  // 고른 장소가 바뀌었거나 상세 정보가 닫히는 경우, 초점이 상세 정보 밖에 있는 경우는 미루지 않는다.
  const shown = Number($('#detail').dataset.placeId);
  if (detailComposing && shown === state.selectedId && $('#detail').contains(document.activeElement)) {
    detailRenderPending = true;
    return;
  }
  detailRenderPending = false;
  renderDetail();
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
export function requestSelect(id, opts) {
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
export function dropGonePlace(id) {
  state.places = state.places.filter((p) => p.id !== id);
  touchPlace(id);
  discardMemo(id);
  if (state.selectedId === id) select(null);
  else render();
  toast('이 장소는 다른 기기에서 삭제되었습니다.');
}

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
