// 부산 연안 실해역 운용: 실제 지도(Google Maps 또는 OpenStreetMap·Esri) 위에서 모델별 검증 시나리오
// 지상통제소(GCS, 한국해양대 인근) + 해상통제소(MCS, 지원함 탑재)로 운용. 위치는 실제 지명을 기준으로 잡았고
// 경계구역·요구조자·유출유·미식별 선박·AIS 선박은 모두 훈련용 가상 설정이다(실제 보안구역·항로 정보 아님).
(function () {
  'use strict';
  const D2R = Math.PI / 180;
  const O = { lat: 35.12, lon: 129.12 };
  const KX = 111320 * Math.cos(O.lat * D2R), KY = 111320;
  const P = (lat, lon) => ({ x: (lon - O.lon) * KX, y: (lat - O.lat) * KY });
  const toLL = (p) => ({ lat: O.lat + p.y / KY, lon: O.lon + p.x / KX });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const brg = (a, b) => ((Math.atan2(b.x - a.x, b.y - a.y) / D2R) + 360) % 360;
  const wrap180 = (a) => ((a + 540) % 360) - 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmtT = (t) => { t = Math.floor(t); return [t / 3600, (t / 60) % 60, t % 60].map((n) => String(Math.floor(n)).padStart(2, '0')).join(':'); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rect = (la0, lo0, la1, lo1) => [P(la0, lo0), P(la0, lo1), P(la1, lo1), P(la1, lo0)];
  const lawn = (la0, la1, lo0, lo1, n) => { const w = []; for (let i = 0; i < n; i++) { const lo = lo0 + ((lo1 - lo0) * i) / (n - 1); const a = P(la0, lo), b = P(la1, lo); w.push(...(i % 2 ? [b, a] : [a, b])); } return w; };

  // ---------- 통제소·통신(가정값) ----------
  const GCS = { ...P(35.0762, 129.0870), name: '지상통제소(한국해양대 인근)' };
  const LTE_R = 10000, MESH_R = 6000;
  // 연안 LTE 기지국(가정 위치): 기지국 10km 안이면 LTE로 지상통제소와 연결
  const LTE_SITES = [P(35.0700, 129.0200), P(35.0750, 129.0900), P(35.1550, 129.1200), P(35.1600, 129.1600), P(35.2450, 129.2250), P(35.3200, 129.2850), P(35.0500, 128.9700)];
  const lteOK = (v) => LTE_SITES.some((s) => dist(v, s) < LTE_R);
  const STN = { GCS: '지상통제소', MCS: '해상통제소' };

  // ---------- 모델 ----------
  const MODEL = {
    A: { name: 'A 인명구조형', color: '#ff7a45', vmax: 8, cruise: 0.7, turn: 28, battWh: 1800, propW: 3200, thermal: 450 },
    B: { name: 'B 해양관측형', color: '#36cfc9', vmax: 5, cruise: 0.55, turn: 12, battWh: 8000, propW: 4000, eo: 2000 },
    D: { name: 'D 국가중요시설 감시형', color: '#9b8cff', vmax: 7, cruise: 0.5, turn: 20, battWh: 6000, propW: 3000, radar: 6000, eo: 1500 },
  };

  // ---------- 상태 ----------
  const S = { t: 0, ts: 20, paused: false, vessels: [], ais: [], contacts: [], zones: [], events: [], alarms: {}, piw: null, oil: null, mcs: null, scn: null, result: null, sel: null, flags: {} };
  const log = (who, lv, msg) => { S.events.unshift({ t: S.t, who, lv, msg }); if (S.events.length > 400) S.events.pop(); };
  const alarm = (key, on, lv, msg, who) => {
    const a = S.alarms[key];
    if (on && !a) { S.alarms[key] = { lv, msg, who }; log(who, lv, msg); }
    else if (!on && a) { delete S.alarms[key]; log(a.who, 'i', '해제: ' + a.msg); }
  };
  function addVessel(code, id, home, hdg, route, loop) {
    const m = MODEL[code];
    const v = { id, code, m, x: home.x, y: home.y, home, hdg, spd: 0, mode: route ? 'AUTO' : 'HOLD', wps: route ? route.slice() : [], wi: 0, loop: !!loop, patrol: route ? route.slice() : [], batt: m.battWh, trail: [], lastTrail: 0, contacts: [], buoy: false, warnUntil: 0, link: null, pref: 'GCS', lostAt: null, lostMax: 0, failsafe: false, track: null };
    S.vessels.push(v); if (!S.sel) S.sel = id; return v;
  }
  const V = (code) => S.vessels.find((v) => v.code === code);

  // ---------- AIS 가상 선박 ----------
  const HARBOR_GAP = P(35.0835, 129.0985);
  function seedAIS(extra = []) {
    const IN = [P(35.010, 129.175), P(35.060, 129.125), P(35.0780, 129.1050), HARBOR_GAP, P(35.0900, 129.0920), P(35.0970, 129.0830)];
    const COAST = [P(35.050, 129.040), P(35.058, 129.110), P(35.095, 129.170), P(35.180, 129.270), P(35.300, 129.330)];
    S.ais = [
      { name: 'HANBADA', type: '여객선', route: IN, sog: 6.0 },
      { name: 'BUSAN STAR', type: '컨테이너선', route: IN.slice().reverse(), sog: 5.0 },
      { name: '동백 3호', type: '어선', route: COAST, sog: 3.5 },
      ...extra,
    ].map((a) => ({ ...a, ...a.route[0], i: 0, cog: 0 }));
  }
  function moveOnRoute(o, dt, loop = true) {
    const tgt = o.route[o.i + 1];
    if (!tgt) { if (loop) { o.i = 0; Object.assign(o, o.route[0]); } return false; }
    o.cog = brg(o, tgt);
    if (dist(o, tgt) < o.sog * dt * 2 + 15) { o.i++; return true; }
    o.x += Math.sin(o.cog * D2R) * o.sog * dt; o.y += Math.cos(o.cog * D2R) * o.sog * dt; return true;
  }

  // ---------- 기하 ----------
  function inPoly(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; }
  function distToPoly(p, poly) { if (inPoly(p, poly)) return 0; let m = Infinity; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2; const t = clamp(((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L2, 0, 1); m = Math.min(m, Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)))); } return m; }
  const center = (poly) => poly.reduce((a, p) => ({ x: a.x + p.x / poly.length, y: a.y + p.y / poly.length }), { x: 0, y: 0 });

  // ---------- 운항 ----------
  function stepVessel(v, dt) {
    let thr = 0, desired = null;
    if (v.track) {
      const c = S.contacts.find((q) => q.id === v.track);
      if (c && !c.gone && c.seenAt != null && S.t - c.seenAt < 15) { const b = brg(c, v) * D2R; v.wps = [{ x: c.x + Math.sin(b) * 350, y: c.y + Math.cos(b) * 350 }]; v.wi = 0; v.loop = false; if (!v.failsafe) v.mode = 'AUTO'; }
      else { v.track = null; v.wps = v.patrol.slice(); v.wi = 0; v.loop = v.patrol.length > 1; log(v.id, 'i', '추적 종료 · 순찰 복귀'); }
    }
    if (v.mode === 'AUTO') {
      const w = v.wps[v.wi];
      if (!w) v.mode = 'HOLD';
      else {
        const d = dist(v, w);
        if (d < 25) { v.wi++; if (v.wi >= v.wps.length) { if (v.loop && v.wps.length > 1) v.wi = 0; else { v.mode = 'HOLD'; if (!v.track) log(v.id, 'i', '경로 완료 → 정지'); } } }
        else { desired = brg(v, w); thr = v.m.cruise * clamp(d / 80, v.track ? 0.15 : 0.35, 1); }
      }
    }
    if (desired !== null) {
      for (const a of S.ais) { if (dist(v, a) < 600 && Math.abs(wrap180(brg(v, a) - v.hdg)) < 35) { desired += 40; break; } }
      const rud = clamp(wrap180(desired - v.hdg) / 30, -1, 1);
      v.hdg = (v.hdg + rud * v.m.turn * Math.min(1, v.spd / 1.5 + 0.15) * dt + 360) % 360;
    }
    v.spd += (thr * v.m.vmax - v.spd) * Math.min(1, dt / 4);
    v.x += Math.sin(v.hdg * D2R) * v.spd * dt + 0.05 * dt; v.y += Math.cos(v.hdg * D2R) * v.spd * dt - 0.03 * dt;
    v.batt = Math.max(0, v.batt - (180 + v.m.propW * thr ** 3 + (S.t < v.warnUntil ? 160 : 0) + (v.m.radar ? 60 : 0)) * dt / 3600);
    if (S.t - v.lastTrail > 4) { v.trail.push({ x: v.x, y: v.y }); if (v.trail.length > 500) v.trail.shift(); v.lastTrail = S.t; }
  }

  // ---------- 통제 링크: 지상통제소(LTE·메시) ↔ 해상통제소(메시) 자동 인계 ----------
  function stepLinks() {
    S.vessels.forEach((v) => {
      const c = [];
      if (lteOK(v)) c.push({ st: 'GCS', via: 'LTE' }); else if (dist(v, GCS) < MESH_R) c.push({ st: 'GCS', via: '메시' });
      if (S.mcs && dist(v, S.mcs) < MESH_R) c.push({ st: 'MCS', via: '메시' });
      c.sort((a, b) => (b.st === v.pref) - (a.st === v.pref));
      const best = c[0] || null, prev = v.link;
      v.link = best;
      if (prev && best && prev.st !== best.st) log(v.id, 'w', '통제권 인계: ' + STN[prev.st] + ' → ' + STN[best.st] + '(' + best.via + ')');
      if (!best) {
        if (v.lostAt == null) { v.lostAt = S.t; log(v.id, 'c', '통제 링크 두절'); }
        v.lostMax = Math.max(v.lostMax, S.t - v.lostAt);
        alarm('lost-' + v.id, true, 'c', '통제 링크 두절', v.id);
        if (S.t - v.lostAt > 15 && !v.failsafe) { v.failsafe = true; v.mode = 'HOLD'; log(v.id, 'c', '두절 15초 → 안전 동작(정지·표류)'); }
      } else {
        if (v.lostAt != null) { log(v.id, 'i', '통제 링크 복구: ' + STN[best.st] + '(' + best.via + ')'); v.lostAt = null; }
        alarm('lost-' + v.id, false);
      }
    });
  }
  // 해상통제소(지원함): 호위 대상 선체를 따라가며 다음 경로점 쪽으로 1.5km 앞서 위치
  function stepMCS(dt) {
    const M = S.mcs; if (!M) return;
    const v = S.vessels.find((q) => q.id === M.escort);
    if (!v) return;
    const w = v.wps[v.wi] || v, b = brg(v, w) * D2R, lead = v.wps[v.wi] ? 1500 : 600;
    const tgt = { x: v.x + Math.sin(b) * lead + 400, y: v.y + Math.cos(b) * lead };
    const d = dist(M, tgt);
    M.sog = d > 80 ? Math.min(5.5, 1 + d / 300) : 0;
    if (M.sog) { M.cog = brg(M, tgt); M.x += Math.sin(M.cog * D2R) * M.sog * dt; M.y += Math.cos(M.cog * D2R) * M.sog * dt; }
  }

  // ---------- 탐지·구역·임무 ----------
  function stepSensors() {
    S.vessels.forEach((v) => {
      v.contacts = [];
      if (v.m.radar) S.ais.forEach((a) => { if (dist(v, a) <= v.m.radar) v.contacts.push({ name: a.name, ais: true, d: dist(v, a) }); });
      S.contacts.forEach((c) => {
        if (c.gone || c.spawnAt > S.t) return;
        const d = dist(v, c);
        const rng = v.m.radar || v.m.eo || 0;
        if (d > rng) return;
        v.contacts.push({ name: c.label, ais: false, d });
        c.seenAt = S.t;
        if (c.detAt == null) { c.detAt = S.t; c.detBy = v.id; log(v.id, 'w', (v.m.radar ? '레이더' : 'EO 카메라') + ' 탐지: ' + c.label + '(AIS 미송신) · ' + (d / 1852).toFixed(1) + 'NM · 방위 ' + Math.round(brg(v, c)) + '°'); }
        if (!c.eoId && v.m.eo && d < v.m.eo) { c.eoId = true; log(v.id, 'w', 'EO/IR 식별: ' + c.ident + ' · 영상 전송'); }
        if (c.inZone && d < 1500) c.evidence = (c.evidence || 0) + S.dt;
      });
    });
  }
  function stepContacts(dt) {
    S.contacts.forEach((c) => {
      if (c.gone || c.spawnAt > S.t) return;
      if (!c.spawned) { c.spawned = true; log('훈련', 'i', c.label + ' 투입 · ' + c.note); }
      if (c.warnedAt != null && S.t - c.warnedAt > 25 && !c.leaving) { c.leaving = true; c.route = [{ x: c.x, y: c.y }, c.exit]; c.i = 0; c.sog = 8; log(c.label, 'i', '경고 후 침로 변경 · 이탈'); }
      const moving = moveOnRoute(c, dt, false);
      if (!moving && !c.leaving && c.loiter) { c.x += Math.sin(S.t / 30) * 0.6 * dt; c.y += Math.cos(S.t / 30) * 0.6 * dt; }
      if (!moving && c.leaving) { c.gone = true; log(c.label, 'i', '원거리 이탈 · 상황 종료'); S.zones.forEach((z) => { alarm('near-' + z.id + c.id, false); alarm('in-' + z.id + c.id, false); alarm('fish-' + z.id + c.id, false); }); }
      const seen = c.seenAt != null && S.t - c.seenAt < 15;
      S.zones.forEach((z) => {
        const inside = inPoly(c, z.poly), near = z.buffer && distToPoly(c, z.poly) < z.buffer;
        if (z.kind === 'nogo') {
          alarm('near-' + z.id + c.id, !c.gone && seen && near && !inside, 'w', z.name + ' 접근: ' + c.label, c.detBy || 'GCS');
          alarm('in-' + z.id + c.id, !c.gone && seen && inside, 'c', z.name + ' 침입: ' + c.label, c.detBy || 'GCS');
          if (inside && c.inAt == null) c.inAt = S.t;
          if (inside && seen && c.repAt == null) { c.repAt = S.t; log(c.detBy, 'c', z.report + ' 경보 전송(IF-10): ' + z.name + ' 침입'); }
        }
        if (z.kind === 'shore') {
          if (near && c.nearAt == null) c.nearAt = S.t;
          alarm('near-' + z.id + c.id, !c.gone && seen && near, 'c', z.name + ' 1km 이내 접근: ' + c.label, c.detBy || 'GCS');
          if (near && seen && c.repAt == null) { c.repAt = S.t; log(c.detBy, 'c', z.report + ' 경보 전송(IF-10): ' + c.label + ' 해안 접근'); }
        }
        if (z.kind === 'fishing') {
          c.inZone = inside;
          alarm('fish-' + z.id + c.id, !c.gone && seen && inside, 'w', z.name + ' 안 ' + c.label, c.detBy || 'GCS');
          if (inside && seen && c.repAt == null) { c.repAt = S.t; log(c.detBy, 'c', z.report + ' 통보(IF-10): ' + z.name + ' 내 불법조업 의심 선박'); }
        }
      });
    });
  }
  function stepRescueOil(dt) {
    const p = S.piw;
    if (p && !p.rescued) {
      p.x += 0.06 * dt; p.y -= 0.03 * dt;
      S.vessels.filter((v) => v.m.thermal).forEach((v) => {
        const d = dist(v, p), rel = wrap180(brg(v, p) - v.hdg);
        if (d < v.m.thermal && Math.abs(rel) < 35) { if (!p.det) log(v.id, 'c', '열화상 탐지: ' + p.label + ' · ' + Math.round(d) + 'm'); p.det = true; p.dx = p.x; p.dy = p.y; }
      });
    }
    const o = S.oil;
    if (o && !o.reported) S.vessels.filter((v) => v.code === 'B').forEach((v) => {
      const dx = v.x - o.c.x, dy = v.y - o.c.y, c = Math.cos(-o.rot), s = Math.sin(-o.rot), lx = dx * c - dy * s, ly = dx * s + dy * c;
      if ((lx * lx) / (o.rx + 400) ** 2 + (ly * ly) / (o.ry + 400) ** 2 <= 1) { o.reported = true; o.repAt = S.t; log(v.id, 'c', '유출유 의심 징후 감지 · 해양수산부·해경 상황실 전송(IF-10)'); alarm('oil', true, 'c', '유출유 의심 징후(' + o.name + ')', v.id); }
    });
  }

  // ---------- 시나리오 정의 ----------
  let cid = 0;
  const contact = (o) => ({ id: 'k' + (++cid), i: 0, cog: 0, detAt: null, inAt: null, repAt: null, warnedAt: null, ...o, ...o.route[0] });
  const intrusionCheck = (c, minLead) => {
    if (c.inAt != null && (c.detAt == null || c.inAt - c.detAt < minLead)) return ['fail', c.detAt == null ? '진입 전 탐지 실패' : '조기경보 부족(진입 ' + Math.round(c.inAt - c.detAt) + '초 전 탐지)'];
    if (c.inAt != null && (c.repAt == null || c.repAt - c.inAt > 5)) return ['fail', '진입 후 5초 안에 보고 안 됨'];
    if (c.gone) return c.warnedAt != null ? ['pass', '진입 ' + (c.inAt != null ? Math.round(c.inAt - c.detAt) + '초 전' : '전') + ' 탐지 · 보고 · 경고 후 이탈'] : ['fail', '경고 없이 종료'];
  };
  const PORT_PATROL = [P(35.0790, 129.1050), P(35.0790, 129.1300), P(35.0680, 129.1300), P(35.0680, 129.1050)];
  const SCN = {
    // ---- 인명구조(A) ----
    'rescue-gwangalli': {
      group: '인명구조', model: 'A', title: '광안리 앞 익수자 구조', reqs: 'A 탐색 · A 구조',
      steps: ['A-01이 민락항 앞에서 출동, 광안대교 남쪽 수색', '열화상으로 익수자 탐지(450m, 시야 ±35°)', '‘탐지 지점으로’ 접근', '40m 안에서 ‘구조부이 분리’'],
      criteria: '구조부이를 요구조자 40m 이내 전달', view: [35.143, 129.132, 14],
      setup() { addVessel('A', 'A-01', P(35.1490, 129.1380), 200, lawn(35.1450, 35.1375, 129.1270, 129.1380, 4)); S.piw = { ...P(35.1395, 129.1310), label: '익수자 추정' }; },
      check() { if (S.piw.rescued) return ['pass', '임무 ' + Math.floor(S.t / 60) + '분에 부이 전달']; if (S.flags.buoyFail) return ['fail', '구조부이가 너무 멀리 분리됨']; },
      actions: [['탐지 지점으로', 'goto'], ['🛟 구조부이 분리', 'buoy']],
    },
    'rescue-taejongdae': {
      group: '인명구조', model: 'A', title: '태종대 갯바위 고립자 수색', reqs: 'A 탐색 · A 구조 · 운용시간 1시간(안)',
      steps: ['A-01이 태종대 동쪽 해상에서 출동', '태종대 남쪽 절벽 아래 해역을 잔디깎기 수색', '열화상으로 고립·표류자 탐지', '접근해 구조부이 전달'],
      criteria: '배터리 30% 이상 남기고 부이 전달', view: [35.049, 129.090, 14],
      setup() { addVessel('A', 'A-01', P(35.0525, 129.1035), 220, lawn(35.0478, 35.0425, 129.0980, 129.0760, 5)); S.piw = { ...P(35.0452, 129.0870), label: '표류자 추정' }; },
      check() { const a = V('A'); if (S.piw.rescued) return a.batt / a.m.battWh >= 0.3 ? ['pass', '부이 전달 · 배터리 ' + Math.round(a.batt / a.m.battWh * 100) + '%'] : ['fail', '배터리 30% 미만']; if (S.flags.buoyFail) return ['fail', '구조부이가 너무 멀리 분리됨']; },
      actions: [['탐지 지점으로', 'goto'], ['🛟 구조부이 분리', 'buoy']],
    },
    // ---- 해안감시(D) ----
    'coast-songdo': {
      group: '해안감시', model: 'D', title: '송도·감천 해안 접근 선박 감시', reqs: 'D 탐지·식별 · 비살상 대응 · IF-10',
      steps: ['D-01이 송도~두도 앞 해안을 따라 순찰', '야간에 AIS를 끈 소형 보트가 외해에서 해수욕장 쪽으로 접근', '해안 1km 도달 전 탐지·식별 → 해경 상황실 보고', '경고 방송으로 이탈 유도'],
      criteria: '해안 1km 도달 3분 이상 전 탐지 + 보고 + 경고 후 이탈', view: [35.055, 129.020, 13],
      setup() {
        addVessel('D', 'D-01', P(35.0640, 129.0420), 250, [P(35.0600, 129.0250), P(35.0600, 129.0450), P(35.0450, 129.0450), P(35.0450, 129.0250)], true);
        S.zones.push({ id: 'beach', kind: 'shore', name: '송도해수욕장', poly: rect(35.0752, 129.0190, 35.0772, 129.0270), buffer: 1000, report: '해경 상황실' });
        S.contacts.push(contact({ label: '미식별 소형 보트', ident: '고속 소형 보트, 승선 3명 내외 추정', note: '외해 → 송도해수욕장', route: [P(35.000, 129.000), P(35.0400, 129.0240), P(35.0740, 129.0240)], sog: 7, loiter: true, spawnAt: 60, exit: P(34.990, 128.990) }));
      },
      check() { const c = S.contacts[0]; if (c.nearAt != null && (c.detAt == null || c.nearAt - c.detAt < 180)) return ['fail', c.detAt == null ? '해안 접근 전 탐지 실패' : '조기 탐지 부족(' + Math.round(c.nearAt - c.detAt) + '초 전)']; if (c.gone) return c.warnedAt != null && c.detAt != null ? ['pass', '해안 접근 ' + (c.nearAt != null ? Math.round(c.nearAt - c.detAt) + '초 전' : '전') + ' 탐지 · 보고 · 경고 후 이탈'] : ['fail', '경고 없이 종료']; },
      actions: [['추적 감시', 'track'], ['📢 경고 방송·탐조등', 'warn']],
    },
    // ---- 어장감시(B) ----
    'fishery-gijang': {
      group: '어장감시', model: 'B', title: '기장 앞바다 불법조업 감시', reqs: 'B 자율 순항 · B 관측 센서 · IF-10',
      steps: ['B-01이 기장 앞 보호수면(가상)을 순찰', 'AIS를 끈 어선이 보호수면 안에서 조업', 'EO 카메라로 탐지(2km) → 수산 당국·해경 통보', '‘추적 감시’로 1.5km 안에서 2분 이상 증거 영상 확보'],
      criteria: '불법조업 의심 선박 탐지·통보 + 증거 영상 2분', view: [35.205, 129.270, 13],
      setup() {
        addVessel('B', 'B-01', P(35.1880, 129.2450), 60, [P(35.1900, 129.2550), P(35.2150, 129.2550), P(35.2150, 129.2850), P(35.1900, 129.2850)], true);
        S.zones.push({ id: 'fz', kind: 'fishing', name: '기장 보호수면(가상)', poly: rect(35.1850, 129.2500, 35.2200, 129.2900), report: '수산 당국·해경' });
        S.contacts.push(contact({ label: '미식별 어선', ident: '소형 어선, 그물 투망 정황', note: '보호수면 안에서 조업', route: [P(35.235, 129.320), P(35.2080, 129.2780)], sog: 3, loiter: true, spawnAt: 30, exit: P(35.250, 129.340) }));
      },
      check() { const c = S.contacts[0]; if ((c.evidence || 0) >= 120 && c.repAt != null) return ['pass', '탐지·통보 · 증거 영상 ' + Math.round(c.evidence) + '초']; if (S.t > 3 * 3600) return ['fail', '3시간 안에 증거 확보 못 함']; },
      actions: [['추적 감시', 'track']],
    },
    // ---- 해양오염감시(B) ----
    'pollution-haeundae': {
      group: '해양오염감시', model: 'B', title: '해운대 앞바다 유출유 감시', reqs: 'B 자율 순항 · B 관측 센서 · IF-10',
      steps: ['B-01이 동백섬 남쪽에서 출발', '해운대 앞 관측 구역을 경로점으로 자율 순항', '유출유 의심 징후 감지 시 해수부·해경 경보'],
      criteria: '순항 중 유출유 감지·보고', view: [35.135, 129.160, 13],
      setup() { addVessel('B', 'B-01', P(35.1490, 129.1600), 180, lawn(35.1420, 35.1200, 129.1500, 129.1740, 5)); S.oil = { c: P(35.1270, 129.1600), rx: 380, ry: 220, rot: 0.6, name: '해운대 앞바다' }; },
      check() { if (S.oil.reported) return ['pass', '임무 ' + Math.floor(S.t / 60) + '분에 감지·보고']; const b = V('B'); if (b.mode === 'HOLD' && b.wi >= b.wps.length) return ['fail', '경로를 마쳤으나 감지 못 함']; },
      actions: [],
    },
    'pollution-gamcheon': {
      group: '해양오염감시', model: 'B', title: '감천항 앞 선박 기름 배출 감시', reqs: 'B 관측 센서 · IF-10',
      steps: ['B-01이 감천항 입구 바깥을 반복 순찰', '2분 뒤 정박 대기 선박 주변에 유막 발생(가상)', 'EO 영상 분석으로 감지 → 해경 상황실 보고'],
      criteria: '유막 발생 후 15분 이내 감지·보고', view: [35.052, 129.000, 13],
      setup() { addVessel('B', 'B-01', P(35.0560, 129.0200), 250, [P(35.0520, 129.0080), P(35.0520, 128.9880), P(35.0450, 128.9880), P(35.0450, 129.0080)], true); this.oilAt = 120; },
      check() { if (!S.oil && S.t >= this.oilAt) { S.oil = { c: P(35.0495, 128.9960), rx: 260, ry: 140, rot: -0.3, name: '감천항 앞' }; log('훈련', 'i', '정박 대기 선박 주변 유막 발생(가상)'); } if (S.oil && S.oil.reported) { const lag = S.oil.repAt - this.oilAt; return lag <= 900 ? ['pass', '발생 ' + Math.max(1, Math.round(lag / 60)) + '분 안에 감지·보고'] : ['fail', '감지 지연 ' + Math.round(lag / 60) + '분']; } if (S.oil && S.t - this.oilAt > 900) return ['fail', '15분 안에 감지 못 함']; },
      actions: [],
    },
    // ---- 국가중요시설 순찰(D) ----
    'facility-port': {
      group: '국가중요시설 순찰', model: 'D', title: '부산항 북항 부두 보안구역 경계', reqs: 'D 탐지·식별 · 경계구역 · 비살상 대응 · IF-10',
      steps: ['D-01이 북항 진입 항로 바깥(방파제 남쪽)을 반복 순찰', '1분 뒤 AIS를 끈 선박이 외해에서 북항 부두로 접근', '진입 전 레이더 탐지 → 진입 시 보안관제센터 자동 보고', '‘추적 감시’ 후 1.5km 안에서 ‘경고 방송’'],
      criteria: '진입 1분 이상 전 탐지 + 진입 즉시 보고 + 경고 후 이탈', view: [35.085, 129.105, 13],
      setup() {
        addVessel('D', 'D-01', P(35.0820, 129.0965), 120, PORT_PATROL, true);
        S.zones.push({ id: 'port', kind: 'nogo', name: '북항 부두 보안구역(가상)', poly: [P(35.1030, 129.0830), P(35.1005, 129.0965), P(35.0925, 129.0945), P(35.0950, 129.0815)], buffer: 600, report: '부산항 보안관제센터·해경' });
        S.contacts.push(contact({ label: '미식별 선박', ident: '소형 고속정 추정', note: '외해 → 북항 입구 → 부두', route: [P(35.040, 129.175), P(35.0700, 129.1150), HARBOR_GAP, P(35.0975, 129.0890)], sog: 6, loiter: true, spawnAt: 60, exit: P(35.000, 129.200) }));
      },
      check() { return intrusionCheck(S.contacts[0], 60); },
      actions: [['추적 감시', 'track'], ['📢 경고 방송·탐조등', 'warn']],
    },
    'facility-gori': {
      group: '국가중요시설 순찰', model: 'D', title: '고리원전 앞 해역 경계', reqs: 'D 상시 경계 · 탐지·식별 · 경계구역 · IF-10',
      steps: ['D-01이 고리원전 앞 해역 바깥 둘레를 반복 순찰', '야간에 AIS를 끈 선박이 북동쪽 외해에서 접근', '진입 2분 이상 전 탐지 → 원전 보안관제·해경 보고', '경고 방송으로 이탈 유도'],
      criteria: '진입 2분 이상 전 탐지 + 진입 즉시 보고 + 경고 후 이탈', view: [35.322, 129.328, 13],
      setup() {
        addVessel('D', 'D-01', P(35.3020, 129.3200), 20, [P(35.3050, 129.3320), P(35.3400, 129.3320), P(35.3400, 129.3450), P(35.3050, 129.3450)], true);
        S.zones.push({ id: 'npp', kind: 'nogo', name: '고리원전 앞 경계구역(가상)', poly: [P(35.3340, 129.3170), P(35.3340, 129.3250), P(35.3140, 129.3250), P(35.3140, 129.3080), P(35.3210, 129.3125)], buffer: 800, report: '원전 보안관제센터·해경' });
        S.contacts.push(contact({ label: '미식별 선박', ident: '소형 선박, 등화 소등', note: '북동 외해 → 원전 앞', route: [P(35.380, 129.400), P(35.3240, 129.3200)], sog: 5, loiter: true, spawnAt: 60, exit: P(35.400, 129.420) }));
      },
      check() { return intrusionCheck(S.contacts[0], 120); },
      actions: [['추적 감시', 'track'], ['📢 경고 방송·탐조등', 'warn']],
    },
    // ---- 해상통제소 ----
    'mcs-offshore': {
      group: '해상통제소', model: 'B', title: '외해 관측 · 해상통제소 인계', reqs: 'COM-03 · COM-04 · 해상통제소',
      steps: ['B-01이 해운대 앞에서 외해 관측 지점(약 25km)으로 출발', '해상통제소(지원함)가 먼저 외해 대기 지점으로 이동', '연안 LTE(지상통제소 15km) 밖에서 통제권이 해상통제소로 자동 인계', '두절 없이 최종 관측 지점 도달'],
      criteria: '통제권 자동 인계 + 두절 2초 미만 + 최종 지점 도달', view: [35.070, 129.200, 11],
      setup() {
        addVessel('B', 'B-01', P(35.1490, 129.1600), 150, [P(35.1150, 129.1850), P(35.0700, 129.2400), P(35.0300, 129.2900), P(35.0050, 129.3250)]);
        S.mcs = { escort: 'B-01', sog: 0, cog: 135, ...P(35.1400, 129.1750) };
        log('MCS', 'i', '해상통제소(지원함) 출항 · B-01 호위 시작');
      },
      check() { const b = V('B'); if (b.lostMax >= 2) return ['fail', '링크 두절 ' + Math.round(b.lostMax) + '초']; if (b.mode === 'HOLD' && b.wi >= b.wps.length) return b.link && b.link.st === 'MCS' ? ['pass', '해상통제소 통제로 지상통제소에서 ' + (dist(b, GCS) / 1000).toFixed(1) + 'km 지점 도달 · 두절 0초'] : ['fail', '외해 지점에서 해상통제소 통제가 아님']; },
      actions: [['통제권 → 해상통제소', 'toMCS'], ['통제권 → 지상통제소', 'toGCS']],
    },
    'mcs-nolink': {
      group: '해상통제소', model: 'B', title: '해상통제소 없이 외해 진출(두절 안전 동작)', reqs: 'COM-04',
      steps: ['같은 외해 관측 임무를 해상통제소 없이 수행', '연안 LTE 범위를 벗어나면 통제 링크 두절', '15초 뒤 안전 동작(정지·표류) 확인'],
      criteria: '두절 후 15초+1초 이내 안전 동작', view: [35.070, 129.200, 11],
      setup() { addVessel('B', 'B-01', P(35.1490, 129.1600), 150, [P(35.1150, 129.1850), P(35.0700, 129.2400), P(35.0300, 129.2900), P(35.0050, 129.3250)]); },
      check() { const b = V('B'); if (b.failsafe) return b.lostMax <= 16.5 ? ['pass', '두절 ' + Math.round(b.lostMax) + '초 뒤 정지·표류'] : ['fail', '안전 동작 지연']; },
      actions: [],
    },
    // ---- 1인 다척 ----
    'fleet': {
      group: '1인 다척', model: 'ABD', title: '광안리·해운대·북항 3척 동시 운용', reqs: 'COM-09',
      steps: ['A·B·D 3척이 광안리·해운대·북항에서 동시 자율 운항', '운용자 1명이 선단 목록·경보로만 감시', '3척이 5분 연속 자율 운항 유지'],
      criteria: '3척 동시 자율 운항 5분 연속', view: [35.112, 129.130, 12],
      setup() {
        addVessel('A', 'A-01', P(35.1490, 129.1380), 200, lawn(35.1450, 35.1375, 129.1270, 129.1380, 4), true);
        addVessel('B', 'B-01', P(35.1490, 129.1600), 180, lawn(35.1420, 35.1200, 129.1500, 129.1740, 5), true);
        addVessel('D', 'D-01', P(35.0820, 129.0965), 120, PORT_PATROL, true);
        S.sel = 'D-01'; this.since = 0;
      },
      check() { const ok = S.vessels.every((v) => v.mode === 'AUTO' && v.link); if (!ok) { this.since = S.t; return S.t > 60 ? ['fail', '자율 운항 또는 링크 중단'] : undefined; } if (S.t - this.since >= 300) return ['pass', '3척 동시 자율 운항 5분 유지']; },
      actions: [],
    },
  };

  // ---------- 지도 어댑터: Google Maps(키 있을 때) / Leaflet(OpenStreetMap·Esri) ----------
  const MAP = { kind: null, objs: {} };
  const boatSvg = (color, hdg, size = 22) => '<svg width="' + size + '" height="' + size + '" viewBox="-12 -12 24 24" style="transform:rotate(' + hdg + 'deg)"><path d="M0 -11 L6 2 L5 10 L-5 10 L-6 2 Z" fill="' + color + '" stroke="#fff" stroke-width="1.6"/></svg>';
  function initLeaflet(el) {
    MAP.kind = 'leaflet';
    const m = L.map(el, { zoomControl: true }).setView([35.115, 129.115], 12);
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap 기여자' });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri World Imagery' });
    sat.addTo(m); L.control.layers({ '위성(Esri)': sat, '지도(OpenStreetMap)': osm }, {}, { position: 'topright' }).addTo(m);
    MAP.m = m;
    MAP.view = (lat, lon, z) => m.setView([lat, lon], z);
    MAP.pan = (ll) => m.panTo([ll.lat, ll.lon]);
    MAP.boat = (id, ll, hdg, color, label, red) => {
      let o = MAP.objs[id];
      if (!o) { o = L.marker([ll.lat, ll.lon], { icon: L.divIcon({ className: '', html: '<div class="boat">' + boatSvg(color, hdg) + '</div>', iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 1000 }).addTo(m); o.bindTooltip(label, { permanent: true, direction: 'right', offset: [12, 0], className: 'lbl' + (red ? ' red' : '') }); MAP.objs[id] = o; }
      o.setLatLng([ll.lat, ll.lon]); const svg = o.getElement() && o.getElement().querySelector('svg'); if (svg) svg.style.transform = 'rotate(' + hdg + 'deg)';
      if (o.getTooltip().getContent() !== label) o.setTooltipContent(label);
    };
    MAP.line = (id, pts, color, dash, w = 2, op = 0.9) => { let o = MAP.objs[id]; const ll = pts.map((p) => [p.lat, p.lon]); if (!o) { o = L.polyline(ll, { color, weight: w, dashArray: dash ? '6 6' : null, opacity: op, interactive: false }).addTo(m); MAP.objs[id] = o; } else o.setLatLngs(ll); };
    MAP.poly = (id, pts, color, fillOp = 0.15) => { let o = MAP.objs[id]; const ll = pts.map((p) => [p.lat, p.lon]); if (!o) { o = L.polygon(ll, { color, weight: 2, fillOpacity: fillOp, interactive: false }).addTo(m); MAP.objs[id] = o; } else o.setLatLngs(ll); };
    MAP.circle = (id, ll, r, color, dash) => { let o = MAP.objs[id]; if (!o) { o = L.circle([ll.lat, ll.lon], { radius: r, color, weight: 1.2, fill: false, dashArray: dash ? '4 6' : null, interactive: false }).addTo(m); MAP.objs[id] = o; } else { o.setLatLng([ll.lat, ll.lon]); o.setRadius(r); } };
    MAP.dot = (id, ll, color, label, r = 6) => { let o = MAP.objs[id]; if (!o) { o = L.circleMarker([ll.lat, ll.lon], { radius: r, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1 }).addTo(m); if (label) o.bindTooltip(label, { permanent: true, direction: 'right', offset: [8, 0], className: 'lbl' }); MAP.objs[id] = o; } else o.setLatLng([ll.lat, ll.lon]); };
    MAP.remove = (id) => { const o = MAP.objs[id]; if (o) { m.removeLayer(o); delete MAP.objs[id]; } };
    MAP.clear = () => Object.keys(MAP.objs).forEach(MAP.remove);
  }
  function initGoogle(el) {
    MAP.kind = 'google';
    const g = google.maps;
    const m = new g.Map(el, { center: { lat: 35.115, lng: 129.115 }, zoom: 12, mapTypeId: 'hybrid', streetViewControl: false, fullscreenControl: false });
    MAP.m = m;
    MAP.view = (lat, lon, z) => { m.setCenter({ lat, lng: lon }); m.setZoom(z); };
    MAP.pan = (ll) => m.panTo({ lat: ll.lat, lng: ll.lon });
    const ic = (color, hdg) => ({ path: 'M0 -11 L6 2 L5 10 L-5 10 L-6 2 Z', fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5, scale: 1.1, rotation: hdg, anchor: new g.Point(0, 0), labelOrigin: new g.Point(26, 0) });
    MAP.boat = (id, ll, hdg, color, label, red) => { let o = MAP.objs[id]; const pos = { lat: ll.lat, lng: ll.lon }; if (!o) { o = new g.Marker({ position: pos, map: m, icon: ic(color, hdg), label: { text: label, color: red ? '#ff7875' : '#ffffff', fontSize: '11px', fontWeight: '700' }, zIndex: 1000 }); MAP.objs[id] = o; } else { o.setPosition(pos); o.setIcon(ic(color, hdg)); const lb = o.getLabel(); if (lb.text !== label) o.setLabel({ ...lb, text: label }); } };
    MAP.line = (id, pts, color, dash, w = 2, op = 0.9) => { let o = MAP.objs[id]; const path = pts.map((p) => ({ lat: p.lat, lng: p.lon })); if (!o) { o = new g.Polyline({ path, map: m, strokeColor: color, strokeOpacity: dash ? 0 : op, strokeWeight: w, icons: dash ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: op, strokeColor: color, scale: 2 }, offset: '0', repeat: '10px' }] : null, clickable: false }); MAP.objs[id] = o; } else o.setPath(path); };
    MAP.poly = (id, pts, color, fillOp = 0.15) => { let o = MAP.objs[id]; const paths = pts.map((p) => ({ lat: p.lat, lng: p.lon })); if (!o) { o = new g.Polygon({ paths, map: m, strokeColor: color, strokeWeight: 2, fillColor: color, fillOpacity: fillOp, clickable: false }); MAP.objs[id] = o; } else o.setPaths(paths); };
    MAP.circle = (id, ll, r, color) => { let o = MAP.objs[id]; const c = { lat: ll.lat, lng: ll.lon }; if (!o) { o = new g.Circle({ center: c, radius: r, map: m, strokeColor: color, strokeWeight: 1, strokeOpacity: 0.7, fillOpacity: 0, clickable: false }); MAP.objs[id] = o; } else { o.setCenter(c); o.setRadius(r); } };
    MAP.dot = (id, ll, color, label, r = 6) => { let o = MAP.objs[id]; const pos = { lat: ll.lat, lng: ll.lon }; if (!o) { o = new g.Marker({ position: pos, map: m, icon: { path: g.SymbolPath.CIRCLE, scale: r, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5, labelOrigin: new g.Point(4, 0) }, label: label ? { text: label, color: '#fff', fontSize: '11px' } : null }); MAP.objs[id] = o; } else o.setPosition(pos); };
    MAP.remove = (id) => { const o = MAP.objs[id]; if (o) { o.setMap(null); delete MAP.objs[id]; } };
    MAP.clear = () => Object.keys(MAP.objs).forEach(MAP.remove);
  }
  async function initMap() {
    const el = document.getElementById('map');
    let key = null;
    if (location.protocol.startsWith('http')) { try { const r = await fetch('../api/config'); if (r.ok && (r.headers.get('content-type') || '').includes('json')) key = (await r.json()).googleMapsKey || null; } catch (e) { /* 서버 없음 */ } }
    if (key) {
      try {
        await new Promise((res, rej) => { window.__gmReady = res; const s = document.createElement('script'); s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&callback=__gmReady&language=ko&region=KR'; s.onerror = rej; document.head.append(s); setTimeout(() => rej(new Error('timeout')), 12000); });
        initGoogle(el); document.getElementById('engine').textContent = '지도: Google Maps(위성+지명)'; return;
      } catch (e) { console.warn('Google Maps 실패 → OpenStreetMap', e); }
    }
    initLeaflet(el);
    document.getElementById('engine').textContent = key ? '지도: OpenStreetMap·Esri(Google 불러오기 실패)' : '지도: OpenStreetMap·Esri 위성(Google Maps 키 미설정)';
  }

  // ---------- 그리기 ----------
  function drawStatic() {
    MAP.clear();
    MAP.dot('gcs', toLL(GCS), '#e6edf3', '지상통제소', 6);
    LTE_SITES.forEach((s, i) => MAP.dot('lte' + i, toLL(s), '#4fa3ff', i === 0 ? 'LTE 기지국(가정)' : '', 3));
    S.zones.forEach((z) => { const col = z.kind === 'fishing' ? '#faad14' : '#ff4d4f'; MAP.poly('z-' + z.id, z.poly.map(toLL), col, 0.18); MAP.dot('zl-' + z.id, toLL(center(z.poly)), col, z.name, 3); });
  }
  function draw() {
    S.vessels.forEach((v) => {
      const red = Object.values(S.alarms).some((a) => a.who === v.id && a.lv === 'c');
      MAP.boat(v.id, toLL(v), v.hdg, v.m.color, v.id + ' ' + (v.spd * 1.944).toFixed(1) + 'kn', red);
      MAP.line('tr-' + v.id, v.trail.concat([{ x: v.x, y: v.y }]).map(toLL), v.m.color, false, 2, 0.5);
      if (v.mode === 'AUTO' && v.wps.length) MAP.line('wp-' + v.id, [{ x: v.x, y: v.y }].concat(v.wps.slice(v.wi), v.loop ? v.wps.slice(0, v.wi) : []).map(toLL), '#ffd666', true, 1.5, 0.8); else MAP.remove('wp-' + v.id);
      if (v.m.radar) MAP.circle('rd-' + v.id, toLL(v), v.m.radar, '#9b8cff', true);
      if (v.link) MAP.line('ln-' + v.id, [toLL(v.link.st === 'MCS' ? S.mcs : GCS), toLL(v)], v.link.st === 'MCS' ? '#73d13d' : '#4fa3ff', false, 1.2, 0.55); else MAP.remove('ln-' + v.id);
    });
    if (S.mcs) { MAP.boat('mcs', toLL(S.mcs), S.mcs.cog || 0, '#73d13d', '해상통제소(지원함)'); MAP.circle('mcsR', toLL(S.mcs), MESH_R, '#73d13d', true); }
    S.ais.forEach((a, i) => MAP.boat('ais' + i, toLL(a), a.cog || 0, '#d3adf7', a.name + ' · ' + a.type));
    S.contacts.forEach((c) => { if (!c.gone && c.seenAt != null && S.t - c.seenAt < 15) MAP.boat('c-' + c.id, toLL(c), c.cog || 0, '#ff4d4f', c.label + (c.leaving ? ' · 이탈' : ''), true); else MAP.remove('c-' + c.id); });
    if (S.piw && S.piw.det) MAP.dot('piw', toLL({ x: S.piw.dx, y: S.piw.dy }), S.piw.rescued ? '#52c41a' : '#ff4d4f', S.piw.rescued ? '요구조자(부이 전달)' : S.piw.label, 7);
    if (S.oil && S.oil.reported && !MAP.objs.oil) { const o = S.oil, pts = []; for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2, lx = Math.cos(a) * o.rx, ly = Math.sin(a) * o.ry; pts.push(toLL({ x: o.c.x + lx * Math.cos(o.rot) - ly * Math.sin(o.rot), y: o.c.y + lx * Math.sin(o.rot) + ly * Math.cos(o.rot) })); } MAP.poly('oil', pts, '#ffaa00', 0.35); }
  }

  // ---------- 패널 ----------
  const $ = (id) => document.getElementById(id);
  function renderPanel() {
    const sc = S.scn, r = S.result, st = r ? r[0] : 'running', lbl = { running: '진행 중', pass: '합격', fail: '불합격' }[st];
    $('scnBox').innerHTML = '<h3>' + esc(sc.title) + ' <small>' + esc(sc.group) + ' · ' + esc(sc.reqs) + '</small></h3><ol>' + sc.steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>' +
      '<div class="hint">합격 기준: ' + esc(sc.criteria) + '</div><div class="res ' + st + '">' + lbl + '<small>' + esc(r ? r[1] : '시험 진행 중…') + '</small></div>' +
      '<div class="btns">' + sc.actions.map(([t, a]) => '<button data-a="' + a + '">' + t + '</button>').join('') + '<button data-a="restart">다시 시작</button>' +
      (S.center ? '<button data-a="save" ' + (r ? '' : 'disabled') + '>what\'s next에 기록 저장</button>' : '') + '<span class="hint" id="saveMsg"></span></div>';
  }
  function renderSide() {
    $('fleet').innerHTML = S.vessels.map((v) => '<div class="vrow ' + (S.sel === v.id ? 'sel' : '') + '" data-v="' + v.id + '"><span><b style="background:' + v.m.color + '"></b>' + v.id + ' ' + esc(v.m.name) + '</span><span class="m">' +
      (v.link ? '통제 ' + STN[v.link.st] + '(' + v.link.via + ')' : '<span style="color:#ff4d4f">두절</span>') + ' · ' + (v.mode === 'AUTO' ? (v.track ? '추적' : '자율') : '정지') + ' · ' + (v.spd * 1.944).toFixed(1) + 'kn · 🔋' + Math.round(v.batt / v.m.battWh * 100) + '%' + (v.m.radar || v.m.eo ? ' · 접촉 ' + v.contacts.length : '') + '</span></div>').join('') +
      (S.mcs ? '<div class="vrow"><span><b style="background:#73d13d"></b>해상통제소(지원함)</span><span class="m">메시 6km · ' + (S.mcs.sog * 1.944).toFixed(1) + 'kn</span></div>' : '');
    const al = Object.values(S.alarms);
    $('alarms').innerHTML = al.length ? al.map((a) => '<div class="alarm ' + (a.lv === 'c' ? 'crit' : 'warn') + '"><b>' + esc(a.who) + '</b> ' + esc(a.msg) + '</div>').join('') : '<div class="hint">활성 경보 없음</div>';
    $('events').innerHTML = S.events.slice(0, 80).map((e) => '<div class="' + e.lv + '">' + fmtT(e.t) + ' <b>' + esc(e.who) + '</b> ' + esc(e.msg) + '</div>').join('');
    $('clock').textContent = fmtT(S.t);
  }
  function act(a) {
    const v = S.vessels.find((q) => q.id === S.sel) || S.vessels[0];
    const need = (q) => { if (!q.link) { log(q.id, 'w', '명령 전송 실패(링크 없음)'); return false; } return true; };
    if (a === 'restart') start(S.scn.id);
    if (a === 'track') {
      const d = V('D') || V('B') || v, c = S.contacts.find((q) => !q.gone && q.seenAt != null);
      if (!c) log(d.id, 'w', '추적할 미식별 접촉이 없습니다'); else if (need(d)) { d.track = d.track ? null : c.id; if (!d.track) { d.wps = d.patrol.slice(); d.wi = 0; d.loop = d.patrol.length > 1; } log(d.id, 'i', d.track ? c.label + ' 추적 감시' : '추적 해제 · 순찰 복귀'); }
    }
    if (a === 'warn') {
      const d = V('D'), c = S.contacts.find((q) => !q.gone && q.seenAt != null);
      if (need(d)) { d.warnUntil = S.t + 60; if (c && dist(d, c) <= 1500) { if (c.warnedAt == null) c.warnedAt = S.t; log(d.id, 'i', '경고 방송: "통제 해역입니다. 즉시 이탈하십시오." · 탐조등 (' + Math.round(dist(d, c)) + 'm)'); } else log(d.id, 'w', '경고 방송 — 대상이 1.5km 밖'); }
    }
    if (a === 'goto') { const A = V('A'); if (!need(A)) return; if (S.piw && S.piw.det) { A.wps = [{ x: S.piw.dx, y: S.piw.dy }]; A.wi = 0; A.loop = false; A.mode = 'AUTO'; log(A.id, 'i', '탐지 지점으로 이동'); } else log(A.id, 'w', '아직 탐지되지 않음'); }
    if (a === 'buoy') { const A = V('A'); if (A.buoy || !need(A)) return; A.buoy = true; const d = dist(A, S.piw); if (d < 40) { S.piw.rescued = true; log(A.id, 'i', '구조부이 전달 완료(' + Math.round(d) + 'm)'); } else { S.flags.buoyFail = true; log(A.id, 'w', '구조부이 분리 — 요구조자와 ' + Math.round(d) + 'm'); } }
    if (a === 'toMCS' || a === 'toGCS') { v.pref = a === 'toMCS' ? 'MCS' : 'GCS'; log(v.id, 'i', '운용자: ' + STN[v.pref] + ' 우선 통제 지정'); }
  }
  document.addEventListener('click', async (e) => {
    const vb = e.target.closest('[data-v]'); if (vb) { S.sel = vb.dataset.v; const v = S.vessels.find((q) => q.id === S.sel); if (v && MAP.pan) MAP.pan(toLL(v)); }
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'save') { try { await save(); $('saveMsg').textContent = '저장됨 ✓'; } catch (err) { $('saveMsg').textContent = err.message; } return; }
    act(b.dataset.a); renderPanel(); renderSide();
  });
  async function save() {
    const r = S.result, id = 'busan-' + S.scn.id + '-' + Date.now();
    const body = { scenario: 'busan-' + S.scn.id, title: '[부산 실지도] ' + S.scn.title, reqs: S.scn.reqs, stage: '실해역 리허설(부산 지도) · ' + S.scn.group, criteria: S.scn.criteria, result: r[0] === 'pass' ? '합격' : '불합격', detail: r[1], simTime: +S.t.toFixed(1), savedAt: new Date().toISOString(), source: 'busan-map', log: S.events.slice(0, 40).reverse().map((e) => e.t.toFixed(0) + 's ' + e.who + ' ' + e.msg) };
    const res = await fetch('../api/db/simruns/' + encodeURIComponent(id), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('저장 실패(' + res.status + ')');
  }

  // ---------- 실행 ----------
  function start(id) {
    Object.assign(S, { t: 0, vessels: [], contacts: [], zones: [], events: [], alarms: {}, piw: null, oil: null, mcs: null, result: null, sel: null, flags: {} });
    S.scn = Object.assign(Object.create(SCN[id]), { id });
    seedAIS(); S.scn.setup.call(S.scn);
    if (MAP.clear) { drawStatic(); if (S.scn.view) MAP.view(...S.scn.view); }
    log('GCS', 'i', '시나리오 시작: ' + S.scn.title);
    try { const q = new URLSearchParams(location.search); q.set('scenario', id); history.replaceState(null, '', '?' + q); } catch (e) { /* 무시 */ }
    if ($('scnBox')) { renderPanel(); renderSide(); }
  }
  function step(dt) {
    S.dt = dt; S.t += dt;
    S.ais.forEach((a) => moveOnRoute(a, dt, true));
    stepMCS(dt); S.vessels.forEach((v) => stepVessel(v, dt)); stepLinks(); stepSensors(); stepContacts(dt); stepRescueOil(dt);
    if (!S.result) { const r = S.scn.check.call(S.scn); if (r) { S.result = r; log('GCS', r[0] === 'pass' ? 'i' : 'c', '시나리오 ' + (r[0] === 'pass' ? '합격' : '불합격') + ': ' + r[1]); if ($('scnBox')) renderPanel(); } }
  }
  window.BUSAN = { S, SCN, MAP, step, start, act, toLL, P, dist };

  (async function main() {
    const sel = $('scn');
    const groups = {}; Object.entries(SCN).forEach(([id, s]) => { (groups[s.group] = groups[s.group] || []).push([id, s]); });
    Object.entries(groups).forEach(([g, list]) => { const og = document.createElement('optgroup'); og.label = g; list.forEach(([id, s]) => og.append(new Option(s.title, id))); sel.append(og); });
    sel.addEventListener('change', () => start(sel.value));
    $('speed').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; const ts = +b.dataset.ts; if (ts === 0) S.paused = !S.paused; else { S.ts = ts; S.paused = false; } [...$('speed').children].forEach((x) => x.classList.toggle('on', S.paused ? x.dataset.ts === '0' : +x.dataset.ts === S.ts)); });
    if (location.protocol.startsWith('http')) { try { const r = await fetch('../api/db/simruns'); S.center = r.ok && (r.headers.get('content-type') || '').includes('json'); } catch (e) { /* 서버 없음 */ } }
    if (S.center) $('toSim').insertAdjacentHTML('afterend', ' <a href="../#sim" target="_top">← 수상드론 what\'s next</a>');
    await initMap();
    const id = new URLSearchParams(location.search).get('scenario'); sel.value = SCN[id] ? id : 'facility-port'; start(sel.value);
    let last = performance.now(), acc = 0, ui = 0;
    (function loop(now) {
      const real = Math.min(0.25, (now - last) / 1000); last = now;
      if (!S.paused) { acc += real * S.ts; while (acc >= 0.2) { step(0.2); acc -= 0.2; } }
      ui += real; if (ui > 0.3) { ui = 0; draw(); renderSide(); }
      requestAnimationFrame(loop);
    })(last);
  })();
})();
