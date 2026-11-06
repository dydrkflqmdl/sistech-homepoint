import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, colorLabel, progressColor } from '../public/palette.js';
import { missionProgress } from '../public/mission.js';

test('색은 미진행·진행 중·완료 세 가지뿐이다', () => {
  assert.deepEqual(
    PALETTE.map((c) => c.label),
    ['미진행', '진행 중', '완료'],
  );
});

test('완료한 미션이 없으면 빨강, 일부면 주황, 전부면 초록', () => {
  const [red, orange, green] = PALETTE.map((c) => c.hex);
  assert.equal(progressColor({ total: 34, done: 0 }), red);
  assert.equal(progressColor({ total: 34, done: 1 }), orange);
  assert.equal(progressColor({ total: 34, done: 33 }), orange);
  assert.equal(progressColor({ total: 34, done: 34 }), green);
  // 미션이 없는 장소는 한 것이 없으므로 빨강
  assert.equal(progressColor({ total: 0, done: 0 }), red);
  assert.equal(colorLabel(green), '완료');
});

test('missionProgress 결과를 그대로 넣어 쓴다', () => {
  const records = [{ mission: 'X_01', done: true }, { mission: 'X_02', done: true }];
  assert.equal(colorLabel(progressColor(missionProgress('X_01 ~ _02', records))), '완료');
  assert.equal(colorLabel(progressColor(missionProgress('X_01 ~ _03', records))), '진행 중');
  assert.equal(colorLabel(progressColor(missionProgress('X_01 ~ _03', []))), '미진행');
});
