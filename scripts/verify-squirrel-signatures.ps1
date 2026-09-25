# Keep signature verification in PowerShell source instead of an inline shell
# block which Bash-oriented workflow scanners cannot parse correctly.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$version = $env:INSO_VERSION
if ([string]::IsNullOrWhiteSpace($version) -or $version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$') {
    throw 'INSO_VERSION must be a valid release version'
}
if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
    throw 'RUNNER_TEMP is required for isolated signature verification'
}
# Match the NuGet version conversion used by electron/windows-installer.
$nupkgVersion = $version -replace '-([a-zA-Z]+)\.', '-$1'
$package = Join-Path 'packages/insomnia/dist/squirrel-windows' "insomnia-${nupkgVersion}-full.nupkg"
if (-not (Test-Path -LiteralPath $package -PathType Leaf)) {
    throw "Missing signed package: $package"
}
$extract = Join-Path $env:RUNNER_TEMP ('squirrel-signature-' + [guid]::NewGuid().ToString('N'))
try {
    & 7z x $package "-o$extract"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to extract signed package: $LASTEXITCODE"
    }
    $exeFiles = @(Get-ChildItem -LiteralPath (Join-Path $extract 'lib/net45') -Filter '*.exe' -File)
    if ($exeFiles.Count -eq 0) {
        throw 'No executables were found in the signed package'
    }
    foreach ($exe in $exeFiles) {
        $signature = Get-AuthenticodeSignature -FilePath $exe.FullName
        Write-Host "Checking $($exe.Name): $($signature.Status)"
        if ($signature.Status -ne 'Valid') {
            throw "Invalid signature for $($exe.Name)"
        }
        Write-Host "Signer: $($signature.SignerCertificate.Subject)"
        if ($null -ne $signature.TimeStamperCertificate) {
            Write-Host "Timestamp certificate expiry: $($signature.TimeStamperCertificate.NotAfter)"
        }
    }
    Write-Host "All $($exeFiles.Count) executables have valid signatures"
} finally {
    if (Test-Path -LiteralPath $extract) {
        Remove-Item -LiteralPath $extract -Recurse -Force
    }
}
