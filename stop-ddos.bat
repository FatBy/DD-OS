@echo off
chcp 65001 >nul
title DD-OS Stop

echo 正在停止 DD-OS...
docker-compose down

echo.
echo DD-OS 已停止。
echo.
pause
