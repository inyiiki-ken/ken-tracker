@echo off
:: ============================================================
:: Double-click this if you want to stop the app without closing
:: its window manually (or if you closed the window but it's still
:: running in the background for some reason).
:: ============================================================

echo Stopping mykabayan-tracker...

for /f "tokens=5" %%p in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    echo Found process %%p using port 3000, stopping it...
    taskkill /PID %%p /F >nul 2>&1
)

echo Done. You can close this window.
pause
