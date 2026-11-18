# Tv — PARDIK SMART IPTV: Android → Windows 10 reverse-engineering & port

Reverse-engineered the supplied Android APK (`com.dexin.wanchuan.iptv3` v2.7.1.71,
"PARDIK SMART IPTV", hotel/ residential-tower IPTV for server `10.21.0.10:8030`),
rebuilt it as a standalone, installable **Windows 10 x64** application, and then
ported the newer **v2.7.2.06** APK on top of it (EPG-in-player, boot advert video
+ welcome-screen advertising, in-player
advertising with countdown/skip/watch-time reporting, catering country selector,
order history + cancel, taxi & service-record room services, VLC external
playback, playback speed, boot auto-start, local-app launcher).

| Path | What |
|---|---|
| `analysis/REVERSE_ENGINEERING_REPORT.md` | Full reverse-engineering report: config defaults (incl. settings password `111999`), complete HTTP API contract, data models, WebSocket channels, app flow, UI language |
| `analysis/java_src/`, `analysis/java_src_v2/` | Decompiled Java (v2.7.1.71: 1,205 classes · v2.7.2.06: 1,298 classes, DAD decompiler) |
| `analysis/out/v2_realdiff.txt`, `analysis/out/v2_strings_diff.txt` | Version diff of the two APKs (changed classes, new/removed classes, string deltas) |
| `analysis/ui/`, `analysis/res_decoded/` | Decoded layouts with resolved resources + localized strings (fa/en/zh/…) |
| `windows_app/` | **The Windows 10 application** (backend + UI + installer). See `windows_app/README-FA.md` / `README-EN.md` |
| `tools/mock_iptv_server.py` | Local mock of the manager server (test harness only) |
| `tools/smoke/smoke.js` | Headless jsdom end-to-end smoke test of the UI |
| `dist/` | Built distribution zip |

## Quick start (Windows 10 x64)
Unzip `dist/PARDIK-SMART-IPTV-Win10-x64-*.zip`, double-click `install\Setup.bat`.
Defaults: server `10.21.0.10:8030`, settings password `111999`.
Current app version: **2.7.2.06** (version code 20702006).

## Develop / test (this repo)
```
python3 tools/mock_iptv_server.py &            # fake manager on :8030
IPTV_HOST=127.0.0.1 IPTV_PORT=8787 IPTV_FFMPEG=<ffmpeg> python3 windows_app/app/iptv_backend.py
# then open http://127.0.0.1:8787/
cd tools/smoke && node smoke.js                # headless end-to-end test
```
