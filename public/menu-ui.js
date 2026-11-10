// 휴대폰 머리글 메뉴(☰): 767px 이하에서는 CSV 가져오기·내보내기·계정 관리·아이디·로그아웃 줄(.actions)을 숨겨 두고
// ☰ 단추로 펼치고 접는다(펼친 칸은 머리글 아래에 겹쳐 뜬다, styles.css .topbar.menu-open). 넓은 화면에서는 CSS가 ☰를
// 숨기고 버튼을 머리글에 그대로 늘어놓으므로 여기서 할 일이 없다. 모양은 "펼침 단추 + 영역"(aria-expanded)이라
// 열어도 초점은 ☰에 두고, Tab으로 펼친 칸 안 버튼으로 넘어간다. dom.js만 쓰는 아래쪽 모듈이다.
import { $ } from './dom.js';

const topbar = $('.topbar');
const menuButton = $('#menu-button');
const actions = $('#top-actions');
// [내보내기]의 작은 메뉴(import-ui.js). 펼친 칸 위에 한 겹 더 뜨므로, 그 안을 눌러도 펼친 칸을 닫지 않는다.
const exportMenu = $('#export-menu');
const narrow = matchMedia('(max-width: 767px)');

export const topMenuOpen = () => topbar.classList.contains('menu-open');

function setOpen(open) {
  topbar.classList.toggle('menu-open', open);
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
}

// focus: 닫은 뒤 ☰로 초점을 돌려놓는다(키보드로 쓰던 사람이 길을 잃지 않게).
export function closeTopMenu({ focus = false } = {}) {
  if (!topMenuOpen()) return;
  setOpen(false);
  if (focus) menuButton.focus();
}

// 머리글 버튼(계정 관리 등)으로 초점을 돌려놓을 때 쓴다. 휴대폰에서는 그 버튼이 접힌 칸 안에 숨어 있으므로 ☰로 보낸다.
export const headerFocusTarget = (selector) => (narrow.matches && !topMenuOpen() ? '#menu-button' : selector);

menuButton.addEventListener('click', () => setOpen(!topMenuOpen()));

// 펼친 칸 안의 버튼을 누르면 할 일을 한 뒤 접는다. 작은 메뉴를 띄우는 버튼([내보내기], aria-haspopup)은 고를 때까지
// 펼쳐 둔다(옛 csv.js처럼 메뉴 없이 바로 내보내는 판이면 바로 접는다). 단추 자신의 click 처리가 먼저 돌고 여기로 올라온다.
// 파일 고르기 창을 여는 숨은 input은 버튼이 아니라 건너뛴다.
actions.addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (button && button.getAttribute('aria-haspopup') !== 'menu') closeTopMenu();
});

// [내보내기] 메뉴에서 항목을 고르면 펼친 칸도 접는다. 고른 항목·[내보내기]는 숨으므로 초점은 ☰로.
exportMenu.addEventListener('click', (e) => {
  if (e.target.closest('.menu-item') && topMenuOpen()) closeTopMenu({ focus: true });
});

// Esc는 펼친 칸만 접는다(상세 정보 닫기로 넘어가지 않게). [내보내기] 메뉴의 Esc는 그쪽이 먼저 받아 그 메뉴만 닫는다.
topbar.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !topMenuOpen()) return;
  e.preventDefault();
  e.stopPropagation();
  closeTopMenu({ focus: true });
});

// 머리글·[내보내기] 메뉴 밖을 누르면 접는다. 넓은 화면으로 바뀌면(가로로 돌림 등) 접어 둔다.
document.addEventListener('pointerdown', (e) => {
  if (topMenuOpen() && !topbar.contains(e.target) && !exportMenu.contains(e.target)) closeTopMenu();
});
narrow.addEventListener('change', () => closeTopMenu());
