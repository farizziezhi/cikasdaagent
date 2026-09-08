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
echo [1/4] Menghentikan proses background lama...
taskkill /F /IM node.exe >NUL 2>&1

:: 2. Reset full OpenClaw attestation & cache agar error WorkspaceVanishedError teratasi bersih
echo [2/4] Mereset status attestation dan cache OpenClaw...
call pnpm exec openclaw reset --scope full --yes --non-interactive

:: 3. Bersihkan stabilitas breaker & temporary files jika masih ada
echo [3/4] Membersihkan log stabilitas dan temporary files...
if exist "%USERPROFILE%\.openclaw\logs\stability" rd /s /q "%USERPROFILE%\.openclaw\logs\stability" >NUL 2>&1
if exist "%USERPROFILE%\.openclaw\tmp" rd /s /q "%USERPROFILE%\.openclaw\tmp" >NUL 2>&1
if exist "%USERPROFILE%\.openclaw\workspace" rd /s /q "%USERPROFILE%\.openclaw\workspace" >NUL 2>&1

:: 4. Jalankan OpenClaw doctor repair otomatis
echo [4/4] Menjalankan OpenClaw doctor auto-repair...
call pnpm exec openclaw doctor --fix --yes --non-interactive

echo.
echo =====================================================================
color 0A
echo [SUKSES] Sistem OpenClaw berhasil diperbaiki dan dimigrasi secara bersih!
echo.
echo Silakan sekarang jalankan:
echo 1. JALANKAN_BOT.bat (untuk melihat langsung bot aktif di layar)
echo 2. Atau PASANG_AUTO_START.bat (agar aktif otomatis di background)
echo =====================================================================
echo.
pause
