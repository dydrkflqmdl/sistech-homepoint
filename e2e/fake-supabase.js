// E2E용 가짜 supabase-js. CDP Page.addScriptToEvaluateOnNewDocument로 페이지보다 먼저 심는다.
// 아래 이름들은 lib.mjs가 이 파일 앞에 붙여 넣는 public/mission.js·login-id.js에서 온다(isValidPassword·PASSWORD_RULE은 없을 수 있다).
/* global missionNames, normalizeLoginId, loginIdToEmail, LOGIN_ID_RULE, isValidPassword, PASSWORD_RULE */
// lib.mjs가 이 파일 앞에 public/mission.js의 missionNames를 붙여 넣는다(같은 풀이 규칙을 쓰려고).
// 메모리 DB와 세션은 localStorage에 둬서 새로고침해도 남는다.
//
// 테스트 훅 window.__fake:
//   seed(places)            DB를 이 장소들로 바꾼다(missions 배열 포함 가능). 구독자에게 알리지 않는다.
//   importRows(rows)        import_places와 같은 규칙으로 넣는다(데이터 준비용, 알림 없음).
//   store()                 지금 DB(장소 + missions) 복사본. list_places와 같은 모양.
//   remoteChange(fn, opts)  fn(db)로 DB를 바꾸고 구독자에게 postgres_changes를 보낸다. opts.table 기본 'places', opts.notify 기본 true
//   failNext(opts)          다음 rpc를 오류로. 기본 {status:401, code:'PGRST301', message:'JWT expired'}. opts.name이 있으면 그 RPC만
//   conflictNext(record)    다음 save_mission을 conflict로(record를 DB에 최신값으로 넣는다. null이면 기록 삭제)
//   calls                   rpc 호출 기록 [{name, params, at}]
//   channels / removed      살아 있는 채널 수, removeChannel 호출 기록
//   setSession(email)/clearSession()   UI를 거치지 않고 세션 저장(다음 로드부터)
//   echo                    true면 앱의 쓰기 RPC도 실시간 알림을 보낸다(실제 Supabase처럼). 기본 true
//   delay                   rpc 응답 지연(ms). 기본 20
//   setAdmins(emails)       이 이메일들의 세션에 app_metadata.role = 'admin'을 넣는다(다음 setSession·로그인부터). localStorage에 둔다
//   seedAccounts(users)     가짜 admin-users 함수의 계정 목록([{ id, login_id, email, created_at, last_sign_in_at, is_admin }])
//   accounts()              지금 계정 목록 복사본
//   fnFailNext({ status, error })  다음 functions.invoke를 이 상태·문구로 실패시킨다(기본 500)
//   fnCalls                 functions.invoke 호출 기록 [{ name, body, at }]
//   fnDelay                 functions.invoke 응답 지연(ms). 없으면 delay
//   [화면 개선]
//   실시간 알림은 진짜 Supabase처럼 바뀐 행마다 보낸다: places는 new에 행 전체(snake_case, deleted_at 포함),
//     missions는 new에 행 전체(place_id 포함). DELETE는 old에 기본 키(id)만 있다(REPLICA IDENTITY DEFAULT).
//     remoteChange가 아무 행도 바꾸지 않으면 예전처럼 빈 알림(new: {})을 한 번 보낸다.
//   get_places(p_ids)        계약 C2. noGetPlaces = true면 PGRST202(함수 없음)로 실패한다.
//   update_memo(…, p_base_memo) 계약 C1: base가 지금 메모와 다르면 { status: 'conflict', place }.
//                            legacyMemo = true면 옛 서버(인자 2개, 장소를 그대로 돌려줌, 3인자 호출은 PGRST202)
//   softDelete = true        계약 C3: delete_place가 deleted_at만 찍는다(목록·조회에서 빠짐, 알림은 UPDATE)
//   setAppLoginIds(map)      이메일 → app_metadata.login_id(계약 C4, 다음 setSession·로그인부터)
//   비밀번호 규칙은 login-id.js의 isValidPassword·PASSWORD_RULE이 있으면 그것을, 없으면 6자~72바이트(길이만)
(() => {
  const DB_KEY = '__fake_db';
  const SESSION_KEY = '__fake_session';
  const PASSWORD = 'test1234';

  const load = (k, d) => {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch {
      return d;
    }
  };
  const save = (k, v) => {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(v));
    } catch {
      // localStorage를 못 쓰는 환경이면 저장 없이 진행한다.
    }
  };
  const emptyDb = () => ({ nextId: 1, nextMid: 1, places: [], missions: [], logs: [], nextLog: 1 });
  const getDb = () => { const db = load(DB_KEY, emptyDb()); db.logs ??= []; db.nextLog ??= 1; return db; };
  const putDb = (db) => save(DB_KEY, db);
  const now = () => new Date().toISOString();
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const roundCoord = (x) => Math.round(x * 1e7) / 1e7;
  const jsTrim = (s) => String(s ?? '').trim();
  const cleanText = (s) => jsTrim(String(s).replace(/[\r\n\t]+/g, ' '));

  const missionJson = (m) => ({
    mission: m.mission, done: m.done, worker: m.worker, flightTime: m.flightTime, batteryNo: m.batteryNo,
    batteryLeft: m.batteryLeft, version: m.version, updatedAt: m.updatedAt,
  });
  const placeJson = (db, p) => ({
    id: p.id, name: p.name, district: p.district, address: p.address, phone: p.phone, memo: p.memo, mission: p.mission,
    lat: p.lat, lng: p.lng, createdAt: p.createdAt, updatedAt: p.updatedAt,
    missions: db.missions.filter((m) => m.placeId === p.id).sort((a, b) => a.id - b.id).map(missionJson),
  });
  const live = (db) => db.places.filter((p) => !p.deletedAt);
  const findLive = (db, id) => db.places.find((p) => p.id === id && !p.deletedAt);
  const listJson = (db) => live(db).sort((a, b) => a.id - b.id).map((p) => placeJson(db, p));

  class RpcError extends Error {
    constructor(message, { code = 'P0001', status = 400 } = {}) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  function insertPlace(db, r) {
    const t = now();
    const p = {
      id: db.nextId++, name: r.name, district: r.district ?? '', address: r.address ?? '', phone: r.phone ?? '', memo: r.memo ?? '',
      mission: r.mission ?? '', lat: r.lat, lng: r.lng, createdAt: t, updatedAt: t,
    };
    db.places.push(p);
    return p;
  }

  // supabase/migrations의 import_places와 같은 규칙
  function importRows(db, rows) {
    if (!Array.isArray(rows)) throw new RpcError('가져올 장소 목록이 잘못되었습니다.');
    let imported = 0, updated = 0, missionChanged = 0, i = 0;
    for (const r of rows) {
      i++;
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw new RpcError(`${i}번째 장소의 형식이 잘못되었습니다.`);
      const name = String(r.name ?? '').slice(0, 200);
      if (!name) throw new RpcError(`${i}번째 장소: 이름이 비어 있습니다.`);
      if (typeof r.lat !== 'number' || typeof r.lng !== 'number') throw new RpcError(`${i}번째 장소: 좌표가 숫자가 아닙니다.`);
      const lat = roundCoord(r.lat), lng = roundCoord(r.lng);
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new RpcError(`${i}번째 장소: 좌표 범위를 벗어났습니다. (위도: ${lat}, 경도: ${lng})`);
      const district = String(r.district ?? '').slice(0, 200);
      const address = String(r.address ?? '').slice(0, 200);
      const mission = String(r.mission ?? '').slice(0, 200);
      const existing = live(db).find((p) => p.name === name && p.lat === lat && p.lng === lng);
      if (!existing) {
        insertPlace(db, { name, district, address, phone: String(r.phone ?? '').slice(0, 200), memo: String(r.memo ?? '').slice(0, 2000), mission, lat, lng });
        imported++;
        continue;
      }
      const csvAddress = r.addressGiven === false ? '' : address;
      const before = existing.mission;
      const change = (district !== '' && existing.district !== district) || (csvAddress !== '' && existing.address !== csvAddress) || (mission !== '' && existing.mission !== mission);
      if (change) {
        if (district !== '') existing.district = district;
        if (csvAddress !== '') existing.address = csvAddress;
        if (mission !== '') existing.mission = mission;
        existing.updatedAt = now();
        updated++;
        if (mission !== '' && mission !== before) missionChanged++;
      }
    }
    return { imported, duplicates: i - imported, updated, missionChanged };
  }

  let conflictQueue = [];

  // supabase/migrations의 save_mission과 같은 검사 순서
  function saveMission(db, { p_place_id, p_mission, p_fields, p_base_version }) {
    const place = findLive(db, p_place_id);
    if (!place) throw new RpcError('장소를 찾을 수 없습니다.');
    if (p_mission == null || !missionNames(place.mission).includes(p_mission)) throw new RpcError('이 장소에 없는 미션입니다.');
    if (!p_fields || typeof p_fields !== 'object' || Array.isArray(p_fields)) throw new RpcError('잘못된 요청 본문입니다.');
    let any = false;
    const f = {};
    if ('done' in p_fields) {
      if (typeof p_fields.done !== 'boolean') throw new RpcError('완료 여부는 true/false여야 합니다.');
      f.done = p_fields.done;
      any = true;
    }
    for (const [k, label] of [['worker', '이름'], ['flightTime', '비행시간'], ['batteryNo', '배터리 번호'], ['batteryLeft', '배터리 남은 용량']]) {
      if (!(k in p_fields)) continue;
      if (typeof p_fields[k] !== 'string') throw new RpcError(`${label}은(는) 문자열이어야 합니다.`);
      f[k] = cleanText(p_fields[k]);
      any = true;
    }
    if (!any) throw new RpcError('바꿀 내용이 없습니다.');

    if (conflictQueue.length > 0) {
      const record = conflictQueue.shift();
      const row = db.missions.find((m) => m.placeId === place.id && m.mission === p_mission);
      if (record && row) Object.assign(row, record, { mission: p_mission });
      else if (record) db.missions.push({ id: db.nextMid++, placeId: place.id, ...record, mission: p_mission });
      else db.missions = db.missions.filter((m) => m !== row);
      return { result: { status: 'conflict', record: record ? missionJson({ ...record, mission: p_mission }) : null }, wrote: true };
    }

    const existing = db.missions.find((m) => m.placeId === place.id && m.mission === p_mission);
    const base = p_base_version ?? null;
    if ((!existing && base !== null) || (existing && base !== existing.version)) {
      return { result: { status: 'conflict', record: existing ? missionJson(existing) : null }, wrote: false };
    }
    if (f.batteryLeft !== undefined) {
      let v = jsTrim(f.batteryLeft.replace(/%$/, ''));
      if (v !== '') {
        if (!/^[0-9]{1,3}$/.test(v) || Number(v) > 100) throw new RpcError('마지막 배터리 남은 용량은 0~100 사이 숫자만 적어 주세요.');
        v = String(Number(v));
      }
      f.batteryLeft = v;
    }
    const merged = {
      done: f.done ?? existing?.done ?? false,
      worker: (f.worker ?? existing?.worker ?? '').slice(0, 200),
      flightTime: (f.flightTime ?? existing?.flightTime ?? '').slice(0, 200),
      batteryNo: (f.batteryNo ?? existing?.batteryNo ?? '').slice(0, 200),
      batteryLeft: f.batteryLeft ?? existing?.batteryLeft ?? '',
    };
    if (merged.done && [merged.worker, merged.flightTime, merged.batteryNo, merged.batteryLeft].some((v) => jsTrim(v) === '')) {
      throw new RpcError('완료로 저장하려면 이름, 비행시간, 사용한 배터리 번호, 마지막 배터리 남은 용량을 모두 적어야 합니다.');
    }
    let row;
    if (existing) {
      Object.assign(existing, merged, { version: existing.version + 1, updatedAt: now() });
      row = existing;
    } else {
      row = { id: db.nextMid++, placeId: place.id, mission: p_mission, ...merged, version: 1, updatedAt: now() };
      db.missions.push(row);
    }
    return { result: { status: 'ok', record: missionJson(row) }, wrote: true };
  }

  // [fe2] 로그인 기록. session.user로 누가 불렀는지 안다.
  function addLog(db, user, event, ua) {
    db.logs.push({ id: db.nextLog++, userId: user.id, email: user.email, loginId: user.user_metadata?.login_id ?? null, event, userAgent: ua ?? '', ip: '127.0.0.1', occurredAt: now() });
  }
  const USERS_KEY = '__fake_users';
  const LIST_LOGS_KEY = '__fake_list_login_logs_calls';

  // name → (db, params, session) => { result, wrote, table }
  const RPC = {
    log_login: (db, { p_user_agent } = {}, session) => {
      // 서버 트리거가 방금(5초 안) 기록했으면 중복으로 넣지 않는다.
      const last = [...db.logs].reverse().find((l) => l.userId === session.user.id);
      if (last && last.event === 'login' && Date.now() - Date.parse(last.occurredAt) < 5000 && !last.userAgent) {
        last.userAgent = p_user_agent ?? '';
        return { result: { logged: false }, wrote: true, table: 'login_logs' };
      }
      addLog(db, session.user, 'login', p_user_agent);
      return { result: { logged: true }, wrote: true, table: 'login_logs' };
    },
    log_logout: (db, _p, session) => {
      addLog(db, session.user, 'logout', navigator.userAgent);
      return { result: { logged: true }, wrote: true, table: 'login_logs' };
    },
    // 함수가 DB에서 삭제됐다. 부르면 PostgreSQL처럼 42883을 돌려주고, 몇 번 불렸는지 localStorage에 센다(페이지를 넘어 누적).
    list_login_logs: () => {
      save(LIST_LOGS_KEY, (load(LIST_LOGS_KEY, 0) || 0) + 1);
      throw new RpcError('function public.list_login_logs(p_limit => integer) does not exist', { code: '42883', status: 404 });
    },
    list_places: (db) => ({ result: listJson(db), wrote: false }),
    // 계약 C2: 그 id들의 장소만(지운 장소는 빠짐)
    get_places: (db, { p_ids } = {}) => {
      if (fake.noGetPlaces) throw new RpcError('Could not find the function public.get_places(p_ids) in the schema cache', { code: 'PGRST202', status: 404 });
      if (!Array.isArray(p_ids)) throw new RpcError('장소 id 목록이 잘못되었습니다.');
      const ids = new Set(p_ids);
      return { result: listJson(db).filter((p) => ids.has(p.id)), wrote: false };
    },
    import_places: (db, params) => ({ result: importRows(db, params?.rows), wrote: true, table: 'places' }),
    save_mission: (db, params) => ({ ...saveMission(db, params ?? {}), table: 'missions' }),
    // 계약 C1: update_memo(p_place_id, p_memo, p_base_memo) → { status: 'ok' | 'conflict', place }
    update_memo: (db, params = {}) => {
      const { p_place_id, p_memo, p_base_memo } = params;
      if (fake.legacyMemo && 'p_base_memo' in params) {
        throw new RpcError('Could not find the function public.update_memo(p_base_memo, p_memo, p_place_id) in the schema cache', { code: 'PGRST202', status: 404 });
      }
      if (p_memo == null) throw new RpcError('메모는 문자열이어야 합니다.');
      const p = findLive(db, p_place_id);
      if (!p) throw new RpcError('장소를 찾을 수 없습니다.');
      if (!fake.legacyMemo && p_base_memo != null && p.memo !== p_base_memo) {
        return { result: { status: 'conflict', place: placeJson(db, p) }, wrote: false };
      }
      p.memo = String(p_memo).slice(0, 2000);
      p.updatedAt = now();
      return { result: fake.legacyMemo ? placeJson(db, p) : { status: 'ok', place: placeJson(db, p) }, wrote: true, table: 'places' };
    },
    delete_place: (db, { p_place_id } = {}) => {
      const p = findLive(db, p_place_id);
      if (!p) return { result: false, wrote: false };
      if (fake.softDelete) {
        p.deletedAt = now();
        p.updatedAt = now();
      } else {
        db.places = db.places.filter((x) => x !== p);
        db.missions = db.missions.filter((m) => m.placeId !== p_place_id);
      }
      return { result: true, wrote: true, table: 'places' };
    },
  };

  // ── 실시간 ──
  const channels = new Set();
  const removed = [];
  // 알림 하나를 구독자에게 보낸다. payload가 없으면 예전처럼 빈 알림(어느 행인지 모름).
  function emit(table, eventType = 'UPDATE', payload = {}) {
    const msg = { schema: 'public', table, eventType, new: payload.new ?? {}, old: payload.old ?? {}, commit_timestamp: now() };
    fake.emitted.push({ table, eventType, id: msg.new.id ?? msg.old.id ?? null, placeId: msg.new.place_id ?? null });
    for (const ch of channels) {
      for (const { filter, cb } of ch.handlers) {
        if (filter?.table && filter.table !== table) continue;
        setTimeout(() => cb(clone(msg)), 0);
      }
    }
  }
  // DB 행 → 실시간 알림의 행 모양(snake_case)
  const placeRow = (p) => ({
    id: p.id, name: p.name, district: p.district, address: p.address, phone: p.phone, memo: p.memo, mission: p.mission,
    lat: p.lat, lng: p.lng, created_at: p.createdAt, updated_at: p.updatedAt, deleted_at: p.deletedAt ?? null,
  });
  const missionRow = (m) => ({
    id: m.id, place_id: m.placeId, mission: m.mission, done: m.done, worker: m.worker, flight_time: m.flightTime,
    battery_no: m.batteryNo, battery_left: m.batteryLeft, version: m.version, updated_at: m.updatedAt,
  });
  const snapshot = (db) => ({
    places: new Map(db.places.map((p) => [p.id, JSON.stringify(p)])),
    missions: new Map(db.missions.map((m) => [m.id, JSON.stringify(m)])),
  });
  // 바뀐 행마다 알림을 보낸다. 보낸 알림 수를 돌려준다.
  function emitDiff(before, db) {
    let n = 0;
    const diff = (table, rows, prev, toRow) => {
      const now = new Map(rows.map((r) => [r.id, r]));
      for (const [id, json] of prev) {
        const r = now.get(id);
        if (!r) { emit(table, 'DELETE', { old: { id } }); n++; }
        else if (JSON.stringify(r) !== json) { emit(table, 'UPDATE', { new: toRow(r), old: { id } }); n++; }
      }
      for (const [id, r] of now) if (!prev.has(id)) { emit(table, 'INSERT', { new: toRow(r) }); n++; }
    };
    diff('places', db.places, before.places, placeRow);
    diff('missions', db.missions, before.missions, missionRow);
    return n;
  }

  // ── 인증 ──
  const authListeners = new Set();
  const notifyAuth = (event, session) => {
    for (const cb of [...authListeners]) setTimeout(() => cb(event, session), 0);
  };
  const ADMINS_KEY = '__fake_admins';
  const ACCOUNTS_KEY = '__fake_accounts';
  const APP_IDS_KEY = '__fake_app_login_ids';
  const makeSession = (email) => {
    const loginId = load(USERS_KEY, {})[email];
    const appLoginId = load(APP_IDS_KEY, {})[email];
    const admin = load(ADMINS_KEY, []).map((e) => String(e).toLowerCase()).includes(email.toLowerCase());
    const app = admin ? { provider: 'email', role: 'admin' } : { provider: 'email' };
    if (appLoginId) app.login_id = appLoginId;
    return {
      access_token: 'fake-access-token', refresh_token: 'fake-refresh', token_type: 'bearer', expires_in: 3600,
      user: {
        id: 'user-' + email.toLowerCase(), email, aud: 'authenticated', role: 'authenticated',
        user_metadata: loginId ? { login_id: loginId } : {},
        app_metadata: app,
      },
    };
  };

  let failQueue = [];
  let fnFailQueue = [];

  // ── 가짜 Edge Function admin-users ──
  // 계약: body { action: 'list' | 'create' | 'reset_password', login_id?, password?, user_id? }
  //   200 → { ok: true, users } | { ok: true, user } | { ok: true }
  //   400/401/403/404/409/500 → { ok: false, error: '한국어 문구' } (supabase-js처럼 error.context에 Response를 담아 돌려준다)
  const ACCOUNTS_FN = 'admin-users';
  const getAccounts = () => load(ACCOUNTS_KEY, []);
  const putAccounts = (list) => save(ACCOUNTS_KEY, list);
  class FnError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  // 서버(Edge Function)와 같은 비밀번호 규칙. login-id.js에 있으면 그것을 쓴다(이 파일 앞에 붙어 들어온다).
  const passwordOk = (pw) =>
    typeof isValidPassword === 'function' ? isValidPassword(pw) : typeof pw === 'string' && pw.length >= 6 && new TextEncoder().encode(pw).length <= 72;
  const passwordRule = () => (typeof PASSWORD_RULE === 'string' ? PASSWORD_RULE : '비밀번호는 6자 이상 72자 이하여야 합니다.');
  function adminUsers(body, session) {
    if (!session) throw new FnError(401, '로그인이 필요합니다.');
    if (session.user.app_metadata?.role !== 'admin') throw new FnError(403, '관리자만 쓸 수 있는 기능입니다.');
    if (!body || typeof body !== 'object') throw new FnError(400, '잘못된 요청입니다.');
    const accounts = getAccounts();
    switch (body.action) {
      case 'list':
        return { ok: true, users: clone(accounts) };
      case 'create': {
        const loginId = normalizeLoginId(body.login_id);
        if (loginId === null) throw new FnError(400, LOGIN_ID_RULE);
        if (!passwordOk(body.password)) throw new FnError(400, passwordRule());
        const email = loginIdToEmail(loginId);
        if (accounts.some((u) => u.email.toLowerCase() === email)) throw new FnError(409, `이미 있는 아이디입니다: ${loginId}`);
        const user = { id: 'user-' + email, login_id: loginId, email, created_at: now(), last_sign_in_at: null, is_admin: false };
        accounts.push(user);
        putAccounts(accounts);
        const users = load(USERS_KEY, {});
        users[email] = loginId;
        save(USERS_KEY, users);
        return { ok: true, user: clone(user) };
      }
      case 'reset_password': {
        const user = accounts.find((u) => u.id === body.user_id);
        if (!user) throw new FnError(404, '계정을 찾을 수 없습니다.');
        if (!passwordOk(body.password)) throw new FnError(400, passwordRule());
        fake.resetPasswords.push({ user_id: user.id, password: body.password });
        return { ok: true };
      }
      default:
        throw new FnError(400, '알 수 없는 동작입니다.');
    }
  }

  const fake = {
    calls: [],
    // [fe2] 순서 확인용: rpc 이름·'signIn:<email>'·'signOut'을 차례로 적는다.
    events: [],
    // [fe2] RPC별 응답 지연(ms). 없으면 delay.
    rpcDelay: {},
    // [fe2] 서버 트리거처럼 로그인 때 기록을 먼저 남길지
    triggerLog: false,
    // [fe2] 이메일 → 한글 아이디(user_metadata.login_id). localStorage에 둔다.
    setUsers(map) { save(USERS_KEY, map); },
    setAppLoginIds(map) { save(APP_IDS_KEY, map); },
    seedLogs(logs) { const db = getDb(); db.logs = []; db.nextLog = 1; for (const l of logs) db.logs.push({ id: db.nextLog++, ip: '', ...l }); putDb(db); },
    logs() { return getDb().logs; },
    // 삭제된 list_login_logs가 불린 횟수(prepare가 localStorage를 지우면 0부터)
    listLogCalls() { return load(LIST_LOGS_KEY, 0) || 0; },
    removed,
    echo: true,
    delay: 20,
    createClientArgs: null,
    get channels() { return channels.size; },
    seed(places = []) {
      const db = emptyDb();
      for (const p of places) {
        const row = insertPlace(db, { name: p.name, district: p.district, address: p.address, phone: p.phone, memo: p.memo, mission: p.mission, lat: roundCoord(p.lat), lng: roundCoord(p.lng) });
        for (const m of p.missions ?? []) {
          db.missions.push({ id: db.nextMid++, placeId: row.id, done: false, worker: '', flightTime: '', batteryNo: '', batteryLeft: '', version: 1, updatedAt: now(), ...m });
        }
      }
      putDb(db);
      return listJson(db);
    },
    importRows(rows) {
      const db = getDb();
      const r = importRows(db, rows);
      putDb(db);
      return r;
    },
    reset() { putDb(emptyDb()); },
    store() { return listJson(getDb()); },
    rawDb() { return getDb(); },
    remoteChange(fn, { table = 'places', notify = true } = {}) {
      const db = getDb();
      const before = snapshot(db);
      const out = fn?.(db);
      putDb(db);
      // 바뀐 행마다 알림. 아무 행도 안 바뀌었으면 어느 행인지 모르는 빈 알림을 한 번 보낸다(예전 동작).
      if (notify && emitDiff(before, db) === 0) emit(table);
      return out ?? null;
    },
    emit,
    // 보낸 실시간 알림 기록 [{ table, eventType, id, placeId }]
    emitted: [],
    noGetPlaces: false,
    legacyMemo: false,
    softDelete: false,
    failNext({ status = 401, code = 'PGRST301', message = 'JWT expired', name = null } = {}) { failQueue.push({ status, code, message, name }); },
    conflictNext(record = null) { conflictQueue.push(record); },
    // [계정 관리] 관리자 이메일 목록·가짜 계정 목록·함수 호출 기록
    setAdmins(emails) { save(ADMINS_KEY, emails); },
    seedAccounts(users) { putAccounts(users); },
    accounts() { return clone(getAccounts()); },
    fnCalls: [],
    fnDelay: null,
    resetPasswords: [],
    fnFailNext({ status = 500, error = '계정 서버 오류' } = {}) { fnFailQueue.push({ status, error }); },
    setSession(email = 'admin@sistech.test') { save(SESSION_KEY, makeSession(email)); },
    clearSession() { save(SESSION_KEY, null); },
    session() { return load(SESSION_KEY, null); },
    // 연결이 끊겼다가 다시 붙은 것처럼 상태 콜백을 부른다.
    resubscribe() { for (const ch of channels) { ch.statusCb?.('CHANNEL_ERROR'); setTimeout(() => ch.statusCb?.('SUBSCRIBED'), 10); } },
    // 다른 창에서 로그아웃한 것처럼 세션을 지우고 SIGNED_OUT을 보낸다.
    externalSignOut() { save(SESSION_KEY, null); fake.__dropSession?.(); notifyAuth('SIGNED_OUT', null); },
  };
  window.__fake = fake;

  function createClient(url, key, opts) {
    fake.createClientArgs = { url, key: key ? '(set)' : '', opts };
    let session = load(SESSION_KEY, null);
    fake.__dropSession = () => { session = null; };
    return {
      auth: {
        onAuthStateChange(cb) {
          authListeners.add(cb);
          setTimeout(() => cb('INITIAL_SESSION', session), 0);
          return { data: { subscription: { id: Math.random(), unsubscribe: () => authListeners.delete(cb) } } };
        },
        async getSession() { return { data: { session }, error: null }; },
        async signInWithPassword({ email, password } = {}) {
          await new Promise((r) => setTimeout(r, fake.delay));
          if (!email || password !== PASSWORD) {
            return { data: { user: null, session: null }, error: { name: 'AuthApiError', code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 } };
          }
          fake.events.push('signIn:' + email);
          session = makeSession(email);
          save(SESSION_KEY, session);
          if (fake.triggerLog) { const db = getDb(); addLog(db, session.user, 'login', ''); putDb(db); }
          notifyAuth('SIGNED_IN', session);
          return { data: { user: session.user, session }, error: null };
        },
        async signOut({ scope = 'global' } = {}) {
          fake.lastSignOutScope = scope;
          fake.events.push('signOut');
          session = null;
          save(SESSION_KEY, null);
          notifyAuth('SIGNED_OUT', null);
          return { error: null };
        },
      },
      rpc(name, params) {
        try { window.__e2eRpc?.(name); } catch { /* 호출 수 세기는 점검용이라 실패해도 무시 */ }
        fake.calls.push({ name, params: params === undefined ? undefined : clone(params), at: Date.now() });
        fake.events.push(name);
        const run = () => {
          if (!session) return { data: null, error: { message: 'JWT expired', code: 'PGRST301', details: null, hint: null }, status: 401, statusText: 'Unauthorized' };
          // failNext({ name })로 겨눈 실패는 그 RPC에만 쓴다(실시간으로 같이 도는 다른 RPC가 가로채지 않게).
          const fi = failQueue.findIndex((f) => !f.name || f.name === name);
          if (fi >= 0) {
            const [f] = failQueue.splice(fi, 1);
            return { data: null, error: { message: f.message, code: f.code, details: null, hint: null }, status: f.status, statusText: '' };
          }
          const fn = RPC[name];
          if (!fn) return { data: null, error: { message: `Could not find the function public.${name}`, code: 'PGRST202', details: null, hint: null }, status: 404, statusText: 'Not Found' };
          const db = getDb();
          const before = snapshot(db);
          try {
            const { result, wrote } = fn(db, params, session);
            if (wrote) {
              putDb(db);
              if (fake.echo) emitDiff(before, db);
            }
            return { data: clone(result), error: null, status: 200, statusText: 'OK' };
          } catch (e) {
            if (!(e instanceof RpcError)) throw e;
            return { data: null, error: { message: e.message, code: e.code, details: null, hint: null }, status: e.status, statusText: 'Bad Request' };
          }
        };
        const promise = new Promise((resolve) => setTimeout(() => resolve(run()), fake.rpcDelay[name] ?? fake.delay));
        // PostgrestBuilder처럼 thenable(Promise 자체는 아님)
        return { then: (a, b) => promise.then(a, b) };
      },
      // supabase-js functions.invoke: 2xx면 { data, error: null }, 아니면 { data: null, error: FunctionsHttpError(context = Response) }.
      functions: {
        async invoke(name, { body } = {}) {
          try { window.__e2eRpc?.('fn:' + name); } catch { /* 호출 수 세기는 점검용이라 실패해도 무시 */ }
          fake.fnCalls.push({ name, body: body === undefined ? undefined : clone(body), at: Date.now() });
          fake.events.push(`fn:${name}:${body?.action ?? ''}`);
          await new Promise((r) => setTimeout(r, fake.fnDelay ?? fake.delay));
          const fail = (status, payload) => ({
            data: null,
            error: {
              name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code',
              context: new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }),
            },
          });
          if (fnFailQueue.length > 0) {
            const f = fnFailQueue.shift();
            // status 0은 네트워크 실패(FunctionsFetchError: context가 Response가 아님)
            if (!f.status) return { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: new TypeError('Failed to fetch') } };
            return fail(f.status, { ok: false, error: f.error });
          }
          if (name !== ACCOUNTS_FN) return fail(404, { ok: false, error: `함수를 찾을 수 없습니다: ${name}` });
          try {
            return { data: adminUsers(body, session), error: null };
          } catch (e) {
            if (!(e instanceof FnError)) throw e;
            return fail(e.status, { ok: false, error: e.message });
          }
        },
      },
      channel(name) {
        const ch = {
          name,
          handlers: [],
          on(type, filter, cb) {
            if (type === 'postgres_changes') ch.handlers.push({ filter, cb });
            return ch;
          },
          subscribe(statusCb) {
            ch.statusCb = statusCb;
            channels.add(ch);
            setTimeout(() => statusCb?.('SUBSCRIBED'), 0);
            return ch;
          },
          unsubscribe() { channels.delete(ch); return Promise.resolve('ok'); },
        };
        return ch;
      },
      removeChannel(ch) {
        removed.push(ch?.name);
        channels.delete(ch);
        return Promise.resolve('ok');
      },
    };
  }

  window.supabase = { createClient };
})();
