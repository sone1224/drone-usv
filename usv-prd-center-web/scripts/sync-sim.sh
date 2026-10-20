#!/usr/bin/env bash
# 지상통제소 시뮬레이터 원본(기본: 상위 폴더)을 public/sim 으로 복사한다.
set -euo pipefail
cd "$(dirname "$0")/.."
FROM="${1:-..}"
[ -f "$FROM/js/sim.js" ] || { echo "시뮬레이터 원본을 찾을 수 없습니다: $FROM" >&2; exit 1; }
mkdir -p public/sim/css public/sim/js
cp "$FROM/index.html" "$FROM/busan.html" public/sim/
cp "$FROM"/css/* public/sim/css/
cp "$FROM"/js/* public/sim/js/
echo "시뮬레이터 동기화 완료"
