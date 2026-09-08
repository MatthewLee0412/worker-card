@echo off
chcp 65001 >nul
title Stop Worker Card
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
if errorlevel 1 (
  echo Failed to stop Worker Card.
  pause
  exit /b 1
)

pause
