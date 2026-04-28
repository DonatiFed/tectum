#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Starting Tectum..."
echo ""

# 1 — Solar Pipeline API (port 8001)
echo "[1/3] Solar Pipeline → http://localhost:8001"
cd "$ROOT/solar-pipeline"
python -m venv .venv 2>/dev/null || true
source .venv/bin/activate
pip install -q fastapi uvicorn pydantic anthropic
uvicorn server:app --port 8001 --reload &
PID_PIPELINE=$!

# 2 — Web App (port 3001)
echo "[2/3] Web App       → http://localhost:3001"
cd "$ROOT/web-app"
npm install --silent
npm run dev &
PID_WEB=$!

# 3 — 3D Roof Planner (port 3000)
echo "[3/3] 3D Planner    → http://localhost:3000"
cd "$ROOT/3d-roof-planner"
npm install --silent
npm run dev &
PID_3D=$!

echo ""
echo "All services running. Press Ctrl+C to stop."

trap "kill $PID_PIPELINE $PID_WEB $PID_3D 2>/dev/null; exit" INT TERM
wait
