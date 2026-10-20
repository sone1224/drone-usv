#!/usr/bin/env bash
# 매일 갱신: Claude Code 헤드리스 실행. 서버(npm start)가 떠 있어야 한다.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
BASE="${BASE:-http://localhost:3000}"
AUTH=""
if [ -f .env ] && grep -q '^APP_PASSWORD=.\+' .env; then
  AUTH="-u user:$(grep '^APP_PASSWORD=' .env | cut -d= -f2-)"
fi
PROMPT="$(sed -e "s#{{BASE}}#${BASE}#g" -e "s#{{AUTH}}#${AUTH}#g" docs/daily-update-prompt.md)"
claude -p "$PROMPT" --allowedTools "WebSearch,WebFetch,Bash(curl:*),Bash(date:*)"
