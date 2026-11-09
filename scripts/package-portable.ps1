param([switch]$UpdateAppOnly, [string]$OutputDirectory = "qihang-portable")

$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$electronDist = Join-Path $projectRoot "node_modules\electron\dist"
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "release"))
$portableRoot = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot $OutputDirectory))
$appRoot = Join-Path $portableRoot "resources\app"

if (-not (Test-Path -LiteralPath (Join-Path $electronDist "electron.exe"))) {
  throw "Electron runtime is missing. Run npm install first."
}

if (-not $portableRoot.StartsWith($releaseRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Portable output resolved outside the release directory."
}

if ($UpdateAppOnly) {
  if (-not (Test-Path -LiteralPath (Join-Path $portableRoot "Qihang.exe"))) {
    throw "An existing portable runtime is required for UpdateAppOnly."
  }
} else {
  # A portable application now owns adjacent data/backups. Refresh runtime files
  # in place instead of recursively deleting the output directory.
  New-Item -ItemType Directory -Path $portableRoot -Force | Out-Null
  foreach ($runtimeEntry in Get-ChildItem -LiteralPath $electronDist) {
    if ($runtimeEntry.Name -eq "electron.exe") {
      Copy-Item -LiteralPath $runtimeEntry.FullName -Destination (Join-Path $portableRoot "Qihang.exe") -Force
    } else {
      Copy-Item -LiteralPath $runtimeEntry.FullName -Destination $portableRoot -Recurse -Force
    }
  }
}

New-Item -ItemType Directory -Path $appRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot "package.json") -Destination $appRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "LICENSE") -Destination $appRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "THIRD_PARTY_NOTICES.md") -Destination $appRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "electron") -Destination $appRoot -Recurse -Force
New-Item -ItemType Directory -Path (Join-Path $appRoot "dist") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot "dist\client") -Destination (Join-Path $appRoot "dist") -Recurse -Force

# Resolve SSH and database driver runtime dependencies; optional native accelerators are not needed.
$runtimePackages = @(& node (Join-Path $PSScriptRoot "runtime-dependencies.cjs"))
if ($LASTEXITCODE -ne 0) { throw "Cannot resolve remote monitoring runtime dependencies." }
$runtimeRoot = Join-Path $appRoot "node_modules"
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
foreach ($runtimePackage in $runtimePackages) {
  $dependency = Get-Content -LiteralPath (Join-Path $runtimePackage "package.json") -Raw | ConvertFrom-Json
  $dependencyTarget = Join-Path $runtimeRoot $dependency.name
  $dependencyParent = Split-Path -Parent $dependencyTarget
  New-Item -ItemType Directory -Path $dependencyParent -Force | Out-Null
  Copy-Item -LiteralPath $runtimePackage -Destination $dependencyParent -Recurse -Force
}

Write-Output "Portable build created at $portableRoot"
