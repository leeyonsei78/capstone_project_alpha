@echo off
title Insurance AI + ngrok launcher
cd /d "%~dp0"

rem ============================================================
rem  Starts web_app.py AND an ngrok tunnel to it in one step, so
rem  Slack (slash commands + the crypto buy/sell approval buttons)
rem  can reach /api/slack/commands and /api/slack/interactive.
rem
rem  Idempotent: if something is already listening on 5000/4040,
rem  this script reuses it instead of starting a second copy
rem  (same philosophy as blockchain_bridge.py / crypto_bridge.py).
rem ============================================================

if not exist ".env" (
    echo [Error] .env file not found.
    echo Please copy .env.example to .env and enter your OPENAI_API_KEY
    echo and SLACK_SIGNING_SECRET before using the Slack features.
    pause
    exit /b 1
)

python --version >nul 2>&1
if errorlevel 1 (
    set PYTHON=C:\Users\admin\AppData\Local\Programs\Python\Python313\python.exe
) else (
    set PYTHON=python
)

rem --- ngrok binary: prefer the known-good copy downloaded directly,
rem     fall back to PATH in case the winget install gets fixed later.
if exist "%LOCALAPPDATA%\ngrok_bin\ngrok.exe" (
    set NGROK=%LOCALAPPDATA%\ngrok_bin\ngrok.exe
) else (
    set NGROK=ngrok
)

echo.
echo ====================================
echo   Step 1/2: Insurance AI server
echo ====================================
netstat -aon 2>nul | findstr ":5000 " | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo   Already running on port 5000 - reusing it.
) else (
    start "Insurance AI Server" cmd /k "%PYTHON% web_app.py"
    echo   Starting... waiting a few seconds for it to come up.
    timeout /t 4 >nul
)

echo.
echo ====================================
echo   Step 2/2: ngrok tunnel (port 5000)
echo ====================================
netstat -aon 2>nul | findstr ":4040 " | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo   Already running - reusing it.
) else (
    start "ngrok tunnel" cmd /k ""%NGROK%" http 5000"
    echo   Starting... waiting a few seconds for it to connect.
    timeout /t 4 >nul
)

echo.
echo ====================================
echo   Opening ngrok dashboard to show your public URL
echo   (Free static domain - stays the same across restarts)
echo ====================================
start http://127.0.0.1:4040

echo.
echo Both are running in their own windows. Closing those windows
echo stops that service. Register the ngrok https URL shown in the
echo dashboard as your Slack App's Slash Command / Interactivity
echo Request URL (paths: /api/slack/commands, /api/slack/interactive).
echo.
pause
