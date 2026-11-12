// 휴대폰 머리글 메뉴(☰, menu-ui.js).
// 390: ☰만 보이고 버튼 줄은 접힘, 펼치면 머리글 아래 겹쳐 뜸(머리글 높이 그대로), Esc·바깥 누르기·버튼 누르기로 접힘,
// [내보내기]는 메뉴를 고를 때까지 펼쳐 둠, 계정 관리 닫으면 초점 ☰. 1280: ☰ 없이 버튼이 머리글에 그대로.
import { launch, prepare, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('ux-menu');
const ADMIN = 'admin@sistech.test';
// 머리글 아이디 옆에 역할이 붙는다(관리자·외주만, 직원은 없음).
const ADMIN_SHOWN = `${ADMIN}`;
const places = [
  { name: 'SW_01', district: '태안', address: '가람면 하늘리', lat: 37.277767, lng: 126.717126, mission: 'M_01 ~ _34' },
  { name: 'SW_02', district: '태안', address: '가람면 바람리', lat: 37.167923, lng: 126.815733, mission: 'N_01 ~ _02' },
];
const captureExports = `(() => {
  window.__exports = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { const url = orig(blob); window.__exports.push({ blob, url }); return url; };
  HTMLAnchorElement.prototype.click = function () { const e = window.__exports.at(-1); if (e && this.href === e.url) e.download = this.download; };
})()`;

const b = await launch('ux-menu', { viewport: [390, 844, true] });
const ev = b.ev;
await prepare(b, { places, admins: [ADMIN] });
await ev(captureExports);

const header = `(() => {
  const q = (s) => document.querySelector(s);
  const shown = (s) => { const el = q(s); return !!el && el.offsetParent !== null && el.getClientRects().length > 0; };
  const r = (s) => q(s).getBoundingClientRect();
  const items = ['#import-button', '#export-button', '#accounts-button', '#logout-button'];
  return {
    menuShown: shown('#menu-button'), expanded: q('#menu-button').getAttribute('aria-expanded'), label: q('#menu-button').getAttribute('aria-label'),
    open: q('.topbar').classList.contains('menu-open'),
    items: items.filter(shown), user: shown('#user-name') ? q('#user-name').textContent : null,
    topUser: shown('#topbar-user') ? q('#topbar-user-name').textContent : null,
    topUserRight: shown('#topbar-user') ? Math.round(r('#topbar-user').right) : null, menuLeft: Math.round(r('#menu-button').left),
    minH: Math.min(...items.filter(shown).map((s) => r(s).height)),
    inside: items.filter(shown).every((s) => r(s).left >= 0 && r(s).right <= innerWidth),
    below: shown('#top-actions') ? r('#top-actions').top >= r('.topbar').bottom : null,
    topbarH: Math.round(r('.topbar').height), mapH: Math.round(r('#map').height),
    overflowX: document.documentElement.scrollWidth > innerWidth, active: document.activeElement?.id || document.activeElement?.tagName,
    exportMenu: !q('#export-menu').hidden, accounts: !q('#accounts-panel').hidden,
  };
})()`;

// ── 390: 접힌 상태 ──
let v0 = await ev(header);
check('390: ☰만 보이고 버튼 줄(가져오기·내보내기·계정 관리·로그아웃)은 접힘', v0.menuShown && v0.items.length === 0 && v0.expanded === 'false' && v0.label === '메뉴 열기' && !v0.open, v0);
check('390: 제목 한 줄 + ☰, 머리글 높이 64px 이하, 가로 넘침 없음', v0.topbarH <= 64 && !v0.overflowX && (await ev(`document.querySelector('.topbar h1').getClientRects().length === 1 && document.querySelector('.topbar h1').getBoundingClientRect().height < 30`)), v0);
check('390: 접혀 있어도 아이디가 ☰ 왼쪽에 보임(머리글 안)', v0.topUser === ADMIN_SHOWN && v0.topUserRight <= v0.menuLeft && v0.user === null, v0);
await b.shot('ux-menu-closed-390');

// ── 펼치기 ──
await ev(`document.querySelector('#menu-button').click()`); await sleep(100);
let v = await ev(header);
check('☰ → 네 버튼이 머리글 아래에(아이디는 머리글에 한 번만) 펼쳐짐(aria-expanded, "메뉴 닫기")',
  v.open && v.expanded === 'true' && v.label === '메뉴 닫기' && v.items.join() === '#import-button,#export-button,#accounts-button,#logout-button' && v.user === null && v.topUser === ADMIN_SHOWN && v.below, v);
check('펼쳐도 머리글 높이·지도 크기 그대로, 화면 안, 버튼 높이 44px 이상', v.topbarH === v0.topbarH && v.mapH === v0.mapH && v.inside && !v.overflowX && v.minH >= 44, { v0, v });
check('펼쳐도 초점을 펼친 칸 안으로 옮기지 않음(펼침 단추)', !(await ev(`document.querySelector('#top-actions').contains(document.activeElement)`)), v);
await b.shot('ux-menu-open-390');

// Esc → 접히고 ☰로
await ev(`document.querySelector('#menu-button').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(100);
v = await ev(header);
check('Esc → 접힘, 초점 ☰, 상세 정보·다른 창은 그대로', !v.open && v.expanded === 'false' && v.active === 'menu-button' && v.items.length === 0, v);

// 바깥 누르기 → 접힘 / ☰ 다시 누르기 → 접힘
await ev(`document.querySelector('#menu-button').click()`); await sleep(50);
await ev(`document.querySelector('#search').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`); await sleep(50);
v = await ev(header);
check('바깥(검색 칸) 누르기 → 접힘', !v.open && v.items.length === 0, v);
await ev(`document.querySelector('#menu-button').click()`); await sleep(50);
await ev(`document.querySelector('#menu-button').click()`); await sleep(50);
v = await ev(header);
check('☰를 다시 누르면 접힘', !v.open && v.expanded === 'false', v);

// [내보내기]: 메뉴를 고를 때까지 펼쳐 두고, 고르면 둘 다 닫고 초점 ☰
await ev(`document.querySelector('#menu-button').click()`); await sleep(50);
await ev(`document.querySelector('#export-button').click()`); await sleep(150);
v = await ev(header);
const exportPos = await ev(`(() => { const m = document.querySelector('#export-menu').getBoundingClientRect(); return { inside: m.left >= 0 && m.right <= innerWidth, top: m.top >= document.querySelector('#export-button').getBoundingClientRect().bottom, z: getComputedStyle(document.querySelector('#export-menu')).zIndex > getComputedStyle(document.querySelector('#top-actions')).zIndex }; })()`);
check('[내보내기] → 작은 메뉴가 펼친 칸 위에 뜨고, 펼친 칸은 그대로', v.open && v.exportMenu && exportPos.inside && exportPos.top && exportPos.z, { v, exportPos });
await b.shot('ux-menu-export-390');
await ev(`document.querySelector('#export-menu').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
await ev(`document.querySelector('#export-places').click()`); await sleep(200);
v = await ev(header);
const download = await ev(`window.__exports.at(-1)?.download ?? null`);
check('장소 내보내기 → 파일 받음, 작은 메뉴·펼친 칸 모두 닫힘, 초점 ☰', /^places-\d{4}-\d{2}-\d{2}\.csv$/.test(download ?? '') && !v.exportMenu && !v.open && v.active === 'menu-button', { v, download });

// [내보내기] 메뉴에서 Esc → 작은 메뉴만 닫히고 펼친 칸은 남음
await ev(`document.querySelector('#menu-button').click()`); await sleep(50);
await ev(`document.querySelector('#export-button').click()`); await sleep(100);
await ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(100);
v = await ev(header);
check('[내보내기] 메뉴에서 Esc → 작은 메뉴만 닫힘, 펼친 칸은 남고 초점 [내보내기]', !v.exportMenu && v.open && v.active === 'export-button', v);
await ev(`document.querySelector('#export-button').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(50);

// 계정 관리 → 펼친 칸 접힘, 창 열림. [닫기] → 초점 ☰
await ev(`document.querySelector('#menu-button').click()`); await sleep(50);
await ev(`document.querySelector('#accounts-button').click()`);
await b.waitFor(`!!document.querySelector('#accounts-close')`, 3000);
await sleep(200);
v = await ev(header);
check('계정 관리 → 펼친 칸 접힘, 계정 관리 창 열림', !v.open && v.accounts, v);
await ev(`document.querySelector('#accounts-close').click()`); await sleep(200);
v = await ev(header);
check('계정 관리 [닫기] → 초점 ☰(계정 관리 버튼은 접힌 칸 안에 숨어 있음)', !v.accounts && v.active === 'menu-button', v);

// 로그아웃 → 로그인 화면, 다시 로그인하면 접힌 상태
await ev(`document.querySelector('#menu-button').click()`); await sleep(50);
await ev(`document.querySelector('#logout-button').click()`);
await b.waitFor(`!document.querySelector('#login').hidden`, 3000);
v = await ev(header);
check('로그아웃 → 로그인 화면, 머리글 메뉴 접힘', !v.open && v.expanded === 'false', v);
await prepare(b, { places, admins: [ADMIN] });

// ── 1280: ☰ 없이 버튼을 그대로 ──
await b.setViewport(1280, 800, false); await sleep(300);
v = await ev(header);
check('1280: ☰ 숨김, 버튼 네 개와 아이디가 머리글에 그대로', !v.menuShown && v.items.length === 4 && v.user === ADMIN_SHOWN && !v.overflowX, v);
await b.shot('ux-menu-1280');
// 넓은 화면으로 바뀌면 펼친 칸을 접어 둔다
await b.setViewport(390, 844, true); await sleep(200);
await ev(`document.querySelector('#menu-button').click()`); await sleep(50);
await b.setViewport(1280, 800, false); await sleep(300);
await b.setViewport(390, 844, true); await sleep(300);
v = await ev(header);
check('펼친 채 넓은 화면으로 바뀌면 접힘(다시 좁혀도 접힌 상태)', !v.open && v.items.length === 0, v);

await finish(b);
