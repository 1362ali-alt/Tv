# PARDIK IPTV - launcher (Windows 10 x64), Ronika Palace residential flavour
# Starts the local backend (pure-Python, no pip deps) and opens an Edge "app"
# window (borderless, native-looking). Falls back to the default browser.
$ErrorActionPreference = "SilentlyContinue"
# MessageBox below must not fail silently: without the assembly loaded the
# "runtime missing" popup never appeared and the launcher died invisibly.
try { Add-Type -AssemblyName System.Windows.Forms } catch { }
# Windows PowerShell 5.1 still defaults to SSL3/TLS1.0, and PyPI/GitHub reject
# those handshakes - this single line is why the FFmpeg auto-download used to
# fail silently on older Windows 10 builds.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root "app\iptv_backend.py"))) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path; $root = Split-Path -Parent $root }
$app    = Join-Path $root "app"
$tools   = Join-Path $root "tools"
$backend = Join-Path $app "iptv_backend.py"
$port    = 8787
$url     = "http://127.0.0.1:$port/"
# Every launch leaves a trace - a hidden launcher that fails looks exactly
# like "the new version did nothing", which is what the field kept reporting.
$logfile = Join-Path $root "launch.log"
function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    try { Add-Content -Path $logfile -Value $line -Encoding UTF8 } catch { }
}
function Fail($msg) {
    Log "FATAL: $msg"
    try {
        [System.Windows.Forms.MessageBox]::Show(
            "$msg`n`nDetails: $logfile", "PARDIK IPTV - launch failed") | Out-Null
    } catch { }
    exit 2
}
Log "launch start (root=$root)"

# --- multicast firewall rules: once per folder, with a single UAC yes/no ---
# Field proof 2026-11-23: the bundled VLC PLAYED the live channel while our
# own python/ffmpeg saw 0 multicast bytes - Windows inbound firewall allows
# per executable, VLC got its allowance (prompt) and our exes never did.
# So the launcher now registers the rules ITSELF on first run in a folder:
# one UAC prompt, marker file, done. Decline it and the VLC fallback still
# carries playback, exactly as the field photo showed.
$fwMarker = Join-Path $PSScriptRoot "fw_rules.ok"
if (-not (Test-Path $fwMarker)) {
    Log "first run in this folder: asking administrator ONCE to register multicast firewall rules (without them python/ffmpeg receive 0 bytes; VLC only plays because Windows prompted for it)"
    try {
        Start-Process -FilePath (Join-Path $PSScriptRoot "allow_multicast.bat") -ArgumentList "auto" -Verb RunAs -Wait
    } catch {
        Log "UAC declined or unavailable: in-app multicast may stay blind - the VLC fallback still works, or run install\allow_multicast.bat as admin"
    }
    if (Test-Path $fwMarker) { Log "multicast firewall rules registered for this folder" }
    else { Log "WARNING: fw_rules.ok missing - rules NOT registered; run install\allow_multicast.bat with Run as administrator" }
}

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

# --- deployment-baked head-end address --------------------------------------
# tools/extract_headend.py pulled this out of the vendor APK (IptvConfig.
# DEFAULT_SERVER_IP / DEFAULT_SERVER_PORT = the building head-end). It ships
# as headend.txt (line 1 = ip, line 2 = port) next to mode.txt so an installer
# can re-bake it per building without touching code; the backend applies it as
# a seed and a resident's own Settings edit always wins afterwards.
$headFile = Join-Path $root "headend.txt"
if (Test-Path $headFile) {
    $hl = @(Get-Content -Path $headFile | Where-Object { $_.Trim() -ne "" })
    if ($hl.Count -ge 1) { $env:IPTV_SERVER_IP = $hl[0].Trim() }
    if ($hl.Count -ge 2) { $env:IPTV_SERVER_PORT = $hl[1].Trim() }
}

function Find-Python {
    # A portable folder ships its own runtime and must NEVER pick up some
    # system python of unknown age/state - bundled first, always.
    $bundled = Join-Path $root "runtime\python\python.exe"
    if (Test-Path $bundled) { return $bundled }
    foreach ($c in @("py","python","python3")) {
        $p = Get-Command $c -ErrorAction SilentlyContinue
        if ($p) {
            $v = & $p.Source -c "import sys;print(sys.version_info[0]*10+sys.version_info[1])" 2>$null
            if ($LASTEXITCODE -eq 0 -and [int]$v -ge 38) { return $p.Source }
        }
    }
    return $null
}

function Download-File($url, $out) {
    # curl.exe ships with Windows 10 1803+ and handles modern TLS reliably;
    # Invoke-WebRequest stays as the fallback.
    $curl = Join-Path $env:SystemRoot "System32\curl.exe"
    if (Test-Path $curl) {
        & $curl -sSL --tlsv1.2 --retry 2 -o $out $url
        if ($LASTEXITCODE -eq 0 -and (Test-Path $out)) { return $true }
    }
    try {
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 600 -ErrorAction Stop -Uri $url -OutFile $out
        return $true
    } catch { return $false }
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
            if (-not (Download-File $u $zip)) { continue }
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
    Fail "Python runtime not found. Extract the full zip again (or run install\Setup.bat for the installed edition)."
}
Log "python: $py"

$ff = Ensure-FFmpeg
Log $(if ($ff) { "ffmpeg: $ff" } else { "ffmpeg: NOT AVAILABLE (RTSP/UDP playback will not work)" })
# downloaded zips carry Mark-of-the-Web; Defender then deep-scans every first
# exec of python.exe/ffmpeg.exe/vlc.exe and the very first launch crawls.
# Unblock-File on the three executables is instant and removes the penalty.
foreach ($f in @((Join-Path $root "runtime\python\python.exe"), $ff, (Join-Path $root "tools\vlc\vlc.exe"))) {
    if ($f -and (Test-Path $f)) { try { Unblock-File -LiteralPath $f -ErrorAction SilentlyContinue } catch { } }
}

# --- single instance, but NEVER a stale one ---------------------------------
# An older install that is still running (auto-started at logon by the boot
# receiver, or left over from the previous session) keeps port 8787 and serves
# the NEW web files from disk while answering /api/connection with a 404 - the
# boot screen then freezes at "attempt 0 of 20" forever. So probe the ENGINE
# endpoint instead of the port: only a backend that answers /api/connection
# (the BaseApplication/PingServerActivity state) is allowed to stay alive.
function Stop-StaleBackend {
    # filtered query: the full Win32_Process table took ~15 s on the field
    # machine's slow WMI and made the launcher look hung before it started
    Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*iptv_backend.py*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 600
    try {
        # NEVER kill an innocent process that happens to hold the port: only a
        # python running iptv_backend.py is ours.
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            ForEach-Object {
                $op = Get-CimInstance Win32_Process -Filter "ProcessId=$_" -ErrorAction SilentlyContinue
                # CommandLine match ONLY: "any python holding 8787" would
                # execute an innocent script that merely chose our port.
                if ($op -and $op.CommandLine -like "*iptv_backend*") {
                    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
                    Log "killed stale backend PID $_ ($($op.Name))"
                } else {
                    Log "port $port owner PID $_ ($($op.Name)) is NOT ours - left running"
                }
            }
    } catch { }
}
function Dump-PortDiagnostics {
    # One photo of the console must carry the whole truth: who owns the
    # port, what that process actually is, and the backend's last words.
    Log "---- port $port diagnostics ----"
    try {
        & "$env:SystemRoot\System32\netstat.exe" -ano | Select-String ":$port" |
            ForEach-Object { Log ("netstat: " + $_.Line.Trim()) }
    } catch { }
    try {
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
                $gp = Get-Process -Id $_ -ErrorAction SilentlyContinue
                Log ("owner PID $_ name=" + $(if ($gp) { $gp.Name } else { "?" }) + " path=" + $(if ($gp) { $gp.Path } else { "?" }))
                $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$_" -ErrorAction SilentlyContinue
                Log ("owner PID $_ cmdline=" + $(if ($cim) { $cim.CommandLine } else { "? (WMI unreadable)" }))
            }
    } catch { }
    $bl = Join-Path $root "_userdata\backend.log"
    if (Test-Path $bl) {
        Log "---- last lines of _userdata\backend.log ----"
        Get-Content -Path $bl -Tail 12 | ForEach-Object { Log ("backend: " + $_) }
    } else {
        Log "backend.log does not exist yet - the backend died before writing anything"
    }
    Log "---- end diagnostics ----"
}
function Invoke-LocalApi($path) {
    # Bypass ANY system/PAC proxy on purpose: Invoke-WebRequest honours the
    # Windows proxy (Psiphon/Nova live on the field machines) and a localhost
    # probe detoured through a VPN reads exactly like "no backend at all"
    # (external review of b53d3bb). HttpWebRequest with Proxy=$null cannot
    # be hijacked, on every PowerShell version.
    try {
        $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$port$path")
        $req.Proxy = $null
        $req.Timeout = 2500
        $resp = $req.GetResponse()
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $body = $sr.ReadToEnd(); $sr.Close(); $resp.Close()
        return $body
    } catch { return $null }
}
function Test-BackendEngine {
    return ((Invoke-LocalApi "/api/connection") -ne $null)
}
function Get-BackendBuild {
    # /api/build is three keys and zero machine state - it answers even when
    # a broken section makes /api/config 500 (field photo 2026-11-21 21:10:
    # config died, launcher read build '', killed its OWN healthy backend).
    foreach ($p in @("/api/build", "/api/config")) {
        $body = Invoke-LocalApi $p
        if ($body) {
            try {
                $j = $body | ConvertFrom-Json
                if ($j -and $j.build) { return [string]$j.build }
            } catch { }
        }
    }
    return ""
}
function Get-BackendRoot {
    # /api/fw_state (build 807287d+) names the folder of the backend that
    # actually owns the port - the only witness that survives a self-updated
    # copy serving the VERY SAME stamp from somewhere else.
    $body = Invoke-LocalApi "/api/fw_state"
    if ($body) {
        try {
            $j = $body | ConvertFrom-Json
            if ($j -and $j.root) { return [string]$j.root }
        } catch { }
    }
    return ""
}
# A backend that answers /api/connection but runs OLD code (left over from a
# half-failed install) would keep serving stale APIs forever - /api/config
# carries the zip's build stamp, so a mismatch means "restart the backend".
$wantBuild = ""
$biFile = Join-Path $root "build_info.json"
if (Test-Path $biFile) {
    try { $wantBuild = [string]((Get-Content -Raw $biFile | ConvertFrom-Json).commit) } catch { }
}
function Start-OurBackend {
    # a retry must never leave TWO pythons fighting over the port (external
    # review: the old code started a second child while the first was still
    # importing, and both then lost the bind race)
    if ($script:backendProc -and -not $script:backendProc.HasExited) {
        Log "our previous backend PID $($script:backendProc.Id) is still alive - stopping it before retry"
        Stop-Process -Id $script:backendProc.Id -Force -ErrorAction SilentlyContinue
        $script:backendProc.WaitForExit(5000)
    }
    for ($w = 0; $w -lt 12; $w++) {
        $own = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if (-not $own) { break }
        Start-Sleep -Milliseconds 500
    }
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        Log "port $port is STILL listening after cleanup - the new backend will report why in backend.log"
    }
    $env:IPTV_HOST = "127.0.0.1"
    $env:IPTV_PORT = "$port"
    if ($ff) { $env:IPTV_FFMPEG = $ff }
    Log "starting backend: $py $backend"
    $script:backendProc = Start-Process -WindowStyle Hidden -FilePath $py -ArgumentList @("`"$backend`"") -WorkingDirectory $app -PassThru
    for ($i = 0; $i -lt 100; $i++) {
        Start-Sleep -Milliseconds 400
        if ($i -eq 40) { Log "still waiting for the backend to answer (a first-run antivirus scan of python.exe can take a while)..." }
        if (Test-BackendEngine) { return $true }
    }
    return $false
}
$up = Test-BackendEngine
if ($up -and $wantBuild -and ((Get-BackendBuild) -ne $wantBuild)) {
    Log "stale backend answers (build '$(Get-BackendBuild)' != '$wantBuild') - replacing"
    Stop-StaleBackend
    Start-Sleep -Milliseconds 800
    $up = Test-BackendEngine
}
if (-not $up) {
    Stop-StaleBackend
    Start-Sleep -Milliseconds 800
    $up = Start-OurBackend
}
# The check that was missing in every failed field round: what answers on
# 8787 must be THIS build. Opening the UI against a stale backend shows the
# resident "the same old messages" and hides every fix that was shipped.
if ($wantBuild) {
    $got = Get-BackendBuild
    if ($got -ne $wantBuild) {
        Log "build mismatch after start (got '$got', want '$wantBuild') - hard kill and retry"
        Stop-StaleBackend
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            ForEach-Object {
                $op = Get-CimInstance Win32_Process -Filter "ProcessId=$_" -ErrorAction SilentlyContinue
                if ($op -and $op.CommandLine -like "*iptv_backend*") {
                    & taskkill /F /PID $_ 2>$null | Out-Null
                } else {
                    Log "hard-kill: port owner PID $_ ($($op.Name)) is NOT ours - left running"
                }
            }
        Start-Sleep -Milliseconds 800
        $up = Start-OurBackend
        $got = Get-BackendBuild
    }
    if (-not (Test-BackendEngine)) {
        # nothing answers at all: our backend crashed or is stuck BEFORE
        # binding - the port is NOT "held by another program" and saying so
        # sent the resident on a wild-goose chase (field photo 2026-11-21).
        Dump-PortDiagnostics
        Fail "The backend process did not answer on port $port at all. The console above now shows who owns the port and the last lines of _userdata\backend.log - send a photo of this whole window."
    }
    if ($got -ne $wantBuild) {
        # engine alive but wrong/empty stamp: NEVER blame "another program"
        # again - the 21:10 photo showed OUR OWN healthy backend here, killed
        # by this very script because /api/config had died on one section.
        Dump-PortDiagnostics
        Fail "A backend is running on port $port but reports build '$got' instead of '$wantBuild'. The diagnostics above name the process and quote _userdata\backend.log - send a photo of this whole window."
    }
    Log "backend verified: build $got on port $port"
    # 23:08 field capture: a copy in ANOTHER folder (the in-app updater's
    # AppData swap area, or an old portable folder whose backend never died)
    # can hold 8787 with the VERY SAME stamp - stamp equality then reads as
    # "verified" while the folder the resident double-clicked serves nothing
    # and its launch-time UAC/marker logic never runs. If the serving root
    # is not ours, retire it and take the port over.
    $servRoot = Get-BackendRoot
    $myRoot = $root
    try { $myRoot = (Resolve-Path $root).Path } catch { }
    if ($servRoot -and $myRoot -and
        ($servRoot.TrimEnd("\") -ne $myRoot.TrimEnd("\"))) {
        Log "port $port is served from ANOTHER folder: $servRoot (this launcher: $myRoot) - retiring it so the folder you opened is the one serving"
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            ForEach-Object {
                $op = Get-CimInstance Win32_Process -Filter "ProcessId=$_" -ErrorAction SilentlyContinue
                if ($op -and $op.CommandLine -like "*iptv_backend*") {
                    & taskkill /F /PID $_ 2>$null | Out-Null
                } else {
                    Log "root takeover: port owner PID $_ ($($op.Name)) is not an iptv backend - left running"
                }
            }
        Start-Sleep -Milliseconds 1200
        $up2 = Start-OurBackend
        $got2 = Get-BackendBuild
        if (-not $up2 -or $got2 -ne $wantBuild) {
            Dump-PortDiagnostics
            Fail "Another copy of PARDIK IPTV in $servRoot would not give up port $port. Run STOP.bat in THIS folder (or reboot once), then launch again."
        }
        Log "backend re-verified from THIS folder: build $got2"
    }
} elseif (-not $up) {
    Fail "The backend did not answer on port $port within 16 seconds. See $logfile and _userdata\backend.log."
}

# --- open UI in an Edge app window (native look), else default browser ---
# an Edge --app window left over from a previous launch keeps OLD javascript
# in memory and reads as "nothing changed": retire it before opening a new one
Get-Process msedge -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -like "PARDIK IPTV*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue
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
    Log "opening Edge app window: $url"
    Start-Process -FilePath $edge -ArgumentList @("--app=$url", "--new-window", "--start-maximized", "--autoplay-policy=no-user-gesture-required")
} else {
    Log "Edge not found - opening default browser: $url"
    Start-Process $url
}
Log "launch ok"
exit 0
