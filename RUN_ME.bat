@echo off
title Amrita Feedback Automator
cd /d "%~dp0"

echo.
echo ========================================================
echo    Amrita Feedback Automator
echo ========================================================
echo.
echo    This will:
echo      1. Restart Chrome with remote debugging
echo      2. You log in to Amrita + Outlook
echo      3. It fills ALL courses automatically
echo.
echo ========================================================
echo.

python feedback_auto.py

echo.
echo ========================================================
echo    Finished! Press any key to close this window.
echo ========================================================
pause >nul
