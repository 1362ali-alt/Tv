# Downloads an official embeddable CPython (Windows x64) into ..\runtime\python
# so the app runs with ZERO preinstalled dependencies. The backend is pure
# stdlib, so the embeddable distribution (python.exe + python3x.zip) is enough.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root "runtime\python"
if (Test-Path (Join-Path $dest "python.exe")) { Write-Host "Python already present."; exit 0 }

$versions = @("3.12.7", "3.11.9", "3.10.11")
$zip = Join-Path $env:TEMP "pyembed.zip"
$ok = $false
foreach ($v in $versions) {
    $u = "https://www.python.org/ftp/python/$v/python-$v-embed-amd64.zip"
    Write-Host "Downloading $u ..."
    try {
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 300 -Uri $u -OutFile $zip
        $ok = $true; break
    } catch { Write-Host "  failed: $_" }
}
if (-not $ok) {
    # fallback: astral python-build-standalone via GitHub
    $u = "https://github.com/astral-sh/python-build-standalone/releases/latest/download/cpython-3.12.7-x86_64-pc-windows-msvc-install_only_stripped.tar.gz"
    Write-Host "Fallback: $u"
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 600 -Uri $u -OutFile (Join-Path $env:TEMP "py.tar.gz")
    tar -xzf (Join-Path $env:TEMP "py.tar.gz") -C $env:TEMP
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    Move-Item (Join-Path $env:TEMP "python") $dest
    Write-Host "Python installed (standalone)."; exit 0
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -Force -Path $zip -DestinationPath $dest
Remove-Item $zip -ErrorAction SilentlyContinue
Write-Host "Python embeddable installed at $dest"
exit 0
