@echo off
title AI Agent PPID CIKASDA
color 0A

echo =====================================================================
echo           AI AGENT KESEKRETARIATAN PPID DINAS CIKASDA SULTENG        
echo =====================================================================
echo.
echo Sedang memeriksa konfigurasi dan memulai server bot...
echo.

if not exist .env (
    echo [ERROR] File .env tidak ditemukan!
    echo Harap letakkan file .env di folder ini terlebih dahulu sebelum menjalankan.
    echo.
    pause
    exit /b
)

echo [OK] File .env ditemukan.
echo Memulai bot di latar belakang...
echo.
echo PERHATIAN: Jendela ini adalah server bot Telegram.
echo Jangan ditutup agar bot tetap online dan dapat membalas chat staf.
echo (Jendela ini boleh di-minimize).
echo =====================================================================
echo.

pnpm run dev

pause
