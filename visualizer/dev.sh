#!/usr/bin/env bash
# Start the local session-control service and Vite together for development.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

.venv/bin/python scripts/session_control.py &
CONTROL_PID=$!
cleanup() {
  kill -INT "$CONTROL_PID" 2>/dev/null || true
  wait "$CONTROL_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$ROOT/visualizer"
npx vite
