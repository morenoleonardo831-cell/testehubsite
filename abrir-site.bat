@echo off
setlocal
cd /d "%~dp0"

set "PORT=3000"
set "HAS_SERVER="

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT%" ^| findstr /I /C:"LISTENING" /C:"ESCUTANDO"') do (
  set "HAS_SERVER=1"
)

if not defined HAS_SERVER (
  start "Moreno Moveis Server" /min cmd /c "cd /d ""%~dp0"" && npm start"
  timeout /t 2 /nobreak >nul
)

start "" http://localhost:%PORT%
exit /b 0
