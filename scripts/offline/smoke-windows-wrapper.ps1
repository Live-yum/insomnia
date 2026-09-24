# Validate the released Windows entrypoint WITHOUT adding debugger flags to the
# secure wrapper. Full UI/template regression runs on the identical packaged
# resources immediately before wrapper construction. Neither test disables the
# wrapper's mitigation policy, Chromium sandbox or TLS verification.
$ErrorActionPreference = 'Stop'
$binary = (Resolve-Path 'packages/insomnia/dist/win-unpacked/Insomnia.exe').Path
$version = (Get-Content 'packages/insomnia/package.json' -Raw | ConvertFrom-Json).version
$childName = "insomnia-$version"
$profile = Join-Path ([IO.Path]::GetTempPath()) ("insomnia-offline-wrapper-" + [guid]::NewGuid())
$results = Join-Path (Get-Location) 'offline-test-results'
New-Item -ItemType Directory -Path $profile, $results -Force | Out-Null
$env:INSOMNIA_OFFLINE_DATA_PATH = $profile
Remove-Item Env:INSOMNIA_DATA_PATH -ErrorAction SilentlyContinue
Remove-Item Env:INSOMNIA_SESSION -ErrorAction SilentlyContinue
Remove-Item Env:INSOMNIA_OFFLINE_BROWSER_ORIGINS -ErrorAction SilentlyContinue
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
    # A responsive empty window alone is insufficient: require the app's local
    # database to have been initialized in this fresh, isolated test profile.
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
    $report = @{ wrappedEntrypoint = $binary; childName = $child.ProcessName; title = $child.MainWindowTitle; databaseFiles = $dataFiles.Count; debuggerArguments = $false; sandboxDisabled = $false; status = 'passed' }
    $report | ConvertTo-Json | Tee-Object -FilePath (Join-Path $results 'windows-wrapper.json')
} catch {
    $_ | Out-String | Set-Content (Join-Path $results 'windows-wrapper-error.txt')
    throw
} finally {
    if ($child) { try { $null = $child.CloseMainWindow() } catch {} }
    if ($wrapper) {
        if (!$wrapper.WaitForExit(10000)) {
            # Restrict cleanup to this test's wrapper process tree.
            & taskkill /PID $wrapper.Id /T /F 2>$null | Out-Null
        }
    }
    Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
}
