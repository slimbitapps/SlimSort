; Frühere Version (Electron) vor der Installation still entfernen,
; damit es keine zwei SlimSort-Einträge gibt. Einstellungen bleiben erhalten.
!macro NSIS_HOOK_PREINSTALL
  IfFileExists "$LOCALAPPDATA\Programs\slimsort\Uninstall SlimSort.exe" 0 +3
    ExecWait '"$LOCALAPPDATA\Programs\slimsort\Uninstall SlimSort.exe" /S --updated _?=$LOCALAPPDATA\Programs\slimsort'
    RMDir /r "$LOCALAPPDATA\Programs\slimsort"
!macroend
