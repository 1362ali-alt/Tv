# PARDIK IPTV - launcher (Windows 10 x64), Ronika Palace residential flavour
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

# --- deployment flavour -----------------------------------------------------
# Pardik ships the same client for two installations: the residential complex
# (default, "residential") and the hotel/hospitality platform ("hotel"). The
# flavour lives in mode.txt next to this launcher so an installer can change it
# without touching the code; the backend reads it as IPTV_MODE.
$mode = "residential"
$modeFile = Join-Path $root "mode.txt"
if (Test-Path $modeFile) {
    $m = (Get-Content -Raw -Path $modeFile).Trim().ToLower()
    if ($m -in @("residential","hotel")) { $mode = $m }
}
$env:IPTV_MODE = $mode

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
    # No ffmpeg yet. imageio-ffmpeg ships a static Windows build inside its
    # wheel, so fetch it from PyPI. Two bugs made this always fail before:
    #   * "files.pythonhosted.org/packages/source/<i>/<pkg>/<file>.whl" is the
    #     legacy *sdist* layout - wheels live under /packages/<xx>/<hash>/<file>,
    #     so the hard-coded URL 404'd. Ask the PyPI JSON API for the current
    #     win_amd64 wheel instead and keep a pinned URL as a fallback.
    #   * Windows PowerShell's Expand-Archive refuses any extension but .zip, so
    #     the download has to be saved as .zip (not .whl).
    $pinned = "https://files.pythonhosted.org/packages/82/0c/a1d49f3dd268bbbd750b4986f8e271ad11f8e729a896070ea25f587b44da8/imageio_ffmpeg-0.8.1-py3-none-win_amd64.whl"
    $urls = @()
    try {
        $json = Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop `
                  -Uri "https://pypi.org/pypi/imageio-ffmpeg/json" | Select-Object -ExpandProperty Content
        $u = ($json | ConvertFrom-Json).urls | Where-Object { $_.filename -like "*win_amd64.whl" } | Select-Object -First 1
        if ($u -and $u.url) { $urls += $u.url }
    } catch { }
    $urls += $pinned
    foreach ($u in $urls) {
        try {
            $tmp = Join-Path $env:TEMP "iioff"
            New-Item -ItemType Directory -Force -Path $tmp | Out-Null
            $zip = Join-Path $tmp "imageio_ffmpeg.zip"
            $x   = Join-Path $tmp "x"
            Invoke-WebRequest -UseBasicParsing -TimeoutSec 600 -ErrorAction Stop -Uri $u -OutFile $zip
            if (Test-Path $x) { Remove-Item -Recurse -Force $x }
            Expand-Archive -Force -Path $zip -DestinationPath $x
            $bin = Get-ChildItem -Recurse $x -Filter "ffmpeg*.exe" | Select-Object -First 1
            if ($bin) {
                New-Item -ItemType Directory -Force -Path $tools | Out-Null
                Copy-Item -Force $bin.FullName $ff
                Remove-Item $zip -ErrorAction SilentlyContinue
                if (Test-Path $ff) { return $ff }
            }
        } catch { }
    }
    return $null
}

# --- ensure a Python runtime ---
$py = Find-Python
if (-not $py) {
    & (Join-Path $PSScriptRoot "bootstrap_runtime.ps1")
    $py = Find-Python
}
if (-not $py) {
    [System.Windows.Forms.MessageBox]::Show("Python runtime not found. Run install\Setup.bat first.","PARDIK IPTV")
    exit 1
}

$ff = Ensure-FFmpeg

# --- single instance, but NEVER a stale one ---------------------------------
# An older install that is still running (auto-started at logon by the boot
# receiver, or left over from the previous session) keeps port 8787 and serves
# the NEW web files from disk while answering /api/connection with a 404 - the
# boot screen then freezes at "attempt 0 of 20" forever. So probe the ENGINE
# endpoint instead of the port: only a backend that answers /api/connection
# (the BaseApplication/PingServerActivity state) is allowed to stay alive.
function Stop-StaleBackend {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*iptv_backend.py*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    try {
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    } catch { }
}
function Test-BackendEngine {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri ($url + "api/connection")
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}
$up = Test-BackendEngine
if (-not $up) {
    Stop-StaleBackend
    Start-Sleep -Milliseconds 800
    $env:IPTV_HOST = "127.0.0.1"
    $env:IPTV_PORT = "$port"
    if ($ff) { $env:IPTV_FFMPEG = $ff }
    Start-Process -WindowStyle Hidden -FilePath $py -ArgumentList @("`"$backend`"") -WorkingDirectory $app
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 400
        if (Test-BackendEngine) { $up = $true; break }
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
    # --autoplay-policy: the boot advert video (GetAdvVideoEM) and the welcome
    # background music start with no user gesture, exactly like the Android box.
    Start-Process -FilePath $edge -ArgumentList @("--app=$url", "--new-window", "--start-maximized", "--autoplay-policy=no-user-gesture-required")
} else {
    Start-Process $url
}
exit 0
