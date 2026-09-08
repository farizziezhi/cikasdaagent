@echo off
title Pasang Auto-Start AI Agent PPID CIKASDA
color 0A

echo =====================================================================
echo       PASANG AUTO-START (OTOMATIS NYALA SAAT KOMPUTER HIDUP)
echo =====================================================================
echo.

set "TARGET=%~dp0JALANKAN_BACKGROUND.vbs"
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PPID_Agent_CIKASDA.lnk"

echo Menyiapkan pintasan di folder Startup Windows...
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%TARGET%'; $s.WorkingDirectory = '%~dp0'; $s.Save()"

if exist "%SHORTCUT%" (
    echo.
    echo [SUKSES] Auto-Start berhasil dipasang!
    echo.
    echo Penjelasan:
    echo - Setiap kali komputer kantor dinyalakan / dihidupkan kembali,
    echo   bot akan OTOMATIS AKTIF di latar belakang.
    echo - TIDAK ADA jendela hitam / tab apapun yang muncul di layar.
    echo - Staf kantor bisa langsung menggunakan komputer seperti biasa.
    echo.
    echo Untuk mengecek apakah bot sedang aktif, jalankan: CEK_STATUS_BOT.bat
) else (
    echo.
    echo [GAGAL] Tidak dapat membuat pintasan Startup otomatis.
)

echo.
pause
