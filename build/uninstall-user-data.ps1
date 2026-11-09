param(
  [Parameter(Mandatory = $true)][ValidateSet("Describe", "Delete")][string]$Action,
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [Parameter(Mandatory = $true)][string]$ProfileDirectory
)

$ErrorActionPreference = "Stop"
$installRoot = [System.IO.Path]::GetFullPath($InstallDirectory)
$profileRoot = [System.IO.Path]::GetFullPath($ProfileDirectory)
$dataRoots = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$backupRoots = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$failures = [System.Collections.Generic.List[string]]::new()

function Add-Root($collection, [string]$directory) {
  if (-not [System.IO.Path]::IsPathRooted($directory)) { throw "Data location must be absolute: $directory" }
  $resolved = [System.IO.Path]::GetFullPath($directory).TrimEnd('\')
  if ($resolved -eq [System.IO.Path]::GetPathRoot($resolved).TrimEnd('\')) { throw "Refusing a drive root: $resolved" }
  [void]$collection.Add($resolved)
}

function Test-PlainPath([string]$directory) {
  $current = [System.IO.Path]::GetFullPath($directory)
  while (Test-Path -LiteralPath $current) {
    if ((Get-Item -LiteralPath $current -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { return $false }
    $parent = [System.IO.Directory]::GetParent($current)
    if ($null -eq $parent) { break }
    $current = $parent.FullName
  }
  return $true
}

function Remove-DataFile([string]$file) {
  if (-not (Test-Path -LiteralPath $file)) { return }
  try {
    if (-not (Test-PlainPath $file)) { throw "Linked path is preserved" }
    $item = Get-Item -LiteralPath $file -Force
    if ($item.PSIsContainer) { throw "Expected a regular file" }
    Remove-Item -LiteralPath $item.FullName -Force
  } catch { $failures.Add($file) }
}

try {
  Add-Root $dataRoots (Join-Path $installRoot "data")
  Add-Root $backupRoots (Join-Path $installRoot "backups")
  # All-user installations isolate records by Windows SID directly under the
  # two application roots. Only these well-formed, non-linked account folders
  # are included, never arbitrary descendants or other users' profile trees.
  $accountDirectories = @()
  foreach ($base in @((Join-Path $installRoot "data"), (Join-Path $installRoot "backups"))) {
    if ((Test-Path -LiteralPath $base) -and (Test-PlainPath $base)) {
      foreach ($child in Get-ChildItem -LiteralPath $base -Directory -Force) {
        if ($child.Name -match '^S-1-5-(\d+-)*\d+$' -and (Test-PlainPath $child.FullName)) {
          $accountDirectories += $child.FullName
          if ($base -eq (Join-Path $installRoot "data")) { Add-Root $dataRoots $child.FullName }
          else { Add-Root $backupRoots $child.FullName }
        }
      }
    }
  }
  # New installs own their pointer. Do not include the unrelated global legacy
  # profile when uninstalling a new, explicitly clean installation.
  $pointers = @((Join-Path (Join-Path $installRoot "data") "storage-locations.json"))
  $pointers += @($accountDirectories | Where-Object { $_.StartsWith((Join-Path $installRoot "data") + '\', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Join-Path $_ "storage-locations.json" })
  $pointers = @($pointers | Where-Object { Test-Path -LiteralPath $_ })
  # No fallback to the global legacy pointer: it can belong to a different
  # installation, including after this installation's pointer was removed.
  foreach ($pointer in $pointers) {
    if (-not (Test-Path -LiteralPath $pointer)) { continue }
    if (-not (Test-PlainPath $pointer)) { throw "Linked storage pointer is preserved" }
    $locations = Get-Content -LiteralPath $pointer -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($locations.dataDirectory) { Add-Root $dataRoots $locations.dataDirectory }
    if ($locations.backupDirectory) { Add-Root $backupRoots $locations.backupDirectory }
    elseif ($locations.dataDirectory) { Add-Root $backupRoots (Join-Path $locations.dataDirectory "backups") }
  }
  if ($Action -eq "Describe") {
    Write-Output ("数据目录：" + (($dataRoots | Sort-Object) -join "; "))
    Write-Output ("备份目录：" + (($backupRoots | Sort-Object) -join "; "))
    exit 0
  }

  # Delete only the application's known records and validated backup files.
  # Custom folders can contain other files; never recursively delete them.
  foreach ($directory in $dataRoots) {
    if (-not (Test-PlainPath $directory)) { $failures.Add($directory); continue }
    foreach ($name in @("qihang-state.json", "remote-servers.json")) { Remove-DataFile (Join-Path $directory $name) }
  }
  foreach ($directory in $backupRoots) {
    if (-not (Test-Path -LiteralPath $directory)) { continue }
    if (-not (Test-PlainPath $directory)) { $failures.Add($directory); continue }
    foreach ($file in Get-ChildItem -LiteralPath $directory -File -Filter "*.json" -Force) {
      if (-not (Test-PlainPath $file.FullName)) { $failures.Add($file.FullName); continue }
      try { $backup = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json }
      catch { continue }
      if ($backup.kind -eq "qihang-backup" -and $backup.version -eq 1) { Remove-DataFile $file.FullName }
    }
  }
  # Keep pointers if record removal failed, so remaining data stays locatable.
  if ($failures.Count -eq 0) { foreach ($pointer in $pointers) { Remove-DataFile $pointer } }
  # Remove only empty default application folders, never custom folders or a
  # directory tree. Unrelated files/subfolders keep their parent in place.
  $localData = @($dataRoots | Where-Object { $_.StartsWith((Join-Path $installRoot "data") + '\', [System.StringComparison]::OrdinalIgnoreCase) } | Sort-Object { $_.Length } -Descending)
  foreach ($directory in @($localData) + @($accountDirectories) + @((Join-Path $installRoot "data"), (Join-Path $installRoot "backups"))) {
    try {
      $resolved = [System.IO.Path]::GetFullPath($directory)
      if ((Test-Path -LiteralPath $resolved) -and (Test-PlainPath $resolved) -and -not (Get-ChildItem -LiteralPath $resolved -Force | Select-Object -First 1)) {
        Remove-Item -LiteralPath $resolved -Force
      }
    } catch { $failures.Add($directory) }
  }
  if ($failures.Count -gt 0) { Write-Output ("以下位置未完全删除，已保留：`r`n" + ($failures -join "`r`n")); exit 1 }
  Write-Output "已删除启航记录与备份，其他文件已保留。"
  exit 0
} catch { Write-Output $_.Exception.Message; exit 1 }
