@echo off
title MI5.ai
cd /d "%~dp0"

if not exist "node_modules\" (
  echo MI5.ai: node_modules missing. Run: npm install
  pause
  exit /b 1
)

npm start
if errorlevel 1 pause
