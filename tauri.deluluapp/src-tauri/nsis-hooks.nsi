; Custom NSIS hooks for Delulu installer
; Automatically adds Windows Defender exclusion BEFORE extracting files,
; so bundled runtime files don't get quarantined during install.

!macro NSIS_HOOK_PREINSTALL
  ; Add install directory to Windows Defender exclusion list BEFORE extraction.
  ; The installer already runs elevated (perMachine), so this works.
  ; SilentlyContinue handles cases where Defender service isn't running (e.g., third-party AV).
  DetailPrint "Adding Windows Defender exclusion for $INSTDIR..."
  nsExec::ExecToLog 'powershell -ExecutionPolicy Bypass -Command "try { Add-MpPreference -ExclusionPath \"$INSTDIR\" -ErrorAction SilentlyContinue } catch {}"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Remove the Defender exclusion on uninstall
  DetailPrint "Removing Windows Defender exclusion..."
  nsExec::ExecToLog 'powershell -ExecutionPolicy Bypass -Command "try { Remove-MpPreference -ExclusionPath \"$INSTDIR\" -ErrorAction SilentlyContinue } catch {}"'
!macroend
