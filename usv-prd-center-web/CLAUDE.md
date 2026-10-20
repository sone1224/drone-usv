# CLAUDE.md — 수상드론 what's next (웹 버전)

이 저장소는 claude.ai 아티팩트 「수상드론 what's next」를 자체 호스팅 웹앱으로 옮긴 것이다.
Claude Code는 이 파일을 먼저 읽고 작업한다.

## 회사·사업 맥락 (변경 금지 원칙)
- 부산 소재 중소기업(AI/드론 연구소). 2027년 초 수상드론 프로토타입 목표. 매출·인력·실적 등 상세 역량은 data/db/company.json(공개 저장소에 올리지 않음, 화면 '제안서 작성 → 회사 역량'에서 입력)에 둔다.
- 모델 4종(공통 플랫폼): A 인명구조형 3m급(해경·소방), B 해양관측형 6m급(해수부·지자체), C 군용 저가 소모형 플랫폼 6~7m급 이하(국방), D 국가중요시설 감시·정찰형 4~5m급(안)(원전 운영사·항만공사·해경).
- **원칙 1: 모든 제품에서 중국산 부품 배제.**
- **원칙 2: 모델 C는 플랫폼·임무 베이 인터페이스까지만 다룬다.** 탄두·신관·유도·표적화 설계는 정부 지정 체계업체 소관이며, 이 코드베이스·생성 프롬프트에서 다루지 않는다. 모델 D는 감시·정찰과 비살상 경고(방송·탐조등)까지만 다루며 무장·차단 장비는 다루지 않는다.
- **원칙 3: 사실을 지어내지 않는다.** 근거 없는 수치·일정·예산은 `[확인 필요]` 또는 "확인 필요".
- 관심기관: 국방부, 방위사업청, 해양경찰청, 소방청, 해양수산부, 국과연(ADD), 국기연(KRIT), 기품원(DTaQ).

## 구조
```
public/index.html      페이지(아티팩트 원본을 그대로 옮김: HTML+CSS+JS 단일 파일)
public/claude-shim.js  window.claude.use() 호환 계층 → 서버 API 연결 (페이지 수정 없이 동작)
public/sim/            지상통제소 시뮬레이터(정적) + busan.html(부산 실지도 운용, js/busan.js). 원본은 상위 폴더, scripts/sync-sim.ps1 로 복사 — public/sim 을 직접 고치지 말 것
                       해상통제소(MCS): 지원함 탑재 이동형 통제소. 시뮬레이터 통신 탭·seactrl 시나리오, 부산 실지도 mcs-* 시나리오
                       부산 실지도: GOOGLE_MAPS_API_KEY(.env) 있으면 Google Maps, 없으면 Leaflet+OpenStreetMap·Esri 위성. 표적·구역은 훈련용 가상 설정
                       부산 시나리오 id 는 index.html 의 BUSAN 배열과 맞춘다(기록은 simruns 에 scenario=busan-<id>)
                       검증 시나리오 정의: sim/js/scenarios.js (id 는 index.html 의 SC 배열과 맞춘다)
docker-compose.yml, Caddyfile, DEPLOY.md  배포(앱 + Caddy HTTPS)
public/tools/usv_hull_designer_magura.html  선체 설계·단가 시뮬레이터(메뉴 design). 원본은 사용자 제공 파일, 상단 돌아가기 링크·사진 URL 안전 처리만 추가. three.js 는 unpkg 에서 불러옴
public/img/ours/model-{a,b,c,d}.jpg  당사 모델 가상 프로토타입(3D 렌더링, 실물 아님). public/tools/ours-3d.html(three.js 물리 기반 렌더러)에서 모델을 고르고 '사진(JPG) 저장'으로 다시 만든다
                       참고: 당사 시제품(무광 검정 각진 선체·선수 파노라마 카메라·흰 EO/IR 짐벌·위성 평판·선미 장비함·안테나 기둥·선외기)과 디자인 포스터(경사 핀 타워). 모델 C는 임무 베이 덮개까지만, 모델 D는 레이더·탐조등·스피커까지만 그린다(무장 금지)
server/server.js       Express: JSON 저장소 + SSE, /api/sample(Claude 프록시), /api/assets(업로드)
data/db/*.json         컬렉션별 데이터 {docId: {...fields, _v}}
data/uploads/          사용자가 올린 제품 사진
docs/PRD.md|docx|pdf   제품요구사항문서(설계도 4장은 docx/pdf에만 있음)
docs/daily-update-prompt.md  매일 갱신 작업 프롬프트(웹 버전용)
scripts/daily-update.sh      위 프롬프트를 Claude Code 헤드리스로 실행
scripts/smoke.mjs            API 스모크 테스트
```

## 페이지 메뉴 ↔ 데이터
| 그룹 | 메뉴(section id) | 컬렉션 |
|---|---|---|
| 개요 | home | 모두 요약 |
| 사업·과제 | mon(과제 모니터링), prop(제안서 작성) | calls, drafts, meta/status, company/profile |
| 시장·전황 | bench(경쟁·참고 제품), war(전황), sites(주요 사이트, 정적) | products, news, war |
| 법규·규정 | law | laws |
| PRD | req, arch, elem, comm, icd, verify | 페이지 안 상수 `D` (정적) |
| PRD | sim(운용 시뮬레이터) | simruns (시뮬레이터가 PUT /api/db/simruns/:id 로 저장) |

### 필드 스키마
- calls: title, agency, category(국가/지자체/산학연/동향), status(접수중/예정/마감/참고), posted, deadline(YYYY-MM-DD), budget, focus, fit(1~5), relevance, next, url
- drafts: md, source(auto/manual), updated
- products: domain(수상/수중/공중), role, name, maker, country, length, speed, range, payload, cost, status, compare(A/B/C/D/B·C/참고), note, url, updated, order, [shape], [photo, photoId, photoCredit, photoSource, photoNote — 사진. 자동 작업이 덮어쓰지 말 것. photoId 있으면 직접 업로드, 없으면 위키미디어 공용 자유 이용 사진(photoCredit에 저작자·라이선스, photoSource에 파일 페이지). photoNote가 있으면 실물이 아닌 '유사 기종' 사진이며 카드에 그대로 표시된다]
- news: date, theater(우-러/미-이란/일반), domain(수상/수중/공중/전체), type(기사/동영상), title, source, summary, lesson, url, added
- war/{ua,ir}: title, summary, lessons[], updated
- laws: cat, name, what, applies("A·B·C·D" 중 해당), action, status, url, order, updated
- meta/status: lastRun, note / company/profile: text, updated
- simruns: scenario, title, reqs, stage, criteria, result(합격/불합격/진행 중), detail, simTime(초), savedAt(ISO), source, log[] — 시뮬레이터 결과이며 실물 시험 결과가 아님

## 실행
```
cp .env.example .env   # ANTHROPIC_API_KEY, ANTHROPIC_MODEL, (외부 공개 시) APP_PASSWORD
npm install
npm start              # http://localhost:3000
npm run smoke          # 다른 터미널에서
```

## 다음 작업 후보 (우선순위 순)
1. **배포**: docker-compose.yml(앱 + Caddy) 준비됨 → DEPLOY.md. production 에서 APP_PASSWORD 없으면 서버가 시작하지 않음. 이후 정식 로그인(사내 SSO 등)으로 교체.
2. **매일 갱신 자동화**: `scripts/daily-update.sh`를 cron(평일 08:52 KST 등)으로 실행. claude.ai 예약 작업(trig_01Ruq6qmAKYTrYSc6hpreEXz)은 아티팩트 DB를 갱신하므로, 웹 버전으로 완전히 넘어오면 claude.ai 쪽은 끄고 이쪽만 운영(이중 운영 시 데이터가 갈라짐).
3. **저장소 교체**: 사용자 늘면 JSON 파일 → SQLite(better-sqlite3) 또는 Postgres. API 형태(`/api/db/:col/:id`, SSE)는 유지하면 페이지·shim 수정 불필요.
4. **페이지 분리(선택)**: index.html이 큼(약 75KB). 유지보수가 필요해지면 CSS/JS를 파일로 분리하거나 Vite로 옮기되, 동작·디자인 토큰(:root 변수, 다크모드)을 유지.
5. **제품 사진**: 현재 형상 일러스트 + 사용자 업로드. 자유 이용 사진(위키미디어 공용 등)을 쓰면 photoCredit에 저작자·라이선스 표기.
6. **보안**: /api/sample 남용 방지(인증 뒤에 두기, 요청 횟수 제한), 업로드 크기·형식 제한 유지, 쓰기 API에 인증 추가.
7. PRD 정적 상수 `D`를 data/db/prd.json으로 옮겨 편집 가능하게.

## 문구 원칙(홈페이지)
- 머리말·설명은 짧은 홈페이지 문구로 쓴다(문어체 '~한다' 금지). 핵심 가치는 <span class="hl">(파랑), 다짐·주의는 <span class="hl-a">(주황).
- 개요의 '우리의 다짐'(목표·비전·원칙·다짐 문구)은 회사가 정한 선언문이다. 근거 없는 수치·실적을 더하지 않는다.

## 주의
- 페이지 코드는 아티팩트 런타임 규약(`window.claude.use(name)` → 없으면 null)을 따른다. shim이 그 규약을 흉내 내므로, 새 기능도 같은 패턴으로 쓰면 아티팩트와 웹 양쪽에서 동작한다.
- 외부 링크(PRD 원문 Docs, 제안서, 발표자료)는 claude.ai 주소다. 로그인한 소유자만 열 수 있다.
- 교전 당사국 발표는 '주장'으로 표기한다. 법규 정리는 법률 자문이 아니다.
