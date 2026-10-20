// 검증 시나리오: PRD 9장 검증 계획을 시뮬레이터에서 미리 돌려 보는 리허설
// 사용: index.html?scenario=failover  (목록은 G.SCENARIOS)
// what's next 안에서(/sim/) 열리면 결과를 센터 DB(simruns)에 저장할 수 있다.
(function () {
  const G = window.GCS;
  const S = G.state;
  const V = (code) => S.vessels.find((v) => v.code === code);
  const at = (t, fn) => ({ t, fn, done: false });
  const pass = (detail) => ({ status: 'pass', detail });
  const fail = (detail) => ({ status: 'fail', detail });
  const note = (v, msg) => G.log(v, 'warn', `[시나리오] ${msg}`);

  const SC = {
    failover: {
      title: '링크 자동 전환', reqs: ['COM-03'], stage: '통합 시험', speed: 1,
      steps: ['A-01이 주 링크(LTE)로 자율 순항', '10초에 시험 장비가 LTE를 강제 차단', '링크 관리기가 예비 링크(메시)로 자동 전환하는지 확인'],
      criteria: '차단 후 2초 이내 예비 링크로 자동 전환',
      setup() { const a = V('A'); S.selectedId = a.id; a.wps = [{ x: -700, y: -1200 }, { x: 700, y: -1200 }]; a.mode = 'AUTO'; },
      actions: [at(10, () => { const a = V('A'); a.links.LTE.forcedDown = true; note(a, '시험 장비: LTE 링크 강제 차단'); })],
      check() {
        const a = V('A');
        if (S.t < 10) return;
        if (a.activeLink && a.activeLink !== 'LTE') return pass(`차단 후 ${(S.t - 10).toFixed(1)}초 만에 예비 링크(${G.LINKS[a.activeLink].name})로 전환`);
        if (S.t > 12) return fail('2초 안에 예비 링크로 전환되지 않음');
      },
    },
    failsafe: {
      title: '통신 두절 안전 동작', reqs: ['COM-04'], stage: '통합 시험', speed: 1,
      steps: ['A-01이 외해 쪽으로 자율 순항(안전 동작: 15초 후 지정점 복귀)', '20초에 주·예비 링크를 모두 차단', '설정 시간이 지나면 지정점 복귀가 시작되는지 확인', '70초에 링크 복구'],
      criteria: '두절 후 설정 시간(15초)+1초 이내 지정점 복귀 시작',
      setup() { const a = V('A'); S.selectedId = a.id; a.failsafe = { timeout: 15, action: 'RTL' }; a.wps = [{ x: -200, y: -3500 }]; a.mode = 'AUTO'; },
      actions: [
        at(20, () => { const a = V('A'); a.links.LTE.forcedDown = true; a.links.MESH.forcedDown = true; note(a, '시험 장비: 모든 링크 차단'); }),
        at(70, () => { const a = V('A'); a.links.LTE.forcedDown = false; a.links.MESH.forcedDown = false; note(a, '시험 장비: 링크 복구'); }),
      ],
      check() {
        const a = V('A');
        if (S.t < 20) return;
        if (a.mode === 'RTL' && a.failsafeFired) {
          const lag = S.t - 20;
          return lag <= a.failsafe.timeout + 1 ? pass(`두절 ${lag.toFixed(1)}초 후 지정점 복귀 시작`) : fail(`복귀 시작이 늦음(${lag.toFixed(1)}초)`);
        }
        if (S.t > 20 + a.failsafe.timeout + 2) return fail('설정 시간이 지나도 안전 동작이 실행되지 않음');
      },
    },
    health: {
      title: '상태감시·경보', reqs: ['COM-05', 'COM-07'], stage: '모듈 시험', speed: 1,
      steps: ['C-01 정박 상태에서 상태감시 화면 확인', '10초에 전장 함체 누수 주입', '20초에 배터리 셀 이상 주입', '각 경보가 지상통제소에 뜨는지 확인'],
      criteria: '고장 주입 후 1초 이내 위험 경보 표시',
      setup() { S.selectedId = V('C').id; this.seen = {}; },
      actions: [
        at(10, () => { const c = V('C'); c.faults.leak = true; note(c, '누수 주입'); }),
        at(20, () => { const c = V('C'); c.faults.cell = true; note(c, '셀 이상 주입'); }),
      ],
      check() {
        const c = V('C');
        if (c.alarms.leak && !this.seen.leak) this.seen.leak = S.t - 10;
        if (c.alarms.cell && !this.seen.cell) this.seen.cell = S.t - 20;
        if (this.seen.leak != null && this.seen.cell != null) {
          const worst = Math.max(this.seen.leak, this.seen.cell);
          return worst <= 1 ? pass(`누수 ${this.seen.leak.toFixed(1)}초, 셀 이상 ${this.seen.cell.toFixed(1)}초 만에 경보`) : fail(`경보 지연 ${worst.toFixed(1)}초`);
        }
        if (S.t > 24) return fail('경보가 표시되지 않음');
      },
    },
    multi: {
      title: '1인 다척 운용', reqs: ['COM-09'], stage: '통합 시험', speed: 5,
      steps: ['A·B·C 3척을 동시에 자율 순항', '운용자 1명이 선단 목록·경보만으로 감시', '3척이 3분 동안 링크를 유지한 채 자율 운항하는지 확인'],
      criteria: '3척 동시 자율 운항 3분 연속 유지(통신 두절 없음)',
      setup() {
        const a = V('A'), c = V('C');
        a.wps = [{ x: 1200, y: -800 }, { x: 1200, y: -2200 }, { x: 0, y: -2200 }]; a.mode = 'AUTO';
        c.wps = [{ x: -1500, y: -600 }, { x: -1500, y: -2600 }, { x: 600, y: -2600 }]; c.mode = 'AUTO';
        this.since = null;
      },
      check() {
        const ok = S.vessels.slice(0, 3).every((v) => v.mode === 'AUTO' && v.activeLink);
        if (!ok) { this.since = null; return S.t > 30 ? fail('자율 운항 또는 링크가 중단됨') : undefined; }
        if (this.since == null) this.since = S.t;
        if (S.t - this.since >= 180) return pass('3척 동시 자율 운항 3분 유지');
      },
    },
    bit: {
      title: '장기 보관 후 점검', reqs: ['C 보관·전개'], stage: '모듈 시험', speed: 1,
      steps: ['장기 보관에서 꺼낸 C-01을 진수', '3초에 지상통제소에서 자체 점검(BIT) 실행', '전 항목 정상인지 확인'],
      criteria: '자체 점검 전 항목 정상',
      setup() { S.selectedId = V('C').id; },
      actions: [at(3, () => G.runBIT(V('C')))],
      check() {
        const b = V('C').bit;
        if (!b || !b.done) return;
        const ng = b.results.filter((r) => !r.ok).map((r) => r.name);
        return ng.length ? fail(`이상 항목: ${ng.join(', ')}`) : pass(`${b.results.length}개 항목 정상`);
      },
    },
    rescue: {
      title: '인명구조 임무', reqs: ['A 탐색', 'A 구조'], stage: '실해역 시험 리허설', speed: 5,
      steps: ['A-01이 수색 구역으로 자율 순항', '임무 탭 열화상으로 요구조자 탐지', "'탐지 지점으로'를 눌러 접근(운항 탭)", '40m 이내에서 구조부이 분리'],
      criteria: '구조부이를 요구조자 40m 이내에 전달',
      setup() {
        const a = V('A'); S.selectedId = a.id;
        a.wps = [{ x: 1300, y: -1100 }, { x: 2700, y: -1100 }, { x: 2700, y: -1500 }, { x: 1300, y: -1500 }, { x: 1300, y: -1900 }, { x: 2700, y: -1900 }, { x: 2700, y: -2300 }, { x: 1300, y: -2300 }];
        a.mode = 'AUTO';
      },
      check() {
        if (S.piw.rescued) return pass(`임무 시간 ${Math.floor(S.t / 60)}분에 구조부이 전달`);
        if (S.vessels.some((v) => v.buoyReleased)) return fail('구조부이가 요구조자에게서 너무 멀리 분리됨');
      },
    },
    oil: {
      title: '유출유 감시 순항', reqs: ['B 자율 순항', 'B 관측 센서', 'IF-10'], stage: '실해역 시험 리허설', speed: 60,
      steps: ['B-01이 관측 구역을 경로점으로 자율 순항', '기상·수질 자료 수집(임무 탭)', '유출유 의심 징후를 감지하면 상황실에 경보 전송'],
      criteria: '순항 중 유출유를 감지해 상황실 경보 전송',
      setup() { S.selectedId = V('B').id; },
      check() {
        const b = V('B');
        if (S.oil.reported) return pass(`임무 시간 ${Math.floor(S.t / 60)}분에 감지·상황실 전송`);
        if (b.mode === 'HOLD' && b.wpIdx >= b.wps.length) return fail('경로를 마쳤으나 감지하지 못함');
      },
    },
    colav: {
      title: 'AIS 충돌 회피', reqs: ['B 자율 순항'], stage: '통합 시험', speed: 5,
      steps: ['B-01과 화물선(HANJIN STAR)이 정면으로 마주 오는 상황', '자율 SW가 CPA/TCPA를 계산해 우현으로 변침', '최근접 거리 확인'],
      criteria: '최근접 거리 150m 이상 유지',
      setup() {
        const b = V('B'), s = S.ais[0], r = Math.PI / 180;
        S.selectedId = b.id;
        b.x = s.x + Math.sin(s.cog * r) * 1500; b.y = s.y + Math.cos(s.cog * r) * 1500; b.hdg = (s.cog + 180) % 360; b.spd = 2.5;
        b.wps = [{ x: s.x - Math.sin(s.cog * r) * 800, y: s.y - Math.cos(s.cog * r) * 800 }]; b.wpIdx = 0; b.mode = 'AUTO';
        b.trail = [];
        this.minD = Infinity; this.prev = Infinity;
      },
      check() {
        const b = V('B'), s = S.ais[0];
        const d = Math.hypot(b.x - s.x, b.y - s.y);
        this.minD = Math.min(this.minD, d);
        const opening = d > this.prev; this.prev = d;
        if (opening && this.minD < 1200 && d > this.minD + 150) {
          return this.minD >= 150 ? pass(`최근접 ${Math.round(this.minD)}m로 통과`) : fail(`최근접 ${Math.round(this.minD)}m (기준 150m 미만)`);
        }
      },
    },
    intrusion: {
      title: '경계구역 침입 대응', reqs: ['D 탐지·식별', 'D 경계구역', 'D 비살상 대응', 'IF-10'], stage: '실해역 시험 리허설', speed: 20,
      steps: ['D-01이 원전 앞 경계구역 둘레를 반복 순찰', '30초에 AIS를 끈 선박이 외해에서 시설 쪽으로 접근', '레이더로 구역 진입 전에 탐지하고, 진입 시 상황실에 자동 보고', '임무 탭에서 추적 감시·경고 방송으로 이탈 유도'],
      criteria: '구역 진입 1분 이상 전에 탐지 + 진입 즉시 상황실 보고 + 경고 후 구역 이탈',
      setup() { const d = V('D'); S.selectedId = d.id; d.wps = G.patrolRoute(); d.wpIdx = 0; d.mode = 'AUTO'; },
      actions: [at(30, () => G.spawnIntruder())],
      check() {
        const I = S.intruder;
        if (!I) return;
        if (I.enteredAt != null && (I.detAt == null || I.enteredAt - I.detAt < 60)) return fail(I.detAt == null ? '구역 진입 전까지 탐지하지 못함' : `조기경보 부족(진입 ${Math.round(I.enteredAt - I.detAt)}초 전 탐지)`);
        if (I.enteredAt != null && I.reportedAt == null && S.t - I.enteredAt > 5) return fail('구역 진입 후 5초 안에 상황실 보고 안 됨');
        if (I.gone) {
          const lead = I.enteredAt != null ? Math.round(I.enteredAt - I.detAt) : null;
          return I.warnedAt != null ? pass(`진입 ${lead != null ? lead + '초 전' : '전'} 탐지 · ${I.enteredAt != null ? '진입 즉시 보고 · ' : '진입 전 '}경고 후 이탈`) : fail('경고 없이 상황 종료');
        }
        if (S.t - (I.spawnAt || 0) > 3600) return fail('1시간 안에 상황 종료되지 않음(경고 방송 필요)');
      },
    },
    seactrl: {
      title: '해상통제소 인계(외해 운용)', reqs: ['COM-03', 'COM-04', '해상통제소'], stage: '통합 시험', speed: 20,
      steps: ['B-01이 외해 관측 지점(연안 LTE·지상 메시 밖)으로 출발 — 위성은 미가입(가정)', '해상통제소(지원함)가 B-01을 1.5km 앞서 호위', 'LTE가 끊기면 통제권이 해상통제소(메시)로 자동 인계', '두절 없이 외해 지점 도달'],
      criteria: '통제권 자동 인계 + 통신 두절 0초 + 외해 지점 도달',
      setup() {
        const b = V('B'); S.selectedId = b.id; b.links.SAT.forcedDown = true;
        b.wps = [{ x: 1500, y: -6000 }, { x: 3000, y: -12000 }, { x: 4000, y: -16500 }]; b.wpIdx = 0; b.mode = 'AUTO';
        G.setMCS(true, b.id);
        this.lost = 0; this.handed = false;
      },
      check() {
        const b = V('B');
        if (!b.activeLink) this.lost += 0.1;
        if (b.ctrl === 'MCS') this.handed = true;
        if (this.lost > 0.5) return fail(`통신 두절 ${this.lost.toFixed(1)}초`);
        if (b.mode === 'HOLD' && b.wpIdx >= b.wps.length) return this.handed && b.ctrl === 'MCS' ? pass(`해안에서 ${((G.coastY(b.x) - b.y) / 1000).toFixed(1)}km · 해상통제소 통제 · 두절 0초`) : fail('외해에서 해상통제소 통제가 아님');
      },
    },
  };
  G.SCENARIOS = SC;

  // ---------- 실행기 ----------
  const id = new URLSearchParams(location.search).get('scenario');
  const run = G.scenario = id && SC[id] ? { id, def: SC[id], result: { status: 'running', detail: '' }, startedAt: new Date().toISOString() } : null;

  G.scenarioStart = function () {
    if (!run) return;
    run.def.setup.call(run.def);
    G.log(null, 'info', `시나리오 시작: ${run.def.title} (${run.def.reqs.join(', ')})`);
  };

  const step = G.step;
  G.step = function (dt) {
    step(dt);
    if (!run || run.result.status !== 'running') return;
    (run.def.actions || []).forEach((a) => { if (!a.done && S.t >= a.t) { a.done = true; a.fn(); } });
    const r = run.def.check.call(run.def);
    if (r) {
      run.result = { ...r, simTime: +S.t.toFixed(1) };
      G.log(null, r.status === 'pass' ? 'info' : 'crit', `시나리오 ${r.status === 'pass' ? '합격' : '불합격'}: ${r.detail}`);
    }
  };

  // ---------- PRD 센터 연동(같은 서버의 /api 가 있을 때만) ----------
  const API = '../api/';
  G.center = { available: false };
  if (location.protocol.startsWith('http')) {
    fetch(API + 'db/simruns', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : null))
      .then((j) => { if (Array.isArray(j)) { G.center.available = true; G.onCenter && G.onCenter(); } })
      .catch(() => {});
  }
  G.saveRun = async function () {
    if (!run || !G.center.available) return false;
    const docId = `${run.id}-${Date.now()}`;
    const body = {
      scenario: run.id, title: run.def.title, reqs: run.def.reqs.join(', '), stage: run.def.stage,
      criteria: run.def.criteria,
      result: run.result.status === 'pass' ? '합격' : run.result.status === 'fail' ? '불합격' : '진행 중',
      detail: run.result.detail || '', simTime: +S.t.toFixed(1),
      savedAt: new Date().toISOString(), source: 'simulator',
      log: S.events.filter((e) => e.level !== 'info' || e.msg.startsWith('시나리오')).slice(-40).map((e) => `${e.t.toFixed(1)}s ${e.id} ${e.msg}`),
    };
    const r = await fetch(API + 'db/simruns/' + encodeURIComponent(docId), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('저장 실패(' + r.status + ')');
    G.log(null, 'info', "what's next에 시험 기록 저장");
    return true;
  };
})();
