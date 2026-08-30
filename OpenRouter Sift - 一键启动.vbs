Option Explicit

Dim shell, fso, root, cli, node, pathEntry, pathValue, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
cli = fso.BuildPath(root, "dist\server\cli.js")

If Not fso.FileExists(cli) Then
  MsgBox "找不到启动文件：" & vbCrLf & cli & vbCrLf & vbCrLf & "请先在项目目录执行 npm run build。", vbExclamation, "OpenRouter Sift"
  WScript.Quit 1
End If

node = ""
pathValue = shell.Environment("PROCESS")("PATH")
For Each pathEntry In Split(pathValue, ";")
  If Len(Trim(pathEntry)) > 0 Then
    If fso.FileExists(fso.BuildPath(Trim(pathEntry), "node.exe")) Then
      node = fso.BuildPath(Trim(pathEntry), "node.exe")
      Exit For
    End If
  End If
Next

If Len(node) = 0 Then
  MsgBox "找不到 node.exe，请先安装 Node.js 20 或更高版本。", vbExclamation, "OpenRouter Sift"
  WScript.Quit 1
End If

command = Chr(34) & node & Chr(34) & " " & Chr(34) & cli & Chr(34) & " launch"
shell.CurrentDirectory = root
shell.Run command, 0, False
