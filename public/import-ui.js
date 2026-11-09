// CSV 가져오기 창(파일 고르기·끌어다 놓기, 가져오기 전 확인 C7, 파일별 결과)과 내보내기 메뉴(장소/미션 기록).
import { $, fill, h, refocus, toast } from './dom.js';
import { hooks, state, visiblePlaces } from './state.js';
import { authEpoch, authFailed, signedIn } from './session.js';
import { fitToPlaces } from './map-ui.js';
import { flushRemote, reloadPlaces, remoteChangedWhileImporting, setRemoteChangedWhileImporting } from './sync.js';
import { confirmDiscardDraft, draftDirty } from './missions-ui.js';
// csv.js는 다른 담당이 함수를 더해 가는 파일이라 이름공간으로 가져온다.
// 아직 없는 이름(nearDuplicates 등)을 이름으로 가져오면 모듈 전체가 안 열리므로, 쓸 때 있는지 보고 쓴다.
import * as csv from './csv.js';
import * as api from './api.js';

// 다시 그리기는 app.js에 있어 hooks로 부른다.
const render = (...args) => hooks.render(...args);

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

export function renderImport() {
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

$('#import-button').addEventListener('click', () => $('#csv-input').click());

// 파일명에 넣을 오늘 날짜(YYYY-MM-DD). UTC가 아니라 기기 시간대 기준이라 한국에서 아침에 내보내도 전날 날짜가 되지 않는다.
function localDateStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// CSV 글을 파일로 내려받게 한다. toCsv·toMissionCsv가 엑셀용 UTF-8 BOM을 앞에 붙여 준다.
function downloadCsv(text, filename) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  // 바로 지우면 일부 브라우저에서 내려받기가 끊긴다.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// 장소 내보내기: 저장된 장소 전부를 다시 가져올 수 있는 형식으로.
function exportPlaces() {
  downloadCsv(csv.toCsv(state.places), `places-${localDateStamp()}.csv`);
}

// 미션 기록 내보내기(계약 C11): 저장된 장소 전부를 csv.toMissionCsv로. csv.js에 함수가 없으면 메뉴 자체를 띄우지 않는다.
function exportMissions() {
  if (typeof csv.toMissionCsv !== 'function') return;
  downloadCsv(csv.toMissionCsv(state.places), `missions-${localDateStamp()}.csv`);
}

// [내보내기]: csv.js에 미션 기록 내보내기(toMissionCsv)가 있으면 단추 아래에 작은 메뉴(장소 / 미션 기록)를 띄운다.
// 메뉴는 화면에 겹쳐 뜨므로(position: fixed) 머리글 높이·줄 수는 그대로다. 없으면 예전처럼 바로 장소를 내보낸다.
const exportButton = $('#export-button');
const exportMenu = $('#export-menu');
const hasMissionExport = () => typeof csv.toMissionCsv === 'function';
if (hasMissionExport()) {
  exportButton.setAttribute('aria-haspopup', 'menu');
  exportButton.setAttribute('aria-expanded', 'false');
  exportButton.setAttribute('aria-controls', 'export-menu');
}

export function closeExportMenu({ focus = false } = {}) {
  if (exportMenu.hidden) return;
  exportMenu.hidden = true;
  exportMenu.replaceChildren();
  exportButton.setAttribute('aria-expanded', 'false');
  if (focus) exportButton.focus();
}

function openExportMenu() {
  const item = (id, label, run) =>
    h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        class: 'menu-item',
        id,
        onclick: () => {
          closeExportMenu({ focus: true });
          if (signedIn()) run();
        },
      },
      label,
    );
  fill(exportMenu, item('export-places', '장소 내보내기', exportPlaces), item('export-missions', '미션 기록 내보내기', exportMissions));
  exportMenu.hidden = false;
  exportButton.setAttribute('aria-expanded', 'true');
  placeExportMenu();
  exportMenu.querySelector('.menu-item').focus();
}

// 단추 바로 아래, 단추 오른쪽 끝에 맞춘다. 화면 밖으로 나가면 안쪽으로 당긴다(양옆 8px).
function placeExportMenu() {
  const r = exportButton.getBoundingClientRect();
  const w = exportMenu.offsetWidth;
  exportMenu.style.top = `${Math.round(r.bottom + 4)}px`;
  exportMenu.style.left = `${Math.round(Math.max(8, Math.min(r.right - w, innerWidth - w - 8)))}px`;
}

exportButton.addEventListener('click', () => {
  if (!signedIn()) return;
  if (!hasMissionExport()) {
    exportPlaces();
    return;
  }
  if (exportMenu.hidden) openExportMenu();
  else closeExportMenu();
});

// 메뉴 안 키보드: ↑↓·Home·End로 항목을 옮기고, Esc는 메뉴만 닫는다(상세 정보 닫기로 넘어가지 않게).
// Tab은 메뉴를 닫고 [내보내기]로 돌아간다(메뉴는 문서 맨 끝에 있어 그대로 두면 초점이 갈 곳이 없다).
exportMenu.addEventListener('keydown', (e) => {
  const items = [...exportMenu.querySelectorAll('.menu-item')];
  const i = items.indexOf(document.activeElement);
  const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
  if (e.key === 'Escape' || e.key === 'Tab') {
    e.preventDefault();
    e.stopPropagation();
    closeExportMenu({ focus: true });
  } else if (to !== undefined) {
    e.preventDefault();
    items[(to + items.length) % items.length]?.focus();
  }
});
// 메뉴 밖을 누르거나 화면 크기가 바뀌면 닫는다.
document.addEventListener('pointerdown', (e) => {
  if (!exportMenu.hidden && !exportMenu.contains(e.target) && !exportButton.contains(e.target)) closeExportMenu();
});
window.addEventListener('resize', () => closeExportMenu());

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
