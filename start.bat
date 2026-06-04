@echo off
REM ── Farahi CRM — local launcher ────────────────────────────────
REM Double-click this file to start the app, then open http://localhost:3000
cd /d "%~dp0"
echo Starting Farahi CRM on http://localhost:3000 ...
echo (Keep this window open while you use the app. Close it to stop.)
echo.
call corepack pnpm dev
pause
