@echo off
setlocal
title iDogs Production Signing Setup

set "PS1=%TEMP%\idogs-production-signing-setup.ps1"
set "URL=https://raw.githubusercontent.com/izipawsltd-Tony/idogs-app/feat/mobile-app-foundation/scripts/idogs-production-signing-setup.ps1"

echo Downloading latest iDogs production signing setup...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -OutFile '%PS1%'"
if errorlevel 1 goto :fail

echo.
echo Running iDogs production signing setup...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" goto :failcode

echo.
echo iDogs PRODUCTION SIGNING SETUP COMPLETED.
pause
exit /b 0

:fail
echo.
echo FAILED to download the signing setup script.
pause
exit /b 1

:failcode
echo.
echo iDogs PRODUCTION SIGNING SETUP stopped with exit code %RC%.
echo Review the message above. No existing production key was overwritten.
pause
exit /b %RC%
