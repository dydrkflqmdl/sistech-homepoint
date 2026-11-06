import { roundCoord } from './coord.js';
import { missionProgress } from './mission.js';
import { colorLabel, progressColor } from './palette.js';

export class CsvFormatError extends Error {}

// 글자 수로 자른다. slice는 UTF-16 단위라 경계의 이모지가 반쪽만 남을 수 있다.
export const clip = (s, n) => Array.from(s).slice(0, n).join('');

const countBad = (text) => text.match(/\uFFFD/g)?.length ?? 0;

// 엑셀에서 저장한 한글 CSV는 EUC-KR(CP949)인 경우가 많다. BOM이 있으면 그대로 따르고, 없으면 UTF-8을 먼저 시도한다.
// UTF-8 파일에 깨진 바이트가 몇 개 섞였다고 파일 전체를 EUC-KR로 읽으면 모든 한글이 깨지므로,
// 깨진 글자가 5개 이하이고 EUC-KR로 읽은 것보다 적으면 UTF-8로 본다.
export function decodeCsv(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // 아래에서 다른 방법으로 읽는다
  }
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  const euc = new TextDecoder('euc-kr').decode(bytes);
  const utf8Bad = countBad(utf8);
  if (utf8Bad <= 5 && utf8Bad < countBad(euc)) return utf8;

  // EUC-KR로도 깨지거나, 한글보다 한자가 많이 나오면 EUC-KR이 아닌 파일(바이너리·다른 인코딩)이다.
  const head = euc.slice(0, 4000);
  const hanja = head.match(/[\u4E00-\u9FFF]/g)?.length ?? 0;
  const hangul = head.match(/[\uAC00-\uD7A3]/g)?.length ?? 0;
  if (countBad(head) > 0 || (hanja > hangul && hanja >= 10)) {
    throw new CsvFormatError('파일 인코딩을 알 수 없습니다. UTF-8 또는 EUC-KR(엑셀 CSV)로 저장해 주세요.');
  }
  return euc;
}

// RFC 4180 CSV 파서. 따옴표 안의 쉼표·줄바꿈·"" 이스케이프를 처리하고, 레코드가 시작된 줄 번호를 함께 돌려준다.
export function parseCsv(text, delimiter = detectDelimiter(text)) {
  const records = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const endCell = () => {
    cells.push(cell);
    cell = '';
  };
  const endRecord = () => {
    endCell();
    if (cells.some((c) => c.trim() !== '')) records.push({ line: recordLine, cells });
    cells = [];
    recordLine = line;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      line++;
      endRecord();
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || cells.length > 0) endRecord();
  return records;
}

// 탭이 쉼표보다 많으면 탭 구분 파일로 본다. 탭 파일 머리글 괄호 안에도 쉼표가 들어갈 수 있어서다(주소(팜맵 필지 기준, 인근)).
function detectDelimiter(text) {
  const firstLine = text.slice(0, text.search(/\r|\n|$/));
  const count = (ch) => firstLine.split(ch).length - 1;
  return count('\t') > count(',') ? '\t' : ',';
}

// 정규화한 머리글 → 필드. 정규화는 괄호 안 설명을 떼고("주소(팜맵 필지 기준)" → "주소") 소문자로 바꾼 뒤 공백·밑줄을 지운다.
const HEADER_ALIASES = {
  name: ['이름', '홈이름', '홈포인트', '홈포인트명', '홈포인트이름', '장소', '장소명', '장소이름', '상호', '상호명', '업체명', '가게명', '명칭', 'name', 'place', 'placename', 'title'],
  address: ['주소', '도로명주소', '지번주소', '소재지', '위치', 'address', 'addr', 'roadaddress'],
  // 목록을 시군별로 묶으려고 시군을 따로 저장한다. 주소에는 시군을 넣지 않는다.
  district: ['시군', '시/군', '시군구', '시', '군', '지역', 'district', 'city', 'county'],
  phone: ['전화', '전화번호', '연락처', 'phone', 'tel', 'telephone'],
  lat: ['위도', 'lat', 'latitude', 'y', 'y좌표', '좌표y'],
  lng: ['경도', 'lng', 'lon', 'long', 'longitude', 'x', 'x좌표', '좌표x'],
  memo: ['메모', '설명', '비고', '노트', 'memo', 'note', 'notes', 'description'],
  mission: ['미션명', '미션', '미션이름', 'mission', 'missions', 'missionname'],
};

const REQUIRED = { name: '이름', lat: '위도', lng: '경도' };

const normalizeHeader = (h) =>
  h
    .replace(/\(.*?\)|\[.*?\]|（.*?）|［.*?］/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]/g, '');

// 홈포인트 코드(예: A_TA_GH_16)는 맨 뒤 번호와 그 앞 영문(GH_16)만 이름으로 쓴다.
// 영문·숫자를 _ 나 - 로 이은 코드에만 적용하고, 한글 이름 같은 일반 이름은 그대로 둔다.
export function pointName(raw) {
  if (!/^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)+$/.test(raw)) return raw;
  return raw.match(/[A-Za-z]+[_-]?\d+$/)?.[0] ?? raw;
}

// 머리글 괄호 안의 쉼표를 따옴표로 감싸지 않은 파일이 있다. 예: 주소(팜맵 필지 기준, 인근)
// 그대로 두면 "주소(팜맵 필지 기준"과 " 인근)" 두 칸으로 나뉘어 그 뒤 열이 한 칸씩 밀리므로,
// 괄호가 열린 채 끝난 칸은 괄호가 닫히는 칸까지 다시 이어 붙인다. 끝까지 닫히지 않으면 그대로 둔다.
export function joinSplitHeaders(cells) {
  const depth = (s) => (s.match(/\(/g)?.length ?? 0) - (s.match(/\)/g)?.length ?? 0);
  const out = [];
  for (let i = 0; i < cells.length; i++) {
    let j = i;
    let d = depth(cells[i]);
    while (d > 0 && j + 1 < cells.length) d += depth(cells[++j]);
    if (d === 0 && j > i) {
      out.push(cells.slice(i, j + 1).join(','));
      i = j;
    } else {
      out.push(cells[i]);
    }
  }
  return out;
}

// x·y 한 글자 머리글은 다른 뜻으로도 흔히 쓰여서(예: "X,경도,위도") 나머지 별칭으로 못 찾은 칸만 채운다.
const isLetterAlias = (alias) => alias === 'x' || alias === 'y';

export function detectColumns(header) {
  const columns = {};
  const used = new Set();
  for (const letterPass of [false, true]) {
    header.forEach((raw, index) => {
      if (used.has(index)) return;
      const h = normalizeHeader(raw);
      for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        if (columns[field] === undefined && aliases.some((a) => isLetterAlias(a) === letterPass && a === h)) {
          columns[field] = index;
          used.add(index);
          break;
        }
      }
    });
  }
  return columns;
}

// 10진수만 받는다. Number()는 "0x10", "1e1", "Infinity"도 숫자로 읽어 버린다.
function parseCoord(value) {
  const v = String(value ?? '').trim();
  return /^[+-]?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
}

// 내보낼 때 수식 실행을 막으려고 붙인 '를 다시 뗀다(escapeCell 참고).
const unguard = (s) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

const MAX_ERRORS = 200;

// 시군은 따로 저장하므로 주소 맨 앞의 "<시군> " 하나를 뗀다. 예: 태안 + 태안 근흥면 신진도리 → 근흥면 신진도리
// 띄어쓰기 경계까지 같아야 뗀다("태안읍 남문리"는 시군 태안과 다른 단어라 그대로).
export function stripDistrict(district, address) {
  const d = district.trim();
  const a = address.trim();
  return d && a.startsWith(`${d} `) ? a.slice(d.length + 1).trim() : a;
}

// CSV 바이트를 저장할 장소 목록으로 바꾼다. 잘못된 행은 errors에 줄 번호와 이유를 남기고 건너뛴다.
// 색상 열은 읽지 않는다. 장소 색은 미션 진행 상태로 화면에서 정해진다.
export function readPlaces(buffer) {
  const records = parseCsv(decodeCsv(buffer));
  if (records.length === 0) throw new CsvFormatError('CSV 파일이 비어 있습니다.');

  const [headerRecord, ...rows] = records;
  const header = joinSplitHeaders(headerRecord.cells);
  const columns = detectColumns(header);
  const missing = Object.keys(REQUIRED).filter((f) => columns[f] === undefined);
  if (missing.length > 0) {
    throw new CsvFormatError(
      `필수 열(${missing.map((f) => REQUIRED[f]).join(', ')})을 찾지 못했습니다. ` +
        `현재 머리글: ${clip(header.map((c) => c.trim()).join(', '), 200)}`,
    );
  }

  const places = [];
  const errors = [];
  const firstLineOf = new Map(); // 이름|위도|경도 → 처음 나온 줄
  for (const { line, cells } of rows) {
    // 메모는 앞뒤 공백도 내용으로 보고 그대로 둔다. 나머지 칸은 앞뒤 공백을 지운다.
    const raw = (field) => unguard(columns[field] === undefined ? '' : (cells[columns[field]] ?? ''));
    const get = (field) => unguard(columns[field] === undefined ? '' : (cells[columns[field]] ?? '').trim());
    const name = clip(pointName(get('name')), 200);
    let lat = parseCoord(get('lat'));
    let lng = parseCoord(get('lng'));

    if (!name) {
      errors.push({ line, reason: '이름이 비어 있습니다.' });
      continue;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      errors.push({ line, reason: `좌표가 숫자가 아닙니다. (위도: "${clip(get('lat'), 50)}", 경도: "${clip(get('lng'), 50)}")` });
      continue;
    }
    // 엑셀에서 빈 좌표 칸이 0으로 채워지는 경우가 많다. 0,0은 바다 한가운데라 실제 장소일 수 없다.
    if (lat === 0 && lng === 0) {
      errors.push({ line, reason: '좌표가 비어 있습니다(0, 0).' });
      continue;
    }
    // 위도·경도 열이 뒤바뀐 파일이 흔해서, 위도가 90을 넘고 경도가 90 이하이면 바꿔서 읽는다.
    if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat];
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      errors.push({ line, reason: `좌표 범위를 벗어났습니다. (위도: ${lat}, 경도: ${lng})` });
      continue;
    }
    // 한 파일 안에 같은 장소가 두 번 있으면 뒤 행이 앞 행을 조용히 덮지 않도록 건너뛰고 알려 준다. 판정 기준은 DB(import_places)와 같다.
    const key = `${name}|${roundCoord(lat)}|${roundCoord(lng)}`;
    if (firstLineOf.has(key)) {
      errors.push({ line, reason: `${firstLineOf.get(key)}행과 같은 장소(이름·좌표)라서 건너뜁니다.` });
      continue;
    }
    firstLineOf.set(key, line);

    places.push({
      line,
      name,
      district: clip(get('district'), 200),
      address: clip(stripDistrict(get('district'), get('address')), 200),
      // 주소 칸이 비었으면 이미 있는 장소의 주소를 지우지 않는다(import_places).
      addressGiven: get('address') !== '',
      phone: clip(get('phone'), 200),
      memo: clip(raw('memo'), 2000),
      mission: clip(get('mission'), 200),
      lat,
      lng,
    });
  }

  // 화면이 너무 길어지지 않게 오류는 앞의 200건만 돌려준다. total은 잘리기 전 기준이다.
  const total = places.length + errors.length;
  const shown = errors.length > MAX_ERRORS ? [...errors.slice(0, MAX_ERRORS), { line: 0, reason: `외 ${errors.length - MAX_ERRORS}건` }] : errors;
  return { columns: Object.keys(columns), total, places, errors: shown };
}

// 상태·완료/전체는 사람이 보라고 넣는 열이다. 다시 가져올 때는 머리글을 모르는 열로 보고 무시한다.
const EXPORT_COLUMNS = [
  ['이름', (p) => p.name],
  ['시군', (p) => p.district],
  ['주소', (p) => p.address],
  ['전화번호', (p) => p.phone],
  ['위도', (p) => p.lat],
  ['경도', (p) => p.lng],
  ['상태', (p, progress) => colorLabel(progressColor(progress))],
  ['완료/전체', (p, { total, done }) => (total > 0 ? `${done}/${total}` : '')],
  ['메모', (p) => p.memo],
  ['미션명', (p) => p.mission],
];

// =, +, -, @ 등으로 시작하는 글은 엑셀이 수식으로 실행하므로 앞에 '를 붙인다(가져올 때 unguard로 뗀다).
// 위도·경도 같은 숫자는 음수여도 그대로 둔다.
function escapeCell(value) {
  let s = String(value ?? '');
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// 다시 가져올 수 있는 형식으로 내보낸다. 엑셀이 한글을 깨뜨리지 않도록 BOM을 붙인다.
export function toCsv(places) {
  const lines = [EXPORT_COLUMNS.map(([label]) => label).join(',')];
  for (const p of places) {
    const progress = missionProgress(p.mission, p.missions ?? []);
    lines.push(EXPORT_COLUMNS.map(([, value]) => escapeCell(value(p, progress))).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
