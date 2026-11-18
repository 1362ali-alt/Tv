# Reverse-Engineering Report — PARDIK SMART IPTV (Android) → Windows 10 port

**Source APK:** `iptv3_2.7.1.71_20251223_10.21.0.10_name_PARDIK_SMART_IPTV.apk` (50,692,807 bytes)
**Package:** `com.dexin.wanchuan.iptv3` · **Version:** 2.7.1.71 (code 20701071) · minSdk 19 / targetSdk 28
**App label:** `PARDIK SMART IPTV` · **Launcher activity:** `com.dexin.wanchuan.iptv3.activity.PingServerActivity`
**Framework:** Baidu DuerOS (Xiaodu) smart-TV assistant framework + OkHttp/OkGo + Gson + Glide + ijkplayer (FFmpeg) + Java-WebSocket
**Native libs:** `libijkplayer.so`, `libijkffmpeg.so`, `libijksdl.so` (video), Baidu TTS/ASR, `libv8.cr.so` (JS engine for DuerOS "swan" mini-programs)
**Languages shipped:** default(zh) + en + **fa (Persian)** + ar, th, tr, it, es, vi, ru, bg, hy, zh-TW … (Persian confirmed → the Windows port defaults to Persian)

---

## 1. Embedded configuration (defaults found in code)

| Item | Value | Source class |
|---|---|---|
| Default server IP | `10.21.0.10` | `IptvConfig.DEFAULT_SERVER_IP`, `IptvSP` |
| Default HTTP port | `8030` | `IptvConfig.DEFAULT_SERVER_PORT`, `IptvSP.getServerPort()` |
| Default RTSP port | `554` | `IptvConfig.DEFAULT_RTSP_PORT`, `IptvSP.getLiveRtspUrl()` |
| Manager API base | `/iptv2/manager/` | `IptvConfig.IMAGE_PATH` |
| VOD media base | `/iptv2/vod/` | `IptvConfig.VOD_PATH` |
| Webservice base | `/iptv2/` | `IptvConfig.WEBSERVICE_PATH` |
| **Settings password** | **`111999`** | `IptvSP.getPassword()` default; gate `isNeedPassword()` default `true` |
| Scroll/idle duration | 60000 ms | `IptvSP.getScrollDurationTime()` |
| VOD free minutes | 5 | `Settings.vodFreeMinutes` |
| Timeshift server | `127.0.0.1:9090`, play `127.0.0.1:8080/iptv2/vod` (http), 7 days | `Settings` ctor |
| Supported protocols | `rtsp` (default), `hls`, `http`, `udp`, `mscore` | `Settings.PROTOCOL_*`, `Settings.protocol` |
| Local data dir | `/sdcard/IPTV/` | `IptvSP` ctor |
| SharedPreferences file | `settings` | `IptvSP` |
| Device identity | MAC of eth0/wlan0 (upper-case, `xx:xx:…`) else serial | `IptvUtil.getMacAddress()` |

Preferences keys (`IptvSP`): `server_ip`, `server_port`, `default_server_ip`, `other_server_ip`, `password`, `need_password`, `iptv_room_number`, `select_app_style_flag`(default 1), `select_language_flag`(1), `server_language_flag`(3), `server_language_defalut_select_flag`(1), `scroll_duration_time`(60000), `main_bg_image`, `welcome_bg_image`, `ping_server_bg_image`, `welcome_word_title_image`, `app_login_serial_number`, `cibn_download_flag`, `iqiyi_download_flag`.

URL builders (`IptvSP`):
```
getAddress()      = http://{server_ip}:{server_port}
getUrl(x)         = getAddress() + "/iptv2/" + x
getImagePath(x)   = getAddress() + "/iptv2/manager/" + x
getHttpVodPath()  = getAddress() + "/iptv2/vod/"
getLiveRtspUrl(n) = rtsp://{server_ip}:554/live/{n}.sdp
getSerAddress()   = {server_ip}:{server_port}     (used by WebSocket URIs)
```

## 2. HTTP API contract (`http://{ip}:{port}/iptv2/manager/…`)

All list/object bodies parsed with Gson using **field-name = JSON key** (no `@SerializedName`).

| Endpoint | Query | Returns |
|---|---|---|
| `GetSettings` | – | `Settings` object |
| `GetClient` | `mac` | `Client` object |
| `GetRoomInfo` | `mac,ip,online,versionCode,versionName` | `Client` object |
| `UpdateClient` | `mac,ip,online,versionCode,versionName,name[,roomNumber]` | ack |
| `GetCurrentTimeAndZone` | – | `TimeDataBean{timeMills,timeZone}` |
| `GetLivePackage` | `mac` | `List<LivePackageBean>` |
| `GetLiveTV` | `packageId,mac` (or `-1` for all) | `List<LiveTV>` |
| `GetLiveStatus` | `mac` / `packageId,mac` | `List<LiveTV>` (program status) |
| `GetLiveStart` | – | status blob |
| `GetLiveEPG` | – | EPG |
| `GetNextAdv` | `mac,liveId` | next ad |
| `AddAdvHistory` | `mac,id,type,time,check` | ack |
| `GetVodType` | `mac` | `List<VodTypeBean>` |
| `GetVod` | `typeId` / `ids` / `keyword` / `isHot=1&mac` | `List<VodVideoBean>` |
| `GetVodUrl` | `vodId` | url |
| `GetVodCover` | – | cover list |
| `AddVodRecord` | `clientId,vodName,duration` | ack |
| `UpdateVodClickRate` | `vodId` | ack |
| `AddConsume` | `mac,consumeId,typeId=2` | ack |
| `GetConsume` | `mac` / `isHot=1&mac` | consume |
| `GetFolio` | `mac,PmsType` | folio/bill |
| `GetAdvImage` | `mac,type=N` | `List<String>` (relative image paths under `/iptv2/manager/`) |
| `GetAdvVideo` / `GetAdvVideoEM` | `mac` | ad video |
| `GetHomepageIcon` | [`packageId,mac`] | `List<MainPageItemBean>` |
| `GetServiceIcon` | [`packageId,mac`] | service icons |
| `GetScenery` | – | `SceneryItem` |
| `GetHotel` / `GetHotelType` / `GetHotelInformation` | [`mac`] | hotel info |
| `GetFoodType` / `GetFood` / `GetFoodCover` / `GetFoodOrder` | [`typeId`,`mac`] | catering |
| `AddFoodOrder` | … | ack |
| `GetGoods` / `GetGoodsOrder` / `AddGoodsOrder` | [`mac,typeId,wakeupTime`] | room service / rental / wake-up |
| `GetWakeUp` | – | wake-up info |
| `AddClientCheckOutOrder` | `mac` | check-out |
| `GetMusicCategory` / `GetMusicList` / `GetAlbum` | [`typeId`,`mac`,`albumId,tvType,languageType`] | music |
| `GetRecTV` / `GetRecProgram` / `GetEpgRecProgram` | [`liveId`] | timeshift/recordings |
| `GetVersion` | – | `VersionBean{versionCode,versionName,name,url,length,time}` |
| `GetAPK` | – | apk bytes |
| `GetSubtitleStyle` / `GetSubtitles` | `mac` | subtitles |
| `GetInStream` | `mac` | forced program (`ForceProgram`) |
| `GetEmergencyBroadcast` | – | emergency |
| `apk/getWeatherDays` | `mac` | `WeatherBean` |
| `apk/getClientBackgroundMusics` | `mac` | bg music |
| `apk/getClientBackgroundVideos` | `mac,type` | bg video |
| Static media | – | `/iptv2/vod/<file>`, `/iptv2/manager/<img>`, `/iptv2/manager/res/adv/{video,music}/…` |

### Data models (exact field names)
* `Settings`: protocol, playerFlag, layout, language, defaultLanguage, hotelName(En), city, phone, symbol, chargeMode, pmsType, timeout, pictureInterval, indexArea, vodFreeMinutes, apkUpdateType, showLogo, showWeather, showWaterMark(+Vod), showWelcomeBackground, skipWelcomePage, enterLivePage, needCheekIn, showPackage(+Style), changeChannelType, recordMode, timeshift{Days,Hours,ServerIp,ServerPort,PlayIp,PlayPort,PlayPath,PlayProtocol}, streamMedia{Ip,Port}, trafficSaveMode, active{Adv,Xiaodu}, advVideoEM, cater, checkOutCleanFavorite, operatorNumber, timeFormat, timeZone, menu*Visible (Scenery,Rec,App,CIBN,Cater,CheckOut,Consume,Hotel,RoomService,System,ThirdApp,Vod,iqiyi), menuTransparency, icon{BgColor,BgOpacity,UnselectBgColor,UnselectBgOpacity}
* `LiveTV`: id, number, name, liveType, url, rtspUrl, httpUrl, hlsUrl, imagePath, nameVisible, imageVisible, timeshift, timeshifting, tsStartTime, checked
* `LivePackageBean`: id, number, name, content, price, clientIds, tvIds, imagePath, nameVisible, imageVisible
* `VodTypeBean`: id, number, name, count
* `VodVideoBean`: id, vodId, number, url, videoName (+Parcelable)
* `Client`: id, groupId, mac, ip, name, enable, online, money, costSum, unfinishedOrderCount, versionCode, versionText, welcomeWord(+En), wifiName, wifiPassword, wifiStatus, wifiTips(+En), checkInTime, checkPerson, timeZone, timeMills, goods, checked, nrStatus
* `MainPageItemBean`: id, number, type, enabled, icon, icon1, packageName, chineseName, englishName, japaneseName, koreanName, russianName, thaiName
* `MainMenu`: id, view_id, name, icon, iconFocus, errorIcon, errorIconFocus, cls, skip, appName, appUrl, drawable_view_id
* `TimeDataBean`: timeMills, timeZone
* `VersionBean`: versionCode, versionName, name, url, length, time
* `ForceProgram`: id, type, client, program, description
* `WebSocketRecvDataBean`: type, control_type, value  · `WebSocketSendDataBean`: status, msg, hotelId, roomNumber · `VolWebSocketBean`: type, roomNumber, mute

## 3. WebSocket control channels
1. **Program/voice control:** `ws://{ip}:{port}/dx-admin/websocket/{mac}` with HTTP headers `hotel_id`, `room_number`. Heart-beat every 20 s. Inbound `WebSocketRecvDataBean`: `type` 1=live, 2=vod, 3=volume; `control_type` semantics (1 up / 2 down / 3 mute-on-off / 4 set-absolute for volume; channel change values for live). Outbound sample `{"status":200,"msg":"成功","hotelId":"201","roomNumber":"8688"}`.
2. **Volume per-room:** `ws://{ip}:{port}/iptv2/websocket/{urlencoded(roomNumber)}`; `VolWebSocketBean{type,roomNumber,mute}`.

## 4. Application flow (Android)
`PingServerActivity` (ping background from `GetAdvImage?type=11`, start both WebSocket services, 1 s timer) → on success:
* if `Settings.skipWelcomePage` → straight to main; else `BootVideoActivity` (`GetAdvVideoEM`) or `WelcomeStyleZero/OtherActivity` (language picker zh/en, welcome word from `Client.welcomeWord`, weather `apk/getWeatherDays`, clock/date) → main.
Main (`MainStyle*Activity`, `LAYOUT_STYLE` in default prefs selects 1..5): top bar = logo, room number, Wi‑Fi name/password, weather, `DigitalClock` (HH:mm + date); body = background banner (`MZBannerView` / background `IjkVideoView`) + horizontal `TvRecyclerView` menu built from `GetHomepageIcon` + `Settings.menu*Visible`.
Menu → targets: **LIVE** (`LivePackageActivity` if `showPackage` else `LivePlayer*Activity`), **VOD** (`VodNewActivity`), **Playback** (`RecordEpgActivity`), **Scenery**, **Dinner/Catering**, **Service** (popup: room service / wake-up / billing / one-key check-out), **Third APP**, **Hotel** intro, **APPs**, **Settings** (password `111999`).
Live player: full-screen `IjkVideoView`, protocol chosen from `Settings.protocol` (rtsp→`rtspUrl`/`getLiveRtspUrl(number)`, hls→`hlsUrl`, http→`httpUrl`, udp), optional package side-list, channel number overlay, watermark (`showWaterMark`), loading spinner, ad countdown, "press OK for fullscreen", back-press twice to exit, favourites, `GetLiveStatus` polling for EPG/now-playing.
VOD: horizontal category `TvRecyclerView` + 6-column poster grid; detail (synopsis, director, duration, price, `AddConsume`, `UpdateVodClickRate`); player with playlist popup, `AddVodRecord`.
Settings (password-gated): Room Number, Server IP, Server Port, Local network, Local MAC, Version update (`GetVersion`+`GetAPK`), APPs, System.
Global heartbeat (`BaseApplication.getDataFromServer()`): `GetSettings`, optional ping image, every 2nd tick `UpdateClient` + `GetRoomInfo`, and `GetCurrentTimeAndZone` when disconnected or >24 h stale. Server-IP retry thread max 180 attempts.

## 5. UI / visual language (for the Windows port)
* Backgrounds: dark slate-blue gradient (`bg_style_four.png`), blurred photo (`bg_welcome.png`); white text; gold/brown focus accents; rounded translucent panels (`bg_second_content`, `bg_setting_item`).
* Home top bar + horizontally-scrolling icon menu with `icon_*` / `icon_*_large` pairs (260×190 focus art), launcher icon = cyan rounded square with play glyph.
* Settings/scroll views: label column 1.5 weight + value column 2.5 weight rows.
* Full extracted asset set (429 images incl. all menu icons, backgrounds, player controls, weather icons, app icon) saved under `app_assets/img/` with an index `app_assets/img_index.json`.
* Localised strings (default/zh, en, **fa**, …) extracted to `analysis/res_decoded/strings_by_locale.json`; the Windows UI ships fa + en + zh.

## 6. Windows-port design (what was built)
* **Runtime:** bundled/installed CPython 3.x (Windows x64) — the app itself is **pure-Python stdlib** (no pip deps) + a bundled FFmpeg for RTSP/MPEG‑TS→HLS remux. UI is an Edge/Chromium `--app` window over a local HTTP server (native look, no browser chrome), with full keyboard/remote navigation.
* **Playback:** HLS via bundled `hls.js`; HTTP‑MP4 native; RTSP/UDP/MPEG‑TS transparently remuxed to HLS by FFmpeg (`-c copy`, ~0 % CPU) served from `localhost`.
* **Parity:** same endpoints, same URL builders, same defaults (10.21.0.10:8030, password 111999, RTSP 554), same screens/flow, same icons/backgrounds, Persian-first i18n, both WebSocket control channels, settings with password gate, favourites, EPG polling, watermarks, welcome screen, version check.
