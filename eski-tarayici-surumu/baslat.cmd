@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 veya daha yeni bir surum kurun.
  pause
  exit /b 1
)
node server.mjs --open
pause
