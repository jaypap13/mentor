@echo off
REM Starts the Monopati backend (port 3001) and frontend (port 3000), then opens the app.
REM Skips a server that is already running.
cd /d "%~dp0"
netstat -ano | findstr /r /c:":3001 .*LISTENING" >nul || start "Monopati backend" /min cmd /k npm.cmd --prefix backend run dev
netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul || start "Monopati frontend" /min cmd /k python -m http.server 3000 --directory frontend
timeout /t 3 /nobreak >nul
start "" http://localhost:3000
