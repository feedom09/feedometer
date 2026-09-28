@echo off
chcp 65001 >nul
title FeedOmeter 2.1 - Personal Feed Intelligence
cls
echo ================================================================
echo    Starting FeedOmeter 2.1 Platform...
echo ================================================================
echo.
cd /d "%~dp0"

:: 1. Launch Data API Layer (Port 8787 -> SQL Server Express), unless it is
:: already running. Use only batch-native syntax here so double-clicking the
:: file cannot fail because CMD parses parentheses inside a PowerShell command.
netstat -ano | findstr /C:":8787" | findstr /C:"LISTENING" >nul
if not errorlevel 1 goto api_already_running

echo [1/2] Starting Data API (Port 8787)...
start "FeedOmeter Data API (Port 8787)" /min cmd /c "cd /d ""%~dp0data-api"" && node server.js"
goto start_frontend

:api_already_running
echo [1/2] Data API already running on Port 8787.

:start_frontend

rem 2. Enforce the fixed local frontend address. The helper stops only the
rem process listening on 3000 and waits until the port is genuinely free.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-port-3000-free.ps1"
if errorlevel 1 goto frontend_port_error

rem 3. Launch Local Static Frontend Server on the fixed port.
echo [2/2] Starting Frontend Server (Port 3000)...
node server.js

pause
goto :eof

:frontend_port_error
echo Could not release Port 3000. The frontend was not started.
pause
exit /b 1
