@echo off
title Perbaikan Otomatis AI Agent PPID CIKASDA
color 0E

echo =====================================================================
echo           PERBAIKAN OTOMATIS & MIGRASI SISTEM OPENCLAW
echo =====================================================================
echo.
echo Sedang mendeteksi dan memperbaiki cache sistem...
echo.

:: 1. Hentikan proses node yang mungkin masih berjalan di background
taskkill /F /IM node.exe >NUL 2>&1

:: 2. Bersihkan stability crash-loop breaker agar pembatas trip ter-reset
if exist "%USERPROFILE%\.openclaw\logs\stability" (
    echo [1/3] Mereset stability crash-loop breaker...
    rd /s /q "%USERPROFILE%\.openclaw\logs\stability" >NUL 2>&1
)

:: 3. Bersihkan workspace legacy versi lama yang memicu error
if exist "%USERPROFILE%\.openclaw\workspace" (
    echo [2/3] Membersihkan legacy workspace lama...
    rd /s /q "%USERPROFILE%\.openclaw\workspace" >NUL 2>&1
)

:: 4. Jalankan OpenClaw doctor repair otomatis
echo [3/3] Menjalankan OpenClaw doctor auto-repair...
call pnpm exec openclaw doctor --fix --yes --non-interactive

echo.
echo =====================================================================
color 0A
echo [SUKSES] Sistem OpenClaw berhasil diperbaiki dan dimigrasi!
echo.
echo Silakan sekarang jalankan:
echo 1. JALANKAN_BOT.bat (untuk melihat langsung bot aktif di layar)
echo 2. Atau PASANG_AUTO_START.bat (agar aktif di background)
echo =====================================================================
echo.
pause
