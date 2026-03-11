@echo off
setx RUSTUP_HOME "D:\rust\rustup"
setx CARGO_HOME "D:\rust\cargo"

for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set "CURRENT_PATH=%%b"
echo Current user PATH: %CURRENT_PATH%
echo %CURRENT_PATH% | find /i "D:\rust\cargo\bin" >nul
if errorlevel 1 (
    setx PATH "D:\rust\cargo\bin;%CURRENT_PATH%"
    echo Added D:\rust\cargo\bin to user PATH
) else (
    echo D:\rust\cargo\bin already in PATH
)
echo Done.
