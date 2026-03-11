@echo off
chcp 65001 >nul 2>&1
title DD-OS Desktop

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║          DD-OS Desktop Launcher          ║
echo  ╠══════════════════════════════════════════╣
echo  ║  Starting DD-OS on http://localhost:3001 ║
echo  ╚══════════════════════════════════════════╝
echo.

:: 获取当前脚本所在目录
set "DDOS_DIR=%~dp0"

:: ============================================
:: 1. 部署 OpenClaw 扩展 (如果用户有 OpenClaw)
:: ============================================
set "OPENCLAW_EXT_DIR=%USERPROFILE%\.openclaw\extensions\ddos"
set "SOURCE_EXT_DIR=%DDOS_DIR%openclaw-extension"

if not exist "%SOURCE_EXT_DIR%\index.ts" (
    echo [Deploy] OpenClaw extension source not found, skipping.
    goto ext_done
)

if exist "%OPENCLAW_EXT_DIR%\index.ts" (
    echo [Deploy] OpenClaw extension already installed.
    goto ext_done
)

echo [Deploy] Installing OpenClaw extension...
if not exist "%OPENCLAW_EXT_DIR%" mkdir "%OPENCLAW_EXT_DIR%"
if not exist "%OPENCLAW_EXT_DIR%\src" mkdir "%OPENCLAW_EXT_DIR%\src"

copy /Y "%SOURCE_EXT_DIR%\index.ts" "%OPENCLAW_EXT_DIR%\" >nul 2>&1
copy /Y "%SOURCE_EXT_DIR%\package.json" "%OPENCLAW_EXT_DIR%\" >nul 2>&1
copy /Y "%SOURCE_EXT_DIR%\openclaw.plugin.json" "%OPENCLAW_EXT_DIR%\" >nul 2>&1
if exist "%SOURCE_EXT_DIR%\tsconfig.json" copy /Y "%SOURCE_EXT_DIR%\tsconfig.json" "%OPENCLAW_EXT_DIR%\" >nul 2>&1
copy /Y "%SOURCE_EXT_DIR%\src\*.ts" "%OPENCLAW_EXT_DIR%\src\" >nul 2>&1
echo [Deploy] OpenClaw extension deployed to %OPENCLAW_EXT_DIR%

:ext_done

:: ============================================
:: 2. 检查前端构建
:: ============================================
if not exist "%DDOS_DIR%dist\index.html" (
    echo [Error] Frontend build not found (dist/index.html missing)
    echo         Please run "npm run build" first.
    pause
    exit /b 1
)

:: ============================================
:: 3. 启动后端服务器
:: ============================================
set "SERVER_EXE=%DDOS_DIR%ddos-server.exe"
set "SERVER_PY=%DDOS_DIR%ddos-local-server.py"

if exist "%SERVER_EXE%" (
    echo [Server] Starting ddos-server.exe ...
    start "" /B "%SERVER_EXE%" --port 3001
) else if exist "%SERVER_PY%" (
    echo [Server] Starting ddos-local-server.py ...
    start "" /B python "%SERVER_PY%" --port 3001
) else (
    echo [Error] Neither ddos-server.exe nor ddos-local-server.py found!
    pause
    exit /b 1
)

:: ============================================
:: 4. 等待服务器就绪后打开浏览器
:: ============================================
echo [Wait] Waiting for server to start...
set "RETRIES=0"

:wait_loop
timeout /t 1 /nobreak >nul 2>&1
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3001/status' -TimeoutSec 2 -UseBasicParsing; if($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto server_ready

set /a RETRIES+=1
if %RETRIES% GEQ 30 (
    echo [Error] Server failed to start after 30 seconds.
    pause
    exit /b 1
)
goto wait_loop

:server_ready
echo [Ready] Server is running!
echo.
echo  Opening DD-OS in your default browser...
echo  URL: http://localhost:3001
echo.
start "" "http://localhost:3001"

echo  ══════════════════════════════════════════
echo   DD-OS is running. Press Ctrl+C to stop.
echo  ══════════════════════════════════════════
echo.

:: 保持窗口打开，等待用户关闭
:keep_alive
timeout /t 3600 /nobreak >nul 2>&1
goto keep_alive
