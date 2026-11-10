import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFlightTime, normalizeFlightTime, parseFlightTime } from '../public/flight-time.js';

test('분·초 칸을 "12분 30초"로 합친다(빈 쪽은 빼고, 앞자리 0은 뗀다)', () => {
  assert.equal(formatFlightTime('12', '30'), '12분 30초');
  assert.equal(formatFlightTime('12', ''), '12분');
  assert.equal(formatFlightTime('', '45'), '45초');
  assert.equal(formatFlightTime('0', '45'), '0분 45초');
  assert.equal(formatFlightTime('05', '07'), '5분 7초');
  assert.equal(formatFlightTime(' ', ''), '');
  assert.equal(formatFlightTime(undefined, null), '');
});

test('저장된 글자를 분·초로 읽는다', () => {
  assert.deepEqual(parseFlightTime('12분 30초'), { min: '12', sec: '30' });
  assert.deepEqual(parseFlightTime('12분30초'), { min: '12', sec: '30' });
  assert.deepEqual(parseFlightTime(' 12 분 '), { min: '12', sec: '' });
  assert.deepEqual(parseFlightTime('45초'), { min: '', sec: '45' });
  assert.deepEqual(parseFlightTime('12:05'), { min: '12', sec: '5' });
  assert.deepEqual(parseFlightTime('7'), { min: '7', sec: '' });
  assert.deepEqual(parseFlightTime('１２분'), { min: '12', sec: '' });
  assert.deepEqual(parseFlightTime(''), { min: '', sec: '' });
  assert.deepEqual(parseFlightTime(null), { min: '', sec: '' });
});

test('분·초로 읽을 수 없는 옛 기록은 null', () => {
  assert.equal(parseFlightTime('약 10분'), null);
  assert.equal(parseFlightTime('12분 75초'), null);
  assert.equal(parseFlightTime('1시간'), null);
  assert.equal(parseFlightTime('1234'), null);
});

test('같은 비행시간인지 비교하는 꼴', () => {
  assert.equal(normalizeFlightTime('12분30초'), '12분 30초');
  assert.equal(normalizeFlightTime('12:30'), '12분 30초');
  assert.equal(normalizeFlightTime(' 약 10분 '), '약 10분');
  assert.equal(normalizeFlightTime(''), '');
  // 읽은 값을 다시 합치면 그대로
  for (const t of ['12분 30초', '12분', '45초', '0분 5초']) assert.equal(formatFlightTime(parseFlightTime(t).min, parseFlightTime(t).sec), t);
});
