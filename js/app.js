// 지상통제소 UI: 선단 목록, 경보, 선체 패널(운항·상태감시·통신·임무), 기록
(function () {
  const G = window.GCS;
  const S = G.state;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const fmtT = (t) => {
    t = Math.floor(t);
    return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map((n) => String(n).padStart(2, '0')).join(':');
  };
  const fmtDur = (h) => (h === Infinity || isNaN(h) ? '—' : h >= 1 ? `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m` : `${Math.round(h * 60)}m`);
  const LV = { info: '정보', cmd: '명령', warn: '경고', crit: '위험' };

  let tab = 'nav';
  let lastPanelKey = '';

  // ---------- 상단 ----------
  $('speed').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const ts = +b.dataset.ts;
    if (ts === 0) S.paused = !S.paused; else { S.timeScale = ts; S.paused = false; }
    [...$('speed').children].forEach((x) => x.classList.toggle('on', S.paused ? +x.dataset.ts === 0 : +x.dataset.ts === S.timeScale));
  });

  $('addBtn').addEventListener('click', () => {
    const code = $('addModel').value;
    const n = S.vessels.length;
    const v = G.addVessel(code, -300 + (n % 5) * 140, 1000 - Math.floor(n / 5) * 120);
    S.selectedId = v.id; structural();
  });

  $('btnFollow').addEventListener('click', () => { G.view.follow = !G.view.follow; $('btnFollow').classList.toggle('on', G.view.follow); });
  $('btnFit').addEventListener('click', () => {
    const pts = S.vessels.map((v) => [v.x, v.y]).concat([[G.GCS_POS.x, G.GCS_POS.y]]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const r = $('map').getBoundingClientRect();
    const w = Math.max(...xs) - Math.min(...xs) + 2000, h = Math.max(...ys) - Math.min(...ys) + 2000;
    G.view.cx = (Math.max(...xs) + Math.min(...xs)) / 2; G.view.cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    G.view.scale = Math.min(r.width / w, r.height / h);
    G.view.follow = false; $('btnFollow').classList.remove('on');
  });

  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    tab = b.dataset.tab;
    [...$('tabs').children].forEach((x) => x.classList.toggle('on', x === b));
    structural();
  });

  // ---------- 로그 ----------
  const evBox = $('events');
  function evRow(e) {
    return `<div class="ev ${e.level}"><span class="t">${fmtT(e.t)}</span><span class="id">${esc(e.id)}</span><span class="m">[${LV[e.level]}] ${esc(e.msg)}</span></div>`;
  }
  function passFilter(e) {
    const f = $('logFilter').value;
    if (f === 'all') return true;
    if (f === 'cmd') return e.level === 'cmd';
    if (f === 'warn') return e.level === 'warn' || e.level === 'crit';
    return e.level === 'crit';
  }
  function renderEvents() {
    evBox.innerHTML = S.events.filter(passFilter).slice(-300).reverse().map(evRow).join('');
  }
  S.listeners.push((e) => {
    if (!passFilter(e)) return;
    evBox.insertAdjacentHTML('afterbegin', evRow(e));
    while (evBox.children.length > 300) evBox.lastChild.remove();
  });
  $('logFilter').addEventListener('change', renderEvents);

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('expCsv').addEventListener('click', () => {
    const rows = S.telemetry;
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const csv = '﻿' + cols.join(',') + '\n' + rows.map((r) => cols.map((c) => r[c]).join(',')).join('\n');
    download(`usv_telemetry_${Date.now()}.csv`, csv, 'text/csv');
    G.log(null, 'info', `원격측정 기록 추출: ${rows.length}행`);
  });
  $('expJson').addEventListener('click', () => {
    download(`usv_events_${Date.now()}.json`, JSON.stringify(S.events, null, 1), 'application/json');
    G.log(null, 'info', `이벤트 기록 추출: ${S.events.length}건`);
  });

  // ---------- 선단·경보 ----------
  function worstLevel(v) {
    const ls = Object.values(v.alarms).map((a) => a.level);
    return ls.includes('crit') ? 'crit' : ls.includes('warn') ? 'warn' : 'ok';
  }
  function renderFleet() {
    $('fleet').innerHTML = S.vessels.map((v) => {
      const lv = worstLevel(v);
      return `<div class="vcard ${v.id === S.selectedId ? 'sel' : ''}" data-sel="${v.id}" style="border-left-color:${v.m.color}">
        <div class="row1"><span>${esc(v.id)} <span class="pill">${v.m.name}</span></span><span class="pill ${lv}">${lv === 'ok' ? '정상' : lv === 'warn' ? '주의' : '위험'}</span></div>
        <div class="row2"><span>${G.MODES[v.mode]}</span><span>${(v.spd * 1.944).toFixed(1)}kn</span><span>🔋${Math.round(v.soc * 100)}%</span><span>📡${v.activeLink ? G.LINKS[v.activeLink].name : '<b style="color:var(--crit)">두절</b>'}</span>${v.ctrl ? `<span>${v.ctrl === 'MCS' ? '🚢 해상통제' : '🏢 지상통제'}</span>` : ''}</div>
      </div>`;
    }).join('');
    $('opinfo').textContent = `운용자 1명 · 선체 ${S.vessels.length}척`;
  }
  function renderAlarms() {
    const list = [];
    S.vessels.forEach((v) => Object.entries(v.alarms).forEach(([k, a]) => list.push({ v, k, a })));
    list.sort((p, q) => (p.a.ack - q.a.ack) || ((q.a.level === 'crit') - (p.a.level === 'crit')) || (q.a.since - p.a.since));
    $('alarms').innerHTML = list.length ? list.map(({ v, k, a }) =>
      `<div class="al ${a.level} ${a.ack ? 'acked' : ''}"><span class="msg"><span class="who" data-sel="${v.id}" style="cursor:pointer">${esc(v.id)}</span>${esc(a.msg)}</span>${a.ack ? '' : `<button data-act="ack" data-v="${v.id}" data-k="${k}">확인</button>`}</div>`
    ).join('') : '<div class="empty">활성 경보 없음</div>';
    const un = list.filter((x) => !x.a.ack);
    const crit = un.filter((x) => x.a.level === 'crit').length;
    const el = $('alarmSum');
    el.className = 'alarmsum ' + (crit ? 'crit' : un.length ? 'warn' : 'ok');
    el.textContent = crit ? `위험 ${crit}건` : un.length ? `주의 ${un.length}건` : '경보 없음';
  }

  // ---------- 선체 패널 ----------
  function header(v) {
    if (!v) { $('vhead').innerHTML = '<div class="empty">선체를 선택하세요</div>'; return; }
    $('vhead').innerHTML = `<div class="nm"><span class="dot" style="background:${v.m.color}"></span>${esc(v.id)} <span class="pill">${v.m.name} · ${v.m.lengthM}m급</span></div>
      <div class="meta" data-f="meta"></div>`;
  }

  const link = (v) => (v.activeLink ? '' : '<div class="nolink">⚠ 링크 없음 — 원격 명령을 보낼 수 없습니다. 선체는 설정된 안전 동작을 수행합니다.</div>');

  const TABS = {
    nav(v) {
      return `<div data-h="nolink"></div>
      <h4>운항 모드</h4>
      <div class="modes">
        ${['MANUAL', 'AUTO', 'HOLD', 'RTL'].map((m) => `<button data-act="mode" data-mode="${m}" data-modebtn="${m}">${G.MODES[m]}</button>`).join('')}
      </div>
      <button data-act="estop" class="estop" data-f-estop>⛔ 비상 차단 (추진 전원 차단)</button>
      <h4>항법 <small>GNSS(GPS·Galileo)+KASS · IMU 보조</small></h4>
      <div class="grid2">
        <div class="stat"><div class="k">위치</div><div class="v" style="font-size:12px" data-f="pos"></div></div>
        <div class="stat"><div class="k">GNSS</div><div class="v" style="font-size:12px" data-f="gnss"></div></div>
        <div class="stat"><div class="k">침로 / 속력</div><div class="v" data-f="hdgspd"></div></div>
        <div class="stat"><div class="k">지정점까지</div><div class="v" data-f="home"></div></div>
        <div class="stat"><div class="k">추진 출력</div><div class="v" data-f="thr"></div></div>
        <div class="stat"><div class="k">충돌 회피</div><div class="v" style="font-size:12px" data-f="colav"></div></div>
      </div>
      <h4>수동 조종 <small>키보드 W/S 추력 · A/D 타각 · X 중립 · Space 정지</small></h4>
      <div class="ctlrow"><label>추력</label><input type="range" min="0" max="100" step="5" data-in="thr"><span class="val" data-f="mthr"></span></div>
      <div class="ctlrow"><label>타각</label><input type="range" min="-100" max="100" step="5" data-in="rud"><span class="val" data-f="mrud"></span></div>
      <h4>경로점 <small data-f="wpcount"></small></h4>
      <div class="btnrow">
        <button data-act="wpedit" data-f-wpedit>경로점 편집</button>
        <button data-act="wpclear">경로 삭제</button>
        ${v.code === 'B' ? '<button data-act="survey">관측 패턴 생성</button>' : ''}
        ${v.code === 'A' && S.piw.detected ? '<button data-act="gopiw">탐지 지점으로</button>' : ''}
        <button data-act="upload">경로 업로드·자율 시작</button>
      </div>
      <h4>통신 두절 시 안전 동작 <small>COM-04</small></h4>
      <div class="ctlrow"><label>대기 시간</label><input type="range" min="5" max="120" step="5" data-in="fstime"><span class="val" data-f="fstime"></span></div>
      <div class="ctlrow"><label>동작</label>
        <select data-in="fsact"><option value="RTL">지정점 복귀</option><option value="HOLD">정지·표류</option></select>
      </div>`;
    },
    health(v) {
      const rows = Object.keys(v.pdu).map((c) => {
        const spec = G.CHANNELS[c];
        return `<tr><td>${spec.name}</td><td>${spec.rail}V</td><td data-f="pdu:${c}"></td>
          <td>${spec.essential ? '<span class="pill">필수</span>' : `<button class="sw" data-act="pdu" data-ch="${c}" data-sw="pdu:${c}"></button>`}</td></tr>`;
      }).join('');
      return `<div data-h="nolink"></div>
      <h4>전원 <small>배터리 팩·BMS (주전원 48V)</small></h4>
      <div class="bar"><i data-bar="soc"></i></div>
      <div class="grid3" style="margin-top:6px">
        <div class="stat"><div class="k">잔량</div><div class="v" data-f="soc"></div></div>
        <div class="stat"><div class="k">전압</div><div class="v" data-f="volt"></div></div>
        <div class="stat"><div class="k">전류</div><div class="v" data-f="amps"></div></div>
        <div class="stat"><div class="k">소비전력</div><div class="v" data-f="power"></div></div>
        <div class="stat"><div class="k">잔여 운용</div><div class="v" data-f="remain"></div></div>
        <div class="stat"><div class="k">목표 운용</div><div class="v" style="font-size:12px">${v.m.enduranceTargetH ? `${v.m.enduranceTargetH}h 이상(안)` : 'ROC에 따름'}</div></div>
      </div>
      <h4>전장 함체 <small>IP67 · 열·습도 관리 (COM-05·06)</small></h4>
      <div class="grid3">
        <div class="stat"><div class="k">내부 온도</div><div class="v" data-f="etemp"></div></div>
        <div class="stat"><div class="k">상대 습도</div><div class="v" data-f="erh"></div></div>
        <div class="stat"><div class="k">누수</div><div class="v" data-f="leak"></div></div>
      </div>
      <div class="hint" style="margin-top:4px" data-f="cooler"></div>
      <h4>전원 분배(PDU) <small>채널별 차단·전류 측정</small></h4>
      <table class="t"><tr><th>채널</th><th>레일</th><th>전류</th><th>원격</th></tr>${rows}</table>
      <h4>자체 점검(BIT) <small>장기 보관 후 점검</small></h4>
      <button data-act="bit">자체 점검 실행</button>
      <div data-h="bit" style="margin-top:6px"></div>
      <h4>고장 주입 <small>교육·시험용 · 선체 측 사건이므로 링크 불필요</small></h4>
      <table class="t">
        ${[['leak', '전장 함체 누수'], ['cooling', '냉각 유닛 고장'], ['gnss', 'GNSS 전파 교란'], ['cell', '배터리 셀 이상']].map(([k, n]) =>
          `<tr><td>${n}</td><td style="text-align:right"><button class="sw danger" data-act="fault" data-k="${k}" data-sw="fault:${k}"></button></td></tr>`).join('')}
      </table>`;
    },
    comm(v) {
      const rows = Object.keys(v.links).map((l) => `<tr data-row="link:${l}">
          <td><b>${G.LINKS[l].name}</b><br><span class="hint">${v.links[l].prio}순위 · ${G.LINKS[l].role}</span></td>
          <td data-f="lst:${l}"></td><td data-f="lrssi:${l}"></td><td data-f="llat:${l}"></td>
          <td><button class="sw danger" data-act="linkcut" data-l="${l}" data-sw="linkcut:${l}" title="강제 차단(시험)"></button></td></tr>`).join('');
      return `<div data-h="nolink"></div>
      <h4>링크 관리기 <small>우선순위 자동 전환 (COM-03)</small></h4>
      <table class="t"><tr><th>링크</th><th>상태</th><th>신호</th><th>지연</th><th>차단</th></tr>${rows}</table>
      <div class="hint" style="margin-top:6px">'차단' 스위치는 통합 시험의 링크 강제 차단을 재현합니다. 모든 링크가 끊기면 설정 시간 뒤 안전 동작이 실행됩니다.</div>
      <h4>현재 링크</h4>
      <div class="grid2">
        <div class="stat"><div class="k">활성 링크</div><div class="v" data-f="alink"></div></div>
        <div class="stat"><div class="k">영상 스트림(RTSP)</div><div class="v" style="font-size:12px" data-f="video"></div></div>
      </div>
      <h4>통제소 <small>지상통제소(GCS) · 해상통제소(MCS, 지원함 탑재)</small></h4>
      <div class="grid2">
        <div class="stat"><div class="k">현재 통제 주체</div><div class="v" style="font-size:12px" data-f="ctrl"></div></div>
        <div class="stat"><div class="k">해상통제소</div><div class="v" style="font-size:12px" data-f="mcsinfo"></div></div>
      </div>
      <div class="btnrow" style="margin-top:6px"><button data-act="mcs" data-f-mcs>해상통제소 배치·이 선체 호위</button><button data-act="prefmcs" data-f-pref>해상통제소 우선 통제</button></div>
      <div class="hint" style="margin-top:4px">해상통제소는 지원함에 탑재한 이동형 통제소입니다. 메시 무전(6km)으로 선체와 연결되어, 연안 LTE·지상통제소 메시가 닿지 않는 외해에서 통제권을 이어받습니다.</div>
      <h4>보안 <small>COM-10</small></h4>
      <div class="grid2">
        <div class="stat"><div class="k">링크 암호화</div><div class="v" style="font-size:12px">${v.code === 'C' ? 'KCMVP 검증 암호모듈' : 'AES-256-GCM'}</div></div>
        <div class="stat"><div class="k">제어 프로토콜</div><div class="v" style="font-size:12px">${v.code === 'C' ? 'MAVLink 2 → 군 상호운용 GW' : 'MAVLink 2 (서명)'}</div></div>
      </div>
      <h4>AIS <small>ITU-R M.1371</small></h4>
      <div class="ctlrow"><label>자선 송신</label>
        ${v.code === 'C' ? `<button class="sw" data-act="aistx" data-sw="aistx"></button><span class="hint">군용: 송신 제어(기본 OFF)</span>` : '<span class="pill ok">Class B 송수신</span>'}
      </div>
      <table class="t" data-h="aistbl"></table>`;
    },
    mission(v) {
      if (v.code === 'A') {
        return `<div data-h="nolink"></div>
        <h4>탐색 카메라 <small>주간 EO + 열화상, 실시간 전송</small></h4>
        <div class="btnrow" style="margin-bottom:6px"><button data-act="cam" data-cam="ir" data-f-cam="ir">열화상</button><button data-act="cam" data-cam="eo" data-f-cam="eo">주간 EO</button></div>
        <canvas class="cam" id="cam" width="480" height="270"></canvas>
        <div class="hint" data-f="camstat" style="margin-top:4px"></div>
        <h4>구조부이 <small>거치·원격 분리</small></h4>
        <div class="grid2">
          <div class="stat"><div class="k">부이 상태</div><div class="v" data-f="buoy"></div></div>
          <div class="stat"><div class="k">요구조자까지</div><div class="v" data-f="piwd"></div></div>
        </div>
        <button data-act="buoy" class="estop" style="background:#d4380d;border-color:#ff7a45" data-f-buoy>🛟 구조부이 분리</button>
        <div class="note">시나리오: 차량으로 현장 이동 → 2인 수동 진수 → 열화상으로 요구조자 탐색 → 구조부이 전달 → 복귀.<br>요구조자는 남동쪽 약 3km 해역에서 해류로 표류 중입니다. 경로점을 찍어 탐색하고, 탐지되면 '탐지 지점으로'를 누른 뒤 40m 이내에서 부이를 분리하세요.</div>`;
      }
      if (v.code === 'B') {
        const k = [['windDir', '풍향', '°', 0], ['windSpd', '풍속', 'm/s', 1], ['pressure', '기압', 'hPa', 1], ['airTemp', '기온', '°C', 1],
          ['waterTemp', '수온', '°C', 2], ['salinity', '염분', 'psu', 2], ['turbidity', '탁도', 'NTU', 2]];
        return `<div data-h="nolink"></div>
        <h4>기상·수질 관측 <small>NMEA 2000 게이트웨이</small></h4>
        <div class="grid2">${k.map(([id, n, u]) => `<div class="stat"><div class="k">${n}</div><div class="v"><span data-f="mo:${id}"></span> <small>${u}</small></div><canvas class="spark" data-spark="${id}" width="160" height="38"></canvas></div>`).join('')}</div>
        <h4>유출유 감지 <small>영상 기반</small></h4>
        <div class="stat"><div class="v" style="font-size:12px" data-f="oil"></div></div>
        <div class="note">시나리오: 지정 구역을 경로점으로 자율 순항 → 기상·수질·영상 수집 → 유출유 등 이상 징후 시 관제소·상황실(IF-10) 경보.<br>AIS 기반 충돌 회피가 활성되어 있어 선박과 CPA 300m 미만이 예상되면 우현으로 변침합니다.</div>`;
      }
      if (v.code === 'D') {
        return `<div data-h="nolink"></div>
        <h4>경계 감시 <small>레이더 · 주야간 EO/IR · AIS 대조</small></h4>
        <canvas class="cam" id="ppi" width="480" height="300"></canvas>
        <div class="grid2" style="margin-top:6px">
          <div class="stat"><div class="k">레이더 접촉</div><div class="v" data-f="dcontacts"></div></div>
          <div class="stat"><div class="k">경계구역</div><div class="v" style="font-size:12px" data-f="dzone"></div></div>
        </div>
        <table class="t" data-h="dtable" style="margin-top:6px"></table>
        <h4>대응 <small>비살상만 — 무장 없음</small></h4>
        <div class="btnrow">
          <button data-act="dwarn" class="estop" style="width:auto;margin:0;background:#d4380d;border-color:#ff7a45">📢 경고 방송·탐조등</button>
          <button data-act="dtrack" data-f-track>추적 감시</button>
          <button data-act="dpatrol">순찰 경로 다시 생성</button>
        </div>
        <h4>훈련</h4>
        <div class="btnrow"><button data-act="dspawn">미식별 선박 투입(훈련)</button></div>
        <div class="note">시나리오: 계류 도크에서 출동 → 경계구역 둘레 반복 순찰 → 레이더로 AIS를 보내지 않는 선박 탐지 → 1.5km 안에서 EO/IR로 식별 → 접근 경고선·경계구역 진입 시 자동 경보, 보안관제센터·해경 상황실 전송 → 운용자 판단으로 경고 방송·탐조등 → 해경·경비 인력 출동 연계.<br>경계구역과 시설은 훈련용 가상 위치입니다.</div>`;
      }
      return `<div data-h="nolink"></div>
        <h4>임무 베이 인터페이스 <small>IF-08 전원·Ethernet·CAN·기계 체결</small></h4>
        <div class="grid2">
          <div class="stat"><div class="k">전원(48V)</div><div class="v" data-f="bay:power"></div></div>
          <div class="stat"><div class="k">Ethernet(DDS)</div><div class="v" data-f="bay:eth"></div></div>
          <div class="stat"><div class="k">CAN FD</div><div class="v" data-f="bay:can"></div></div>
          <div class="stat"><div class="k">기계 체결</div><div class="v" data-f="bay:latch"></div></div>
        </div>
        <div class="ctlrow" style="margin-top:8px"><label>체결 상태</label><button class="sw" data-act="latch" data-sw="latch"></button><span class="hint">체결 센서 시뮬레이션</span></div>
        <div class="note"><b>범위 제한:</b> 임무장비 내부(탄두·신관·유도·표적화)는 정부 지정 체계업체가 설계·통합하며 본 플랫폼·시뮬레이터는 정의하지 않습니다. 여기서는 표준 인터페이스의 연결 상태만 감시합니다.<br><br>양산성: 전용 가공품 최소화 · 모듈 단위 분산 생산 · 표준 컨테이너 적재. 장기 보관 후에는 '상태감시 → 자체 점검'만으로 운용 준비를 확인합니다.</div>`;
    },
  };

  let camMode = 'ir';

  function structural() {
    const v = G.selected();
    renderFleet();
    header(v);
    if (!v) { $('panel').innerHTML = ''; return; }
    $('panel').innerHTML = TABS[tab](v);
    lastPanelKey = v.id + tab;
    // 입력 초기값
    const p = $('panel');
    const set = (k, val) => { const el = p.querySelector(`[data-in="${k}"]`); if (el) el.value = val; };
    set('thr', Math.round(v.manual.throttle * 100));
    set('rud', Math.round(v.manual.rudder * 100));
    set('fstime', v.failsafe.timeout);
    set('fsact', v.failsafe.action);
    refresh();
  }
  G.onChange = structural;

  // 입력(슬라이더·선택)
  $('panel').addEventListener('input', (e) => {
    const v = G.selected(); if (!v) return;
    const k = e.target.dataset.in; if (!k) return;
    const val = e.target.value;
    if (k === 'thr' || k === 'rud') {
      if (!v.activeLink) { e.target.value = Math.round((k === 'thr' ? v.manual.throttle : v.manual.rudder) * 100); return; }
      if (k === 'thr') v.manual.throttle = val / 100; else v.manual.rudder = val / 100;
    }
    if (k === 'fstime') v.failsafe.timeout = +val;
  });
  $('panel').addEventListener('change', (e) => {
    const v = G.selected(); if (!v) return;
    const k = e.target.dataset.in;
    if (k === 'fstime') G.command(v, `안전 동작 대기 시간 ${v.failsafe.timeout}s`, () => {});
    if (k === 'fsact') {
      const val = e.target.value;
      if (!G.command(v, `안전 동작 → ${G.MODES[val]}`, () => (v.failsafe.action = val))) e.target.value = v.failsafe.action;
    }
  });

  // 버튼 동작(pointerdown: 주기 갱신으로 요소가 다시 그려져도 확실히 반응)
  document.addEventListener('pointerdown', (e) => {
    const sel = e.target.closest('[data-sel]');
    if (sel && !e.target.closest('[data-act]')) { S.selectedId = sel.dataset.sel; structural(); return; }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || e.button !== 0) return;
    const v = b.dataset.v ? S.vessels.find((q) => q.id === b.dataset.v) : G.selected();
    if (!v) return;
    const act = b.dataset.act;
    switch (act) {
      case 'ack': v.alarms[b.dataset.k] && (v.alarms[b.dataset.k].ack = true); break;
      case 'mode': G.setMode(v, b.dataset.mode); break;
      case 'estop': v.mode === 'ESTOP' ? G.estopReset(v) : G.estop(v); break;
      case 'wpedit': G.view.wpEdit = !G.view.wpEdit; break;
      case 'wpclear': v.wps = []; v.wpIdx = 0; if (v.mode === 'AUTO') G.setMode(v, 'HOLD'); break;
      case 'survey': v.wps = G.surveyPattern(-3800, -3300, 1800, 1400, 4); v.wpIdx = 0; break;
      case 'gopiw': v.wps = [{ x: S.piw.detX, y: S.piw.detY }]; v.wpIdx = 0; G.setMode(v, 'AUTO'); break;
      case 'upload':
        if (v.wps.length) G.command(v, `경로 업로드 (${v.wps.length}점)`, () => { v.wpIdx = 0; });
        G.setMode(v, 'AUTO'); G.view.wpEdit = false; break;
      case 'pdu': {
        const c = b.dataset.ch; const ch = v.pdu[c];
        G.command(v, `PDU ${G.CHANNELS[c].name} ${ch.on ? 'OFF' : 'ON'}`, () => { ch.on = !ch.on; });
        break;
      }
      case 'fault': {
        const k = b.dataset.k; v.faults[k] = !v.faults[k];
        G.log(v, 'warn', `[고장 주입] ${b.closest('tr').firstChild.textContent} ${v.faults[k] ? '발생' : '복구'}`);
        break;
      }
      case 'linkcut': {
        const L = v.links[b.dataset.l]; L.forcedDown = !L.forcedDown;
        G.log(v, 'warn', `[시험] ${G.LINKS[b.dataset.l].name} 링크 강제 ${L.forcedDown ? '차단' : '복구'}`);
        break;
      }
      case 'aistx': G.command(v, `AIS 송신 ${v.aisTx ? 'OFF' : 'ON'}`, () => (v.aisTx = !v.aisTx)); break;
      case 'bit': G.runBIT(v); break;
      case 'buoy': G.releaseBuoy(v); break;
      case 'cam': camMode = b.dataset.cam; break;
      case 'dwarn': G.warnBroadcast(v); break;
      case 'dtrack':
        if (!S.intruder || S.intruder.gone || S.intruder.trackX == null) { G.log(v, 'warn', '추적할 미식별 접촉이 없습니다'); break; }
        G.toggleTrack(v); break;
      case 'dpatrol': G.command(v, '순찰 경로 업로드(경계구역 둘레)', () => { v.tracking = false; v.wps = G.patrolRoute(); v.wpIdx = 0; v.mode = 'AUTO'; }); break;
      case 'dspawn': G.spawnIntruder(); break;
      case 'mcs': if (S.mcs.active && S.mcs.escort === v.id) G.setMCS(false); else G.setMCS(true, v.id); break;
      case 'prefmcs': G.command(v, v.prefMCS ? '지상통제소 우선 통제' : '해상통제소 우선 통제', () => { v.prefMCS = !v.prefMCS; }); break;
      case 'latch': v.bay.latch = !v.bay.latch; G.log(v, 'info', `임무 베이 체결 ${v.bay.latch ? '잠금' : '해제'}`); break;
    }
    if (['wpclear', 'survey', 'gopiw', 'upload'].includes(act)) structural();
    else refresh();
    e.preventDefault();
  });

  // 키보드 수동 조종
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    const v = G.selected(); if (!v) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { G.setMode(v, 'HOLD'); e.preventDefault(); return; }
    if (v.mode !== 'MANUAL' || !v.activeLink) return;
    const c = G.util.clamp;
    if (k === 'w') v.manual.throttle = c(v.manual.throttle + 0.1, 0, 1);
    else if (k === 's') v.manual.throttle = c(v.manual.throttle - 0.1, 0, 1);
    else if (k === 'a') v.manual.rudder = c(v.manual.rudder - 0.2, -1, 1);
    else if (k === 'd') v.manual.rudder = c(v.manual.rudder + 0.2, -1, 1);
    else if (k === 'x') v.manual.rudder = 0;
    else return;
    const p = $('panel');
    const t = p.querySelector('[data-in="thr"]'), r = p.querySelector('[data-in="rud"]');
    if (t) t.value = Math.round(v.manual.throttle * 100);
    if (r) r.value = Math.round(v.manual.rudder * 100);
  });

  // ---------- 주기 갱신 ----------
  const ok = (b, y = '정상', n = '이상') => `<span style="color:var(--${b ? 'ok' : 'crit'})">${b ? y : n}</span>`;
  function rssiBars(r) {
    if (r == null) return '—';
    const n = r > -75 ? 4 : r > -85 ? 3 : r > -95 ? 2 : 1;
    return `<span class="rssi">${[1, 2, 3, 4].map((i) => `<i class="${i <= n ? 'f' : ''}" style="height:${i * 3}px"></i>`).join('')}</span> ${r}dBm`;
  }

  function fields(v) {
    const D = G.util;
    const ep = G.estPos(v);
    const dh = D.dist(ep.x, ep.y, G.HOME.x, G.HOME.y);
    const rem = v.battWh / Math.max(1, v.powerAvg);
    const f = {
      meta: `${G.MODES[v.mode]} · ${v.activeLink ? G.LINKS[v.activeLink].name + ' 연결' : '통신 두절'} · 🔋 ${Math.round(v.soc * 100)}% · 경보 ${Object.keys(v.alarms).length}건`,
      pos: G.fmtLatLon(ep.x, ep.y),
      gnss: v.faults.gnss ? `<span style="color:var(--warn)">교란 · IMU 보조 ±${Math.round(v.est.unc)}m</span>` : '3D Fix · KASS ±2.5m',
      hdgspd: `${Math.round(v.hdg).toString().padStart(3, '0')}° / ${(v.spd * 1.944).toFixed(1)}<small>kn</small>`,
      home: `${dh >= 1000 ? (dh / 1000).toFixed(2) + '<small>km</small>' : Math.round(dh) + '<small>m</small>'}`,
      thr: `${Math.round(v.throttle * 100)}<small>% · 타 ${Math.round(v.rudder * 100)}</small>`,
      colav: !v.m.colav ? '<span class="hint">미탑재(모델 A)</span>' : v.avoid ? `<span style="color:var(--warn)">회피 중: ${esc(v.avoid.name)}</span>` : '감시 중',
      mthr: `${Math.round(v.manual.throttle * 100)}%`,
      mrud: `${Math.round(v.manual.rudder * 100)}`,
      wpcount: `${v.wps.length}점 · 진행 ${Math.min(v.wpIdx, v.wps.length)}/${v.wps.length}`,
      fstime: `${v.failsafe.timeout}s`,
      soc: `${(v.soc * 100).toFixed(1)}<small>%</small>`,
      volt: `${v.volt.toFixed(1)}<small>V</small>`,
      amps: `${v.amps.toFixed(1)}<small>A</small>`,
      power: `${Math.round(v.powerW)}<small>W</small>`,
      remain: fmtDur(rem),
      etemp: `${v.enc.temp.toFixed(1)}<small>°C</small>`,
      erh: `${Math.round(v.enc.rh)}<small>%</small>`,
      leak: ok(!v.enc.leak, '없음', '감지'),
      cooler: `냉각·열교환 ${v.enc.coolerOn ? '<b style="color:var(--accent)">동작</b>' : '대기'} · 제습 ${v.pdu.THERM && v.pdu.THERM.on ? '동작' : '정지'}${v.faults.cooling ? ' · <span style="color:var(--crit)">냉각 유닛 고장</span>' : ''} · 외기 ${G.ENV.ambientC}°C`,
      alink: v.activeLink ? `${G.LINKS[v.activeLink].name}` : '<span style="color:var(--crit)">없음</span>',
      video: v.activeLink && v.pdu.CAM && v.pdu.CAM.on ? G.LINKS[v.activeLink].video : '중단',
      buoy: v.buoyReleased ? '분리됨' : '거치',
      piwd: S.piw.detected ? `${Math.round(D.dist(v.x, v.y, S.piw.x, S.piw.y))}<small>m</small>` : '<span class="hint">미탐지</span>',
      oil: S.oil.reported ? `<span style="color:var(--crit)">유출유 의심 징후 보고됨 · 상황실 전송 완료</span>${v.oilHit ? ' · 현재 구역 내' : ''}` : (v.pdu.CAM.on && v.pdu.MC.on ? '이상 없음 · 영상 분석 중' : '<span style="color:var(--warn)">카메라/임무컴퓨터 꺼짐</span>'),
    };
    f.ctrl = !v.ctrl ? '<span style="color:var(--crit)">없음(두절)</span>' : v.ctrl === 'MCS' ? '<span style="color:#95de64">해상통제소 · 메시</span>' : `지상통제소 · ${G.LINKS[v.activeLink].name}`;
    f.mcsinfo = S.mcs.active ? `배치 · ${S.mcs.escort ? S.mcs.escort + ' 호위' : '대기'} · ${(S.mcs.spd * 1.944).toFixed(1)}kn${S.mcs.escort ? ` · 거리 ${(dist2(v, S.mcs) / 1000).toFixed(1)}km` : ''}` : '<span class="hint">미배치</span>';
    Object.keys(v.pdu).forEach((c) => (f['pdu:' + c] = v.pdu[c].on ? `${v.pdu[c].amps.toFixed(2)} A` : '<span class="hint">OFF</span>'));
    Object.entries(v.links).forEach(([l, L]) => {
      f['lst:' + l] = L.forcedDown ? '<span style="color:var(--crit)">차단</span>' : L.up ? `<span style="color:var(--ok)">연결</span>${l === 'MESH' && L.hops > 1 ? `<br><span class="hint">${L.hops}홉(${esc(L.via)} 중계)</span>` : ''}` : '<span style="color:var(--muted)">범위 밖</span>';
      f['lrssi:' + l] = rssiBars(L.rssi);
      f['llat:' + l] = L.latency ? `${L.latency}ms` : '—';
    });
    if (v.metocean) {
      const mo = v.metocean;
      f['mo:windDir'] = Math.round(mo.windDir); f['mo:windSpd'] = mo.windSpd.toFixed(1);
      f['mo:pressure'] = mo.pressure.toFixed(1); f['mo:airTemp'] = mo.airTemp.toFixed(1);
      f['mo:waterTemp'] = mo.waterTemp.toFixed(2); f['mo:salinity'] = mo.salinity.toFixed(2); f['mo:turbidity'] = mo.turbidity.toFixed(2);
    } else ['windDir', 'windSpd', 'pressure', 'airTemp', 'waterTemp', 'salinity', 'turbidity'].forEach((k) => (f['mo:' + k] = '—'));
    ['power', 'eth', 'can', 'latch'].forEach((k) => (f['bay:' + k] = ok(v.bay[k], k === 'latch' ? '잠금' : '연결', k === 'latch' ? '해제' : '끊김')));
    if (v.code === 'D') {
      const cs = v.contacts || [], unk = cs.filter((c) => !c.ais).length;
      f.dcontacts = v.pdu.RADAR.on ? `${cs.length}<small>척 · 미식별 </small><span style="color:var(--${unk ? 'crit' : 'ok'})">${unk}</span>` : '<span style="color:var(--warn)">레이더 꺼짐</span>';
      const I = S.intruder;
      f.dzone = !I || I.gone ? '<span style="color:var(--ok)">이상 없음</span>'
        : v.alarms.zoneIn ? '<span style="color:var(--crit)">침입 발생 · 상황실 보고됨</span>'
        : v.alarms.zoneNear ? '<span style="color:var(--warn)">접근 경고</span>'
        : I.detAt != null ? `<span style="color:var(--warn)">미식별 접촉 감시 중</span>` : '<span class="hint">감시 중</span>';
    }
    return f;
  }

  function refresh() {
    const v = G.selected();
    if (!v) return;
    const f = fields(v);
    const root = document.querySelector('.right');
    root.querySelectorAll('[data-f]').forEach((el) => {
      const val = f[el.dataset.f];
      if (val !== undefined && el.innerHTML !== String(val)) el.innerHTML = val;
    });
    const p = $('panel');
    const nl = link(v);
    p.querySelectorAll('[data-h="nolink"]').forEach((el) => { if (el.innerHTML !== nl) el.innerHTML = nl; });
    p.querySelectorAll('[data-modebtn]').forEach((b) => b.classList.toggle('on', b.dataset.modebtn === v.mode));
    p.querySelectorAll('[data-sw]').forEach((b) => {
      const [kind, key] = b.dataset.sw.split(':');
      const on = kind === 'pdu' ? v.pdu[key].on : kind === 'fault' ? v.faults[key] : kind === 'linkcut' ? v.links[key].forcedDown : kind === 'aistx' ? v.aisTx : kind === 'latch' ? v.bay.latch : false;
      b.classList.toggle('on', !!on);
    });
    p.querySelectorAll('[data-row^="link:"]').forEach((r) => r.classList.toggle('active', r.dataset.row === 'link:' + v.activeLink));
    const es = p.querySelector('[data-f-estop]');
    if (es) { const on = v.mode === 'ESTOP'; es.classList.toggle('reset', on); es.textContent = on ? '비상 차단 해제' : '⛔ 비상 차단 (추진 전원 차단)'; }
    const we = p.querySelector('[data-f-wpedit]'); if (we) we.classList.toggle('on', G.view.wpEdit);
    const bb = p.querySelector('[data-f-buoy]'); if (bb) bb.disabled = v.buoyReleased;
    p.querySelectorAll('[data-f-cam]').forEach((b) => b.classList.toggle('on', b.dataset.fCam === camMode));
    const sb = p.querySelector('[data-bar="soc"]');
    if (sb) { sb.style.width = (v.soc * 100).toFixed(1) + '%'; sb.style.background = v.soc < 0.15 ? 'var(--crit)' : v.soc < 0.3 ? 'var(--warn)' : 'var(--ok)'; }
    const bit = p.querySelector('[data-h="bit"]');
    if (bit) {
      const h = v.bit ? v.bit.results.map((r) => `<div class="biti"><span>${esc(r.name)}</span><span class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓' : '✗'} ${esc(r.detail)}</span></div>`).join('') + (v.bit.done ? '' : `<div class="hint">점검 중… ${v.bit.results.length}/${v.bit.total}</div>`) : '<div class="hint">점검 이력 없음</div>';
      if (bit.innerHTML !== h) bit.innerHTML = h;
    }
    const at = p.querySelector('[data-h="aistbl"]');
    if (at) {
      const D = G.util;
      const rows = S.ais.map((a) => ({ a, d: D.dist(v.x, v.y, a.x, a.y) })).sort((x, y) => x.d - y.d)
        .map(({ a, d }) => `<tr><td>${esc(a.name)}<br><span class="hint">${a.type} · ${a.mmsi}</span></td><td>${(d / 1852).toFixed(2)}NM</td><td>${Math.round(D.bearing(v.x, v.y, a.x, a.y))}°</td><td>${(a.sog * 1.944).toFixed(1)}kn</td></tr>`).join('');
      const h = `<tr><th>주변 선박</th><th>거리</th><th>방위</th><th>속력</th></tr>${rows}`;
      if (at.innerHTML !== h) at.innerHTML = h;
    }
    p.querySelectorAll('[data-spark]').forEach((c) => drawSpark(c, v, c.dataset.spark));
    const dt = p.querySelector('[data-h="dtable"]');
    if (dt) {
      const rows = (v.contacts || []).slice().sort((a, b) => (a.ais - b.ais) || (a.d - b.d)).map((c) =>
        `<tr${c.ais ? '' : ' style="color:var(--crit);font-weight:700"'}><td>${esc(c.name)}</td><td>${c.ais ? 'AIS 식별' : '미식별'}</td><td>${Math.round(c.brg)}°</td><td>${(c.d / 1852).toFixed(2)}NM</td></tr>`).join('');
      const h = `<tr><th>접촉</th><th>식별</th><th>방위</th><th>거리</th></tr>${rows || '<tr><td colspan="4" class="hint">레이더 범위(6km) 안 접촉 없음</td></tr>'}`;
      if (dt.innerHTML !== h) dt.innerHTML = h;
    }
    const mb = p.querySelector('[data-f-mcs]'); if (mb) { const on = S.mcs.active && S.mcs.escort === v.id; mb.classList.toggle('on', on); mb.textContent = on ? '해상통제소 철수' : '해상통제소 배치·이 선체 호위'; }
    const pb = p.querySelector('[data-f-pref]'); if (pb) pb.classList.toggle('on', !!v.prefMCS);
    const tb = p.querySelector('[data-f-track]'); if (tb) { tb.classList.toggle('on', !!v.tracking); tb.textContent = v.tracking ? '추적 감시 중(해제)' : '추적 감시'; }
  }

  function drawSpark(c, v, key) {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const h = (v.mohist || []).map((r) => r[key]);
    if (h.length < 2) return;
    const mn = Math.min(...h), mx = Math.max(...h), rg = mx - mn || 1;
    ctx.strokeStyle = '#36cfc9'; ctx.lineWidth = 1.5; ctx.beginPath();
    h.forEach((y, i) => { const px = (i / (h.length - 1)) * c.width, py = c.height - 4 - ((y - mn) / rg) * (c.height - 8); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
  }

  // ---------- 탐색 카메라 (모델 A) ----------
  function drawCam() {
    const c = document.getElementById('cam'); if (!c) return;
    const v = G.selected(); if (!v || v.code !== 'A') return;
    const ctx = c.getContext('2d'); const W = c.width, H = c.height;
    const live = v.activeLink && v.pdu.CAM.on && v.pdu.MC.on;
    const st = c.parentElement.querySelector('[data-f="camstat"]');
    if (!live) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#888'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(v.activeLink ? '카메라 전원 꺼짐' : '영상 수신 없음 (링크 두절)', W / 2, H / 2); ctx.textAlign = 'left';
      if (st) st.textContent = '';
      return;
    }
    const ir = camMode === 'ir';
    const hz = H * 0.38;
    const tt = performance.now() / 1000;
    if (ir) {
      let g = ctx.createLinearGradient(0, 0, 0, hz); g.addColorStop(0, '#1a1a1a'); g.addColorStop(1, '#3a3a3a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, hz);
      g = ctx.createLinearGradient(0, hz, 0, H); g.addColorStop(0, '#2b2b2b'); g.addColorStop(1, '#474747');
      ctx.fillStyle = g; ctx.fillRect(0, hz, W, H - hz);
    } else {
      let g = ctx.createLinearGradient(0, 0, 0, hz); g.addColorStop(0, '#7fb3e0'); g.addColorStop(1, '#cfe3f2');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, hz);
      g = ctx.createLinearGradient(0, hz, 0, H); g.addColorStop(0, '#2c5f86'); g.addColorStop(1, '#173a57');
      ctx.fillStyle = g; ctx.fillRect(0, hz, W, H - hz);
    }
    // 파도 질감
    ctx.globalAlpha = ir ? 0.12 : 0.18; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      const y = hz + ((i * 37 + tt * 18) % (H - hz));
      ctx.beginPath(); ctx.moveTo(((i * 91) % W) - 40, y); ctx.lineTo(((i * 91) % W) + 30 + (y - hz) * 0.4, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // 요구조자 표적
    const T = v.thermalTarget;
    const D = G.util;
    const d = D.dist(v.x, v.y, S.piw.x, S.piw.y);
    const rel = D.wrap180(D.bearing(v.x, v.y, S.piw.x, S.piw.y) - v.hdg);
    if (Math.abs(rel) < 35 && d < 900) {
      const px = W / 2 + (rel / 35) * (W / 2);
      const py = hz + (H - hz) * Math.min(0.9, 40 / Math.max(20, d)) + 4;
      const r = Math.max(2, 900 / Math.max(25, d));
      if (ir) {
        if (d < 450) {
          const g = ctx.createRadialGradient(px, py, 0, px, py, r * 2.2);
          g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, '#f0f0f0'); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r * 2.2, 0, Math.PI * 2); ctx.fill();
        }
      } else if (d < 220) {
        ctx.fillStyle = '#ff7a00'; ctx.beginPath(); ctx.arc(px, py, r * 0.8, 0, Math.PI * 2); ctx.fill();
      }
      if (T) {
        ctx.strokeStyle = '#ff4d4f'; ctx.lineWidth = 2; ctx.strokeRect(px - r * 3, py - r * 3, r * 6, r * 6);
        ctx.fillStyle = '#ff4d4f'; ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`PERSON ${Math.round(d)}m`, px - r * 3, py - r * 3 - 4);
      }
    }
    // 오버레이
    ctx.fillStyle = ir ? '#fff' : '#000'; ctx.font = '11px monospace';
    ctx.fillText(`${ir ? 'IR WHT-HOT' : 'EO DAY'}  HDG ${Math.round(v.hdg).toString().padStart(3, '0')}  ${(v.spd * 1.944).toFixed(1)}kn`, 8, 16);
    ctx.fillText(G.LINKS[v.activeLink].video, 8, H - 8);
    ctx.strokeStyle = ir ? '#fff' : '#000'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W / 2 - 10, H / 2); ctx.lineTo(W / 2 + 10, H / 2); ctx.moveTo(W / 2, H / 2 - 10); ctx.lineTo(W / 2, H / 2 + 10); ctx.stroke();
    if (st) st.textContent = T ? `열화상 표적 추적 중 · 상대방위 ${Math.round(rel)}° · ${Math.round(d)}m` : '탐색 중 (탐지 거리 ≈450m, 시야 ±35°)';
  }

  // ---------- 레이더 화면(PPI, 모델 D) ----------
  function drawPPI() {
    const c = document.getElementById('ppi'); if (!c) return;
    const v = G.selected(); if (!v || v.code !== 'D') return;
    const ctx = c.getContext('2d'), W = c.width, H = c.height, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 12;
    ctx.fillStyle = '#04110a'; ctx.fillRect(0, 0, W, H);
    const on = v.activeLink && v.pdu.RADAR.on && v.pdu.MC.on;
    if (!on) { ctx.fillStyle = '#888'; ctx.font = '15px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(v.activeLink ? '레이더 꺼짐' : '수신 없음 (링크 두절)', cx, cy); ctx.textAlign = 'left'; return; }
    const range = v.m.radarRange, k = R / range;
    ctx.strokeStyle = 'rgba(80,220,120,0.35)'; ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1].forEach((f) => { ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, Math.PI * 2); ctx.stroke(); });
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    // 북쪽 위(North-up). 경계구역 윤곽
    const P = (x, y) => [cx + (x - v.x) * k, cy - (y - v.y) * k];
    const Z = G.ZONE; const [zx0, zy0] = P(Z.x0, Z.ySea), [zx1] = P(Z.x1, Z.ySea), [, zyc] = P(0, G.coastY(Z.site.x));
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(255,77,79,0.12)'; ctx.fillRect(zx0, zyc, zx1 - zx0, zy0 - zyc);
    ctx.strokeStyle = 'rgba(255,77,79,0.7)'; ctx.strokeRect(zx0, zyc, zx1 - zx0, zy0 - zyc);
    // 해안 반사(육지)
    ctx.fillStyle = 'rgba(80,220,120,0.18)';
    ctx.beginPath(); for (let i = 0; i <= 40; i++) { const x = v.x - range + (2 * range * i) / 40; const [px, py] = P(x, G.coastY(x)); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.lineTo(W, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    // 회전 소인선
    const a = ((performance.now() / 1000) * 1.2) % (Math.PI * 2);
    const g = ctx.createConicGradient ? ctx.createConicGradient(a - Math.PI / 2 - 0.6, cx, cy) : null;
    if (g) { g.addColorStop(0, 'rgba(80,255,140,0)'); g.addColorStop(0.09, 'rgba(80,255,140,0.35)'); g.addColorStop(0.1, 'rgba(80,255,140,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill(); }
    // 접촉
    (v.contacts || []).forEach((t) => {
      const [px, py] = P(t.x, t.y);
      ctx.fillStyle = t.ais ? '#7dffb0' : '#ff4d4f';
      ctx.beginPath(); ctx.arc(px, py, t.ais ? 3.5 : 5, 0, Math.PI * 2); ctx.fill();
      ctx.font = '10px sans-serif'; ctx.fillText(t.ais ? t.name : '미식별', px + 7, py + 3);
    });
    ctx.restore();
    ctx.fillStyle = '#7dffb0'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = '11px monospace'; ctx.fillText(`RANGE ${(range / 1852).toFixed(1)}NM  N-UP  HDG ${Math.round(v.hdg).toString().padStart(3, '0')}`, 8, 16);
    ctx.fillText('N', cx - 3, cy - R - 2);
  }

  // ---------- 루프 ----------
  let last = performance.now(), acc = 0, uiAcc = 0;
  function frame(now) {
    const realDt = Math.min(0.25, (now - last) / 1000); last = now;
    if (!S.paused) {
      acc += realDt * S.timeScale;
      while (acc >= 0.1) { G.step(0.1); acc -= 0.1; }
    }
    G.mapDraw();
    $('simTime').textContent = fmtT(S.t);
    uiAcc += realDt;
    if (uiAcc > 0.25) {
      uiAcc = 0;
      renderFleet(); renderAlarms(); refresh(); renderScenario();
    }
    if (tab === 'mission') { drawCam(); drawPPI(); }
    requestAnimationFrame(frame);
  }

  // ---------- 검증 시나리오 ----------
  const pick = $('scnPick');
  Object.entries(G.SCENARIOS).forEach(([id, s]) => pick.add(new Option(`${s.title} · ${s.reqs.join(', ')}`, id)));
  pick.addEventListener('change', () => {
    const q = new URLSearchParams(location.search);
    if (pick.value) q.set('scenario', pick.value); else q.delete('scenario');
    location.search = q.toString();
  });
  let scnMin = false, scnSave = '';
  function renderScenario() {
    const run = G.scenario, box = $('scn');
    if (!run) { box.hidden = true; return; }
    const d = run.def, r = run.result;
    const label = { running: '진행 중', pass: '합격', fail: '불합격' }[r.status];
    const save = G.center.available
      ? `<button data-scn="save" ${r.status === 'running' ? 'disabled title="결과가 나온 뒤 저장할 수 있습니다"' : ''}>what's next에 기록 저장</button>` : '';
    const h = `<div class="hd"><b>${esc(d.title)}</b><button data-scn="min">${scnMin ? '펼치기' : '접기'}</button></div>
      <div class="hint">${esc(d.stage)} · ${d.reqs.map(esc).join(', ')}</div>
      <ol>${d.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="crit">합격 기준: ${esc(d.criteria)}</div>
      <div class="res ${r.status}">${label}<small>${esc(r.detail || '시험 진행 중…')}</small></div>
      <div class="btnrow"><button data-scn="restart">다시 시작</button>${save}${scnSave ? `<span class="hint">${esc(scnSave)}</span>` : ''}</div>`;
    if (box.innerHTML !== h) box.innerHTML = h;
    box.hidden = false;
    box.classList.toggle('min', scnMin);
  }
  $('scn').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-scn]'); if (!b || b.disabled) return;
    if (b.dataset.scn === 'min') scnMin = !scnMin;
    if (b.dataset.scn === 'restart') location.reload();
    if (b.dataset.scn === 'save') {
      b.disabled = true; scnSave = '저장 중…'; renderScenario();
      try { await G.saveRun(); scnSave = '저장됨 ✓'; } catch (err) { scnSave = err.message; }
    }
    renderScenario();
  });
  G.onCenter = () => {
    // what's next(/sim/)에서 열린 경우: 돌아가기 링크
    const a = document.createElement('a');
    a.className = 'backlink'; a.href = '../#sim'; a.target = '_top'; a.textContent = '← 수상드론 what\'s next';
    document.querySelector('.brand > div').append(a);
    renderScenario();
  };

  G.init();
  G.scenarioStart();
  if (G.scenario) {
    pick.value = G.scenario.id;
    const ts = G.scenario.def.speed || 1;
    if (ts !== 1) document.querySelector(`#speed [data-ts="${ts}"]`).click();
  }
  G.mapInit($('map'));
  structural();
  renderScenario();
  renderEvents();
  requestAnimationFrame(frame);
})();
