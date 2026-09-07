@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.jsが見つかりません。Node.js 20以上をインストールしてください。
  pause
  exit /b 1
)
node local\scripts\local-runtime.js start
set "result=%errorlevel%"
pause
exit /b %result%
