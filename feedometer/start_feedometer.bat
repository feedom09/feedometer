@echo off
chcp 65001 >nul
title FeedOmeter 2.1 - Personal Feed Intelligence
cls
echo ================================================================
echo    Starting FeedOmeter 2.1 Platform...
echo ================================================================
echo.
cd /d "%~dp0"

:: 1. Launch Data API Layer (Port 8787 -> SQL Server Express)
echo [1/2] Starting Data API (Port 8787)...
start "FeedOmeter Data API (Port 8787)" /min cmd /c "cd /d "%~dp0data-api" && node server.js"

:: 2. Launch Local Static Frontend Server (Port 3000)
echo [2/2] Starting Frontend Server (Port 3000)...
node server.js

pause
