@echo off
setlocal
set "PORT=3000"
set "FOUND="

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT%" ^| findstr /I /C:"LISTENING" /C:"ESCUTANDO"') do (
  set "FOUND=1"
  taskkill /PID %%P /F >nul 2>&1
)

if defined FOUND (
  echo Servidor na porta %PORT% encerrado.
) else (
  echo Nenhum servidor encontrado na porta %PORT%.
)

exit /b 0
