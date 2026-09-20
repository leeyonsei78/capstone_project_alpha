@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   Dental Insurance Blockchain - Starting all services
echo ============================================================

echo [1/13] Starting Mailpit (Docker, local SMTP catcher for emails)...
docker compose up -d mailpit
if errorlevel 1 (
    echo.
    echo Mailpit could not be started via Docker - is Docker Desktop running?
    echo Continuing without it: emails will simply fail to send, everything else still works.
)

echo [2/13] Starting Hardhat local node...
start "1-Hardhat Node" /d "%~dp0" cmd /k "npx hardhat node"

echo Waiting for node to come up (8 sec)...
timeout /t 8 /nobreak >nul

echo [3/13] Deploying contracts (waiting for completion)...
call npx hardhat run scripts/deploy.js --network localhost
if errorlevel 1 (
    echo.
    echo Deploy failed. Check that the node started correctly.
    pause
    exit /b 1
)

echo [4/13] Starting frontend UI server...
start "3-Frontend UI" /d "%~dp0frontend" cmd /k "npx serve -l 3000 ."

echo [5/13] Starting maturity refund watcher...
start "4-Maturity Watcher" /d "%~dp0" cmd /k "node scripts/maturity-watcher.js"

echo [6/13] Starting oracle service...
start "5-Oracle Service" /d "%~dp0" cmd /k "node scripts/oracle-service.js"

echo [7/13] Starting parametric insurance oracle service...
start "5b-Parametric Oracle" /d "%~dp0" cmd /k "node scripts/parametric-oracle-service.js"

echo [8/13] Starting premium auto-pay scheduler...
start "6-Premium Scheduler" /d "%~dp0" cmd /k "node scripts/premium-scheduler.js"

echo [9/13] Starting Slack notification service...
start "7-Slack Notifier" /d "%~dp0" cmd /k "node scripts/slack-notifier.js"

echo [10/13] Starting application review AI service...
start "8-Application Review" /d "%~dp0" cmd /k "node scripts/application-review-service.js"

echo [11/13] Starting policy certificate issuance service...
start "9-Certificate Service" /d "%~dp0" cmd /k "node scripts/certificate-service.js"

echo [12/13] Starting reserve shortage monitor...
start "10-Reserve Monitor" /d "%~dp0" cmd /k "node scripts/reserve-monitor.js"

echo [13/13] Starting email notification service...
start "11-Email Service" /d "%~dp0" cmd /k "node scripts/email-service.js"

echo Opening admin window (Chrome) and customer window (Edge) in 3 sec...
timeout /t 3 /nobreak >nul
start chrome "http://localhost:3000"
start msedge "http://localhost:3000"

echo ============================================================
echo   All services started - http://localhost:3000
echo   Chrome = admin account, Edge = customer account
echo   (each browser keeps its own MetaMask account selection)
echo   Sent emails (policy/claim notices) can be viewed at:
echo     http://localhost:8025  (Mailpit web UI)
echo   To fast-forward blockchain time, run in a separate terminal:
echo     node scripts/advance-time.js 600
echo ============================================================
pause
