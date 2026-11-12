// 계정 관리 창: 목록·새 계정·비밀번호 재설정([보기], 길이 규칙, 다른 계정 확인, 본인 재설정 뒤 로그아웃). Edge Function admin-users를 부른다.
import { $, fill, h, refocus } from './dom.js';
import { headerFocusTarget } from './menu-ui.js';
import { hooks } from './state.js';
import { authEpoch, authFailed, currentUser, setLoggingOut } from './session.js';
import { saveAllMemos } from './memo-ui.js';
import { confirmDiscardDraft } from './missions-ui.js';
import * as loginId from './login-id.js';
import * as api from './api.js';

// 권한 이름과 "~로 바꿨습니다" 문구. 관리자는 여기서 바꿀 수 없다(직원 ↔ 외주만).
const ROLE_LABELS = { admin: '관리자', staff: '직원', contractor: '외주' };
const ROLE_TO = { staff: '직원으로', contractor: '외주로' };
// 계정의 권한. 서버가 role을 안 주는 옛 판에서는 is_admin으로, 그것도 아니면 직원으로 본다.
const roleOf = (u) => (u.is_admin || u.role === 'admin' ? 'admin' : u.role === 'contractor' ? 'contractor' : 'staff');

// 로그인 화면으로 보내기는 app.js에 있어 hooks로 부른다.
const leaveApp = (...args) => hooks.leaveApp(...args);

// ── 계정 관리(관리자만) ─────────────────────────────────

// 비밀번호 규칙은 login-id.js(인증 담당)를 따른다. 아직 그 값이 없는 판에서도 열리도록 같은 규칙(길이만)으로 대신한다.
// 화면 검사는 미리 막는 용도이고, 최종 판정과 문구는 서버(Edge Function) 응답을 그대로 보여 준다.
const PASSWORD_MIN = loginId.PASSWORD_MIN ?? 6;
const PASSWORD_MAX_BYTES = loginId.PASSWORD_MAX ?? 72;
const PASSWORD_RULE = loginId.PASSWORD_RULE ?? '비밀번호는 6자 이상 72자 이하여야 합니다.';
const passwordOk = (pw) =>
  loginId.isValidPassword?.(pw) ??
  (typeof pw === 'string' && pw.length >= PASSWORD_MIN && new TextEncoder().encode(pw).length <= PASSWORD_MAX_BYTES);
const SELF_RESET_NOTICE = '본인 비밀번호를 바꾸면 모든 기기에서 로그아웃됩니다.';
// 본인 비밀번호를 바꾼 뒤 로그인 화면에 띄우는 안내(만료 안내와 다른 칸·다른 모양).
const PASSWORD_CHANGED_NOTICE = '비밀번호를 바꿨습니다. 새 비밀번호로 다시 로그인해 주세요.';

// 계정 관리 창의 상태. 장소 목록(state)과는 별개라 로그아웃하면 통째로 비운다.
export const accounts = {
  open: false,
  loading: false, // 목록을 받는 중
  busy: false, // 만들기·재설정 요청 중(그동안 버튼을 모두 잠근다)
  users: null, // 서버가 준 계정 목록. 아직 못 받았으면 null
  error: null, // 창 안 메시지 영역에 빨갛게
  notice: null, // 창 안 메시지 영역에 보통 글씨로(성공 안내)
  resetId: null, // 비밀번호를 바꾸는 중인 계정 id
  resetPassword: '',
  resetInvalid: false,
  resetShown: false, // 재설정 비밀번호 칸 [보기]
  rolePending: null, // 권한을 바꾸는 요청 중이면 { id, role }(그동안 그 칸에 새 값을 보여 준다)
  // 새 계정 폼. 다시 그려도 적던 글자가 남게 여기에 둔다.
  create: { loginId: '', password: '', role: 'staff', invalid: null, shown: false },
};

export const accountsReset = () =>
  Object.assign(accounts, {
    open: false,
    loading: false,
    busy: false,
    users: null,
    error: null,
    notice: null,
    resetId: null,
    resetPassword: '',
    resetInvalid: false,
    resetShown: false,
    rolePending: null,
    create: { loginId: '', password: '', role: 'staff', invalid: null, shown: false },
  });

// 계정 목록에 보여 줄 아이디. 서버가 login_id를 못 주면(대시보드에서 만든 계정 등) 이메일에서 되살린다.
const accountName = (u) => String(u.login_id ?? '').trim() || loginId.emailToLoginId(u.email ?? '');

// ISO 시각 → 한국 표기. 없거나 읽을 수 없으면 "-". withTime이면 시:분까지.
function formatWhen(iso, { withTime = false } = {}) {
  if (!iso) return '-';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '-';
  const opts = { year: 'numeric', month: 'numeric', day: 'numeric' };
  if (withTime) Object.assign(opts, { hour: 'numeric', minute: '2-digit' });
  return t.toLocaleString('ko-KR', opts);
}

function setAccountsMessage({ error = null, notice = null } = {}) {
  accounts.error = error;
  accounts.notice = notice;
}

// 비밀번호 칸 + [보기] 단추. 누르면 글자가 보이고(aria-pressed="true") 다시 누르면 가린다.
// 다시 그려도 상태가 남도록 보이는지 여부는 호출하는 쪽 상태(shown)에 둔다.
function passwordField({ id, name, autocomplete, value, placeholder, shown, disabled, invalid, oninput, onToggle }) {
  return h(
    'span',
    { class: 'pw-field' },
    h('input', {
      id,
      type: shown ? 'text' : 'password',
      name,
      autocomplete,
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      placeholder,
      value,
      disabled,
      'aria-invalid': invalid ? 'true' : null,
      oninput,
    }),
    h(
      'button',
      {
        type: 'button',
        class: 'pw-toggle',
        'aria-controls': id,
        'aria-pressed': String(Boolean(shown)),
        'aria-label': '비밀번호 보기',
        disabled,
        onclick: () => {
          onToggle();
          refocus(`#${id} + .pw-toggle`);
        },
      },
      '보기',
    ),
  );
}

// 창을 열고 목록을 받는다. 이미 열려 있으면 목록만 새로 받는다.
function openAccounts() {
  if (!currentUser?.admin) return;
  accounts.open = true;
  renderAccounts();
  $('.panel').scrollTo({ top: 0, behavior: 'smooth' });
  loadAccounts().then(() => refocus('#accounts-close'));
}

function closeAccounts() {
  if (accounts.busy) return;
  accountsReset();
  renderAccounts();
  refocus(headerFocusTarget('#accounts-button'));
}

// 목록을 새로 받는다. 세션이 끝났으면 로그인 화면으로 가고, 다른 실패는 창 안에 보여 준다.
async function loadAccounts() {
  const epoch = authEpoch;
  accounts.loading = true;
  renderAccounts();
  try {
    const users = await api.listAccounts();
    if (epoch !== authEpoch || !accounts.open) return;
    accounts.users = users;
    accounts.error = null;
  } catch (err) {
    if (authFailed(err) || epoch !== authEpoch || !accounts.open) return;
    accounts.error = err.message;
  }
  accounts.loading = false;
  renderAccounts();
}

// 새 계정 폼의 입력을 검사한다. 어긋난 칸 이름('loginId' | 'password')과 문구를 돌려주고, 괜찮으면 null.
function createFormProblem(id, password) {
  if (loginId.normalizeLoginId(id) === null) return { field: 'loginId', message: loginId.LOGIN_ID_RULE };
  if (!passwordOk(password)) return { field: 'password', message: PASSWORD_RULE };
  return null;
}

async function submitCreate() {
  if (accounts.busy || accounts.loading) return;
  const id = loginId.normalizeLoginId(accounts.create.loginId);
  const problem = createFormProblem(accounts.create.loginId, accounts.create.password);
  if (problem) {
    accounts.create.invalid = problem.field;
    setAccountsMessage({ error: problem.message });
    renderAccounts();
    refocus(`#accounts-new-${problem.field === 'loginId' ? 'id' : 'password'}`);
    return;
  }
  const epoch = authEpoch;
  accounts.busy = true;
  accounts.create.invalid = null;
  setAccountsMessage();
  renderAccounts();
  try {
    const role = accounts.create.role === 'contractor' ? 'contractor' : 'staff';
    await api.createAccount(id, accounts.create.password, role);
    if (epoch !== authEpoch || !accounts.open) return;
    accounts.create = { loginId: '', password: '', role: 'staff', invalid: null, shown: false };
    accounts.busy = false;
    setAccountsMessage({ notice: role === 'contractor' ? `${id} 계정을 외주로 만들었습니다.` : `${id} 계정을 만들었습니다.` });
    await loadAccounts();
    if (epoch === authEpoch && accounts.open) refocus('#accounts-new-id');
  } catch (err) {
    if (authFailed(err) || epoch !== authEpoch || !accounts.open) return;
    accounts.busy = false;
    setAccountsMessage({ error: err.message });
    renderAccounts();
    refocus('#accounts-new-id');
  }
}

// 직원 ↔ 외주. 요청하는 동안 표의 단추를 모두 잠그고, 실패하면 서버 문구를 보여 주고 이전 값으로 되돌린다(다시 그리면 목록 값이 그대로다).
async function submitRole(user, role) {
  if (accounts.busy || accounts.loading) return;
  // 관리자 계정(본인 포함)은 바꿀 수 없다. 화면에는 단추를 두지 않지만 한 번 더 막는다.
  if (roleOf(user) === 'admin' || user.id === currentUser?.id || roleOf(user) === role) return;
  const epoch = authEpoch;
  accounts.busy = true;
  accounts.rolePending = { id: user.id, role };
  setAccountsMessage();
  renderAccounts();
  const selector = `#accounts-panel select[data-role-user="${CSS.escape(String(user.id))}"]`;
  try {
    const changed = await api.setAccountRole(user.id, role);
    if (epoch !== authEpoch || !accounts.open) return;
    accounts.users = accounts.users.map((x) => (x.id === user.id ? { ...x, ...(changed ?? {}), role: changed?.role ?? role } : x));
    accounts.busy = false;
    accounts.rolePending = null;
    setAccountsMessage({ notice: `${accountName(user)} 계정의 권한을 ${ROLE_TO[role]} 바꿨습니다.` });
    renderAccounts();
    refocus(selector);
  } catch (err) {
    if (authFailed(err) || epoch !== authEpoch || !accounts.open) return;
    accounts.busy = false;
    accounts.rolePending = null;
    setAccountsMessage({ error: err.message });
    renderAccounts();
    refocus(selector);
  }
}

function startReset(userId) {
  if (accounts.busy) return;
  accounts.resetId = userId;
  accounts.resetPassword = '';
  accounts.resetInvalid = false;
  accounts.resetShown = false;
  setAccountsMessage();
  renderAccounts();
  refocus('#accounts-reset-password');
}

function cancelReset() {
  if (accounts.busy) return;
  const id = accounts.resetId;
  accounts.resetId = null;
  accounts.resetPassword = '';
  accounts.resetInvalid = false;
  accounts.resetShown = false;
  renderAccounts();
  refocus(`#accounts-panel button[data-reset="${CSS.escape(String(id))}"]`);
}

// 본인 비밀번호를 바꿨으면 이 기기에서도 로그아웃하고, 로그인 화면에 "새 비밀번호로 다시 로그인" 안내를 띄운다.
async function signOutAfterOwnPasswordChange() {
  setLoggingOut(true);
  try {
    await api.signOut();
  } catch (err) {
    // 서버가 이미 모든 세션을 끊었으면 실패할 수 있다. 이 기기의 화면은 어차피 로그인으로 돌린다.
    api.logCause('본인 비밀번호 변경 뒤 로그아웃 실패(무시)', err);
  } finally {
    setLoggingOut(false);
  }
  leaveApp(null, { notice: PASSWORD_CHANGED_NOTICE });
}

async function submitReset() {
  if (accounts.busy || accounts.resetId === null) return;
  const user = accounts.users?.find((u) => u.id === accounts.resetId);
  if (!user) return;
  if (!passwordOk(accounts.resetPassword)) {
    accounts.resetInvalid = true;
    setAccountsMessage({ error: PASSWORD_RULE });
    renderAccounts();
    refocus('#accounts-reset-password');
    return;
  }
  const self = user.id === currentUser?.id;
  // 다른 사람 계정은 한 번 더 확인한다(그 사람이 모든 기기에서 로그아웃된다). 본인은 단추 이름이 [바꾸고 로그아웃]이라 묻지 않는다.
  if (!self && !confirm(`${accountName(user)} 계정의 비밀번호를 바꿀까요? 그 계정은 모든 기기에서 로그아웃됩니다.`)) {
    refocus('#accounts-reset-password');
    return;
  }
  // 본인이면 곧 로그아웃되므로, 바꾸기 전에 저장하지 않은 미션 기록을 묻고 메모는 끝까지 저장해 둔다.
  if (self) {
    if (!confirmDiscardDraft()) {
      refocus('#accounts-reset-password');
      return;
    }
    await saveAllMemos();
  }
  const epoch = authEpoch;
  accounts.busy = true;
  accounts.resetInvalid = false;
  setAccountsMessage();
  renderAccounts();
  try {
    await api.resetAccountPassword(user.id, accounts.resetPassword);
    if (epoch !== authEpoch || !accounts.open) return;
    if (self) {
      await signOutAfterOwnPasswordChange();
      return;
    }
    accounts.busy = false;
    accounts.resetId = null;
    accounts.resetPassword = '';
    accounts.resetShown = false;
    setAccountsMessage({ notice: `${accountName(user)} 계정의 비밀번호를 바꿨습니다.` });
    renderAccounts();
    refocus(`#accounts-panel button[data-reset="${CSS.escape(String(user.id))}"]`);
  } catch (err) {
    if (authFailed(err) || epoch !== authEpoch || !accounts.open) return;
    accounts.busy = false;
    setAccountsMessage({ error: err.message });
    renderAccounts();
    refocus('#accounts-reset-password');
  }
}

// 표를 display: block으로 쌓아 보이면 화면 읽기 프로그램이 표 구조를 잃는다. role을 직접 달아 표로 읽히게 한다.
const cell = (props, ...children) => h('td', { role: 'cell', ...props }, ...children);

// 비밀번호를 바꾸는 중인 계정의 행: 아이디 + (본인이면 경고) + 새 비밀번호 입력 + 확인·취소.
function accountResetRow(u, self) {
  const disabled = accounts.busy;
  return h(
    'tr',
    { class: 'accounts-row resetting', 'data-user-id': u.id, role: 'row' },
    cell(
      { colspan: 5 },
      h(
        'form',
        {
          class: self ? 'accounts-reset self' : 'accounts-reset',
          onsubmit: (e) => {
            e.preventDefault();
            submitReset();
          },
        },
        h('p', { class: 'accounts-reset-title' }, h('b', {}, accountName(u)), ' 비밀번호 재설정'),
        self && h('p', { class: 'accounts-self-notice', role: 'note' }, SELF_RESET_NOTICE),
        // [보기] 단추가 label 안에 들어가지 않게 칸 이름(label)과 입력 묶음을 나란히 둔다.
        h(
          'div',
          { class: 'field' },
          h('label', { for: 'accounts-reset-password' }, '새 비밀번호'),
          passwordField({
            id: 'accounts-reset-password',
            name: 'new-password',
            autocomplete: 'new-password',
            value: accounts.resetPassword,
            placeholder: `${PASSWORD_MIN}자 이상`,
            shown: accounts.resetShown,
            disabled,
            invalid: accounts.resetInvalid,
            oninput: (e) => {
              accounts.resetPassword = e.target.value;
              if (accounts.resetInvalid) {
                accounts.resetInvalid = false;
                e.target.removeAttribute('aria-invalid');
              }
            },
            onToggle: () => {
              accounts.resetShown = !accounts.resetShown;
              renderAccounts();
            },
          }),
        ),
        h(
          'div',
          { class: 'button-row' },
          h('button', { type: 'submit', class: self ? 'btn primary danger' : 'btn primary', disabled }, disabled ? '바꾸는 중…' : self ? '바꾸고 로그아웃' : '확인'),
          h('button', { type: 'button', class: 'btn', disabled, onclick: cancelReset }, '취소'),
        ),
      ),
    ),
  );
}

// 권한 칸: 관리자는 글자만, 나머지는 직원/외주 고르는 칸. 요청 중에는 모두 잠근다.
function roleCell(u, self) {
  const role = roleOf(u);
  if (role === 'admin' || self) return h('span', { class: 'accounts-role-text' }, ROLE_LABELS[role]);
  const shown = accounts.rolePending?.id === u.id ? accounts.rolePending.role : role;
  return h(
    'select',
    {
      class: 'accounts-role-select',
      'data-role-user': u.id,
      'aria-label': `${accountName(u)} 권한`,
      disabled: accounts.busy || accounts.loading,
      onchange: (e) => submitRole(u, e.target.value),
    },
    ['staff', 'contractor'].map((r) => h('option', { value: r, selected: r === shown }, ROLE_LABELS[r])),
  );
}

function accountRow(u) {
  const self = u.id === currentUser?.id;
  if (accounts.resetId === u.id) return accountResetRow(u, self);
  return h(
    'tr',
    { class: 'accounts-row', 'data-user-id': u.id, role: 'row' },
    cell(
      { class: 'accounts-id', 'data-label': '아이디' },
      h('span', { class: 'accounts-name' }, accountName(u)),
      u.is_admin && h('span', { class: 'badge accounts-admin' }, '관리자'),
      self && h('span', { class: 'accounts-self' }, '(본인)'),
    ),
    cell({ class: 'accounts-role', 'data-label': '권한' }, roleCell(u, self)),
    cell({ class: 'accounts-when', 'data-label': '만든 날' }, formatWhen(u.created_at)),
    cell({ class: 'accounts-when', 'data-label': '마지막 로그인' }, formatWhen(u.last_sign_in_at, { withTime: true })),
    cell(
      { class: 'accounts-actions' },
      h('button', { type: 'button', class: 'btn small', 'data-reset': u.id, disabled: accounts.busy || accounts.loading, onclick: () => startReset(u.id) }, '비밀번호 재설정'),
    ),
  );
}

function accountsTable() {
  const users = accounts.users;
  if (!users) return accounts.loading ? h('p', { class: 'hint accounts-status' }, '계정 목록을 불러오는 중…') : null;
  if (users.length === 0) return h('p', { class: 'hint accounts-status' }, '계정이 없습니다.');
  const head = (text) => h('th', { scope: 'col', role: 'columnheader' }, text);
  return h(
    'table',
    { class: 'accounts-table', role: 'table', 'aria-label': '계정 목록' },
    h(
      'thead',
      { role: 'rowgroup' },
      h('tr', { role: 'row' }, head('아이디'), head('권한'), head('만든 날'), head('마지막 로그인'), head(h('span', { class: 'sr-only' }, '동작'))),
    ),
    h('tbody', { role: 'rowgroup' }, users.map(accountRow)),
  );
}

function accountsCreateForm() {
  const disabled = accounts.busy;
  const { create } = accounts;
  return h(
    'form',
    {
      class: 'accounts-create',
      autocomplete: 'off',
      onsubmit: (e) => {
        e.preventDefault();
        submitCreate();
      },
    },
    h('h3', {}, '새 계정'),
    h(
      'div',
      { class: 'accounts-create-fields' },
      h(
        'label',
        { class: 'field' },
        h('span', {}, '아이디'),
        h('input', {
          id: 'accounts-new-id',
          type: 'text',
          name: 'new-login-id',
          autocomplete: 'off',
          autocapitalize: 'off',
          autocorrect: 'off',
          spellcheck: 'false',
          placeholder: '예: 홍길동',
          value: create.loginId,
          disabled,
          'aria-invalid': create.invalid === 'loginId' ? 'true' : null,
          oninput: (e) => {
            create.loginId = e.target.value;
            if (create.invalid === 'loginId') {
              create.invalid = null;
              e.target.removeAttribute('aria-invalid');
            }
          },
        }),
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'accounts-new-password' }, '비밀번호'),
        passwordField({
          id: 'accounts-new-password',
          name: 'new-password',
          autocomplete: 'new-password',
          value: create.password,
          placeholder: `${PASSWORD_MIN}자 이상`,
          shown: create.shown,
          disabled,
          invalid: create.invalid === 'password',
          oninput: (e) => {
            create.password = e.target.value;
            if (create.invalid === 'password') {
              create.invalid = null;
              e.target.removeAttribute('aria-invalid');
            }
          },
          onToggle: () => {
            create.shown = !create.shown;
            renderAccounts();
          },
        }),
      ),
      // 새 계정의 권한: 직원(기본) 또는 외주.
      h(
        'label',
        { class: 'field field-role' },
        h('span', {}, '권한'),
        h(
          'select',
          {
            id: 'accounts-new-role',
            name: 'new-role',
            disabled,
            onchange: (e) => {
              create.role = e.target.value === 'contractor' ? 'contractor' : 'staff';
            },
          },
          h('option', { value: 'staff', selected: create.role !== 'contractor' }, '직원'),
          h('option', { value: 'contractor', selected: create.role === 'contractor' }, '외주'),
        ),
      ),
    ),
    h('div', { class: 'button-row' }, h('button', { id: 'accounts-create-button', type: 'submit', class: 'btn primary', disabled }, disabled ? '만드는 중…' : '만들기')),
  );
}

export function renderAccounts() {
  const box = $('#accounts-panel');
  box.hidden = !accounts.open;
  if (!accounts.open) {
    box.replaceChildren();
    return;
  }
  const message = accounts.error ?? accounts.notice;
  fill(
    box,
    h(
      'div',
      { class: 'accounts-head' },
      h('h2', { id: 'accounts-title' }, '계정 관리'),
      h(
        'div',
        { class: 'accounts-head-buttons' },
        h('button', { type: 'button', class: 'btn small', id: 'accounts-refresh', disabled: accounts.busy || accounts.loading, onclick: () => loadAccounts() }, '새로 고침'),
        h('button', { type: 'button', class: 'icon-btn', id: 'accounts-close', 'aria-label': '닫기', disabled: accounts.busy, onclick: closeAccounts }, '×'),
      ),
    ),
    h('p', { id: 'accounts-message', class: accounts.error ? 'accounts-message error' : 'accounts-message', role: accounts.error ? 'alert' : 'status', hidden: !message }, message ?? ''),
    accountsTable(),
    accountsCreateForm(),
  );
}

$('#accounts-button').addEventListener('click', openAccounts);

// 창 안에서 Esc: 비밀번호를 바꾸는 중이면 그것부터 접고, 아니면 창을 닫는다.
$('#accounts-panel').addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || accounts.busy) return;
  e.stopPropagation();
  if (accounts.resetId !== null) cancelReset();
  else closeAccounts();
});
