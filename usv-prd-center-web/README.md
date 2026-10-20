# 수상드론 what's next (웹 버전)

과제 모니터링·제안서 작성, 경쟁 제품 비교, 전황(드론) 모니터링, 법규·규정, 제품요구사항(PRD)을 한곳에서 보는 사내 웹앱입니다.
claude.ai 아티팩트로 만든 페이지를 그대로 옮기고, 아티팩트가 제공하던 저장·AI 작성·업로드 기능을 작은 Node 서버로 대체했습니다.

## 빠른 시작
1. Node.js 18.18 이상 설치
2. `.env.example`을 `.env`로 복사하고 값 입력
   - `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`: 제안서 자동 작성에 필요(없어도 나머지 기능은 동작)
   - `APP_PASSWORD`: 인터넷에 공개할 때 반드시 설정
3. `npm install` → `npm start` → 브라우저에서 http://localhost:3000 (시뮬레이터는 /sim/)

배포 방법은 [DEPLOY.md](DEPLOY.md)를 보세요(Docker Compose + Caddy HTTPS 권장).

## 운용 시뮬레이터(검증 리허설)
PRD 메뉴의 **운용 시뮬레이터**에서 지상통제소(GCS) 시뮬레이터로 PRD 검증 계획을 미리 돌려 봅니다.
- 시나리오 8종: 링크 자동 전환(COM-03), 통신 두절 안전 동작(COM-04), 상태감시·경보(COM-05·07), 1인 다척 운용(COM-09), 장기 보관 후 점검(C), 인명구조(A), 유출유 감시(B·IF-10), AIS 충돌 회피(B)
- 시뮬레이터에서 'what's next에 기록 저장'을 누르면 `simruns` 컬렉션에 남고, 요구사항 추적표에 최근 결과가 표시됩니다.
- 시뮬레이터 원본은 이 폴더의 상위 폴더에 있으며 `scripts/sync-sim.ps1`로 `public/sim/`에 복사합니다.

## 저장소에 없는 파일(로컬 전용)
공개 저장소에는 회사 내부 자료를 올리지 않습니다. 처음 내려받으면 다음이 비어 있습니다.
- `data/db/company.json` 회사 역량 → 화면 '제안서 작성 → 회사 역량'에서 입력 후 저장
- `data/db/drafts.json` 제안서 초안 → 화면에서 새로 작성
- `docs/PRD.docx`, `docs/PRD.pdf` 원문 문서 → 내용은 `docs/PRD.md`와 홈페이지 PRD 메뉴에 있음

## 들어 있는 것
- `public/` 페이지, 호환 계층(claude-shim.js), PWA(설치·오프라인 열람), `sim/` 지상통제소 시뮬레이터
- `server/` 저장소·실시간 갱신·Claude 호출·사진 업로드 API
- `data/db/` 2026-10-20 기준 데이터(공고 17, 제안서 1, 제품 14, 기사·동영상 20, 전황 2, 법규 20, 회사 역량)
- `docs/` PRD(md·docx·pdf), 매일 갱신 프롬프트
- `CLAUDE.md` Claude Code에서 이어서 작업할 때의 안내

## 매일 자동 갱신
`scripts/daily-update.sh`를 cron에 등록하면 Claude Code가 공고·전황·제품·법규를 찾아 서버 DB에 씁니다(Claude Code 설치·로그인 필요).
```
52 8 * * *  cd /path/to/usv-prd-center && ./scripts/daily-update.sh >> logs/daily.log 2>&1
```
