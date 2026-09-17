@echo off
title Dues Management System - School of Sciences UENR
echo ============================================================
echo   Dues Management System - School of Sciences UENR
echo ============================================================
echo.

cd /d "%~dp0"

echo Stopping any existing Dues Management services...
taskkill /F /FI "WINDOWTITLE eq Dues API" 2>nul
taskkill /F /FI "WINDOWTITLE eq Dues Frontend" 2>nul
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul

echo Starting the API server...
cd server
start "Dues API" cmd /k "node src/index.js"
cd ..

echo Starting the frontend (Vite)...
cd client
start "Dues Frontend" cmd /k "npm run dev"
cd ..

echo.
echo Servers launched.
echo   API:       http://localhost:5000
echo   Frontend:  http://localhost:5173
echo.
echo Opening the frontend in your default browser...
timeout /t 5 /nobreak >nul
start http://localhost:5173
echo.
echo Done. The launcher stopped any existing Dues servers before starting new ones.
pause
