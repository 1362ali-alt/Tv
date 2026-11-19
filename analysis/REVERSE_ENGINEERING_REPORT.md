# Reverse-Engineering Report — PARDIK SMART IPTV (Android) → Windows 10 port

**Delivered product (§8):** Pardik's IPTV client for the **residential complex «Ronika Palace», Kahak** —
live domestic (IRIB) + satellite channels over a wired Ethernet LAN. The hospitality platform analysed
here is retained in the code but switched off (`mode.txt` / `IPTV_MODE=hotel` turns it back on).

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
* if `Settings.advVideoEM` → `BootVideoActivity` plays `GetAdvVideoEM[0]` full screen first (any key but the volume keys, completion or error → welcome); then `WelcomeStyleZero/OtherActivity` (language picker zh/en, welcome word from `Client.welcomeWord`, weather `apk/getWeatherDays`, clock/date, background slideshow or video + music), which itself goes straight to main when `Settings.skipWelcomePage`.
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
* **Parity:** same endpoints, same URL builders, same defaults (10.21.0.10:8030, password 111999, RTSP 554), same screens/flow, same icons/backgrounds, Persian-first i18n, both WebSocket control channels, settings with password gate, favourites, EPG polling, watermarks, boot advert video + welcome screen advertising, in-player adverts, version check.

---

# 7. Version delta — v2.7.2.06 (second APK) and how it was ported

**Source APK:** `iptv3_2.7.2.06PARDIK_SMART_IPTV.apk` (55,272,211 bytes, md5 `4592d95032a032e5618cabb3350ab8dc`)
**Package:** `com.dexin.wanchuan.iptv3` · **Version:** 2.7.2.06 (code **20702006**) · minSdk **21** / targetSdk **34**
**Decompiled to:** `analysis/java_src_v2/` (1,298 classes, DAD, 0 failures) · assets extracted by `analysis/extract_assets_v2.py`
**Diff artefacts:** `analysis/out/v2_meta.txt`, `v1_meta.txt`, `v2_realdiff.txt` (592 changed / 525 identical of 1,117 common classes),
`v2_new_app_classes.txt` (181), `v2_removed_app_classes.txt` (88), `v2_strings_diff.txt`, `v2_new_literals.txt`.

## 7.1 What changed in the APK

| Area | v2.7.1.71 | v2.7.2.06 |
|---|---|---|
| DEX files | 3 | **5** (methods grew past the 64 k limit) |
| App classes | 1,205 | **1,298** |
| Activities | 44 | **50** (+`SettingAppShowActivity`, `CateringCountrySelecterActivity`, `MyHistoryOrderListActivity`, `MyHistoryOrderDetailActivity`, `LivePlayerWithEpgActivity`, `LiveExoTestActivity`, `RecordEpgAllTimeActivity`; −`MyHistoryOrderActivity`) |
| Permissions | — | +`BROADCAST_STICKY`, `QUERY_ALL_PACKAGES`, `USE_SIP` |
| Boot | none | **`util.BootReceiver`** registered for 13 boot/screen actions → relaunches `PingServerActivity` (`NEW_TASK|CLEAR_TOP`) |
| Native libs | ijkplayer/ffmpeg/sdl, Baidu TTS | +`libavcodec.so`, `libavutil.so`, `libffmpegJNI.so`, `liblog.so`, **`libmmkv.so`**, `libswresample.so` (46 `.so` for armeabi-v7a) |
| Libraries | butterknife, ijkplayer, media3-partial | **+media3/exoplayer, guava, protobuf, kotlinx-flow, com.mstar.android, com.baidu.tts**; −butterknife |
| Strings | default(zh) 343, fa 231 | default **419**, fa **305** (new fa values ship as English placeholders → the Windows port supplies real Persian) |
| Preferences | `SharedPreferences("settings")` | **MMKV** (`IptvSP` rewritten; `getAppStyle()` removed, `getAppLayoutStyle()` added) |

`IptvConfig` and `HttpUtil` are **byte-identical** between the two versions — the server address scheme, paths and the
settings password `111999` are unchanged.

### New preference keys (`IptvSP`)
| Key | Default | Meaning |
|---|---|---|
| `app_layout_style` | `0` | welcome/main layout selector (`PingServerActivity`: 0 → `WelcomeStyleZero`, 5 → own style, else `WelcomeStyleOther`) |
| `use_vlc_paly_live_prg` | `false` | hand live playback to **VLC** (`LivePlayerActivity.playWithVlc`) |
| (settings) `play_speed` | `1.0` | persisted playback rate (`R.id.txt_play_speed`) |
| boot auto-start | — | `BootReceiver` enabled state |

### New server flags (`bean.Settings`)
| Field | Type | Effect in the APK |
|---|---|---|
| `epg` | bool | live player becomes `LivePlayerWithEpgActivity` (EPG strip + detail popup + timeshift) |
| `caterSub` | bool | catering opens `CateringCountrySelecterActivity` before the food types |
| `tfPlayerFlag` | int | `1` → VOD plays in `VodPlayerIjkActivity` |
| `appShowInMenu` | bool | `MainStyleFourthActivity.addLocalThirdAppInMenu()` replaces the single third-app tile with one tile per locally-installed app |
| ctor changes | — | `layout` default `4 → 0`, `trafficSaveMode` default `1 → 0` |

### Endpoint census (v2)
**New:** `GetClothingType`, `GetServiceOrder`, `GetLiveEPG` · **Removed:** `GetGoodsOrder` (still answered by the server, no longer called).

| Endpoint | Params | Caller / notes |
|---|---|---|
| `GetFoodType` | `mac=`, **`parentId=`** (new) | `CateringCountrySelecterActivity` → food types of the chosen country |
| `GetClothingType` | *(none)* | `RentThingsActivity` when `serviceType != 2` (laundry); `serviceType == 2` still uses `GetGoods` |
| `GetServiceOrder` | `mac=` | `StyleThreeServiceRecordActivity` (service history; `StyleThreeServiceRecordBean` gained `gId/gName/gNameEn`) |
| `GetLiveEPG` | `liveId=` | `LivePlayerWithEpgActivity` → `List<LiveProgEpgDataBean>{id,liveId,date,startTime,endTime,program,content,playing,timeshift}` |
| `GetEpgRecProgram` / `GetRecProgram` | `liveId=` | playback screen, grouped by date (`RecordEpgAllTimeActivity`) |
| `GetRecTV` | *(none)* | recorded-channel list |
| `GetFoodOrder` | `mac=` | `MyHistoryOrderListActivity` |
| `AddFoodOrder` | POST `mac=`, `countAndIds=id:count,…` **or** `cFlag=1&id={orderId}` | submit / **cancel** an order |
| `AddGoodsOrder` | `mac=`, `typeId=`, **`wakeupTime=`** (epoch ms) | room service + wake-up (4) + **taxi (7)** |
| `AddClientCheckOutOrder` | `mac=` | one-key check-out |
| `GetWakeUp` | `mac=` | pending wake-up/taxi orders |
| `GetLiveStatus` | **POST** form `name=&mac=` | `LivePlayerWithEpgActivity` (was GET) |
| `GetAdvImage` | `mac=&type=3` | `getAdImageInfo()` → a random path is loaded into `water_mark_image_view` (rounded) |
| `GetNextAdv` | `mac=&liveId=` | pre-roll advert → `List<LiveProgramAdvVideoBean>{status,msg,resource{id,name,url,allowSkip,countTime,count,size,checked}}`; `status 0` = no advert, `200` = play `resource.url` first |
| `AddAdvHistory` | `mac=&id=&type=&time=&check=` | watch-time report: `type 1` = live programme (`id = liveProgramId`), `type 2` = advert (`id = adVideoProgramId`); `check 1` = seen to the end, `2` = skipped |
| `GetAdvVideoEM` | `mac=` | `WebTag.TAG_BOOT_VIDEO` → **`List<String>`** of clip paths *relative to `/iptv2/`* (`IptvSP.getUrl`). `BootVideoActivity` plays them full screen before the welcome screen when `Settings.advVideoEM` is set; `WelcomeStyleZero/OtherActivity` plays them as the welcome background when it is not |
| `GetAdvImage` | `mac=&type=1` | `playPptBGImage()` → welcome background slideshow (`MZBannerView`, `setDelayedTime(5000)`, indicator hidden, no rotation for a single page) |
| `GetAdvImage` | `mac=&type=12` | `getManagerSignImg()` → a random path (`Uri.encode(x, "/")`) into the hotel-manager signature `ImageView` (hidden when the list is empty) |
| `apk/getClientBackgroundMusics` | `mac=` | `List<BGMusicBean>{url,description}` → `res/adv/music/<URLEncoder.encode(url)>` played through a `MediaPlayer`, another random track on completion |

### Room-service id map (`StyleTwoRoomServiceFragment$1.onItemClick`)
| id | Tile art (`mipmap/pic_style_three_*_service`) | Action |
|---|---|---|
| 1 | `housekeeper` | confirm dialog → `AddGoodsOrder?typeId=1` |
| 2 | `borrow_things` | `RentThingsActivity(serviceType=2)` → `GetGoods` |
| 3 | `wash_clothes` | `RentThingsActivity(serviceType=3)` → **`GetClothingType`** |
| 4 | `alarm` | `WakeUpActivity` → `AddGoodsOrder?typeId=4&wakeupTime={ms}` (sleeps 3 s after submit) |
| 5 | `service_record` | `ConsumeActivity` (bill) |
| 6 | `one_key_checkout` | confirm → `AddClientCheckOutOrder?mac=` (button disabled while pending) |
| 7 | `taxi` | **new** — `WakeUpActivity` in taxi mode → `AddGoodsOrder?typeId=7&wakeupTime={ms}` |
| 8 | `search` | **new** — `StyleThreeServiceRecordActivity` → `GetServiceOrder` |
| default | — | `submitService` with extras `third_service_title_name`, `third_service_type_data` |

Order statuses (`MyHistoryOrderDetailActivity`): `0/1` new-accepted (cancellable), `2` finished
(`order_cannot_cancel_tips`), `3` waiting-to-cancel (`order_repeat_cancel_tips`), `4` cancelled (`order_canceled_tips`).

### In-player advertising (`LivePlayerWithEpgActivity`, gated by `Settings.activeAdv`)
`playTV(i)` → if `activeAdv` and `LiveTV.liveType != 1`: `programPlayType = 2` and `getAdListData(liveId)`.
`GetNextAdv` callback (`$6`): `status == 200` → `advVideoCanSkip = resource.allowSkip`, `adVideoProgramId = resource.id`,
`advVideoUrl = sp.getIPAddress() + <path with every segment URL-encoded>` → `startPlayAdvVideo()`.
`onPrepared` → `adVideoTimeRemains = duration/1000` → `startAdTimesTimer()` shows `ll_adv_video_times_remains` /
`txt_adv_video_times_remains` with `ad_video_time_remains` = `"{0}S│Ad countdown"`, decremented every second.
`onKeyDown` while `programPlayType == 2`: only BACK(4)/VOLUME_UP(24)/VOLUME_DOWN(25) reach the normal handler, every other
key skips the advert **iff** `advVideoCanSkip` → `adVideoPrgPlayComplete = 2`, `AddAdvHistory(type=2)`, then `startPlay(playUrl)`.
`onCompletion` (`$9`) → `adVideoPrgPlayComplete = 1`, `AddAdvHistory(type=2)`, `startPlay(playUrl)`.
Switching channel while a live programme is playing → `AddAdvHistory(type=1, time = now - startPlayTimemills)`.
Advert art is served from `res/adv/…`; the 48 new `mipmap/aNNN.png` images in v2 are those advert creatives.

### Boot advert video (`BootVideoActivity`, gated by `Settings.advVideoEM`)
`PingServerActivity.openWelcomeActivity(settings.isAdvVideoEM(), layout)` → when the flag is set the boot goes to
`BootVideoActivity` **before** any welcome screen; otherwise straight to `WelcomeStyleOtherActivity`
(`app_layout_style != 0 && != 5`) or `WelcomeStyleZeroActivity`.
* `initData()`: `playerFlag = settings.getPlayerFlag() + 1`, then `getWelcomeVideo()` =
  `getUrl("GetAdvVideoEM") + "?mac=" + IptvUtil.getMacAddress()` through `HttpUtil.sendOkHttpRequest`.
* `$1.onResponse` → `Gson` into `List<String>`; **null/empty ⇒ `enterWelcomeActivity()` immediately**. Otherwise every
  entry that is non-empty and contains a `/` that is not the last character is kept, with only the final segment
  `URLEncoder.encode`d, then `playWelcomeVideo()` → `setVideoPath(getUrl(strings.get(0)), playerFlag)` on
  `boot_my_ijkplayer_view` (`isHi3798Box` — `BRAND == "Fiberhome" && Build.ID == "2.337237.04"` — forces flag 2).
* `onCompletion` **or** `onError` → `enterWelcomeActivity()`; `onKeyDown`: **any key except VOLUME_UP(24)/VOLUME_DOWN(25)**
  → `enterWelcomeActivity()`. `isLeave` guarantees the transition happens once; it re-reads
  `settings.getLayout()` into `app_layout_style` and then starts `WelcomeStyleOther`/`WelcomeStyleZero` and `finish()`es.
* `onPause` pauses, `onResume` restarts, `onDestroy` does `stopPlayback()` + `release(1)`.

The welcome screen itself then re-uses the same endpoint: `initData()` calls
`settings.isAdvVideoEM() ? playPptBGImage() : getWelcomeVideo()`, i.e. with the boot advert enabled the welcome
background is the `GetAdvImage?type=1` slideshow, otherwise the `GetAdvVideoEM` clips play behind the welcome card —
`playWelcomeVideo(0)` first, a **random** clip on each completion, and on error `isPlayVideo = false` + the slideshow.
`playMusicLoop()` (from `apk/getClientBackgroundMusics`) and `getManagerSignImg()` (`type=12`) run in both cases.

### VLC external playback (`LivePlayerActivity.playWithVlc`)
`Intent(ACTION_VIEW)`, `data = url`, `type = "video/*"`, `setPackage("org.videolan.vlc")`, extras `title`, `from_start = 1`;
if the package is missing → toast `vlc_player_install_tips`. Setting `vlc_decode_value` entries: `not_enabled`, `enable_vlc`.

### Local-app launcher (`SettingAppShowActivity`)
SQLite `app.db` v1, table `app(_id, package_name, name)`; `database.DeviceHelper` + `DeviceOperation.addApp/deleteApp/clearUser`.
`MainStyleFourthActivity` renders third-app tiles with `type 55` and icon path `"../res/client/apk/" + icon`.
`PingServerActivity` additionally handles TCL sets (`MANUFACTURER == "TCL Multimedia" && DEVICE == "ak30a5"`), the action
`action.tvcustomer.api`, a SIP launcher `com.lao.dx.sip.phone`, and expects cert SHA-1 `7959DA145657340AE4A3387C9E70953F9FFA4320`.

### Resources added in v2 (all extracted to `windows_app/app_assets/img/`, index now 490 entries)
* **mipmap +51**: 48 advertisement art images (`aNNN`), `ic_launcher_new`, `pic_style_three_search_service`, `pic_style_three_taxi_service`.
* **drawable +15**: `anim_loading`, `loading1…loading8` (the buffering animation), `bg_app_grid_item_default`,
  `bg_epg_detail_popup_win`, `icon`, `selector_country_catering*`.
* **layout +23**: `activity_app_show_setting`, `activity_catering_country_selecter`, `activity_live_player_ijk_with_epg`,
  `activity_my_history_order_detail`, `activity_my_history_order_list`, `activity_record_epg_new`,
  `popup_window_ebg_detail`, `layout_dialog_del_history_order`, …
* **id +30**: `txt_play_speed`, `vlc_decode_value`, `setting_app_shows`, `epg_detail_title/content/item_layout`,
  `dialog_order_cancel/commit`, `prog_epg_list_view`, …
* **Bilingual beans**: `name_1` (second language) added to `CateringCategory`, `Food`, `LivePackage`, `MusicType`,
  `RentThings`, `StyleThree*`, `VideoPoster`, `VodType`; `content_1` added to `Food`, `HotelIntroSinglePage`, `TextAd`.
  The Windows UI resolves these through one helper (`nm()`), honouring `select_language_flag`.

## 7.2 How each delta was implemented in the Windows port

| APK feature | Windows implementation |
|---|---|
| version 2.7.2.06 / 20702006 | `iptv_backend.APP_VERSION`, `/api/config.version_code`, mock `GetVersion`, installer `DisplayVersion` |
| `IptvSP` → MMKV, new keys | `Settings.DEFAULTS` + `app_layout_style`, `use_vlc_paly_live_prg`, `autostart`, `selected_apps`, `play_speed` (JSON file store) |
| `GetLiveEPG` + EPG player | `/api/call?ep=live_epg&liveId=` → `#epg-panel` (key `E`), now-playing/timeshift tags, `#epg-detail` popup (key `I`), timeshift playback through `GetEpgRecProgram` |
| `caterSub` country selector | `#scr-country` → `GetFoodType` then `GetFoodType?parentId=` |
| order history + cancel | `#scr-orders` (basket → `AddFoodOrder countAndIds=…`, history → `GetFoodOrder`), `#order-detail` with `AddFoodOrder cFlag=1&id=…` and the exact APK status texts |
| taxi / service record / checkout | `#scr-service` rebuilt from `GetServiceIcon` with the id map above; `#scr-svcrecord` from `GetServiceOrder`; `AddClientCheckOutOrder` behind a confirm dialog |
| `GetClothingType` | laundry tile (id 3) now uses `clothing_type`; borrow-things (id 2) keeps `GetGoods` |
| wake-up + taxi time picker | `AddGoodsOrder?typeId={4|7}&wakeupTime={ms}`, future-time validation |
| `txt_play_speed` | key `S` / OSD speed button / settings row, persisted as `play_speed` |
| `playWithVlc` | `/api/external_player` → `ACTION_VIEW`-equivalent launch of `org.videolan.vlc`; missing VLC shows `vlc_player_install_tips` and internal playback continues |
| `SettingAppShowActivity` / `app.db` | `/api/apps` (list installed Windows apps, add/remove custom, toggle selection → `_userdata/apps.json`), `/api/launch`, tiles injected into the home menu when `appShowInMenu` is on |
| `BootReceiver` | `/api/autostart` writes the `HKCU\…\Run` entry on Windows (stored-only elsewhere), toggled from Settings |
| `loading1..8` | the APK's own buffering animation in `#load-anim` |
| `name_1`/`content_1` bilingual beans | `nm()` helper used by every list/detail renderer |
| strings 343→419 (fa 231→305) | `web/i18n.generated.js` regenerated → **245 keys** × zh/en/fa (41 keys from the new APK strings, 8 updated, plus 16 UI-only keys such as the order-status labels); the new fa placeholders that ship as English in the APK were replaced with real Persian. Every `t("…")` / `data-i18n` key used by the UI resolves — verified by script (0 missing). A later locale audit against `values-zh` / `values-fa` repaired **162 zh cells** that had fallen back to English and translated **43 guest-facing keys** the vendor left in English in `values-fa` (pure debug/technical keys — `app_name`, `mi__selected_*`, `load_cost`, `seek_cost`, `sample`, `miracast` — keep the APK text verbatim). |
| `GetRecTV` + `GetEpgRecProgram` | playback screen: channels → dates → programmes |
| in-player advertising | `get_next_adv` / `add_adv_history` / `adv_image?type=3` in the backend; `#ad-countdown` overlay with the APK's `ad_video_time_remains` text, skip-on-any-key when `allowSkip`, `AddAdvHistory` type 1 (live watch time) and type 2 (`check` 1 finished / 2 skipped), advert image in the watermark slot |
| boot advert video (`BootVideoActivity`) | `get_adv_video_em` in the backend (`/api/call?ep=adv_video_em`); new full-screen `#scr-bootvideo` with `#boot-video`. `boot()` mirrors `PingServerActivity`: `settings.advVideoEM` → boot video → welcome/home. `sanitiseAdvPaths()` applies the APK's filter (non-empty, `/` not last) and encodes only the final segment; `iptvUrl()` is `IptvSP.getUrl()`; completion **or** error → welcome; **every key except ↑/↓** (the port's volume keys = VOLUME_UP/DOWN) leaves the screen; `S.bootLeft` is `isLeave` |
| welcome background advertising | `advVideoEM` → `GetAdvImage?type=1` slideshow in `#wel-ppt` (5 s a page, fade, no rotation for one page); otherwise the `GetAdvVideoEM` clips loop in `#wel-video` (first clip, then a random one, error → slideshow). `#wel-sign` shows a random `type=12` image, `#bg-music` loops `res/adv/music/<BGMusicBean.url>` from `apk/getClientBackgroundMusics`. All of it is torn down by `onEnter()` when the welcome screen is left |
| browser autoplay policy | `install/launch.ps1` adds `--autoplay-policy=no-user-gesture-required` to the Edge app window, `tryPlay()` retries muted if a gesture is still required, and a stall guard (3.5 s + 2.5 s muted retry) treats a clip that never starts as the APK's `onError` case and moves on to the welcome screen, so a boot advert can never be silently dropped nor strand the guest on a black screen |

## 7.3 Verification of the v2 build

* `curl` against the running backend: `/api/config` reports `2.7.2.06` / `20702006` with the new defaults;
  `live_epg`, `service_order`, `clothing_type`, `food_type` (+`parentId=10`), `food_order`, `service_icon`, `rec_tv`,
  `/api/apps`, `/api/autostart` all return the expected shapes; `add_goods_order?typeId=7` appends a taxi order;
  `add_food_order {cFlag:1,id:5001}` flips that order to status 3; `/api/external_player` answers `not_installed`
  when VLC is absent.
* `tools/mock_iptv_server.py` implements every new/changed endpoint (GET and POST through one `_route()`), so the UI can
  be exercised end-to-end without the hotel server.
* `curl`: `ep=next_adv&liveId=1` returns the advert bean (`status 200`, `resource.url=/iptv2/vod/ad.mp4`, `allowSkip`),
  `liveId=3` returns `status 0`; `ep=adv_image&type=3` returns five `res/adv/aNNN.png` creatives that `/api/img` serves
  from the extracted APK assets; `add_adv_history` returns `{"status":200}` and the mock records the report.
* `tools/smoke/smoke.js` (jsdom) walks boot → language → home → live → packages → player → VOD → detail → settings gate
  **plus the v2 flows**: VLC/speed/autostart/apps rows, apps screen, EPG panel + detail + timeshift, speed key,
  catering country → types → basket → orders → submit → detail → cancel, service record, one-key checkout confirm,
  taxi time picker, laundry (`GetClothingType`), playback screen, and the pre-roll advert (overlay appears with the
  Persian countdown, a key skips it, playback returns to the channel) — **0 errors**.
* `curl`: `ep=adv_video_em` returns `["vod/boot.mp4","vod/welcome.mp4"]` (paths relative to `/iptv2/`, as `getUrl()`
  expects); `ep=adv_image&type=1` returns the three welcome-slideshow creatives and `type=12` the manager signature;
  `ep=bg_musics` returns one `BGMusicBean`. The mock serves `/iptv2/vod/boot.mp4` (4.7 MB), `/iptv2/vod/welcome.mp4`,
  `/iptv2/res/adv/music/welcome.mp3` (`audio/mpeg`) and, through the port's own proxy,
  `/stream/play?src=…boot.mp4` → `200 video/mp4`.
* `tools/smoke/smoke.js` (jsdom) now also asserts the boot path: after `boot()` the active screen is **`scr-bootvideo`**
  with `#boot-video` sourced from `GetAdvVideoEM[0]`, an **↑ (volume) key does not leave it**, Enter continues to
  `scr-welcome`, and there the `type=1` slideshow, the `type=12` signature and the background music are all live while
  `#wel-video` stays hidden (`advVideoEM` on) — **0 errors**.
* Port-side defects found and fixed while verifying the boot-advert build:
  * `web/styles.css` had **no `[hidden]` rule**, so every overlay whose class sets `display:flex`
    (`.modal` on `#vod-detail`/`#order-detail`/`#input-modal`/`#confirm-modal`, `.epg-panel`, `.vol-osd`,
    `.player-osd`, `.ch-badge`, `.player-error`, `.tb-wifi`, `.tb-weather`, `.welcome-weather`) was painted
    on top of the screen even while carrying `hidden` — an author-level `display` beats the browser's own
    UA rule. `[hidden]{display:none !important;}` is now the **first** rule in the stylesheet and is
    repeated at the end (jsdom resolves the cascade by source order only and ignores `!important`, so the
    harness needs the trailing copy); `smoke.js` asserts both the rule's presence in `/web/styles.css` and
    that no hidden overlay computes to anything but `display:none`.
  * `install/launch.ps1` → `Ensure-FFmpeg` could never succeed: the hard-coded
    `files.pythonhosted.org/packages/source/i/imageio-ffmpeg/…-0.6.0-…whl` URL is the legacy **sdist**
    layout (a wheel lives under `/packages/<xx>/<hash>/…`, so it 404'd) and Windows PowerShell's
    `Expand-Archive` refuses any extension but `.zip`. It now queries the PyPI JSON API for the current
    `win_amd64` wheel (pinned `imageio_ffmpeg-0.8.1` as fallback), saves it as `.zip`, and creates
    `tools\` before copying `ffmpeg.exe` — without ffmpeg, RTSP/UDP/MPEG-TS channels silently do not play.
  * `install/Setup.bat` copied `app`, `tools`, `install`, `runtime` but **not `app_assets`**, so an
    installed app answered 404 for every icon/background (`iptv_backend._app_image` resolves
    `<install>\app_assets\img`).
* Distribution zip (hotel flavour, superseded by §8): `dist/PARDIK-SMART-IPTV-Win10-x64-2.7.2.06.zip`,
  515 entries, 12,370,993 bytes, sha256 `abd3b4a077b058d4fe0dad3e055b6b8c811c2f3d7ba24b8420206d300f049660`.

---

# 8. Residential deployment — Pardik IPTV for «Ronika Palace», Kahak

The supplied APKs are the **hotel/hospitality** flavour of Pardik's IPTV client: half of the
endpoint contract is room service, catering, folio and check-out. The product actually wanted
here is Pardik's **residential** IPTV for the Ronika Palace complex in Kahak: live **domestic
(IRIB)** and **satellite** channels from the complex head-end, reached over a **wired Ethernet**
LAN, with the **unit number** as the subscriber identity. Rather than fork the code base, the
port now carries both flavours behind one switch and ships the residential one.

## 8.1 The flavour switch

| Layer | Residential (default) | Hotel (`IPTV_MODE=hotel`) |
|---|---|---|
| `iptv_backend.APP_MODE` | `residential` | `hotel` |
| `BRANDING.product` / `title` | `PARDIK IPTV` | `PARDIK SMART IPTV` |
| `BRANDING.subtitle` | «مجتمع مسکونی رونیکا پالاس کوهک» | *(empty, as in the APK)* |
| `BRANDING.welcome` | «ساکنین محترم، خوش آمدید» | «میهمانان عزیز» |
| `BRANDING.unit_label` | «شماره واحد» / *Unit number* | «شماره اتاق» / *Room number* |
| `BRANDING.install_name` | `PARDIK IPTV - Ronika Palace Kahak` | `PARDIK SMART IPTV` |
| Menu tiles | live, VOD, playback, scenery, music, settings | + catering, room service, hotel intro, consumption bill |
| Screens | hotel screens blocked (`HOTEL_SCREENS`) | all screens reachable |
| Manager signature (`GetAdvImage?type=12`) | not shown | shown on the welcome screen |
| Installer shortcut / `DisplayName` | `PARDIK IPTV - Ronika Palace` | `PARDIK SMART IPTV` |

* `iptv_backend.py`: `APP_MODE = os.environ.get("IPTV_MODE", "residential")` (only `residential`/`hotel`
  are accepted) and a `BRANDING` dict per mode; `/api/config` returns `mode` and `branding`.
* `install/launch.ps1` reads `mode.txt` next to the launcher (`residential` or `hotel`, trimmed and
  lower-cased, anything else falls back to `residential`) and exports it as `IPTV_MODE` before starting
  the backend; `install/Setup.bat` copies `mode.txt` into the install root and derives the shortcut /
  uninstall `DisplayName` from it. `tools/build_package.sh` writes `mode.txt` into the staged copy and
  names the zip after the flavour (`MODE=hotel` reproduces the old package byte-for-byte in content).
* `web/app.js`: `applyBranding()` (called from `boot()` after `/api/config`) fills `document.title`,
  `#boot-title`, `#boot-brand`, `#home-title`, `#home-subtitle`, `#wel-guest`, `#wel-word`,
  `#wel-sign-label`, `#home-roomlabel` and `#set-room-label` from `S.branding`, so no screen name is
  hard-coded any more. `buildMenu()` drops the `dinner` / `service` / `hotel` / `consume` tiles unless
  `S.mode === "hotel"` (and `music` now honours `menuMusicVisible`), `loadManagerSign()` and the
  `#home-wifi` chip run hotel-only, and `HOTEL_SCREENS` =
  `[scr-dinner, scr-country, scr-orders, scr-service, scr-svcrecord, scr-rent, scr-wakeup, scr-consume, scr-hotel]`
  is checked in `onEnter()`, which bounces any attempt to reach those screens back to `scr-home`
  (so a stale link or an automated test cannot resurrect them).
* `web/index.html` / `web/styles.css`: `.boot-brand` and `.home-subtitle` carry the complex name on the
  boot and home screens; `#set-link` (device connection) and `#set-m3u` (channel list) are new settings
  rows; `#input-hint` gives the m3u dialog a second explanatory line. The `[hidden]{display:none
  !important;}` rule is still both the first and the last rule of the stylesheet (§7.3).

## 8.2 Wired-Ethernet identity (the MAC the head-end knows)

`IptvUtil.getMacAddress()` in the APK reads `/sys/class/net/eth0/address` and only then `wlan0`; every
platform call (`GetRoomInfo?mac=`, `GetAdvImage?mac=`, `GetNextAdv?mac=`, `AddAdvHistory?mac=`,
`GetServiceOrder?mac=`, the `dx-admin` WebSocket path) is keyed on it. A Windows port that reported the
first adapter it found would hand the head-end a different identity depending on boot order, so the port
mirrors the APK's preference explicitly:

* `detect_interfaces()` — Windows: `Get-NetAdapter -Physical | Select Name,InterfaceDescription,MacAddress,Status | ConvertTo-Json -Compress`
  run through `subprocess.run(..., CREATE_NO_WINDOW)`; Linux: `/sys/class/net/*/{address,operstate}`.
  Each adapter is classified with `WIFI_HINTS` (wireless / wi-fi / wifi / wlan / 802.11) against
  `WIRED_HINTS` (ethernet / gbe / gigabit / lan / realtek / atheros / intel …), giving
  `kind ∈ {ethernet, wifi, other}` plus `up`.
* `detect_network()` ranks `ethernet < wifi < other` and prefers an adapter that is up — i.e. **the
  cabled link wins**, exactly like `eth0` before `wlan0`. The result is cached in the module-level
  `NETWORK` and returned by `/api/config` as `network{mac,iface,kind,ip,wired}`;
  `GET /api/network` re-detects and persists it.
* `detect_mac()` = `NETWORK["mac"]` or `_mac_fallback()` (`uuid.getnode()`, else `02:00:00:00:00:00`,
  the same all-zeros-plus-locally-administered pattern the APK falls back to). `Settings.__init__`
  refreshes `device_mac` on every start unless the result is that fallback, and stores
  `device_iface` / `device_iface_kind` alongside it (new keys in `DEFAULTS`), so a swapped NIC or a
  re-cabled wall socket is picked up on the next launch and the UI can say which adapter it used.
* Settings → «اتصال دستگاه» prints e.g. `کابل شبکه (Ethernet) · eth0 · 10.21.0.47` and marks the value
  green (`.set-value.ok`) when the link is wired; «اتصال مجدد به سرور» now re-runs `GET /api/network`
  before reloading.

## 8.3 Channel source: `GetLiveTV` or an m3u playlist

A residential head-end frequently publishes its line-up as a plain playlist instead of answering
`GetLivePackage`/`GetLiveTV`, so the port accepts both:

* `iptv_backend`: `m3u_file()` (`_userdata/m3u.json`), `parse_m3u(text)` → one record per `#EXTINF`
  with `{id:"m3u-N", number:N, name, url, group (group-title), logo (tvg-logo)}`, `load_m3u()`,
  `save_m3u()`, `refresh_m3u()` (fetches `url` through `http_get`, 25 s, or reads `path`; caches the
  first 200 KB in `text`) and `m3u_public()` for the API. Routes: `GET /api/m3u`,
  `GET /api/m3u?refresh=1`, `POST /api/m3u {url|path|text, enabled}`; `/api/config` embeds
  `m3u{enabled,url,path,error,updated,count,groups}`.
* `web/app.js`: `openM3u()` (Settings row) asks for a URL or path, distinguishes `^https?://` from a
  local path, posts it, re-reads `/api/m3u` and toasts the channel count; selecting the row again while
  the playlist is on offers to switch it off through the generic confirm dialog. `m3uPackages()` turns
  the distinct `group-title` values into bouquets (`id = "m3u:<i>"`), `m3uChannel()` classifies each URL
  with the existing `classify()` helper (hls / http / rtsp …) so playback keeps using hls.js, native
  MP4 or the FFmpeg `/stream/play` remux exactly as for server channels, and `loadChannels()` serves the
  playlist when the requested package id is an `m3u:` one (or `-1` = all).
* Playlist channels are flagged `_m3u`, and the three platform-id-dependent paths skip them:
  `startAdCheck()` (no `liveId` for `GetNextAdv`), `pollEpg()` (no id for `GetLiveEPG`) and
  `reportLiveWatch()`/`S.liveWatch` (no ids for `AddAdvHistory`). Numbering, favourites, the side list,
  the OSD badge and the keys behave as usual.
* i18n: six port-only keys (`device_link`, `link_wired`, `link_wifi`, `m3u_source`, `m3u_source_hint`,
  `unit_number`) plus `channel_count` were appended to the regenerated `web/i18n.generated.js`
  (**252 keys** × en/fa/zh, no empty cells); `editSetting()` titles `iptv_room_number` as
  «شمارهٔ واحد» in residential mode and «شماره اتاق» in hotel mode.

## 8.4 Mock head-end, re-themed residential

`tools/mock_iptv_server.py` now serves the residential line-up instead of the hotel demo data:

* `PACKAGES` = «شبکه‌های داخلی» (ids 1–6) and «شبکه‌های ماهواره‌ای» (ids 7–10), `price 0` — the hotel
  flavour's paid package is gone; `channels()` returns IRIB TV1–4, News and Sport plus TRT World,
  France 24, Al Jazeera and DW, each with `name` (fa) / `name_1` (en) and a real playable stand-in
  (`test.ts`, `test.mp4`, `test.m3u8`, `boot.mp4`, `welcome.mp4`), `timeshift` on the IRIB channels.
  `ADV_LIVE_IDS` still covers ids 1–2, so the pre-roll advert path is exercised on «شبکه یک»/«شبکه دو».
* `GET /iptv2/residential/channels.m3u` publishes exactly that line-up as a UTF-8 `#EXTM3U` playlist
  (each `#EXTINF` carries `tvg-id`, `tvg-name` and the bouquet's `group-title`), which is what the
  client's m3u source is tested against.
* `CLIENT.hotelName` → «مجتمع مسکونی رونیکا پالاس کوهک» / *Ronika Palace Residential Complex, Kahak*,
  `wifiName` → `RONIKA-RESIDENTS`, VOD categories and `SCENERY` items are Persian/complex-themed
  (فیلم سینمایی، سریال؛ محوطهٔ مجتمع، استخر و سونا، سالن اجتماعات، پارکینگ طبقاتی).
  The hotel endpoints (`GetFoodType`, `AddFoodOrder`, `GetServiceIcon`, `GetClothingType`,
  `AddClientCheckOutOrder`, `GetWakeUp`, …) are **kept** so the hotel flavour stays testable.

## 8.5 Verification

* `curl`/`urllib` against the running pair (mock on `:8030`, backend on `:8787`): `/api/config` returns
  `mode=residential`, the Ronika branding, `network{mac:…, iface:"eth0", kind:"ethernet", wired:true}`
  and `m3u{enabled:false,…}`; `POST /api/m3u {url:"…/residential/channels.m3u", enabled:true}` parses
  **10 channels in 2 groups** with Persian `group-title` intact; `POST {enabled:false}` switches the
  source back; `GetLivePackage` / `GetLiveTV?packageId=1|2` return the two bouquets (6 + 4 channels).
* `tools/smoke/smoke.js` reads `mode` from `/api/config` and branches:
  * **residential** (default): the menu must contain no catering/service/hotel/bill tile, the home bar
    must read `PARDIK IPTV` + «مجتمع مسکونی رونیکا پالاس کوهک» and «شماره واحد» (not اتاق), the welcome
    must not address a guest, the manager signature must stay hidden, the bouquets must include
    «داخلی», the device-connection row must name a link, and the m3u flow is driven **through the UI**
    (dialog → hint → URL → row shows `● 10 کانال` → live TV lists the two playlist groups → the
    satellite bouquet starts a player on `/stream/play` with the OSD badge «تی‌آر‌تی ورلد» and **no**
    advert overlay → the row is switched off again). The hotel-platform flows are skipped. → **0 errors**.
  * **hotel** (`IPTV_MODE=hotel`): the full previous run — catering country → types → basket → orders →
    submit → detail → cancel, service record, one-key check-out confirm, taxi time picker, laundry
    (`GetClothingType`) — plus the room-service tile assertion. → **0 errors**.
* Both flavours were run back-to-back against the same mock head-end; the only shared state is
  `_userdata/m3u.json`, which the harness explicitly disables before the server-list assertions.

## 8.6 Distribution

* `tools/build_package.sh` → **`dist/PARDIK-IPTV-RonikaPalace-Kohak-Win10-x64-2.7.2.06.zip`**,
  516 entries, 12,388,306 bytes, sha256 `b0464201df3dd0739c68ed2cf546bd9aa33bda9ce9f46f1eeca35d49e1a0df68`
  (adds `mode.txt`, drops `_userdata/` and `__pycache__`). `MODE=hotel bash tools/build_package.sh`
  rebuilds `dist/PARDIK-SMART-IPTV-Win10-x64-2.7.2.06.zip` (516 entries, 12,388,300 bytes,
  sha256 `f81e8de8577219078094c0e86006af8b908e02f26cb0bde73fed38c1f4868650`) — the same code with
  `mode.txt` = `hotel`. The backend banner now names the flavour it started
  (`PARDIK IPTV - Ronika Palace Kahak backend on … (mode=residential)`).
* Docs rewritten for the residential product: `windows_app/README-FA.md` (Persian, primary — install,
  defaults, wired-Ethernet identity, both channel sources, controls, troubleshooting),
  `windows_app/README-EN.md`, root `README.md`.

## 8.7 Will live TV play after the install? (`GET /api/diagnose`)

The residential question is not "does the UI work" but "will the cabled channels
actually play on this PC", and five separate things can break that. `diagnose()`
in `iptv_backend.py` tests them in order and stops early, so the answer costs 4 s
when the head-end is simply not there instead of three 8 s HTTP timeouts:

| # | Check | How | Failure hint |
|---|---|---|---|
| 1 | `network_adapter` | `detect_interfaces()` → MAC/iface/kind | check the cable |
| — | `wired_link` | `NETWORK["wired"]` | prefer Ethernet, then "reconnect to server" |
| — | `ip_address` | `169.254.*` means no DHCP answer on the complex LAN | talk to the building admin / set a static IP |
| 2 | `tcp_head_end` | `socket.create_connection((server_ip, server_port), 4)` | enter the real head-end IP/port — the APK's factory `10.21.0.10:8030` may not be this network's |
| 3 | `get_settings` | `GetSettings` → reports `protocol`, `showPackage`, `epg`, `activeAdv` | the `iptv2` service is not answering |
| 4 | `get_live_tv` | `GetLivePackage` + `GetLiveTV?mac=` → channel/bouquet counts and six `sample_channels` with their source kind | the head-end returned nothing for this MAC/unit → register the device in Pardik's panel, or use an m3u playlist |
| 5 | `ffmpeg` | `find_ffmpeg()` (`IPTV_FFMPEG`, `<install>\tools\ffmpeg{,.exe}`, `PATH`) — only checked when a source is rtsp/udp/mpegts or `Settings.protocol` is rtsp/udp | drop `ffmpeg.exe` into `tools\` by hand on an offline LAN |
| — | `m3u` | `m3u_public(load_m3u())` when the playlist source is enabled | the playlist could not be read (error text included) |

`chk()` only reports a hint when the check fails, so a green line never reads like
a problem; `ok`/`issues[]` summarise the run. The UI reaches it from
Settings → **«بررسی پخش زنده»** (`runDiagnose()` in `app.js` renders the checks in
the existing input dialog plus a `≡` sample-channel block, and the row itself
keeps the verdict: `✓ آماده` / `✗ n`). `closeDiag()` restores the dialog for the
m3u and `data-edit` rows, which reuse the same modal. Two read-only rows next to it
keep the facts visible without running anything: **«هداند»**
(`http://ip:port · RTSP 554 · GetLiveTV|m3u (n)`, i.e. which source is in use) and
**«FFmpeg (کانال‌های RTSP/TS)»** (`✓ آماده` / `✗ یافت نشد`).

Two playback guarantees that came out of writing this check:

* `pickSource()` honours the head-end's `Settings.protocol`, but when the chosen
  source needs the local FFmpeg remux and `ffmpeg.exe` is missing it now falls
  back to the same channel's `hlsUrl`/`httpUrl` before giving up; if there is no
  playable source left, `playItem()` arms the badge, EPG poll and pre-roll advert
  as usual and *then* prints `ffmpeg_missing_long` («این کانال برای پخش به FFmpeg
  نیاز دارد…») instead of a black screen with the APK's generic
  `decoding_video_failed`.
* Booting never hangs on an unreachable head-end either: the handshake now runs
  in the backend as `ConnectionEngine` (§9), the UI polls `/api/connection`
  instead of blocking, and `PingServerActivity`'s own escape hatches are
  reproduced — any key on the boot screen skips the wait, and Settings keeps a
  **«جست‌وجوی هداند»** row that re-runs discovery + the subnet sweep so a wrong
  IP can be fixed without the server being reachable.

`tools/smoke/smoke.js` runs the check through the UI in both flavours (dialog
opens, ≥1 row, the `GetLiveTV` and head-end rows are present, the verdict button
loses its `data-i18n`, closing removes `#diag-list` and restores the button, the
m3u dialog still gets a visible text input afterwards) and asserts that after a
skipped pre-roll advert the channel either has a `stream/play`/`proxy` source or
the player states the FFmpeg reason — **0 errors** for `residential` and `hotel`.

---

# 9. The connection engine — `BaseApplication` + `PingServerActivity` ported verbatim

The first Windows build invented its own boot sequence (six `GetSettings` polls
and no notion of "connected"), so the app started but never entered live TV on a
real head-end. Section 9 documents the corrected implementation: every step below
is a line-for-line port of the v2 APK, and the class/method it came from is named
in the source comments of `windows_app/app/iptv_backend.py`
(`ServerDiscovery`, `ConnectionEngine`, `CONNECTION`) and
`windows_app/app/web/app.js` (`enterPingServer`, `pollConnection`,
`applyConnection`, `openWelcomeActivity`, `enterMain`).

## 9.1 What the APK actually does

`IptvConfig`: `DEFAULT_SERVER_IP = "10.21.0.10"`, port `8030`, rtsp `554`,
`WEBSERVICE_PATH = "/iptv2/"`, `IMAGE_PATH = "/iptv2/manager/"`,
`VOD_PATH = "/iptv2/vod/"`. `IptvSP` defaults: `password = 111999`,
`app_layout_style = 0`, `select_language_flag = 1`, `server_language_flag = 3`,
`scroll_duration_time = 60000`.

`BaseApplication.onCreate()` → `getPmsStatus()` → `getClientFromServer()` →
`getDataFromServer()` → `startServerIpThread()` → `getTimeFromServer()` →
`timer($1, 2000, 5000)`. Inside `$1`, `times % 2 == 0` calls
`GetInStream?mac=` and `times ∈ {0, 5}` resets the counters and re-reads client +
data.

`connected` is only ever set by four callbacks: `$9` (`GetSettings`),
`$7` (`GetClient`), `$4` (`GetRoomInfo`) and `$6` (`UpdateClient`);
`$9.onFailure` sets it back to false. `$9` also stores `isGetPmsData =
pmsType != 0` and the language flags.

`startServerIpThread()` (`BaseApplication$3`) opens `DatagramSocket(27777)` with
`setSoTimeout(20000)`. A timeout bumps `serverIpTimes` (capped at 180) and
respawns the listener. A datagram of ≤ 512 bytes is decoded as UTF-8 and parsed
by Gson into `ServerIpAddrBean{ip, port}`; the announcement is adopted only when
`IpaddressCheck.checkIpaddress(ip)` and `0 < port < 65536`.

`PingServerActivity` runs `Timer($2, 0, 2000)`: while `times != 20` it retries
`GetSettings`; at `times == 20` it calls `openWelcomeActivity(false, 0)`, and any
key press leaves the screen early. `openWelcomeActivity(advVideoEM, layout)` goes
to `BootVideoActivity` when `advVideoEM` is set, then to
`WelcomeStyleZeroActivity` for `layout == 0` and `WelcomeStyleOtherActivity`
otherwise. Language flags: 1 = en, 2/3 = zh, **8/9 = fa**, 12/13 = ar, 16/17 = ru,
35 = tr.

## 9.2 How the port reproduces it

| APK | Port |
|---|---|
| `BaseApplication.onCreate()` chain | `ConnectionEngine.on_create()`, called from `main()` before the HTTP server listens |
| `$9/$7/$4/$6` → `connected` | `get_settings_from_server()`, `get_client_from_server()`, `get_room_info()`, `update_client()`; each sets/clears `self.connected` exactly as its callback does |
| `timer($1, 2000, 5000)` | `app_loop()` + `app_tick()` with `APP_TIMER_DELAY = 2`, `APP_TIMER_PERIOD = 5` and the same `times % 2` / `times ∈ {0, 5}` branches |
| `BaseApplication$3` UDP listener | `ServerDiscovery` (`DISCOVERY_PORT` = 27777, overridable with `IPTV_DISCOVERY_PORT`; `DISCOVERY_TIMEOUT = 20`; `DISCOVERY_MAX_THREADS = 180`; the same Gson-JSON payload and the same `checkIpaddress` + port validation) |
| `PingServerActivity.$2` | `ping_loop()` / `ping_tick()` / `ping_get_settings_from_server()` — `PING_MAX_ATTEMPTS = 20` at `PING_INTERVAL = 2` s, then `open_welcome()` |
| `openWelcomeActivity(advVideoEM, layout)` | `open_welcome()` → `state()["welcome"] = {advVideoEM, layout, language, screen, connected, main}` |
| `WebSocketService` | `WsClient` / `WsManager` on `ws://{ip:port}/dx-admin/websocket/{mac}`, `dealPrgData` 1 = live voice, 2 = vod, 3 = volume |
| the screen itself | `#scr-boot` = `activity_ping_server` (`res/U0.xml`): ProgressBar over `@drawable/progress_bg`, `#ping-text` = `connecting_server_tips`, `#ping-tips` = `welcome_alert`, background from `GetAdvImage?type=11` |

`state()` publishes the whole engine so the UI never guesses:
`{connected, phase (boot → ping → welcome → main), ping_times, ping_max, welcome,
server{ip, port, address, is_factory_default}, unit, server_room_num, client,
settings_ok, pms_type, layout, enter_live_page, need_cheek_in, enabled,
adv_video_em, skip_welcome_page, ping_bg, server_settings, cur_playing,
server_time, time_zone, last_error, last_ok, uptime, discovery, sweep,
sweep_log[25], log[40], ws{prg, vol}}`, reachable at `GET /api/connection` and
driven by `POST /api/connection/{retry,skip,sweep,announce,playing}`.

Because the UI and the engine are now separate processes (as the APK's activity
and `BaseApplication` are), `app.js` re-reads `/api/connection` every 5 s outside
the boot screen and every 700 ms on it. That is what makes
`MainStyleThirdActivity.isConnectServer()` honest: a head-end that disappears
after the menu is up still produces the `status_disconnected` toast («سرور قطع
شد!») instead of opening a dead player.

`sweep_for_head_end()` is the port's extra safety net (not in the APK, off unless
`IPTV_SWEEP` is set): stored IP → `10.21.0.10` → `other_server_ip` → the default
gateway → `x.y.z.1` → `x.y.z.254` → the whole /24 in 64-thread chunks, accepting
only a host whose `/iptv2/GetSettings` returns a non-empty object.

## 9.3 Verification

`tools/mock_iptv_server.py` answers the full contract (`GetSettings`,
`GetClient`, `GetRoomInfo`, `UpdateClient`, `GetCurrentTimeAndZone`,
`GetHomepageIcon`, `GetWelcomWord`, `GetAdvImage` types 0/1/2/11/12/17,
`GetAdvVideoEM`, `apk/getWeatherDays`, `apk/getClientBackgroundMusics`,
`apk/getClientBackgroundVideos`, `GetLivePackage`, `GetLiveTV`, `GetAPK`) and can
replay the UDP announcement with `/mock/announce?on=1`, which is how the
`BaseApplication$3` leg is proved rather than assumed.

`tools/smoke/smoke.js` drives the real UI in jsdom and asserts, in order: the
boot screen is `PingServerActivity` with `@mipmap/pic_ping_bg`; `/api/connection`
reports `connected`, `settings_ok`, `ping_times/ping_max`, the UDP listener bound
**and** an adopted `ServerIpAddrBean`; the welcome payload names a main activity;
`activity_welcome` renders the 900×450 card with `@mipmap/bg_welcome`, the type-17
title image, the manager signature, the guest word with `%s%` substituted, the
clock, the Persian date and the three-day forecast; `MainStyleThirdActivity`
renders the `GetHomepageIcon` tiles with the `icon` ↔ `iconFocus` swap, the room
name from `Client.name`, Wi-Fi, weather, the `indexArea == 1` banner, and opens
Settings only on the `111999` digit buffer; live TV opens the bouquets; and a
deliberately unreachable head-end keeps the user on the menu with
`status_disconnected` until `/api/connection/skip` is used. Latest run:
**0 errors** in both `residential` and `hotel` modes.

