import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundCoord } from '../public/coord.js';

// DB의 round_coord(round(x::numeric, 7))와 같은 결과여야 한다. SQL과의 비교는 supabase/tests/coord-cases.mjs가 맡는다.

test('소수 7자리로 반올림한다', () => {
  assert.equal(roundCoord(36.766667), 36.766667);
  assert.equal(roundCoord(36.12345678912), 36.1234568);
  assert.equal(roundCoord(126.1), 126.1);
  assert.equal(roundCoord(180), 180);
});

test('8자리가 5로 끝나면 이진 오차와 상관없이 0에서 먼 쪽으로 올린다', () => {
  // Math.round(n * 1e7) / 1e7은 35.1234568이 나와 DB(35.1234569)와 달랐다
  assert.equal(roundCoord(35.12345685), 35.1234569);
  assert.equal(roundCoord(-35.12345685), -35.1234569);
  assert.equal(roundCoord(-127.12345675), -127.1234568);
  assert.equal(roundCoord(-33.00000005), -33.0000001);
  assert.equal(roundCoord(-89.99999995), -90);
  assert.equal(roundCoord(0.00000005), 0.0000001);
  assert.equal(roundCoord(-0.00000005), -0.0000001);
});

test('유효숫자 15자리를 넘는 값은 DB처럼 15자리 십진수로 본 뒤 반올림한다', () => {
  assert.equal(roundCoord(37.123456749999995), 37.1234568); // 15자리: 37.1234567500000
  assert.equal(roundCoord(0.30000000000000004), 0.3);
  assert.equal(roundCoord(123456789.123456789), 123456789.123457);
});

test('0, -0, 0이 되는 값은 +0이고 NaN·Infinity는 그대로', () => {
  assert.ok(Object.is(roundCoord(0), 0));
  assert.ok(Object.is(roundCoord(-0), 0));
  assert.ok(Object.is(roundCoord(-0.00000004), 0));
  assert.ok(Object.is(roundCoord(1e-300), 0));
  assert.ok(Number.isNaN(roundCoord(NaN)));
  assert.equal(roundCoord(Infinity), Infinity);
  assert.equal(roundCoord(-Infinity), -Infinity);
});

test('지수 표기로 나오는 아주 작거나 큰 값', () => {
  assert.equal(roundCoord(1e-7), 1e-7);
  assert.equal(roundCoord(5e-8), 1e-7);
  assert.equal(roundCoord(4.9999999e-8), 0);
  assert.equal(roundCoord(1e21), 1e21);
  assert.equal(roundCoord(-1e21), -1e21);
});
