// 항목 9: 휴대폰(390×844)·PC(1280×820) 스크린샷. 로그인 화면, 앱 화면(머리글 줄 수·높이), 상세·미션 입력, 콘솔 예외 0건.
import { launch, prepare, q1Rows, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('shots');
const LONG = 'very.long.admin.account@sistech-example.co.kr';
const rows = await q1Rows();
// 휴대폰(☰가 보이는 폭)에서는 머리글 높이·제목을 잰 뒤 ☰를 펼쳐 아이디·로그아웃을 재고 다시 접는다.
// 제목과 나란히 놓이는 것은 넓은 화면에서는 버튼 줄(.actions), 휴대폰에서는 ☰ 단추다.
const metrics = (W) => `(() => {
  const r = (el) => el.getBoundingClientRect();
  const top = document.querySelector('.topbar'), h1 = top.querySelector('h1'), actions = top.querySelector('.actions');
  const menuBtn = document.querySelector('#menu-button'), narrow = menuBtn.offsetParent !== null;
  const lh = parseFloat(getComputedStyle(h1).lineHeight) || parseFloat(getComputedStyle(h1).fontSize) * 1.2;
  const topbar = Math.round(r(top).height), h1r = r(h1), ar = narrow ? r(menuBtn) : r(actions);
  if (narrow) menuBtn.click();
  const kids = [...actions.querySelectorAll(':scope > .btn, :scope > .account')].filter(e => e.offsetParent !== null);
  const rowsTop = [...new Set(kids.map(k => Math.round(r(k).top)))];
  // 휴대폰은 머리글 #topbar-user-name, 넓은 화면은 #user-name을 잰다.
  const email = document.querySelector(narrow ? '#topbar-user-name' : '#user-name');
  const tu = document.querySelector('#topbar-user'), tur = r(tu), mbr = r(menuBtn);
  const out = {
    narrow, topbar, h1Lines: Math.round(h1r.height / lh), actionRows: rowsTop.length,
    sideBySide: h1r.right <= ar.left + 1, overlap: !(h1r.right <= ar.left + 1 || h1r.bottom <= ar.top + 1 || ar.bottom <= h1r.top + 1),
    emailClipped: email.scrollWidth > email.clientWidth, emailTitle: narrow ? tu.title : email.title,
    topUserShown: tu.offsetParent !== null || tur.width > 0, topUserLeftOfMenu: tur.right <= mbr.left + 0.5, topUserInside: tur.left >= 0 && tur.right <= ${W}, topUserH1Gap: Math.round(tur.left - h1r.right), emailWidth: Math.round(r(email).width),
    overflowX: innerWidth !== ${W} || document.documentElement.scrollWidth > ${W} || r(top).right > ${W} + 0.5 || r(actions).right > ${W} + 0.5 || r(document.querySelector('#logout-button')).right > ${W}, mapH: Math.round(r(document.querySelector('#map')).height),
    logoutVisible: (() => { const b = r(document.querySelector('#logout-button')); return b.width > 0 && b.right <= ${W} && b.left >= 0; })(),
  };
  if (narrow) menuBtn.click();
  return out;
})()`;

const b = await launch('shots');
const out = {};
for (const [name, w, h, mobile] of [['390', 390, 844, true], ['1280', 1280, 820, false]]) {
  await b.setViewport(w, h, mobile);
  await prepare(b, { rows, signedIn: false });
  const login = await b.ev(`(() => { const c = document.querySelector('.login-card').getBoundingClientRect(); return { cardW: Math.round(c.width), inside: c.left >= 0 && c.right <= ${w}, overflowX: innerWidth !== ${w} || document.documentElement.scrollWidth > ${w}, focus: document.activeElement?.id }; })()`);
  await b.shot(`login-${name}`);
  check(`${name}: 로그인 카드가 화면 안·가로 넘침 없음`, login.inside && !login.overflowX, login);

  await prepare(b, { rows, email: LONG });
  out[name] = await b.ev(metrics(w));
  await b.shot(`app-${name}`);
  await b.ev(`__e2e.row('SW_01').click()`);
  await sleep(400);
  await b.ev(`document.querySelector('#detail .mission-item').click()`);
  await sleep(300);
  await b.shot(`app-detail-${name}`);
  const detailOverflow = await b.ev(`innerWidth !== ${w} || document.documentElement.scrollWidth > ${w}`);
  check(`${name}: 상세·미션 입력을 연 화면 가로 넘침 없음`, !detailOverflow);
  console.log(name, JSON.stringify(out[name]));
}
// 허용되는 가장 긴 한글 아이디(16자)와 좁은 휴대폰(360)
const LONG_KO = '가나다라마바사아자차카타파하가나다'.slice(0, 16);
const extra = {};
for (const [key, w, user] of [['ko16-390', 390, LONG_KO], ['ko16-360', 360, LONG_KO], ['email-360', 360, null], ['short-390', 390, '손두병']]) {
  await b.setViewport(w, 844, true);
  const email = user ? `${new URL('http://' + user + '/').hostname}@sistech.local` : LONG;
  await prepare(b, { rows, email });
  extra[key] = { ...(await b.ev(metrics(w))), shown: await b.ev(`document.querySelector('#user-name').textContent`) };
  await b.shot(`app-${key}`);
  console.log(key, JSON.stringify(extra[key]));
}
for (const [key, e] of Object.entries(extra)) {
  check(`${key}: 머리글이 화면 폭 안(버튼 잘림·가로 넘침 없음), 아이디 표시`, !e.overflowX && e.logoutVisible && !e.overlap && e.topbar <= 160 && e.emailTitle === e.shown && (!e.narrow || (e.topUserShown && e.topUserLeftOfMenu && e.topUserInside && e.topUserH1Gap >= 0 && e.h1Lines === 1)), e);
}
check('짧은 한글 아이디(손두병)는 잘리지 않음', !extra['short-390'].emailClipped && extra['short-390'].shown === '손두병', extra['short-390']);
const m = out['390'], d = out['1280'];
check('390: 머리글 한 줄(제목 1줄 + ☰ 나란히), 겹침·가로 넘침 없음', m.narrow && m.h1Lines === 1 && m.sideBySide && !m.overlap && !m.overflowX, m);
check('390: 머리글 높이 ≤ 64px, ☰를 펼치면 로그아웃 버튼 화면 안', m.topbar <= 64 && m.logoutVisible, m);
check('390: 머리글의 긴 이메일은 잘리고 툴팁에 전체 주소', m.emailClipped && m.emailTitle === LONG && m.emailWidth <= 112, m);
check('390: 아이디가 ☰ 왼쪽에 늘 보임, 제목과 안 겹침, 머리글 높이 그대로', m.topUserShown && m.topUserLeftOfMenu && m.topUserInside && m.topUserH1Gap >= 0 && m.topbar <= 64, m);
check('1280: 머리글 한 줄(제목·버튼 나란히, ☰ 없음), 높이 ≤ 64px', !d.narrow && d.h1Lines === 1 && d.actionRows === 1 && d.sideBySide && d.topbar <= 64, d);
check('1280: 머리글 아이디(#topbar-user)는 숨고 .actions의 이름이 보임', !d.narrow && !d.topUserShown, d);
check('1280: 긴 이메일 200px에서 잘림·툴팁', d.emailClipped && d.emailTitle === LONG && d.emailWidth <= 200, d);
// 아이디 자체 점검: 360에서 긴 아이디, 짧은 아이디의 타이틀 위치
check('360: 한글 16자·이메일도 ☰ 왼쪽에 보이고 제목 1줄', ['ko16-360', 'email-360'].every((k) => extra[k].topUserShown && extra[k].topUserLeftOfMenu && extra[k].h1Lines === 1), { a: extra['ko16-360'], b: extra['email-360'] });
check('360: 긴 이메일은 말줄임(잘림)', extra['email-360'].emailClipped, extra['email-360']);
check('지도 칸 높이 확보(390·1280 모두 200px 이상)', m.mapH >= 200 && d.mapH >= 200, { m: m.mapH, d: d.mapH });
check('콘솔 예외 0건', b.errors.length === 0, b.errors);
await finish(b);
