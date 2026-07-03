@echo off
rem Pixl WebUI - start backend (uvicorn) and frontend (next) together.
setlocal
set "ROOT=%~dp0"
set "VENV_PY=%ROOT%.venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
  echo Backend is not installed. Run install.ps1 first.
  pause
  exit /b 1
)
if not exist "%ROOT%frontend\node_modules" (
  echo Frontend is not installed. Run install.ps1 first.
  pause
  exit /b 1
)

echo Starting backend on http://localhost:8000 ...
start "Pixl Backend" /D "%ROOT%backend" cmd /k ""%VENV_PY%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000"

echo Starting frontend on http://localhost:3000 ...
start "Pixl Frontend" /D "%ROOT%frontend" cmd /k "npm run dev"

echo Waiting for the servers to start ...
timeout /t 6 /nobreak >nul
start "" http://localhost:3000

endlocal
