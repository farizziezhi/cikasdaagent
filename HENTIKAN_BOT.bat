@echo off
title Hentikan AI Agent PPID CIKASDA
color 0C

echo =====================================================================
echo              MENGHENTIKAN AI AGENT PPID CIKASDA
echo =====================================================================
echo.

tasklist /FI "IMAGENAME eq node.exe" 2>NUL | find /I /N "node.exe">NUL
if not "%ERRORLEVEL%"=="0" (
    echo [INFO] Bot saat ini memang sedang tidak berjalan.
    echo.
    pause
    exit /b
)

echo Sedang mematikan proses bot di latar belakang...
taskkill /F /IM node.exe >NUL 2>&1

echo.
echo [SUKSES] Bot berhasil dihentikan.
echo Bot sekarang berada dalam status OFFLINE.
echo.
pause
