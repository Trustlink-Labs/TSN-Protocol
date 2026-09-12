[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$watcher = Join-Path $root "Watch-SuspiciousActivity.ps1"
$preflight = Join-Path $root "Invoke-TrustLinkPreflight.ps1"
$credentialAudit = Join-Path $root "Invoke-TrustLinkCredentialAudit.ps1"

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Pause-Menu {
  [void](Read-Host "Press Enter to return to the menu")
}

function Invoke-Preflight {
  $target = Read-Host "Enter the assignment ZIP or extracted directory path"
  if (-not (Test-Path -LiteralPath $target)) {
    Write-Warning "Target does not exist."
    Pause-Menu
    return
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $preflight -TargetPath $target -FailOnSuspicious
  Pause-Menu
}

function Invoke-CredentialAudit {
  $target = Read-Host "Enter the TrustLink workspace path"
  if (-not (Test-Path -LiteralPath $target -PathType Container)) {
    Write-Warning "Workspace directory does not exist."
    Pause-Menu
    return
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $credentialAudit -WorkspacePath $target
  Pause-Menu
}

function Invoke-Watcher([switch]$AuditOnly) {
  if (-not (Test-Administrator)) {
    Write-Warning "Administrator PowerShell is required for enforcement, network isolation, and firewall rules."
    Write-Host "Restart this launcher as Administrator, then choose the protection option again." -ForegroundColor Yellow
    Pause-Menu
    return
  }
  if ($AuditOnly) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $watcher -Audit
  } else {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $watcher
  }
}

function Invoke-WorkspaceProtectedWatcher {
  if (-not (Test-Administrator)) {
    Write-Warning "Administrator PowerShell is required for Controlled Folder Access protection."
    Pause-Menu
    return
  }
  $workspace = (Resolve-Path (Join-Path $root "..\")).Path
  Write-Warning "Controlled Folder Access can block VS Code, Git, npm, and other apps from writing to the workspace."
  $confirmation = Read-Host "Protect $workspace now? Type PROTECT to continue"
  if ($confirmation -cne "PROTECT") {
    Write-Host "Protection cancelled."
    Pause-Menu
    return
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $watcher -ProtectWorkspacePath $workspace -BlockSuspiciousWorkspaceAccess
}

while ($true) {
  Clear-Host
  Write-Host "TrustLink Security Watch" -ForegroundColor Cyan
  Write-Host "Static-first protection and runtime response for untrusted assignments."
  Write-Host ""
  Write-Host "1. Full runtime protection" -ForegroundColor Red
  Write-Host "   Enforce process termination, alerts, network isolation, firewall blocks, and quarantine."
  Write-Host "2. Audit-only runtime watcher" -ForegroundColor Yellow
  Write-Host "   Observe and log suspicious activity without terminating processes."
  Write-Host "3. Preflight assignment scan" -ForegroundColor Green
  Write-Host "   Inspect a ZIP or directory before checkout, install, or build."
  Write-Host "4. TrustLink credential audit" -ForegroundColor Green
  Write-Host "   Find sensitive files and credential-shaped content without printing values."
  Write-Host "5. Runtime protection + block suspicious workspace access" -ForegroundColor Red
  Write-Host "   Enable Defender protection and terminate outside script hosts touching the workspace."
  Write-Host "6. Exit"
  Write-Host ""

  $choice = Read-Host "Choose an action"
  switch ($choice) {
    "1" { Invoke-Watcher }
    "2" { Invoke-Watcher -AuditOnly }
    "3" { Invoke-Preflight }
    "4" { Invoke-CredentialAudit }
    "5" { Invoke-WorkspaceProtectedWatcher }
    "6" { break }
    default { Write-Warning "Choose 1, 2, 3, 4, 5, or 6."; Start-Sleep -Seconds 2 }
  }
}
