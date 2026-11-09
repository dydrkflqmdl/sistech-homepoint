// 상세 정보의 미션 기록: 보기·입력 폼(이름은 읽기 전용), 초안·검사, 저장·취소·충돌 안내(최신값/덮어쓰기)·다시 시도, 떠나기 전 확인.
import { $, h, refocus, toast } from './dom.js';
import { findPlace, hooks, isPlaceGone, rememberOwnWrite, replacePlace, state } from './state.js';
import { authEpoch, authFailed, currentWorkerName } from './session.js';
import { discardMemo, flushMemo, memoUnsaved } from './memo-ui.js';
import * as api from './api.js';

// 다시 그리기(app.js·detail-ui.js)와 지워진 장소 빼기(detail-ui.js)는 위쪽 모듈에 있어 hooks로 부른다.
const renderDetail = (...args) => hooks.renderDetail(...args);
const renderKeepingInput = (...args) => hooks.renderKeepingInput(...args);
const dropGonePlace = (...args) => hooks.dropGonePlace(...args);

// 기록이 없는 미션은 빈 기록으로 본다. 서버는 한 번이라도 저장한 미션만 돌려준다.
export const missionRecord = (p, name) =>
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
export const draftMatches = (p, name) => state.missionDraft?.placeId === p.id && state.missionDraft.mission === name;

// 아직 저장한 적 없는 미션은 바로 입력 화면, 저장한 미션은 [수정]을 누르기 전까지 보기 화면이다.
export const missionEditing = (p, name) => draftMatches(p, name) || !isMissionSaved(p, name);

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
export const missionDraftFor = (p, name) => (draftMatches(p, name) ? state.missionDraft : newMissionDraft(p, name));

// 미션 초안이 저장된 기록(새 미션이면 빈 기록)과 다르면 true. 이름은 사람이 고칠 수 없는 칸이라 보지 않는다
// (다른 사람이 저장한 기록을 열기만 해도 "저장하지 않은 기록"으로 묻지 않게).
export function missionDraftDirty() {
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
export const draftDirty = () => missionDraftDirty() || memoUnsaved(state.selectedId);

export const confirmDiscardMissionDraft = () => !missionDraftDirty() || confirm('저장하지 않은 미션 기록이 있습니다. 버릴까요?');

// 장소를 떠나기(닫기·다른 장소·처음 화면·로그아웃 등) 전에 부른다. 그만두면 false.
export function confirmDiscardDraft() {
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
export const missionSaving = new Set();
export const missionKey = (id, name) => `${id}|${name}`;

export function missionForm(p, draft) {
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

export function missionView(p, record) {
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

// 다른 미션을 열거나 닫으면 고치던 값은 버린다. 아직 저장 안 한 미션은 바로 입력 화면으로 연다.
export function toggleMission(name) {
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
export function cancelMissionDraft(p, name) {
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
export const missionAborts = new Map();

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
