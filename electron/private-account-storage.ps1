param([Parameter(Mandatory = $true)][string]$Directory, [Parameter(Mandatory = $true)][string]$UserSid)
$ErrorActionPreference = "Stop"
try {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  if ($identity.User.Value -ne $UserSid) { throw "Account identity mismatch" }
  $resolved = [System.IO.Path]::GetFullPath($Directory)
  $item = [System.IO.DirectoryInfo]::new($resolved)
  if (-not $item.Exists -or $item.Name -ne $UserSid -or $item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw "Invalid private account directory" }
  $existing = [System.IO.Directory]::GetAccessControl($resolved)
  $ownerSid = $existing.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  $administratorOwned = $ownerSid -eq "S-1-5-32-544" -and ([System.Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($ownerSid -ne $UserSid -and -not $administratorOwned) { throw "Directory is owned by another account; existing data was preserved" }
  $acl = [System.Security.AccessControl.DirectorySecurity]::new()
  if ($administratorOwned) { $acl.SetOwner($identity.User) }
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($entry in @(@($UserSid, "Modify"), @("S-1-5-18", "FullControl"), @("S-1-5-32-544", "FullControl"))) {
    $sid = [System.Security.Principal.SecurityIdentifier]::new($entry[0])
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, $entry[1], "ContainerInherit,ObjectInherit", "None", "Allow")
    [void]$acl.AddAccessRule($rule)
  }
  [System.IO.Directory]::SetAccessControl($resolved, $acl)
  exit 0
} catch { Write-Error $_; exit 1 }
