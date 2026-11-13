// 길찾기 창(모달, directions-ui.js)과 길찾기 링크(directions.js).
// [길찾기] → 모달(showModal): 제목 "길찾기"·장소 이름, 카카오맵·네이버지도·카카오내비·티맵 4개(390px 안·44px 이상),
// ×·Esc·바깥 누르기로 닫히고 초점은 [길찾기]로. 모달을 연 채 원격 갱신이 와도 창 유지.
// 기기별로 만드는 주소: 안드로이드 intent(package·좌표 순서·대체 주소), iOS 앱 주소 + 1.5초 뒤 대체 주소, PC 새 탭(카카오내비·티맵은 비활성+안내).
// 카카오내비: 가짜 window.Kakao(init·Navi.start 기록)로 인자 확인, SDK는 창을 열 때 한 번 불러오기 시작(integrity·crossorigin),
// 로딩 중에 눌러도 끝나는 대로 호출, 실패하면 창 밖 알림. 실제 이동은 막는다(window.__e2eGo·window.open 가로채기).
import { BLOCKED, launch, prepare, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('ux-directions');
const places = [
  { name: 'SW_01', district: '태안', address: '가람면 하늘리', lat: 36.516667, lng: 126.479826, mission: 'M_01 ~ _03' },
  { name: '쉼표,이름/슬래시', district: '태안', address: '가람면 바다리', lat: 36.52, lng: 126.48, mission: 'M_01' },
  { name: 'TB_01', district: '보은', address: '보은읍', lat: 36.49, lng: 127.73, mission: 'N_01 ~ _02' },
];
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const FAKE_KAKAO = `(() => {
  window.__navi = [];
  let ready = false;
  window.Kakao = { isInitialized: () => ready, init: (k) => { ready = true; window.__navi.push({ init: k }); }, Navi: { start: (o) => window.__navi.push({ start: o }) } };
})();`;
// 실제 이동·새 탭을 막고 주소만 모은다.
const CATCH = `window.__go = []; window.__opens = []; window.__e2eGo = (u) => window.__go.push(u); window.open = (...a) => { window.__opens.push(a); return null; }; 0`;

const name = (n) => encodeURIComponent(n);
const state = `(() => {
  const d = document.querySelector('dialog.directions-dialog'), r = d?.getBoundingClientRect();
  const btns = [...(d?.querySelectorAll('.route-app') ?? [])];
  return {
    count: document.querySelectorAll('dialog.directions-dialog').length, open: !!d?.open, modal: !!d?.matches(':modal'),
    title: d?.querySelector('#directions-dialog-title')?.textContent ?? null, labelledby: d?.getAttribute('aria-labelledby'), place: d?.querySelector('.mission-dialog-place')?.textContent ?? null,
    apps: btns.map((b) => b.querySelector('.route-app-name').textContent), disabled: btns.map((b) => b.disabled), notes: btns.map((b) => b.querySelector('.route-app-note')?.textContent ?? null),
    heights: btns.map((b) => Math.round(b.getBoundingClientRect().height)), minH: Math.min(...btns.map((b) => b.getBoundingClientRect().height)),
    btnInside: btns.every((b) => { const q = b.getBoundingClientRect(); return q.left >= r.left && q.right <= r.right && q.left >= 0 && q.right <= innerWidth; }),
    inside: r ? r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight : null,
    close: d?.querySelector('.directions-dialog-close')?.getAttribute('aria-label') ?? null,
    active: document.activeElement?.className?.toString().split(' ').find((c) => /route-open|route-app|directions-dialog-close/.test(c)) ?? document.activeElement?.tagName,
    activeApp: document.activeElement?.dataset?.app ?? null,
    overflowX: document.documentElement.scrollWidth > innerWidth, detailTitle: document.querySelector('#detail-title')?.firstChild?.textContent ?? null,
  };
})()`;
const openPlace = async (b, n) => { await b.ev(`__e2e.row(${JSON.stringify(n)}).click()`); await sleep(400); };
const openDialog = async (b) => { await b.ev(`document.querySelector('#detail .route-open').click()`); await sleep(150); };
const clickApp = (b, app) => b.ev(`document.querySelector('dialog.directions-dialog .route-app[data-app=${app}]').click()`);
const caught = (b) => b.ev(`({ go: window.__go, opens: window.__opens, navi: window.__navi ?? null, toast: document.querySelector('#toast').textContent, dialogs: document.querySelectorAll('dialog.directions-dialog').length })`);
const reset = (b) => b.ev(`${CATCH}; window.__navi = window.__navi ? [] : undefined; document.querySelector('#toast').textContent = ''; 0`);

// ══ 1. 창 모양·열고 닫기·원격 갱신 (390px, 기본 UA = PC) ══
let b = await launch('ux-directions', { viewport: [390, 844, true] });
await prepare(b, { places });
await openPlace(b, 'SW_01');
let v = await b.ev(`({ btns: [...document.querySelectorAll('#detail .route-actions .btn')].map((x) => x.textContent), tag: document.querySelector('#detail .route-open').tagName, kakao: document.querySelector('#detail .route-actions a')?.href, dialogs: document.querySelectorAll('dialog.directions-dialog').length })`);
check('카드 버튼은 [길찾기]·[카카오맵에서 보기], 창은 아직 없음', v.btns.join() === '길찾기,카카오맵에서 보기' && v.tag === 'BUTTON' && v.dialogs === 0 && /map\.kakao\.com\/link\/map\//.test(v.kakao), v);
const before = b.requests.filter((u) => /kakaocdn/.test(u)).length;
check('창을 열기 전에는 카카오내비 SDK를 부르지 않음', before === 0, b.requests.filter((u) => /kakaocdn/.test(u)));
await openDialog(b);
v = await b.ev(state);
check('[길찾기] → 모달(showModal), 제목 "길찾기"·장소 이름, 앱 4개(카카오맵·네이버지도·카카오내비·티맵), 화면 안',
  v.open && v.modal && v.count === 1 && v.title === '길찾기' && v.labelledby === 'directions-dialog-title' && v.place === 'SW_01' && v.apps.join() === '카카오맵,네이버지도,카카오내비,티맵' && v.inside && v.btnInside && v.close === '닫기', v);
check('390px: 앱 단추 4개 모두 높이 44px 이상·창 안, 가로 넘침 없음', v.heights.length === 4 && v.minH >= 44 && v.btnInside && !v.overflowX, v);
check('처음 초점은 열 수 있는 첫 앱(카카오맵)', v.activeApp === 'kakaomap', v);
const inert = await b.ev(`(() => { const r = document.querySelector('#search').getBoundingClientRect(); const top = document.elementFromPoint(r.left + 5, r.top + 5); return !document.querySelector('#search').contains(top); })()`);
check('창 뒤쪽(검색 칸)은 누를 수 없음', inert, inert);
check('PC(기본 UA): 카카오내비·티맵은 비활성이고 "휴대폰에서만 열 수 있습니다" 안내, 카카오맵·네이버지도는 켜짐',
  v.disabled.join() === 'false,false,true,true' && v.notes.join('|') === '||휴대폰에서만 열 수 있습니다|휴대폰에서만 열 수 있습니다', v);
const dots = await b.ev(`[...document.querySelectorAll('dialog.directions-dialog .route-dot')].map((d) => d.getAttribute('aria-hidden') + ':' + getComputedStyle(d).backgroundColor).join('|')`);
check('앱 이름 앞에는 작은 색 점만(이미지 없음)', !(await b.ev(`!!document.querySelector('dialog.directions-dialog img, dialog.directions-dialog svg')`)) && dots.split('|').length === 4, dots);
check('PC에서는 카카오내비를 쓸 수 없으므로 SDK를 부르지 않음', b.requests.filter((u) => /kakaocdn/.test(u)).length === 0, b.requests.filter((u) => /kakaocdn/.test(u)));
await b.shot('ux-directions-390-pc');

// 닫기 3가지 + 초점
const focusOpener = `document.activeElement === document.querySelector('#detail .route-open')`;
await b.ev(`document.querySelector('dialog.directions-dialog .directions-dialog-close').click()`); await sleep(200);
v = await b.ev(state);
check('× → 창이 닫히고(DOM에서 사라짐) 초점이 [길찾기]로, 상세 정보는 그대로', v.count === 0 && v.detailTitle === 'SW_01' && (await b.ev(focusOpener)), v);
await openDialog(b);
await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(200);
v = await b.ev(state);
check('Esc → 창만 닫히고 상세 정보는 그대로(함께 닫히지 않음), 초점 [길찾기]', v.count === 0 && v.detailTitle === 'SW_01' && (await b.ev(focusOpener)), v);
await openDialog(b);
await b.ev(`document.querySelector('dialog.directions-dialog').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`); await sleep(150);
v = await b.ev(state);
check('앱의 뒤로 가기(back.js: 열린 dialog에 Esc를 보냄)도 창만 닫음', v.count === 0 && v.detailTitle === 'SW_01', v);
await openDialog(b);
// 바깥(어두운 배경) 누르기: 창 모서리 밖 한 점을 실제로 누른다.
await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 4, y: 4, button: 'left', clickCount: 1 });
await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 4, y: 4, button: 'left', clickCount: 1 });
await sleep(200);
v = await b.ev(state);
check('창 바깥을 누르면 닫히고 초점 [길찾기]', v.count === 0 && v.detailTitle === 'SW_01' && (await b.ev(focusOpener)), v);
await openDialog(b);
await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 195, y: 422, button: 'left', clickCount: 1 });
await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 195, y: 422, button: 'left', clickCount: 1 });
await sleep(150);
v = await b.ev(state);
check('창 안쪽(빈 곳)을 누르면 닫히지 않음', v.open, v);
await b.ev(`document.querySelector('dialog.directions-dialog .directions-dialog-close').click()`); await sleep(150);

// 모달을 연 채 원격 갱신: 다른 장소·같은 장소 메모·목록 다시 그리기에도 창과 초점 유지, 연 순간의 장소로 열림
await reset(b);
await openDialog(b);
await b.ev(`document.querySelector('dialog.directions-dialog .route-app[data-app=navermap]').focus()`);
await b.ev(`__fake.remoteChange((db) => { db.places.find((p) => p.name === 'TB_01').memo = '원격1'; })`); await sleep(600);
v = await b.ev(state);
check('창을 연 채 다른 장소가 원격으로 바뀌어 목록을 다시 그려도 창·초점 그대로(창은 하나)', v.open && v.modal && v.count === 1 && v.activeApp === 'navermap' && v.place === 'SW_01' && v.detailTitle === 'SW_01', v);
await b.ev(`__fake.remoteChange((db) => { db.places.find((p) => p.name === 'SW_01').memo = '원격2'; })`); await sleep(600);
v = await b.ev(state);
check('고른 장소 자신이 원격으로 바뀌어 상세 정보를 다시 그려도 창 유지', v.open && v.count === 1 && v.activeApp === 'navermap' && v.detailTitle === 'SW_01', v);
await clickApp(b, 'navermap'); await sleep(150);
let c = await caught(b);
check('다시 그린 뒤에도 앱을 고르면 SW_01의 좌표로 열림(PC: 네이버 웹 길찾기 새 탭)',
  c.opens.length === 1 && c.opens[0][0] === `https://map.naver.com/p/directions/-/126.479826,36.516667,SW_01,,/-/car` && c.opens[0][1] === '_blank' && c.opens[0][2] === 'noopener' && c.dialogs === 0, c);
check('앱을 고르면 창이 닫히고 초점이 [길찾기]로', await b.ev(focusOpener));
// 창을 연 채 고른 장소가 원격으로 지워지면 창도 함께 닫힘
await openDialog(b);
await b.ev(`__fake.remoteChange((db) => { db.places = db.places.filter((p) => p.name !== 'SW_01'); })`); await sleep(700);
v = await b.ev(state);
check('창을 연 채 그 장소가 원격으로 지워지면 창도 닫힘(상세 정보도 닫힘)', v.count === 0 && v.detailTitle === null, v);
// 로그아웃하면 창이 남지 않음
await openPlace(b, 'TB_01');
await openDialog(b);
check('다른 장소(TB_01)의 창 제목 아래 이름이 TB_01', (await b.ev(state)).place === 'TB_01');
await b.ev(`document.querySelector('dialog.directions-dialog .directions-dialog-close').click()`); await sleep(150);

// PC 열기: 카카오맵 웹 새 탭, 쉼표·슬래시 이름
await openPlace(b, '쉼표,이름/슬래시');
await reset(b);
await openDialog(b); await clickApp(b, 'kakaomap'); await sleep(100);
c = await caught(b);
check('PC 카카오맵: 웹 길찾기를 새 탭으로(이름 쉼표·슬래시 제거, 위도·경도 순서), 이동은 없음',
  c.opens.length === 1 && c.opens[0][0] === `https://map.kakao.com/link/to/${name('쉼표 이름 슬래시')},36.52,126.48` && c.go.length === 0, c);
await openDialog(b); await clickApp(b, 'navermap'); await sleep(100);
c = await caught(b);
check('PC 네이버지도: 웹 길찾기 새 탭(경도,위도 순서·출발지 비움·자동차)', c.opens.length === 2 && c.opens[1][0] === `https://map.naver.com/p/directions/-/126.48,36.52,${name('쉼표 이름 슬래시')},,/-/car` && c.go.length === 0, c.opens);
await openDialog(b);
await b.ev(`document.querySelector('dialog.directions-dialog .route-app[data-app=tmap]').click(); document.querySelector('dialog.directions-dialog .route-app[data-app=kakaonavi]').click()`); await sleep(100);
c = await caught(b);
check('PC에서 비활성 단추(티맵·카카오내비)를 눌러도 아무 일 없음(창 유지)', c.opens.length === 2 && c.go.length === 0 && c.dialogs === 1, c);
await b.ev(`document.querySelector('dialog.directions-dialog .directions-dialog-close').click()`);
check('콘솔 예외 0건(390 PC)', b.errors.length === 0, b.errors);
await b.close();

// ══ 2. PC 화면 1280 ══
b = await launch('ux-directions-pc', { viewport: [1280, 800, false] });
await prepare(b, { places });
await openPlace(b, 'SW_01');
await reset(b);
await openDialog(b);
v = await b.ev(state);
check('1280: 창은 가운데에 뜨고 화면 안, 앱 4개, 카카오내비·티맵 비활성+안내', v.open && v.inside && v.apps.length === 4 && v.disabled.join() === 'false,false,true,true' && v.notes.filter(Boolean).length === 2 && v.minH >= 44, v);
await b.shot('ux-directions-1280-pc');
await clickApp(b, 'kakaomap'); await sleep(100);
c = await caught(b);
check('1280 PC 카카오맵: 웹 길찾기 새 탭', c.opens.length === 1 && c.opens[0][0] === 'https://map.kakao.com/link/to/SW_01,36.516667,126.479826', c.opens);
check('콘솔 예외 0건(1280 PC)', b.errors.length === 0, b.errors);
await b.close();

// ══ 3. 안드로이드(크롬·웹뷰 앱 모두 UA에 Android): intent 주소 + 카카오내비 가짜 SDK ══
b = await launch('ux-directions-android', { viewport: [390, 844, true] });
await b.send('Emulation.setUserAgentOverride', { userAgent: ANDROID_UA });
await b.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_KAKAO });
await prepare(b, { places });
const key = await b.ev(`window.APP_CONFIG.kakaoJsKey`);
await openPlace(b, 'SW_01');
await reset(b);
await openDialog(b);
v = await b.ev(state);
check('안드로이드: 앱 4개 모두 켜짐, 안내 문구 없음(휴대폰이므로)', v.disabled.join() === 'false,false,false,false' && v.notes.every((n) => n === null) && v.minH >= 44, v);
await b.shot('ux-directions-390-android');
const parseIntent = (u) => {
  const m = u.match(/^intent:\/\/(.*)#Intent;(.*);end$/);
  const fields = Object.fromEntries(m[2].split(';').map((f) => [f.slice(0, f.indexOf('=')), f.slice(f.indexOf('=') + 1)]));
  return { rest: m[1], ...fields };
};
await clickApp(b, 'kakaomap'); await sleep(100);
c = await caught(b);
let it = parseIntent(c.go[0]);
check('안드로이드 카카오맵: location.href에 intent://route?ep=위도,경도&by=car, scheme=kakaomap, package=net.daum.android.map, 대체=웹 길찾기',
  c.go.length === 1 && it.rest === 'route?ep=36.516667,126.479826&by=car' && it.scheme === 'kakaomap' && it.package === 'net.daum.android.map' && it.action === 'android.intent.action.VIEW'
    && it.category === 'android.intent.category.BROWSABLE' && decodeURIComponent(it['S.browser_fallback_url']) === 'https://map.kakao.com/link/to/SW_01,36.516667,126.479826' && c.opens.length === 0 && c.dialogs === 0, c.go);
await reset(b); await openDialog(b); await clickApp(b, 'navermap'); await sleep(100);
c = await caught(b);
it = parseIntent(c.go[0]);
check('안드로이드 네이버지도: intent://route/car?dlat=위도&dlng=경도&dname=이름&appname=인코딩한 origin, scheme=nmap, package=com.nhn.android.nmap, 대체=네이버 웹 길찾기',
  c.go.length === 1 && it.rest === `route/car?dlat=36.516667&dlng=126.479826&dname=SW_01&appname=${encodeURIComponent(await b.ev('location.origin'))}` && it.scheme === 'nmap' && it.package === 'com.nhn.android.nmap'
    && decodeURIComponent(it['S.browser_fallback_url']) === 'https://map.naver.com/p/directions/-/126.479826,36.516667,SW_01,,/-/car', c.go);
await reset(b); await openDialog(b); await clickApp(b, 'tmap'); await sleep(100);
c = await caught(b);
it = parseIntent(c.go[0]);
check('안드로이드 티맵: intent://route?goalname=이름&goalx=경도&goaly=위도, scheme=tmap, package=com.skt.tmap.ku, 대체=플레이스토어',
  c.go.length === 1 && it.rest === 'route?goalname=SW_01&goalx=126.479826&goaly=36.516667' && it.scheme === 'tmap' && it.package === 'com.skt.tmap.ku'
    && decodeURIComponent(it['S.browser_fallback_url']) === 'https://play.google.com/store/apps/details?id=com.skt.tmap.ku', c.go);
// 카카오내비(가짜 SDK)
await reset(b); await openDialog(b); await clickApp(b, 'kakaonavi'); await sleep(150);
c = await caught(b);
check('안드로이드 카카오내비: init(지도 키) 한 번 + Navi.start({name, x=경도, y=위도, coordType:"wgs84"}), 주소 이동·새 탭 없음, 창 닫힘, 알림 없음',
  JSON.stringify(c.navi) === JSON.stringify([{ init: key }, { start: { name: 'SW_01', x: 126.479826, y: 36.516667, coordType: 'wgs84' } }]) && c.go.length === 0 && c.opens.length === 0 && c.dialogs === 0 && c.toast === '', { key, c });
await openDialog(b); await clickApp(b, 'kakaonavi'); await sleep(150);
c = await caught(b);
check('다시 눌러도 init은 한 번만(이미 초기화됨), start는 한 번 더', c.navi.filter((x) => 'init' in x).length === 1 && c.navi.filter((x) => 'start' in x).length === 2, c.navi);
check('가짜 SDK가 있으면 진짜 SDK 주소를 부르지 않음', b.requests.filter((u) => /kakaocdn/.test(u)).length === 0, b.requests.filter((u) => /kakaocdn/.test(u)));
await openPlace(b, '쉼표,이름/슬래시');
await reset(b); await openDialog(b); await clickApp(b, 'tmap'); await sleep(100);
c = await caught(b);
check('안드로이드 티맵: 이름 쉼표·슬래시도 그대로 인코딩해 넘김', parseIntent(c.go[0]).rest === `route?goalname=${name('쉼표,이름/슬래시')}&goalx=126.48&goaly=36.52`, c.go);
check('콘솔 예외 0건(안드로이드)', b.errors.length === 0, b.errors);
await b.close();

// ══ 4. iOS: 앱 주소로 가 보고 1.5초 뒤에도 그대로면 대체 주소 ══
b = await launch('ux-directions-ios', { viewport: [390, 844, true] });
await b.send('Emulation.setUserAgentOverride', { userAgent: IOS_UA });
await prepare(b, { places });
const origin = await b.ev('location.origin');
await openPlace(b, 'SW_01');
const iosCase = async (app, appUrl, fallback) => {
  await reset(b); await openDialog(b); await clickApp(b, app);
  await sleep(300);
  const first = (await caught(b)).go.slice();
  await sleep(1500);
  const after = (await caught(b)).go.slice();
  check(`iOS ${app}: 앱 주소로 먼저 가고 1.5초 뒤 화면이 그대로면 대체 주소`, first.length === 1 && first[0] === appUrl && after.length === 2 && after[1] === fallback, { first, after });
};
await iosCase('kakaomap', 'kakaomap://route?ep=36.516667,126.479826&by=car', 'https://map.kakao.com/link/to/SW_01,36.516667,126.479826');
await iosCase('navermap', `nmap://route/car?dlat=36.516667&dlng=126.479826&dname=SW_01&appname=${encodeURIComponent(origin)}`, 'https://map.naver.com/p/directions/-/126.479826,36.516667,SW_01,,/-/car');
await iosCase('tmap', 'tmap://route?goalname=SW_01&goalx=126.479826&goaly=36.516667', 'https://apps.apple.com/kr/app/id431589174');
// 앱이 열려 화면이 숨겨지면(visibilitychange) 대체 주소로 넘어가지 않음
await reset(b); await openDialog(b); await clickApp(b, 'tmap');
await b.ev(`document.dispatchEvent(new Event('visibilitychange'))`);
await sleep(1900);
c = await caught(b);
check('iOS: 앱이 열려 화면이 숨겨지면(visibilitychange) 대체 주소로 가지 않음', c.go.length === 1, c.go);
check('iOS: 카카오내비·티맵 모두 켜짐', (await (async () => { await openDialog(b); const s = await b.ev(state); await b.ev(`document.querySelector('dialog.directions-dialog .directions-dialog-close').click()`); return s.disabled.join(); })()) === 'false,false,false,false');
check('콘솔 예외 0건(iOS)', b.errors.length === 0, b.errors);
await b.close();

// ══ 5. 카카오내비 SDK: 로딩 중에 눌러도 끝나는 대로 호출 / 실패하면 창 밖 알림 ══
// 5-1 로딩 중(요청을 붙잡아 둠): kakaocdn 차단을 풀고 Fetch로 응답을 보류한다. 진짜 서버에는 아무것도 보내지 않는다.
b = await launch('ux-directions-sdk', { viewport: [390, 844, true] });
await b.send('Emulation.setUserAgentOverride', { userAgent: ANDROID_UA });
await b.send('Network.setBlockedURLs', { urls: BLOCKED.filter((u) => !/kakaocdn/.test(u)) });
await b.send('Fetch.enable', { patterns: [{ urlPattern: '*kakaocdn.net*', requestStage: 'Request' }] });
const held = [];
b.listeners.push((m) => { if (m.method === 'Fetch.requestPaused') held.push({ id: m.params.requestId, url: m.params.request.url }); });
await prepare(b, { places });
const key2 = await b.ev(`window.APP_CONFIG.kakaoJsKey`);
await openPlace(b, 'SW_01');
await reset(b);
check('창을 열기 전에는 SDK 요청 없음', held.length === 0, held);
await openDialog(b); await sleep(200);
const tag = await b.ev(`(() => { const s = document.getElementById('kakao-navi-sdk'); return s && { src: s.src, integrity: s.integrity, cross: s.crossOrigin, parent: s.parentElement.tagName }; })()`);
check('창을 열면 SDK 요청이 정확히 한 번(2.8.5), <script integrity=sha384-… crossorigin=anonymous>',
  held.length === 1 && held[0].url === 'https://t1.kakaocdn.net/kakao_js_sdk/2.8.5/kakao.min.js' && tag?.src === held[0].url && tag.integrity === 'sha384-v6JKY3z4FUkWq21oZDHZe74YvuPk/WUrVLrDHTBojHXClOSa3iXy7sCXPY1jkFbj' && tag.cross === 'anonymous', { held, tag });
await b.ev(`document.querySelector('dialog.directions-dialog .directions-dialog-close').click()`);
await openDialog(b); await sleep(100);
check('창을 닫았다 다시 열어도(로딩 중) 다시 요청하지 않음(한 번만)', held.length === 1, held);
await clickApp(b, 'kakaonavi'); await sleep(300);
c = await caught(b);
check('로딩 중에 [카카오내비]를 누르면 창은 닫히고 아직 호출 안 함·알림 없음', c.dialogs === 0 && JSON.stringify(c.navi) === 'null' && c.toast === '', c);
// 로딩이 끝난 것처럼: 가짜 window.Kakao를 심고 script의 load를 알린다(진짜 SDK는 integrity 때문에 가짜 본문으로 대신할 수 없다).
await b.ev(`${FAKE_KAKAO}; document.getElementById('kakao-navi-sdk').dispatchEvent(new Event('load')); 0`); await sleep(200);
c = await caught(b);
check('로딩이 끝나는 대로 호출: init(키) + Navi.start(wgs84), 알림 없음',
  JSON.stringify(c.navi) === JSON.stringify([{ init: key2 }, { start: { name: 'SW_01', x: 126.479826, y: 36.516667, coordType: 'wgs84' } }]) && c.toast === '', c);
await b.send('Fetch.failRequest', { requestId: held[0].id, errorReason: 'Failed' }); await sleep(300);
c = await caught(b);
check('끝난 뒤 늦게 온 요청 실패는 알림을 띄우지 않음', c.toast === '' && c.navi.length === 2, c);
check('콘솔 예외 0건(SDK 로딩)', b.errors.length === 0, b.errors);
await b.close();

// 5-2 SDK를 못 받음(외부 주소 차단): 눌러도 창 밖 알림, 다시 눌러 보면 다시 받아 봄
b = await launch('ux-directions-sdkfail', { viewport: [390, 844, true] });
await b.send('Emulation.setUserAgentOverride', { userAgent: ANDROID_UA });
await prepare(b, { places });
await openPlace(b, 'SW_01');
await reset(b);
await openDialog(b); await sleep(300);
const first = b.requests.filter((u) => /kakaocdn/.test(u)).length;
await clickApp(b, 'kakaonavi'); await sleep(500);
c = await caught(b);
check('SDK를 못 받으면 창은 닫히고 창 밖 알림 "카카오내비를 열지 못했습니다. 잠시 뒤 다시 눌러 주세요."', first === 1 && c.dialogs === 0 && c.toast === '카카오내비를 열지 못했습니다. 잠시 뒤 다시 눌러 주세요.' && c.go.length === 0, { first, c });
const toastVisible = await b.ev(`(() => { const t = document.querySelector('#toast'), r = t.getBoundingClientRect(); return { text: t.textContent, visible: r.width > 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, opacity: getComputedStyle(t).opacity }; })()`);
check('알림이 화면 안에 보임(모달이 이미 닫혀 가려지지 않음)', toastVisible.visible && toastVisible.opacity === '1', toastVisible);
await b.shot('ux-directions-sdk-fail-toast');
await reset(b);
await openDialog(b); await sleep(300);
check('실패한 뒤에는 눌렀을 때(2번째)·창을 다시 열 때(3번째) SDK를 다시 받아 봄', b.requests.filter((u) => /kakaocdn/.test(u)).length === 3, b.requests.filter((u) => /kakaocdn/.test(u)));
await b.ev(`document.querySelector('dialog.directions-dialog .directions-dialog-close').click()`);
check('콘솔 예외·console.error 0건(SDK 실패)', b.errors.length === 0, b.errors);
await b.close();

await finish();
