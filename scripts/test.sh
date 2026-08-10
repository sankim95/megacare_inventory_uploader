#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$PROJECT_DIR/.venv/bin/pytest" "$PROJECT_DIR/backend/tests"

cd "$PROJECT_DIR/frontend"
npm test -- --run
npm run build
npm run test:e2e
