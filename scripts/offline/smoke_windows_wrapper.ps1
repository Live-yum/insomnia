# Exercise the actual Windows secure wrapper normally. No debugger argument is
# forwarded and no mitigation policy is removed. The immediately preceding UI
# test must have used the same Electron image, application ASAR and plugin tree.
$ErrorActionPreference = 'Stop'
$binary = (Resolve-Path 'packages/insomnia/dist/win-unpacked/Insomnia.exe').Path
$directory = Split-Path $binary
$version = (Get-Content 'packages/insomnia/package.json' -Raw | ConvertFrom-Json).version
$source = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $source -notmatch '^[0-9a-f]{40}$') { throw 'No exact source revision' }
$ui = Get-Content 'offline-smoke-report.json' -Raw | ConvertFrom-Json
if (!$ui.passed -or !$ui.chromiumSandboxEnabled -or $ui.sourceCommit -ne $source) { throw 'Full UI smoke with sandbox must pass first' }
$dll = Join-Path $directory 'insomnia.dll'
$electronHash = (Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash.ToLowerInvariant()
if ($electronHash -ne $ui.electronImageSha256) { throw 'The wrapped Electron image differs from the UI-tested image' }
$childName = "insomnia-$version"
$profile = Join-Path ([IO.Path]::GetTempPath()) ("insomnia-offline-wrapper-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $profile -Force | Out-Null
$env:INSOMNIA_OFFLINE_DATA_PATH = $profile
foreach ($key in @('INSOMNIA_DATA_PATH', 'INSOMNIA_SESSION', 'INSOMNIA_SKIP_ONBOARDING', 'PLAYWRIGHT_TEST', 'INSOMNIA_OFFLINE_BROWSER_ORIGINS', 'INSOMNIA_OFFLINE_PLUGIN_DIR', 'ELECTRON_RUN_AS_NODE', 'GH_TOKEN', 'GITHUB_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_TOKEN')) {
    Remove-Item "Env:$key" -ErrorAction SilentlyContinue
}
$wrapper = $null
$child = $null
$ruleGroup = 'InsomniaOfflineSmoke-' + [guid]::NewGuid()
$report = [ordered]@{ sourceCommit = $source; target = 'win32-x64'; passed = $false; electronImageSha256 = $electronHash; scope = 'Final secure wrapper normal launch, responsive native window and fresh local database; application executable outbound rules. Full UI/plugin checks run before wrapping on identical Electron bytes.' }
try {
    # Apply program-scoped rules only on this disposable test runner. Never
    # change the machine's global firewall policy or unrelated application rules.
    foreach ($file in @($binary, $dll, (Join-Path $directory "$childName.exe"))) {
        New-NetFirewallRule -DisplayName ($ruleGroup + '-' + [IO.Path]::GetFileName($file)) -Group $ruleGroup -Direction Outbound -Program $file -Action Block -Profile Any -Enabled True | Out-Null
    }
    $report.applicationOutboundBlocked = $true
    $wrapper = Start-Process -FilePath $binary -WorkingDirectory $directory -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    while ([DateTime]::UtcNow -lt $deadline) {
        $wrapper.Refresh()
        if ($wrapper.HasExited) { throw "Secure wrapper exited before a window appeared: $($wrapper.ExitCode)" }
        foreach ($candidate in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($wrapper.Id)")) {
            if ($candidate.Name -eq "$childName.exe") {
                if ($candidate.CommandLine -match '--(no-sandbox|inspect|remote-debugging)') { throw 'Wrapped app contains forbidden test/debug flags' }
                $child = Get-Process -Id $candidate.ProcessId -ErrorAction Stop
                $child.Refresh()
                if ($child.MainWindowHandle -ne 0 -and $child.Responding -and $child.MainWindowTitle -match 'Insomnia') { break }
            }
        }
        if ($child -and $child.MainWindowHandle -ne 0 -and $child.Responding) { break }
        Start-Sleep -Milliseconds 500
    }
    if (!$child -or $child.MainWindowHandle -eq 0 -or !$child.Responding -or $child.MainWindowTitle -notmatch 'Insomnia') { throw 'Secure wrapper did not open a responsive application window' }
    $databaseDeadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        $dataFiles = @(Get-ChildItem -LiteralPath $profile -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^insomnia\..*\.db$' })
        if ($dataFiles.Count -gt 0) { break }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $databaseDeadline)
    if ($dataFiles.Count -eq 0) { throw 'Wrapped app did not initialize its offline database' }
    Start-Sleep -Seconds 3
    $child.Refresh()
    if ($child.HasExited -or !$child.Responding) { throw 'Wrapped app did not remain responsive' }
    if ((Get-FileHash -LiteralPath (Join-Path $directory "$childName.exe") -Algorithm SHA256).Hash.ToLowerInvariant() -ne $electronHash) { throw 'Launched child differs from the UI-tested Electron image' }
    $report.childName = $child.ProcessName
    $report.title = $child.MainWindowTitle
    $report.databaseFiles = $dataFiles.Count
    $report.debuggerArguments = $false
    $report.sandboxDisabledArgument = $false
    $report.passed = $true
} catch {
    $report.error = $_ | Out-String
    throw
} finally {
    $report | ConvertTo-Json -Depth 6 | Tee-Object -FilePath 'offline-wrapper-report.json'
    if ($child) { try { $null = $child.CloseMainWindow() } catch {} }
    if ($wrapper) {
        if (!$wrapper.WaitForExit(15000)) {
            & taskkill /PID $wrapper.Id /T /F 2>$null | Out-Null
        }
    }
    Get-NetFirewallRule -Group $ruleGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
}
