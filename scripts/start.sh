#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -x .venv/bin/python ]]; then
  echo "가상환경이 없습니다. 먼저 ./scripts/setup.sh를 실행해 주세요." >&2
  exit 1
fi

.venv/bin/alembic -c backend/alembic.ini upgrade head
npm --prefix frontend run build
exec .venv/bin/uvicorn app.main:app \
  --app-dir backend \
  --host "${API_HOST:-127.0.0.1}" \
  --port "${API_PORT:-8000}"
