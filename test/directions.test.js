import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  androidIntentUrl, kakaoMapAppUrl, kakaoMapRouteUrl, kakaoMapViewUrl, naverMapAppUrl, naverMapWebUrl, needsPhone, platformOf, routeTarget, ROUTE_APPS,
  tmapAppUrl, TMAP_APPSTORE_URL, TMAP_PLAY_URL,
} from '../public/directions.js';

// 서울시청 근처: 위도 37.5663, 경도 126.9779. 좌표 순서(위도·경도 / 경도·위도)가 앱마다 달라서 숫자를 서로 다르게 잡아 두고 본다.
const place = { name: '서울시청', lat: 37.5663, lng: 126.9779 };
const ORIGIN = 'https://sistech.dpdns.org';
const name = encodeURIComponent('서울시청');

test('기기 구분: 안드로이드·iOS·iPadOS(터치 Macintosh)·PC', () => {
  assert.equal(platformOf('Mozilla/5.0 (Linux; Android 14; SM-S911N) Chrome/126 Mobile', 5), 'android');
  assert.equal(platformOf('Mozilla/5.0 (Linux; Android 14; wv) HomePointNavi/1.0.2', 5), 'android');
  assert.equal(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', 5), 'ios');
  assert.equal(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), 'ios');
  assert.equal(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), 'pc');
  assert.equal(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126', 0), 'pc');
});

test('카카오맵: 앱은 위도,경도 순서·이름 없음·자동차, 웹은 이름,위도,경도', () => {
  assert.equal(kakaoMapAppUrl(place), 'kakaomap://route?ep=37.5663,126.9779&by=car');
  assert.equal(kakaoMapRouteUrl(place), `https://map.kakao.com/link/to/${name},37.5663,126.9779`);
  assert.equal(kakaoMapViewUrl(place), `https://map.kakao.com/link/map/${name},37.5663,126.9779`);
});

test('카카오맵 웹 주소: 이름 안의 쉼표·슬래시는 지우고, 이름이 비면 "목적지"', () => {
  assert.equal(kakaoMapRouteUrl({ ...place, name: 'A,B/C 지점' }), `https://map.kakao.com/link/to/${encodeURIComponent('A B C 지점')},37.5663,126.9779`);
  assert.equal(kakaoMapRouteUrl({ ...place, name: ' , / ' }), `https://map.kakao.com/link/to/${encodeURIComponent('목적지')},37.5663,126.9779`);
});

test('네이버지도 앱: dlat=위도, dlng=경도, 이름·appname 인코딩', () => {
  assert.equal(
    naverMapAppUrl(place, ORIGIN),
    `nmap://route/car?dlat=37.5663&dlng=126.9779&dname=${name}&appname=${encodeURIComponent(ORIGIN)}`,
  );
  assert.match(naverMapAppUrl(place, ORIGIN), /appname=https%3A%2F%2Fsistech\.dpdns\.org$/);
  // 앱 주소의 이름은 쉼표도 그대로 인코딩해 넘긴다(%2C), 공백·&도 안전하게.
  assert.match(naverMapAppUrl({ ...place, name: 'A, B&C' }, ORIGIN), /dname=A%2C%20B%26C&/);
  assert.match(naverMapAppUrl({ ...place, name: '  ' }, ORIGIN), new RegExp(`dname=${encodeURIComponent('목적지')}&`));
});

test('네이버지도 웹: 출발지는 비우고(-) 도착지는 경도,위도,이름, 자동차', () => {
  assert.equal(naverMapWebUrl(place), `https://map.naver.com/p/directions/-/126.9779,37.5663,${name},,/-/car`);
  // 쉼표가 이름 칸을 깨지 않게 지운다
  assert.equal(naverMapWebUrl({ ...place, name: 'A,B' }), `https://map.naver.com/p/directions/-/126.9779,37.5663,${encodeURIComponent('A B')},,/-/car`);
});

test('티맵 앱: goalx=경도, goaly=위도, goalname 인코딩', () => {
  assert.equal(tmapAppUrl(place), `tmap://route?goalname=${name}&goalx=126.9779&goaly=37.5663`);
});

test('안드로이드 intent 꼴: scheme·action·category·package·대체 주소(한 번 인코딩)', () => {
  const url = androidIntentUrl('kakaomap://route?ep=1,2&by=car', 'net.daum.android.map', 'https://map.kakao.com/link/to/a%20b,1,2');
  assert.equal(
    url,
    'intent://route?ep=1,2&by=car#Intent;scheme=kakaomap;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;' +
      'package=net.daum.android.map;S.browser_fallback_url=https%3A%2F%2Fmap.kakao.com%2Flink%2Fto%2Fa%2520b%2C1%2C2;end',
  );
  // 대체 주소를 한 번 디코딩하면 원래 주소(이름의 %20 포함)가 나온다
  const fb = url.match(/S\.browser_fallback_url=([^;]*);end$/)[1];
  assert.equal(decodeURIComponent(fb), 'https://map.kakao.com/link/to/a%20b,1,2');
  // 대체 주소의 ; 와 # 이 intent 구분자를 깨지 않는다
  const tricky = androidIntentUrl('tmap://route?x=1', 'p', 'https://e.com/a;b#c');
  assert.match(tricky, /S\.browser_fallback_url=https%3A%2F%2Fe\.com%2Fa%3Bb%23c;end$/);
});

test('안드로이드: 카카오맵·네이버지도·티맵은 intent, 대체는 웹 길찾기 / 웹 길찾기 / 플레이스토어', () => {
  const ctx = { platform: 'android', origin: ORIGIN };
  const k = routeTarget('kakaomap', place, ctx);
  assert.equal(k.type, 'intent');
  assert.equal(k.url, androidIntentUrl(kakaoMapAppUrl(place), 'net.daum.android.map', kakaoMapRouteUrl(place)));
  assert.match(k.url, /^intent:\/\/route\?ep=37\.5663,126\.9779&by=car#Intent;scheme=kakaomap;/);
  const n = routeTarget('navermap', place, ctx);
  assert.equal(n.type, 'intent');
  assert.equal(n.url, androidIntentUrl(naverMapAppUrl(place, ORIGIN), 'com.nhn.android.nmap', naverMapWebUrl(place)));
  assert.match(n.url, /^intent:\/\/route\/car\?dlat=37\.5663&dlng=126\.9779&dname=.*&appname=https%3A%2F%2Fsistech\.dpdns\.org#Intent;scheme=nmap;.*package=com\.nhn\.android\.nmap;/);
  const t = routeTarget('tmap', place, ctx);
  assert.equal(t.type, 'intent');
  assert.equal(t.url, androidIntentUrl(tmapAppUrl(place), 'com.skt.tmap.ku', TMAP_PLAY_URL));
  assert.match(t.url, /package=com\.skt\.tmap\.ku;S\.browser_fallback_url=https%3A%2F%2Fplay\.google\.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom\.skt\.tmap\.ku;end$/);
});

test('iOS: 앱 주소로 가 보고 대체 주소(웹 길찾기 / 웹 길찾기 / 앱스토어)', () => {
  const ctx = { platform: 'ios', origin: ORIGIN };
  assert.deepEqual(routeTarget('kakaomap', place, ctx), { type: 'scheme', url: kakaoMapAppUrl(place), fallback: kakaoMapRouteUrl(place) });
  assert.deepEqual(routeTarget('navermap', place, ctx), { type: 'scheme', url: naverMapAppUrl(place, ORIGIN), fallback: naverMapWebUrl(place) });
  assert.deepEqual(routeTarget('tmap', place, ctx), { type: 'scheme', url: tmapAppUrl(place), fallback: TMAP_APPSTORE_URL });
  assert.equal(TMAP_APPSTORE_URL, 'https://apps.apple.com/kr/app/id431589174');
});

test('PC: 카카오맵·네이버지도는 웹 길찾기 새 탭, 카카오내비·티맵은 열 수 없음', () => {
  const ctx = { platform: 'pc', origin: ORIGIN };
  assert.deepEqual(routeTarget('kakaomap', place, ctx), { type: 'tab', url: kakaoMapRouteUrl(place) });
  assert.deepEqual(routeTarget('navermap', place, ctx), { type: 'tab', url: naverMapWebUrl(place) });
  assert.deepEqual(routeTarget('kakaonavi', place, ctx), { type: 'unavailable' });
  assert.deepEqual(routeTarget('tmap', place, ctx), { type: 'unavailable' });
  assert.deepEqual(ROUTE_APPS.filter((a) => needsPhone(a.id, 'pc')).map((a) => a.id), ['kakaonavi', 'tmap']);
  assert.deepEqual(ROUTE_APPS.filter((a) => needsPhone(a.id, 'android')), []);
});

test('카카오내비는 휴대폰에서 어느 기기든 SDK 호출(navi)', () => {
  for (const platform of ['android', 'ios']) assert.deepEqual(routeTarget('kakaonavi', place, { platform, origin: ORIGIN }), { type: 'navi' });
});

test('앱 목록 순서와 이름', () => {
  assert.deepEqual(ROUTE_APPS.map((a) => a.label), ['카카오맵', '네이버지도', '카카오내비', '티맵']);
  assert.throws(() => routeTarget('nope', place, { platform: 'android', origin: ORIGIN }));
});
