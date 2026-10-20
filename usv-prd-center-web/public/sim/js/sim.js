// 선체·환경 시뮬레이션: 운항, 전원, 열관리, 통신 이중화, 안전 동작, 상태감시, 기록
(function () {
  const G = window.GCS;
  const D2R = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrap180 = (a) => ((a + 540) % 360) - 180;
  const wrap360 = (a) => ((a % 360) + 360) % 360;
  const bearing = (ax, ay, bx, by) => wrap360(Math.atan2(bx - ax, by - ay) / D2R);
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  G.util = { clamp, wrap180, wrap360, bearing, dist };

  const S = G.state = {
    t: 0,               // 시뮬레이션 시각(초)
    timeScale: 1,
    paused: false,
    vessels: [],
    events: [],         // 전 임무 이벤트 로그 (COM-08)
    telemetry: [],      // 1초 주기 운항·상태 기록 (COM-08)
    ais: [],
    piw: { x: 2100, y: -1900, detected: false, rescued: false }, // 요구조자(person in water)
    oil: { x: -3400, y: -4200, rx: 650, ry: 360, rot: 0.5, reported: false },
    buoys: [],
    selectedId: null,
    listeners: [],
  };

  // ---------- 이벤트·경보 ----------
  G.log = function (v, level, msg) {
    const e = { t: S.t, id: v ? v.id : 'GCS', level, msg };
    S.events.push(e);
    if (S.events.length > 5000) S.events.shift();
    S.listeners.forEach((fn) => fn(e));
  };

  function setAlarm(v, key, active, level, msg) {
    const cur = v.alarms[key];
    if (active && !cur) {
      v.alarms[key] = { level, msg, since: S.t, ack: false };
      G.log(v, level, msg);
    } else if (active && cur) {
      cur.msg = msg;
      if (cur.level !== level) { cur.level = level; cur.ack = false; G.log(v, level, msg); }
    } else if (!active && cur) {
      delete v.alarms[key];
      G.log(v, 'info', `해제: ${cur.msg}`);
    }
  }
  G.setAlarm = setAlarm;

  // ---------- 선체 생성 ----------
  let seq = { A: 0, B: 0, C: 0, D: 0 };
  G.addVessel = function (code, x, y) {
    const m = G.MODELS[code];
    seq[code]++;
    const id = `${code}-${String(seq[code]).padStart(2, '0')}`;
    const pdu = {};
    m.channels.forEach((c) => (pdu[c] = { on: true, amps: 0, trip: false }));
    const links = {};
    m.links.forEach((l, i) => (links[l] = { prio: i + 1, forcedDown: false, up: false, rssi: null, latency: null, hops: 0 }));
    const v = {
      id, code, m, name: `${m.short}-${String(seq[code]).padStart(2, '0')}`,
      x, y, hdg: 180, spd: 0, throttle: 0, rudder: 0,
      manual: { throttle: 0, rudder: 0 },
      mode: 'HOLD', wps: [], wpIdx: 0,
      battWh: m.batteryWh, soc: 1, volt: 54, amps: 0, powerW: 0, powerAvg: 300,
      enc: { temp: G.ENV.ambientC + 2, rh: 42, leak: false, coolerOn: false },
      faults: { leak: false, cooling: false, gnss: false, cell: false },
      est: { ex: 0, ey: 0, unc: 3 },
      pdu, links, activeLink: null, linkLostAt: null, failsafeFired: false,
      failsafe: { timeout: 15, action: 'RTL' },
      aisTx: m.aisTx,
      alarms: {}, trail: [], lastTrail: 0, lastRec: 0,
      avoid: null, buoyReleased: false, bit: null,
      metocean: null, oilHit: false,
      bay: { power: true, eth: true, can: true, latch: true },
      loop: m.features.includes('patrol'), tracking: false, spkUntil: 0, contacts: [],
    };
    S.vessels.push(v);
    G.log(v, 'info', `${m.name} 선체 등록 (${id})`);
    if (!S.selectedId) S.selectedId = id;
    return v;
  };

  G.selected = () => S.vessels.find((v) => v.id === S.selectedId) || null;

  // ---------- AIS 주변 선박 ----------
  function seedAIS() {
    S.ais = [
      { name: 'HANJIN STAR', mmsi: '440123450', x: -9000, y: -2600, cog: 92, sog: 6.5, type: '화물선' },
      { name: 'BUSAN FERRY 3', mmsi: '440778120', x: 7000, y: -6200, cog: 280, sog: 8.0, type: '여객선' },
      { name: '해양호', mmsi: '440551007', x: -2000, y: -6800, cog: 15, sog: 3.0, type: '어선' },
      { name: 'OCEAN PEARL', mmsi: '538009871', x: 3500, y: -1200, cog: 235, sog: 5.0, type: '유조선' },
    ];
  }
  function stepAIS(dt) {
    S.ais.forEach((a) => {
      a.x += Math.sin(a.cog * D2R) * a.sog * dt;
      a.y += Math.cos(a.cog * D2R) * a.sog * dt;
      if (Math.abs(a.x) > 16000 || a.y < -16000 || G.isLand(a.x, a.y + 300)) {
        a.cog = wrap360(a.cog + 180);
        a.x += Math.sin(a.cog * D2R) * 50; a.y += Math.cos(a.cog * D2R) * 50;
      }
    });
  }

  // ---------- 명령(링크가 있어야 전송 가능) ----------
  G.command = function (v, label, fn) {
    if (!v.activeLink) {
      G.log(v, 'warn', `명령 전송 실패(링크 없음): ${label}`);
      return false;
    }
    G.log(v, 'cmd', `[${v.activeLink}] ${label}`);
    fn();
    return true;
  };

  G.setMode = function (v, mode) {
    return G.command(v, `모드 → ${G.MODES[mode]}`, () => {
      if (v.mode === 'ESTOP' && mode !== 'ESTOP') return;
      if (mode === 'AUTO' && v.wps.length === 0) { G.log(v, 'warn', '경로점이 없어 자율 모드를 시작할 수 없습니다'); return; }
      if (mode === 'AUTO' && v.wpIdx >= v.wps.length) v.wpIdx = 0;
      if (mode === 'MANUAL') { v.manual.throttle = 0; v.manual.rudder = 0; }
      v.mode = mode;
      v.failsafeFired = false;
    });
  };

  G.estop = function (v) {
    // 물리 스위치 + 원격 차단: 원격은 링크 필요
    return G.command(v, '비상 차단(추진 전원 차단)', () => {
      v.mode = 'ESTOP';
      if (v.pdu.PROP) v.pdu.PROP.on = false;
    });
  };
  G.estopReset = function (v) {
    return G.command(v, '비상 차단 해제', () => {
      v.mode = 'HOLD';
      if (v.pdu.PROP) v.pdu.PROP.on = true;
    });
  };

  // ---------- 해상통제소(MCS): 지원함에 탑재한 이동형 통제소. 호위 대상 선체를 따라 1.5km 앞서 이동 ----------
  G.STATIONS = { GCS: '지상통제소', MCS: '해상통제소' };
  S.mcs = { active: false, x: G.HOME.x + 300, y: G.HOME.y - 200, hdg: 180, spd: 0, escort: null, trail: [] };
  function stepMCS(dt) {
    const M = S.mcs; if (!M.active) return;
    const v = S.vessels.find((q) => q.id === M.escort);
    let tgt = M.hold || { x: M.x, y: M.y };
    if (v) { const w = v.wps[v.wpIdx] || v, b = bearing(v.x, v.y, w.x, w.y) * D2R, lead = v.wps[v.wpIdx] && v.mode === 'AUTO' ? 1500 : 500; tgt = { x: v.x + Math.sin(b) * lead + 400, y: v.y + Math.cos(b) * lead }; }
    const d = dist(M.x, M.y, tgt.x, tgt.y);
    M.spd = d > 80 ? Math.min(6, 1 + d / 300) : 0;
    if (M.spd) {
      M.hdg = bearing(M.x, M.y, tgt.x, tgt.y);
      const nx = M.x + Math.sin(M.hdg * D2R) * M.spd * dt, ny = M.y + Math.cos(M.hdg * D2R) * M.spd * dt;
      if (!G.isLand(nx, ny)) { M.x = nx; M.y = ny; }
    }
    if (!M.lastTrail || S.t - M.lastTrail > 5) { M.trail.push({ x: M.x, y: M.y }); if (M.trail.length > 300) M.trail.shift(); M.lastTrail = S.t; }
  }
  // 해상통제소 배치/철수: 호위 대상을 지정하면 출항해 따라간다
  G.setMCS = function (on, escortId) {
    const M = S.mcs;
    M.active = on; M.escort = on ? escortId || null : null;
    if (on && !M.deployed) { M.deployed = true; M.x = G.HOME.x + 300; M.y = G.HOME.y - 200; M.trail = []; }
    G.log(null, on ? 'info' : 'warn', on ? `해상통제소(지원함) 배치${escortId ? ` · ${escortId} 호위` : ''}` : '해상통제소 철수');
  };

  // ---------- 링크 평가 (COM-03, IF-01~03) ----------
  function evalLinks() {
    // 메시: 지상통제소에서 시작하는 다중 홉 중계 (메시 무전기 사거리 기준 BFS)
    const R = G.LINKS.MESH.range;
    const meshNodes = S.vessels.filter((v) => v.links.MESH && !v.links.MESH.forcedDown && commOn(v));
    const hops = new Map();
    // 메시 시작점: 지상통제소 + (배치된 경우) 해상통제소. 각 선체는 어느 통제소에 이어졌는지(root)를 기록
    let frontier = [{ x: G.GCS_POS.x, y: G.GCS_POS.y, id: 'GCS' }];
    if (S.mcs && S.mcs.active) frontier.push({ x: S.mcs.x, y: S.mcs.y, id: 'MCS' });
    const rootOf = (f) => (f.id === 'GCS' || f.id === 'MCS' ? f.id : hops.get(f.id).root);
    let h = 0;
    const visited = new Set();
    while (frontier.length && h < 6) {
      h++;
      const next = [];
      meshNodes.forEach((n) => {
        if (visited.has(n.id)) return;
        // 같은 홉 거리면 해상통제소 우선 지정 선체는 해상통제소 쪽을 먼저 본다
        const fs = n.prefMCS ? frontier.slice().sort((a, b) => (rootOf(b) === 'MCS') - (rootOf(a) === 'MCS')) : frontier;
        for (const f of fs) {
          if (dist(f.x, f.y, n.x, n.y) <= R) { visited.add(n.id); hops.set(n.id, { h, via: f.id, root: rootOf(f) }); next.push(n); break; }
        }
      });
      frontier = next;
    }

    S.vessels.forEach((v) => {
      const on = commOn(v);
      for (const [name, L] of Object.entries(v.links)) {
        let up = false, rssi = null, latency = null;
        if (on && !L.forcedDown) {
          if (name === 'LTE') {
            const off = G.coastY(v.x) - v.y;
            if (off < G.LINKS.LTE.rangeOffshore) {
              up = true; rssi = Math.round(-68 - (off / G.LINKS.LTE.rangeOffshore) * 42);
              latency = Math.round(45 + off / 250);
            }
          } else if (name === 'MESH') {
            const hp = hops.get(v.id);
            if (hp) {
              up = true; L.hops = hp.h; L.via = hp.via; L.root = hp.root;
              const src = hp.via === 'GCS' ? G.GCS_POS : hp.via === 'MCS' ? S.mcs : S.vessels.find((q) => q.id === hp.via);
              const d = dist(src.x, src.y, v.x, v.y);
              rssi = Math.round(-60 - (d / R) * 35);
              latency = 20 + hp.h * 25;
            }
          } else if (name === 'SAT') {
            up = true; rssi = -102; latency = G.LINKS.SAT.latency;
          }
        }
        L.up = up; L.rssi = rssi; L.latency = latency;
      }

      // 링크 관리기: 우선순위 기반 자동 전환
      const prev = v.activeLink;
      // 해상통제소 우선 지정 시 해상통제소에 이어진 메시를 1순위로
      const rank = (n, L) => (v.prefMCS && n === 'MESH' && L.root === 'MCS' ? 0 : L.prio);
      const best = Object.entries(v.links).filter(([, L]) => L.up).sort((a, b) => rank(...a) - rank(...b))[0];
      v.activeLink = best ? best[0] : null;
      // 통제 주체: LTE·위성은 지상통제소, 메시는 이어진 통제소
      const prevCtrl = v.ctrl;
      v.ctrl = !v.activeLink ? null : v.activeLink === 'MESH' ? v.links.MESH.root : 'GCS';
      if (v.linkInit && prevCtrl && v.ctrl && prevCtrl !== v.ctrl) G.log(v, 'warn', `통제권 인계: ${G.STATIONS[prevCtrl]} → ${G.STATIONS[v.ctrl]}`);
      if (!v.linkInit) v.linkInit = true; // 진수 직후 최초 연결은 기록하지 않음
      else if (prev !== v.activeLink) {
        if (prev && v.activeLink) G.log(v, 'warn', `링크 자동 전환: ${G.LINKS[prev].name} → ${G.LINKS[v.activeLink].name}`);
        else if (!prev && v.activeLink) G.log(v, 'info', `링크 복구: ${G.LINKS[v.activeLink].name}`);
      }

      // 통신 두절 안전 동작 (COM-04)
      if (!v.activeLink) {
        if (v.linkLostAt === null) v.linkLostAt = S.t;
        delete v.alarms.linkdeg; // 두절 경보가 대신함
        const lost = S.t - v.linkLostAt;
        setAlarm(v, 'link', true, 'crit', `통신 두절 (${Math.floor(lost)}s / 안전동작 ${v.failsafe.timeout}s)`);
        if (lost >= v.failsafe.timeout && !v.failsafeFired && v.mode !== 'ESTOP') {
          v.failsafeFired = true;
          const act = v.failsafe.action;
          if (v.mode !== act) {
            v.mode = act;
            G.log(v, 'crit', `통신 두절 안전 동작 실행: ${G.MODES[act]}`);
          }
        }
      } else {
        v.linkLostAt = null;
        setAlarm(v, 'link', false);
        const backupOnly = v.activeLink !== v.m.links[0];
        setAlarm(v, 'linkdeg', backupOnly, 'warn', `예비 링크 운용 중 (${G.LINKS[v.activeLink].name})`);
      }
    });
  }
  function commOn(v) { return v.pdu.COMM && v.pdu.COMM.on; }

  // ---------- 항법 추정 (GNSS 교란 시 IMU 보조) ----------
  function stepNavEstimate(v, dt) {
    if (v.faults.gnss) {
      // 관성 항법 누적 오차
      v.est.ex += (0.06 + (Math.random() - 0.5) * 0.4) * dt;
      v.est.ey += (-0.04 + (Math.random() - 0.5) * 0.4) * dt;
      v.est.unc = Math.min(800, v.est.unc + 0.35 * dt);
    } else {
      v.est.ex *= 0.5; v.est.ey *= 0.5;
      v.est.unc = 2.5;
    }
  }
  G.estPos = (v) => ({ x: v.x + v.est.ex, y: v.y + v.est.ey });

  // ---------- 충돌 회피 (AIS 기반, CPA/TCPA) ----------
  function colavOffset(v) {
    if (!v.m.colav || !(v.pdu.MC && v.pdu.MC.on)) return 0;
    if (v.mode !== 'AUTO' && v.mode !== 'RTL') return 0;
    const ovx = Math.sin(v.hdg * D2R) * v.spd, ovy = Math.cos(v.hdg * D2R) * v.spd;
    let threat = null;
    for (const a of S.ais) {
      const px = a.x - v.x, py = a.y - v.y;
      const wx = Math.sin(a.cog * D2R) * a.sog - ovx, wy = Math.cos(a.cog * D2R) * a.sog - ovy;
      const w2 = wx * wx + wy * wy;
      if (w2 < 1e-6) continue;
      const tcpa = -(px * wx + py * wy) / w2;
      const cpa = Math.hypot(px + wx * tcpa, py + wy * tcpa);
      if (tcpa > 0 && tcpa < 180 && cpa < 300 && Math.hypot(px, py) < 2500) {
        if (!threat || tcpa < threat.tcpa) threat = { a, tcpa, cpa };
      }
    }
    if (threat) {
      if (!v.avoid || v.avoid.name !== threat.a.name) {
        G.log(v, 'warn', `충돌 회피 기동: ${threat.a.name} (CPA ${Math.round(threat.cpa)}m, TCPA ${Math.round(threat.tcpa)}s) → 우현 변침`);
      }
      v.avoid = { name: threat.a.name, cpa: threat.cpa, tcpa: threat.tcpa, until: S.t + 20 };
      return 45;
    }
    if (v.avoid && S.t < v.avoid.until) return 45;
    if (v.avoid) { G.log(v, 'info', `충돌 회피 종료, 경로 복귀`); v.avoid = null; }
    return 0;
  }

  // ---------- 운항 ----------
  function stepMotion(v, dt) {
    const m = v.m;
    const p = G.estPos(v);
    let thr = 0, desired = null;

    if (v.mode === 'MANUAL') {
      thr = v.manual.throttle; v.rudder = v.manual.rudder;
    } else if (v.mode === 'AUTO') {
      const wp = v.wps[v.wpIdx];
      if (!wp) { v.mode = 'HOLD'; G.log(v, 'info', '경로 완료 → 정지·표류'); }
      else {
        const d = dist(p.x, p.y, wp.x, wp.y);
        if (d < 18 + m.lengthM * 2) {
          v.wpIdx++;
          if (v.wpIdx >= v.wps.length && v.loop && v.wps.length > 1 && !v.tracking) { v.wpIdx = 0; G.log(v, 'info', '순찰 경로 한 바퀴 완료 → 반복'); }
          else if (v.wpIdx >= v.wps.length) { v.mode = 'HOLD'; G.log(v, 'info', '최종 경로점 도달 → 정지·표류'); }
          else G.log(v, 'info', `경로점 ${v.wpIdx}/${v.wps.length} 통과`);
        } else {
          desired = bearing(p.x, p.y, wp.x, wp.y);
          thr = m.cruise * clamp(d / 60, 0.35, 1);
        }
      }
    } else if (v.mode === 'RTL') {
      const d = dist(p.x, p.y, G.HOME.x, G.HOME.y);
      if (d < 20) { v.mode = 'HOLD'; G.log(v, 'info', '지정점 복귀 완료 → 정지'); }
      else { desired = bearing(p.x, p.y, G.HOME.x, G.HOME.y); thr = m.cruise * clamp(d / 60, 0.35, 1); }
    }

    if (desired !== null) {
      desired = wrap360(desired + colavOffset(v));
      v.rudder = clamp(wrap180(desired - v.hdg) / 30, -1, 1);
    } else if (v.mode !== 'MANUAL') v.rudder = 0;

    const propOk = v.pdu.PROP && v.pdu.PROP.on && v.mode !== 'ESTOP' && v.pdu.FC.on;
    if (!propOk || v.mode === 'HOLD') thr = 0;
    v.throttle = thr;

    const target = thr * m.maxSpeed;
    v.spd += (target - v.spd) * Math.min(1, dt / 4);
    const turnEff = Math.min(1, v.spd / 1.5 + 0.15);
    v.hdg = wrap360(v.hdg + v.rudder * m.maxTurn * turnEff * dt);

    const nx = v.x + (Math.sin(v.hdg * D2R) * v.spd + G.ENV.current.x) * dt;
    const ny = v.y + (Math.cos(v.hdg * D2R) * v.spd + G.ENV.current.y) * dt;
    if (G.isLand(nx, ny)) {
      v.spd = 0;
      setAlarm(v, 'ground', true, 'crit', '좌초 위험: 해안선 접촉');
    } else {
      v.x = nx; v.y = ny;
      setAlarm(v, 'ground', false);
    }
    const shore = G.coastY(v.x) - v.y;
    const nearHome = dist(v.x, v.y, G.HOME.x, G.HOME.y) < 450;
    setAlarm(v, 'geofence', shore < G.ENV.geofenceM && !nearHome && !v.alarms.ground, 'warn', `해안 근접 ${Math.round(shore)}m`);

    if (S.t - v.lastTrail > 3) {
      v.trail.push({ x: v.x, y: v.y });
      if (v.trail.length > 600) v.trail.shift();
      v.lastTrail = S.t;
    }
  }

  // ---------- 전원 (배터리·PDU·DC-DC) ----------
  function stepPower(v, dt) {
    let total = 0;
    for (const [c, ch] of Object.entries(v.pdu)) {
      const spec = G.CHANNELS[c];
      let w = 0;
      if (ch.on) {
        if (c === 'PROP') w = v.m.propMaxW * Math.pow(v.throttle, 3) + (v.throttle > 0 ? 25 : 2);
        else if (c === 'THERM') w = spec.baseW + (v.enc.coolerOn ? 70 : 0) + 18;
        else if (c === 'BAY') w = v.bay.power ? spec.baseW : 0;
        else if (c === 'SPK') w = spec.baseW + (S.t < v.spkUntil ? 160 : 0);
        else if (c === 'MC') w = spec.baseW + (v.m.colav ? 10 : 0);
        else w = spec.baseW;
        w *= 1 + (Math.random() - 0.5) * 0.04;
      }
      ch.amps = w / spec.rail;
      total += w / 0.94; // DC-DC 효율
    }
    v.powerW = total;
    v.powerAvg += (total - v.powerAvg) * Math.min(1, dt / 120);
    v.battWh = Math.max(0, v.battWh - (total * dt) / 3600);
    v.soc = v.battWh / v.m.batteryWh;
    const ocv = 13 * (3.3 + 0.9 * v.soc) - (v.faults.cell ? 2.6 : 0);
    v.amps = total / ocv;
    v.volt = ocv - v.amps * 0.03;

    setAlarm(v, 'cell', v.faults.cell, 'crit', 'BMS: 셀 전압 편차 이상');
    if (v.soc < 0.15) setAlarm(v, 'batt', true, 'crit', `배터리 잔량 위험 ${Math.round(v.soc * 100)}%`);
    else if (v.soc < 0.3) setAlarm(v, 'batt', true, 'warn', `배터리 잔량 낮음 ${Math.round(v.soc * 100)}%`);
    else setAlarm(v, 'batt', false);

    if (v.soc < 0.2 && !v.battRtl && (v.mode === 'AUTO' || v.mode === 'MANUAL')) {
      v.battRtl = true; v.mode = 'RTL';
      G.log(v, 'crit', '배터리 안전 동작: 지정점 복귀');
    }
    if (v.soc <= 0) { v.mode = 'HOLD'; }
  }

  // ---------- 전장 함체 열·습도 (COM-05·06) ----------
  function stepEnclosure(v, dt) {
    const e = v.enc;
    const thermOn = v.pdu.THERM && v.pdu.THERM.on;
    const heat = (v.powerW - (v.pdu.PROP ? v.pdu.PROP.amps * 48 : 0)) * 0.9 + v.throttle * 60;
    if (thermOn && !v.faults.cooling) {
      if (e.temp > 40) e.coolerOn = true;
      if (e.temp < 36) e.coolerOn = false;
    } else e.coolerOn = false;
    const coolK = e.coolerOn ? 9 : 0;
    const target = G.ENV.ambientC + heat * 0.06 - coolK + (v.faults.cooling ? 8 : 0);
    e.temp += (target - e.temp) * Math.min(1, dt / 240);

    const rhTarget = v.faults.leak ? 97 : (thermOn ? 40 : 72);
    e.rh += (rhTarget - e.rh) * Math.min(1, dt / (v.faults.leak ? 90 : 400));
    e.leak = v.faults.leak;

    setAlarm(v, 'leak', e.leak, 'crit', '전장 함체 누수 감지');
    if (e.temp > 60) setAlarm(v, 'temp', true, 'crit', `함체 온도 정격 초과 ${e.temp.toFixed(1)}°C`);
    else if (e.temp > 50) setAlarm(v, 'temp', true, 'warn', `함체 온도 상승 ${e.temp.toFixed(1)}°C`);
    else setAlarm(v, 'temp', false);
    setAlarm(v, 'rh', e.rh > 80, 'warn', `함체 습도 ${Math.round(e.rh)}% (결로 위험)`);
    setAlarm(v, 'gnss', v.faults.gnss, 'warn', `GNSS 교란 → IMU 보조 항법 (오차 ±${Math.round(v.est.unc)}m)`);
  }

  // ---------- 모델별 임무 장비 ----------
  function stepMission(v, dt) {
    const mcOn = v.pdu.MC && v.pdu.MC.on;
    const camOn = v.pdu.CAM && v.pdu.CAM.on;

    // A: 열화상 탐색
    if (v.m.features.includes('thermal')) {
      const P = S.piw;
      const d = dist(v.x, v.y, P.x, P.y);
      const rel = wrap180(bearing(v.x, v.y, P.x, P.y) - v.hdg);
      v.thermalTarget = (camOn && mcOn && d < 450 && Math.abs(rel) < 35) ? { d, rel } : null;
      if (v.thermalTarget && !P.detected) {
        P.detected = true; P.detectedBy = v.id; P.detX = P.x; P.detY = P.y;
        G.log(v, 'crit', `열화상 표적 탐지: 요구조자 추정 · 방위 ${Math.round(bearing(v.x, v.y, P.x, P.y))}° · ${Math.round(d)}m`);
      }
      if (P.detected && !P.rescued && v.thermalTarget) { P.detX = P.x; P.detY = P.y; }
    }

    // B: 기상·수질 관측
    if (v.m.features.includes('metocean')) {
      const sensOn = v.pdu.SENS && v.pdu.SENS.on;
      if (sensOn) {
        const k = S.t / 600;
        const prev = v.metocean;
        const mo = {
          windDir: wrap360(225 + 20 * Math.sin(k * 1.3) + (Math.random() - 0.5) * 6),
          windSpd: Math.max(0, 6.5 + 2 * Math.sin(k) + (Math.random() - 0.5)),
          pressure: 1008.5 + 1.2 * Math.sin(k / 3),
          airTemp: 28.4 + 0.8 * Math.sin(k / 2),
          waterTemp: 24.1 + 0.4 * Math.sin(v.x / 3000) + (v.y < -3000 ? -0.6 : 0),
          salinity: 33.2 + 0.3 * Math.sin(v.y / 2500),
          turbidity: 2.1 + (pointInOil(v.x, v.y, 300) ? 6.5 : 0) + Math.random() * 0.3,
        };
        v.metocean = mo;
        if (!v.mohist || S.t - (v.moLast || 0) > 10) {
          v.mohist = v.mohist || [];
          v.mohist.push({ t: S.t, ...mo }); if (v.mohist.length > 120) v.mohist.shift();
          v.moLast = S.t;
        }
        void prev;
      } else v.metocean = null;

      const hit = camOn && mcOn && pointInOil(v.x, v.y, 250);
      if (hit && !v.oilHit) {
        v.oilHit = true;
        const pos = G.fmtLatLon(v.x, v.y);
        setAlarm(v, 'oil', true, 'crit', `유출유 의심 징후 감지 (${pos})`);
        if (!S.oil.reported) { S.oil.reported = true; G.log(v, 'crit', `상황실 경보 전송(IF-10): 유출유 의심 · ${pos} · 영상 스트림 첨부`); }
      }
      if (!hit && v.oilHit && !pointInOil(v.x, v.y, 500)) { v.oilHit = false; }
    }

    // C: 임무 베이 인터페이스 상태(내부는 정의하지 않음)
    if (v.m.features.includes('bay')) {
      const on = v.pdu.BAY && v.pdu.BAY.on;
      v.bay.power = on;
      v.bay.eth = on && mcOn;
      v.bay.can = on && v.pdu.FC.on;
      setAlarm(v, 'bay', on && !v.bay.latch, 'warn', '임무 베이 기계 체결 해제 상태');
    }
  }
  // ---------- D: 국가중요시설 경계 감시(레이더·EO/IR·AIS 대조, 비살상 경고) ----------
  function stepSurveillance(v) {
    if (!v.m.features.includes('radar')) return;
    const radarOn = v.pdu.RADAR && v.pdu.RADAR.on && v.pdu.MC.on;
    const camOn = v.pdu.CAM && v.pdu.CAM.on && v.pdu.MC.on;
    v.contacts = [];
    if (!radarOn) { setAlarm(v, 'radar', true, 'warn', '레이더 꺼짐: 경계 감시 불가'); return; }
    setAlarm(v, 'radar', false);
    const R = v.m.radarRange;
    S.ais.forEach((a) => { const d = dist(v.x, v.y, a.x, a.y); if (d <= R) v.contacts.push({ name: a.name, ais: true, d, brg: bearing(v.x, v.y, a.x, a.y), x: a.x, y: a.y }); });
    const I = S.intruder;
    if (I && !I.gone) {
      const d = dist(v.x, v.y, I.x, I.y);
      if (d <= R) {
        v.contacts.push({ name: '미식별 선박', ais: false, d, brg: bearing(v.x, v.y, I.x, I.y), x: I.x, y: I.y, intruder: true });
        if (I.detAt == null) { I.detAt = S.t; I.detectedBy = v.id; G.log(v, 'warn', `레이더 탐지: 미식별 선박(AIS 미송신) · 방위 ${Math.round(bearing(v.x, v.y, I.x, I.y))}° · ${(d / 1852).toFixed(1)}NM`); }
        I.lastSeen = S.t; I.trackX = I.x; I.trackY = I.y;
        if (camOn && d <= v.m.eoRange && !I.eoId) { I.eoId = true; G.log(v, 'warn', 'EO/IR 식별: 소형 고속정 추정, 승선 인원 2명 내외 (영상 상황실 전송)'); }
      }
    }
  }
  function stepZone() {
    const I = S.intruder;
    if (!I || I.gone) return;
    const owner = S.vessels.find((q) => q.id === I.detectedBy) || S.vessels.find((q) => q.code === 'D');
    if (!owner) return;
    const seen = I.lastSeen != null && S.t - I.lastSeen < 10;
    const near = G.inZone(I.x, I.y, G.ZONE.buffer), inside = G.inZone(I.x, I.y);
    setAlarm(owner, 'zoneNear', seen && near && !inside, 'warn', '경계구역 접근: 미식별 선박');
    setAlarm(owner, 'zoneIn', seen && inside, 'crit', '경계구역 침입: 미식별 선박');
    if (inside && I.enteredAt == null) {
      I.enteredAt = S.t;
      if (seen) { I.reportedAt = S.t; G.log(owner, 'crit', `보안관제센터·해경 상황실 경보 전송(IF-10): 경계구역 침입 · ${G.fmtLatLon(I.x, I.y)} · 영상 첨부`); }
    }
    if (inside && I.reportedAt == null && seen) { I.reportedAt = S.t; G.log(owner, 'crit', '보안관제센터·해경 상황실 경보 전송(IF-10): 경계구역 침입'); }
  }
  function stepIntruder(dt) {
    const I = S.intruder;
    if (!I || I.gone) return;
    if (I.warnedAt != null && S.t - I.warnedAt > 25 && !I.leaving) {
      I.leaving = true; I.cog = 190; I.sog = 7;
      G.log(null, 'info', '미식별 선박: 경고 방송 후 침로 변경 · 구역 이탈 중');
    }
    if (!I.leaving) {
      const t = G.ZONE.site; const tx = t.x, ty = G.coastY(t.x) - 500;
      if (dist(I.x, I.y, tx, ty) < 120) I.sog = 0.3; else I.cog = bearing(I.x, I.y, tx, ty);
    }
    I.x += Math.sin(I.cog * D2R) * I.sog * dt; I.y += Math.cos(I.cog * D2R) * I.sog * dt;
    if (I.leaving && I.y < -9000) { I.gone = true; G.log(null, 'info', '미식별 선박 원거리 이탈 · 상황 종료'); S.vessels.forEach((v) => { setAlarm(v, 'zoneIn', false); setAlarm(v, 'zoneNear', false); }); }
  }
  G.spawnIntruder = function (x = 7600, y = -5600, sog = 6) {
    S.intruder = { x, y, cog: 330, sog, detAt: null, enteredAt: null, reportedAt: null, warnedAt: null, leaving: false, gone: false, eoId: false, spawnAt: S.t };
    G.log(null, 'info', '[훈련] 미식별 선박 투입(AIS 미송신, 시설 쪽으로 접근)');
  };
  G.warnBroadcast = function (v) {
    const I = S.intruder;
    return G.command(v, '경고 방송·탐조등', () => {
      if (!(v.pdu.SPK && v.pdu.SPK.on)) { G.log(v, 'warn', '경고 방송·탐조등 채널이 꺼져 있습니다'); return; }
      v.spkUntil = S.t + 60;
      if (I && !I.gone && dist(v.x, v.y, I.x, I.y) <= v.m.warnRange) {
        if (I.warnedAt == null) I.warnedAt = S.t;
        G.log(v, 'info', `경고 방송: "이 해역은 출입 통제 구역입니다. 즉시 이탈하십시오." · 탐조등 조사 (거리 ${Math.round(dist(v.x, v.y, I.x, I.y))}m)`);
      } else G.log(v, 'warn', `경고 방송 송출 — 대상이 ${v.m.warnRange}m 밖이라 효과 없음`);
    });
  };
  G.toggleTrack = function (v) {
    return G.command(v, v.tracking ? '추적 감시 해제' : '미식별 선박 추적 감시', () => {
      v.tracking = !v.tracking;
      if (v.tracking) { v.savedWps = v.wps; v.mode = 'AUTO'; }
      else { v.wps = v.savedWps || G.patrolRoute(); v.wpIdx = 0; }
    });
  };
  function stepTracking(v) {
    if (!v.tracking) return;
    const I = S.intruder;
    if (!I || I.gone || I.trackX == null) return;
    const b = bearing(I.trackX, I.trackY, v.x, v.y) * D2R; // 대상에서 우리 쪽으로 300m 이격 지점
    v.wps = [{ x: I.trackX + Math.sin(b) * 300, y: I.trackY + Math.cos(b) * 300 }]; v.wpIdx = 0;
    if (v.mode !== 'AUTO' && v.mode !== 'ESTOP' && v.activeLink) v.mode = 'AUTO';
  }
  // 경계구역 바다 쪽 둘레를 도는 순찰 경로
  G.patrolRoute = function () {
    const Z = G.ZONE, o = 450;
    return [{ x: Z.x0 - o, y: G.coastY(Z.x0 - o) - 250 }, { x: Z.x0 - o, y: Z.ySea - o }, { x: (Z.x0 + Z.x1) / 2, y: Z.ySea - o - 150 }, { x: Z.x1 + o, y: Z.ySea - o }, { x: Z.x1 + o, y: G.coastY(Z.x1 + o) - 250 }, { x: Z.x1 + o, y: Z.ySea - o }, { x: (Z.x0 + Z.x1) / 2, y: Z.ySea - o - 150 }, { x: Z.x0 - o, y: Z.ySea - o }];
  };

  function pointInOil(x, y, margin) {
    const o = S.oil;
    const c = Math.cos(-o.rot), s = Math.sin(-o.rot);
    const dx = x - o.x, dy = y - o.y;
    const lx = dx * c - dy * s, ly = dx * s + dy * c;
    return (lx * lx) / ((o.rx + margin) ** 2) + (ly * ly) / ((o.ry + margin) ** 2) <= 1;
  }
  G.pointInOil = pointInOil;

  G.releaseBuoy = function (v) {
    return G.command(v, '구조부이 원격 분리', () => {
      if (v.buoyReleased) return;
      v.buoyReleased = true;
      const b = { x: v.x, y: v.y, t: S.t, by: v.id };
      S.buoys.push(b);
      const d = dist(v.x, v.y, S.piw.x, S.piw.y);
      if (d < 40) {
        S.piw.rescued = true;
        G.log(v, 'info', `구조부이 전달 완료: 요구조자와 ${Math.round(d)}m`);
      } else {
        G.log(v, 'warn', `구조부이 분리됨: 요구조자와 ${Math.round(d)}m (전달 실패 가능성)`);
      }
    });
  };

  // ---------- 자체 점검(BIT): 장기 보관 후 점검만으로 운용 ----------
  G.runBIT = function (v) {
    return G.command(v, '자체 점검(BIT) 시작', () => {
      const items = [
        ['배터리 팩·BMS', () => !v.faults.cell && v.soc > 0.2, () => `SOC ${Math.round(v.soc * 100)}%, ${v.volt.toFixed(1)}V`],
        ['PDU 채널', () => Object.values(v.pdu).every((c) => !c.trip), () => `${Object.values(v.pdu).filter((c) => c.on).length}/${Object.keys(v.pdu).length} 채널 ON`],
        ['전장 함체 방수', () => !v.enc.leak, () => (v.enc.leak ? '누수 감지' : '누수 없음')],
        ['함체 온습도', () => v.enc.temp < 50 && v.enc.rh < 80, () => `${v.enc.temp.toFixed(1)}°C / ${Math.round(v.enc.rh)}%`],
        ['GNSS', () => !v.faults.gnss, () => (v.faults.gnss ? '교란 의심' : '3D Fix · KASS 보정')],
        ['IMU', () => true, () => '정상'],
        ['운항 제어기', () => v.pdu.FC.on, () => 'MAVLink 2 heartbeat 정상'],
        ['임무 컴퓨터', () => v.pdu.MC.on, () => (v.pdu.MC.on ? 'DDS 노드 정상' : '전원 OFF')],
        ...Object.keys(v.links).map((l) => [`링크 ${G.LINKS[l].name}`, () => v.links[l].up, () => (v.links[l].up ? `${v.links[l].rssi} dBm` : '불가')]),
        ['링크 암호화', () => true, () => (v.code === 'C' ? 'KCMVP 검증 모듈' : 'AES-256-GCM · 서명 ON')],
      ];
      if (v.pdu.BAY) items.push(['임무 베이 I/F', () => v.bay.power && v.bay.eth && v.bay.can && v.bay.latch, () => `전원 ${v.bay.power ? 'OK' : 'X'} · ETH ${v.bay.eth ? 'OK' : 'X'} · CAN ${v.bay.can ? 'OK' : 'X'} · 체결 ${v.bay.latch ? 'OK' : 'X'}`]);
      v.bit = { started: S.t, results: [], total: items.length, done: false };
      let i = 0;
      const tick = () => {
        if (i >= items.length) {
          v.bit.done = true;
          const fail = v.bit.results.filter((r) => !r.ok).length;
          G.log(v, fail ? 'warn' : 'info', `자체 점검 완료: ${items.length - fail}/${items.length} 정상`);
          return;
        }
        const [name, ok, detail] = items[i++];
        v.bit.results.push({ name, ok: ok(), detail: detail() });
        setTimeout(tick, 160);
      };
      tick();
    });
  };

  // ---------- 기록 ----------
  function record(v) {
    if (S.t - v.lastRec < 1) return;
    v.lastRec = S.t;
    const ll = G.toLatLon(v.x, v.y);
    S.telemetry.push({
      t: +S.t.toFixed(1), id: v.id, lat: +ll.lat.toFixed(6), lon: +ll.lon.toFixed(6),
      hdg: +v.hdg.toFixed(1), spd_kn: +(v.spd * 1.944).toFixed(2), mode: v.mode, link: v.activeLink || 'NONE',
      soc: +(v.soc * 100).toFixed(1), volt: +v.volt.toFixed(2), amps: +v.amps.toFixed(2),
      enc_temp: +v.enc.temp.toFixed(1), enc_rh: +v.enc.rh.toFixed(0), leak: v.enc.leak ? 1 : 0,
    });
    if (S.telemetry.length > 200000) S.telemetry.splice(0, 10000);
  }

  // ---------- 메인 스텝 ----------
  G.step = function (dt) {
    S.t += dt;
    stepAIS(dt);
    if (!S.piw.rescued) { S.piw.x += G.ENV.current.x * dt * 0.8; S.piw.y += G.ENV.current.y * dt * 0.8; }
    S.buoys.forEach((b) => { b.x += G.ENV.current.x * dt * 0.8; b.y += G.ENV.current.y * dt * 0.8; });
    stepIntruder(dt);
    stepMCS(dt);
    evalLinks();
    S.vessels.forEach((v) => {
      stepSurveillance(v);
      stepTracking(v);
      stepNavEstimate(v, dt);
      stepMotion(v, dt);
      stepPower(v, dt);
      stepEnclosure(v, dt);
      stepMission(v, dt);
      record(v);
    });
    stepZone();
  };

  G.init = function () {
    seedAIS();
    const a = G.addVessel('A', -150, 1000); a.hdg = 190;
    const b = G.addVessel('B', 160, 980); b.hdg = 170;
    const c = G.addVessel('C', 20, 860); c.hdg = 180;
    // B 기본 관측 경로
    b.wps = G.surveyPattern(-3800, -3300, 1800, 1400, 4);
    b.mode = 'AUTO';
    const d = G.addVessel('D', 300, 900); d.hdg = 140;
    d.wps = G.patrolRoute(); d.mode = 'AUTO';
    G.log(null, 'info', '지상통제소 기동 · 운용자 1명 · 링크 암호화 활성');
  };

  // 잔디깎기 형태 관측 경로 생성
  G.surveyPattern = function (cx, cy, w, h, legs) {
    const wps = [];
    for (let i = 0; i < legs; i++) {
      const x = cx - w / 2 + (w * i) / (legs - 1);
      if (i % 2 === 0) { wps.push({ x, y: cy + h / 2 }); wps.push({ x, y: cy - h / 2 }); }
      else { wps.push({ x, y: cy - h / 2 }); wps.push({ x, y: cy + h / 2 }); }
    }
    return wps;
  };
})();
