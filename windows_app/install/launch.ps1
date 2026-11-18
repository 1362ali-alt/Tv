# PARDIK SMART IPTV - launcher (Windows 10 x64)
# Starts the local backend (pure-Python, no pip deps) and opens an Edge "app"
# window (borderless, native-looking). Falls back to the default browser.
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root "app\iptv_backend.py"))) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path; $root = Split-Path -Parent $root }
$app    = Join-Path $root "app"
$tools   = Join-Path $root "tools"
$backend = Join-Path $app "iptv_backend.py"
$port    = 8787
$url     = "http://127.0.0.1:$port/"

function Find-Python {
    foreach ($c in @("py","python","python3")) {
        $p = Get-Command $c -ErrorAction SilentlyContinue
        if ($p) {
            $v = & $p.Source -c "import sys;print(sys.version_info[0]*10+sys.version_info[1])" 2>$null
            if ($LASTEXITCODE -eq 0 -and [int]$v -ge 38) { return $p.Source }
        }
    }
    $emb = Join-Path $root "runtime\python\python.exe"
    if (Test-Path $emb) { return $emb }
    return $null
}

# --- ensure ffmpeg (only needed for RTSP / MPEG-TS / UDP sources) ---
function Ensure-FFmpeg {
    $ff = Join-Path $tools "ffmpeg.exe"
    if (Test-Path $ff) { return $ff }
    $sysff = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($sysff) { return $sysff.Source }
    # download from PyPI (imageio-ffmpeg ships a static ffmpeg build)
    try {
        $tmp = Join-Path $env:TEMP "iioff"
        New-Item -ItemType Directory -Force -Path $tmp | Out-Null
        $wheel = Join-Path $tmp "iio.whl"
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 `
          -Uri "https://files.pythonhosted.org/packages/source/i/imageio-ffmpeg/imageio_ffmpeg-0.6.0-py3-none-win_amd64.whl" `
          -OutFile $wheel
        Expand-Archive -Force -Path $wheel -DestinationPath (Join-Path $tmp "x")
        $bin = Get-ChildItem -Recurse (Join-Path $tmp "x") -Filter "ffmpeg*.exe" | Select-Object -First 1
        if ($bin) { Copy-Item $bin.FullName $ff; return $ff }
    } catch { }
    return $null
}

# --- ensure a Python runtime ---
$py = Find-Python
if (-not $py) {
    & (Join-Path $PSScriptRoot "bootstrap_runtime.ps1")
    $py = Find-Python
}
if (-not $py) {
    [System.Windows.Forms.MessageBox]::Show("Python runtime not found. Run install\Setup.bat first.","PARDIK SMART IPTV")
    exit 1
}

$ff = Ensure-FFmpeg

# --- single instance: if backend already up, just open the window ---
$up = $false
try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri ($url + "api/config")
    $up = ($r.StatusCode -eq 200)
} catch { }

if (-not $up) {
    $env:IPTV_HOST = "127.0.0.1"
    $env:IPTV_PORT = "$port"
    if ($ff) { $env:IPTV_FFMPEG = $ff }
    Start-Process -WindowStyle Hidden -FilePath $py -ArgumentList @("`"$backend`"") -WorkingDirectory $app
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 400
        try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri ($url + "api/config") | Out-Null; $up = $true; break } catch { }
    }
}

# --- open UI in an Edge app window (native look), else default browser ---
$edge = $null
foreach ($cand in @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe")) {
    if (Test-Path $cand) { $edge = $cand; break }
}
if ($edge) {
    Start-Process -FilePath $edge -ArgumentList @("--app=$url", "--new-window", "--start-maximized")
} else {
    Start-Process $url
}
exit 0
