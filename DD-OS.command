#!/bin/bash

# DD-OS - One-Click Launcher for macOS
# Double-click this file in Finder to start DD-OS

# cd to the directory where this script lives
cd "$(dirname "$0")"

clear
echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     DD-OS - AI Operating System      ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# --- Check dependencies ---

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "  [ERROR] Node.js not found!"
    echo ""
    echo "  Please install Node.js first:"
    echo "    1. Visit https://nodejs.org"
    echo "    2. Download the macOS installer (v20 LTS recommended)"
    echo "    3. Run the installer and restart this script"
    echo ""
    echo "  Or install via Homebrew:"
    echo "    brew install node"
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

# Check Python3
if ! command -v python3 &> /dev/null; then
    echo "  [ERROR] Python3 not found!"
    echo ""
    echo "  Please install Python3 first:"
    echo "    1. Visit https://www.python.org/downloads/"
    echo "    2. Download macOS installer (3.10+ recommended)"
    echo ""
    echo "  Or install via Homebrew:"
    echo "    brew install python3"
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

NODE_VER=$(node -v)
PY_VER=$(python3 --version)
echo "  [OK] Node.js: $NODE_VER"
echo "  [OK] Python:  $PY_VER"
echo ""

# --- Install npm dependencies if needed ---
if [ ! -d "node_modules" ]; then
    echo "  [SETUP] First run detected, installing dependencies..."
    echo "  This may take a few minutes..."
    echo ""
    npm install
    echo ""
    echo "  [OK] Dependencies installed!"
    echo ""
fi

# --- Setup data directory ---
export DDOS_DATA_PATH="$HOME/.ddos"
if [ ! -d "$DDOS_DATA_PATH" ]; then
    echo "  [SETUP] Creating data directory: $DDOS_DATA_PATH"
    mkdir -p "$DDOS_DATA_PATH"
fi

# --- Cleanup on exit ---
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    echo ""
    echo "  [INFO] Stopping DD-OS..."
    [ -n "$BACKEND_PID" ] && kill $BACKEND_PID 2>/dev/null
    [ -n "$FRONTEND_PID" ] && kill $FRONTEND_PID 2>/dev/null
    # Kill child processes
    jobs -p | xargs -r kill 2>/dev/null
    echo "  [INFO] DD-OS stopped. You can close this window."
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# --- Start backend ---
echo "  [1/2] Starting backend server..."
python3 ddos-local-server.py --path "$DDOS_DATA_PATH" &
BACKEND_PID=$!
sleep 2

# Check backend
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo ""
    echo "  [ERROR] Backend failed to start!"
    echo "  Check if port 3001 is already in use:"
    echo "    lsof -i :3001"
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi
echo "  [OK] Backend running (PID: $BACKEND_PID)"

# --- Start frontend ---
echo "  [2/2] Starting frontend server..."
npm run dev &
FRONTEND_PID=$!
sleep 3

# --- Open browser ---
echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║         DD-OS is running!            ║"
echo "  ╠══════════════════════════════════════╣"
echo "  ║  Open: http://localhost:5173         ║"
echo "  ║  Data: ~/.ddos                       ║"
echo "  ╠══════════════════════════════════════╣"
echo "  ║  Press Ctrl+C to stop                ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

open http://localhost:5173 2>/dev/null

# Wait for processes
wait
