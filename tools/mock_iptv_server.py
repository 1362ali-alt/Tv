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
    "protocol": "http", "playerFlag": 0, "layout": 4, "language": 1, "defaultLanguage": 1,
    "hotelName": "هتل رونیکا پالاس", "hotelNameEn": "Ronika Palace Hotel", "city": "Tehran",
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
    "activeAdv": False, "activeXiaodu": False, "advVideoEM": False, "cater": True,
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
    "money": 0, "costSum": 0.0, "unfinishedOrderCount": 0, "versionCode": 20701071,
    "versionText": "2.7.1.71", "welcomeWord": "Ronika", "welcomeWordEn": "Ronika",
    "wifiName": "RONIKA-GUEST", "wifiPassword": "ronika1234", "wifiStatus": 1,
    "wifiTips": "", "wifiTipsEn": "", "checkInTime": NOW(), "checkPerson": "guest",
    "timeZone": "", "timeMills": NOW(), "goods": [], "checked": False, "nrStatus": False,
}

PACKAGES = [
    {"id": 1, "number": 1, "name": "Free To Air", "content": "شبکه‌های رایگان", "price": 0, "clientIds": "", "tvIds": "1,2,3", "imagePath": "", "nameVisible": True, "imageVisible": False},
    {"id": 2, "number": 2, "name": "Premium", "content": "بسته ویژه", "price": 50, "clientIds": "", "tvIds": "4", "imagePath": "", "nameVisible": True, "imageVisible": False},
]


def _tv(i, name, num, proto_urls):
    d = {"id": i, "number": num, "name": name, "liveType": 0, "url": "", "rtspUrl": "", "httpUrl": "", "hlsUrl": "",
         "imagePath": "", "nameVisible": True, "imageVisible": False, "timeshift": False, "timeshifting": False, "tsStartTime": 0}
    d.update(proto_urls)
    return d


def channels():
    base = "http://127.0.0.1:%d" % PORT
    return [
        _tv(1, "IRIB TV1 (HTTP-TS)", 1, {"httpUrl": base + "/iptv2/vod/test.ts", "rtspUrl": "rtsp://127.0.0.1:8554/live/1.sdp"}),
        _tv(2, "Sample MP4 (HTTP)", 2, {"httpUrl": base + "/iptv2/vod/test.mp4", "url": base + "/iptv2/vod/test.mp4"}),
        _tv(3, "HLS Channel", 3, {"hlsUrl": base + "/iptv2/vod/test.m3u8"}),
        _tv(4, "Premium Movie", 4, {"httpUrl": base + "/iptv2/vod/test.mp4"}),
    ]


VOD_TYPES = [
    {"id": 1, "number": 1, "name": "Movies", "count": 2},
    {"id": 2, "number": 2, "name": "Series", "count": 1},
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
    {"id": 1, "name": "Lobby", "imagePath": "res/scenery/lobby.jpg"},
    {"id": 2, "name": "Pool", "imagePath": "res/scenery/pool.jpg"},
]}
FOOD_TYPES = [{"id": 1, "name": "Iranian"}, {"id": 2, "name": "Fast Food"}]
FOOD = {
    1: [{"id": 101, "name": "Chelo Kebab", "price": 12, "imagePath": "res/food/kebab.jpg"}],
    2: [{"id": 201, "name": "Pizza", "price": 9, "imagePath": "res/food/pizza.jpg"}],
}
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
VERSION = {"versionCode": 20701071, "versionName": "2.7.1.71", "name": "PARDIK", "url": "", "length": 0, "time": ""}


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

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        p = u.path
        q = urllib.parse.parse_qs(u.query)
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
            return self._j([])
        if p == "/iptv2/manager/GetHomepageIcon":
            return self._j(HOMEPAGE)
        if p == "/iptv2/manager/GetServiceIcon":
            return self._j([])
        if p == "/iptv2/manager/GetScenery":
            return self._j(SCENERY)
        if p in ("/iptv2/manager/GetHotel", "/iptv2/manager/GetHotelInformation"):
            return self._j(HOTEL)
        if p == "/iptv2/manager/GetHotelType":
            return self._j([{"id": 1, "name": "General"}])
        if p == "/iptv2/manager/GetFoodType":
            return self._j(FOOD_TYPES)
        if p == "/iptv2/manager/GetFood":
            return self._j(FOOD.get(int(q.get("typeId", ["1"])[0]), []))
        if p == "/iptv2/manager/GetFoodOrder":
            return self._j([])
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
            return self._j([])
        if p == "/iptv2/manager/GetEpgRecProgram":
            return self._j([{"id": 1, "name": "Yesterday 20:00 News", "url": "http://127.0.0.1:%d/iptv2/vod/test.mp4" % PORT}])
        if p == "/iptv2/manager/GetVersion":
            return self._j(VERSION)
        if p == "/iptv2/manager/apk/getWeatherDays":
            return self._j(WEATHER)
        if p == "/iptv2/manager/apk/getClientBackgroundMusics":
            return self._j([])
        if p == "/iptv2/manager/apk/getClientBackgroundVideos":
            return self._j([])
        if p == "/iptv2/manager/GetInStream":
            return self._j([])
        if p == "/iptv2/manager/GetSubtitles":
            return self._j([])
        if p == "/iptv2/manager/GetSubtitleStyle":
            return self._j({})
        # media
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
            # images -> serve a tiny png
            png = os.path.join(HERE, "mock_img.png")
            if os.path.exists(png):
                return self._file(png, "image/png")
        self.send_response(404); self.send_header("Content-Length", "0"); self.end_headers()

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(n)
        self._j({"status": 200})


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
