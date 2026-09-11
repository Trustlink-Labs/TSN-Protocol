[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$WorkspacePath,
  [string]$ReportPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "SilentlyContinue"

$root = (Resolve-Path -LiteralPath $WorkspacePath).Path
$findings = [System.Collections.Generic.List[object]]::new()
$skipPattern = '(?i)(\\|/)(node_modules|\.git|dist|build|\.next)(\\|/)'
$filenamePattern = '(?i)(^|[._-])(env|secret|secrets|credential|credentials|private|wallet|keystore)([._-]|$)|(\.pem|\.key|\.p12|\.pfx)$|(?:^|[\\/])id_rsa'
$contentPatterns = @(
  @{ Name = "private-key"; Pattern = "-----BEGIN [A-Z ]*PRIVATE KEY-----" },
  @{ Name = "GitHub-token"; Pattern = "\b(ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}\b" },
  @{ Name = "cloud-access-key"; Pattern = "\bAKIA[0-9A-Z]{16}\b" },
  @{ Name = "generic-secret-assignment"; Pattern = "(?im)^\s*(api[_-]?key|secret|private[_-]?key|mnemonic|seed[_-]?phrase|access[_-]?token)\s*[:=]" }
)

function Add-Finding([string]$Path, [string]$Reason, [string]$Severity) {
  [void]$findings.Add([pscustomobject]@{
    Path = $Path
    Reason = $Reason
    Severity = $Severity
    Recommendation = "Rotate or revoke this credential if the workspace was exposed."
  })
}

$files = @(Get-ChildItem -LiteralPath $root -File -Force -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch $skipPattern })

foreach ($file in $files) {
  if ($file.FullName -match $filenamePattern) {
    Add-Finding $file.FullName "Sensitive credential or key filename" "high"
  }

  if ($file.Length -le 2MB -and $file.Extension -in @(".env", ".txt", ".json", ".yaml", ".yml", ".toml", ".ini", ".conf", ".config", ".ts", ".js", ".ps1")) {
    $text = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
    foreach ($pattern in $contentPatterns) {
      if ($text -match $pattern.Pattern) {
        Add-Finding $file.FullName "Sensitive content pattern: $($pattern.Name)" "high"
      }
    }
  }
}

$result = [pscustomobject]@{
  AuditedAt = (Get-Date).ToUniversalTime().ToString("o")
  Workspace = $root
  FindingCount = $findings.Count
  Findings = @($findings | Sort-Object Path, Reason -Unique)
}

$json = $result | ConvertTo-Json -Depth 6
if ($ReportPath) { $json | Set-Content -LiteralPath $ReportPath -Encoding UTF8 }
Write-Output $json
