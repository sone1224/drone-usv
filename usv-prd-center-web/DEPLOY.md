# 배포 안내

수상드론 what's next는 **Node 서버 + JSON 파일 저장소**입니다. 공고·제품·시험 기록이 `data/`에 쌓이므로 **디스크가 유지되는 곳**에 배포해야 합니다.
지상통제소 시뮬레이터는 `public/sim/`에 들어 있으며 같은 서버에서 `/sim/`으로 열립니다.

## 배포 전 확인

- [ ] `.env` 작성: `APP_PASSWORD`(필수), `ANTHROPIC_API_KEY`·`ANTHROPIC_MODEL`(제안서 작성용), `DOMAIN`
- [ ] (선택) 부산 실지도 운용 화면에 Google Maps를 쓰려면 `.env`에 `GOOGLE_MAPS_API_KEY`(Maps JavaScript API) 입력, Google Cloud 콘솔에서 HTTP 리퍼러를 배포 도메인으로 제한. 비우면 OpenStreetMap·Esri 위성 지도로 동작
- [ ] 시뮬레이터를 고쳤다면 `scripts/sync-sim.ps1`(Windows) 또는 `scripts/sync-sim.sh` 실행
- [ ] `.env`와 `data/uploads/*`는 저장소에 올리지 않기(.gitignore에 이미 들어 있음)
- [ ] claude.ai 예약 작업과 이 서버의 `daily-update.sh`를 **동시에 돌리지 않기**(데이터가 갈라짐)

## 방법 A — 서버 1대 + Docker Compose (권장)

사내 서버나 클라우드 VM(국내 리전, 예: NCP·KT Cloud·AWS 서울)에 배포합니다.

```bash
git clone <저장소> usv-prd-center && cd usv-prd-center
cp .env.example .env        # APP_PASSWORD, DOMAIN 등 입력
docker compose up -d --build
docker compose logs -f app
```

- Caddy가 `DOMAIN`으로 HTTPS 인증서를 자동 발급합니다(80·443 포트 개방, DNS A 레코드 필요).
- `NODE_ENV=production`에서는 `APP_PASSWORD`가 없으면 서버가 시작되지 않습니다.
- 백업: `data/` 폴더를 매일 복사(cron + rsync 또는 클라우드 스냅샷).
- 매일 갱신: 같은 서버에 Claude Code를 설치하고 로그인한 뒤 cron에 등록합니다.
  ```
  52 8 * * 1-5  cd /srv/usv-prd-center && BASE=https://$DOMAIN ./scripts/daily-update.sh >> logs/daily.log 2>&1
  ```

## 방법 B — PaaS (Railway·Render·Fly.io)

`Dockerfile`을 그대로 쓰고, **영구 볼륨을 `/app/data`에 연결**합니다. 볼륨이 없으면 재배포 때마다 데이터가 초기화됩니다.
환경변수: `NODE_ENV=production`, `APP_PASSWORD`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`.
HTTPS는 플랫폼이 제공하므로 Caddy는 필요 없습니다.

## 방법 C — 시뮬레이터만 공개 시연용으로

시뮬레이터는 서버 없이 동작하는 정적 파일입니다. 수요기관이나 심사위원에게 보여 줄 때는 `public/sim/` 폴더만 GitHub Pages·Netlify 같은 정적 호스팅에 올려도 됩니다.
이 경우 시험 기록 저장 버튼은 나타나지 않습니다(센터 API가 없으면 자동으로 숨김). 회사 내부 데이터(공고·제안서)는 노출되지 않습니다.

## 배포 후 점검

```bash
BASE=https://<도메인>/ npm run smoke      # APP_PASSWORD를 켰다면 사내망에서 인증을 끄고 확인하거나 브라우저로 확인
```
브라우저에서 확인할 것:
1. 개요 → '운용 시뮬레이터' 메뉴
2. 시나리오 '링크 자동 전환' → 여기서 실행 → 합격 → 'what's next에 기록 저장'
3. 시험 기록 표와 요구사항 추적표에 결과가 나타나는지 확인
