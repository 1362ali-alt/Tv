# Tv — Pardik IPTV: Android → Windows 10 reverse-engineering & residential port

Reverse-engineered the two supplied Pardik Android APKs (`com.dexin.wanchuan.iptv3`
**v2.7.1.71** and **v2.7.2.06**, "PARDIK SMART IPTV", IPTV client for the manager
server `10.21.0.10:8030`) and rebuilt the product as a standalone, installable
**Windows 10 x64** application.

The shipped product is Pardik's **IPTV client for the residential complex
«Ronika Palace», Kahak**: live **domestic (IRIB)** and **satellite** channels from
the complex head-end, over a **wired Ethernet** LAN, with the unit number as the
subscriber identity. The vendor's hospitality platform (catering/food ordering,
room service, laundry, taxi, wake-up call, check-out, consumption bill, hotel
introduction, manager signature) is still implemented in the same code base but is
**switched off** — `mode.txt` / `IPTV_MODE=hotel` turns it back on for reference.

| Path | What |
|---|---|
| `analysis/REVERSE_ENGINEERING_REPORT.md` | Full reverse-engineering report: config defaults (incl. settings password `111999`), complete HTTP API contract, data models, WebSocket channels, app flow, UI language, port deviations |
| `analysis/java_src/`, `analysis/java_src_v2/` | Decompiled Java (v2.7.1.71: 1,205 classes · v2.7.2.06: 1,298 classes, DAD decompiler) |
| `analysis/out/v2_realdiff.txt`, `analysis/out/v2_strings_diff.txt` | Version diff of the two APKs (changed classes, new/removed classes, string deltas) |
| `analysis/ui/`, `analysis/res_decoded/` | Decoded layouts with resolved resources + localized strings (fa/en/zh/…) |
| `windows_app/` | **The Windows 10 application** (backend + UI + installer). See `windows_app/README-FA.md` (Persian, primary) / `README-EN.md` |
| `tools/mock_iptv_server.py` | Local mock of the head-end/manager server on `:8030`, incl. the residential bouquets, an m3u playlist and a `/mock/announce?on=1` replay of the UDP 27777 self-announcement |
| `tools/smoke/smoke.js` | Headless jsdom end-to-end smoke test of the UI (runs green in both flavours) |
| `analysis/decode_v2.py`, `analysis/res_decoded_v2/` | AndResGuard resource decoder for v2 + the resolved id/name/string maps used to port the real layouts (`activity_ping_server`, `activity_welcome`, `activity_main_ijk_style_third/fourth`, `adapter_main_menu_layout`) |
| `dist/` | Built distribution zips |

## Quick start (Windows 10 x64)
Unzip `dist/PARDIK-IPTV-RonikaPalace-Kohak-Win10-x64-2.7.2.06.zip`, double-click
`install\Setup.bat`. Defaults: head-end `10.21.0.10`, port `8030`, RTSP `554`,
settings password `111999`, deployment flavour `residential`.
Current app version: **2.7.2.06** (version code 20702006).

## Connection / handshake
The client speaks the head-end's own protocol, in the APK's own order: device MAC →
`GetRoomInfo` → `GetClient` → `GetSettings` → UDP `27777` self-announcement →
`GetCurrentTimeAndZone` → the 2 s/5 s background timer, with `PingServerActivity`'s
20 attempts 2 s apart driving the boot screen and `openWelcomeActivity(advVideoEM,
layout)` deciding between `BootVideoActivity` and `WelcomeStyleZero/OtherActivity`.
`ServerDiscovery` + `ConnectionEngine` in `windows_app/app/iptv_backend.py` are
line-for-line ports (`BaseApplication$3`, `$9/$7/$4/$6`, `PingServerActivity$2`),
and the screens are the APK's decoded layouts — see report §9 for the mapping.

## Channel source
The client reads channels either from the platform server (`GetLivePackage` +
`GetLiveTV?packageId=`, the default) or from an **m3u/m3u8 playlist** published by
the head-end — Settings → "Channel list (m3u)" (`POST /api/m3u` with
`{url|path|text, enabled}`, `GET /api/m3u[?refresh=1]`). `group-title` becomes the
bouquet, each `#EXTINF` a channel; playlist channels skip EPG and the pre-roll
advert because they carry no platform `liveId`.

## Develop / test (this repo)
```
python3 tools/mock_iptv_server.py &            # fake head-end on :8030
IPTV_HOST=127.0.0.1 IPTV_PORT=8787 IPTV_FFMPEG=<ffmpeg> python3 windows_app/app/iptv_backend.py
# then open http://127.0.0.1:8787/
cd tools/smoke && node smoke.js                # residential end-to-end test (0 errors)
IPTV_MODE=hotel IPTV_PORT=8787 python3 windows_app/app/iptv_backend.py   # hotel flavour
bash tools/build_package.sh                    # dist zip (MODE=hotel for the hotel one)
```

## Backend API added by the port
`/api/config` now also returns `mode`, `branding`, `network{mac,iface,kind,ip,wired}`,
`ffmpeg`, `connection` and `m3u{enabled,url,path,error,updated,count,groups}`;
**`GET /api/connection`** exposes the whole connection engine (`connected`, `phase`
`boot→ping→welcome→main`, `ping_times/ping_max`, the head-end's `Settings` bean,
`discovery`, `sweep`, 40 log lines) and `POST /api/connection/{retry,skip,sweep,
announce,playing}` drives it — the UI shows it in Settings as «وضعیت اتصال هداند»,
«جست‌وجوی هداند (UDP 27777)» and «اتصال مجدد به سرور»; `GET /api/network`
re-detects the physical adapter and persists it, `GET|POST /api/m3u` manage the
playlist source, and **`GET /api/diagnose`** is a post-install pre-flight check
(adapter → LAN address → 4 s TCP connect to the head-end → `GetSettings` →
`GetLivePackage`/`GetLiveTV` → FFmpeg → m3u), returning `checks[]`, `issues[]`,
`source_kinds` and six `sample_channels` — the UI shows it under
Settings → «بررسی پخش زنده». Everything else (`/api/call?ep=…`, `/api/img`,
`/stream/play`, `/proxy`) mirrors the APK's `HttpUtil`/`IptvSP` contract.
