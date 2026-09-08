@echo off
title Copot Auto-Start AI Agent PPID CIKASDA
color 0C

echo =====================================================================
echo                 MENGHAPUS AUTO-START BOT
echo =====================================================================
echo.

set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PPID_Agent_CIKASDA.lnk"

if exist "%SHORTCUT%" (
    del "%SHORTCUT%"
    echo [SUKSES] Auto-Start berhasil dicopot.
    echo Bot TIDAK AKAN lagi menyala otomatis saat komputer dinyalakan.
) else (
    echo [INFO] Pintasan Auto-Start memang belum terpasang sebelumnya.
)

echo.
pause
