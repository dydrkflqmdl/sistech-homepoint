// 항목 9: 휴대폰(390×844)·PC(1280×820) 스크린샷. 로그인 화면, 앱 화면(머리글 줄 수·높이), 상세·미션 입력, 콘솔 예외 0건.
import { launch, prepare, q1Rows, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('shots');
const LONG = 'very.long.admin.account@sistech-example.co.kr';
const rows = await q1Rows();
const metrics = (W) => `(() => {
  const r = (el) => el.getBoundingClientRect();
  const top = document.querySelector('.topbar'), h1 = top.querySelector('h1'), actions = top.querySelector('.actions');
  const lh = parseFloat(getComputedStyle(h1).lineHeight) || parseFloat(getComputedStyle(h1).fontSize) * 1.2;
  const kids = [...actions.querySelectorAll(':scope > .btn, :scope > .account')].filter(e => e.offsetParent !== null);
  const rowsTop = [...new Set(kids.map(k => Math.round(r(k).top)))];
  const email = document.querySelector('#user-name');
  const h1r = r(h1), ar = r(actions);
  return {
    topbar: Math.round(r(top).height), h1Lines: Math.round(h1r.height / lh), actionRows: rowsTop.length,
    sideBySide: h1r.right <= ar.left + 1, overlap: !(h1r.right <= ar.left + 1 || h1r.bottom <= ar.top + 1 || ar.bottom <= h1r.top + 1),
    emailClipped: email.scrollWidth > email.clientWidth, emailTitle: email.title, emailWidth: Math.round(r(email).width),
    overflowX: innerWidth !== ${W} || document.documentElement.scrollWidth > ${W} || r(top).right > ${W} + 0.5 || r(document.querySelector('#logout-button')).right > ${W}, mapH: Math.round(r(document.querySelector('#map')).height),
    logoutVisible: (() => { const b = r(document.querySelector('#logout-button')); return b.right <= ${W} && b.left >= 0; })(),
  };
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
  check(`${key}: 머리글이 화면 폭 안(버튼 잘림·가로 넘침 없음), 아이디 표시`, !e.overflowX && e.logoutVisible && !e.overlap && e.topbar <= 160 && e.emailTitle === e.shown, e);
}
check('짧은 한글 아이디(손두병)는 잘리지 않음', !extra['short-390'].emailClipped && extra['short-390'].shown === '손두병', extra['short-390']);
const m = out['390'], d = out['1280'];
check('390: 머리글 두 줄(제목 1줄 + 버튼 줄), 겹침·가로 넘침 없음', m.h1Lines <= 2 && m.actionRows <= 2 && !m.overlap && !m.overflowX, m);
check('390: 머리글 높이가 두 줄 안(≤ 112px)·로그아웃 버튼 화면 안', m.topbar <= 112 && m.logoutVisible, m);
check('390: 긴 이메일은 잘리고 툴팁에 전체 주소', m.emailClipped && m.emailTitle === LONG && m.emailWidth <= 110, m);
check('1280: 머리글 한 줄(제목·버튼 나란히), 높이 ≤ 64px', d.h1Lines === 1 && d.actionRows === 1 && d.sideBySide && d.topbar <= 64, d);
check('1280: 긴 이메일 200px에서 잘림·툴팁', d.emailClipped && d.emailTitle === LONG && d.emailWidth <= 200, d);
check('지도 칸 높이 확보(390·1280 모두 200px 이상)', m.mapH >= 200 && d.mapH >= 200, { m: m.mapH, d: d.mapH });
check('콘솔 예외 0건', b.errors.length === 0, b.errors);
await finish(b);
