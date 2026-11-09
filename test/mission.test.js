import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missionNames, missionProgress } from '../public/mission.js';

test('미션명 맨 끝 숫자까지 미션을 펼친다', () => {
  const missions = missionNames('Q1_A_TA_SW__01_01 ~ _34');
  assert.equal(missions.length, 34);
  assert.equal(missions[0], 'Q1_A_TA_SW__01_01');
  assert.equal(missions[8], 'Q1_A_TA_SW__01_09');
  assert.equal(missions[33], 'Q1_A_TA_SW__01_34');
});

test('물결 뒤에 전체 이름을 써도, 띄어쓰기·전각 물결이 달라도 읽는다', () => {
  assert.equal(missionNames('Q1_B_BE_TB__03_01~Q1_B_BE_TB__03_10').length, 10);
  assert.deepEqual(missionNames('M_1 ～ 3'), ['M_1', 'M_2', 'M_3']);
});

test('첫 미션 번호가 1이 아니면 그 번호부터 센다', () => {
  assert.deepEqual(missionNames('X_05 ~ _07'), ['X_05', 'X_06', 'X_07']);
});

test('포인트 번호와 미션 번호가 붙은 미션명은 물결 뒤 숫자를 개수로 펼친다', () => {
  // 홈포인트_Q1_D_GH_GS CSV 형식: Q1DGHGS01(포인트) + 01(미션) ~ 10
  const gs = missionNames('Q1DGHGS0101 ~ 10');
  assert.equal(gs.length, 10);
  assert.equal(gs[0], 'Q1DGHGS0101');
  assert.equal(gs[9], 'Q1DGHGS0110');
  assert.deepEqual(missionNames('Q1DGHGS1201 ~ 04'), ['Q1DGHGS1201', 'Q1DGHGS1202', 'Q1DGHGS1203', 'Q1DGHGS1204']);
  // 물결 뒤에 전체 이름을 써도 같은 결과
  assert.deepEqual(missionNames('Q1DGHGS0101 ~ Q1DGHGS0103'), ['Q1DGHGS0101', 'Q1DGHGS0102', 'Q1DGHGS0103']);
  // 자릿수가 같은 거꾸로 된 범위는 여전히 미션 하나
  assert.deepEqual(missionNames('X_10 ~ _03'), ['X_10 ~ _03']);
});

test('범위가 아니거나 이상한 범위는 미션 하나로 본다', () => {
  assert.deepEqual(missionNames(''), []);
  assert.deepEqual(missionNames('  '), []);
  assert.deepEqual(missionNames('Q1_A_TA_SW__01_05'), ['Q1_A_TA_SW__01_05']);
  assert.deepEqual(missionNames('X_10 ~ _03'), ['X_10 ~ _03']);
  assert.deepEqual(missionNames('X_01 ~ _9999'), ['X_01 ~ _9999']);
});

test('진행도는 완료한 미션 수와 전체 미션 수다', () => {
  const records = [
    { mission: 'Q1_A_TA_SW__01_01', done: true },
    { mission: 'Q1_A_TA_SW__01_02', done: false, worker: '김철수' },
    { mission: 'Q1_A_TA_SW__01_34', done: true },
  ];
  assert.deepEqual(missionProgress('Q1_A_TA_SW__01_01 ~ _34', records), { total: 34, done: 2 });
  assert.deepEqual(missionProgress('Q1_A_TA_SW__01_01 ~ _34'), { total: 34, done: 0 });
  assert.deepEqual(missionProgress('Q1_A_TA_SW__01_01 ~ _34', undefined), { total: 34, done: 0 });
});

test('미션 범위 밖에 남은 기록은 완료로 세지 않는다', () => {
  const records = [
    { mission: 'X_01', done: true },
    { mission: 'X_09', done: true },
    { mission: 'Y_01', done: true },
  ];
  assert.deepEqual(missionProgress('X_01 ~ _03', records), { total: 3, done: 1 });
  assert.deepEqual(missionProgress('', records), { total: 0, done: 0 });
});

test('done이 정확히 true인 기록만 완료로 센다', () => {
  assert.deepEqual(missionProgress('M_1 ~ 2', [{ mission: 'M_1', done: 1 }, { mission: 'M_2', done: 'true' }]), { total: 2, done: 0 });
});
