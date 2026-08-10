#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -x "$PROJECT_DIR/.venv/bin/uvicorn" ] || [ ! -d "$PROJECT_DIR/frontend/node_modules" ]; then
  echo "의존성이 설치되지 않았습니다. 먼저 scripts/setup.sh를 실행해 주세요." >&2
  exit 1
fi

cleanup() {
  kill "${BACKEND_PID:-}" "${FRONTEND_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$PROJECT_DIR"
"$PROJECT_DIR/.venv/bin/alembic" -c backend/alembic.ini upgrade head
"$PROJECT_DIR/.venv/bin/uvicorn" app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload &
BACKEND_PID=$!

cd "$PROJECT_DIR/frontend"
npm run dev -- --host 127.0.0.1 &
FRONTEND_PID=$!

wait "$BACKEND_PID" "$FRONTEND_PID"

