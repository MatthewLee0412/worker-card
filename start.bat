@echo off
chcp 65001 >nul
title 员工管理系统
echo 正在启动员工管理系统...
start "" http://localhost:3817
node "%~dp0server.js"
pause
