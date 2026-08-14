@echo off
setlocal
cd /d "%~dp0"
set "NPM_BIN=npm.cmd"
where npm.cmd >nul 2>nul
if errorlevel 1 set "NPM_BIN=C:\Program Files\nodejs\npm.cmd"
if not exist "node_modules\electron\dist\electron.exe" call "%NPM_BIN%" install
call "%NPM_BIN%" run dev
endlocal
