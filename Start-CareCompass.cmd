@echo off
setlocal
cd /d "%~dp0"
title CareCompass - keep this window open
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is needed. Install the LTS version from https://nodejs.org
  echo Then close this window and double-click Start-CareCompass.cmd again.
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo Please update Node.js to version 22 or newer, then try again.
  pause
  exit /b 1
)
if not exist "node_modules\express\package.json" (
  echo Dependencies are missing. Connect to the internet and run npm.cmd ci in this folder.
  echo Then double-click this launcher again. See START-HERE.md.
  pause
  exit /b 1
)
echo.
echo CareCompass - CareForge team
echo Open http://localhost:3000 when the server says it is running.
echo Keep this window open. Press Ctrl+C to stop the app.
echo No database account or API key is required for the core demonstration.
echo.
node app.js
echo.
echo If port 3000 is already in use, stop your previous CareCompass server first.
pause
