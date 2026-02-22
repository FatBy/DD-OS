@echo off
chcp 65001 >nul
title DD-OS Standalone

:: 设置数据目录
set DDOS_DATA_PATH=%USERPROFILE%\.ddos

echo.
echo  DD-OS Standalone Server
echo  ========================
echo.
echo  Data: %DDOS_DATA_PATH%
echo  URL:  http://localhost:3001
echo.

:: 启动服务器
ddos-server\ddos-server.exe --path "%DDOS_DATA_PATH%"

pause
