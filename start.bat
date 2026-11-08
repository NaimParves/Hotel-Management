@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo First start: installing...
  call npm install || goto :err
  call npx playwright install chromium || goto :err
)
start "" http://localhost:3000
node server.js
pause
exit /b
:err
echo Installation failed. Make sure Node.js is installed: https://nodejs.org
pause
