@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "NODE_EXE="
if exist ".runtime\node\node.exe" set "NODE_EXE=%CD%\.runtime\node\node.exe"

if not defined NODE_EXE (
  where node >nul 2>nul
  if not errorlevel 1 (
    for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%v"
    if defined NODE_MAJOR (
      if !NODE_MAJOR! GEQ 18 set "NODE_EXE=node"
    )
  )
)

if not defined NODE_EXE (
  echo.
  echo Node.js 18+ not found. Extracting bundled Windows Node ...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" -NoStart
  if exist ".runtime\node\node.exe" set "NODE_EXE=%CD%\.runtime\node\node.exe"
)

if not defined NODE_EXE (
  echo.
  echo ERROR: Node.js is unavailable.
  echo Run: powershell -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1
  echo Or install Node.js 18+ manually and add it to PATH.
  if "%~1"=="" pause
  exit /b 1
)

"%NODE_EXE%" "%~dp0deploy\windows-launcher.mjs" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" if "%~1"=="" pause
exit /b %RC%
