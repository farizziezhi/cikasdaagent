@echo off
title AI Agent PPID CIKASDA
color 0A

echo =====================================================================
echo           AI AGENT KESEKRETARIATAN PPID DINAS CIKASDA SULTENG        
echo =====================================================================
echo.
echo Sedang memeriksa konfigurasi dan status sistem...
echo.

if not exist .env (
    echo [ERROR] File .env tidak ditemukan!
    echo Harap letakkan file .env di folder ini terlebih dahulu sebelum menjalankan.
    echo.
    pause
    exit /b
)

:: Reset crash loop breaker jika pernah gagal sebelumnya
if exist "%USERPROFILE%\.openclaw\logs\stability" (
    rd /s /q "%USERPROFILE%\.openclaw\logs\stability" >NUL 2>&1
)

:: Self-healing: Cegah WorkspaceVanishedError jika workspace attestation desync
if exist "%USERPROFILE%\.openclaw\state" if not exist "%USERPROFILE%\.openclaw\workspace" (
    echo [HEALING] Memulihkan integritas workspace OpenClaw...
    call pnpm exec openclaw reset --scope full --yes --non-interactive >NUL 2>&1
    call pnpm exec openclaw doctor --fix --yes --non-interactive >NUL 2>&1
)

echo [OK] File .env ditemukan.
echo Memulai server bot...
echo.
echo PERHATIAN: Jendela ini adalah server bot Telegram.
echo Jangan ditutup agar bot tetap online dan dapat membalas chat staf.
echo (Jendela ini boleh di-minimize).
echo =====================================================================
echo.

pnpm run dev

pause
