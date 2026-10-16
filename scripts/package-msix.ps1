[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9.-]{3,50}$')][string]$IdentityName,
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Publisher,
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$DisplayName,
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$PublisherDisplayName,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9]+$')][string]$ProductId,
    [ValidatePattern('^\d+\.\d+\.\d+\.0$')][string]$Version,
    [ValidateSet('x64','arm64')][string]$Architecture = 'x64',
    [Parameter(Mandatory)][ValidateSet('Evergreen')][string]$WebView2,
    [string]$TargetDirectory,
    [string]$OutputDirectory = 'artifacts\msix',
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
function Invoke-Checked([scriptblock]$Action) {
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Action
        if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" }
    } finally { $ErrorActionPreference = $previousPreference }
}
$config = Get-Content src-tauri\tauri.conf.json -Raw | ConvertFrom-Json
if (!$Version) { $Version = "$($config.version).0" }
$parts = $Version.Split('.')
if (($parts | Where-Object { [int]$_ -gt 65535 }).Count -gt 0 -or [int]$parts[0] -eq 0) {
    throw 'MSIX requires a positive major version and four components <= 65535; Store revision must be zero. Pass -Version explicitly (for example 1.0.5.0).'
}
if (!$TargetDirectory) { $TargetDirectory = Join-Path $root 'src-tauri\target' }
if (![IO.Path]::IsPathRooted($TargetDirectory)) { $TargetDirectory = Join-Path $root $TargetDirectory }
if (![IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory = Join-Path $root $OutputDirectory }
$TargetDirectory = [IO.Path]::GetFullPath($TargetDirectory)
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (!(Test-Path $OutputDirectory)) { New-Item -ItemType Directory $OutputDirectory | Out-Null }
$stage = Join-Path $OutputDirectory ('stage-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $stage | Out-Null
try {
    $triple = if ($Architecture -eq 'x64') { 'x86_64-pc-windows-msvc' } else { 'aarch64-pc-windows-msvc' }
    $release = Join-Path $TargetDirectory "$triple\release"
    if (!$SkipBuild) {
        $previousTarget = $env:CARGO_TARGET_DIR
        try {
            $env:CARGO_TARGET_DIR = $TargetDirectory
            Invoke-Checked { npm run build }
            Invoke-Checked { cargo build --manifest-path src-tauri\Cargo.toml --release --features tauri/custom-protocol --bin nowly --target $triple --locked }
        } finally { $env:CARGO_TARGET_DIR = $previousTarget }
    }
    $exe = Join-Path $release 'nowly.exe'
    if (!(Test-Path $exe)) { throw "Missing release binary: $exe" }
    Copy-Item $exe (Join-Path $stage 'nowly.exe')
    Invoke-Checked { rustc scripts\msix\startup.rs --target $triple -C opt-level=s -C debuginfo=0 -o (Join-Path $stage 'nowly-startup.exe') }
    Remove-Item (Join-Path $stage 'nowly-startup.pdb') -ErrorAction SilentlyContinue
    New-Item -ItemType Directory (Join-Path $stage 'Assets') | Out-Null
    foreach ($icon in @('StoreLogo.png','Square150x150Logo.png','Square44x44Logo.png')) {
        Copy-Item (Join-Path $root "src-tauri\icons\$icon") (Join-Path $stage "Assets\$icon")
    }
    if ($WebView2 -eq 'Fixed') {
        if (!$FixedRuntimePath -or !(Test-Path (Join-Path $FixedRuntimePath 'msedgewebview2.exe'))) { throw 'Fixed requires an extracted Microsoft WebView2 Fixed Version runtime matching the package architecture.' }
        Copy-Item $FixedRuntimePath (Join-Path $stage 'WebView2') -Recurse
        throw 'Fixed runtime packaging is not supported by this build. Select Evergreen; do not ship a runtime that Tauri will not load.'
    }
    @{ productId = $ProductId; webView2 = $WebView2 } | ConvertTo-Json | ForEach-Object { [IO.File]::WriteAllText((Join-Path $stage 'nowly-store.json'), $_, [Text.UTF8Encoding]::new($false)) }
    $manifest = Get-Content scripts\msix\AppxManifest.xml -Raw
    $tokens = @{ IDENTITY=$IdentityName; PUBLISHER=$Publisher; DISPLAY=$DisplayName; PUBLISHER_DISPLAY=$PublisherDisplayName; VERSION=$Version; ARCH=$Architecture }
    foreach ($key in $tokens.Keys) { $manifest = $manifest.Replace("__$key`__", [Security.SecurityElement]::Escape($tokens[$key])) }
    [IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'), $manifest, [Text.UTF8Encoding]::new($false))
    $sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" | Sort-Object FullName -Descending | Select-Object -First 1
    if (!$sdk) { throw 'Install Windows SDK with MakeAppx.' }
    $package = Join-Path $OutputDirectory "Nowly-$Version-$Architecture.msix"
    Invoke-Checked { & $sdk.FullName pack /d $stage /p $package /o }
    Get-FileHash $package -Algorithm SHA256
    Write-Output "Unsigned package: $package"
} finally { Remove-Item $stage -Recurse -Force }
