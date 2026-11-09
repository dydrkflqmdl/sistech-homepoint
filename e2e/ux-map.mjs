// B-8 지도 실패·재시도·인터넷 복구, 오프라인 띠 / B-12(C8) 새 버전 알림.
// 진짜 카카오 SDK는 늘 막혀 있다(BLOCKED). 가짜 SDK를 처음부터 심지 않으면 지도는 실패하고, 나중에 심은 뒤 다시 불러 본다.
import fs from 'node:fs';
import path from 'node:path';
import { E2E, launch, prepare, reporter, sleep, URL_BASE } from './lib.mjs';

const { check, finish } = reporter('ux-map');
const FAKE_KAKAO = fs.readFileSync(path.join(E2E, 'fake-kakao.js'), 'utf-8');
const places = [
  { name: 'SW_01', district: '태안', address: '가람면', lat: 37.277767, lng: 126.717126, mission: 'M_01 ~ _02', memo: '' },
  { name: 'TB_01', district: '보은', address: '보은읍', lat: 36.49, lng: 127.73, mission: '' },
];
const mapText = `document.querySelector('#map').textContent`;

// ── 지도 실패 → 작업자용 문구 + [지도 다시 불러오기] ──
{
  const b = await launch('ux-map-a', { fakeKakao: false });
  const warns = [];
  b.listeners.push((m) => {
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning') warns.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await prepare(b, { places });
  await b.waitFor(`!!document.querySelector('#map-retry')`, 20000);
  let v = await b.ev(`({ text: ${mapText}, button: document.querySelector('#map-retry')?.textContent, list: document.querySelectorAll('#place-list .group').length })`);
  check('지도를 못 불러오면 "지도를 불러오지 못했습니다. 인터넷이 약하면 목록과 길찾기는 그대로 쓸 수 있습니다." + [지도 다시 불러오기]',
    v.text.startsWith('지도를 불러오지 못했습니다. 인터넷이 약하면 목록과 길찾기는 그대로 쓸 수 있습니다.') && v.button === '지도 다시 불러오기', v);
  check('관리자용 설명(developers.kakao.com·등록 도메인)은 화면에 없고 콘솔(warn)에만', !/developers\.kakao\.com|Web 플랫폼/.test(v.text) && warns.some((w) => /developers\.kakao\.com/.test(w) && /Web 플랫폼/.test(w)), { text: v.text, warns: warns.filter((w) => /kakao/.test(w)) });
  check('지도가 없어도 목록은 그대로', v.list === 2, v);
  await b.ev(`__e2e.row('SW_01').click()`);
  await sleep(200);
  check('지도가 없어도 상세 정보·길찾기 단추는 그대로', await b.ev(`!document.querySelector('#detail').hidden && [...document.querySelectorAll('#detail .route-actions .btn')].map(x => x.textContent).join() === '카카오맵 길찾기,카카오맵에서 보기'`));
  await b.shot('ux-map-failed-390');
  // 가짜 SDK를 심고 [지도 다시 불러오기]
  await b.ev(FAKE_KAKAO);
  await b.ev(`document.querySelector('#map-retry').click()`);
  await b.waitFor(`document.querySelectorAll('.pin').length === 2`, 5000);
  v = await b.ev(`({ maps: window.__kakaoMaps?.length ?? 0, pins: document.querySelectorAll('.pin').length, controls: document.querySelectorAll('.map-controls').length, retry: !!document.querySelector('#map-retry') })`);
  check('[지도 다시 불러오기] → 지도·핀·지도 단추가 생김', v.maps === 1 && v.pins === 2 && v.controls === 1 && !v.retry, v);
  check('콘솔 오류·예외 0건(지도 실패)', b.errors.length === 0, b.errors);
  await b.close();
}

// ── 인터넷이 돌아오면(online) 저절로 다시 불러옴, 오프라인 띠 ──
{
  const b = await launch('ux-map-b', { fakeKakao: false });
  await prepare(b, { places });
  await b.waitFor(`!!document.querySelector('#map-retry')`, 20000);
  check('처음에는 오프라인 띠가 없음', await b.ev(`document.querySelector('#offline-band').hidden`));
  await b.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await b.waitFor(`!document.querySelector('#offline-band').hidden`, 3000);
  let v = await b.ev(`({ text: document.querySelector('#offline-band').textContent, role: document.querySelector('#offline-band').getAttribute('role'), onLine: navigator.onLine,
    top: Math.round(document.querySelector('#offline-band').getBoundingClientRect().top), docScroll: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight })`);
  check('인터넷이 끊기면 화면 맨 위에 "오프라인입니다. 저장은 연결 후에 됩니다"(role=status), 문서 스크롤 없음', v.text === '오프라인입니다. 저장은 연결 후에 됩니다' && v.role === 'status' && !v.onLine && v.top === 0 && !v.docScroll, v);
  await b.shot('ux-offline-390');
  // 끊긴 동안 메모 저장 실패 → 돌아오면 다시 보냄
  await b.ev(`__e2e.row('SW_01').click()`);
  await sleep(200);
  await b.ev(`__fake.failNext({ status: 0, code: '', message: 'TypeError: Failed to fetch', name: 'update_memo' })`);
  await b.ev(`(() => { const t = document.querySelector('#memo-input'); t.value = '끊긴 동안 쓴 메모'; t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await b.waitFor(`/저장 안 됨/.test(document.querySelector('#memo-status').textContent)`, 3000);
  await b.ev(FAKE_KAKAO);
  await b.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await b.waitFor(`document.querySelectorAll('.pin').length === 2`, 5000);
  await b.waitFor(`document.querySelector('#memo-status').textContent.trim() === '저장됨'`, 3000);
  v = await b.ev(`({ band: document.querySelector('#offline-band').hidden, pins: document.querySelectorAll('.pin').length, memo: __fake.store().find(p => p.name === 'SW_01').memo, status: document.querySelector('#memo-status').textContent.trim() })`);
  check('인터넷이 돌아오면(online) 띠가 사라지고 지도를 저절로 다시 불러옴', v.band && v.pins === 2, v);
  check('인터넷이 돌아오면 저장 못 한 메모를 저절로 다시 보냄', v.memo === '끊긴 동안 쓴 메모' && v.status === '저장됨', v);
  check('콘솔 오류·예외 0건(오프라인)', b.errors.length === 0, b.errors);
  await b.close();
}

// ── 새 버전 알림(C8): window.APP_BUILD가 있을 때만 version.json을 본다 ──
{
  const b = await launch('ux-version');
  // 빌드가 config.js 끝에 붙이는 값을 흉내 낸다. version.json은 가로채서 다른 빌드를 돌려준다.
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.APP_BUILD = "aaa1111";' });
  // fetch에 넘긴 옵션(cache)을 남긴다.
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__fetches = []; const __f = window.fetch.bind(window); window.fetch = (u, o) => { window.__fetches.push({ url: String(u), cache: o?.cache ?? null }); return __f(u, o); };' });
  let served = '{"build":"aaa1111"}';
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*version.json*', requestStage: 'Request' }] });
  const versionRequests = [];
  b.listeners.push((m) => {
    if (m.method !== 'Fetch.requestPaused') return;
    versionRequests.push(m.params.request.url);
    b.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(served).toString('base64') });
  });
  await prepare(b, { places });
  const visible = () => b.ev(`document.dispatchEvent(new Event('visibilitychange'))`);
  await visible();
  await sleep(300);
  check('같은 빌드면 탭이 다시 보여도 띠 없음(version.json은 받음)', (await b.ev(`document.querySelector('#update-banner').hidden`)) && versionRequests.length >= 1, versionRequests);
  served = '{"build":"bbb2222"}';
  await visible();
  await b.waitFor(`!document.querySelector('#update-banner').hidden`, 2000);
  const v = await b.ev(`({ text: document.querySelector('#update-banner').textContent.replace(/\\s+/g, ' ').trim(), button: document.querySelector('#update-reload').textContent })`);
  check('다른 빌드가 배포되면 "새 버전이 있습니다 [새로고침]" 띠', v.text === '새 버전이 있습니다 새로고침' && v.button === '새로고침', v);
  const fetches = await b.ev(`window.__fetches.filter((f) => f.url.includes('version.json'))`);
  check('version.json은 캐시 없이(cache: no-store) 받음', fetches.length >= 2 && fetches.every((f) => f.cache === 'no-store'), fetches);
  await b.shot('ux-update-banner-390');
  check('콘솔 오류·예외 0건(새 버전)', b.errors.length === 0, b.errors);
  await b.send('Fetch.disable');
  await b.close();
}
{
  // APP_BUILD가 없으면(개발 서버) version.json을 부르지 않는다.
  const b = await launch('ux-version-none');
  await prepare(b, { places });
  await b.ev(`document.dispatchEvent(new Event('visibilitychange'))`);
  await sleep(300);
  check('window.APP_BUILD가 없으면 version.json을 부르지 않고 띠도 없음', !b.requests.some((u) => u.includes('version.json')) && (await b.ev(`document.querySelector('#update-banner').hidden`)), b.requests.filter((u) => u.includes('version')));
  await b.navigate(URL_BASE, 300);
  check('콘솔 오류·예외 0건(빌드 표시 없음)', b.errors.length === 0, b.errors);
  await b.close();
}

await finish(null);
