// 길찾기 단추(directions-ui.js)와 길찾기 링크(directions.js).
// 장소 상세 카드에 카카오맵·네이버지도·카카오내비·티맵 4개 단추가 바로 있다(모달·[길찾기]·[카카오맵에서 보기] 없음).
// 390px 카드 안 2×2·44px 이상·가로 넘침 없음, PC에서는 카카오내비·티맵 비활성 + 묶음 아래 안내 한 줄, 원격 갱신으로 다시 그려도 동작·초점 유지.
// 기기별로 만드는 주소: 안드로이드 intent(package·좌표 순서·대체 주소), iOS 앱 주소 + 1.5초 뒤 대체 주소, PC 새 탭.
// 카카오내비: 가짜 window.Kakao(init·Navi.start 기록)로 인자 확인, SDK는 휴대폰에서 장소 상세를 처음 그릴 때 한 번 불러오기 시작(integrity·crossorigin, PC는 안 부름),
// 로딩 중에 눌러도 끝나는 대로 호출, 실패하면 알림. 실제 이동은 막는다(window.__e2eGo·window.open 가로채기).
import { BLOCKED, launch, prepare, reporter, sleep } from './lib.mjs';

const { check, finish } = reporter('ux-directions');
// 예기치 못한 예외로 스크립트가 죽으면 검사 실패로 남기고(원인 글 포함) 결과 파일을 쓴 뒤 끝낸다.
process.on('uncaughtException', (err) => { check('스크립트가 예외 없이 끝까지 돌아감', false, String(err?.stack ?? err).split('\n').slice(0, 4).join(' | ')); finish(); });
const places = [
  { name: 'SW_01', district: '태안', address: '가람면 하늘리', lat: 36.516667, lng: 126.479826, mission: 'M_01 ~ _03' },
  { name: '쉼표,이름/슬래시', district: '태안', address: '가람면 바다리', lat: 36.52, lng: 126.48, mission: 'M_01' },
  { name: 'TB_01', district: '보은', address: '보은읍', lat: 36.49, lng: 127.73, mission: 'N_01 ~ _02' },
];
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const TABLET_PC_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/31.0 Chrome/148.0.0.0 Safari/537.36';
// 진짜 SDK(2.8.5)처럼 Kakao.Navi는 Kakao.init(키)를 부른 뒤에야 생긴다(불러온 직후에는 init·isInitialized만 있다).
const FAKE_KAKAO = `(() => {
  window.__navi = [];
  let ready = false;
  window.Kakao = { isInitialized: () => ready, init: (k) => { ready = true; window.__navi.push({ init: k }); window.Kakao.Navi = { start: (o) => window.__navi.push({ start: o }) }; } };
})();`;
// 실제 이동·새 탭을 막고 주소만 모은다.
const CATCH = `window.__go = []; window.__opens = []; window.__e2eGo = (u) => window.__go.push(u); window.open = (...a) => { window.__opens.push(a); return null; }; 0`;

const OWN_APP_UA = `${ANDROID_UA} HomePointNavi/1.0.2`;
const name = (n) => encodeURIComponent(n);
const state = `(() => {
  const g = document.querySelector('#detail .route-actions'), r = g?.getBoundingClientRect(), card = document.querySelector('#detail').getBoundingClientRect();
  const btns = [...(g?.querySelectorAll('.route-app') ?? [])];
  const note = document.querySelector('#detail .route-note');
  return {
    groups: document.querySelectorAll('#detail .route-actions').length, role: g?.getAttribute('role') ?? null, label: g?.getAttribute('aria-label') ?? null,
    heading: !!g?.querySelector('h1,h2,h3,h4,legend'), visibleText: g?.textContent ?? null,
    apps: btns.map((b) => b.textContent), disabled: btns.map((b) => b.disabled), describedby: btns.map((b) => b.getAttribute('aria-describedby')),
    note: note?.textContent ?? null, noteId: note?.id ?? null, noteBelow: note && r ? note.getBoundingClientRect().top >= r.bottom : null,
    heights: btns.map((b) => Math.round(b.getBoundingClientRect().height)), minH: Math.min(...btns.map((b) => b.getBoundingClientRect().height)),
    rows: new Set(btns.map((b) => Math.round(b.getBoundingClientRect().top))).size, cols: new Set(btns.map((b) => Math.round(b.getBoundingClientRect().left))).size,
    btnInside: btns.every((b) => { const q = b.getBoundingClientRect(); return q.left >= card.left - 1 && q.right <= card.right + 1 && q.left >= 0 && q.right <= innerWidth; }),
    icons: btns.map((b) => { const i = b.querySelector('img.route-icon'); if (!i) return null; const q = i.getBoundingClientRect();
      return { src: i.getAttribute('src'), alt: i.getAttribute('alt'), loaded: i.complete && i.naturalWidth === 96, w: Math.round(q.width), h: Math.round(q.height), gray: getComputedStyle(i).filter }; }),
    otherMedia: g ? g.querySelectorAll('img:not(.route-icon), svg').length : null,
    cardBtns: [...document.querySelectorAll('#detail .btn')].map((x) => x.textContent), links: [...document.querySelectorAll('#detail a[href*="kakao.com"]')].length, routeOpen: !!document.querySelector('#detail .route-open'),
    modals: document.querySelectorAll('dialog.directions-dialog').length, anyDialog: document.querySelectorAll('dialog').length,
    activeApp: document.activeElement?.dataset?.app ?? null,
    overflowX: document.documentElement.scrollWidth > innerWidth, detailTitle: document.querySelector('#detail-title')?.firstChild?.textContent ?? null,
  };
})()`;
// 없는 요소를 눌러 스크립트가 죽지 않게 한다: 없으면 검사 실패로 남기고 계속한다. 고정 sleep 대신 상태를 기다린다.
const openPlace = async (b, n) => {
  const ok = await b.ev(`(() => { const r = __e2e.row(${JSON.stringify(n)}); if (!r) return false; r.click(); return true; })()`).catch(() => false);
  if (!ok) check(`장소 줄 ${n}을 찾을 수 있음`, false);
  await b.waitFor(`document.querySelector('#detail-title')?.firstChild?.textContent === ${JSON.stringify(n)} && !!document.querySelector('#detail .route-app')`, 3000);
};
const clickApp = async (b, app) => {
  const ok = await b.ev(`(() => { const e = document.querySelector('#detail .route-app[data-app=${app}]'); if (!e) return false; e.click(); return true; })()`).catch(() => false);
  if (!ok) check(`카드에서 ${app} 단추를 찾을 수 있음`, false);
  return ok;
};
const focusApp = (b, app) => b.ev(`document.querySelector('#detail .route-app[data-app=${app}]')?.focus()`);
// 길찾기 기록(go·opens)이 n개가 될 때까지 기다린다(안 오면 시간이 지난 뒤 그대로 검사해 실패로 남는다).
const waitCount = (b, key, n, ms = 2000) => b.waitFor(`(window.${key}?.length ?? 0) >= ${n}`, ms);
const caught = (b) => b.ev(`({ go: window.__go, opens: window.__opens, navi: window.__navi ?? null, toast: document.querySelector('#toast').textContent, dialogs: document.querySelectorAll('dialog.directions-dialog').length })`);
const reset = (b) => b.ev(`${CATCH}; window.__navi = window.__navi ? [] : undefined; document.querySelector('#toast').textContent = ''; 0`);
const cdn = (b) => b.requests.filter((u) => /kakaocdn/.test(u));
const APPS = '카카오맵,네이버지도,카카오내비,티맵';
// 앱이 안 열린 것 같을 때 묶음 아래에 뜨는 안내 줄(없으면 null)
const helpState = (b) => b.ev(`(() => { const p = document.querySelector('#detail .route-help'); const a = p?.querySelector('a'); if (!p) return null;
  const card = document.querySelector('#detail').getBoundingClientRect(); const q = a.getBoundingClientRect();
  return { text: p.textContent, role: p.getAttribute('role'), link: a.textContent, href: a.getAttribute('href'), target: a.target, rel: a.rel, h: Math.round(q.height),
    inside: q.left >= card.left - 1 && q.right <= card.right + 1 && document.documentElement.scrollWidth <= innerWidth, below: p.getBoundingClientRect().top >= document.querySelector('#detail .route-actions').getBoundingClientRect().bottom }; })()`);
const waitHelp = (b, ms = 3500) => b.waitFor(`!!document.querySelector('#detail .route-help')`, ms).catch(() => {});
const helpOk = (h, link, href) => h && h.text === `앱이 열리지 않으면 ${link}` && h.role === 'status' && h.link === link && h.href === href && h.target === '_blank' && /noopener/.test(h.rel) && h.h >= 44 && h.inside && h.below;
const NOTE = '카카오내비·티맵은 휴대폰에서만 열 수 있습니다.';

// ══ 1. 카드 모양·원격 갱신 (390px, 기본 UA = PC) ══
let b = await launch('ux-directions', { viewport: [390, 844, true] });
await prepare(b, { places });
check('장소를 고르기 전에는 SDK를 부르지 않음', cdn(b).length === 0, cdn(b));
await openPlace(b, 'SW_01');
// 아이콘 그림이 다 불러와질 때까지 기다린다(못 불러오면 아래 아이콘 검사가 실패로 남긴다).
await b.waitFor(`[...document.querySelectorAll('#detail .route-icon')].every((i) => i.complete)`, 5000).catch(() => {});
let v = await b.ev(state);
check('카드에 4개 단추가 바로 있음: 카카오맵·네이버지도·카카오내비·티맵, 묶음은 하나(role=group, aria-label=길찾기)',
  v.groups === 1 && v.role === 'group' && v.label === '길찾기' && v.apps.join() === APPS, v);
check('[길찾기]·[카카오맵에서 보기]는 없고(단추·링크 모두), 길찾기 모달도 없음',
  !v.routeOpen && v.links === 0 && !v.cardBtns.includes('길찾기') && !v.cardBtns.includes('카카오맵에서 보기') && v.modals === 0 && v.anyDialog === 0, v);
check('보이는 제목 없음(묶음 안에는 단추 글자뿐)', !v.heading && v.visibleText === '카카오맵네이버지도카카오내비티맵', v);
check('390px: 2×2 배치, 단추 4개 모두 높이 44px 이상·카드 안, 가로 넘침 없음', v.heights.length === 4 && v.rows === 2 && v.cols === 2 && v.minH >= 44 && v.btnInside && !v.overflowX, v);
check('앱 이름 앞에 그 앱 아이콘(icons/<앱>.png, 96px 원본을 24px로, 꾸밈 alt="")이 실제로 불러와짐',
  v.icons.length === 4 && v.icons.every((i, n) => i && i.src === `./icons/${['kakaomap', 'navermap', 'kakaonavi', 'tmap'][n]}.png` && i.alt === '' && i.loaded && i.w === 24 && i.h === 24) && v.otherMedia === 0, v.icons);
check('PC: 꺼진 단추(카카오내비·티맵)의 아이콘만 흑백', v.icons.map((i) => /grayscale/.test(i?.gray ?? '')).join() === 'false,false,true,true', v.icons);
check('PC(기본 UA): 카카오내비·티맵은 비활성, 카카오맵·네이버지도는 켜짐', v.disabled.join() === 'false,false,true,true', v);
check('PC 안내는 묶음 아래 한 줄 "카카오내비·티맵은 휴대폰에서만 열 수 있습니다."이고 꺼진 단추가 가리킴',
  v.note === NOTE && v.noteBelow === true && v.describedby.join() === `,,${v.noteId},${v.noteId}` && v.noteId, v);
check('PC에서는 카카오내비를 쓸 수 없으므로 SDK를 부르지 않음(장소를 여러 번 골라도)', (await (async () => { await openPlace(b, 'TB_01'); await openPlace(b, 'SW_01'); return cdn(b).length; })()) === 0, cdn(b));
await b.shot('ux-directions-390-pc');

// 원격 갱신: 다른 장소·같은 장소 메모·목록 다시 그리기에도 4개 단추는 그대로, 누르던 단추의 초점 유지, 그린 장소의 좌표로 열림
await reset(b);
await focusApp(b, 'navermap');
await b.ev(`__fake.remoteChange((db) => { db.places.find((p) => p.name === 'TB_01').memo = '원격1'; })`); await sleep(800);
v = await b.ev(state);
check('다른 장소가 원격으로 바뀌어 목록을 다시 그려도 단추 4개·초점 그대로', v.apps.join() === APPS && v.activeApp === 'navermap' && v.detailTitle === 'SW_01' && v.groups === 1, v);
await b.ev(`__fake.remoteChange((db) => { db.places.find((p) => p.name === 'SW_01').memo = '원격2'; })`); await b.waitFor(`document.querySelector('#memo-input')?.value === '원격2'`, 3000);
v = await b.ev(state);
check('고른 장소 자신이 원격으로 바뀌어 상세 카드를 다시 그려도 단추 4개·초점 그대로(카드는 하나)', v.apps.join() === APPS && v.activeApp === 'navermap' && v.detailTitle === 'SW_01' && v.groups === 1 && v.modals === 0, v);
await clickApp(b, 'navermap'); await waitCount(b, '__opens', 1);
let c = await caught(b);
check('다시 그린 뒤에도 단추를 누르면 SW_01의 좌표로 열림(PC: 네이버 웹 길찾기 새 탭)',
  c.opens.length === 1 && c.opens[0][0] === `https://map.naver.com/p/directions/-/126.479826,36.516667,SW_01,,/-/car` && c.opens[0][1] === '_blank' && c.opens[0][2] === 'noopener' && c.dialogs === 0, c);
v = await b.ev(state);
check('누른 뒤에도 초점은 그 단추에(창 없음, 상세 카드 그대로)', v.activeApp === 'navermap' && v.detailTitle === 'SW_01' && v.anyDialog === 0, v);
// 고른 장소가 원격으로 지워지면 카드도 닫힘
await b.ev(`__fake.remoteChange((db) => { db.places = db.places.filter((p) => p.name !== 'SW_01'); })`); await b.waitFor(`document.querySelector('#detail').hidden`, 3000);
v = await b.ev(state);
check('그 장소가 원격으로 지워지면 카드(단추)도 사라짐', v.groups === 0 && v.detailTitle === null, v);

// PC 열기: 카카오맵 웹 새 탭, 쉼표·슬래시 이름
await openPlace(b, '쉼표,이름/슬래시');
check('다른 장소(쉼표 이름)를 고르면 그 카드에도 4개 단추', (await b.ev(state)).apps.join() === APPS);
await reset(b);
await clickApp(b, 'kakaomap'); await waitCount(b, '__opens', 1);
c = await caught(b);
check('PC 카카오맵: 웹 길찾기를 새 탭으로(이름 쉼표·슬래시 제거, 위도·경도 순서), 이동은 없음',
  c.opens.length === 1 && c.opens[0][0] === `https://map.kakao.com/link/to/${name('쉼표 이름 슬래시')},36.52,126.48` && c.go.length === 0, c);
await clickApp(b, 'navermap'); await waitCount(b, '__opens', 2);
c = await caught(b);
check('PC 네이버지도: 웹 길찾기 새 탭(경도,위도 순서·출발지 비움·자동차)', c.opens.length === 2 && c.opens[1][0] === `https://map.naver.com/p/directions/-/126.48,36.52,${name('쉼표 이름 슬래시')},,/-/car` && c.go.length === 0, c.opens);
await b.ev(`document.querySelector('#detail .route-app[data-app=tmap]')?.click(); document.querySelector('#detail .route-app[data-app=kakaonavi]')?.click()`); await sleep(300);
c = await caught(b);
check('PC에서 비활성 단추(티맵·카카오내비)를 눌러도 아무 일 없음', c.opens.length === 2 && c.go.length === 0 && c.toast === '', c);
check('콘솔 예외 0건(390 PC)', b.errors.length === 0, b.errors);
await b.close();

// ══ 2. PC 화면 1280 ══
b = await launch('ux-directions-pc', { viewport: [1280, 800, false] });
await prepare(b, { places });
await openPlace(b, 'SW_01');
await reset(b);
v = await b.ev(state);
check('1280: 카드 폭에 맞춰 4개 단추(카드 안), 카카오내비·티맵 비활성+안내 한 줄, 44px 이상, 모달 없음',
  v.apps.join() === APPS && v.btnInside && v.disabled.join() === 'false,false,true,true' && v.note === NOTE && v.minH >= 44 && v.modals === 0 && !v.overflowX, v);
await b.shot('ux-directions-1280-pc');
await clickApp(b, 'kakaomap'); await waitCount(b, '__opens', 1);
c = await caught(b);
check('1280 PC 카카오맵: 웹 길찾기 새 탭', c.opens.length === 1 && c.opens[0][0] === 'https://map.kakao.com/link/to/SW_01,36.516667,126.479826', c.opens);
check('1280 PC: SDK를 부르지 않음', cdn(b).length === 0, cdn(b));
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
v = await b.ev(state);
check('안드로이드: 카드의 앱 4개 모두 켜짐, 안내 문구 없음(휴대폰이므로), 44px 이상·2×2', v.apps.join() === APPS && v.disabled.join() === 'false,false,false,false' && v.note === null && v.minH >= 44 && v.rows === 2 && v.cols === 2 && !v.overflowX, v);
await b.shot('ux-directions-390-android');
const parseIntent = (u) => {
  const m = u.match(/^intent:\/\/(.*)#Intent;(.*);end$/);
  const fields = Object.fromEntries(m[2].split(';').map((f) => [f.slice(0, f.indexOf('=')), f.slice(f.indexOf('=') + 1)]));
  return { rest: m[1], ...fields };
};
await clickApp(b, 'kakaomap'); await waitCount(b, '__opens', 1);
c = await caught(b);
let it = parseIntent(c.go[0]);
check('안드로이드 카카오맵: location.href에 intent://route?ep=위도,경도&by=car, scheme=kakaomap, package=net.daum.android.map, 대체 주소 없음(브라우저가 앱과 함께 대체 주소를 여는 것을 막음)',
  c.go.length === 1 && it.rest === 'route?ep=36.516667,126.479826&by=car' && it.scheme === 'kakaomap' && it.package === 'net.daum.android.map' && it.action === 'android.intent.action.VIEW'
    && it.category === 'android.intent.category.BROWSABLE' && !('S.browser_fallback_url' in it) && c.opens.length === 0 && c.dialogs === 0, c.go);
await reset(b); await clickApp(b, 'navermap'); await waitCount(b, '__go', 1);
c = await caught(b);
it = parseIntent(c.go[0]);
check('안드로이드 네이버지도: intent://route/car?dlat=위도&dlng=경도&dname=이름&appname=인코딩한 origin, scheme=nmap, package=com.nhn.android.nmap, 대체 주소 없음',
  c.go.length === 1 && it.rest === `route/car?dlat=36.516667&dlng=126.479826&dname=SW_01&appname=${encodeURIComponent(await b.ev('location.origin'))}` && it.scheme === 'nmap' && it.package === 'com.nhn.android.nmap'
    && !('S.browser_fallback_url' in it), c.go);
await reset(b); await clickApp(b, 'tmap'); await waitCount(b, '__go', 1);
c = await caught(b);
it = parseIntent(c.go[0]);
check('안드로이드 티맵: intent://route?goalname=이름&goalx=경도&goaly=위도, scheme=tmap, package=com.skt.tmap.ku, 대체 주소 없음',
  c.go.length === 1 && it.rest === 'route?goalname=SW_01&goalx=126.479826&goaly=36.516667' && it.scheme === 'tmap' && it.package === 'com.skt.tmap.ku'
    && !('S.browser_fallback_url' in it), c.go);
await waitHelp(b);
let hp = await helpState(b);
check('안드로이드 티맵: 1.5초 뒤에도 화면 그대로면 이동은 한 번뿐이고 "앱이 열리지 않으면 플레이스토어에서 티맵 받기" 링크(새 탭·noopener·44px 이상·카드 안)',
  (await caught(b)).go.length === 1 && helpOk(hp, '플레이스토어에서 티맵 받기', 'https://play.google.com/store/apps/details?id=com.skt.tmap.ku'), hp);
await reset(b); await clickApp(b, 'kakaomap'); await waitHelp(b);
hp = await helpState(b);
check('안드로이드 카카오맵: 이전 안내를 지우고 새로 "웹에서 길찾기 열기"(카카오맵 웹 길찾기), 이동은 한 번뿐', (await caught(b)).go.length === 1 && helpOk(hp, '웹에서 길찾기 열기', 'https://map.kakao.com/link/to/SW_01,36.516667,126.479826'), hp);
await reset(b); await clickApp(b, 'navermap'); await waitHelp(b);
hp = await helpState(b);
check('안드로이드 네이버지도: "웹에서 길찾기 열기"(네이버 웹 길찾기)', (await caught(b)).go.length === 1 && helpOk(hp, '웹에서 길찾기 열기', 'https://map.naver.com/p/directions/-/126.479826,36.516667,SW_01,,/-/car'), hp);
await reset(b); await clickApp(b, 'tmap');
check('다른 앱 단추를 누르면 이전 안내가 바로 사라짐(새 안내는 1.5초 뒤)', (await helpState(b)) === null);
// 원격 갱신으로 카드를 다시 그려도 안내 유지
await waitHelp(b);
await b.ev(`__fake.remoteChange((db) => { db.places.find((p) => p.name === 'SW_01').memo = '원격안내'; })`); await b.waitFor(`document.querySelector('#memo-input')?.value === '원격안내'`, 3000).catch(() => {});
hp = await helpState(b);
check('원격 갱신으로 카드를 다시 그려도 안내가 유지됨', helpOk(hp, '플레이스토어에서 티맵 받기', 'https://play.google.com/store/apps/details?id=com.skt.tmap.ku'), hp);
// 숨겨지면(앱이 열려 돌아왔을 때 남지 않게) 안내가 사라짐
await b.ev(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); 0`); await sleep(200);
check('안내가 뜬 뒤 페이지가 숨겨지면 안내가 사라짐', (await helpState(b)) === null);
await b.ev(`delete document.hidden; 0`);
// 앱이 열려 1.5초 안에 숨겨지면 안내가 뜨지 않음
await reset(b); await clickApp(b, 'kakaomap');
await b.ev(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); 0`);
await sleep(1900);
check('1.5초 안에 화면이 숨겨지면(앱이 열림) 안내가 뜨지 않음', (await helpState(b)) === null);
await b.ev(`delete document.hidden; 0`);
// 카카오내비(가짜 SDK)
await reset(b); await clickApp(b, 'kakaonavi'); await b.waitFor(`window.__navi?.some((x) => 'start' in x)`, 3000);
c = await caught(b);
check('안드로이드 카카오내비: init(지도 키) 한 번 + Navi.start({name, x=경도, y=위도, coordType:"wgs84"}), 주소 이동·새 탭 없음, 모달 없음, 알림 없음',
  JSON.stringify(c.navi) === JSON.stringify([{ init: key }, { start: { name: 'SW_01', x: 126.479826, y: 36.516667, coordType: 'wgs84' } }]) && c.go.length === 0 && c.opens.length === 0 && c.dialogs === 0 && c.toast === '', { key, c });
await clickApp(b, 'kakaonavi'); await b.waitFor(`window.__navi?.filter((x) => 'start' in x).length >= 2`, 3000);
c = await caught(b);
check('다시 눌러도 init은 한 번만(이미 초기화됨), start는 한 번 더', c.navi.filter((x) => 'init' in x).length === 1 && c.navi.filter((x) => 'start' in x).length === 2, c.navi);
check('가짜 SDK가 있으면 진짜 SDK 주소를 부르지 않음', b.requests.filter((u) => /kakaocdn/.test(u)).length === 0, b.requests.filter((u) => /kakaocdn/.test(u)));
await openPlace(b, '쉼표,이름/슬래시');
await reset(b); await clickApp(b, 'tmap'); await waitCount(b, '__go', 1);
c = await caught(b);
check('안드로이드 티맵: 이름 쉼표·슬래시도 그대로 인코딩해 넘김', parseIntent(c.go[0]).rest === `route?goalname=${name('쉼표,이름/슬래시')}&goalx=126.48&goaly=36.52`, c.go);
check('콘솔 예외 0건(안드로이드)', b.errors.length === 0, b.errors);
await b.close();

// ══ 3-2. 우리 앱(웹뷰, UA 끝에 HomePointNavi/<버전>): intent 안에 대체 주소가 그대로 있음 ══
b = await launch('ux-directions-ownapp', { viewport: [390, 844, true] });
await b.send('Emulation.setUserAgentOverride', { userAgent: OWN_APP_UA });
await b.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_KAKAO });
await prepare(b, { places });
await openPlace(b, 'SW_01');
const fb = async (app) => { await reset(b); await clickApp(b, app); await waitCount(b, '__go', 1); const u = (await caught(b)).go[0] ?? ''; const m = u.match(/S\.browser_fallback_url=([^;]*);end$/); return m && decodeURIComponent(m[1]); };
check('우리 앱 카카오맵: intent에 웹 길찾기 대체 주소가 그대로 있음', (await fb('kakaomap')) === 'https://map.kakao.com/link/to/SW_01,36.516667,126.479826');
check('우리 앱 네이버지도: intent에 네이버 웹 길찾기 대체 주소', (await fb('navermap')) === 'https://map.naver.com/p/directions/-/126.479826,36.516667,SW_01,,/-/car');
check('우리 앱 티맵: intent에 플레이스토어 대체 주소', (await fb('tmap')) === 'https://play.google.com/store/apps/details?id=com.skt.tmap.ku');
check('콘솔 예외 0건(우리 앱)', b.errors.length === 0, b.errors);
await b.close();

// ══ 4. iOS: 앱 주소로만 가고, 1.5초 뒤에도 그대로면 안내 링크(자동 이동 없음) ══
b = await launch('ux-directions-ios', { viewport: [390, 844, true] });
await b.send('Emulation.setUserAgentOverride', { userAgent: IOS_UA });
await prepare(b, { places });
const origin = await b.ev('location.origin');
await openPlace(b, 'SW_01');
const iosCase = async (app, appUrl, fallback) => {
  await reset(b); await clickApp(b, app);
  await waitCount(b, '__go', 1);
  const first = (await caught(b)).go.slice();
  await waitHelp(b);
  await sleep(300);
  const after = (await caught(b)).go.slice();
  const hp = await helpState(b);
  check(`iOS ${app}: 앱 주소로 한 번만 가고(자동 이동 없음) 1.5초 뒤 화면이 그대로면 안내 링크(대체 주소)`,
    first.length === 1 && first[0] === appUrl && after.length === 1 && helpOk(hp, app === 'tmap' ? '앱스토어에서 티맵 받기' : '웹에서 길찾기 열기', fallback), { first, after, hp });
};
await iosCase('kakaomap', 'kakaomap://route?ep=36.516667,126.479826&by=car', 'https://map.kakao.com/link/to/SW_01,36.516667,126.479826');
await iosCase('navermap', `nmap://route/car?dlat=36.516667&dlng=126.479826&dname=SW_01&appname=${encodeURIComponent(origin)}`, 'https://map.naver.com/p/directions/-/126.479826,36.516667,SW_01,,/-/car');
await iosCase('tmap', 'tmap://route?goalname=SW_01&goalx=126.479826&goaly=36.516667', 'https://apps.apple.com/kr/app/id431589174');
// 앱이 열려 화면이 숨겨지면(visibilitychange) 안내가 뜨지 않음
await reset(b); await clickApp(b, 'tmap');
await b.ev(`document.dispatchEvent(new Event('visibilitychange'))`);
await sleep(1900);
c = await caught(b);
check('iOS: 앱이 열려 1.5초 안에 visibilitychange가 오면 안내가 뜨지 않음', c.go.length === 1 && (await helpState(b)) === null, c.go);
v = await b.ev(state);
check('iOS: 카카오내비·티맵 모두 켜짐, PC 안내 없음, 단추 4개 44px 이상', v.disabled.join() === 'false,false,false,false' && v.note === null && v.minH >= 44, v);
check('콘솔 예외 0건(iOS)', b.errors.length === 0, b.errors);
await b.close();

// ══ 4-2. 갤럭시 탭 PC 버전: UA에 Android가 없고(X11; Linux) 터치만 있어도 안드로이드로 봄 ══
b = await launch('ux-directions-tablet', { viewport: [800, 1280, false] });
await b.send('Emulation.setUserAgentOverride', { userAgent: TABLET_PC_UA });
await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await prepare(b, { places });
await openPlace(b, 'SW_01');
await reset(b);
v = await b.ev(state);
check('갤럭시 탭 PC 버전(UA에 Android 없음·터치 5): 단추 4개 모두 켜짐, "휴대폰에서만" 안내 줄 없음', v.apps.join() === APPS && v.disabled.join() === 'false,false,false,false' && v.note === null, v);
await clickApp(b, 'kakaomap'); await waitCount(b, '__go', 1);
c = await caught(b);
check('갤럭시 탭 PC 버전 카카오맵: 새 탭이 아니라 intent://로 시작하고 package=net.daum.android.map인 주소로 이동',
  c.go.length === 1 && c.go[0].startsWith('intent://') && c.go[0].includes('package=net.daum.android.map') && !c.go[0].includes('browser_fallback_url') && c.opens.length === 0, c);
await waitHelp(b);
hp = await helpState(b);
check('갤럭시 탭 PC 버전: 1.5초 뒤 "웹에서 길찾기 열기" 안내, 이동은 여전히 한 번', (await caught(b)).go.length === 1 && helpOk(hp, '웹에서 길찾기 열기', 'https://map.kakao.com/link/to/SW_01,36.516667,126.479826'), hp);
check('콘솔 예외 0건(갤럭시 탭 PC 버전)', b.errors.length === 0, b.errors);
await b.close();

// ══ 5. 카카오내비 SDK: 로딩 중에 눌러도 끝나는 대로 호출 / 실패하면 알림 ══
// 5-1 로딩 중(요청을 붙잡아 둠): kakaocdn 차단을 풀고 Fetch로 응답을 보류한다. 진짜 서버에는 아무것도 보내지 않는다.
b = await launch('ux-directions-sdk', { viewport: [390, 844, true] });
await b.send('Emulation.setUserAgentOverride', { userAgent: ANDROID_UA });
await b.send('Network.setBlockedURLs', { urls: BLOCKED.filter((u) => !/kakaocdn/.test(u)) });
await b.send('Fetch.enable', { patterns: [{ urlPattern: '*kakaocdn.net*', requestStage: 'Request' }] });
const held = [];
b.listeners.push((m) => { if (m.method === 'Fetch.requestPaused') held.push({ id: m.params.requestId, url: m.params.request.url }); });
await prepare(b, { places });
const key2 = await b.ev(`window.APP_CONFIG.kakaoJsKey`);
check('장소 상세를 열기 전에는 SDK 요청 없음', held.length === 0, held);
await openPlace(b, 'SW_01');
await reset(b);
await sleep(200);
const tag = await b.ev(`(() => { const s = document.getElementById('kakao-navi-sdk'); return s && { src: s.src, integrity: s.integrity, cross: s.crossOrigin, parent: s.parentElement.tagName }; })()`);
check('휴대폰에서 장소 상세가 처음 그려질 때 SDK 요청이 정확히 한 번(2.8.5), <script integrity=sha384-… crossorigin=anonymous>',
  held.length === 1 && held[0].url === 'https://t1.kakaocdn.net/kakao_js_sdk/2.8.5/kakao.min.js' && tag?.src === held[0].url && tag.integrity === 'sha384-v6JKY3z4FUkWq21oZDHZe74YvuPk/WUrVLrDHTBojHXClOSa3iXy7sCXPY1jkFbj' && tag.cross === 'anonymous', { held, tag });
await openPlace(b, 'TB_01'); await openPlace(b, 'SW_01');
await b.ev(`__fake.remoteChange((db) => { db.places.find((p) => p.name === 'SW_01').memo = '원격'; })`); await sleep(500);
check('다른 장소를 고르거나 원격으로 다시 그려도(로딩 중) 다시 요청하지 않음(한 번만)', held.length === 1, held);
await clickApp(b, 'kakaonavi'); await sleep(300);
c = await caught(b);
check('로딩 중에 [카카오내비]를 누르면 모달 없이 아직 호출 안 함·알림 없음', c.dialogs === 0 && JSON.stringify(c.navi) === 'null' && c.toast === '', c);
// 로딩이 끝난 것처럼: 가짜 window.Kakao를 심고 script의 load를 알린다(진짜 SDK는 integrity 때문에 가짜 본문으로 대신할 수 없다).
await b.ev(`${FAKE_KAKAO}; document.getElementById('kakao-navi-sdk')?.dispatchEvent(new Event('load')); 0`); await b.waitFor(`window.__navi?.some((x) => 'start' in x)`, 3000);
c = await caught(b);
check('로딩이 끝나는 대로 호출: init(키) + Navi.start(wgs84), 알림 없음',
  JSON.stringify(c.navi) === JSON.stringify([{ init: key2 }, { start: { name: 'SW_01', x: 126.479826, y: 36.516667, coordType: 'wgs84' } }]) && c.toast === '', c);
await b.send('Fetch.failRequest', { requestId: held[0].id, errorReason: 'Failed' }); await sleep(300);
c = await caught(b);
check('끝난 뒤 늦게 온 요청 실패는 알림을 띄우지 않음', c.toast === '' && c.navi.length === 2, c);
check('콘솔 예외 0건(SDK 로딩)', b.errors.length === 0, b.errors);
await b.close();

// 5-3 갤럭시 탭 PC 버전: SDK를 불러오는 동안만 navigator.userAgent가 안드로이드로 보이고, 끝나면 원래대로 돌아옴
// 진짜 SDK 본문은 integrity 때문에 바꿔 채울 수 없으므로, 요청은 붙잡아 둔 채(그동안 userAgent를 확인) 가짜 SDK 본문을 "SDK가 실행되는 순간" 그대로 실행한 뒤 load를 알린다.
const UA_DESC = `(() => { const d = Object.getOwnPropertyDescriptor(navigator, 'userAgent'); return d === undefined ? null : 'own'; })()`;
const FAKE_SDK_BODY = `${FAKE_KAKAO}; window.__sdkUa = navigator.userAgent; 0`;
b = await launch('ux-directions-tablet-sdk', { viewport: [800, 1280, false] });
await b.send('Emulation.setUserAgentOverride', { userAgent: TABLET_PC_UA });
await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await b.send('Network.setBlockedURLs', { urls: BLOCKED.filter((u) => !/kakaocdn/.test(u)) });
await b.send('Fetch.enable', { patterns: [{ urlPattern: '*kakaocdn.net*', requestStage: 'Request' }] });
const heldT = [];
b.listeners.push((m) => { if (m.method === 'Fetch.requestPaused') heldT.push({ id: m.params.requestId, url: m.params.request.url }); });
await prepare(b, { places });
const keyT = await b.ev(`window.APP_CONFIG.kakaoJsKey`);
await openPlace(b, 'SW_01');
await reset(b);
await b.waitFor(`!!document.getElementById('kakao-navi-sdk')`, 3000).catch(() => {});
check('갤럭시 탭 PC 버전: 장소 상세를 처음 그리면 SDK 요청이 한 번 나감(미리 불러오기)', heldT.length === 1 && heldT[0].url === 'https://t1.kakaocdn.net/kakao_js_sdk/2.8.5/kakao.min.js', heldT);
const during = await b.ev(`({ ua: navigator.userAgent, own: ${UA_DESC} })`);
check('SDK를 불러오는 동안 navigator.userAgent에 Android가 들어 있음', /Android/.test(during.ua) && /SamsungBrowser\/31\.0/.test(during.ua) && during.own === 'own', during);
await b.ev(`${FAKE_SDK_BODY}; document.getElementById('kakao-navi-sdk')?.dispatchEvent(new Event('load')); 0`);
const after = await b.ev(`({ sdkUa: window.__sdkUa, ua: navigator.userAgent, own: ${UA_DESC} })`);
check('SDK가 실행된 순간의 userAgent에 Android·SamsungBrowser가 있음', /Android/.test(after.sdkUa) && /SamsungBrowser/.test(after.sdkUa), after);
check('불러온 뒤 navigator.userAgent는 원래 PC 버전 UA 그대로, 덮어쓴 속성(own descriptor)은 없음', after.ua === TABLET_PC_UA && after.own === null, after);
await clickApp(b, 'kakaonavi'); await b.waitFor(`window.__navi?.some((x) => 'start' in x)`, 3000);
c = await caught(b);
check('[카카오내비]: 가짜 Navi.start가 wgs84 인자로 불림',
  JSON.stringify(c.navi) === JSON.stringify([{ init: keyT }, { start: { name: 'SW_01', x: 126.479826, y: 36.516667, coordType: 'wgs84' } }]), c.navi);
await b.send('Fetch.failRequest', { requestId: heldT[0].id, errorReason: 'Failed' }); await sleep(300);
check('늦게 온 요청 실패 뒤에도 userAgent는 원래대로', (await b.ev(`navigator.userAgent`)) === TABLET_PC_UA && (await b.ev(UA_DESC)) === null);
check('콘솔 예외 0건(갤럭시 탭 SDK)', b.errors.length === 0, b.errors);
await b.close();

// 5-4 안드로이드 휴대폰: 가리지 않음(SDK를 불러오는 동안에도 own userAgent 없음)
b = await launch('ux-directions-android-sdk', { viewport: [390, 844, true] });
await b.send('Emulation.setUserAgentOverride', { userAgent: ANDROID_UA });
await b.send('Network.setBlockedURLs', { urls: BLOCKED.filter((u) => !/kakaocdn/.test(u)) });
await b.send('Fetch.enable', { patterns: [{ urlPattern: '*kakaocdn.net*', requestStage: 'Request' }] });
const heldA = [];
b.listeners.push((m) => { if (m.method === 'Fetch.requestPaused') heldA.push({ id: m.params.requestId, url: m.params.request.url }); });
await prepare(b, { places });
await openPlace(b, 'SW_01');
await b.waitFor(`!!document.getElementById('kakao-navi-sdk')`, 3000).catch(() => {});
check('안드로이드 휴대폰: SDK를 불러오는 동안에도 navigator.userAgent를 가리지 않음(own descriptor 없음)', heldA.length === 1 && (await b.ev(UA_DESC)) === null && (await b.ev(`navigator.userAgent`)) === ANDROID_UA, heldA);
await b.send('Fetch.failRequest', { requestId: heldA[0].id, errorReason: 'Failed' }); await sleep(200);
await b.close();

// 5-2 SDK를 못 받음(외부 주소 차단): 눌러도 알림, 다시 눌러 보면 다시 받아 봄
b = await launch('ux-directions-sdkfail', { viewport: [390, 844, true] });
await b.send('Emulation.setUserAgentOverride', { userAgent: ANDROID_UA });
await prepare(b, { places });
await openPlace(b, 'SW_01');
await reset(b);
await sleep(300);
const first = cdn(b).length;
await clickApp(b, 'kakaonavi'); await b.waitFor(`document.querySelector('#toast').textContent.includes('카카오내비를 열지 못했습니다')`, 4000);
c = await caught(b);
check('SDK를 못 받으면 알림 "카카오내비를 열지 못했습니다. 잠시 뒤 다시 눌러 주세요."', first === 1 && c.dialogs === 0 && c.toast === '카카오내비를 열지 못했습니다. 잠시 뒤 다시 눌러 주세요.' && c.go.length === 0, { first, c });
await b.waitFor(`getComputedStyle(document.querySelector('#toast')).opacity === '1'`, 3000); // 알림은 서서히 나타난다
const toastVisible = await b.ev(`(() => { const t = document.querySelector('#toast'), r = t.getBoundingClientRect(); return { text: t.textContent, visible: r.width > 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, opacity: getComputedStyle(t).opacity }; })()`);
check('알림이 화면 안에 보임', toastVisible.visible && toastVisible.opacity === '1', toastVisible);
await b.shot('ux-directions-sdk-fail-toast');
await reset(b);
await openPlace(b, 'TB_01'); await openPlace(b, 'SW_01'); await sleep(300);
check('장소 상세를 다시 그려도 미리 불러오기는 다시 하지 않음(세션당 한 번, 눌렀을 때 받은 2번째까지만)', cdn(b).length === 2, cdn(b));
await clickApp(b, 'kakaonavi'); await b.waitFor(`document.querySelector('#toast').textContent.includes('카카오내비를 열지 못했습니다')`, 4000); await b.waitFor(`true`);
check('실패한 뒤에는 다시 눌렀을 때(3번째) SDK를 다시 받아 보고 또 실패하면 알림', cdn(b).length === 3 && (await caught(b)).toast === '카카오내비를 열지 못했습니다. 잠시 뒤 다시 눌러 주세요.', cdn(b));
check('콘솔 예외·console.error 0건(SDK 실패)', b.errors.length === 0, b.errors);
await b.close();

await finish();
