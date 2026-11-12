// 앱(WebView) 전용 — 휴대폰 [뒤로] 버튼을 누르면 앱이 이 식을 페이지에서 실행한다(MainActivity.goBack).
// 열린 것이 있으면 사이트의 Esc 처리로 하나만 닫고 true, 닫을 것이 없으면 false(앱이 백그라운드로 내려간다).
// 닫는 순서: [내보내기] 메뉴 → 미션 기록 창 → ☰ 메뉴 → 계정 관리 → 상세 정보.
// 사이트의 아이디·클래스(#export-menu, dialog, .topbar.menu-open, #accounts-panel, #detail)에 맞춰 두었다.
// 사이트에서 이 이름을 바꾸면 여기도 고친다(못 찾으면 그냥 앱이 내려갈 뿐 오류는 없다).
// [내보내기] 메뉴·☰ 메뉴·계정 관리는 Esc 처리가 그 요소 자체에 붙어 있어 위로 올려 보내지 않는다(bubbles: false).
// 올려 보내면 문서 전체의 상세 정보 Esc 처리(detail-ui.js)까지 닿아, 예를 들어 계정 관리가 저장 중이라 안 닫힐 때
// 뒤의 상세 정보가 대신 닫힌다. 미션 기록 창과 상세 정보는 처리가 document에 있으므로 위로 올려 보낸다.
(() => {
  const shown = (el) => Boolean(el) && !el.hidden && el.getClientRects().length > 0;
  const esc = (target, bubbles) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles, cancelable: true }));
    return true;
  };
  const exportMenu = document.getElementById('export-menu');
  if (shown(exportMenu)) return esc(exportMenu, false);
  const dialog = document.querySelector('dialog[open]');
  if (dialog) return esc(dialog, true);
  const topbar = document.querySelector('.topbar.menu-open');
  if (topbar) return esc(topbar, false);
  const accounts = document.getElementById('accounts-panel');
  if (shown(accounts)) return esc(accounts, false);
  if (shown(document.getElementById('detail'))) return esc(document.body, true);
  return false;
})();
