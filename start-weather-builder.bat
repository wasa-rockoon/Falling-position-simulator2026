@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.jsが見つかりません。Node.js 20.3以上をインストールしてください。
  pause
  exit /b 1
)
node scripts\weather-builder\server.cjs --open
pause
