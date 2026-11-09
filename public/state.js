// 화면이 함께 쓰는 상태(장소 목록·고른 장소·거르기·가져오기 창)와, 상태에서 바로 나오는 값·상태를 바꾸는 작은 도우미.
// 여러 화면 모듈이 이 파일을 가져다 쓴다. 이 파일은 다른 화면 모듈을 가져오지 않는다(순환 import 방지).
import { progressColor } from './palette.js';
import { missionProgress } from './mission.js';
import * as api from './api.js';

export const state = {
  places: [],
  // 장소 목록을 받는 중(로그인 직후·[다시 시도])인지, 못 받았을 때의 안내, 한 번이라도 받았는지.
  // "아직 저장한 장소가 없습니다"(#empty)는 받은 뒤 0곳일 때만 보여 준다.
  loading: false,
  loadError: null,
  loaded: false,
  selectedId: null,
  // 상세 정보에서 펼쳐 둔 미션 이름. 다른 장소를 고르면 닫는다.
  selectedMission: null,
  // 미션 기록을 고치는 중인 값. 저장 버튼을 누르기 전까지는 서버에 보내지 않는다.
  // 상세 정보를 다시 그려도(메모 저장·색 바꾸기 등) 적던 글자가 남도록 화면이 아니라 여기에 둔다.
  missionDraft: null,
  filterColor: null,
  query: '',
  // 가져올 CSV 파일들(고른 순서). 여러 개를 한꺼번에 고르거나 끌어다 놓을 수 있다.
  importFiles: null,
  // CSV가 아니라서 건너뛴 파일: [{ name, reason }]
  importSkipped: [],
  // 파일마다의 결과: [{ file, result } | { file, error }]. 아직 안 가져왔으면 null.
  importResults: null,
  // 가져오는 중인 파일 번호(1부터). 단추에 "가져오는 중… (2/5)"로 보여 준다.
  importProgress: 0,
  importing: false,
  // 가져오기 전에 확인받을 내용(경고·근접 중복·미션명 변경). 있으면 [계속]/[취소] 화면을 보여 준다.
  // { parsed: [{ file, parsed } | { file, error }], warnings, near, changes }
  importReview: null,
  // 목록에서 사람이 펼쳐 둔 시군. 기준은 "모두 접힘"이라 새로고침·상태 분류·처음 화면에서는 전부 접힌다(저장하지 않는다).
  openGroups: new Set(),
  // 저절로 펼쳐진 묶음(고른 장소·검색)을 사람이 접은 것. 검색어·거르기·선택이 바뀌면 잊는다.
  closedGroups: new Set(),
};

// config.js가 window.APP_CONFIG에 넣어 둔 설정(카카오 키·Supabase 주소와 공개 키).
export const config = api.readConfig();

export const findPlace = (id) => state.places.find((p) => p.id === id);

// 그룹을 모두 접는다. 상태 분류를 바꾸거나 처음 화면으로 갈 때 쓴다.
export function collapseAllGroups() {
  state.openGroups.clear();
  state.closedGroups.clear();
}

// 장소 색은 손으로 고르지 않고 미션 진행 상태(미진행·진행 중·완료)로 정한다. 저장된 p.color는 쓰지 않는다.
export const placeColor = (p) => progressColor(missionProgress(p.mission, p.missions));

export function visiblePlaces() {
  const q = state.query.trim().toLowerCase();
  // 고르고 있는 장소는 거르기·검색과 상관없이 보여 준다. 미션을 저장해 진행 상태가 바뀌어도 열어 둔 상세 정보 밑에서 사라지지 않게 한다.
  return state.places.filter(
    (p) =>
      p.id === state.selectedId ||
      ((!state.filterColor || placeColor(p) === state.filterColor) &&
        (!q || [p.name, p.address, p.phone, p.memo].some((v) => v.toLowerCase().includes(q)))),
  );
}

// 화면이 직접 바꾼 장소(저장 응답 반영·삭제)의 순번. 목록 받기는 시작할 때 순번을 적어 두고, 그 뒤에 화면이 바꾼 장소에는
// 받은 값을 넣지 않는다(저장 전에 시작한 받기가 늦게 끝나 방금 저장한 값·지운 장소를 되돌리지 않게). 그런 장소는 곧 다시 받는다.
export let localSeq = 0;
export const localTouch = new Map(); // 장소 id → 순번
export const touchPlace = (id) => localTouch.set(id, ++localSeq);
export const touchedSince = (since) => new Set([...localTouch].filter(([, seq]) => seq > since).map(([id]) => id));

// 다른 기기에서 지워진 장소인지. DB 함수는 "장소를 찾을 수 없습니다." 예외를 던진다.
export const isPlaceGone =(err) => /장소를 찾을 수 없습니다/.test(err.message);

// 저장 응답 등 화면이 직접 바꾼 장소를 넣는다(받기 결과는 commitPlaces로 넣는다).
export function replacePlace(updated) {
  state.places = state.places.map((p) => (p.id === updated.id ? updated : p));
  touchPlace(updated.id);
}

// 메모 저장 응답을 반영한다. 응답의 미션 기록은 그사이 화면에서 먼저 바꾼 기록보다 오래됐을 수 있어서 화면 쪽을 남긴다.
export function mergePlace(updated) {
  const current = state.places.find((p) => p.id === updated.id);
  replacePlace({ ...updated, missions: current?.missions ?? updated.missions });
}

// 내가 방금 저장한 변경의 모양(메모 저장 뒤의 장소, 미션 저장 뒤의 기록 판). 그 알림은 늦게 와도 건너뛴다.
// 메모를 잇달아 저장하면 앞 저장의 알림이 올 때 화면 값은 이미 다음 값이라 "같은 값" 비교로는 못 거른다.
const OWN_WRITE_TTL_MS = 30000;
export const ownWrites = [];
export function rememberOwnWrite(entry) {
  const now = Date.now();
  while (ownWrites.length > 0 && now - ownWrites[0].at > OWN_WRITE_TTL_MS) ownWrites.shift();
  ownWrites.push({ ...entry, at: now });
}

// 아래쪽 모듈이 app.js 등 위쪽 모듈의 함수(다시 그리기·로그인 화면으로 보내기 등)를 부를 때 거치는 자리.
// app.js가 시작할 때 채운다. 아래쪽 모듈이 위쪽 모듈을 import하면 순환 import가 되므로 이렇게 넘겨받는다.
export const hooks = {
  dropGonePlace: null,
  leaveApp: null,
  render: null,
  renderKeepingInput: null,
  renderListAndMap: null,
  requestSelect: null,
};
