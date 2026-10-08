Option Explicit
Dim shell, files, root, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File " & Chr(34) & root & "\tools\qtiler-installer-gui.ps1" & Chr(34) & " -Root " & Chr(34) & root & Chr(34) & " -OutputPath " & Chr(34) & root & "\temp\qtiler-installer-config.txt" & Chr(34) & " -RunInstaller"
shell.Run command, 0, False