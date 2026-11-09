// 자동 점검용 가짜 카카오맵 SDK. CDP Page.addScriptToEvaluateOnNewDocument로 페이지보다 먼저 심는다.
// app.js가 쓰는 것만 흉내 낸다. 진짜 SDK·타일은 부르지 않는다.
// 점검 스크립트에서 쓰는 것:
//   window.__kakaoMaps            만들어진 지도 목록(보통 1개)
//   window.__kakaoFire(t, type)   addListener로 걸린 처리기를 직접 부른다(예: 지도 'zoom_changed')
//   map.__overlayTypes            켜진 겹침 지도 종류(Set)
//   map.__calls                   setBounds/panTo/setLevel 등 부른 기록
(() => {
  const listeners = new Map(); // target → Map(type → [fn])
  const on = (target, type, fn) => {
    if (!listeners.has(target)) listeners.set(target, new Map());
    const byType = listeners.get(target);
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(fn);
  };
  const fire = (target, type, ...args) => {
    for (const fn of listeners.get(target)?.get(type) ?? []) fn(...args);
  };

  class LatLng {
    constructor(lat, lng) {
      this.lat = Number(lat);
      this.lng = Number(lng);
    }
    getLat() { return this.lat; }
    getLng() { return this.lng; }
    equals(o) { return o && o.lat === this.lat && o.lng === this.lng; }
    toString() { return `(${this.lat}, ${this.lng})`; }
  }

  class LatLngBounds {
    constructor(sw, ne) {
      this.sw = sw ?? null;
      this.ne = ne ?? null;
    }
    extend(ll) {
      if (!this.sw) {
        this.sw = new LatLng(ll.lat, ll.lng);
        this.ne = new LatLng(ll.lat, ll.lng);
      } else {
        this.sw = new LatLng(Math.min(this.sw.lat, ll.lat), Math.min(this.sw.lng, ll.lng));
        this.ne = new LatLng(Math.max(this.ne.lat, ll.lat), Math.max(this.ne.lng, ll.lng));
      }
    }
    getSouthWest() { return this.sw; }
    getNorthEast() { return this.ne; }
    isEmpty() { return !this.sw; }
  }

  const MapTypeId = { ROADMAP: 1, NORMAL: 1, SKYVIEW: 2, HYBRID: 3, OVERLAY: 4, ROADVIEW: 5, TRAFFIC: 6, TERRAIN: 7, BICYCLE: 8, BICYCLE_HYBRID: 9, USE_DISTRICT: 10 };

  class KMap {
    constructor(container, opts = {}) {
      this.container = container;
      this.center = opts.center ?? new LatLng(37.5, 127);
      this.level = opts.level ?? 3;
      this.mapTypeId = opts.mapTypeId ?? MapTypeId.ROADMAP;
      this.__overlayTypes = new Set();
      this.__calls = [];
      // 진짜처럼 지도 칸 안에 그릴 판을 하나 둔다. 겹침(CustomOverlay)은 여기에 붙는다.
      this.pane = document.createElement('div');
      this.pane.className = 'fake-kakao-pane';
      this.pane.style.cssText = 'position:absolute;inset:0;overflow:hidden';
      container.append(this.pane);
      (window.__kakaoMaps ??= []).push(this);
    }
    setCenter(ll) { this.center = ll; this.__calls.push(['setCenter', ll.lat, ll.lng]); fire(this, 'center_changed'); }
    getCenter() { return this.center; }
    setLevel(level, opts) {
      this.__calls.push(['setLevel', level, opts?.anchor ? [opts.anchor.lat, opts.anchor.lng] : null]);
      if (level === this.level) return;
      this.level = level;
      fire(this, 'zoom_changed');
    }
    getLevel() { return this.level; }
    panTo(ll) { this.__calls.push(['panTo', ll.lat, ll.lng]); this.setCenter(ll); }
    // 영역 크기로 대충 단계를 고른다(점 하나면 1단계 — app.js가 3단계로 끌어올리는지 볼 수 있게).
    setBounds(b, ...padding) {
      this.__calls.push(['setBounds', b.sw?.lat, b.sw?.lng, b.ne?.lat, b.ne?.lng, ...padding]);
      const span = Math.max(b.ne.lat - b.sw.lat, b.ne.lng - b.sw.lng);
      this.center = new LatLng((b.sw.lat + b.ne.lat) / 2, (b.sw.lng + b.ne.lng) / 2);
      const level = span <= 0 ? 1 : Math.max(1, Math.min(14, Math.round(Math.log2(span / 0.002)) + 1));
      if (level !== this.level) {
        this.level = level;
        fire(this, 'zoom_changed');
      }
      fire(this, 'bounds_changed');
    }
    getBounds() { return new LatLngBounds(this.center, this.center); }
    setMapTypeId(id) { this.mapTypeId = id; this.__calls.push(['setMapTypeId', id]); fire(this, 'maptypeid_changed'); }
    getMapTypeId() { return this.mapTypeId; }
    addOverlayMapTypeId(id) { this.__overlayTypes.add(id); this.__calls.push(['addOverlayMapTypeId', id]); }
    removeOverlayMapTypeId(id) { this.__overlayTypes.delete(id); this.__calls.push(['removeOverlayMapTypeId', id]); }
    relayout() {}
    setDraggable() {}
    setZoomable() {}
  }

  class CustomOverlay {
    constructor(opts = {}) {
      this.opts = opts;
      this.position = opts.position;
      this.zIndex = opts.zIndex ?? 0;
      this.map = null;
      // 진짜 SDK처럼 내용을 감싸는 칸을 하나 둔다. 위치는 점검에서 쓰지 않으므로 겹쳐 쌓는다.
      this.wrap = document.createElement('div');
      this.wrap.className = 'fake-kakao-overlay';
      this.wrap.style.cssText = 'position:absolute;left:50%;top:50%';
      this.setContent(opts.content);
      this.setZIndex(this.zIndex);
      if (opts.map) this.setMap(opts.map);
    }
    setMap(map) {
      this.map = map ?? null;
      if (map) map.pane.append(this.wrap);
      else this.wrap.remove();
    }
    getMap() { return this.map; }
    setContent(content) {
      this.content = content;
      this.wrap.replaceChildren();
      if (typeof content === 'string') this.wrap.innerHTML = content;
      else if (content) this.wrap.append(content);
    }
    getContent() { return this.content; }
    setPosition(ll) { this.position = ll; }
    getPosition() { return this.position; }
    setZIndex(z) { this.zIndex = z; this.wrap.style.zIndex = String(z); }
    getZIndex() { return this.zIndex; }
    setVisible(v) { this.wrap.style.display = v ? '' : 'none'; }
  }

  const event = {
    addListener: on,
    removeListener(target, type, fn) {
      const list = listeners.get(target)?.get(type);
      if (list) list.splice(list.indexOf(fn) >>> 0, 1);
    },
    trigger: fire,
  };
  window.__kakaoFire = fire;

  window.kakao = {
    maps: {
      load(cb) { setTimeout(cb, 0); },
      Map: KMap,
      LatLng,
      LatLngBounds,
      CustomOverlay,
      MapTypeId,
      event,
      services: {},
      __fake: true,
    },
  };
})();
