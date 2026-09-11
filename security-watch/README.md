# TrustLink Security Watch

TrustLink Security Watch is a defensive Windows monitoring tool for identifying suspicious processes, temporary payloads, malicious Git hooks, clipboard/file collection behavior, and known outbound exfiltration indicators.

The project was created after investigating a linked paid recruiter take-home assignment that contained a remote-code-execution dropper. The supplied project presented itself as a React and Express assignment, but the delivered Git metadata contained weaponized hooks that could run during normal Git checkout and Git commit operations.

The investigation and incident indicators are documented in [Swap03pathi/crypto_research#2](https://github.com/Swap03pathi/crypto_research/pull/2). This repository contains defensive code and sanitized documentation only; it does not store or execute the malware sample.

## Quick start

Requirements:

- Windows PowerShell 5.1 or PowerShell 7.
- Microsoft Defender enabled.
- Administrator PowerShell for process enforcement and Windows Firewall rules.

Clone the repository and enter its directory:

~~~powershell
git clone https://github.com/bigdreamsweb3/trustlink-security-watch.git
cd trustlink-security-watch
~~~

Launch the interactive menu to choose a protection function:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-TrustLinkSecurityWatch.ps1
~~~

The menu provides full runtime protection, audit-only monitoring, preflight assignment scanning, and TrustLink credential auditing.

Before opening or installing an unfamiliar assignment, run the static preflight scanner against the ZIP file. It reads the archive without extracting or executing the project:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-TrustLinkPreflight.ps1 -TargetPath C:\path\to\assignment.zip -ReportPath .\preflight-report.json -FailOnSuspicious
~~~

If the result is suspicious, do not run Git, npm, a build, or any project script inside that assignment. Review the report first.

To start the runtime watcher, open PowerShell as Administrator and run:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Watch-SuspiciousActivity.ps1
~~~

Enforcement is enabled by default. The watcher terminates matching processes, quarantines matching temporary payloads, and adds outbound firewall blocks for the known endpoints.

For observation-only mode:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Watch-SuspiciousActivity.ps1 -Audit
~~~

Stop the watcher with Ctrl+C. Logs and quarantined files are stored at:

~~~text
%LOCALAPPDATA%\TrustLinkSecurityWatch\
~~~

## What the watcher protects against

The watcher provides an additional response layer for suspicious behavior such as:

- Node, Python, PowerShell, CMD, Bash, and other script-host processes launched with suspicious command lines.
- Random temporary payloads such as wc*.tmp, wct*.tmp, and temporary JavaScript files.
- Obfuscated inline scripts and shell pipelines that download and execute remote code.
- Clipboard, wallet, SSH, .env, cloud-credential, private-key, and secret-phrase collection indicators.
- File collection combined with HTTP upload behavior.
- Connections to known malicious endpoints.
- Suspicious Git hooks such as post-checkout and pre-commit.

## Preflight scanning before running an assignment

The preflight scanner performs static inspection before checkout, commit, install, or build. It reads ZIP entries without extracting or executing them and checks directories for Git hooks, VS Code auto-run configuration, and package lifecycle scripts.

~~~powershell
cd C:\Users\codepara\Desktop\trust-link\security-watch
powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-TrustLinkPreflight.ps1 -TargetPath C:\path\to\assignment.zip -ReportPath .\preflight-report.json -FailOnSuspicious
~~~

For an extracted directory:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-TrustLinkPreflight.ps1 -TargetPath C:\path\to\assignment
~~~

The scanner does not run npm, Git checkout, Git commit, project builds, lifecycle scripts, or any target entry point. A suspicious result means the project should remain isolated for further static analysis.

## Credential exposure audit

Use the credential audit against a TrustLink workspace after a suspected incident. It reports sensitive filenames and credential-shaped content patterns without printing secret values. It does not revoke credentials; rotate or revoke every reported credential from a clean device.

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-TrustLinkCredentialAudit.ps1 -WorkspacePath C:\path\to\trustlink -ReportPath .\credential-audit.json
~~~

The audit checks for environment files, private keys, wallet and credential files, GitHub tokens, cloud access-key patterns, private-key blocks, seed phrases, and generic secret assignments. It skips Git internals, dependency folders, and build output to reduce noise.

## Response modes

Enforcement is enabled by default. When a process matches the suspicious rules, the watcher logs the detection, terminates the matching process, and quarantines a referenced temporary payload when possible. In enforcement mode it also creates Windows Firewall outbound block rules for the known malicious endpoints.

Enforcement also alerts the logged-in user and attempts to disable active physical network adapters when suspicious activity is confirmed. This is deliberately disruptive containment. Use NoNetworkIsolation only when automatic adapter shutdown is not appropriate.

Run it from an Administrator PowerShell window:

~~~powershell
cd C:\Users\codepara\Desktop\trust-link\security-watch
powershell -NoProfile -ExecutionPolicy Bypass -File .\Watch-SuspiciousActivity.ps1
~~~

To keep process enforcement and firewall blocking but disable automatic adapter shutdown:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Watch-SuspiciousActivity.ps1 -NoNetworkIsolation
~~~

Use audit mode when reviewing behavior without terminating processes or quarantining files:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Watch-SuspiciousActivity.ps1 -Audit
~~~

The polling interval defaults to two seconds and can be changed:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Watch-SuspiciousActivity.ps1 -IntervalSeconds 1
~~~

Logs and quarantined files are stored under:

~~~text
%LOCALAPPDATA%\TrustLinkSecurityWatch\
~~~

Stop the watcher with Ctrl+C.

## Incident summary

The investigated package was assessed as an RCE dropper. Its malicious behavior was associated with two weaponized Git hooks:

~~~text
.git/hooks/post-checkout
.git/hooks/pre-commit
~~~

The hooks were designed to run when the assignment instructions caused a checkout or commit, then download and execute a per-operating-system second stage from a hard-coded command-and-control endpoint. The visible React/Express application and PDF functioned as decoys for the delivery mechanism.

The public investigation reports similarities to the DPRK/Lazarus Contagious Interview and TaskJacker campaigns, including a Git-hook-loader variant associated with BeaverTail and InvisibleFerret. This repository records that attribution as reported campaign context, not as an independent attribution claim.

## Key IOCs

### Network indicators

~~~text
144.172.118.214
216.126.239.166
~~~

Observed endpoint patterns included:

~~~text
/upload
/api/service/makelog
/728/728w
/728/728l
/728/728m
~~~

### Git hooks

~~~text
.git/hooks/post-checkout
.git/hooks/pre-commit
~~~

### Temporary payload indicators

~~~text
wct1ECFA.tmp
wc*.tmp
wcb34e91.tmp
wcl2ba34.tmp
~~~

Observed hashes from the local incident evidence:

~~~text
wcl2ba34.tmp
DB862C2E98B8A76D68CF12469DCD356CAB171B5C779AF15F75EFC291426428AD

wcb34e91.tmp
E59CED1528ED7E6EBBB40462B2461726D7D8C0ED112244280875A26E28EBC15D
~~~

### Observed Git metadata indicator

~~~text
wondev_mum <wondev.mum@gmail.com>
~~~

This is self-asserted Git commit metadata observed in the investigated sample. It is an unverified forensic indicator, not proof of a person's real-world identity, employer, or involvement.

## What the observed payload targeted

The observed Node payload contained indicators for scanning or collecting:

- Clipboard contents.
- Hostname, username, and local paths.
- Git repositories and Git metadata.
- SSH, cloud, browser, and wallet-related files.
- .env, JSON, key, certificate, document, image, and archive files.
- Private-key, seed-phrase, mnemonic, MetaMask, Solana, and Bitcoin-related data.

The presence of collection code does not by itself prove that every targeted file reached the remote server. Network logs showed repeated connections to the observed endpoints, so credentials and secrets available while the payload was active should be treated as exposed.

## Design principles

- Detection is behavior-based rather than dependent on one hard-coded filename.
- Enforcement is enabled by default, while audit mode is available through the Audit switch.
- Quarantine is preferred to irreversible deletion so evidence can be preserved.
- Firewall rules are added only for known indicators.
- Normal Node and Python development processes are not terminated unless their command line or path matches suspicious rules.
- Logs record timestamps, process IDs, process names, remote endpoints, reasons, and quarantine actions.
- Microsoft Defender remains the primary endpoint-security layer.
- The watcher does not claim to detect every malware family or replace antivirus software.

## Limitations and safe use

This is a focused defensive monitor, not a complete antivirus or EDR product. A two-second polling loop can miss a very short-lived process, and user-level monitoring cannot reliably stop an administrator-level process. Unknown command-and-control infrastructure may also evade the current IOC rules.

Windows does not normally ask the user to approve every outbound connection made by every application. This tool combines process behavior, command-line indicators, known endpoint blocking, Windows Firewall rules, and network isolation; it is not a complete per-application network allowlist.

Keep Microsoft Defender real-time protection enabled and run Defender Full or Offline scans after an incident. Rotate credentials from a clean device, revoke exposed tokens, inspect Git hooks before using an unfamiliar repository, and do not execute untrusted archives.

Do not run this tool against a production machine without reviewing its rules. Enforcement mode can terminate matching processes and move files into quarantine. Use audit mode first when testing on a development workstation.

## Incident-response checklist

1. Disconnect the affected machine from the network.
2. Preserve relevant logs, timestamps, hashes, and suspicious files without executing them.
3. Stop confirmed malicious processes.
4. Revoke GitHub tokens, SSH keys, API keys, wallet credentials, and active sessions from a clean device.
5. Change important passwords from a clean device.
6. Run Microsoft Defender Full and Offline scans.
7. Inspect all Git repositories for unexpected hooks under .git/hooks.
8. Reinstall the operating system when compromise cannot be confidently ruled out.

## Attribution

Built with love by Agbaka Daniel Ugonna (Big Dreams Web3).
