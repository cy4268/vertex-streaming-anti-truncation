@echo off
cd /d "%~dp0"
call node -e "const[a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||a==22&&b>=9?0:1)" 2>nul || (echo Node.js 22.9+ is required: https://nodejs.org/ & pause & exit /b 1)
node --env-file-if-exists=.env bin/gui.mjs
pause
