// csv.js·login-id.js는 다른 담당이 함수를 더해 가는 파일이라 이름공간으로 가져온다.
// 아직 없는 이름(nearDuplicates·isValidPassword 등)을 이름으로 가져오면 모듈 전체가 안 열리므로, 쓸 때 있는지 보고 쓴다.
import * as csv from './csv.js';
import * as loginId from './login-id.js';
import * as api from './api.js';
import { $, fill, h, refocus, toast } from './dom.js';
import { collapseAllGroups, config, hooks, placeColor, state, visiblePlaces } from './state.js';
import {
  LOGIN_ENDED_MESSAGE,
  authEpoch,
  authFailed,
  bumpAuthEpoch,
  currentUser,
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
import { fitToPlaces, mapState, renderMarkers, startMap } from './map-ui.js';
import { anyUnsavedMemo, discardMemo, flushAllMemos, memoDrafts, retryFailedMemos, saveAllMemos } from './memo-ui.js';
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
import { cancelSearch, renderFilters, renderList } from './list-ui.js';
import {
  confirmDiscardDraft,
  confirmDiscardMissionDraft,
  draftDirty,
  missionAborts,
  missionDraftDirty,
  missionSaving,
} from './missions-ui.js';
import { dropGonePlace, renderDetail, renderDetailUnlessComposing, requestSelect } from './detail-ui.js';
import { accounts, accountsReset, renderAccounts } from './accounts-ui.js';

// 아래쪽 모듈이 부르는 함수를 넘겨준다(state.js의 hooks 설명 참고).
Object.assign(hooks, { dropGonePlace, leaveApp, render, renderDetail, renderKeepingInput, renderListAndMap, requestSelect });

let unsubscribeChanges = null;

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

function render() {
  // 미션 저장으로 그 상태의 장소가 하나도 안 남으면 칩도 사라지므로, 아무 칩도 눌리지 않은 채 걸러지지 않게 전체로 되돌린다.
  if (state.filterColor && !state.places.some((p) => placeColor(p) === state.filterColor)) state.filterColor = null;
  const visible = visiblePlaces();
  renderFilters();
  renderList(visible);
  renderMarkers(visible);
  renderDetailUnlessComposing();
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

// ── 메모: 입력 후 1초 뒤 저절로 저장 ─────────────────────────

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
  cancelSearch();
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
    cancelSearch();
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
