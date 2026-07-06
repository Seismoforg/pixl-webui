@echo off
rem Pixl WebUI - one-click Playwright inspect harness.
rem Starts backend + frontend DEV server (live reload -- unlike start.bat's prod build),
rem waits for it, then opens a shared browser you (and Claude) drive. Claude attaches
rem over CDP to inspect the ACTIVE page (screenshot + element metrics + a11y).
rem See frontend\e2e\AGENTS.md.
rem
rem   test-frontend.bat                       -> start stack (dev) + open shared browser
rem   test-frontend.bat inspect <sel> [flags] -> attach + report (--a11y, --console)
setlocal
set "ROOT=%~dp0"
set "VENV_PY=%ROOT%.venv\Scripts\python.exe"

if /I "%~1"=="inspect" (
  cd /d "%ROOT%frontend"
  node e2e\inspect.mjs %2 %3 %4 %5 %6 %7 %8 %9
  exit /b %errorlevel%
)

if not exist "%VENV_PY%" (
  echo Backend is not installed. Run install.ps1 first.
  exit /b 1
)
if not exist "%ROOT%frontend\node_modules" (
  echo Frontend is not installed. Run install.ps1 first.
  exit /b 1
)

rem Ensure the Playwright chromium browser is present (no-op if already installed).
pushd "%ROOT%frontend"
call npx playwright install chromium
popd

echo Starting backend (HTTP + WebSocket) on http://localhost:8000 ...
start "Pixl Backend" /D "%ROOT%backend" cmd /k ""%VENV_PY%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --ws auto"

echo Starting frontend DEV server (live reload) on http://localhost:3000 ...
start "Pixl Frontend (dev)" /D "%ROOT%frontend" cmd /k "npm run dev"

echo Waiting for the frontend to start serving ...
:waitfrontend
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 3000); $c.Close(); exit 0 } catch { exit 1 }"
if errorlevel 1 goto waitfrontend

echo Opening the shared inspect browser (CDP on http://localhost:9222) ...
echo Prepare any state in the window, then ask Claude to inspect. Close the window to stop.
cd /d "%ROOT%frontend"
node e2e\lib\shared-browser.mjs
endlocal
