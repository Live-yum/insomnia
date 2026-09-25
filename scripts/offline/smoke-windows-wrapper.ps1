# The actual secure wrapper is tested without debugger or sandbox-disabling arguments.
param(
    [string]$Executable = 'packages/insomnia/dist/win-unpacked/Insomnia.exe',
    [string]$ReportFile = 'offline-test-results/windows-wrapper.json',
    [switch]$RequireFreshPayload
)
$ErrorActionPreference = 'Stop'
$binary = (Resolve-Path -LiteralPath $Executable).Path
$version = (Get-Content 'packages/insomnia/package.json' -Raw | ConvertFrom-Json).version
$childName = "insomnia-$version"
$payload = Join-Path (Split-Path $binary) 'insomnia.dll'
$childFile = Join-Path (Split-Path $binary) "$childName.exe"
if ($RequireFreshPayload -and (Test-Path -LiteralPath $childFile)) { throw 'Fresh wrapper acceptance requires no pre-created child executable' }
$expectedPayloadHash = (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash
$profile = Join-Path ([IO.Path]::GetTempPath()) ("insomnia-offline-wrapper-" + [guid]::NewGuid())
$reportPath = [IO.Path]::GetFullPath($ReportFile)
New-Item -ItemType Directory -Path $profile, (Split-Path $reportPath) -Force | Out-Null
$env:INSOMNIA_OFFLINE_DATA_PATH = $profile
foreach ($name in @('INSOMNIA_DATA_PATH','INSOMNIA_SESSION','INSOMNIA_OFFLINE_BROWSER_ORIGINS','GH_TOKEN','GITHUB_TOKEN','NODE_AUTH_TOKEN','NPM_TOKEN','ELECTRON_RUN_AS_NODE')) {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
}
$wrapper = $null
$child = $null
try {
    $wrapper = Start-Process -FilePath $binary -WorkingDirectory (Split-Path $binary) -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $deadline) {
        $wrapper.Refresh()
        if ($wrapper.HasExited) { throw "Secure wrapper exited before a window appeared: $($wrapper.ExitCode)" }
        $candidates = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($wrapper.Id)")
        foreach ($candidate in $candidates) {
            if ($candidate.Name -eq "$childName.exe") {
                $child = Get-Process -Id $candidate.ProcessId -ErrorAction Stop
                $child.Refresh()
                if ($child.MainWindowHandle -ne 0 -and $child.Responding -and $child.MainWindowTitle -match 'Insomnia') { break }
            }
        }
        if ($child -and $child.MainWindowHandle -ne 0 -and $child.Responding) { break }
        Start-Sleep -Milliseconds 500
    }
    if (!$child -or $child.MainWindowHandle -eq 0 -or !$child.Responding) { throw 'Secure wrapper did not open a responsive application window' }
    if ((Get-FileHash -LiteralPath $childFile -Algorithm SHA256).Hash -ne $expectedPayloadHash) { throw 'Spawned runtime bytes differ from the preserved payload' }
    $databaseDeadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        $dataFiles = @(Get-ChildItem -LiteralPath $profile -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^insomnia\..*\.db$' })
        if ($dataFiles.Count -gt 0) { break }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $databaseDeadline)
    if ($dataFiles.Count -eq 0) { throw 'Wrapped app did not initialize its offline database' }
    Start-Sleep -Seconds 3
    $child.Refresh()
    if ($child.HasExited -or !$child.Responding) { throw 'Wrapped app did not remain responsive' }
    $report = @{
        wrappedEntrypoint=$binary; childName=$child.ProcessName; title=$child.MainWindowTitle;
        databaseFiles=$dataFiles.Count; debuggerArguments=$false; sandboxDisabled=$false;
        freshPayloadRequired=[bool]$RequireFreshPayload; runtimePayloadHashVerified=$true; status='passed'
    }
    $report | ConvertTo-Json | Tee-Object -FilePath $reportPath
} catch {
    $_ | Out-String | Set-Content ($reportPath + '.error.txt')
    throw
} finally {
    if ($child) { try { $null = $child.CloseMainWindow() } catch {} }
    if ($wrapper -and !$wrapper.WaitForExit(10000)) {
        # Restrict cleanup to this test's process tree.
        & taskkill /PID $wrapper.Id /T /F 2>$null | Out-Null
    }
    Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
}
