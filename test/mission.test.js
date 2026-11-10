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

test('붙은 표기는 잘라낸 뒷자리가 정확히 1일 때만 쓴다', () => {
  // 뒷자리가 1이 아니면 거꾸로 된 범위라 미션 하나
  assert.deepEqual(missionNames('Q1_A_10 ~ 9'), ['Q1_A_10 ~ 9']);
  assert.deepEqual(missionNames('Q1_A_12 ~ 5'), ['Q1_A_12 ~ 5']);
  assert.deepEqual(missionNames('Q1DGHGS0100 ~ 10'), ['Q1DGHGS0100 ~ 10']);
  assert.deepEqual(missionNames('A100 ~ 99'), ['A100 ~ 99']);
  // 뒷자리가 1이면 앞자리를 이름에 붙인다
  assert.equal(missionNames('Q1DGHGS0101 ~ 10').length, 10);
  assert.deepEqual(missionNames('Q1DGHGS0001 ~ 03'), ['Q1DGHGS0001', 'Q1DGHGS0002', 'Q1DGHGS0003']);
});

test('물결 뒤 글자는 물결 앞 이름의 끝부분이어야 범위다', () => {
  assert.deepEqual(missionNames('Q1_A_TA_GH__01_01 ~ _02'), ['Q1_A_TA_GH__01_01', 'Q1_A_TA_GH__01_02']);
  assert.equal(missionNames('Q1_B_BE_TB__03_01~Q1_B_BE_TB__03_10').length, 10);
  assert.equal(missionNames('Q1_A_TA_GH__01_01 ~ GH__01_ 05').length, 5); // 앞뒤 공백은 무시
  // 다른 포인트 이름이면 오타로 보고 미션 하나
  assert.deepEqual(missionNames('Q1_A_TA_GH__01_01 ~ Q1_A_TA_GH__02_05'), ['Q1_A_TA_GH__01_01 ~ Q1_A_TA_GH__02_05']);
  assert.deepEqual(missionNames('Q1_A_TA_GH__01_01 ~ X_05'), ['Q1_A_TA_GH__01_01 ~ X_05']);
  // 붙은 표기에서는 포인트 번호까지 붙인 이름(Q1DGHGS01)과 비교한다
  assert.equal(missionNames('Q1DGHGS0101 ~ Q1DGHGS0105').length, 5);
  assert.deepEqual(missionNames('A0101 ~ A10'), ['A0101 ~ A10']);
});

test('물결 ∼(U+223C)과 전각 숫자도 읽고, 결과는 반각 숫자다', () => {
  assert.deepEqual(missionNames('A1 ∼ 3'), ['A1', 'A2', 'A3']);
  assert.deepEqual(missionNames('B０１~０３'), ['B01', 'B02', 'B03']);
  assert.deepEqual(missionNames('Q1DGHGS０１０１ ～ １０'), missionNames('Q1DGHGS0101 ~ 10'));
  assert.deepEqual(missionNames('전각１２３'), ['전각123']);
});

test('숫자 묶음이 15자리를 넘으면 범위로 보지 않는다', () => {
  assert.deepEqual(missionNames('a123456789012345~123456789012346'), ['a123456789012345', 'a123456789012346']);
  assert.deepEqual(missionNames('a1234567890123456~1234567890123457'), ['a1234567890123456~1234567890123457']);
  assert.deepEqual(missionNames('a0000000000000001~3'), ['a0000000000000001~3']);
});

test('빗금으로 나뉜 미션명은 조각마다 펼쳐 이어 붙인다(한 행에 포인트 두 개)', () => {
  const bs = missionNames('Q1ASSBS1701 ~ 09 / Q1ASSBS1801 ~ 05');
  assert.equal(bs.length, 14); // 소티 0/14
  assert.equal(bs[0], 'Q1ASSBS1701');
  assert.equal(bs[8], 'Q1ASSBS1709');
  assert.equal(bs[9], 'Q1ASSBS1801');
  assert.equal(bs[13], 'Q1ASSBS1805');
  assert.equal(missionNames('Q1ASSIJ1001 ~ 17 / Q1ASSIJ1101 ~ 07').length, 24);
  assert.equal(missionNames('Q1ASSIJ1201 ~ 13 / Q1ASSIJ1301 ~ 10').length, 23);
  assert.deepEqual(missionNames('A1~3 ／ B1~2'), ['A1', 'A2', 'A3', 'B1', 'B2']); // 전각 빗금
  assert.deepEqual(missionNames('A1~3 / A2~4'), ['A1', 'A2', 'A3', 'A4']); // 겹치는 미션은 한 번만
  assert.deepEqual(missionNames('A1~3 / B1~2 / C5'), ['A1', 'A2', 'A3', 'B1', 'B2', 'C5']);
  // 빈 조각이 있으면 나누지 않고 예전처럼 통째로 본다
  assert.deepEqual(missionNames('A1~3 /'), ['A1~3 /']);
  assert.deepEqual(missionNames('A1~3 /  / B1~2'), ['A1~3 /  / B1~2']);
  // 합쳐서 500개를 넘으면 펼치지 않는다
  assert.equal(missionNames('X1~300 / Y1~200').length, 500);
  assert.deepEqual(missionNames('X1~300 / Y1~201'), ['X1~300 / Y1~201']);
  assert.deepEqual(missionProgress('Q1ASSBS1701 ~ 09 / Q1ASSBS1801 ~ 05', [{ mission: 'Q1ASSBS1803', done: true }]), { total: 14, done: 1 });
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
