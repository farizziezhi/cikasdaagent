' ==============================================================================
' Script Peluncur Latar Belakang: AI Agent PPID CIKASDA Sulteng
' Fungsi: Menjalankan bot 100% hening (Silent, tanpa tab, tanpa jendela, tanpa popup)
' ==============================================================================

Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

' Pastikan working directory berada di folder project bot
CurrentDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = CurrentDir

' Cek apakah file .env ada
If Not FSO.FileExists(CurrentDir & "\.env") Then
    WScript.Quit
End If

' Jalankan proses di background:
' Parameter 0 = Jendela 100% Tersembunyi (Hidden)
' Parameter False = Selesai tanpa menunggu proses bot mati
WshShell.Run "cmd /c pnpm run dev > bot.log 2>&1", 0, False
