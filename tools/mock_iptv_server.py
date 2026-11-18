# -*- coding: utf-8 -*-
"""Mock of the PARDIK/DEXIN IPTV manager server (10.21.0.10:8030 contract).
Used ONLY for local testing of the Windows client. Not shipped behaviour."""
import json, os, time, re, subprocess, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
MEDIA = os.path.join(HERE, "mock_media")
os.makedirs(MEDIA, exist_ok=True)
PORT = 8030

NOW = lambda: int(time.time() * 1000)

SETTINGS = {
    # v2.7.2.06 Settings bean adds: epg, caterSub, tfPlayerFlag, appShowInMenu
    # and changes the built-in defaults layout 4 -> 0, trafficSaveMode 1 -> 0.
    "epg": True, "caterSub": True, "tfPlayerFlag": 0, "appShowInMenu": True,
    "serverIpAddress": "10.21.0.10",
    "protocol": "http", "playerFlag": 0, "layout": 0, "language": 1, "defaultLanguage": 1,
    "hotelName": "مجتمع مسکونی رونیکا پالاس کوهک", "hotelNameEn": "Ronika Palace Residential Complex, Kahak", "city": "Tehran",
    "phone": "021-0000000", "symbol": "$", "chargeMode": 1, "pmsType": 1, "timeout": 1,
    "pictureInterval": 8, "indexArea": 1, "vodFreeMinutes": 5, "apkUpdateType": 1,
    "showLogo": True, "showWeather": True, "showWaterMark": False, "showWaterMarkVod": False,
    "showWelcomeBackground": True, "skipWelcomePage": False, "enterLivePage": False,
    "needCheekIn": False, "showPackage": True, "showPackageStyle": 0, "changeChannelType": 0,
    "recordMode": 0, "timeshiftDays": 7, "timeshiftHours": 2,
    "timeshiftServerIp": "127.0.0.1", "timeshiftServerPort": 9090,
    "timeshiftPlayIp": "127.0.0.1", "timeshiftPlayPort": "8080",
    "timeshiftPlayPath": "/iptv2/vod", "timeshiftPlayProtocol": "http",
    "streamMediaIp": "", "streamMediaPort": 0, "trafficSaveMode": False,
    "activeAdv": True, "activeXiaodu": False, "advVideoEM": True, "cater": True,
    "checkOutCleanFavorite": False, "operatorNumber": "", "timeFormat": "HH:mm", "timeZone": "",
    "menuSceneryVisible": True, "menuRecVisible": True, "menuAppVisible": True,
    "menuCIBNVisible": False, "menuCaterVisible": True, "menuCheckOutVisible": True,
    "menuConsumeVisible": True, "menuHotelVisible": True, "menuRoomServiceVisible": True,
    "menuSystemVisible": True, "menuThirdAppVisible": False, "menuVodVisible": True,
    "menuiqiyiVisible": False, "menuTransparency": 80,
    "iconBgColor": "#000000", "iconBgOpacity": "0.3", "iconUnselectBgColor": "#000000", "iconUnselectBgOpacity": "0.0",
}

CLIENT = {
    "id": 1, "groupId": 1, "mac": "", "ip": "", "name": "Ronika", "enable": True, "online": True,
    "money": 0, "costSum": 0.0, "unfinishedOrderCount": 0, "versionCode": 20702006,
    "versionText": "2.7.2.06", "welcomeWord": "Ronika", "welcomeWordEn": "Ronika",
    "wifiName": "RONIKA-RESIDENTS", "wifiPassword": "ronika1234", "wifiStatus": 1,
    "wifiTips": "", "wifiTipsEn": "", "checkInTime": NOW(), "checkPerson": "guest",
    "timeZone": "", "timeMills": NOW(), "goods": [], "checked": False, "nrStatus": False,
}

# Pardik's residential deployment for Ronika Palace (Kahak): the head-end hands
# out two bouquets - the domestic (IRIB) channels and the satellite channels -
# instead of the hotel platform's paid packages.
PACKAGES = [
    {"id": 1, "number": 1, "name": "شبکه‌های داخلی", "name_1": "Domestic channels",
     "content": "شبکه‌های سراسری و استانی", "content_1": "National and provincial channels",
     "price": 0, "clientIds": "", "tvIds": "1,2,3,4,5,6", "imagePath": "",
     "nameVisible": True, "imageVisible": False},
    {"id": 2, "number": 2, "name": "شبکه‌های ماهواره‌ای", "name_1": "Satellite channels",
     "content": "بازپخش شبکه‌های ماهواره‌ای از هداند مجتمع", "content_1": "Satellite channels restreamed by the complex head-end",
     "price": 0, "clientIds": "", "tvIds": "7,8,9,10", "imagePath": "",
     "nameVisible": True, "imageVisible": False},
]


def _tv(i, name, num, proto_urls):
    d = {"id": i, "number": num, "name": name, "liveType": 0, "url": "", "rtspUrl": "", "httpUrl": "", "hlsUrl": "",
         "imagePath": "", "nameVisible": True, "imageVisible": False, "timeshift": False, "timeshifting": False, "tsStartTime": 0}
    d.update(proto_urls)
    return d


def channels():
    """The residential line-up. Only ids 1-2 carry a pre-roll advert (ADV_LIVE_IDS);
    the media files stand in for the real transport streams of the head-end."""
    base = "http://127.0.0.1:%d" % PORT
    vod = base + "/iptv2/vod/"
    def tv(i, fa, en, num, urls, ts=False):
        d = _tv(i, fa, num, urls)
        d["name_1"] = en
        d["timeshift"] = ts
        return d
    return [
        # --- domestic (IRIB) ---
        tv(1, "شبکه یک", "IRIB TV1", 1, {"httpUrl": vod + "test.ts", "rtspUrl": "rtsp://127.0.0.1:8554/live/1.sdp"}, ts=True),
        tv(2, "شبکه دو", "IRIB TV2", 2, {"httpUrl": vod + "test.mp4", "url": vod + "test.mp4"}, ts=True),
        tv(3, "شبکه سه", "IRIB TV3", 3, {"hlsUrl": vod + "test.m3u8"}, ts=True),
        tv(4, "شبکه چهار", "IRIB TV4", 4, {"httpUrl": vod + "boot.mp4"}),
        tv(5, "شبکه خبر", "IRIB News", 5, {"httpUrl": vod + "welcome.mp4"}),
        tv(6, "شبکه ورزش", "IRIB Sport", 6, {"httpUrl": vod + "test.ts"}, ts=True),
        # --- satellite, restreamed by the complex head-end ---
        tv(7, "تی‌آر‌تی ورلد", "TRT World", 7, {"httpUrl": vod + "test.mp4"}),
        tv(8, "فرانس ۲۴", "France 24", 8, {"hlsUrl": vod + "test.m3u8"}),
        tv(9, "الجزیره", "Al Jazeera", 9, {"httpUrl": vod + "test.ts"}),
        tv(10, "دویچه وله", "DW English", 10, {"httpUrl": vod + "welcome.mp4"}),
    ]


VOD_TYPES = [
    {"id": 1, "number": 1, "name": "فیلم سینمایی", "name_1": "Movies", "count": 2},
    {"id": 2, "number": 2, "name": "سریال", "name_1": "Series", "count": 1},
]
VOD = {
    1: [
        {"id": 11, "vodId": 11, "number": 1, "url": "http://127.0.0.1:%d/iptv2/vod/test.mp4" % PORT, "videoName": "Big Buck Bunny"},
        {"id": 12, "vodId": 12, "number": 2, "url": "http://127.0.0.1:%d/iptv2/vod/test.ts" % PORT, "videoName": "Sintel (TS)"},
    ],
    2: [
        {"id": 21, "vodId": 21, "number": 1, "url": "http://127.0.0.1:%d/iptv2/vod/test.mp4" % PORT, "videoName": "Episode 1"},
    ],
}
SCENERY = {"items": [
    {"id": 1, "name": "محوطهٔ مجتمع", "name_1": "Complex grounds", "imagePath": "res/scenery/lobby.jpg"},
    {"id": 2, "name": "استخر و سونا", "name_1": "Pool and sauna", "imagePath": "res/scenery/pool.jpg"},
    {"id": 3, "name": "سالن اجتماعات", "name_1": "Community hall", "imagePath": "res/scenery/lobby.jpg"},
    {"id": 4, "name": "پارکینگ طبقاتی", "name_1": "Parking", "imagePath": "res/scenery/pool.jpg"},
]}
# v2.7.2.06: GetFoodType returns catering COUNTRIES at the root and the food
# types of one country when called with ?parentId=
FOOD_COUNTRIES = [{"id": 10, "number": 1, "name": "ایران", "name_1": "Iran", "imagePath": ""},
                  {"id": 20, "number": 2, "name": "ایتالیا", "name_1": "Italy", "imagePath": ""}]
FOOD_TYPES_BY_COUNTRY = {
    10: [{"id": 1, "number": 1, "name": "غذای ایرانی", "name_1": "Iranian"},
         {"id": 3, "number": 2, "name": "کباب", "name_1": "Kebab"}],
    20: [{"id": 2, "number": 1, "name": "فست فود", "name_1": "Fast Food"}],
}
FOOD_TYPES = [{"id": 1, "name": "Iranian", "name_1": "Iranian"},
              {"id": 2, "name": "Fast Food", "name_1": "Fast Food"},
              {"id": 3, "name": "Kebab", "name_1": "Kebab"}]
FOOD = {
    1: [{"id": 101, "name": "Chelo Kebab", "price": 12, "imagePath": "res/food/kebab.jpg"}],
    2: [{"id": 201, "name": "Pizza", "price": 9, "imagePath": "res/food/pizza.jpg"}],
}
# v2.7.2.06: GetServiceIcon drives the room-service menu (ids 1..8)
SERVICE_ICONS = [
    {"id": 1, "number": 1, "chineseName": "清洁服务", "englishName": "Housekeeping", "image": ""},
    {"id": 2, "number": 2, "chineseName": "物品借用", "englishName": "Borrow things", "image": ""},
    {"id": 3, "number": 3, "chineseName": "洗衣服务", "englishName": "Laundry", "image": ""},
    {"id": 4, "number": 4, "chineseName": "叫醒服务", "englishName": "Wake up", "image": ""},
    {"id": 5, "number": 5, "chineseName": "账单", "englishName": "Bill", "image": ""},
    {"id": 6, "number": 6, "chineseName": "一键退房", "englishName": "Check out", "image": ""},
    {"id": 7, "number": 7, "chineseName": "出租车", "englishName": "Taxi", "image": ""},
    {"id": 8, "number": 8, "chineseName": "服务记录", "englishName": "Service record", "image": ""},
]
CLOTHING = [
    {"id": 31, "name": "شستشوی کت و شلوار", "name_1": "Suit wash", "price": 8, "imagePath": ""},
    {"id": 32, "name": "اتو", "name_1": "Ironing", "price": 3, "imagePath": ""},
]
SERVICE_NAME = {1: ("清洁服务", "Housekeeping"), 2: ("物品借用", "Borrow things"),
                3: ("洗衣服务", "Laundry"), 4: ("叫醒服务", "Wake up"),
                6: ("一键退房", "Check out"), 7: ("出租车", "Taxi")}
SERVICE_ORDERS = [
    {"id": 9001, "clientId": 1, "typeId": 4, "gId": 0, "gName": "", "gNameEn": "",
     "serviceName": "叫醒服务", "serviceNameEn": "Wake up", "status": 2,
     "orderTime": NOW() - 7200000, "preparedTime": NOW() - 7000000,
     "responseTime": NOW() - 6900000, "finishTime": NOW() - 6800000,
     "list": [{"id": 1, "name": "ساعت ۰۷:۰۰", "name_1": "07:00", "count": 1}]},
]
FOOD_ORDERS = [
    {"id": 1, "orderId": 5001, "foodId": 101, "count": 2, "status": 1,
     "food": {"id": 101, "name": "چلوکباب", "name_1": "Chelo Kebab", "price": 12,
              "content": "", "content_1": "", "imagePath": "res/food/kebab.jpg"}},
]
# v2.7.2.06 in-player advertising: GetNextAdv?mac=&liveId= ->
# List<LiveProgramAdvVideoBean>{status,msg,resource{id,name,url,allowSkip,countTime,...}}
# status 0 = no advert for this channel, 200 = play resource.url before the channel.
ADV_VIDEO = {
    "id": 7001, "name": "Ronika Palace advert", "url": "/iptv2/vod/ad.mp4",
    "allowSkip": True, "count": 1, "countCheck": 0, "countTime": "6",
    "size": 0, "checked": True, "remark": "",
}
ADV_LIVE_IDS = (1, 2)          # only these channels carry a pre-roll advert
ADV_IMAGES = ["res/adv/a113.png", "res/adv/a116.png", "res/adv/a119.png",
              "res/adv/a122.png", "res/adv/a143.png"]
ADV_HISTORY = []

# v2.7.2.06 boot advertising (WebTag.TAG_BOOT_VIDEO = "GetAdvVideoEM").
# Paths are relative to /iptv2/ (IptvSP.getUrl). BootVideoActivity plays entry 0
# full screen before the welcome screen when settings.advVideoEM is true;
# WelcomeStyleZero/OtherActivity plays a random entry as the welcome background
# (and the GetAdvImage?type=1 slideshow) when it is false.
ADV_BOOT_VIDEOS = ["vod/boot.mp4", "vod/welcome.mp4"]
ADV_BG_IMAGES = ["res/adv/a113.png", "res/adv/a116.png", "res/adv/a119.png"]   # type=1 welcome PPT
ADV_SIGN_IMAGES = ["res/adv/a122.png"]                                          # type=12 manager sign
# apk/getClientBackgroundMusics -> List<BGMusicBean>{url,description}; the file is
# fetched from res/adv/music/<url> and looped behind the welcome screen.
BG_MUSICS = [{"url": "welcome.mp3", "description": "Welcome lounge music"}]

EPG_PROGRAMS = {}


def epg_for(live_id):
    """GetLiveEPG?liveId= -> List<LiveProgEpgDataBean>"""
    now = NOW()
    hour = 3600000
    out = []
    titles = [("خبر", "News"), ("فیلم سینمایی", "Movie"), ("مستند", "Documentary"),
              ("ورزشی", "Sport"), ("سریال", "Series")]
    for i in range(6):
        start = now - (2 - i) * hour
        end = start + hour
        zh, en = titles[i % len(titles)]
        out.append({"id": live_id * 100 + i, "liveId": live_id,
                    "program": zh + " " + str(i + 1), "content": en + " #" + str(i + 1),
                    "date": time.strftime("%Y-%m-%d", time.localtime(start / 1000)),
                    "startTime": time.strftime("%H:%M", time.localtime(start / 1000)),
                    "endTime": time.strftime("%H:%M", time.localtime(end / 1000)),
                    "playing": start <= now < end,
                    "timeshift": end <= now and i >= 1})
    return out


GOODS = [{"id": 1, "name": "Extra Towel", "price": 2, "imagePath": ""}, {"id": 2, "name": "Iron", "price": 0, "imagePath": ""}]
HOTEL = {"items": [
    {"id": 1, "name": "About Us", "content": "Ronika Palace, Koohak", "imagePath": ""},
    {"id": 2, "name": "Facilities", "content": "Pool, Gym, Spa", "imagePath": ""},
]}
MUSIC_CATS = [{"id": 1, "name": "Pop"}, {"id": 2, "name": "Classic"}]
MUSIC = {1: [{"id": 1, "name": "Track 1", "url": "http://127.0.0.1:%d/iptv2/vod/test.mp4" % PORT}],
         2: [{"id": 2, "name": "Track 2", "url": "http://127.0.0.1:%d/iptv2/vod/test.mp4" % PORT}]}
HOMEPAGE = [
    {"id": 1, "number": 1, "type": 1, "enabled": True, "icon": "", "icon1": "", "packageName": "live",
     "chineseName": "直播", "englishName": "LIVE", "japaneseName": "", "koreanName": "", "russianName": "", "thaiName": ""},
    {"id": 2, "number": 2, "type": 2, "enabled": True, "packageName": "vod", "englishName": "VOD", "chineseName": "点播"},
]
WEATHER = {"data": {"now": {"temp": 18, "text": "Clear"}, "forecast": []}}
VERSION = {"versionCode": 20702006, "versionName": "2.7.2.06", "name": "PARDIK", "url": "", "length": 0, "time": ""}


def ensure_media():
    ff = os.path.join(HERE, "..", ".tools", "iio", "imageio_ffmpeg", "binaries")
    ffmpeg = None
    if os.path.isdir(ff):
        for f in os.listdir(ff):
            if f.startswith("ffmpeg-linux"):
                ffmpeg = os.path.join(ff, f)
    if not ffmpeg:
        ffmpeg = "ffmpeg"
    mp4 = os.path.join(MEDIA, "test.mp4")
    ts = os.path.join(MEDIA, "test.ts")
    if not os.path.exists(mp4):
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                        "testsrc=size=640x360:rate=25:duration=20", "-f", "lavfi", "-i",
                        "sine=frequency=440:duration=20", "-c:v", "libx264", "-preset", "ultrafast",
                        "-c:a", "aac", mp4], check=True)
    if not os.path.exists(ts):
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                        "testsrc=size=640x360:rate=25:duration=20", "-f", "lavfi", "-i",
                        "sine=frequency=330:duration=20", "-c:v", "libx264", "-preset", "ultrafast",
                        "-c:a", "aac", "-f", "mpegts", ts], check=True)
    # a short advert clip for GetNextAdv (v2.7.2.06 in-player advertising)
    ad = os.path.join(MEDIA, "ad.mp4")
    if not os.path.exists(ad):
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                        "testsrc2=size=640x360:rate=25:duration=6", "-f", "lavfi", "-i",
                        "sine=frequency=880:duration=6", "-c:v", "libx264", "-preset", "ultrafast",
                        "-c:a", "aac", ad], check=True)
    # boot / welcome advert clips for GetAdvVideoEM (BootVideoActivity)
    boot = os.path.join(MEDIA, "boot.mp4")
    if not os.path.exists(boot):
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                        "testsrc2=size=960x540:rate=25:duration=10", "-f", "lavfi", "-i",
                        "sine=frequency=660:duration=10", "-c:v", "libx264", "-preset", "ultrafast",
                        "-c:a", "aac", boot], check=True)
    welc = os.path.join(MEDIA, "welcome.mp4")
    if not os.path.exists(welc):
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                        "smptehdbars=size=960x540:rate=25:duration=12", "-f", "lavfi", "-i",
                        "sine=frequency=550:duration=12", "-c:v", "libx264", "-preset", "ultrafast",
                        "-c:a", "aac", welc], check=True)
    # res/adv/music/<name> - welcome background music (apk/getClientBackgroundMusics)
    mus = os.path.join(MEDIA, "adv_music.mp3")
    if not os.path.exists(mus):
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                        "sine=frequency=440:sample_rate=44100:duration=12", "-af",
                        "volume=0.22,afade=t=in:d=1,afade=t=out:st=10:d=2",
                        "-c:a", "libmp3lame", "-q:a", "7", mus], check=True)
    # HLS from the ts
    m3u8 = os.path.join(MEDIA, "test.m3u8")
    if not os.path.exists(m3u8):
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", ts, "-c", "copy",
                        "-f", "hls", "-hls_time", "4", "-hls_list_size", "0",
                        "-hls_segment_filename", os.path.join(MEDIA, "seg%03d.ts"), m3u8], check=True)


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _j(self, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def _file(self, path, ctype):
        if not os.path.isfile(path):
            self.send_response(404); self.send_header("Content-Length", "0"); self.end_headers(); return
        rng = self.headers.get("Range")
        size = os.path.getsize(path)
        start, end = 0, size - 1
        code = 200
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                code = 206
                start = int(m.group(1) or 0)
                end = int(m.group(2) or size - 1)
        with open(path, "rb") as f:
            f.seek(start)
            data = f.read(end - start + 1)
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        if code == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _route(self, p, q):
        if p == "/iptv2/manager/GetSettings":
            return self._j(SETTINGS)
        if p == "/iptv2/manager/GetClient":
            c = dict(CLIENT); c["mac"] = q.get("mac", [""])[0]; return self._j(c)
        if p == "/iptv2/manager/GetRoomInfo":
            c = dict(CLIENT); c["mac"] = q.get("mac", [""])[0]; return self._j(c)
        if p == "/iptv2/manager/UpdateClient":
            return self._j({"status": 200})
        if p == "/iptv2/manager/GetCurrentTimeAndZone":
            return self._j({"timeMills": NOW(), "timeZone": ""})
        if p == "/iptv2/manager/GetLivePackage":
            return self._j(PACKAGES)
        if p == "/iptv2/manager/GetLiveTV":
            pid = q.get("packageId", ["-1"])[0]
            chs = channels()
            if pid not in ("-1", ""):
                pkg = next((x for x in PACKAGES if str(x["id"]) == pid), None)
                if pkg and pkg["tvIds"]:
                    ids = set(int(x) for x in pkg["tvIds"].split(","))
                    chs = [c for c in chs if c["id"] in ids]
            return self._j(chs)
        if p == "/iptv2/manager/GetLiveStatus":
            return self._j(channels())
        if p == "/iptv2/manager/GetLiveStart":
            return self._j({"status": 1})
        if p == "/iptv2/manager/GetVodType":
            return self._j(VOD_TYPES)
        if p == "/iptv2/manager/GetVod":
            tid = q.get("typeId", [None])[0]
            return self._j(VOD.get(int(tid), VOD[1]) if tid else VOD[1])
        if p == "/iptv2/manager/GetVodUrl":
            return self._j({"url": VOD[1][0]["url"]})
        if p == "/iptv2/manager/AddVodRecord":
            return self._j({"status": 200})
        if p == "/iptv2/manager/UpdateVodClickRate":
            return self._j({"status": 200})
        if p == "/iptv2/manager/GetAdvImage":
            t = q.get("type", ["0"])[0]
            # type 3 = the image shown in the live player (random pick client-side)
            if t == "3":
                return self._j(ADV_IMAGES if SETTINGS.get("activeAdv") else [])
            # type 1 = welcome background slideshow, type 12 = manager signature
            if t == "1":
                return self._j(ADV_BG_IMAGES)
            if t == "12":
                return self._j(ADV_SIGN_IMAGES)
            return self._j([])
        if p == "/iptv2/manager/GetAdvVideoEM":
            # BootVideoActivity / welcome background video (List<String>)
            return self._j(ADV_BOOT_VIDEOS)
        if p == "/iptv2/manager/GetNextAdv":
            if not SETTINGS.get("activeAdv"):
                return self._j([{"status": 0, "msg": "", "resource": None}])
            lid = int(q.get("liveId", ["0"])[0] or 0)
            if lid in ADV_LIVE_IDS:
                return self._j([{"status": 200, "msg": "成功", "resource": ADV_VIDEO}])
            return self._j([{"status": 0, "msg": "", "resource": None}])
        if p == "/iptv2/manager/AddAdvHistory":
            ADV_HISTORY.append({"mac": q.get("mac", [""])[0], "id": q.get("id", ["0"])[0],
                                "type": q.get("type", ["0"])[0], "time": q.get("time", ["0"])[0],
                                "check": q.get("check", ["0"])[0], "at": NOW()})
            return self._j({"status": 200})
        if p == "/iptv2/manager/GetHomepageIcon":
            return self._j(HOMEPAGE)
        if p == "/iptv2/manager/GetServiceIcon":
            return self._j(SERVICE_ICONS)
        if p == "/iptv2/manager/GetScenery":
            return self._j(SCENERY)
        if p in ("/iptv2/manager/GetHotel", "/iptv2/manager/GetHotelInformation"):
            return self._j(HOTEL)
        if p == "/iptv2/manager/GetHotelType":
            return self._j([{"id": 1, "name": "General"}])
        if p == "/iptv2/manager/GetFoodType":
            parent = q.get("parentId", [None])[0]
            if parent in (None, "", "-1"):
                return self._j(FOOD_COUNTRIES)
            return self._j(FOOD_TYPES_BY_COUNTRY.get(int(parent), FOOD_TYPES))
        if p == "/iptv2/manager/GetFood":
            return self._j(FOOD.get(int(q.get("typeId", ["1"])[0]), []))
        if p == "/iptv2/manager/GetFoodOrder":
            return self._j({"list": FOOD_ORDERS})
        # ---- v2.7.2.06 endpoints ----
        if p == "/iptv2/manager/GetLiveEPG":
            return self._j(epg_for(int(q.get("liveId", ["1"])[0] or 1)))
        if p == "/iptv2/manager/GetServiceOrder":
            return self._j(SERVICE_ORDERS)
        if p == "/iptv2/manager/GetClothingType":
            return self._j(CLOTHING)
        if p == "/iptv2/manager/AddGoodsOrder":
            tid = int(q.get("typeId", ["0"])[0] or 0)
            wt = int(q.get("wakeupTime", ["0"])[0] or 0)
            zh, en = SERVICE_NAME.get(tid, ("服务", "Service"))
            when = time.strftime("%Y-%m-%d %H:%M", time.localtime(wt / 1000)) if wt else ""
            SERVICE_ORDERS.insert(0, {
                "id": 9100 + len(SERVICE_ORDERS), "clientId": 1, "typeId": tid,
                "gId": 0, "gName": "", "gNameEn": "", "serviceName": zh,
                "serviceNameEn": en, "status": 0, "orderTime": NOW(),
                "preparedTime": 0, "responseTime": 0, "finishTime": 0,
                "list": [{"id": 1, "name": when, "name_1": when, "count": 1}]})
            return self._j({"status": 200})
        if p == "/iptv2/manager/AddFoodOrder":
            if q.get("cFlag", ["0"])[0] == "1":
                oid = int(q.get("id", ["0"])[0] or 0)
                for o in FOOD_ORDERS:
                    if o.get("orderId") == oid:
                        o["status"] = 3          # waiting to be cancelled
                return self._j({"status": 200})
            cai = q.get("countAndIds", [""])[0]
            n = 0
            for pair in (cai or "").split(","):
                if ":" in pair:
                    try:
                        fid, cnt = pair.split(":")
                        fid, cnt = int(fid), int(cnt)
                        # resolve the ordered food so GetFoodOrder returns names
                        food = None
                        for items in FOOD.values():
                            for f in items:
                                if f.get("id") == fid:
                                    food = f
                                    break
                            if food:
                                break
                        FOOD_ORDERS.append({
                            "id": len(FOOD_ORDERS) + 1,
                            "orderId": 5100 + len(FOOD_ORDERS),
                            "foodId": fid, "count": cnt, "status": 0,
                            "food": food or {"id": fid, "name": "", "name_1": "",
                                             "price": 0, "content": "", "content_1": "",
                                             "imagePath": ""}})
                        n += cnt
                    except Exception:
                        pass
            return self._j({"status": 200, "count": n})
        if p == "/iptv2/manager/AddClientCheckOutOrder":
            return self._j({"status": 200})
        if p == "/iptv2/manager/GetGoods":
            return self._j(GOODS)
        if p == "/iptv2/manager/GetGoodsOrder":
            return self._j([])
        if p == "/iptv2/manager/GetWakeUp":
            return self._j({})
        if p == "/iptv2/manager/GetFolio":
            return self._j({"items": [
                {"time": "2026-11-17 20:10", "type": "VOD", "content": "Movie", "price": 5},
                {"time": "2026-11-18 08:00", "type": "Food", "content": "Breakfast", "price": 7}]})
        if p == "/iptv2/manager/GetConsume":
            return self._j([])
        if p == "/iptv2/manager/GetMusicCategory":
            return self._j(MUSIC_CATS)
        if p == "/iptv2/manager/GetMusicList":
            return self._j(MUSIC.get(int(q.get("albumId", ["1"])[0]), []))
        if p == "/iptv2/manager/GetRecTV":
            return self._j(channels())
        if p == "/iptv2/manager/GetRecProgram":
            return self._j([{"id": 1, "name": "Yesterday 20:00 News",
                             "url": "http://127.0.0.1:%d/iptv2/vod/test.mp4" % PORT}])
        if p == "/iptv2/manager/GetEpgRecProgram":
            # v2.7.2.06 RecordEpgAllTimeActivity: recorded programmes with times
            out = []
            for i, prog in enumerate(epg_for(int(q.get("liveId", ["1"])[0] or 1))):
                if not prog["timeshift"]:
                    continue
                d = dict(prog)
                d["url"] = "http://127.0.0.1:%d/iptv2/vod/test.mp4" % PORT
                d["name"] = prog["program"]
                out.append(d)
            return self._j(out)
        if p == "/iptv2/manager/GetVersion":
            return self._j(VERSION)
        if p == "/iptv2/manager/apk/getWeatherDays":
            return self._j(WEATHER)
        if p == "/iptv2/manager/apk/getClientBackgroundMusics":
            return self._j(BG_MUSICS)
        if p == "/iptv2/manager/apk/getClientBackgroundVideos":
            return self._j([])
        if p == "/iptv2/manager/GetInStream":
            return self._j([])
        if p == "/iptv2/manager/GetSubtitles":
            return self._j([])
        if p == "/iptv2/manager/GetSubtitleStyle":
            return self._j({})
        # a plain playlist, the way a residential head-end usually publishes its
        # line-up (Settings -> "Channel list (m3u)" in the Windows client)
        if p == "/iptv2/residential/channels.m3u":
            lines = ["#EXTM3U"]
            for c in channels():
                url = c.get("httpUrl") or c.get("hlsUrl") or c.get("url") or ""
                if not url:
                    continue
                grp = "کانال‌ها"
                for pkg in PACKAGES:
                    if str(c["id"]) in [x.strip() for x in (pkg.get("tvIds") or "").split(",")]:
                        grp = pkg["name"]
                        break
                lines.append('#EXTINF:-1 tvg-id="%s" tvg-name="%s" group-title="%s",%s'
                             % (c["id"], c["name"], grp, c["name"]))
                lines.append(url)
            b = ("\n".join(lines) + "\n").encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "audio/x-mpegurl; charset=utf-8")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            return
        # media
        if p.startswith("/iptv2/res/adv/music/"):
            # welcome background music (BGMusicBean.url under res/adv/music/)
            return self._file(os.path.join(MEDIA, "adv_music.mp3"), "audio/mpeg")
        if p.startswith("/iptv2/res/adv/video/"):
            return self._file(os.path.join(MEDIA, os.path.basename(p)), "video/mp4")
        if p.startswith("/iptv2/vod/"):
            fn = os.path.basename(p)
            fp = os.path.join(MEDIA, fn)
            ctype = "video/mp4"
            if fn.endswith(".ts"):
                ctype = "video/mp2t"
            elif fn.endswith(".m3u8"):
                ctype = "application/vnd.apple.mpegurl"
            return self._file(fp, ctype)
        if p.startswith("/iptv2/manager/"):
            # res/adv/<name>.png -> the real advert art extracted from the APK
            if p.startswith("/iptv2/manager/res/adv/"):
                name = os.path.basename(p)
                asset = os.path.join(HERE, "..", "windows_app", "app_assets", "img",
                                     "mipmap__" + name)
                if os.path.exists(asset):
                    return self._file(asset, "image/png")
            # images -> serve a tiny png
            png = os.path.join(HERE, "mock_img.png")
            if os.path.exists(png):
                return self._file(png, "image/png")
        self.send_response(404); self.send_header("Content-Length", "0"); self.end_headers()

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        return self._route(u.path, urllib.parse.parse_qs(u.query))

    def do_POST(self):
        u = urllib.parse.urlsplit(self.path)
        q = urllib.parse.parse_qs(u.query)
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        ctype = (self.headers.get("Content-Type") or "").lower()
        if body:
            if "json" in ctype:
                try:
                    for k, v in json.loads(body.decode("utf-8")).items():
                        q[str(k)] = [str(v)]
                except Exception:
                    pass
            else:
                for k, vs in urllib.parse.parse_qs(body.decode("utf-8", "replace")).items():
                    q[k] = vs
        return self._route(u.path, q)


if __name__ == "__main__":
    ensure_media()
    # tiny png for images
    if not os.path.exists(os.path.join(HERE, "mock_img.png")):
        import base64
        open(os.path.join(HERE, "mock_img.png"), "wb").write(base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="))
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), H)
    print("mock IPTV server on :%d" % PORT, flush=True)
    srv.serve_forever()
