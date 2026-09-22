@echo off
setlocal

:: ============================================================
:: Double-click this to start the app and open it in your browser.
:: A small black window will appear and stay open while the app is
:: running -- that IS the server. Closing that window stops the app.
:: (Closing just the browser tab can't stop it -- browsers don't allow
:: a local script to detect that. Closing this window, or running
:: stop-app.bat, is the equivalent.)
:: ============================================================

cd /d "%~dp0"

echo Starting mykabayan-tracker...
echo (Keep this window open while you use the app. Close it when done.)
echo.

:: Start the dev server in THIS window so closing the window stops it.
:: Also open the browser after a few seconds, once the server is ready.
start "" /min cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:3000"

call npm run dev

endlocal
