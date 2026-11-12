// 로그인 상태(지금 사용자·로그인 순번)와 로그인 화면 도우미(보이는 화면 바꾸기, 오류·안내 칸, 비밀번호 [보기], 머리글 이름).
// 상태를 바꾸는 일(enterApp·leaveApp)은 app.js가 하고, 다른 모듈은 여기 값을 읽기만 한다(ES 모듈의 live binding).
import { $, fill, h } from './dom.js';
import { hooks } from './state.js';
import { closeTopMenu } from './menu-ui.js';
import * as loginId from './login-id.js';

// 로그인할 때마다 하나씩 올린다. 응답을 기다리는 사이 로그아웃·다른 계정 로그인이 있었으면 그 응답은 버린다.
export let authEpoch = 0;
export let currentUser = null; // { id, email, name, role, jwtRole, admin } — name은 머리글에 보여 줄 아이디, role은 'admin'|'staff'|'contractor', jwtRole은 토큰에 들어 있던 역할, admin은 계정 관리 버튼을 보일지
export let loggingOut = false;
export const signedIn = () => currentUser !== null;
// 외주 계정이면 가져오기·내보내기·장소 삭제를 막는다(서버도 같은 이유로 거절한다). 메모와 미션 기록은 쓸 수 있다.
export const isContractor = () => currentUser?.role === 'contractor';

// 위 값은 다른 모듈에서 직접 바꿀 수 없으므로(import한 이름은 읽기 전용) 바꾸는 함수를 둔다.
export const bumpAuthEpoch = () => authEpoch++;
export const setCurrentUser = (user) => {
  currentUser = user;
};
export const setLoggingOut = (value) => {
  loggingOut = value;
};

// 미션 기록의 '이름': 지금 로그인한 사람의 표시 아이디(C4 순서, 머리글과 같은 값). 사람이 고칠 수 없다.
export const currentWorkerName = () => String(currentUser?.name ?? '').trim();

export const LOGIN_ENDED_MESSAGE = '로그인이 만료되었거나 다른 창에서 로그아웃했습니다. 다시 로그인해 주세요.';

// 한 번에 하나만 보인다: 'boot'(설정 없음·불러오는 중), 'login', 'app'.
// 앱 화면을 떠나면 [내보내기] 메뉴(import-ui.js, 위쪽 모듈이라 hooks로 부른다)와 휴대폰 머리글 메뉴(☰)도 닫는다.
export function showView(view) {
  if (view !== 'app') {
    hooks.closeExportMenu();
    closeTopMenu();
  }
  $('#boot-message').hidden = view !== 'boot';
  $('#login').hidden = view !== 'login';
  $('.app').hidden = view !== 'app';
}

export function showBootMessage(...lines) {
  fill($('#boot-message'), lines.map((t) => h('p', {}, t)));
  showView('boot');
}

export function setLoginError(message, invalidField = null) {
  const el = $('#login-error');
  el.textContent = message ?? '';
  el.hidden = !message;
  for (const name of ['id', 'password']) {
    const input = $(`#login-${name}`);
    if (invalidField === name) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

// 오류가 아닌 안내(비밀번호를 바꿔 다시 로그인해 달라는 말 등). 오류 칸(빨강, role=alert)과 따로 둔다.
export function setLoginNotice(message) {
  const el = $('#login-notice');
  el.textContent = message ?? '';
  el.hidden = !message;
}

// 로그인 비밀번호 칸의 [보기]. 로그인하거나 로그인 화면으로 돌아오면 다시 가린다.
export function setLoginPasswordShown(shown) {
  $('#login-password').type = shown ? 'text' : 'password';
  $('#login-password-toggle').setAttribute('aria-pressed', String(shown));
}
$('#login-password-toggle').addEventListener('click', () => {
  setLoginPasswordShown($('#login-password-toggle').getAttribute('aria-pressed') !== 'true');
});

// RPC가 세션 만료·권한 없음으로 실패했으면 로그인 화면으로 보내고 true.
export function authFailed(err) {
  if (!err?.auth) return false;
  hooks.leaveApp(err.message);
  return true;
}

// 머리글·미션 기록 이름에 쓰는 아이디(계약 C4): app_metadata.login_id(서버가 정한 값) → user_metadata.login_id
// → 이메일(xn--…@sistech.local)을 한글로 되살린 값. 계정 목록의 login_id도 서버가 같은 순서로 준다.
export const displayName = (user) =>
  String(user.app_metadata?.login_id ?? '').trim() ||
  String(user.user_metadata?.login_id ?? '').trim() ||
  loginId.emailToLoginId(user.email ?? '');

// 역할에 따라 화면 전체를 맞춘다: <body>의 role-contractor 클래스(CSS가 숨김)와 data-role, 머리글 버튼.
// 숨겨도 초점이 갈 수 있는 곳이 없도록 hidden도 함께 건다. 실제 막기는 각 기능의 JS 검사가 한다.
// 로그인·로그아웃·다른 계정으로 바꿀 때, 역할을 서버에서 새로 받았을 때마다 부른다.
export function applyRole() {
  const role = currentUser?.role ?? null;
  const contractor = role === 'contractor';
  document.body.classList.toggle('role-contractor', contractor);
  if (role) document.body.dataset.role = role;
  else delete document.body.dataset.role;
  $('#import-button').hidden = contractor;
  $('#export-button').hidden = contractor;
  // 계정 관리 버튼은 관리자에게만.
  $('#accounts-button').hidden = !currentUser?.admin;
}

export function showUserName() {
  const name = currentUser?.name ?? '';
  // 이름만 보인다(역할 글자 없음). 길면 .name-text가 …으로 줄인다.
  const el = $('#user-name');
  fill(el, h('span', { class: 'name-text' }, name));
  el.title = name;
  // 휴대폰 머리글의 아이디(☰ 왼쪽)도 같은 글로 맞춘다. 비면 숨긴다.
  const bar = $('#topbar-user');
  fill($('#topbar-user-name'), h('span', { class: 'name-text' }, name));
  bar.title = name;
  bar.setAttribute('aria-label', `로그인: ${name}`);
  bar.hidden = !name;
  applyRole();
}
