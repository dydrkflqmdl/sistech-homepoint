// 현위치 버튼: 한 번 읽기, 점·정확도 원·지도 이동, 교체, 오류 안내, 좌표가 밖으로 안 나감.
import { launch, prepare, reporter, sleep, URL_BASE } from './lib.mjs';

const { check, finish } = reporter('ux-locate');
const b = await launch('ux-locate');
const ev = b.ev;
const origin = new URL(URL_BASE).origin;
const places = [
  { name: 'SW_01', district: '태안', address: '가람면', lat: 37.277767, lng: 126.717126, mission: '' },
  { name: 'TB_01', district: '보은', address: '보은읍', lat: 36.49, lng: 127.73, mission: '' },
];
await b.send('Browser.grantPermissions', { origin, permissions: ['geolocation'] });
await prepare(b, { places });
await b.waitFor(`document.querySelectorAll('.pin').length === 2`, 8000);
const geo = (latitude, longitude, accuracy) => b.send('Emulation.setGeolocationOverride', { latitude, longitude, accuracy });
const state = () => ev(`(() => { const m = __kakaoMaps[0]; const c = [...(m.__circles ?? [])];
  return { dots: document.querySelectorAll('.my-location').length, circles: c.length, radius: c[0]?.radius, level: m.getLevel(), center: [m.center.lat, m.center.lng],
    busy: document.querySelector('#locate-btn').getAttribute('aria-busy'), toast: document.querySelector('#toast').textContent }; })()`);
const press = async () => { await ev(`document.querySelector('#locate-btn').click()`); await sleep(500); };

const h0 = await ev(`(() => { const e = document.querySelector('#locate-btn'); return { h: e.getBoundingClientRect().height, label: e.getAttribute('aria-label') }; })()`);
check('버튼 높이 44px 이상, aria-label "현위치"', h0.h >= 44 && h0.label === '현위치', h0);
check('버튼 십자 아이콘이 실제 SVG로 그려짐(크기 있음)', await ev(`(() => { const s = document.querySelector('#locate-btn .locate-icon svg'); return Boolean(s) && s.getBoundingClientRect().width > 0; })()`));
check('처음엔 점·원 없음', (await state()).dots === 0);

// 좌표가 나가는지 보려고 요청 수와 저장소를 기억해 둔다.
const before = b.requests.length;
await ev(`window.__lsBefore = JSON.stringify(localStorage)`);

// 성공
await geo(37.5, 127.0, 80);
await press();
let s = await state();
check('성공: 점 1개·원 1개(반지름 80)', s.dots === 1 && s.circles === 1 && s.radius === 80, s);
check('성공: 지도가 그 좌표로 이동, 단계 4 이하', s.center[0] === 37.5 && s.center[1] === 127 && s.level <= 4, s);
check('성공: busy 해제', s.busy === 'false', s);
await b.shot('ux-locate-390');

// maximumAge 30초 때문에 브라우저가 앞 위치를 재사용하므로, 이후 점검은 0으로 바꿔 부른다(옵션 값 자체는 아래에서 확인).
await ev(`(() => { const g = navigator.geolocation; const real = g.getCurrentPosition.bind(g); window.__geoOpts = []; g.getCurrentPosition = (ok, err, o) => { window.__geoOpts.push(o); real(ok, err, { ...o, maximumAge: 0 }); }; })()`);
// 두 번째는 교체
await geo(37.6, 127.1, 50);
await press();
s = await state();
check('두 번째 누르면 점·원이 하나씩만(교체)', s.dots === 1 && s.circles === 1 && s.radius === 50 && s.center[0] === 37.6, s);

// 정확도가 너무 나쁘면 원 없이 점만
await geo(37.6, 127.1, 5000);
await press();
s = await state();
check('정확도 2km 초과면 원 없이 점만', s.dots === 1 && s.circles === 0, s);
check('위치 요청 옵션: 높은 정확도·10초·30초', await ev(`JSON.stringify(window.__geoOpts[0]) === '{"enableHighAccuracy":true,"timeout":10000,"maximumAge":30000}'`));
check('내 위치 점은 pointer-events 없음(핀 클릭을 안 막음)', await ev(`getComputedStyle(document.querySelector('.my-location')).pointerEvents === 'none'`));

// 위치 없음
await b.send('Emulation.setGeolocationOverride', {});
await ev(`document.querySelector('#toast').textContent = ''`);
await press();
s = await state();
check('위치 없음: "현위치를 찾지 못했습니다." + busy 해제', s.toast === '현위치를 찾지 못했습니다.' && s.busy === 'false', s);

// 권한 거부는 거부 상태로 처음부터 연다
{
  const d = await launch('ux-locate-denied');
  await d.send('Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'denied', origin });
  await prepare(d, { places });
  await d.waitFor(`document.querySelectorAll('.pin').length === 2`, 8000);
  await d.ev(`document.querySelector('#locate-btn').click()`);
  await d.waitFor(`document.querySelector('#toast').textContent !== ''`, 3000);
  const v = await d.ev(`({ toast: document.querySelector('#toast').textContent, busy: document.querySelector('#locate-btn').getAttribute('aria-busy'), dots: document.querySelectorAll('.my-location').length })`);
  check('권한 거부: 한국어 안내, busy 해제, 점 없음', v.toast === '위치 권한이 꺼져 있습니다. 브라우저(앱) 설정에서 위치를 허용해 주세요.' && v.busy === 'false' && v.dots === 0, v);
  check('권한 거부: 콘솔 오류 0건', d.errors.length === 0, d.errors);
  await d.close();
}

// 대기 중 반복 누름 무시, 시간 초과 안내(가짜 geolocation)
await ev(`window.__geoCalls = 0; navigator.geolocation.getCurrentPosition = (ok, err) => { window.__geoCalls++; window.__geoErr = err; }`);
await ev(`document.querySelector('#locate-btn').click(); document.querySelector('#locate-btn').click()`);
s = await state();
check('대기 중: aria-busy=true, 반복 누름은 한 번만 요청', s.busy === 'true' && (await ev(`window.__geoCalls`)) === 1, s);
await ev(`window.__geoErr({ code: 3 })`);
s = await state();
check('시간 초과: 한국어 안내 + busy 해제', s.toast === '현위치를 찾는 데 시간이 너무 걸립니다. 다시 눌러 주세요.' && s.busy === 'false', s);

// 안전하지 않은 주소 흉내
await ev(`Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true }); 0`);
await press();
check('https 아님: 안내 문구', (await state()).toast === '이 주소에서는 현위치를 쓸 수 없습니다(https에서만 됩니다).');
await ev(`delete window.isSecureContext; 0`);

// 개인정보: 요청에 좌표·Supabase 없음, 저장 없음
const leaked = b.requests.slice(before).filter((u) => /37\.[56]|127\.[01]|supabase/i.test(u));
check('누른 뒤 좌표·Supabase가 담긴 요청 없음', leaked.length === 0, leaked);
check('localStorage 변화 없음', await ev(`JSON.stringify(localStorage) === window.__lsBefore`));
check('콘솔 오류·예외 0건', b.errors.length === 0, b.errors);

// 1280 화면
await b.setViewport(1280, 800, false);
await sleep(300);
await geo(37.5, 127.0, 80);
await ev(`delete navigator.geolocation.getCurrentPosition; 0`);
await press();
check('1280: 점 보임, 버튼 44px 이상', await ev(`document.querySelectorAll('.my-location').length === 1 && document.querySelector('#locate-btn').getBoundingClientRect().height >= 44`));
await b.shot('ux-locate-1280');
await finish(b);
