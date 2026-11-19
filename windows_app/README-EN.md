# PARDIK IPTV — Windows 10 (x64) edition, Ronika Palace residential deployment

A full, standalone re-implementation of Pardik's IPTV product for Windows 10
64-bit, configured for the **Ronika Palace residential complex in Kahak**. It was
produced by reverse-engineering the vendor's Android APKs
(`com.dexin.wanchuan.iptv3`, **v2.7.1.71** and **v2.7.2.06** / code 20702006) —
see `../analysis/REVERSE_ENGINEERING_REPORT.md`. Full Persian documentation:
`README-FA.md`.

What the residential flavour means in practice:

- live **domestic (IRIB)** and **satellite** channels from the complex head-end;
- the receiver is identified by the MAC of the **wired Ethernet** adapter, like
  the APK's `IptvUtil.getMacAddress()` (which reads `eth0` before `wlan0`);
- the hospitality platform is **not** part of this product: no catering/food
  ordering, room service, laundry, taxi, wake-up call, check-out, consumption
  bill, hotel introduction or manager-signature/guest framing.

## Install
1. Unzip anywhere.
2. Double-click **`install\Setup.bat`** — it copies the app to
   `%LOCALAPPDATA%\PARDIK-SMART-IPTV`, creates Desktop + Start-Menu shortcuts
   named **"PARDIK IPTV - Ronika Palace"**, registers an uninstaller,
   auto-downloads an embeddable CPython if none is present, auto-downloads FFmpeg
   (for RTSP/TS sources), then launches the app.
3. Uninstall via Settings → Apps, or `install\Uninstall.bat`.

## Defaults (identical to the APK)
- Server `10.21.0.10`, port `8030`, RTSP port `554`
- Settings password **`111999`**
- API base `/iptv2/` (falls back to `/iptv2/manager/`), VOD `/iptv2/vod/`
- WebSocket control `ws://{ip}:{port}/dx-admin/websocket/{mac}` and
  `/iptv2/websocket/{unit}`
- Head-end self-announcement on **UDP `27777`** (20 s socket timeout, up to 180
  listener cycles), boot screen = 20 `GetSettings` attempts 2 s apart, background
  timer = 2 s delay / 5 s period — the exact constants of `BaseApplication` and
  `PingServerActivity`.
- Change IP/port/**unit number** in **System settings** (password-gated).

## Will live TV actually play? (post-install checklist)
Five conditions decide it, and **Settings → password `111999` → "Live playback
check"** tests all of them in one go (backend: `GET /api/diagnose`, which returns
`server`, `network`, `ffmpeg`, `protocol`, `source_kinds`, `checks[]`,
`sample_channels[]` and `issues[]` for support):

1. **a physical adapter is up** — `Get-NetAdapter -Physical` on Windows,
   `/sys/class/net` on Linux; the MAC of the *wired* adapter is the client id.
2. **a real LAN address** — `169.254.x.x` is reported as a problem (no DHCP
   answer on the complex LAN).
3. **the head-end answers** — a 4-second TCP connect to `ip:port` (the APK's
   factory default `10.21.0.10:8030` is *not* necessarily your head-end). When the
   socket is closed the remaining checks are skipped, so the diagnosis takes 4 s
   instead of three 8-second HTTP timeouts.
4. **the server hands out channels** — `GetSettings`, then `GetLivePackage` /
   `GetLiveTV?mac=`; the dialog lists the count plus six sample channels with the
   kind of source each one uses.
5. **FFmpeg is present** whenever any channel source is `rtsp://`, `udp://` or
   `.ts`, or the head-end's `Settings.protocol` is `rtsp`/`udp` — those are
   remuxed locally (`tools\ffmpeg.exe`; the installer fetches it from PyPI, and an
   offline install needs the file dropped in by hand).

Two code-level guarantees behind that list:

* `Settings.protocol` from the head-end wins, but when the chosen source needs the
  FFmpeg remux and `ffmpeg.exe` is missing, `pickSource()` falls back to the same
  channel's `hlsUrl`/`httpUrl`, and if there is none the player prints the reason
  (`ffmpeg_missing_long`) instead of a black screen with a generic decode error.
* Start-up never hangs on an unreachable head-end either: the handshake runs in
  the backend as `ConnectionEngine` (see below) while the UI polls
  `/api/connection`, any key on the boot screen skips the wait, and Settings keeps
  a **"Find the head-end"** row that re-runs UDP discovery plus a subnet sweep —
  so a wrong IP can be fixed without the server being reachable.

## Channel source: the platform server, or an m3u playlist
1. **Platform server (default)** — bouquets from `GetLivePackage`, channels from
   `GetLiveTV?packageId=`. The bundled mock publishes a domestic bouquet
   (IRIB TV1–4, News, Sport) and a satellite one (TRT World, France 24,
   Al Jazeera, DW).
2. **m3u/m3u8 playlist** — many residential head-ends just publish a playlist.
   Settings → **"Channel list (m3u)"** takes a URL or a local path
   (`http://10.21.0.10:8030/iptv2/residential/channels.m3u`, `C:\lists\ronika.m3u8`).
   Each `#EXTINF` becomes a channel, its `group-title` becomes the bouquet; name,
   number, `tvg-logo` and group all come from the playlist. State lives in
   `app\_userdata\m3u.json` and is exposed at `/api/m3u`
   (`GET`, `GET ?refresh=1`, `POST {url|path|text|enabled}`).
   Playlist channels carry no numeric platform id, so EPG and the pre-roll advert
   flow (both keyed on `liveId`) are skipped for them; playback, favourites, the
   side list and channel numbering work as usual.

## Network identity
`iptv_backend.detect_interfaces()` enumerates physical adapters (Windows:
`Get-NetAdapter -Physical | ConvertTo-Json`; Linux: `/sys/class/net`), classifies
them as ethernet/wifi/other and prefers a link that is up, ranking Ethernet above
Wi-Fi. `detect_network()` picks the winner and `/api/config` returns it as
`network{mac,iface,kind,ip,wired}`; Settings → "Device connection" shows it and
"Reconnect to server" re-detects it. The resolved MAC is refreshed at every
start and persisted with `device_iface` / `device_iface_kind`.

## How it connects (the APK's own handshake)
`ConnectionEngine` in `iptv_backend.py` replays `BaseApplication.onCreate()` in
order — device MAC → `GetRoomInfo` → `GetClient` → `GetSettings` →
`startServerIpThread()` (UDP `27777`, Gson-style `{"ip","port"}` adopted only
when `checkIpaddress(ip)` and `0 < port < 65536`) → `GetCurrentTimeAndZone` →
the 2 s/5 s timer (`times % 2` → `GetInStream`, `times ∈ {0, 5}` → full re-read +
`UpdateClient`) — while `ping_loop()` reproduces `PingServerActivity`'s
`Timer(0, 2000)`: 20 `GetSettings` attempts, then `openWelcomeActivity(advVideoEM,
layout)`. `connected` is set by exactly the four calls that set it in the APK
(`GetSettings`, `GetClient`, `GetRoomInfo`, `UpdateClient`), so the LIVE gate and
the `status_disconnected` toast are honest even when the head-end disappears
later; the UI re-reads `/api/connection` every 5 s (700 ms on the boot screen).
Live state for support: `GET /api/connection` (`phase`, `ping_times/ping_max`,
`server_settings`, `discovery`, `sweep`, 40 log lines) and
`POST /api/connection/{retry,skip,sweep,announce,playing}`. Settings shows three
rows for it: **head-end connection status**, **find the head-end (UDP 27777)**
and **reconnect to the server**.

## What it does
Boot/ping (`PingServerActivity`) → boot advert (`BootVideoActivity`) → welcome
(`WelcomeStyleZeroActivity`: language fa/en/zh, clock, weather, **resident
greeting**, manager signature, background advertising) → home
(`MainStyleThirdActivity`: logo/**unit number**/Wi-Fi/weather/clock bar + the
`GetHomepageIcon` menu, or the APK's `addDefaultMenu()` fallback) → Live TV (bouquets, numbered channel list, watermark, favourites, EPG
polling, RTSP/HLS/HTTP/UDP), VOD (categories, poster grid, detail, playlist),
Playback/Timeshift, Scenery, Music, password-protected Settings, plus the
Windows-only extras (launch local apps from the menu, boot auto-start, playback
speed, external VLC decoding). All original icons/backgrounds are reused; the UI
is a native-looking borderless Edge app window with full D-pad/keyboard
navigation.

### The hotel platform (optional, off in this product)
The same code still contains Pardik's full hospitality platform; flip it on by
setting `mode.txt` (next to `install\launch.ps1`) to `hotel`, or by exporting
`IPTV_MODE=hotel`. Catering, room service, laundry, taxi, wake-up, consumption
bill, hotel intro and the manager signature come back, and the product title
becomes "PARDIK SMART IPTV". In the default `residential` flavour the head-end
simply does not offer them: the menu is built from `GetHomepageIcon` (or the
APK's own `addDefaultMenu()`), so catering/service tiles only appear when the
deployment asks for them — no screens are hard-blocked in the client any more.

## Performance on the target box (i5-3337U / 6 GB / GT 720M)
- Video decoding is hardware-accelerated by the browser (MF/DXVA).
- RTSP/UDP/MPEG-TS are remuxed to HLS with FFmpeg `-c copy` (no re-encode) → ~0% CPU.
- Backend is Python **stdlib only** — no third-party packages, tiny footprint.

## Controls
Arrows/Tab move · Enter = OK · Esc/Backspace = back (twice in live to exit) ·
↑/↓ volume · M mute · F favourite · L channel list · **E** EPG panel ·
**I** programme details · **S** playback speed · Enter (in player) fullscreen.

When the server sets `Settings.advVideoEM`, start-up follows `BootVideoActivity`:
`GetAdvVideoEM?mac=` returns a `List<String>` of clips relative to `/iptv2/`, the
first one plays full screen before the welcome screen, and **any key except the
volume keys** (or completion, or a playback error) moves on — exactly like the
APK's `onKeyDown`. The welcome screen then keeps the APK's background
advertising: the `GetAdvImage?type=1` slideshow (5 s a page) and the
`apk/getClientBackgroundMusics` loop from `res/adv/music/` (the `type=12` manager
signature is hotel-only). With `advVideoEM` off, those same clips play as the
welcome background video instead (random next clip on completion, slideshow on
error). Browsers block un-gestured autoplay, so `install/launch.ps1` passes
`--autoplay-policy=no-user-gesture-required` and the UI retries muted rather than
dropping an advert.

When the server enables advertising (`Settings.activeAdv`), live channels carry
the same pre-roll flow as the APK: `GetAdvImage?type=3` fills the watermark slot
with an advert creative, `GetNextAdv?mac=&liveId=` returns the advert video
(`LiveProgramAdvVideoBean{status,resource{id,url,allowSkip,countTime}}`), the
countdown overlay uses the APK's own `ad_video_time_remains` string, any key
skips the advert when `allowSkip` is set, and watch time is reported back through
`AddAdvHistory?mac=&id=&type=&time=&check=` (type 1 = live programme, type 2 =
advert; check 1 = seen to the end, 2 = skipped).

## Develop / test
```
python3 tools/mock_iptv_server.py &                      # fake head-end on :8030
IPTV_HOST=127.0.0.1 IPTV_PORT=8787 python3 windows_app/app/iptv_backend.py
cd tools/smoke && node smoke.js                          # end-to-end UI test (0 errors)
IPTV_MODE=hotel …                                        # same test against the hotel flavour
bash tools/build_package.sh                              # dist zip (MODE=hotel for that one)
```
