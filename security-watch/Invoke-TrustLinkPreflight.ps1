[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$TargetPath,
  [string]$ReportPath,
  [switch]$FailOnSuspicious
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

$findings = [System.Collections.Generic.List[object]]::new()
$hookPattern = '(?is)(curl|wget|Invoke-WebRequest|Start-BitsTransfer).*(https?://|\||cmd|sh|bash)|(\$OSTYPE|uname|child_process|powershell)'
$executionPattern = '(?is)(postinstall|preinstall|install|prepare|prepublish|folderOpen|shellCommand|child_process|execSync|spawn|eval\s*\(|new\s+Function)'

function Add-Finding([string]$Category, [string]$Path, [string]$Severity, [string]$Reason) {
  [void]$findings.Add([pscustomobject]@{
    Category = $Category
    Path = $Path
    Severity = $Severity
    Reason = $Reason
  })
}

function Read-BoundedText([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.Length -gt 2MB) { return "" }
  return Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
}

function Inspect-Text([string]$Path, [string]$Text) {
  if ($Path -match '(?i)(^|[/\\])\.git[/\\]hooks[/\\]' -and $Path -notmatch '(?i)\.sample$') {
    if ($Text -match $hookPattern) {
      Add-Finding "git-hook" $Path "high" "Hook contains download/execute, OS-fingerprinting, or shell execution indicators."
    } else {
      Add-Finding "git-hook" $Path "medium" "Non-sample Git hook is present in the supplied project."
    }
  }

  if ($Path -match '(?i)(^|[/\\])\.vscode[/\\](tasks|settings)\.json$' -and $Text -match '(?i)(folderOpen|shellCommand|command\s*:)') {
    Add-Finding "editor-config" $Path "high" "VS Code configuration contains an automatic or shell execution indicator."
  }

  if ($Path -match '(?i)(^|[/\\])package\.json$') {
    try {
      $package = $Text | ConvertFrom-Json
      if ($package.scripts) {
        foreach ($property in $package.scripts.PSObject.Properties) {
          if ([string]$property.Value -match $executionPattern) {
            Add-Finding "package-script" "$Path::$($property.Name)" "high" "Lifecycle or script command contains execution, download, or dynamic-code indicators."
          }
        }
      }
    } catch {
      Add-Finding "package-json" $Path "medium" "package.json could not be parsed as JSON."
    }
  }
}

function Inspect-Directory([string]$Root) {
  $files = @(Get-ChildItem -LiteralPath $Root -File -Force -Recurse -ErrorAction SilentlyContinue |
    Where-Object {
      $_.FullName -match '(?i)(\\|/)\.git(\\|/)hooks(\\|/)' -or
      $_.FullName -match '(?i)(\\|/)\.vscode(\\|/)(tasks|settings)\.json$' -or
      $_.Name -ieq "package.json"
    })

  foreach ($file in $files) {
    try {
      Inspect-Text $file.FullName (Read-BoundedText $file.FullName)
    } catch {
      Add-Finding "read-error" $file.FullName "medium" "Could not read the file for static inspection."
    }
  }
}

function Inspect-Zip([string]$Path) {
  $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
  try {
    foreach ($entry in $archive.Entries) {
      $entryPath = $entry.FullName.Replace("/", "\")
      $isRelevant = $entryPath -match '(?i)(^|\\)\.git\\hooks\\' -or
        $entryPath -match '(?i)(^|\\)\.vscode\\(tasks|settings)\.json$' -or
        $entryPath -match '(?i)(^|\\)package\.json$'
      if (-not $isRelevant -or $entry.FullName.EndsWith("/")) { continue }

      $reader = New-Object System.IO.StreamReader($entry.Open())
      try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
      Inspect-Text $entryPath $text
    }
  } finally {
    $archive.Dispose()
  }
}

$resolved = (Resolve-Path -LiteralPath $TargetPath).Path
Write-Output "TrustLink preflight scan: $resolved"
Write-Output "Static inspection only: no install, checkout, build, or target script execution."

if ((Get-Item -LiteralPath $resolved).PSIsContainer) {
  Inspect-Directory $resolved
} elseif ([IO.Path]::GetExtension($resolved) -ieq ".zip") {
  Inspect-Zip $resolved
} else {
  throw "Target must be a directory or .zip archive."
}

$verdict = if ($findings | Where-Object Severity -eq "high") { "SUSPICIOUS" } elseif ($findings.Count -gt 0) { "REVIEW_REQUIRED" } else { "NO_MATCHES_FOUND" }
$result = [pscustomobject]@{
  ScannedAt = (Get-Date).ToUniversalTime().ToString("o")
  Target = $resolved
  Verdict = $verdict
  Findings = @($findings)
}

$json = $result | ConvertTo-Json -Depth 6
if ($ReportPath) {
  $json | Set-Content -LiteralPath $ReportPath -Encoding UTF8
  Write-Output "Report written to $ReportPath"
}
Write-Output $json

if ($FailOnSuspicious -and $verdict -ne "NO_MATCHES_FOUND") { exit 10 }
