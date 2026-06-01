Option Explicit

Dim shell, fso, scriptDir, targetScript, targetPath, args, i, command, exitCode

If WScript.Arguments.Count < 1 Then
    WScript.Quit 1
End If

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
targetScript = WScript.Arguments(0)

If fso.FileExists(targetScript) Then
    targetPath = targetScript
Else
    targetPath = fso.BuildPath(scriptDir, targetScript)
End If

If Not fso.FileExists(targetPath) Then
    WScript.Quit 2
End If

args = ""
For i = 1 To WScript.Arguments.Count - 1
    args = args & " " & QuoteArg(WScript.Arguments(i))
Next

command = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File " & QuoteArg(targetPath) & args
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function QuoteArg(value)
    QuoteArg = Chr(34) & Replace(CStr(value), Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
