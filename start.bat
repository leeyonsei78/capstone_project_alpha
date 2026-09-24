@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   Capstone Project - Insurance AI Assistant
echo   (Blockchain Dental Insurance stack auto-starts on demand
echo    when you click the enrollment button in the chat)
echo ============================================================

call "%~dp0insurance_agent\run_with_ngrok.bat"
