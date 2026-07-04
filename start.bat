@echo off
rem Pixl WebUI - start backend (uvicorn) and frontend (next) together.
rem The backend also serves the live WebSocket at ws://localhost:8000/ws (same
rem uvicorn process); --ws auto enables it via the installed websockets library.
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

echo Starting backend (HTTP + WebSocket) on http://localhost:8000 ...
start "Pixl Backend" /D "%ROOT%backend" cmd /k ""%VENV_PY%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --ws auto"

echo Building and starting frontend on http://localhost:3000 ...
rem Production build + `next start` (NOT `next dev`): dev mode compiles each route
rem on first visit, which is what made page switches take 1-2s. The build is
rem incremental (first run is slower; later runs reuse .next\cache). For live-
rem reload development use `npm run dev` in frontend\ instead.
start "Pixl Frontend" /D "%ROOT%frontend" cmd /k "npm run build && npm run start"

echo Waiting for the servers to start ...
timeout /t 6 /nobreak >nul
start "" http://localhost:3000

endlocal
