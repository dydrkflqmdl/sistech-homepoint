import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventLabel, formatLogTime, shortUserAgent } from '../public/login-log.js';

test('시각은 기기 시간대 기준 YYYY-MM-DD HH:mm', () => {
  const d = new Date(2026, 10, 6, 9, 5, 42); // 기기 시간대의 2026-11-06 09:05:42
  assert.equal(formatLogTime(d.toISOString()), '2026-11-06 09:05');
  assert.equal(formatLogTime(''), '-');
  assert.equal(formatLogTime(null), '-');
  assert.equal(formatLogTime('아님'), '-');
});

test('동작 이름', () => {
  assert.equal(eventLabel('login'), '로그인');
  assert.equal(eventLabel('logout'), '로그아웃');
  assert.equal(eventLabel(undefined), '-');
});

test('기기는 운영체제 · 브라우저로 짧게', () => {
  const cases = [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'iPhone · Safari'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1', 'iPhone · Chrome'],
    ['Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1', 'iPad · Safari'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36', 'Android · Samsung'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36', 'Android · Chrome'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S921N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36;KAKAOTALK 2410150', 'Android · 카카오톡'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Mac · Chrome'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'Mac · Safari'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0', 'Windows · Edge'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Whale/3.27.254.15 Safari/537.36', 'Windows · Whale'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0', 'Windows · Firefox'],
    ['curl/8.4.0', '기타'],
    ['', '-'],
    [null, '-'],
  ];
  for (const [ua, want] of cases) assert.equal(shortUserAgent(ua), want, String(ua));
});
