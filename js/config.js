// 수상드론 공통 플랫폼 — 모델·환경 설정 (PRD 3·5·6장 기준, 수치는 모두 초기 목표안)
const GCS = window.GCS || (window.GCS = {});

GCS.BASE = { lat: 35.05, lon: 129.10 }; // 부산 규제자유특구 인근 해역(가상 원점)

GCS.MODELS = {
  A: {
    code: 'A', name: 'A 인명구조형', short: '구조', lengthM: 3, color: '#ff7a45',
    maxSpeed: 8.0, cruise: 0.7, maxTurn: 28, propMaxW: 3200,
    batteryWh: 1800, enduranceTargetH: 1,
    links: ['LTE', 'MESH'], aisTx: true, colav: false,
    channels: ['PROP', 'FC', 'MC', 'COMM', 'CAM', 'THERM', 'LIGHT'],
    features: ['thermal', 'buoy'],
  },
  B: {
    code: 'B', name: 'B 해양관측형', short: '관측', lengthM: 6, color: '#36cfc9',
    maxSpeed: 5.0, cruise: 0.5, maxTurn: 12, propMaxW: 4000,
    batteryWh: 8000, enduranceTargetH: 8,
    links: ['LTE', 'MESH', 'SAT'], aisTx: true, colav: true,
    channels: ['PROP', 'FC', 'MC', 'COMM', 'CAM', 'SENS', 'THERM', 'LIGHT'],
    features: ['metocean', 'oil'],
  },
  C: {
    code: 'C', name: 'C 군용 저가 소모형', short: '플랫폼', lengthM: 6.5, color: '#b37feb',
    maxSpeed: 12.0, cruise: 0.7, maxTurn: 15, propMaxW: 12000,
    batteryWh: 10000, enduranceTargetH: null, // 수요군 ROC에 따름
    links: ['MESH', 'SAT', 'LTE'], aisTx: false, colav: true,
    channels: ['PROP', 'FC', 'MC', 'COMM', 'CAM', 'THERM', 'BAY', 'LIGHT'],
    features: ['bay'],
  },
  D: {
    code: 'D', name: 'D 국가중요시설 감시형', short: '경계', lengthM: 4.5, color: '#9b8cff',
    maxSpeed: 7.0, cruise: 0.45, maxTurn: 20, propMaxW: 3000,
    batteryWh: 6000, enduranceTargetH: 8,
    links: ['LTE', 'MESH', 'SAT'], aisTx: true, colav: true,
    channels: ['PROP', 'FC', 'MC', 'COMM', 'CAM', 'RADAR', 'SPK', 'THERM', 'LIGHT'],
    features: ['radar', 'patrol'],
    radarRange: 6000, eoRange: 1500, warnRange: 1500,
  },
};

// PDU 채널 (IF-09: 주전원 48V, 보조 24·12·5V)
GCS.CHANNELS = {
  PROP:  { name: '추진 모터',      rail: 48, essential: false, baseW: 0 },
  FC:    { name: '운항 제어기',    rail: 12, essential: true,  baseW: 10 },
  MC:    { name: '임무 컴퓨터',    rail: 12, essential: false, baseW: 40 },
  COMM:  { name: '통신(링크 관리기)', rail: 12, essential: true, baseW: 25 },
  CAM:   { name: 'EO/IR 카메라',   rail: 24, essential: false, baseW: 20 },
  SENS:  { name: '관측 센서(NMEA)', rail: 12, essential: false, baseW: 15 },
  THERM: { name: '열관리·제습',    rail: 24, essential: false, baseW: 5 },
  BAY:   { name: '임무 베이',      rail: 48, essential: false, baseW: 50 },
  LIGHT: { name: '항해등',         rail: 12, essential: false, baseW: 10 },
  RADAR: { name: '해상 레이더',    rail: 24, essential: false, baseW: 60 },
  SPK:   { name: '경고 방송·탐조등', rail: 24, essential: false, baseW: 5 },
};

// 링크 특성 (IF-01~03)
GCS.LINKS = {
  LTE:  { name: 'LTE/5G',  role: '주 링크',  rangeOffshore: 12000, video: '1080p H.265 · 4.0 Mbps' },
  MESH: { name: '메시 무전', role: '예비 링크', range: 6000,        video: '720p H.264 · 1.5 Mbps' },
  SAT:  { name: '위성',     role: '예비 링크', latency: 650,         video: '360p H.264 · 0.3 Mbps' },
};

GCS.MODES = {
  MANUAL: '수동',
  AUTO: '자율(경로점)',
  HOLD: '정지·표류',
  RTL: '지정점 복귀',
  ESTOP: '비상 차단',
};

GCS.ENV = {
  current: { x: 0.15, y: -0.10 }, // 해류 m/s
  ambientC: 31,                   // 여름 최악 조건(고온·고습)
  geofenceM: 150,                 // 해안 접근 경고 거리
};

// 해안선: 북쪽이 육지. y > coastY(x) 이면 육지
GCS.coastY = function (x) {
  return 1500 + 420 * Math.sin(x / 1800) + 220 * Math.sin(x / 700 + 1.3) + 90 * Math.sin(x / 260);
};
GCS.isLand = function (x, y) { return y > GCS.coastY(x); };

// 국가중요시설(가상) 경계구역: 원전 취·배수구 앞 해역. 해안선부터 바다 쪽 y=-700 까지
GCS.ZONE = { x0: 2600, x1: 6000, ySea: -700, buffer: 800, site: { x: 4300, name: '가상 원전(국가중요시설)' } };
GCS.inZone = function (x, y, extra = 0) {
  const Z = GCS.ZONE;
  return x >= Z.x0 - extra && x <= Z.x1 + extra && y >= Z.ySea - extra && y <= GCS.coastY(x);
};

GCS.HOME = { x: 0, y: 1150 };       // 진수·복귀 지정점
GCS.GCS_POS = { x: 120, y: 1750 };  // 지상통제소(육상)

GCS.toLatLon = function (x, y) {
  const lat = GCS.BASE.lat + y / 111320;
  const lon = GCS.BASE.lon + x / (111320 * Math.cos(GCS.BASE.lat * Math.PI / 180));
  return { lat, lon };
};
GCS.fmtLatLon = function (x, y) {
  const p = GCS.toLatLon(x, y);
  const f = (v, pos, neg) => {
    const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
    return `${d}°${m.toFixed(3)}'${v >= 0 ? pos : neg}`;
  };
  return `${f(p.lat, 'N', 'S')} ${f(p.lon, 'E', 'W')}`;
};
