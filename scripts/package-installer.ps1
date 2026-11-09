$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$releaseRoot = Join-Path $projectRoot "release"
# Always package a fresh payload. Never package the user's portable directory,
# which can contain real data, backups and saved encrypted SSH credentials.
$stageName = ".installer-stage-" + [guid]::NewGuid().ToString("N")
$stageRoot = Join-Path $releaseRoot $stageName
& (Join-Path $PSScriptRoot "package-portable.ps1") -OutputDirectory $stageName

$buildRoot = Join-Path $projectRoot "build"
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
$manifest = [System.Collections.Generic.List[string]]::new()
$manifest.Add('!macro customRemoveFiles')
$manifest.Add('  SetOutPath "$TEMP"')
# Delete only files in this build's payload. Non-recursive RMDir removes empty
# app folders; unknown user files and data/backups are preserved on uninstall
# and on the uninstall phase of an upgrade, regardless of custom locations.
foreach ($entry in Get-ChildItem -LiteralPath $stageRoot -Recurse -File) {
  $relative = $entry.FullName.Substring($stageRoot.Length + 1)
  if ($relative -match '["$]') { throw "Unsupported installer payload path: $relative" }
  $manifest.Add('  Delete "$INSTDIR\' + $relative + '"')
}
$manifest.Add('  Delete "$INSTDIR\${UNINSTALL_FILENAME}"')
$manifest.Add('  Delete "$INSTDIR\resources\elevate.exe"')
$manifest.Add('  Delete "$INSTDIR\.qihang-all-users"')
$manifest.Add('  Delete "$INSTDIR\uninstallerIcon.ico"')
foreach ($entry in Get-ChildItem -LiteralPath $stageRoot -Recurse -Directory | Sort-Object { $_.FullName.Length } -Descending) {
  $relative = $entry.FullName.Substring($stageRoot.Length + 1)
  if ($relative -match '["$]') { throw "Unsupported installer payload directory: $relative" }
  $manifest.Add('  RMDir "$INSTDIR\' + $relative + '"')
}
$manifest.Add('  RMDir "$INSTDIR"')
$manifest.Add('!macroend')
[System.IO.File]::WriteAllLines((Join-Path $buildRoot "installer-files.nsh"), $manifest, [System.Text.UTF8Encoding]::new($true))

Push-Location $projectRoot
try {
  & (Join-Path $projectRoot "node_modules\.bin\electron-builder.cmd") --win nsis --x64 --prepackaged $stageRoot
  if ($LASTEXITCODE -ne 0) { throw "Installer build failed ($LASTEXITCODE)." }
} finally { Pop-Location }
