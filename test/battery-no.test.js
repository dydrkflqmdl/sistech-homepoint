import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBatteryNo, normalizeBatteryNo, parseBatteryNo } from '../public/battery-no.js';

test('두 칸을 "3-4"로 합친다(앞자리 0은 그대로)', () => {
  assert.equal(formatBatteryNo('3', '4'), '3-4');
  assert.equal(formatBatteryNo(' 3 ', '4 '), '3-4');
  assert.equal(formatBatteryNo('07', '2'), '07-2');
  assert.equal(formatBatteryNo('0', '0'), '0-0');
  assert.equal(formatBatteryNo('', ''), '');
  assert.equal(formatBatteryNo(' ', undefined), '');
  assert.equal(formatBatteryNo(null, null), '');
});

test('한 칸만 차 있으면 빈 쪽을 비운 꼴("3-", "-4")', () => {
  assert.equal(formatBatteryNo('3', ''), '3-');
  assert.equal(formatBatteryNo('', '4'), '-4');
});

test('저장된 글자를 두 칸으로 읽는다', () => {
  assert.deepEqual(parseBatteryNo('3-4'), { a: '3', b: '4' });
  assert.deepEqual(parseBatteryNo('3 - 4'), { a: '3', b: '4' });
  assert.deepEqual(parseBatteryNo(' 3~4 '), { a: '3', b: '4' });
  assert.deepEqual(parseBatteryNo('３－４'), { a: '3', b: '4' });
  assert.deepEqual(parseBatteryNo('3–4'), { a: '3', b: '4' });
  assert.deepEqual(parseBatteryNo('3—4'), { a: '3', b: '4' });
  assert.deepEqual(parseBatteryNo('07-012'), { a: '07', b: '012' });
  assert.deepEqual(parseBatteryNo(''), { a: '', b: '' });
  assert.deepEqual(parseBatteryNo(null), { a: '', b: '' });
});

test('두 칸으로 읽을 수 없는 옛 기록은 null', () => {
  assert.equal(parseBatteryNo('3'), null);
  assert.equal(parseBatteryNo('3번'), null);
  assert.equal(parseBatteryNo('A2'), null);
  assert.equal(parseBatteryNo('3-'), null);
  assert.equal(parseBatteryNo('-4'), null);
  assert.equal(parseBatteryNo('1-2-3'), null);
  assert.equal(parseBatteryNo('1234-5'), null);
});

test('같은 배터리 번호인지 비교하는 꼴', () => {
  assert.equal(normalizeBatteryNo('3 - 4'), '3-4');
  assert.equal(normalizeBatteryNo('３－４'), '3-4');
  assert.equal(normalizeBatteryNo(' 3번 '), '3번');
  assert.equal(normalizeBatteryNo('1'), '1');
  assert.equal(normalizeBatteryNo(''), '');
  assert.equal(normalizeBatteryNo(undefined), '');
  // 읽은 값을 다시 합치면 그대로, 앞자리 0도 그대로
  for (const t of ['3-4', '07-2', '0-0', '12-345']) assert.equal(formatBatteryNo(parseBatteryNo(t).a, parseBatteryNo(t).b), t);
});
