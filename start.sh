#!/bin/bash

# DD-OS - AI Operating System
# One-click startup script for Linux/macOS

set -e

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║              DD-OS - AI Operating System                  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# 设置数据目录
export DDOS_DATA_PATH="$HOME/.ddos"

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python3 not found. Please install Python 3.8+"
    exit 1
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js not found. Please install Node.js 18+"
    exit 1
fi

# 创建数据目录
if [ ! -d "$DDOS_DATA_PATH" ]; then
    echo "[INFO] Creating data directory: $DDOS_DATA_PATH"
    mkdir -p "$DDOS_DATA_PATH"
fi

# 清理函数
cleanup() {
    echo ""
    echo "[INFO] Stopping DD-OS..."
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    echo "[INFO] DD-OS stopped."
    exit 0
}

# 捕获 Ctrl+C
trap cleanup SIGINT SIGTERM

# 启动后端
echo "[1/2] Starting backend server..."
python3 ddos-local-server.py --path "$DDOS_DATA_PATH" &
BACKEND_PID=$!

# 等待后端启动
sleep 2

# 检查后端是否启动成功
if ! curl -s http://localhost:3001/status > /dev/null 2>&1; then
    echo "[WARN] Backend may not be ready, waiting..."
    sleep 3
fi

# 启动前端
echo "[2/2] Starting frontend server..."
npm run dev &
FRONTEND_PID=$!

# 等待前端启动
sleep 3

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                   DD-OS is running!                       ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Frontend: http://localhost:5173                          ║"
echo "║  Backend:  http://localhost:3001                          ║"
echo "║  Data:     $DDOS_DATA_PATH                                ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# 尝试打开浏览器
if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:5173 2>/dev/null &
elif command -v open &> /dev/null; then
    open http://localhost:5173 2>/dev/null &
fi

echo "Press Ctrl+C to stop DD-OS..."
echo ""

# 等待进程
wait
