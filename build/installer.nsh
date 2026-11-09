!include "${BUILD_RESOURCES_DIR}\installer-files.nsh"

!macro customInstall
  CreateDirectory "$INSTDIR\data"
  CreateDirectory "$INSTDIR\backups"
  ; Ordinary users can create only their own account subfolder at these roots.
  ; No group receives recursive modify access. The app locks its own newly
  ; created account folder to that user, SYSTEM and Administrators before use.
  ${If} $installMode == "all"
    FileOpen $R0 "$INSTDIR\.qihang-all-users" w
    FileWrite $R0 "account-storage-v1"
    FileClose $R0
    nsExec::ExecToStack '"$SYSDIR\icacls.exe" "$INSTDIR\data" /grant "*S-1-5-32-545:(AD)" /Q'
    Pop $R0
    Pop $R1
    ${If} $R0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "未能设置 data 目录的写入权限。请使用有写入权限的安装位置。"
    ${EndIf}
    nsExec::ExecToStack '"$SYSDIR\icacls.exe" "$INSTDIR\backups" /grant "*S-1-5-32-545:(AD)" /Q'
    Pop $R0
    Pop $R1
    ${If} $R0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "未能设置 backups 目录的写入权限。请使用有写入权限的安装位置。"
    ${EndIf}
  ${Else}
    Delete "$INSTDIR\.qihang-all-users"
  ${EndIf}
!macroend

!macro customUnInstall
  ; Updates must never prompt for or delete user data. Silent uninstalls keep it.
  ${ifNot} ${isUpdated}
    ${IfNot} ${Silent}
      ; $APPDATA must refer to the current Windows profile, even when the
      ; machine-wide uninstall keeps registry/shortcut operations in all scope.
      SetShellVarContext current
      InitPluginsDir
      File /oname=$PLUGINSDIR\qihang-user-data.ps1 "${BUILD_RESOURCES_DIR}\uninstall-user-data.ps1"
      nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\qihang-user-data.ps1" -Action Describe -InstallDirectory "$INSTDIR" -ProfileDirectory "$APPDATA\${APP_PACKAGE_NAME}"'
      Pop $R0
      Pop $R1
      ${If} $R0 == 0
        MessageBox MB_YESNOCANCEL|MB_ICONQUESTION|MB_DEFBUTTON2 "是否同时删除启航的用户数据和备份？$\r$\n$\r$\n$R1$\r$\n$\r$\n是：删除服务配置、笔记、命令收藏、远程连接及启航备份（不可恢复）。$\r$\n否：保留全部数据和备份，重新安装可继续使用。$\r$\n取消：退出卸载。$\r$\n自定义目录中的其他文件不会删除。" IDYES qihangDeleteUserData IDNO qihangKeepUserData
        Abort
        qihangDeleteUserData:
          nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\qihang-user-data.ps1" -Action Delete -InstallDirectory "$INSTDIR" -ProfileDirectory "$APPDATA\${APP_PACKAGE_NAME}"'
          Pop $R0
          Pop $R1
          ${If} $R0 != 0
            MessageBox MB_OK|MB_ICONEXCLAMATION "部分用户数据未能删除。$\r$\n$R1"
          ${EndIf}
        qihangKeepUserData:
      ${Else}
        MessageBox MB_OK|MB_ICONEXCLAMATION "无法读取数据位置，本次卸载将保留用户数据和备份。$\r$\n$R1"
      ${EndIf}
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
