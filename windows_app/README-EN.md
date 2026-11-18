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
- Change IP/port/**unit number** in **System settings** (password-gated).

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

## What it does
Boot/ping → welcome (language fa/en/zh, clock, weather, **resident greeting**,
background advertising) → home (logo/**unit number**/weather/clock bar + icon
menu) → Live TV (bouquets, numbered channel list, watermark, favourites, EPG
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
becomes "PARDIK SMART IPTV". In the default `residential` flavour those screens
are removed from the menu *and* blocked from navigation
(`app.js: HOTEL_SCREENS`).

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
