// 상세 정보의 미션 기록: 보기·입력 폼(이름은 읽기 전용), 초안·검사, 저장·취소·충돌 안내(최신값/덮어쓰기)·다시 시도, 떠나기 전 확인.
import { $, h, refocus, toast } from './dom.js';
import { findPlace, hooks, isPlaceGone, rememberOwnWrite, replacePlace, state } from './state.js';
import { authEpoch, authFailed, currentWorkerName } from './session.js';
import { discardMemo, flushMemo, memoUnsaved } from './memo-ui.js';
import * as api from './api.js';
import { FLIGHT_MIN_DIGITS, FLIGHT_SEC_DIGITS, formatFlightTime, normalizeFlightTime, parseFlightTime } from './flight-time.js';

// 다시 그리기(app.js·detail-ui.js)와 지워진 장소 빼기(detail-ui.js)는 위쪽 모듈에 있어 hooks로 부른다.
const renderDetail = (...args) => hooks.renderDetail(...args);
const renderKeepingInput = (...args) => hooks.renderKeepingInput(...args);
const dropGonePlace = (...args) => hooks.dropGonePlace(...args);

// 기록이 없는 미션은 빈 기록으로 본다. 서버는 한 번이라도 저장한 미션만 돌려준다.
export const missionRecord = (p, name) =>
  p.missions?.find((m) => m.mission === name) ?? { mission: name, done: false, worker: '', flightTime: '', batteryNo: '', batteryLeft: '' };

// '이름'(worker)은 고칠 수 없다(readonly): 늘 지금 로그인한 사람의 표시 아이디로 기록한다.
// '비행시간'은 분·초 두 칸(flightMin·flightSec)으로 받아 "12분 30초"로 합쳐 저장한다(flight-time.js).
const MISSION_FIELDS = [
  { key: 'worker', label: '이름', placeholder: '작업자', inputmode: 'text', readonly: true },
  { key: 'flightTime', label: '비행시간', flight: true },
  { key: 'batteryNo', label: '사용한 배터리 번호', placeholder: '예: 3', inputmode: 'text' },
  // 숫자(0~100)만 받고 %는 칸 옆에 붙여 보여 준다. 값에는 %를 넣지 않는다.
  { key: 'batteryLeft', label: '마지막 배터리 남은 용량', placeholder: '예: 45', inputmode: 'numeric', unit: '%' },
];

// 화면의 입력 칸 이름(순서대로). 막힌 칸 표시·첫 막힌 칸으로 초점 옮기기에 쓴다.
const MISSION_INPUTS = ['worker', 'flightMin', 'flightSec', 'batteryNo', 'batteryLeft'];
// 숫자만 받는 칸(숫자 아닌 글자는 치는 대로 지운다).
const DIGIT_INPUTS = new Set(['flightMin', 'flightSec', 'batteryLeft']);

const MISSION_REQUIRED_MESSAGE = '완료로 저장하려면 이름, 비행시간, 사용한 배터리 번호, 마지막 배터리 남은 용량을 모두 적어야 합니다.';
const BATTERY_LEFT_MESSAGE = '마지막 배터리 남은 용량은 0~100 사이 숫자만 적어 주세요.';
const FLIGHT_MESSAGE = '비행시간은 분·초 칸에 숫자만 적어 주세요. 초는 0~59입니다.';

// 보기 화면 등에서 남은 용량을 보여 줄 때 쓴다. 비어 있으면 ''.
const batteryLeftText = (v) => (String(v ?? '').trim() ? `${String(v).trim()}%` : '');

const isMissionSaved = (p, name) => Boolean(p.missions?.some((m) => m.mission === name));
export const draftMatches = (p, name) => state.missionDraft?.placeId === p.id && state.missionDraft.mission === name;

// 아직 저장한 적 없는 미션은 바로 입력 화면, 저장한 미션은 [수정]을 누르기 전까지 보기 화면이다.
export const missionEditing = (p, name) => draftMatches(p, name) || !isMissionSaved(p, name);

// 저장된 비행시간 글자를 분·초 칸 초안으로. 분·초로 읽을 수 없는 옛 기록("약 10분")은 칸을 비우고 flightLegacy에 둔다
// (칸에 아무것도 안 적고 저장하면 옛 글자를 그대로 다시 보낸다 — 열어 보기만 해서 지워지지 않게).
function flightDraft(text) {
  const parsed = parseFlightTime(text);
  return parsed
    ? { flightMin: parsed.min, flightSec: parsed.sec, flightLegacy: '' }
    : { flightMin: '', flightSec: '', flightLegacy: String(text ?? '').trim() };
}

// 초안의 비행시간(저장할 글자). 분·초 칸이 비었으면 옛 기록 글자, 그것도 없으면 ''.
export const draftFlightTime = (d) => formatFlightTime(d.flightMin, d.flightSec) || d.flightLegacy || '';

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
    ...flightDraft(r.flightTime),
    batteryNo: r.batteryNo ?? '',
    batteryLeft: r.batteryLeft ?? '',
    // 저장하려다 막힌 칸: { 칸 이름: 'required' | 'range' }. 다시 그려도 빨간 테두리가 남도록 초안에 둔다.
    invalid: {},
    // 이 값을 바탕으로 고쳤다는 기록 판(version). 기록이 없으면 null. 그사이 다른 기기가 저장했으면 save_mission이 conflict로 막는다.
    baseVersion: r.version ?? null,
    // conflict를 받았을 때 서버의 최신 기록(없으면 null). undefined면 충돌 없음.
    conflict: undefined,
    // 저장이 끝나지 못했을 때(시간 초과·연결 실패·취소·서버 오류) 폼 안에 남기는 안내 { message, retry }. 없으면 null.
    error: null,
    // 저장 전 검사에서 막힌 까닭(빈 칸·숫자 범위). 창(모달) 안에 보인다. 막힌 칸을 모두 고치면 지운다.
    notice: null,
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
  // 비행시간은 같은 시간을 다르게 적은 옛 기록("12분30초")도 같게 본다(열기만 해도 "고쳤음"이 되지 않게).
  return (
    Boolean(d.done) !== Boolean(r.done) ||
    draftFlightTime(d) !== normalizeFlightTime(r.flightTime) ||
    ['batteryNo', 'batteryLeft'].some((key) => String(d[key] ?? '').trim() !== String(r[key] ?? '').trim())
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
// 막힌 칸을 모두 고쳤으면 창 안의 막힌 까닭 문구도 지운다.
function syncMissionInvalid(name) {
  const form = $(missionFormSelector(name));
  const draft = state.missionDraft?.mission === name ? state.missionDraft : null;
  const invalid = draft?.invalid ?? {};
  for (const key of MISSION_INPUTS) {
    const input = form?.querySelector(`input[name="${key}"]`);
    if (!input) continue;
    if (invalid[key]) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  if (draft && Object.keys(invalid).length === 0) draft.notice = null;
  const notice = form?.querySelector('.mission-form-notice');
  if (notice) {
    notice.textContent = draft?.notice ?? '';
    notice.hidden = !draft?.notice;
  }
}

// 고치기 시작한 칸은 바로 빨간 표시를 지운다. 이름 칸은 읽기 전용이라 무엇이 와도 초안에 넣지 않는다.
function onMissionFieldInput(p, name, key, e) {
  const input = e.target;
  if (key === 'worker') {
    input.value = currentWorkerName();
    return;
  }
  if (DIGIT_INPUTS.has(key)) {
    // 숫자만 남긴다("45%" → "45", "12분" → "12"). 지운 글자만큼 커서를 앞으로 당긴다.
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
  // 비행시간은 분·초 중 한 칸만 채워도 되므로, 빈 칸 표시는 두 칸을 함께 지운다.
  if (key === 'flightMin' || key === 'flightSec') {
    for (const k of ['flightMin', 'flightSec']) if (state.missionDraft.invalid[k] === 'required') delete state.missionDraft.invalid[k];
  }
  syncMissionInvalid(name);
}

// 저장 전에 확인한다. 완료면 네 항목 모두 필요하다(비행시간은 분·초 중 한 칸 이상, 옛 기록 글자가 남아 있어도 된다).
// 비행시간 분·초는 숫자(초는 0~59), 남은 용량은 적었다면 0~100 정수여야 한다.
function validateMissionDraft(draft) {
  const invalid = {};
  const filled = (v) => String(v ?? '').trim() !== '';
  if (draft.done) {
    if (!filled(draft.worker)) invalid.worker = 'required';
    if (!draftFlightTime(draft)) invalid.flightMin = invalid.flightSec = 'required';
    for (const key of ['batteryNo', 'batteryLeft']) if (!filled(draft[key])) invalid[key] = 'required';
  }
  const min = String(draft.flightMin ?? '').trim();
  const sec = String(draft.flightSec ?? '').trim();
  if (min && !new RegExp(`^\\d{1,${FLIGHT_MIN_DIGITS}}$`).test(min)) invalid.flightMin = 'range';
  if (sec && !(new RegExp(`^\\d{1,${FLIGHT_SEC_DIGITS}}$`).test(sec) && Number(sec) <= 59)) invalid.flightSec = 'range';
  const left = String(draft.batteryLeft ?? '').trim();
  if (left && !(/^\d+$/.test(left) && Number(left) <= 100)) invalid.batteryLeft = 'range';
  const reasons = Object.values(invalid);
  const ranges = [
    (invalid.flightMin === 'range' || invalid.flightSec === 'range') && FLIGHT_MESSAGE,
    invalid.batteryLeft === 'range' && BATTERY_LEFT_MESSAGE,
  ].filter(Boolean);
  const message = reasons.includes('required') ? MISSION_REQUIRED_MESSAGE : ranges.length ? ranges.join(' ') : null;
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
        // 창(모달)이 뜨면 여기로 초점이 간다. 휴대폰 키보드가 바로 뜨지 않도록 글자 칸이 아니라 체크 상자로.
        autofocus: true,
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
    MISSION_FIELDS.map(({ key, label, placeholder, inputmode, unit, readonly, flight }) =>
      readonly
        ? workerField(draft)
        : flight
          ? flightField(p, draft, saving)
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
    // 저장 전 검사에서 막힌 까닭. 창(모달)이 화면 아래 알림(토스트)을 덮으므로 창 안에도 보인다.
    h('p', { class: 'mission-form-notice', role: 'alert', hidden: !draft.notice }, draft.notice ?? ''),
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
    // 저장이 끝나지 못했을 때. 적던 값은 그대로 있다. 시간 초과·연결 실패·[취소]면 [다시 시도]로 다시 보낸다.
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

// 비행시간 칸: [  ]분 [  ]초 두 칸. 숫자만 받고, 저장할 때 "12분 30초"로 합친다(flight-time.js).
// 분·초로 읽을 수 없는 옛 기록이면 칸을 비워 두고 그 글자를 안내한다(아무것도 안 적으면 옛 글자를 그대로 저장).
function flightField(p, draft, saving) {
  const name = draft.mission;
  const empty = !String(draft.flightMin ?? '').trim() && !String(draft.flightSec ?? '').trim();
  const part = (key, unit, placeholder, maxlength) =>
    h(
      'label',
      { class: 'flight-part' },
      h('input', {
        type: 'text',
        name: key,
        value: draft[key] ?? '',
        placeholder,
        inputmode: 'numeric',
        pattern: '[0-9]*',
        maxlength,
        autocomplete: 'off',
        disabled: saving,
        'aria-label': `비행시간 ${unit}`,
        'aria-invalid': draft.invalid?.[key] ? 'true' : null,
        oninput: (e) => onMissionFieldInput(p, name, key, e),
      }),
      h('span', { class: 'unit-label', 'aria-hidden': 'true' }, unit),
    );
  return h(
    'div',
    { class: 'field flight', role: 'group', 'aria-labelledby': 'flight-label' },
    h('span', { id: 'flight-label' }, '비행시간'),
    h('div', { class: 'flight-inputs' }, part('flightMin', '분', '예: 12', FLIGHT_MIN_DIGITS), part('flightSec', '초', '예: 30', FLIGHT_SEC_DIGITS)),
    draft.flightLegacy && empty && h('small', { class: 'field-note' }, `지금 기록: ${draft.flightLegacy} — 분·초를 적으면 바뀝니다.`),
  );
}

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
      h('button', { type: 'button', class: 'btn edit', autofocus: true, onclick: () => editMission(p, record.mission) }, '수정'),
    ),
  );
}

// 미션 버튼: 그 미션의 기록 창(모달)을 연다. 아직 저장 안 한 미션은 바로 입력 화면, 저장한 미션은 보기 화면([수정])이다.
// 같은 미션을 다시 누르면(창이 열려 있지 않을 때만 누를 수 있다) 닫는다. 고치던 값은 버린다.
export function toggleMission(name) {
  // 미션을 바꿀 때는 미션 초안만 묻는다(메모는 같은 장소라 그대로 둔다).
  if (!confirmDiscardMissionDraft()) return;
  state.selectedMission = state.selectedMission === name ? null : name;
  state.missionDraft = null;
  const p = state.places.find((x) => x.id === state.selectedId);
  if (p && state.selectedMission && !isMissionSaved(p, name)) state.missionDraft = newMissionDraft(p, name);
  renderDetail();
  // 창을 열면 창 안(완료 체크 또는 [수정])에 초점이 간다(autofocus). 닫으면 그 미션 버튼으로.
  if (state.selectedMission !== name) refocus(missionItemSelector(name));
}

// 창 닫기(× · Esc · 바깥 누르기). 고치던 값이 있으면 버릴지 묻는다. 저장 중에는 닫지 않는다([취소]로 먼저 멈춘다).
export function closeMissionDialog() {
  const name = state.selectedMission;
  if (name == null) return;
  const p = findPlace(state.selectedId);
  if (p && missionSaving.has(missionKey(p.id, name))) return;
  if (!confirmDiscardMissionDraft()) return;
  state.selectedMission = null;
  state.missionDraft = null;
  renderDetail();
  refocus(missionItemSelector(name));
}

// 미션 기록 창(모달). 상세 정보 안(고른 미션 버튼 다음 줄)에 두고, 그린 뒤 detail-ui.js가 showModal()로 띄운다.
// 맨 위 층에 떠서 뒤쪽(목록·지도·머리글)은 누를 수 없고, 휴대폰에서도 입력 칸이 화면 가운데에 온다.
export function missionDialog(p, name) {
  const record = missionRecord(p, name);
  const saving = missionSaving.has(missionKey(p.id, name));
  return h(
    'dialog',
    {
      class: 'mission-dialog',
      'data-mission': name,
      'aria-labelledby': 'mission-dialog-title',
      // 휴대폰 뒤로 가기 등 브라우저가 닫으려 할 때도 같은 길(버릴지 묻기)로 닫는다. Esc는 detail-ui.js가 먼저 받는다.
      oncancel: (e) => {
        e.preventDefault();
        closeMissionDialog();
      },
      // 창 바깥(어두운 배경)을 누르면 닫는다. 창 안은 .mission-dialog-body가 꽉 채우므로 dialog 자신이 눌린 것이 바깥이다.
      onclick: (e) => {
        if (e.target === e.currentTarget) closeMissionDialog();
      },
    },
    h(
      'div',
      { class: 'mission-dialog-body' },
      h(
        'div',
        { class: 'mission-dialog-head' },
        h('div', {}, h('h3', { id: 'mission-dialog-title' }, name), h('p', { class: 'mission-dialog-place' }, p.name)),
        h('button', { type: 'button', class: 'icon-btn mission-dialog-close', 'aria-label': '닫기', disabled: saving, onclick: closeMissionDialog }, '×'),
      ),
      missionEditing(p, name) ? missionForm(p, missionDraftFor(p, name)) : missionView(p, record),
    ),
  );
}

const missionItemSelector = (name) => `#detail .mission-item[data-mission="${CSS.escape(name)}"]`;
const missionViewSelector = (name) => `#detail .mission-view[data-mission="${CSS.escape(name)}"]`;
const missionFormSelector = (name) => `#detail .mission-form[data-mission="${CSS.escape(name)}"]`;

function editMission(p, name) {
  state.missionDraft = newMissionDraft(p, name);
  renderDetail();
  // 휴대폰 키보드가 바로 뜨지 않도록 글자 칸이 아니라 완료 체크 상자로 초점을 옮긴다.
  refocus(`${missionFormSelector(name)} input[name="done"]`);
}

// [취소]: 저장한 적 있는 미션은 창 안의 보기 화면으로 돌아가고, 처음 쓰던 미션은 창을 닫는다.
export function cancelMissionDraft(p, name) {
  state.missionDraft = null;
  const saved = isMissionSaved(p, name);
  if (!saved) state.selectedMission = null;
  renderDetail();
  refocus(saved ? `${missionViewSelector(name)} .btn.edit` : missionItemSelector(name));
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
    // 막힌 칸 표시·까닭이 다시 그려도 남도록 초안을 state에 둔다. 까닭은 창 안(.mission-form-notice)에 보인다
    // (창이 화면 아래 알림을 덮으므로 알림으로는 띄우지 않는다).
    state.missionDraft = { ...draft, invalid, notice: message };
    syncMissionInvalid(name);
    const first = MISSION_INPUTS.find((key) => invalid[key]);
    if (first) refocus(`${missionFormSelector(name)} input[name="${first}"]`);
    return;
  }
  const left = String(draft.batteryLeft ?? '').trim();
  const fields = {
    done: Boolean(draft.done),
    worker: draft.worker,
    flightTime: draftFlightTime(draft),
    batteryNo: String(draft.batteryNo ?? '').trim(),
    // "045"처럼 앞에 0을 붙여 적어도 45로 보낸다.
    batteryLeft: left ? String(Number(left)) : '',
  };
  // 저장 중에는 입력 칸이 잠기므로, 실패하면 초점을 돌려놓을 칸을 기억해 둔다.
  const focusedField = $(missionFormSelector(name))?.contains(document.activeElement) ? document.activeElement.name : null;
  const refocusForm = () => refocus(`${missionFormSelector(name)} ${focusedField ? `input[name="${focusedField}"]` : '.btn.primary'}`);
  // 앞서 남은 실패 안내·막힌 까닭은 다시 보낼 때 지운다.
  state.missionDraft = { ...draft, error: null, notice: null };

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
    // 실패 까닭은 창 안에 남긴다(창이 알림을 덮는다). 시간 초과·연결 실패·[취소]면 [다시 시도]를 붙인다.
    const retry = Boolean(err.timeout || err.aborted || !err.status);
    if (draftMatches(place, name)) state.missionDraft = { ...state.missionDraft, error: { message: err.message, retry } };
    renderKeepingInput();
    if (err.aborted) refocus(`${missionFormSelector(name)} .btn.primary`);
    else refocusForm();
    // 창이 닫혀 있으면(그사이 다른 장소로 옮김 등) 창 안 안내를 볼 수 없으므로 알림으로 알린다.
    if (!err.aborted && !draftMatches(place, name)) toast(err.message);
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
  // 저장하면 창을 닫고 그 미션 버튼으로 돌아간다(완료면 ✓로 바뀐 것이 보인다). 다른 장소로 옮겨 갔으면 그대로 둔다.
  const open = state.selectedId === id && state.selectedMission === name;
  if (open) state.selectedMission = null;
  renderKeepingInput();
  if (open) refocus(missionItemSelector(name));
  toast('미션 기록을 저장했습니다.');
}
