[CmdletBinding()]
param(
  [switch]$Enforce,
  [switch]$Audit,
  [switch]$NoNetworkIsolation,
  [int]$IntervalSeconds = 2,
  [int]$FilesystemScanSeconds = 30,
  [string[]]$ScanRoot = @(
    (Join-Path $env:USERPROFILE "Desktop"),
    (Join-Path $env:USERPROFILE "Downloads"),
    "C:\TEMP"
  )
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "SilentlyContinue"

if ($Enforce -and $Audit) {
  throw "Choose either -Audit or -Enforce, not both."
}
$enforcementEnabled = -not $Audit
$networkIsolationEnabled = $enforcementEnabled -and -not $NoNetworkIsolation

$stateRoot = Join-Path $env:LOCALAPPDATA "TrustLinkSecurityWatch"
$quarantineRoot = Join-Path $stateRoot "quarantine"
$logPath = Join-Path $stateRoot "watch.log"
New-Item -ItemType Directory -Force -Path $quarantineRoot | Out-Null

$knownBadIndicators = @(
  "144.172.118.214",
  "216.126.239.166",
  "service/makelog",
  "/api/service/makelog",
  "/upload",
  "wct1ECFA",
  "npm-compiler",
  "searchKey",
  "createReadStream",
  "get-clipboard",
  "private key",
  "secret phrase"
)
$knownBadRemoteAddresses = @("144.172.118.214", "216.126.239.166")
$firewallRulePrefix = "TrustLinkSecurityWatch-Block"
$knownBadPythonPath = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".bash\python.exe"))
$tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
$tempPayloadPattern = '(?i)\\wc[a-z0-9]{4,24}\.tmp(?:\.js)?(?:["''\s]|$)'
 
function Write-WatchLog([string]$Message) {
  $line = "{0:u} {1}" -f (Get-Date), $Message
  Add-Content -LiteralPath $logPath -Value $line
  Write-Host $line
}

function Alert-User([string]$Message) {
  Write-WatchLog "USER_ALERT $Message"
  Write-Warning $Message
  try {
    Start-Process -FilePath "$env:SystemRoot\System32\msg.exe" -ArgumentList @("*", $Message) -WindowStyle Hidden -Wait -ErrorAction Stop | Out-Null
  } catch {
    Write-WatchLog "USER_ALERT_FALLBACK : $($_.Exception.Message)"
  }
}

function Isolate-Network {
  if (-not $networkIsolationEnabled) { return }
  $adapters = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "Up" })
  if ($adapters.Count -eq 0) {
    Write-WatchLog "NETWORK_ISOLATION_NO_ACTIVE_PHYSICAL_ADAPTERS"
    return
  }
  foreach ($adapter in $adapters) {
    try {
      Disable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction Stop
      Write-WatchLog "NETWORK_ADAPTER_DISABLED NAME=$($adapter.Name) INTERFACE=$($adapter.InterfaceDescription)"
    } catch {
      Write-WatchLog "NETWORK_ADAPTER_DISABLE_FAILED NAME=$($adapter.Name) : $($_.Exception.Message)"
    }
  }
}

function Quarantine-File([string]$Path) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  $resolved = (Resolve-Path -LiteralPath $Path).Path
  $name = "{0}_{1}" -f (Get-Date -Format "yyyyMMdd_HHmmssfff"), [IO.Path]::GetFileName($resolved)
  $destination = Join-Path $quarantineRoot $name
  try {
    Move-Item -LiteralPath $resolved -Destination $destination -Force
    Write-WatchLog "QUARANTINED $resolved -> $destination"
  } catch {
    Write-WatchLog "QUARANTINE_FAILED $resolved : $($_.Exception.Message)"
  }
}

function Ensure-FirewallBlocks {
  foreach ($remoteAddress in $knownBadRemoteAddresses) {
    $ruleName = "$firewallRulePrefix-$remoteAddress"
    try {
      $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
      if (-not $existing) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Outbound -Action Block -RemoteAddress $remoteAddress -Profile Any -Protocol Any -ErrorAction Stop | Out-Null
        Write-WatchLog "FIREWALL_BLOCK_ADDED REMOTE=$remoteAddress"
      } else {
        Write-WatchLog "FIREWALL_BLOCK_PRESENT REMOTE=$remoteAddress"
      }
    } catch {
      Write-WatchLog "FIREWALL_BLOCK_FAILED REMOTE=$remoteAddress : $($_.Exception.Message)"
    }
  }
}

function Inspect-GitAndEditorWeaponization {
  $globalGitConfig = Join-Path $env:USERPROFILE ".gitconfig"
  if (Test-Path -LiteralPath $globalGitConfig -PathType Leaf) {
    $globalConfigText = Get-Content -LiteralPath $globalGitConfig -Raw -ErrorAction SilentlyContinue
    if ($globalConfigText -match '(?im)^\s*(hooksPath|templatedir)\s*=') {
      Write-WatchLog "DETECTED GLOBAL GIT HOOK CONFIG PATH=$globalGitConfig"
    }
  }

  foreach ($root in $ScanRoot) {
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
    $gitDirectories = @(Get-ChildItem -LiteralPath $root -Directory -Force -Filter ".git" -Recurse -Depth 5 -ErrorAction SilentlyContinue)
    foreach ($gitDirectory in $gitDirectories) {
      $hooksDirectory = Join-Path $gitDirectory.FullName "hooks"
      if (Test-Path -LiteralPath $hooksDirectory -PathType Container) {
        $hooks = @(Get-ChildItem -LiteralPath $hooksDirectory -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike "*.sample" })
        foreach ($hook in $hooks) {
          $hookText = Get-Content -LiteralPath $hook.FullName -Raw -ErrorAction SilentlyContinue
          $hookLooksMalicious = $hookText -match '(?is)(curl|wget|Invoke-WebRequest|Start-BitsTransfer).*(https?://|\\||cmd|sh|bash)' -or
            $hookText -match '(?i)(\$OSTYPE|uname|/dev/null|>\s*NUL|&\s*$|child_process|powershell)'
          if ($hookLooksMalicious) {
            Write-WatchLog "DETECTED MALICIOUS GIT HOOK PATH=$($hook.FullName)"
            if ($enforcementEnabled) { Quarantine-File $hook.FullName }
          } else {
            Write-WatchLog "OBSERVED NON_SAMPLE GIT HOOK PATH=$($hook.FullName)"
          }
        }
      }

      $repositoryRoot = Split-Path -Parent $gitDirectory.FullName
      $editorFiles = @(Get-ChildItem -LiteralPath (Join-Path $repositoryRoot ".vscode") -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @("tasks.json", "settings.json") })
      foreach ($editorFile in $editorFiles) {
        $editorText = Get-Content -LiteralPath $editorFile.FullName -Raw -ErrorAction SilentlyContinue
        if ($editorText -match '(?i)(runOn\s*["'']?\s*:\s*["'']?folderOpen|folderOpen|shellCommand|command\s*:)') {
          Write-WatchLog "DETECTED SUSPICIOUS VSCODE CONFIG PATH=$($editorFile.FullName)"
        }
      }
    }
  }
}

function Test-SuspiciousProcess($Process) {
  $path = [string]$Process.ExecutablePath
  $command = [string]$Process.CommandLine
  $reasons = [System.Collections.Generic.List[string]]::new()
  $isNode = $Process.Name -in @("node.exe", "nodejs.exe")
  $isScriptHost = $Process.Name -in @("cmd.exe", "powershell.exe", "pwsh.exe", "bash.exe", "sh.exe", "wscript.exe", "cscript.exe", "mshta.exe", "curl.exe", "wget.exe")
  $isTempPayload = $command -match '(?i)([A-Z]:\\[^" ]+\\[^" ]+\.tmp(?:\.js)?)'
  $isRandomTempName = $command -match $tempPayloadPattern
  $hasObfuscation = $command -match '(?i)(eval\s*\(|fromCharCode|atob\s*\(|Buffer\.from\s*\([^)]{0,200}base64|[A-Za-z0-9+/]{80,}={0,2})'
  $hasCollectionBehavior = $command -match '(?i)(get-clipboard|clipboard|screenshot|createReadStream|readdir|readFile|private.?key|secret.?phrase|mnemonic|wallet|\.ssh|\.aws|\.azure|\.env|metamask|solana|bitcoin)'

  if ($path -and [IO.Path]::GetFullPath($path) -ieq $knownBadPythonPath) { [void]$reasons.Add("known .bash Python path") }
  foreach ($indicator in $knownBadIndicators) {
    if ($command.IndexOf($indicator, [StringComparison]::OrdinalIgnoreCase) -ge 0) { [void]$reasons.Add("command indicator: $indicator") }
  }
  if (($isNode -or $isScriptHost) -and ($isTempPayload -or $command -match '(?i)(node\s+-e|curl\s+.*\|\s*(sh|bash|cmd)|wget\s+.*\|\s*(sh|bash))')) {
    [void]$reasons.Add("Node launched a temporary or inline script")
    if ($isRandomTempName) { [void]$reasons.Add("random temporary payload name") }
    if ($hasObfuscation) { [void]$reasons.Add("obfuscated script pattern") }
    if ($hasCollectionBehavior) { [void]$reasons.Add("clipboard, screenshot, wallet, or file-collection behavior") }
  }
  if ($isTempPayload -and $hasCollectionBehavior) {
    [void]$reasons.Add("temporary script accesses sensitive local data")
  }
  if ($path -and [IO.Path]::GetFullPath($path) -like "$tempRoot*") {
    [void]$reasons.Add("executable launched from user Temp")
  }
  if ($isScriptHost -and $hasCollectionBehavior -and $command -match '(?i)(axios|formdata|http|https|upload|post)') {
    [void]$reasons.Add("script host combines local-data collection with network upload")
  }
  return $reasons
}

function Inspect-Process($Process) {
  $reasons = @(Test-SuspiciousProcess $Process)
  if ($reasons.Count -eq 0) { return }
  $reasonText = $reasons -join "; "
  Write-WatchLog "DETECTED PID=$($Process.ProcessId) NAME=$($Process.Name) REASONS=$reasonText"
  if (-not $enforcementEnabled) { return }
  Alert-User "TrustLink Security Watch detected suspicious activity from PID $($Process.ProcessId) ($($Process.Name)). Network isolation is being attempted."
  Isolate-Network

  try {
    Stop-Process -Id $Process.ProcessId -Force -ErrorAction Stop
    Write-WatchLog "TERMINATED PID=$($Process.ProcessId)"
  } catch {
    Write-WatchLog "TERMINATE_FAILED PID=$($Process.ProcessId) : $($_.Exception.Message)"
  }

  if ($Process.CommandLine -match '(?i)([A-Z]:\\[^" ]+\.tmp(?:\.js)?)') {
    Quarantine-File $Matches[1]
  }
}

function Inspect-Network {
  foreach ($remoteAddress in $knownBadRemoteAddresses) {
    $connections = @(Get-NetTCPConnection -RemoteAddress $remoteAddress -ErrorAction SilentlyContinue)
    foreach ($connection in $connections) {
      $key = "$($connection.OwningProcess)|$remoteAddress|$($connection.RemotePort)"
      if (-not $seenConnections.ContainsKey($key)) {
        $seenConnections[$key] = $true
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction SilentlyContinue
        Write-WatchLog "DETECTED CONNECTION PID=$($connection.OwningProcess) REMOTE=$remoteAddress PORT=$($connection.RemotePort) OWNER=$($owner.Name)"
        if ($enforcementEnabled) {
          Alert-User "TrustLink Security Watch detected a suspicious outbound connection to $remoteAddress. Network isolation is being attempted."
          Isolate-Network
        }
        if ($enforcementEnabled -and $owner -and $connection.OwningProcess -gt 4) {
          try {
            Stop-Process -Id $connection.OwningProcess -Force -ErrorAction Stop
            Write-WatchLog "TERMINATED CONNECTION OWNER PID=$($connection.OwningProcess) NAME=$($owner.Name)"
          } catch {
            Write-WatchLog "CONNECTION_OWNER_TERMINATE_FAILED PID=$($connection.OwningProcess) : $($_.Exception.Message)"
          }
        }
      }
    }
  }
}

function Inspect-TempPayloads {
  $files = @(Get-ChildItem -LiteralPath $env:TEMP -Filter "wc*.tmp" -File -Force -ErrorAction SilentlyContinue)
  foreach ($file in $files) {
    if ($file.Name -notmatch '(?i)^wc[a-z0-9]{4,24}\.tmp$') { continue }
    if (-not $seenFiles.ContainsKey($file.FullName)) {
      $seenFiles[$file.FullName] = $true
      Write-WatchLog "DETECTED TEMP PAYLOAD PATH=$($file.FullName) SIZE=$($file.Length) CREATED=$($file.CreationTime.ToString('o'))"
      if ($enforcementEnabled) { Quarantine-File $file.FullName }
    }
  }
}

Write-WatchLog "STARTED mode=$(if($enforcementEnabled){'enforce'}else{'audit'}) interval=${IntervalSeconds}s"
$seen = @{}
if ($enforcementEnabled) { Ensure-FirewallBlocks }
$seenConnections = @{}
$seenFiles = @{}
$lastFilesystemScan = [datetime]::MinValue
while ($true) {
  $processes = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @("node.exe", "nodejs.exe", "python.exe", "pythonw.exe", "cmd.exe", "powershell.exe", "pwsh.exe", "bash.exe", "sh.exe", "wscript.exe", "cscript.exe", "mshta.exe", "curl.exe", "wget.exe") })
  foreach ($process in $processes) {
    $processId = [int]$process.ProcessId
    $processSignature = "$($process.Name)|$($process.ExecutablePath)|$($process.CommandLine)"
    if (-not $seen.ContainsKey($processId) -or $seen[$processId] -ne $processSignature) {
      $seen[$processId] = $processSignature
      Inspect-Process $process
    }
  }
  foreach ($processId in @($seen.Keys)) {
    if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { [void]$seen.Remove($processId) }
  }
  Inspect-Network
  Inspect-TempPayloads
  if (((Get-Date) - $lastFilesystemScan).TotalSeconds -ge [Math]::Max(10, $FilesystemScanSeconds)) {
    Inspect-GitAndEditorWeaponization
    $lastFilesystemScan = Get-Date
  }
  Start-Sleep -Seconds ([Math]::Max(1, $IntervalSeconds))
}
