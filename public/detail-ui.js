// 상세 카드: 그리기(길찾기·메모·미션 목록·삭제), 한글 조합 중 다시 그리기 미루기, 장소 고르기·닫기·삭제, Esc 처리.
import { $, fill, h, refocus, toast } from './dom.js';
import { hooks, isPlaceGone, state, touchPlace } from './state.js';
import { authEpoch, authFailed, isContractor } from './session.js';
import { panToPlace } from './map-ui.js';
import { discardMemo, flushMemo, memoDrafts, memoStatusView, memoText, onMemoInput } from './memo-ui.js';
import { districtOf, groupHeadSelector, listItemSelector, missionBadge, placeDot } from './list-ui.js';
import { closeMissionDialog, confirmDiscardDraft, missionDialog, missionRecord, toggleMission } from './missions-ui.js';
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
  const contractor = isContractor();
  // 외주 계정: 메모는 읽기만 한다(비어 있으면 칸 자체를 두지 않는다). 장소 삭제도 없다.
  const memoBlock = contractor
    ? p.memo.trim() !== '' &&
      h('div', { class: 'memo memo-readonly' }, h('span', { id: 'memo-label', class: 'memo-label' }, '메모'), h('p', { id: 'memo-text', class: 'memo-text', 'aria-labelledby': 'memo-label' }, p.memo))
    : h(
        'div',
        { class: 'memo' },
        h('label', { for: 'memo-input' }, '메모'),
        memo,
        // 저장 상태는 메모 아래에 고정해 보여 준다(알림처럼 사라지지 않는다).
        h('div', { id: 'memo-status', class: 'memo-status', role: 'status' }, memoStatusView(p.id)),
      );

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
    memoBlock,
    missions.length > 0 &&
      h(
        'section',
        { class: 'missions' },
        h('h3', {}, `미션 ${progress.done}/${progress.total}`),
        // 이름이 거의 같아서 맨 뒤 번호를 굵게 보여 준다. 고른 미션은 기록 창(모달)으로 연다. 창은 그 버튼 다음 줄
        // (li.mission-editor, 자리는 차지하지 않음)에 두고 아래에서 showModal()로 띄운다.
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
              open && h('li', { class: 'mission-editor' }, missionDialog(p, m)),
            ];
          }),
        ),
      ),
    // 실수로 누르지 않게 다른 버튼과 떨어뜨려 맨 아래에 둔다(styles.css .delete-place).
    !contractor && h('div', { class: 'delete-place' }, h('button', { type: 'button', class: 'link danger', onclick: () => removePlace(p) }, '이 장소 삭제')),
  );
  // 미션 기록 창은 다시 그릴 때마다 새로 만들어지므로 그때마다 모달로 띄운다(맨 위 층, 뒤쪽은 누를 수 없음).
  // 초점은 창 안의 autofocus 칸으로 가고, 쓰던 칸이 있었으면 renderKeepingInput(app.js)이 그 칸으로 돌려놓는다.
  const dialog = box.querySelector('dialog.mission-dialog');
  if (dialog && !dialog.open) dialog.showModal();
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
  revealSelected(id);
}

// 상세 정보는 고른 장소 줄 바로 아래에 펼쳐진다(list-ui.js renderList). 고른 뒤 목록(.panel) 스크롤을 맞춘다.
// 규칙은 하나다: 고른 장소 줄을 늘 패널 맨 위에 둔다(그 아래가 상세 정보). 아래 창 높이(sheet-ui.js)·상세 정보 길이·
// 누른 자리·지도 핀으로 골랐는지와 상관없이 같다. 목록 끝이라 더 내릴 곳이 없으면 갈 수 있는 데까지.
// 애니메이션 없이 바로 옮긴다: 다시 그리기와 같은 순간에 끝나 화면에는 마지막 모습만 보인다. 부드럽게 움직이면 위쪽(앞서
// 고른 장소 아래)의 상세 정보가 닫히며 줄이 당겨지는 것까지 겹쳐, 아래쪽 장소를 누를 때 화면이 위로 튀는 것처럼 보였다.
// 패널에는 scroll-behavior를 두지 않으므로 scrollTop을 바꾸면 바로 옮겨진다. 줄이 목록에 없어 상세 정보가 원래 자리(목록 위)면 맨 위로.
const REVEAL_GAP = 8;
function revealSelected(id) {
  const panel = $('.panel');
  const row = $(listItemSelector(id));
  const box = $('#detail');
  if (!row || !box?.closest('#place-list')) {
    panel.scrollTop = 0;
    return;
  }
  panel.scrollTop += row.getBoundingClientRect().top - panel.getBoundingClientRect().top - REVEAL_GAP;
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
  if (isContractor()) return;
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

// Esc: 미션 기록 창이 열려 있으면 그 창만 닫는다(고치던 값이 있으면 버릴지 묻고, 저장 중이면 닫지 않는다).
// 브라우저가 모달을 스스로 닫지 않게 기본 동작은 막는다. 창이 없으면 상세 정보를 닫는다(입력 칸 안에서는 아무것도 안 한다).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || state.selectedId === null) return;
  if (state.selectedMission != null) {
    e.preventDefault();
    closeMissionDialog();
    return;
  }
  if (e.target.closest?.('input, textarea, select')) return;
  closeDetail();
});
