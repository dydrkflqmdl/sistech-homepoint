import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCsv, detectColumns, joinSplitHeaders, parseCsv, pointName, readPlaces, stripDistrict, toCsv } from '../public/csv.js';

const bytes = (s) => new TextEncoder().encode(s);

test('따옴표 안의 쉼표·줄바꿈·이스케이프된 따옴표를 읽는다', () => {
  const records = parseCsv('이름,메모\r\n"가게, 본점","첫 줄\n둘째 줄 ""인기"""\r\n\r\n카페,\n');
  assert.deepEqual(records, [
    { line: 1, cells: ['이름', '메모'] },
    { line: 2, cells: ['가게, 본점', '첫 줄\n둘째 줄 "인기"'] },
    { line: 5, cells: ['카페', ''] },
  ]);
});

test('탭으로 구분한 파일도 읽는다', () => {
  assert.deepEqual(parseCsv('이름\t위도\t경도\n집\t37.5\t127.0').map((r) => r.cells), [
    ['이름', '위도', '경도'],
    ['집', '37.5', '127.0'],
  ]);
});

test('UTF-8 BOM을 지우고, UTF-8이 아니면 EUC-KR로 읽는다', () => {
  assert.equal(decodeCsv(bytes('﻿이름')), '이름');
  // "한글" in EUC-KR
  assert.equal(decodeCsv(Uint8Array.from([0xc7, 0xd1, 0xb1, 0xdb])), '한글');
});

test('한글·영문 머리글을 알아본다', () => {
  assert.deepEqual(detectColumns([' 장소명 ', 'Latitude', 'LONGITUDE', '도로명 주소', '시/군', '색상']), {
    name: 0,
    lat: 1,
    lng: 2,
    address: 3,
    district: 4,
  });
  assert.deepEqual(detectColumns(['name', 'y', 'x']), { name: 0, lat: 1, lng: 2 });
});

test('홈포인트 코드는 맨 뒤 번호와 그 앞 영문만 이름으로 쓴다', () => {
  assert.equal(pointName('A_TA_GH_16'), 'GH_16');
  assert.equal(pointName('C_SA_JE_9'), 'JE_9');
  assert.equal(pointName('A-TA-GH16'), 'GH16');
  assert.equal(pointName('GH_16'), 'GH_16');
  assert.equal(pointName('Q1_A_TA_SW_01'), 'SW_01');
  // 코드 형태가 아니면 그대로
  assert.equal(pointName('서울역'), '서울역');
  assert.equal(pointName('Lotte World Tower 2'), 'Lotte World Tower 2');
  assert.equal(pointName('AB_12_34'), 'AB_12_34');
});

test('홈포인트 CSV 형식을 읽는다 (괄호 붙은 주소 머리글, 모르는 열은 무시)', () => {
  const csv = [
    '\uFEFF이름,시군,읍면,작업자,위도,경도,주소(팜맵 필지 기준),소티,완료 소티,카카오맵 길안내',
    'A_TA_GH_16,태안,근흥면,,36.68,126.13,태안 근흥면 신진도리 인근,1,0,"https://map.kakao.com/link/to/A_TA_GH_16,36.68,126.13"',
    'C_SA_JE_17,신안,자은면,SH,34.90,126.06,신안 자은면 송산리 인근,28,0,"https://map.kakao.com/link/to/C_SA_JE_17,34.90,126.06"',
  ].join('\r\n');
  const { places, errors, columns } = readPlaces(bytes(csv));
  assert.deepEqual(errors, []);
  assert.deepEqual(columns, ['name', 'district', 'lat', 'lng', 'address']);
  assert.deepEqual(
    places.map(({ name, address, lat, lng }) => ({ name, address, lat, lng })),
    [
      { name: 'GH_16', address: '근흥면 신진도리 인근', lat: 36.68, lng: 126.13 },
      { name: 'JE_17', address: '자은면 송산리 인근', lat: 34.9, lng: 126.06 },
    ],
  );
});

test('머리글 괄호 안의 따옴표 없는 쉼표로 나뉜 칸을 다시 붙인다', () => {
  assert.deepEqual(joinSplitHeaders(['이름', '주소(팜맵 필지 기준', ' 인근)', '위도']), ['이름', '주소(팜맵 필지 기준, 인근)', '위도']);
  assert.deepEqual(joinSplitHeaders(['주소(팜맵 필지 기준, 인근)', '위도']), ['주소(팜맵 필지 기준, 인근)', '위도']);
  // 끝까지 닫히지 않으면 건드리지 않는다
  assert.deepEqual(joinSplitHeaders(['메모(', '위도', '경도']), ['메모(', '위도', '경도']);
});

test('홈포인트_Q1 형식(홈 이름(계획), 미션명, 따옴표 없는 쉼표 머리글)을 읽는다', () => {
  const csv = [
    '﻿홈 이름(계획),미션명,시기,시군,읍면,주소(팜맵 필지 기준, 인근),위도,경도,작업자,소티(완료/전체),카카오맵 길안내',
    'Q1_A_TA_SW_01,Q1_A_TA_SW__01_01 ~ _34,Q1,태안,소원면,소원면 송현리 인근,36.766667,126.149826,,0/34,"https://map.kakao.com/link/to/Q1_A_TA_SW_01,36.766667,126.149826"',
    'Q1_B_BE_TB_03,Q1_B_BE_TB__03_01 ~ _10,Q1,보은,탄부면,탄부면 상장리 인근,36.453159,127.782190,,0/10,"https://map.kakao.com/link/to/Q1_B_BE_TB_03,36.453159,127.782190"',
  ].join('\r\n');
  const { places, errors, columns } = readPlaces(bytes(csv));
  assert.deepEqual(errors, []);
  assert.deepEqual(columns, ['name', 'mission', 'district', 'address', 'lat', 'lng']);
  assert.deepEqual(
    places.map(({ name, mission, address, lat, lng }) => ({ name, mission, address, lat, lng })),
    [
      { name: 'SW_01', mission: 'Q1_A_TA_SW__01_01 ~ _34', address: '소원면 송현리 인근', lat: 36.766667, lng: 126.149826 },
      { name: 'TB_03', mission: 'Q1_B_BE_TB__03_01 ~ _10', address: '탄부면 상장리 인근', lat: 36.453159, lng: 127.78219 },
    ],
  );
});

test('행을 장소로 바꾸고 잘못된 행은 줄 번호와 함께 건너뛴다', () => {
  const csv = [
    '이름,주소,위도,경도,색상,메모',
    '판교역,경기 성남시,37.3948,127.1112,파랑,출구 1번',
    ',주소만,37.5,127.0,,',
    '좌표없음,,abc,,,',
    '뒤바뀜,,127.0276,37.4979,,',
    '범위밖,,10,200,,',
    '색없음,,37.5665,126.978,보라색아님,',
  ].join('\n');
  const { places, errors, columns } = readPlaces(bytes(csv));

  // 색상 열은 읽지 않는다
  assert.deepEqual(columns, ['name', 'address', 'lat', 'lng', 'memo']);
  assert.deepEqual(
    places.map(({ name, lat, lng }) => ({ name, lat, lng })),
    [
      { name: '판교역', lat: 37.3948, lng: 127.1112 },
      { name: '뒤바뀜', lat: 37.4979, lng: 127.0276 },
      { name: '색없음', lat: 37.5665, lng: 126.978 },
    ],
  );
  assert.ok(places.every((p) => !('color' in p)));
  assert.equal(places[0].memo, '출구 1번');
  assert.deepEqual(errors.map((e) => e.line), [3, 4, 6]);
});

test('필수 열이 없으면 무엇이 빠졌는지 알려 준다', () => {
  assert.throws(() => readPlaces(bytes('이름,주소\n집,서울')), /위도, 경도/);
  assert.throws(() => readPlaces(bytes('')), /비어 있습니다/);
});

test('시군은 따로 읽고, 주소 맨 앞에 같은 시군이 있으면 뗀다', () => {
  assert.equal(stripDistrict('태안', '태안 소원면 송현리 인근'), '소원면 송현리 인근');
  assert.equal(stripDistrict('태안', '소원면 송현리 인근'), '소원면 송현리 인근');
  assert.equal(stripDistrict('태안', '태안읍 남문리'), '태안읍 남문리'); // 띄어쓰기 경계까지 같아야 뗀다
  assert.equal(stripDistrict('태안', '태안'), '태안');
  assert.equal(stripDistrict('태안', '소원면 태안 로터리'), '소원면 태안 로터리'); // 맨 앞만 본다
  assert.equal(stripDistrict('', '태안 소원면'), '태안 소원면');

  const csv = ['이름,시군,주소,위도,경도', 'A,태안,소원면 송현리 인근,36.7,126.1', 'B,태안,태안 근흥면,36.6,126.1', 'C,보은,,36.4,127.7', 'D,,서울,37.5,127.0'].join('\n');
  assert.deepEqual(
    readPlaces(bytes(csv)).places.map((p) => [p.district, p.address, p.addressGiven]),
    [['태안', '소원면 송현리 인근', true], ['태안', '근흥면', true], ['보은', '', false], ['', '서울', true]],
  );
});

test('내보내기에는 상태와 완료/전체가 들어가고, 다시 가져오면 그 열은 무시하고 같은 값이 나온다', () => {
  const original = [
    { name: '가게 "본점", 2층', district: '서울', address: '중구', phone: '02-123-4567', memo: '줄\n바꿈', mission: 'Q1_A_TA_SW__01_01 ~ _03', lat: 37.5, lng: 127.01 },
    { name: '미션없음', district: '', address: '', phone: '', memo: '', mission: '', lat: 36.1, lng: 128.2 },
    { name: 'SW_01', district: '태안', address: '소원면 송현리 인근', phone: '', memo: '', mission: '', lat: 36.766667, lng: 126.149826 },
  ];
  const missions = [
    { mission: 'Q1_A_TA_SW__01_01', done: true },
    { mission: 'Q1_A_TA_SW__01_02', done: false },
  ];
  const text = toCsv([{ ...original[0], missions }, ...original.slice(1)]);
  const rows = parseCsv(text.replace(/^\uFEFF/, '')).map((r) => r.cells);
  assert.deepEqual(rows[0], ['이름', '시군', '주소', '전화번호', '위도', '경도', '상태', '완료/전체', '메모', '미션명']);
  assert.deepEqual(rows[1].slice(0, 3), ['가게 "본점", 2층', '서울', '중구']);
  assert.deepEqual(rows[1].slice(6, 8), ['진행 중', '1/3']);
  assert.deepEqual(rows[2].slice(6, 8), ['미진행', '']);

  const { places, errors, columns } = readPlaces(bytes(text));
  assert.deepEqual(errors, []);
  assert.deepEqual(columns, ['name', 'district', 'address', 'phone', 'lat', 'lng', 'memo', 'mission']);
  assert.deepEqual(places.map(({ line, addressGiven, ...rest }) => rest), original);
  assert.deepEqual(places.map((p) => p.addressGiven), [true, false, true]);
});

test('인코딩: 깨진 바이트가 조금 섞인 UTF-8은 UTF-8로, BOM이 있으면 그대로 읽고, 알 수 없으면 거절한다', () => {
  // 영문 머리글 + 한글 내용 사이에 잘못된 바이트 하나
  const utf8 = bytes('name,lat,lng,memo\n소원면 송현리,36.7,126.1,주차 가능\n');
  const broken = new Uint8Array([...utf8.subarray(0, 18), 0xff, ...utf8.subarray(18)]); // 머리글 줄 바로 뒤
  const text = decodeCsv(broken);
  assert.ok(text.includes('소원면 송현리'));
  assert.ok(text.includes('주차 가능'));
  assert.equal(text.match(/�/g).length, 1);

  // 엑셀이 저장한 EUC-KR: "이름,위도,경도\n집,37,127"
  const euc = Uint8Array.from([0xc0, 0xcc, 0xb8, 0xa7, 0x2c, 0xc0, 0xa7, 0xb5, 0xb5, 0x2c, 0xb0, 0xe6, 0xb5, 0xb5, 0x0a, 0xc1, 0xfd, 0x2c, 0x33, 0x37, 0x2c, 0x31, 0x32, 0x37]);
  assert.equal(decodeCsv(euc), '이름,위도,경도\n집,37,127');
  assert.deepEqual(readPlaces(euc).places.map((p) => p.name), ['집']);

  // UTF-16 LE/BE (BOM 포함)
  const s = '이름,위도,경도\n집,37,127';
  const le = new Uint8Array(2 + s.length * 2);
  const be = new Uint8Array(2 + s.length * 2);
  le.set([0xff, 0xfe]);
  be.set([0xfe, 0xff]);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    le.set([c & 0xff, c >> 8], 2 + i * 2);
    be.set([c >> 8, c & 0xff], 2 + i * 2);
  }
  assert.equal(decodeCsv(le), s);
  assert.equal(decodeCsv(be), s);

  // UTF-8 BOM이 있으면 깨진 바이트가 있어도 UTF-8
  assert.equal(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('이름'), 0xff])), '이름�');

  // 아무 바이트나 섞인 파일
  let seed = 42;
  const random = Uint8Array.from({ length: 3000 }, () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16);
  assert.throws(() => readPlaces(random), /파일 인코딩을 알 수 없습니다/);
});

test('탭이 쉼표보다 많으면 탭 구분으로 읽는다(머리글 괄호 안 쉼표가 있어도)', () => {
  const tsv = '홈 이름(계획)\t미션명\t주소(팜맵 필지 기준, 인근)\t위도\t경도\nQ1_A_TA_SW_01\tQ1_A_TA_SW__01_01 ~ _34\t소원면 송현리 인근\t36.766667\t126.149826\n';
  const { places, columns, errors } = readPlaces(bytes(tsv));
  assert.deepEqual(errors, []);
  assert.deepEqual(columns, ['name', 'mission', 'address', 'lat', 'lng']);
  assert.equal(places[0].address, '소원면 송현리 인근');
  assert.equal(places[0].lng, 126.149826);
});

test('좌표는 10진수만 받고 0,0은 빈 좌표로 본다', () => {
  const csv = ['이름,위도,경도', 'A,0x10,127', 'B,1e1,127', 'C,Infinity,127', 'D,0,0', 'E,+37.5,-0.5', 'F,37.,127', 'G, 37.5 ,127'].join('\n');
  const { places, errors } = readPlaces(bytes(csv));
  assert.deepEqual(places.map((p) => [p.name, p.lat, p.lng]), [['E', 37.5, -0.5], ['G', 37.5, 127]]);
  assert.deepEqual(errors.map((e) => e.line), [2, 3, 4, 5, 7]);
  assert.equal(errors[3].reason, '좌표가 비어 있습니다(0, 0).');
});

test('머리글: 전각 괄호를 떼고, x·y 한 글자 머리글은 다른 별칭이 없을 때만 쓴다', () => {
  assert.deepEqual(detectColumns(['X', '경도', '위도', '이름']), { lng: 1, lat: 2, name: 3 });
  assert.deepEqual(detectColumns(['이름', 'x', 'y']), { name: 0, lng: 1, lat: 2 });
  assert.deepEqual(detectColumns(['이름（계획）', '주소［필지］', '위도', '경도']), { name: 0, address: 1, lat: 2, lng: 3 });
});

test('메모는 앞뒤 공백을 지키고, 칸마다 길이를 자르며, 오류는 200건까지만 돌려준다', () => {
  const long = '가'.repeat(250);
  const csv = `이름,주소,전화,미션명,메모,위도,경도\n${long},${long},${long},${long}," 앞뒤 공백 ${'나'.repeat(2100)}",37,127\n`;
  const [p] = readPlaces(bytes(csv)).places;
  for (const key of ['name', 'address', 'phone', 'mission']) assert.equal(p[key].length, 200, key);
  assert.equal(Array.from(p.memo).length, 2000);
  assert.ok(p.memo.startsWith(' 앞뒤 공백 '));
  assert.equal(readPlaces(bytes('이름,메모,위도,경도\nA,  들여쓰기  ,37,127\n')).places[0].memo, '  들여쓰기  ');

  const bad = '이름,위도,경도\n' + Array.from({ length: 250 }, () => ',37,127').join('\n') + '\nOK,37,127\n';
  const result = readPlaces(bytes(bad));
  assert.equal(result.total, 251);
  assert.equal(result.places.length, 1);
  assert.equal(result.errors.length, 201);
  assert.deepEqual(result.errors.at(-1), { line: 0, reason: '외 50건' });
});

test('수식으로 시작하는 글은 내보낼 때 앞에 \'를 붙이고, 가져올 때 뗀다', () => {
  const original = [{ name: '+cmd', district: '=시군', address: '@주소', phone: '-123', memo: '=1+1', mission: '\t탭', lat: -33.5, lng: 151.2 }];
  const text = toCsv(original);
  assert.ok(text.includes("'+cmd,'=시군,'@주소,'-123,-33.5,151.2,"));
  assert.ok(text.includes(",'=1+1,"));
  const { places } = readPlaces(bytes(text));
  const { line, addressGiven, ...back } = places[0];
  assert.deepEqual(back, original[0]);
  // 일부러 '로 시작하는 평범한 글은 건드리지 않는다
  assert.equal(readPlaces(bytes("이름,위도,경도\n'가게,37,127\n")).places[0].name, "'가게");
});

test('필수 열이 없을 때 보여 주는 머리글은 200자로 자른다', () => {
  const header = Array.from({ length: 100 }, (_, i) => `열${i}`).join(',');
  assert.throws(
    () => readPlaces(bytes(`${header}\n1\n`)),
    (e) => /필수 열/.test(e.message) && Array.from(e.message.split('현재 머리글: ')[1]).length === 200,
  );
});
