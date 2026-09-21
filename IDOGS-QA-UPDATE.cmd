@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\idogs-qa-update.ps1"
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo iDogs QA updater FAILED with exit code %ERR%.
) else (
  echo iDogs QA updater completed successfully.
)
echo.
pause
exit /b %ERR%
