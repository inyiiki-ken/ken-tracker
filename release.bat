@echo off
setlocal
cd /d "%~dp0"

:: ============================================================
::  Ken Tracker - ship an update (desktop + web) in one go.
::
::  Usage (in the VS Code terminal, inside the ken-tracker folder):
::      .\release.bat "what you changed"
::
::  It will:
::    1. save your changes to git
::    2. bump the version (0.3.7 -> 0.3.8 -> 0.3.9 ...)
::    3. push the code to GitHub
::    4. build the Windows installer and publish it to GitHub Releases
::       (every installed Ken Tracker auto-updates on next launch)
::    5. deploy the web/mobile version to Vercel
::
::  One-time setup needed first: GH_TOKEN saved, and "npx vercel login" +
::  "npx vercel link" done. See RELEASING.md.
:: ============================================================

if "%GH_TOKEN%"=="" (
  echo [X] GH_TOKEN is not set. See RELEASING.md step 1, then reopen VS Code.
  exit /b 1
)

set "MSG=%~1"
if "%MSG%"=="" set "MSG=Update"

echo.
echo === 1/5  Saving your changes to git ===
git add -A
git diff --cached --quiet || git commit -m "%MSG%"
if errorlevel 1 goto :fail

echo.
echo === 2/5  Bumping version ===
call npm version patch -m "Release v%%s - %MSG%"
if errorlevel 1 goto :fail

echo.
echo === 3/5  Pushing code to GitHub ===
git push --follow-tags origin main
if errorlevel 1 goto :fail

echo.
echo === 4/5  Building + publishing the desktop installer ===
call npm run release:win
if errorlevel 1 goto :fail

echo.
echo === 5/5  Deploying the web version to Vercel ===
call npx vercel --prod --yes
if errorlevel 1 goto :fail

echo.
echo ============================================================
echo  DONE. Installed apps will update on their next launch,
echo  and the web version is live.
echo ============================================================
exit /b 0

:fail
echo.
echo [X] Something failed above - nothing after that step ran.
echo     Copy the red text and send it to Claude.
exit /b 1
