// 화면의 뼈대: 모듈을 이어 붙이고(hooks), 다시 그리기, 처음 화면, 로그인·로그아웃 전환, 연결 상태·새 버전 띠, 시작.
// 각 화면 조각은 아래 모듈에 있다. 의존은 한 방향(dom → state → session → map-ui·memo-ui → sync → list-ui·missions-ui
// → detail-ui → accounts-ui·import-ui → app)이고, 아래 모듈이 위 모듈 함수를 부를 때는 state.js의 hooks를 거친다.
// login-id.js는 다른 담당이 함수를 더해 가는 파일이라 이름공간으로 가져온다.
// 아직 없는 이름(isValidPassword 등)을 이름으로 가져오면 모듈 전체가 안 열리므로, 쓸 때 있는지 보고 쓴다.
import * as loginId from './login-id.js';
import * as api from './api.js';
import { $, refocus, toast } from './dom.js';
import { collapseAllGroups, config, hooks, placeColor, state, visiblePlaces } from './state.js';
import {
  LOGIN_ENDED_MESSAGE,
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
import { loadPlaces, onRemoteChange, refreshPlaces, resetSync } from './sync.js';
import { cancelSearch, renderFilters, renderList } from './list-ui.js';
import { confirmDiscardDraft, confirmDiscardMissionDraft, missionAborts, missionDraftDirty, missionSaving } from './missions-ui.js';
import { dropGonePlace, renderDetail, renderDetailUnlessComposing, requestSelect } from './detail-ui.js';
import { accounts, accountsReset, renderAccounts } from './accounts-ui.js';
import { renderImport } from './import-ui.js';

// 아래쪽 모듈이 부르는 함수를 넘겨준다(state.js의 hooks 설명 참고).
Object.assign(hooks, { dropGonePlace, leaveApp, render, renderDetail, renderKeepingInput, renderListAndMap, requestSelect });

let unsubscribeChanges = null;

// ── 화면 그리기 ───────────────────────────────────────────

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

// 목록·지도·칩만 다시 그린다(상세 정보의 입력 칸은 건드리지 않는다). 메모 저장 뒤 등에 쓴다.
function renderListAndMap() {
  const visible = visiblePlaces();
  renderFilters();
  renderList(visible);
  renderMarkers(visible);
}

// ── 화면을 벗어날 때 ─────────────────────────────────────

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

// ── 연결 상태·새 버전·떠나기 전 확인 ─────────────────────────

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
