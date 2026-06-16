@echo off
echo.
echo [iDogs] Building...
npm run build
if %errorlevel% neq 0 (
  echo [iDogs] Build FAILED. Aborting deploy.
  exit /b 1
)
echo.
echo [iDogs] Deploying to Vercel...
vercel deploy --prod
echo.
echo [iDogs] Done!
