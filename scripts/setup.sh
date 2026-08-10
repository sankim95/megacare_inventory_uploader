#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3.12}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python 3.12 실행 파일을 찾지 못했습니다. PYTHON_BIN에 Python 3.12 경로를 지정해 주세요." >&2
  exit 1
fi

if [ ! -d "$PROJECT_DIR/.venv" ]; then
  "$PYTHON_BIN" -m venv "$PROJECT_DIR/.venv"
fi

"$PROJECT_DIR/.venv/bin/python" -m pip install --upgrade pip
"$PROJECT_DIR/.venv/bin/pip" install -e "$PROJECT_DIR/backend[dev]"

cd "$PROJECT_DIR/frontend"
npm install
npx playwright install chromium

echo "설치가 완료되었습니다. scripts/dev.sh로 개발 서버를 실행하세요."
