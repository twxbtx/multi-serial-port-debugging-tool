@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0build-portable.ps1"
if errorlevel 1 (
  echo.
  echo Portable build failed.
  exit /b 1
)
echo.
echo Portable build finished.
