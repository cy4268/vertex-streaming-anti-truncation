@echo off
where node >nul 2>nul || (echo Node.js was not found. Install Node.js 22.9+ from https://nodejs.org/ and try again. & pause & exit /b 1)
node "%~dp0install.mjs" %*
pause
