@echo off
chcp 65001 >nul
title FeedOmeter 2.1 - Personal Feed Intelligence
cls
echo ================================================================
echo    Starting FeedOmeter 2.1 Platform...
echo ================================================================
echo.
cd /d "%~dp0"

:: Launch local server (automatically opens browser to http://localhost:3000/shell.html)
node server.js

pause
