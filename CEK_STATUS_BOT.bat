@echo off
title Status AI Agent PPID CIKASDA
color 0B

echo =====================================================================
echo            PEMERIKSAAN STATUS BOT AI AGENT PPID CIKASDA
echo =====================================================================
echo.

tasklist /FI "IMAGENAME eq node.exe" 2>NUL | find /I /N "node.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [STATUS] AKTIF / MENYALA (ONLINE)
    echo Bot sedang berjalan di latar belakang.
    echo.
    echo Rincian Proses Node.js:
    tasklist /FI "IMAGENAME eq node.exe" /FO TABLE
    echo.
) else (
    echo [STATUS] TIDAK AKTIF (OFFLINE)
    echo Bot saat ini sedang tidak berjalan di latar belakang.
    echo Untuk menyalakan, klik ganda file: JALANKAN_BACKGROUND.vbs
    echo.
)

if exist bot.log (
    echo ---------------------------------------------------------------------
    echo Log Aktivitas Terakhir (bot.log):
    echo ---------------------------------------------------------------------
    powershell -NoProfile -Command "Get-Content bot.log -Tail 15" 2>NUL
    echo ---------------------------------------------------------------------
)

echo.
pause
