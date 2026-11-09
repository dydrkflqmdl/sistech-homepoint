import { roundCoord } from './coord.js';
import { missionNames, missionProgress } from './mission.js';
import { colorLabel, progressColor } from './palette.js';

export class CsvFormatError extends Error {}

// 글자 수로 자른다. slice는 UTF-16 단위라 경계의 이모지가 반쪽만 남을 수 있다.
export const clip = (s, n) => Array.from(s).slice(0, n).join('');

const countBad = (text) => text.match(/\uFFFD/g)?.length ?? 0;

// 글자가 처음 깨진(U+FFFD) 줄 번호. 깨진 글자가 없으면 0.
const firstBadLine = (text) => {
  const at = text.indexOf('\uFFFD');
  return at < 0 ? 0 : text.slice(0, at).split(/\r\n|\r|\n/).length;
};

// UTF-8로 볼 수 있는 깨진 글자 수의 상한: 글자 수의 0.5%, 단 작은 파일도 5개까지는 봐준다.
const BAD_RATIO = 0.005;
const MIN_BAD_ALLOWED = 5;

// 엑셀에서 저장한 한글 CSV는 EUC-KR(CP949)인 경우가 많다. BOM이 있으면 그대로 따르고, 없으면 UTF-8을 먼저 시도한다.
// UTF-8 파일에 깨진 바이트가 몇 개 섞였다고 파일 전체를 EUC-KR로 읽으면 모든 한글이 깨지므로,
// 깨진 글자가 글자 수의 0.5%(최소 5개) 이하이고 EUC-KR로 읽은 것보다 적으면 UTF-8로 본다.
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
  const allowed = Math.max(MIN_BAD_ALLOWED, utf8.length * BAD_RATIO);
  if (utf8Bad <= allowed && utf8Bad < countBad(euc)) return utf8;

  // EUC-KR로도 깨지거나, 한글보다 한자가 많이 나오면 EUC-KR이 아닌 파일(바이너리·다른 인코딩)이다.
  const head = euc.slice(0, 4000);
  const hanja = head.match(/[\u4E00-\u9FFF]/g)?.length ?? 0;
  const hangul = head.match(/[\uAC00-\uD7A3]/g)?.length ?? 0;
  if (countBad(head) > 0 || (hanja > hangul && hanja >= 10)) {
    // UTF-8로 저장하라고 안내하므로 UTF-8로 읽었을 때 처음 깨진 줄을 알려 준다(fatal 디코딩이 실패했으니 늘 1 이상).
    throw new CsvFormatError(
      `파일 인코딩을 알 수 없습니다. ${firstBadLine(utf8)}번째 줄부터 글자가 깨집니다. UTF-8 또는 EUC-KR(엑셀 CSV)로 저장해 주세요.`,
    );
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

// 첫 줄에 탭이 쉼표보다 많으면 탭, 세미콜론이 쉼표·탭보다 많으면 세미콜론 구분 파일로 본다(유럽식 엑셀은 ;로 저장한다).
// 쉼표만 세지 않는 것은 머리글 괄호 안에도 쉼표가 들어갈 수 있어서다(주소(팜맵 필지 기준, 인근)).
function detectDelimiter(text) {
  const firstLine = text.slice(0, text.search(/\r|\n|$/));
  const count = (ch) => firstLine.split(ch).length - 1;
  const comma = count(',');
  const tab = count('\t');
  const semi = count(';');
  if (semi > comma && semi > tab) return ';';
  return tab > comma ? '\t' : ',';
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
  // 소티(완료/전체)는 미션명과 개수가 맞는지 확인하는 데만 쓰고 저장하지 않는다. "소티(완료/전체)"는 정규화하면 "소티"다.
  sortie: ['소티', '완료/전체', 'sortie'],
};

// 읽기만 하고 장소에는 넣지 않는 필드. readPlaces의 columns(저장하는 열 목록)에도 넣지 않는다.
const CHECK_ONLY_FIELDS = new Set(['sortie']);

// 뜻이 넓은 별칭. 다른 뜻으로도 흔히 쓰여서(예: "X,경도,위도", "위치" = 좌표, "지역" = 권역) 정확한 별칭으로 못 찾은 필드만 채운다.
const LOOSE_ALIASES = new Set(['x', 'y', '위치', '시', '군', '지역']);

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

// 머리글 → { columns: 필드 → 열 번호, conflicts: [{field, index, kept}] }.
// 정확한 별칭을 먼저 다 찾고, 뜻이 넓은 별칭(LOOSE_ALIASES)은 그다음에 남은 필드만 채운다.
// 한 필드에 열이 둘 이상 걸리면 먼저 잡힌 열(정확한 별칭 > 넓은 별칭, 같은 순위면 앞 열)을 쓰고 나머지는 conflicts로 알린다.
function matchColumns(header) {
  const columns = {};
  const conflicts = [];
  const matched = new Set();
  for (const loose of [false, true]) {
    header.forEach((raw, index) => {
      if (matched.has(index)) return;
      const h = normalizeHeader(raw);
      const field = Object.keys(HEADER_ALIASES).find((f) => HEADER_ALIASES[f].some((a) => LOOSE_ALIASES.has(a) === loose && a === h));
      if (field === undefined) return;
      matched.add(index);
      if (columns[field] === undefined) columns[field] = index;
      else conflicts.push({ field, index, kept: columns[field] });
    });
  }
  conflicts.sort((a, b) => a.index - b.index);
  return { columns, conflicts };
}

export function detectColumns(header) {
  return matchColumns(header).columns;
}

const missingOf = (columns) => Object.keys(REQUIRED).filter((f) => columns[f] === undefined);

const readHeader = ([headerRecord, ...rows]) => {
  const header = joinSplitHeaders(headerRecord.cells);
  return { header, headerLine: headerRecord.line, rows, ...matchColumns(header) };
};

// 머리글 위에 제목·날짜 같은 줄이 붙은 파일이 있다. 첫 줄에서 필수 열을 못 찾으면 처음 5줄 안에서
// 필수 열(이름·위도·경도)이 모두 있는 줄을 찾아 그 줄부터 읽는다. 구분자도 그 줄 기준으로 다시 고른다.
const HEADER_SEARCH_LINES = 5;

function locateHeader(text) {
  const records = parseCsv(text);
  if (records.length === 0) throw new CsvFormatError('CSV 파일이 비어 있습니다.');
  const first = readHeader(records);
  if (missingOf(first.columns).length === 0) return first;

  const starts = [0];
  const newline = /\r\n|\r|\n/g;
  for (let m; starts.length <= HEADER_SEARCH_LINES && (m = newline.exec(text)); ) starts.push(m.index + m[0].length);
  for (let i = 1; i < Math.min(starts.length, HEADER_SEARCH_LINES); i++) {
    const lineText = text.slice(starts[i], starts[i + 1] ?? text.length);
    const [candidate] = parseCsv(lineText);
    if (!candidate || missingOf(matchColumns(joinSplitHeaders(candidate.cells)).columns).length > 0) continue;
    // 줄 번호는 원래 파일 기준으로 맞춘다.
    return readHeader(parseCsv(text.slice(starts[i])).map((r) => ({ ...r, line: r.line + i })));
  }

  const missing = missingOf(first.columns);
  throw new CsvFormatError(
    `필수 열(${missing.map((f) => REQUIRED[f]).join(', ')})을 찾지 못했습니다. ` +
      `현재 머리글: ${clip(first.header.map((c) => c.trim()).join(', '), 200)}`,
  );
}

// 10진수만 받는다. Number()는 "0x10", "1e1", "Infinity"도 숫자로 읽어 버린다.
function parseCoord(value) {
  const v = String(value ?? '').trim();
  return /^[+-]?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
}

// 엑셀·구글 시트가 수식으로 실행할 수 있는 값인지. 앞쪽 공백·탭·제어문자는 건너뛰고 첫 글자를 본다(" =1+1"도 수식이 될 수 있다).
// 전각 ＝＋－＠도 수식으로 바꿔 읽는 프로그램이 있어 함께 막는다. 탭·CR로 시작하는 값은 그 자체로 보호한다(OWASP 권고).
// 원래 '로 시작하는 값도 보호 대상이다: 내보낼 때 한 겹 더 씌워야(''…) 가져올 때 한 겹만 벗겨서 원래 값으로 돌아온다.
const needsGuard = (s) => /^['\t\r]|^[\s\x00-\x1f\x7f]*[=+\-@＝＋－＠]/.test(s);

// 내보낼 때 붙인 '를 한 겹만 뗀다(escapeCell의 반대). unguard(guard(s)) === s 가 모든 문자열에서 성립한다.
// guard가 '를 붙이지 않은 값은 needsGuard가 거짓이라 '로 시작하지 않거나, '로 시작하면 needsGuard가 참이므로 벗길 일이 없다.
const guard = (s) => (needsGuard(s) ? `'${s}` : s);
const unguard = (s) => (s.startsWith("'") && needsGuard(s.slice(1)) ? s.slice(1) : s);

const MAX_ERRORS = 200;

// 대한민국 범위(대략). 이 밖이면 저장은 하되 경고한다(독도 131.87, 마라도 33.11, 백령도 124.6 포함).
const KOREA = { latMin: 33, latMax: 39, lngMin: 124, lngMax: 132 };
const inKorea = (lat, lng) => lat >= KOREA.latMin && lat <= KOREA.latMax && lng >= KOREA.lngMin && lng <= KOREA.lngMax;

// 시군은 따로 저장하므로 주소 맨 앞의 "<시군> " 하나를 뗀다. 예: 태안 + 태안 근흥면 신진도리 → 근흥면 신진도리
// 띄어쓰기 경계까지 같아야 뗀다("태안읍 남문리"는 시군 태안과 다른 단어라 그대로). 한 번만 뗀다.
// 내보낸 파일의 주소는 이미 뗀 값이라 다시 가져와도 그대로다. 단, 뗀 뒤에도 "<시군> "으로 시작하는 주소
// (예: "고흥 고흥 금산면" → "고흥 금산면")는 다시 가져올 때 한 번 더 떼어진다.
export function stripDistrict(district, address) {
  const d = district.trim();
  const a = address.trim();
  return d && a.startsWith(`${d} `) ? a.slice(d.length + 1).trim() : a;
}

// 화면이 너무 길어지지 않게 오류·경고는 앞의 200건만 돌려준다.
const capped = (list) => (list.length > MAX_ERRORS ? [...list.slice(0, MAX_ERRORS), { line: 0, reason: `외 ${list.length - MAX_ERRORS}건` }] : list);

const headerLabel = (raw) => clip(String(raw ?? '').trim(), 50);

// CSV 바이트를 저장할 장소 목록으로 바꾼다.
// errors: 건너뛴 행(줄 번호와 이유). warnings: 저장은 하지만 확인해 볼 만한 것(머리글 충돌, 범위 밖 좌표, 소티 불일치 등).
// 색상 열은 읽지 않는다. 장소 색은 미션 진행 상태로 화면에서 정해진다.
export function readPlaces(buffer) {
  const { header, headerLine, rows, columns, conflicts } = locateHeader(decodeCsv(buffer));

  const places = [];
  const errors = [];
  const warnings = conflicts.map(({ index, kept }) => ({
    line: headerLine,
    reason: `'${headerLabel(header[index])}' 열은 '${headerLabel(header[kept])}' 열과 같은 뜻이라 무시했습니다.`,
  }));
  let doneWarned = false;
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
    // 엑셀에서 빈 좌표 칸이 0으로 채워지는 경우가 많다. 위도 0·경도 0은 적도·본초 자오선이라 실제 장소일 수 없다.
    if (lat === 0 && lng === 0) {
      errors.push({ line, reason: '좌표가 비어 있습니다(0, 0).' });
      continue;
    }
    if (lat === 0 || lng === 0) {
      errors.push({ line, reason: '좌표가 비어 있습니다(한쪽이 0).' });
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

    if (!inKorea(lat, lng)) {
      warnings.push({
        line,
        reason: `좌표가 대한민국 범위(위도 ${KOREA.latMin}~${KOREA.latMax}, 경도 ${KOREA.lngMin}~${KOREA.lngMax}) 밖입니다. 위치를 확인해 주세요. (위도: ${lat}, 경도: ${lng})`,
      });
    }

    const mission = clip(get('mission'), 200);
    // 소티 "완료/전체": 전체는 미션명을 풀었을 때의 개수와 같아야 한다. 완료 기록은 가져오지 않으므로 파일당 한 번 알린다.
    const sortie = get('sortie').match(/^(\d+)\s*\/\s*(\d+)$/);
    if (sortie) {
      const done = Number(sortie[1]);
      const total = Number(sortie[2]);
      const count = missionNames(mission).length;
      if (count !== total) warnings.push({ line, reason: `미션명을 풀면 ${count}개인데 소티 전체는 ${total}개입니다.` });
      if (done > 0 && !doneWarned) {
        doneWarned = true;
        warnings.push({ line, reason: '완료 기록은 가져오지 않습니다. 화면에서 직접 기록해 주세요.' });
      }
    }

    places.push({
      line,
      name,
      district: clip(get('district'), 200),
      address: clip(stripDistrict(get('district'), get('address')), 200),
      // 주소 칸이 비었으면 이미 있는 장소의 주소를 지우지 않는다(import_places).
      addressGiven: get('address') !== '',
      phone: clip(get('phone'), 200),
      memo: clip(raw('memo'), 2000),
      mission,
      lat,
      lng,
    });
  }

  // total은 잘리기 전 기준이고 경고는 세지 않는다(경고 행도 places에 들어 있다).
  const total = places.length + errors.length;
  return {
    columns: Object.keys(columns).filter((f) => !CHECK_ONLY_FIELDS.has(f)),
    total,
    places,
    errors: capped(errors),
    warnings: capped(warnings),
  };
}

// ── 가져오기 전 확인용 탐지(화면의 가져오기 확인창이 쓴다). 둘 다 순수 함수다. ──
// existing: DB에 있는 장소 [{id, name, district, lat, lng, address, mission, missions}]. missions는 미션 기록 배열.

// 두 좌표 사이 거리(미터, 하버사인).
const EARTH_RADIUS_M = 6371008.8;
function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// DB(import_places)가 같은 장소로 보는 기준: 이름이 똑같고 좌표가 소수 7자리까지 같다.
const placeKey = (p) => `${p.name}|${roundCoord(p.lat)}|${roundCoord(p.lng)}`;

const groupByName = (list) => {
  const map = new Map();
  for (const e of list ?? []) {
    if (!map.has(e.name)) map.set(e.name, []);
    map.get(e.name).push(e);
  }
  return map;
};

// 새 장소와 이름·시군이 같은데 좌표가 다른 기존 장소. 가져오면 새 장소가 따로 생겨 같은 이름이 둘이 된다.
// 좌표까지 같은 기존 장소가 있으면 그 장소를 갱신하는 경로라 새 장소가 생기지 않으므로 그 행은 아예 빼고 본다.
// 반환: [{line, name, district, distanceM(정수 미터), existing: {id, name, lat, lng, address}}], 행 순서 → 가까운 순.
export function nearDuplicates(places, existing) {
  const byName = groupByName(existing);
  const exact = new Set((existing ?? []).map(placeKey));
  const out = [];
  for (const p of places ?? []) {
    if (exact.has(placeKey(p))) continue;
    const district = String(p.district ?? '').trim();
    const found = (byName.get(p.name) ?? [])
      .filter((e) => String(e.district ?? '').trim() === district)
      .map((e) => ({
        line: p.line,
        name: p.name,
        district,
        distanceM: Math.round(distanceMeters(p, e)),
        existing: { id: e.id, name: e.name, lat: e.lat, lng: e.lng, address: e.address ?? '' },
      }))
      .sort((a, b) => a.distanceM - b.distanceM);
    out.push(...found);
  }
  return out;
}

// 이름·좌표가 같은 기존 장소의 미션명이 CSV 값으로 바뀌는 경우. CSV 미션명이 비어 있으면 저장된 값을 지우지 않으므로 빼고 본다.
// 미션명이 바뀌면 이전 미션의 기록(recordCount개)은 DB에 남지만 화면 진행도에서 빠진다.
// 반환: [{line, name, district, from, to, recordCount}]. district는 가져온 뒤의 시군(CSV 값, 비었으면 기존 값).
export function missionChanges(places, existing) {
  const byKey = new Map((existing ?? []).map((e) => [placeKey(e), e]));
  const out = [];
  for (const p of places ?? []) {
    const to = String(p.mission ?? '');
    if (to.trim() === '') continue;
    const e = byKey.get(placeKey(p));
    if (!e) continue;
    const from = String(e.mission ?? '');
    if (from === to) continue;
    out.push({
      line: p.line,
      name: p.name,
      district: String(p.district ?? '').trim() || String(e.district ?? ''),
      from,
      to,
      recordCount: e.missions?.length ?? 0,
    });
  }
  return out;
}

// 상태는 사람이 보라고 넣는 열이라 다시 가져올 때 무시한다. 완료/전체는 다시 가져올 때 소티로 읽어
// 미션 개수가 맞는지만 확인하고 저장하지 않는다(완료가 있으면 "완료 기록은 가져오지 않습니다" 경고).
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

// 수식으로 실행될 수 있는 글(needsGuard)은 앞에 '를 붙인다(가져올 때 unguard로 한 겹 뗀다).
// 위도·경도 같은 숫자는 음수여도 그대로 둔다.
function escapeCell(value) {
  const s = typeof value === 'string' ? guard(value) : String(value ?? '');
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

// ── 미션 기록 내보내기 ──
// 미션 한 줄씩(장소 순서 → 미션명을 푼 순서). 기록이 없으면 완료는 '아니오', 나머지 기록 칸은 빈 칸이다.
// 지금 미션명에 없는(범위 밖) 기록도 버리지 않고 맨 아래에 모아, 미션명 뒤에 ' (범위 밖)'을 붙여 내보낸다.
// 기록 필드는 DB mission_json과 같다: {mission, done, worker, flightTime, batteryNo, batteryLeft, version, updatedAt}.
// snake_case(flight_time, updated_at 등)로 들어와도 읽는다. 남은 용량은 % 없이 숫자만. 다시 가져오는 형식은 아니다.
const MISSION_EXPORT_HEADER = ['시군', '이름', '미션명', '완료', '작업자', '비행시간', '배터리 번호', '배터리 남은 용량', '마지막 저장'];
const OUT_OF_SCOPE = '(범위 밖)';

const cellText = (v) => String(v ?? '').trim();
const pick = (r, camel, snake) => cellText(r?.[camel] ?? r?.[snake]);

function missionRow(p, missionLabel, r) {
  return [
    cellText(p.district),
    cellText(p.name),
    missionLabel,
    r?.done === true ? '예' : '아니오',
    pick(r, 'worker', 'worker'),
    pick(r, 'flightTime', 'flight_time'),
    pick(r, 'batteryNo', 'battery_no'),
    pick(r, 'batteryLeft', 'battery_left').replace(/\s*%$/, ''),
    pick(r, 'updatedAt', 'updated_at'),
  ];
}

export function toMissionCsv(places) {
  const rows = [];
  const outside = [];
  for (const p of places ?? []) {
    const records = Array.isArray(p.missions) ? p.missions.filter((r) => r && typeof r === 'object') : [];
    const names = missionNames(p.mission);
    const inScope = new Set(names);
    for (const name of names) rows.push(missionRow(p, name, records.find((r) => r.mission === name)));
    for (const r of records) {
      if (!inScope.has(r.mission)) outside.push(missionRow(p, `${cellText(r.mission)} ${OUT_OF_SCOPE}`, r));
    }
  }
  const lines = [MISSION_EXPORT_HEADER, ...rows, ...outside].map((cells) => cells.map(escapeCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
