# -*- coding: utf-8 -*-
"""
PARDIK SMART IPTV - Windows 10 backend.
Pure-stdlib Python. No third-party dependencies.

Replicates the network/behaviour contract of the Android app
(com.dexin.wanchuan.iptv3) discovered by reverse engineering:
  * same URL builders          (IptvSP.getAddress/getUrl/getImagePath/getHttpVodPath/getLiveRtspUrl)
  * same defaults              (10.21.0.10 : 8030, RTSP 554, settings password 111999)
  * same JSON keys             (Gson field names)
  * same WebSocket channels    (ws://{ip}:{port}/dx-admin/websocket/{mac}  and  /iptv2/websocket/{room})
Serves a local web UI on 127.0.0.1 and proxies / remuxes streams so a browser
window can play RTSP / HLS / HTTP / UDP sources.
"""
import json
import os
import re
import sys
import time
import uuid
import socket
import struct
import collections
import base64
import hashlib
import threading
import subprocess
import urllib.parse
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# A Windows console runs an OEM code page (cp720 / cp437 / ...) that cannot
# encode the Persian strings this backend logs; one unguarded print() would
# raise UnicodeEncodeError and silently kill the calling thread (which is how
# a box can freeze on the boot screen with ping_times stuck at 0). Make stdio
# lossy-safe once, at import, and mirror every log line to backend.log so a
# remote install can be diagnosed from a file instead of a screenshot.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="backslashreplace")
    except Exception:
        pass

APP_VERSION_NAME = "2.7.2.06"
APP_VERSION_CODE = 20702006

# --------------------------------------------------------------------------- #
# Deployment flavour
#   The APK ("PARDIK SMART IPTV", com.dexin.wanchuan.iptv3) is a *platform*: the
#   vendor ships the same build to hotels and to residential towers and switches
#   features with server flags. Pardik's own deployment for the Ronika Palace
#   residential complex in Kahak is a pure IPTV client - live domestic/satellite
#   channels, VOD, timeshift - so the hotel services (catering, room service,
#   laundry, taxi, wake-up, check-out, folio, hotel intro) are not part of it.
#   IPTV_MODE=residential (default) hides them; IPTV_MODE=hotel keeps the full
#   platform behaviour for parity testing against the APK.
# --------------------------------------------------------------------------- #
# IptvConfig.DEFAULT_SERVER_IP in the APK - a factory/demo address, not necessarily
# the Ronika Palace head-end, so the diagnostics say so explicitly.
DEFAULT_SERVER_HINT = "10.21.0.10:8030"

APP_MODE = (os.environ.get("IPTV_MODE") or "residential").strip().lower()
if APP_MODE not in ("residential", "hotel"):
    APP_MODE = "residential"

BRANDING = {
    "residential": {
        "product": "PARDIK IPTV",
        "title": "PARDIK IPTV",
        "subtitle": "مجتمع مسکونی رونیکا پالاس کوهک",
        "subtitle_en": "Ronika Palace Residential Complex, Kahak",
        "welcome": "ساکنین محترم، خوش آمدید",
        "welcome_en": "Dear residents, welcome",
        "unit_label": "شماره واحد",
        "unit_label_en": "Unit number",
        "welcome_word": "به شبکهٔ تلویزیون اینترنتی مجتمع خوش آمدید؛ کانال‌های زندهٔ داخلی و ماهواره‌ای، آرشیو ویدئو و بازپخش در دسترس شماست.",
        "welcome_word_en": "Welcome to the residential IPTV service: domestic and satellite live channels, the video archive and catch-up TV.",
        "vendor": "شرکت پاردیک",
        "install_name": "PARDIK IPTV - Ronika Palace Kahak",
    },
    "hotel": {
        "product": "PARDIK SMART IPTV",
        "title": "PARDIK SMART IPTV",
        "subtitle": "",                     # taken from Settings.hotelName
        "subtitle_en": "",
        "welcome": "میهمانان عزیز",
        "welcome_en": "Respect guests",
        "unit_label": "شماره اتاق",
        "unit_label_en": "Room number",
        "welcome_word": "به هتل ما خوش آمدید. در خدمت شما هستیم!",
        "welcome_word_en": "Welcome to our hotel. We are at your service!",
        "vendor": "شرکت پاردیک",
        "install_name": "PARDIK SMART IPTV",
    },
}

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(HERE, "web")

# --------------------------------------------------------------------------- #
# Settings store  (mirrors Android SharedPreferences "settings" / IptvSP)
# --------------------------------------------------------------------------- #
DEFAULTS = {
    "server_ip": "10.21.0.10",
    "server_port": 8030,
    "default_server_ip": "10.21.0.10",
    "other_server_ip": "10.21.0.10",
    "password": "111999",
    "need_password": True,
    "iptv_room_number": "",
    # v2.7.2.06: IptvSP switched SharedPreferences -> MMKV and renamed the
    # style key ("select_app_style_flag" -> "app_layout_style", default 0).
    "app_layout_style": 0,
    "select_app_style_flag": 4,          # kept for compatibility
    "use_vlc_paly_live_prg": False,      # v2: hand live playback to VLC
    "autostart": False,                  # v2: BootReceiver equivalent
    "selected_apps": [],                 # v2: SettingAppShowActivity / app.db
    "play_speed": 1.0,                   # v2: txt_play_speed
    "select_language_flag": 1,
    "server_language_flag": 3,
    "server_language_defalut_select_flag": 1,
    "scroll_duration_time": 60000,
    "rtsp_port": 554,
    "app_language": "fa",
    "layout_style": 4,
    "favourites": [],
    "last_channel": None,
    "device_iface": "",
    "device_iface_kind": "unknown",
}


def data_dir():
    if os.name == "nt":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
        d = os.path.join(base, "PARDIK-SMART-IPTV")
    else:
        d = os.path.join(HERE, "_userdata")
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        d = HERE
    return d


class Settings(object):
    def __init__(self):
        self.path = os.path.join(data_dir(), "settings.json")
        self.d = dict(DEFAULTS)
        self.lock = threading.RLock()
        self.load()
        # IptvUtil.getMacAddress() resolves the identity at run time
        # (eth0 -> wlan0 -> serial -> 02:00:00:00:00:00) and the platform server
        # keys the client record by MAC, so refresh it on every start: a box that
        # was on Wi-Fi yesterday may be cabled today. The stored value is only the
        # fallback for when no adapter can be read.
        mac = detect_mac()
        if mac and mac != "02:00:00:00:00:00":
            self.d["device_mac"] = mac
        elif not self.d.get("device_mac"):
            self.d["device_mac"] = mac or "02:00:00:00:00:00"
        self.d["device_iface"] = NETWORK.get("iface", "")
        self.d["device_iface_kind"] = NETWORK.get("kind", "unknown")
        self.save()

    def load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                user = json.load(f)
            for k, v in user.items():
                self.d[k] = v
        except Exception:
            pass

    def save(self):
        with self.lock:
            try:
                tmp = self.path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(self.d, f, ensure_ascii=False, indent=1)
                os.replace(tmp, self.path)
            except Exception:
                pass

    def get(self, k, default=None):
        return self.d.get(k, DEFAULTS.get(k, default))

    def set(self, k, v):
        self.d[k] = v
        self.save()

    # --- IptvSP equivalents ---
    def address(self):
        return "http://%s:%s" % (self.get("server_ip"), self.get("server_port"))

    def url(self, ep):
        return self.address() + "/iptv2/" + ep

    def image_path(self, p):
        return self.address() + "/iptv2/manager/" + p

    def http_vod_path(self):
        return self.address() + "/iptv2/vod/"

    def live_rtsp_url(self, number):
        return "rtsp://%s:%s/live/%s.sdp" % (
            self.get("server_ip"), self.get("rtsp_port"), number)

    def ser_address(self):
        return "%s:%s" % (self.get("server_ip"), self.get("server_port"))


def detect_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"
    finally:
        s.close()


def _mac_fallback():
    try:
        node = uuid.getnode()
        mac = "%012x" % node
        return ":".join(mac[i:i + 2] for i in range(0, 12, 2)).upper()
    except Exception:
        return "02:00:00:00:00:00"


WIFI_HINTS = ("wireless", "wi-fi", "wifi", "wlan", "802.11")
WIRED_HINTS = ("ethernet", "gbe", "gigabit", " lan", "lan ", "pci e", "pcie",
               "realtek", "atheros", "intel(r) eth", "broadcom netxtreme")


def detect_interfaces():
    """Physical adapters as [{name, mac, kind, up}] - kind is ethernet|wifi|other.
    IptvUtil.getMacAddress() reads eth0 first and only then wlan0, because the
    set-top boxes (and this deployment) are wired; the same preference applies
    here so a machine with both a cable and Wi-Fi reports the cable's MAC."""
    out = []
    if os.name == "nt":
        # Get-NetAdapter descriptions are vendor strings, so they survive a
        # non-English Windows (ipconfig's headers do not).
        ps = ("Get-NetAdapter -Physical | Select-Object Name,InterfaceDescription,MacAddress,Status "
              "| ConvertTo-Json -Compress")
        try:
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                               capture_output=True, timeout=20, creationflags=flags)
            txt = (r.stdout or b"").decode("utf-8", "replace").strip()
            data = json.loads(txt) if txt else []
            if isinstance(data, dict):
                data = [data]
            for a in data:
                mac = (a.get("MacAddress") or "").replace("-", ":").upper()
                if not mac or mac.count(":") != 5:
                    continue
                low = ((a.get("InterfaceDescription") or "") + " " + (a.get("Name") or "")).lower()
                kind = "wifi" if any(h in low for h in WIFI_HINTS) else (
                    "ethernet" if any(h in low for h in WIRED_HINTS) else "other")
                out.append({"name": a.get("Name") or "", "mac": mac, "kind": kind,
                            "up": (a.get("Status") or "").lower() == "up"})
        except Exception:
            pass
    if not out:
        base = "/sys/class/net"
        try:
            for n in sorted(os.listdir(base)):
                if n == "lo":
                    continue
                try:
                    mac = open(os.path.join(base, n, "address")).read().strip().upper()
                except Exception:
                    mac = ""
                if not mac or mac == "00:00:00:00:00:00":
                    continue
                try:
                    up = open(os.path.join(base, n, "operstate")).read().strip() == "up"
                except Exception:
                    up = False
                kind = ("wifi" if n.startswith(("wl", "ra", "ath")) else
                        "ethernet" if n.startswith(("eth", "en", "usb")) else "other")
                out.append({"name": n, "mac": mac, "kind": kind, "up": up})
        except Exception:
            pass
    return out


def detect_network():
    """The identity the platform server knows this client by."""
    rank = {"ethernet": 0, "wifi": 1, "other": 2}
    ifs = detect_interfaces()
    up = sorted([i for i in ifs if i["up"]], key=lambda i: rank.get(i["kind"], 3))
    chosen = up[0] if up else (sorted(ifs, key=lambda i: rank.get(i["kind"], 3))[:1] or [None])[0]
    ip = detect_local_ip()
    if not chosen:
        return {"mac": _mac_fallback(), "iface": "", "kind": "unknown", "ip": ip,
                "wired": False, "interfaces": ifs}
    return {"mac": chosen["mac"], "iface": chosen["name"], "kind": chosen["kind"],
            "ip": ip, "wired": chosen["kind"] == "ethernet", "interfaces": ifs}


def detect_mac():
    return NETWORK["mac"] if NETWORK.get("mac") else _mac_fallback()


# Resolved once at start-up (Get-NetAdapter / /sys/class/net); /api/network
# recomputes it on demand so unplugging the cable is reflected without a restart.
NETWORK = detect_network()

SETTINGS = Settings()


def append_log(line):
    """backend.log in the data dir: the only forensic trail a headless install
    leaves behind (the console window is hidden by design)."""
    try:
        p = os.path.join(data_dir(), "backend.log")
        if os.path.exists(p) and os.path.getsize(p) > 900000:
            os.replace(p, p + ".old")
        with open(p, "a", encoding="utf-8", errors="replace") as f:
            f.write(line + "\n")
    except Exception:
        pass


# --- deployment-baked head-end (install\headend.txt -> launch.ps1 -> env) ----
# tools/extract_headend.py reads 10.21.0.10:8030 (RTSP 554) out of the vendor
# APK's IptvConfig - the only building address embedded in the software - and
# the installer ships it as headend.txt. It is applied as a *seed*: once a
# resident changes the address from Settings the marker matches and their
# choice survives restarts; re-editing headend.txt re-seeds it.
_seed_ip = os.environ.get("IPTV_SERVER_IP", "").strip()
_seed_port = os.environ.get("IPTV_SERVER_PORT", "").strip()
if _seed_ip:
    _seed = "%s:%s" % (_seed_ip, _seed_port or SETTINGS.get("server_port"))
    if SETTINGS.get("headend_seed") != _seed:
        SETTINGS.d["server_ip"] = _seed_ip
        if _seed_port.isdigit():
            SETTINGS.d["server_port"] = int(_seed_port)
        SETTINGS.d["headend_seed"] = _seed
        SETTINGS.save()

# --------------------------------------------------------------------------- #
# HTTP API client (mirrors HttpUtil / OkGo usage)
# --------------------------------------------------------------------------- #
TIMEOUT = 8.0


# OkHttp in the APK never consults the Windows system proxy; urllib does, and a
# machine behind a PAC/proxy would otherwise send every head-end call (even to
# 10.x LAN addresses) into the proxy and time out. Pin the opener to direct.
_NO_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def http_get(url, timeout=TIMEOUT, binary=False, headers=None):
    req = urllib.request.Request(url, headers=headers or {
        "User-Agent": "PARDIK-SMART-IPTV-Win/%s" % APP_VERSION_NAME})
    with _NO_PROXY.open(req, timeout=timeout) as r:
        data = r.read()
        ctype = r.headers.get("Content-Type", "")
    if binary:
        return data, ctype, r.status if hasattr(r, "status") else 200
    return data, ctype, 200


def api_get(endpoint, params=None, timeout=TIMEOUT):
    """The APK builds manager URLs as {addr}/iptv2/{ep}; some deployments also
    expose them under {addr}/iptv2/manager/{ep}. Try the APK form first, then
    fall back to the manager form."""
    qs = ("?" + urllib.parse.urlencode(params)) if params else ""
    last = None
    for base in (SETTINGS.address() + "/iptv2/",
                 SETTINGS.address() + "/iptv2/manager/"):
        url = base + endpoint + qs
        try:
            data, ctype, status = http_get(url, timeout=timeout)
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404:
                continue
            raise
        except Exception as e:
            last = e
            continue
        return json.loads(data.decode("utf-8", "replace"))
    if isinstance(last, Exception):
        raise last
    raise IOError("no response")


def api_get_raw(path, timeout=TIMEOUT):
    url = SETTINGS.address() + path
    return http_get(url, timeout=timeout, binary=True)


class Api(object):
    """Every manager endpoint used by the Android app."""

    def mac(self):
        return SETTINGS.get("device_mac")

    def _m(self, extra=None):
        p = {"mac": self.mac()}
        if extra:
            p.update(extra)
        return p

    def get_settings(self):
        return api_get("GetSettings")

    def get_client(self):
        return api_get("GetClient", self._m())

    def get_welcome_word(self):
        # GetWelcomWord?mac= (the platform's own spelling) -> WelcomeWordBean
        # {content, content_en}; "%s%" is the guest name, "%s%:" the salutation.
        return api_get("GetWelcomWord", self._m())

    def get_apk(self):
        # GetAPK -> List<ThirdPartyApkBean> behind the "third app" popup (type 8)
        return api_get("GetAPK")

    def get_room_info(self):
        return api_get("GetRoomInfo", self._m({
            "ip": detect_local_ip(), "online": "1",
            "versionCode": APP_VERSION_CODE, "versionName": APP_VERSION_NAME}))

    def update_client(self, playing=""):
        p = self._m({
            "ip": detect_local_ip(), "online": "1",
            "versionCode": APP_VERSION_CODE, "versionName": APP_VERSION_NAME,
            "name": playing or ""})
        room = SETTINGS.get("iptv_room_number")
        if room:
            p["roomNumber"] = room
        return api_get("UpdateClient", p)

    def get_time(self):
        return api_get("GetCurrentTimeAndZone")

    def get_live_packages(self):
        return api_get("GetLivePackage", self._m())

    def get_live_tv(self, package_id=-1):
        return api_get("GetLiveTV", {"packageId": package_id, "mac": self.mac()})

    def get_live_status(self, package_id=None):
        p = self._m()
        if package_id is not None:
            p["packageId"] = package_id
        return api_get("GetLiveStatus", p)

    def get_live_start(self):
        return api_get("GetLiveStart", self._m())

    def get_vod_types(self):
        return api_get("GetVodType", self._m())

    def get_vod(self, type_id=None, ids=None, keyword=None, hot=False):
        p = {}
        if type_id is not None:
            p["typeId"] = type_id
        if ids is not None:
            p["ids"] = ids
        if keyword:
            p["keyword"] = keyword
        if hot:
            p["isHot"] = 1
        p["mac"] = self.mac()
        return api_get("GetVod", p)

    def get_vod_url(self, vod_id):
        return api_get("GetVodUrl", {"vodId": vod_id})

    def add_vod_record(self, vod_name, duration):
        return api_get("AddVodRecord", {
            "clientId": self.mac(), "vodName": vod_name, "duration": duration})

    def update_vod_click(self, vod_id):
        return api_get("UpdateVodClickRate", {"vodId": vod_id})

    def get_adv_image(self, type_):
        """GetAdvImage?mac=&type= -> List<String> of paths under /iptv2/manager/
        (getImagePath). type 1 = welcome background slideshow (PPT),
        type 3 = live-player watermark, type 12 = hotel-manager signature."""
        return api_get("GetAdvImage", self._m({"type": type_}))

    def get_adv_video_em(self):
        """GetAdvVideoEM?mac= -> List<String> (WebTag.TAG_BOOT_VIDEO).
        Paths are relative to /iptv2/ (IptvSP.getUrl), e.g. "res/adv/video/x.mp4".
        Played full-screen before the welcome screen by BootVideoActivity when
        settings.advVideoEM is true, and as the welcome background video when it
        is false. Empty list -> straight to the welcome screen."""
        return api_get("GetAdvVideoEM", self._m())

    # ---- v2.7.2.06 in-player advertising (LivePlayerWithEpgActivity) ----
    def get_next_adv(self, live_id):
        """GetNextAdv?mac=&liveId= -> List<LiveProgramAdvVideoBean>
        {status, msg, resource{id,name,url,allowSkip,countTime,count,size,checked}}
        status 0 = no advert (play the channel), 200 = play resource.url first."""
        return api_get("GetNextAdv", self._m({"liveId": live_id}))

    def add_adv_history(self, id, type_=2, time=0, check=1):
        """AddAdvHistory?mac=&id=&type=&time=&check=
        type 1 = live programme watch time (id = liveProgramId)
        type 2 = advert video (id = adVideoProgramId), check 1 = played to the
        end, 2 = skipped by the guest."""
        return api_get("AddAdvHistory",
                       self._m({"id": id, "type": type_, "time": time, "check": check}))

    def get_homepage_icon(self):
        return api_get("GetHomepageIcon")

    def get_service_icon(self, package_id=None):
        p = self._m()
        if package_id is not None:
            p["packageId"] = package_id
        return api_get("GetServiceIcon", p)

    def get_scenery(self):
        return api_get("GetScenery")

    def get_hotel(self):
        return api_get("GetHotel", self._m())

    def get_hotel_type(self):
        return api_get("GetHotelType")

    def get_hotel_information(self):
        return api_get("GetHotelInformation")

    def get_food_type(self, parent_id=None):
        # v2.7.2.06: "?parentId=" filters the food types of one catering country
        p = {"parentId": parent_id} if parent_id not in (None, "", -1) else None
        return api_get("GetFoodType", p)

    def get_clothing_type(self):
        # v2.7.2.06: laundry service (serviceType != 2) lists clothing types
        return api_get("GetClothingType")

    def get_service_order(self):
        # v2.7.2.06: room-service order history (replaces GetGoodsOrder)
        return api_get("GetServiceOrder", self._m())

    def get_live_epg(self, live_id):
        # v2.7.2.06: LivePlayerWithEpgActivity programme guide
        return api_get("GetLiveEPG", {"liveId": live_id})

    def get_food(self, type_id):
        return api_get("GetFood", {"typeId": type_id})

    def add_food_order(self, payload):
        p = self._m(payload or {})
        return api_get("AddFoodOrder", p)

    def get_food_order(self):
        return api_get("GetFoodOrder", self._m())

    def get_goods(self):
        return api_get("GetGoods")

    def get_goods_order(self):
        return api_get("GetGoodsOrder")

    def add_goods_order(self, type_id, wakeup_time=0, extra=None):
        # AddGoodsOrder?mac=&typeId=&wakeupTime=   (typeId 4 = wake-up, 7 = taxi)
        p = self._m({"typeId": type_id, "wakeupTime": wakeup_time or 0})
        if extra:
            p.update(extra)
        return api_get("AddGoodsOrder", p)

    def get_wakeup(self):
        return api_get("GetWakeUp", self._m())

    def add_checkout_order(self):
        return api_get("AddClientCheckOutOrder", self._m())

    def get_folio(self, pms_type):
        return api_get("GetFolio", self._m({"PmsType": pms_type}))

    def get_consume(self):
        return api_get("GetConsume", self._m())

    def add_consume(self, consume_id, type_id=2):
        return api_get("AddConsume", self._m({"consumeId": consume_id,
                                               "typeId": type_id}))

    def get_music_category(self):
        return api_get("GetMusicCategory", self._m())

    def get_music_list(self, album_id, language_type=0):
        return api_get("GetMusicList", {
            "albumId": album_id, "tvType": 0, "languageType": language_type})

    def get_rec_tv(self, live_id=None):
        # v2.7.2.06: GetRecTV is called without parameters (all recorded channels)
        p = {"liveId": live_id} if live_id not in (None, "") else None
        return api_get("GetRecTV", p)

    def get_rec_program(self, live_id):
        return api_get("GetRecProgram", {"liveId": live_id})

    def get_epg_rec_program(self, live_id):
        return api_get("GetEpgRecProgram", {"liveId": live_id})

    def get_version(self):
        return api_get("GetVersion")

    def get_weather_days(self):
        return api_get("apk/getWeatherDays", self._m())

    def get_bg_musics(self):
        return api_get("apk/getClientBackgroundMusics", self._m())

    def get_bg_videos(self, type_=0):
        return api_get("apk/getClientBackgroundVideos", self._m({"type": type_}))

    def get_in_stream(self):
        return api_get("GetInStream", self._m())

    def get_subtitles(self):
        return api_get("GetSubtitles", self._m())

    def get_subtitle_style(self):
        return api_get("GetSubtitleStyle", self._m())


API = Api()

# query-key (as used by the web UI / Android) -> python kwarg
PARAM_ALIAS = {
    "packageId": "package_id",
    "typeId": "type_id",
    "liveId": "live_id",
    "parentId": "parent_id",
    "albumId": "album_id",
    "vodId": "vod_id",
    "pms_type": "pms_type",
    "PmsType": "pms_type",
    "language_type": "language_type",
    "isHot": "hot",
    "ids": "ids",
    "keyword": "keyword",
    "type": "type_",
    "wakeupTime": "wakeup_time",
    "orderId": "order_id",
}

# --------------------------------------------------------------------------- #
# Connection engine - the APK's start-up handshake, ported call by call
#
#   BaseApplication.onCreate()        -> ConnectionEngine.on_create()
#     getPmsStatus()                    GetRoomInfo?mac=&ip=&online=&versionCode=&versionName=
#     getClientFromServer()             GetClient?mac=        (gated by isGetClient)
#     getDataFromServer()               GetSettings, plus GetAdvImage?type=11,
#                                       UpdateClient / GetRoomInfo on every 2nd
#                                       tick and GetCurrentTimeAndZone when the
#                                       clock is stale or the link is down
#     startServerIpThread()             the UDP 27777 announce listener
#     getTimeFromServer()               GetCurrentTimeAndZone
#     timer.schedule(task, 2000, 5000)  the 5 s maintenance loop
#
#   PingServerActivity.startTimer()   -> ConnectionEngine.ping_loop()
#     Timer(task, 0, 2000): the first tick sleeps 2 s, then times++ and while
#     times != 20 both BaseApplication.getSettingsFromServer() and the
#     activity's own GetSettings call are made; at times == 20 the app stops
#     trying and opens the welcome screen with layout 0.
#
#   BaseApplication$9                 -> `connected` becomes true only when a
#     GetSettings response parses and false when the request fails. Every menu
#     entry of MainStyleThirdActivity is gated on that flag (isConnectServer()
#     -> Toast status_disconnected), so this flag is what decides whether the
#     resident ever reaches the live-TV menu.
#
#   BaseApplication$3                 -> the head-end announces itself with a
#     JSON datagram {"ip": "...", "port": N} on UDP 27777; the client adopts it
#     (setServerIp / setOtherServerIp / setServerPort) and the next GetSettings
#     goes to the right machine. This is how a tower deployment finds its
#     server without anybody typing an address, so the port listens too.
# --------------------------------------------------------------------------- #
DISCOVERY_PORT = int(os.environ.get("IPTV_DISCOVERY_PORT", "27777"))
DISCOVERY_TIMEOUT = 20.0          # DatagramSocket.setSoTimeout(20000)
DISCOVERY_MAX_THREADS = 180       # BaseApplication.startServerIpThread(): serverIpTimes < 180
PING_MAX_ATTEMPTS = 20            # PingServerActivity$2: while (times != 20)
PING_INTERVAL = 2.0               # PingServerActivity.startTimer(): Timer(task, 0, 2000)
APP_TIMER_DELAY = 2.0             # BaseApplication.onCreate(): timer.schedule(task, 2000, 5000)
APP_TIMER_PERIOD = 5.0
DAY_MS = 86400000                 # getDataFromServer(): refresh the clock once a day
# Windows-port aid (not in the APK): when no announce arrives and the stored
# address does not answer, look for the head-end on the local subnet.
SWEEP_ENABLED = os.environ.get("IPTV_SWEEP", "1") not in ("0", "false", "no")
SWEEP_PORT_TIMEOUT = 0.35
SWEEP_HTTP_TIMEOUT = 1.5

# util.IpaddressCheck
_IP_RE = re.compile(r"^(1\d{2}|2[0-4]\d|25[0-5]|[1-9]\d|[1-9])\."
                    r"(1\d{2}|2[0-4]\d|25[0-5]|[1-9]\d|\d)\."
                    r"(1\d{2}|2[0-4]\d|25[0-5]|[1-9]\d|\d)\."
                    r"(1\d{2}|2[0-4]\d|25[0-5]|[1-9]\d|\d)$")
_DOMAIN_RE = re.compile(r"^((?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,6}$")


def check_ipaddress(v):
    """IpaddressCheck.checkIpaddress - dotted quad, no leading zeros allowed."""
    return bool(v) and _IP_RE.match(str(v)) is not None


def is_valid_domain(v):
    """IpaddressCheck.isValidDomain"""
    return bool(v) and _DOMAIN_RE.match(str(v)) is not None


def has_letter(v):
    """IpaddressCheck.hasLetter - SettingsActivity rejects letters in an IP field."""
    return re.search(r"[a-zA-Z]", str(v or "")) is not None


def _port(v, default=8030):
    try:
        p = int(v)
    except Exception:
        return default
    return p if 0 < p < 65536 else default


def default_gateway():
    """The router of the interface we are on - the usual place a building's
    head-end sits when it is not the address the APK was built with."""
    try:
        if os.name == "nt":
            ps = ("(Get-NetRoute -DestinationPrefix 0.0.0.0/0 -ErrorAction SilentlyContinue | "
                  "Sort-Object RouteMetric | Select-Object -First 1).NextHop")
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                               capture_output=True, timeout=15, creationflags=flags)
            gw = (r.stdout or b"").decode("utf-8", "replace").strip()
            return gw if check_ipaddress(gw) else ""
        for line in open("/proc/net/route").read().splitlines()[1:]:
            f = line.split()
            if len(f) > 2 and f[1] == "00000000":
                return socket.inet_ntoa(struct.pack("<L", int(f[2], 16)))
    except Exception:
        pass
    return ""


def local_subnet(ip=None):
    """/24 neighbours of our own address, in the order a technician would try."""
    ip = ip or NETWORK.get("ip") or detect_local_ip()
    if not check_ipaddress(ip) or ip.startswith("169.254."):
        return ip, []
    base = ip.rsplit(".", 1)[0]
    hosts = ["%s.%d" % (base, i) for i in range(1, 255) if "%s.%d" % (base, i) != ip]
    return ip, hosts


class ServerDiscovery(threading.Thread):
    """BaseApplication$3 + startServerIpThread(): listen on UDP 27777 for the
    head-end's {"ip","port"} announcement and adopt it. The socket timeout is
    20 s and the listener is re-armed at most 180 times, exactly as the APK
    does, so a server that announces late is still picked up."""

    def __init__(self, engine):
        super(ServerDiscovery, self).__init__(daemon=True, name="iptv-discovery")
        self.engine = engine
        self.sock = None
        self.bound = False
        self.error = ""
        self.packets = 0
        self.threads = 0
        self.last = None
        self.stop_flag = False

    def state(self):
        return {"port": DISCOVERY_PORT, "bound": self.bound, "error": self.error,
                "packets": self.packets, "threads": self.threads, "last": self.last}

    def adopt(self, payload, why, addr=None):
        """ServerIpAddrBean {ip, port} -> setServerIp / setOtherServerIp /
        setServerPort, with the APK's own validation."""
        try:
            ip = str((payload or {}).get("ip") or "").strip()
            port = _port((payload or {}).get("port"), 0)
        except Exception:
            return False
        if not check_ipaddress(ip) or not (0 < port < 65536):
            self.engine.note("announce rejected: ip=%r port=%r" % (ip, port))
            return False
        self.last = {"ip": ip, "port": port, "why": why, "from": addr or "",
                     "at": round(time.time(), 3)}
        self.engine.adopt_server(ip, port, why)
        return True

    def run(self):
        while not self.stop_flag and self.threads < DISCOVERY_MAX_THREADS:
            self.threads += 1
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                try:
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                except Exception:
                    pass
                s.bind(("0.0.0.0", DISCOVERY_PORT))
                s.settimeout(DISCOVERY_TIMEOUT)
                self.sock, self.bound, self.error = s, True, ""
                self.engine.note("discovery: listening on UDP %d (thread %d/%d)"
                                 % (DISCOVERY_PORT, self.threads, DISCOVERY_MAX_THREADS))
                while not self.stop_flag:
                    try:
                        buf, addr = s.recvfrom(512)
                    except socket.timeout:
                        break                       # -> startServerIpThread() again
                    except Exception as e:
                        self.error = str(e)
                        break
                    self.packets += 1
                    text = buf.decode("utf-8", "replace").strip()
                    self.engine.note("discovery: %d byte(s) from %s:%s -> %s"
                                     % (len(buf), addr[0], addr[1], text[:160]))
                    try:
                        payload = json.loads(text)
                    except Exception:
                        payload = None
                    if not isinstance(payload, dict):
                        time.sleep(6.0)             # BaseApplication$3: bean == null -> sleep 6000
                        continue
                    if self.adopt(payload, "udp-announce", "%s:%s" % (addr[0], addr[1])):
                        return                      # address adopted: stop announcing
                s.close()
            except Exception as e:
                self.bound, self.error = False, str(e)
                self.engine.note("discovery: bind failed on UDP %d: %s" % (DISCOVERY_PORT, e))
                time.sleep(2.0)
        self.bound = False


class ConnectionEngine(object):
    """BaseApplication + PingServerActivity, in one place.

    `connected` is the flag MainStyleThirdActivity.isConnectServer() reads, and
    the whole point of the boot phase: the welcome screen and the live-TV menu
    only open when a GetSettings response has parsed."""

    def __init__(self):
        self.lock = threading.RLock()
        self.connected = False
        self.settings = None                 # bean.Settings
        self.client = None                   # bean.Client
        self.pms_type = 0
        self.is_get_pms_data = False         # settings.getPmsType() != 0
        self.is_get_client = True            # GetClient is asked for once
        self.is_get_ping_ser_img = True      # GetAdvImage?type=11 (boot background)
        self.update_room_number = True       # BaseApplication.updateRoomNumber
        self.times = 0                       # 5 s maintenance loop counter
        self.times1 = 0                      # getDataFromServer() counter
        self.ping_times = 0                  # PingServerActivity.times
        self.server_ip_times = 0
        self.system_cur_time = 0
        self.server_time_mills = 0           # GetCurrentTimeAndZone -> DigitalClock
        self.cur_playing = ""                # UpdateClient?name=<live programme>
        self.server_room_num = ""
        self.time_zone = ""
        self.cur_language = ""
        self.phase = "boot"                  # boot -> ping -> welcome -> main
        self.welcome = None                  # openWelcomeActivity() payload
        self.last_error = ""
        self.last_ok = 0.0
        self.started = 0.0
        self.log = collections.deque(maxlen=240)
        self.discovery = ServerDiscovery(self)
        self.sweep = {"enabled": SWEEP_ENABLED, "done": False, "running": False,
                      "tried": 0, "found": None, "log": []}
        self._threads = []
        self._stop = threading.Event()

    # ---- logging / state ------------------------------------------------- #
    def note(self, msg):
        line = "[%s] %s" % (time.strftime("%H:%M:%S"), msg)
        with self.lock:
            self.log.append(line)
        try:
            print("CONNECTION " + line)
            sys.stdout.flush()
        except Exception:
            pass                      # a dead/odd console must never kill a thread
        append_log("CONNECTION " + line)

    def state(self):
        try:
            return self._state()
        except Exception as e:                         # a broken state() must not
            return {"connected": bool(self.connected),  # freeze the boot screen
                    "phase": self.phase, "ping_times": self.ping_times,
                    "ping_max": PING_MAX_ATTEMPTS, "welcome": self.welcome,
                    "settings_ok": bool(self.settings), "engine_error": str(e),
                    "last_error": "state(): %s" % e,
                    "log": list(self.log)[-40:]}

    def _state(self):
        with self.lock:
            st = self.settings or {}
            return {
                "connected": self.connected,
                "phase": self.phase,
                "ping_times": self.ping_times,
                "ping_max": PING_MAX_ATTEMPTS,
                "welcome": self.welcome,
                "server": {"ip": SETTINGS.get("server_ip"), "port": SETTINGS.get("server_port"),
                           "address": SETTINGS.address(),
                           "is_factory_default": SETTINGS.get("server_ip") == DEFAULTS["server_ip"]},
                "unit": SETTINGS.get("iptv_room_number") or "",
                "server_room_num": self.server_room_num,
                "client": self.client,
                "settings_ok": bool(self.settings),
                "pms_type": self.pms_type,
                "layout": st.get("layout", SETTINGS.get("app_layout_style", 0)),
                "enter_live_page": bool(st.get("enterLivePage")),
                "need_cheek_in": bool(st.get("needCheekIn")),
                "enabled": self.is_enabled(),
                "adv_video_em": bool(st.get("advVideoEM")),
                "skip_welcome_page": bool(st.get("skipWelcomePage")),
                "ping_bg": SETTINGS.get("ping_server_bg_image") or "",
                # BaseApplication.getSettings() / curPlayingLiveProgramName /
                # DigitalClock.currentTimeMillis(): the screens read these.
                "server_settings": self.settings,
                "cur_playing": self.cur_playing,
                "server_time": self.server_time_mills,
                "time_zone": self.time_zone,
                "last_error": self.last_error,
                "last_ok": self.last_ok,
                "uptime": round(time.time() - self.started, 1) if self.started else 0,
                "discovery": self.discovery.state(),
                "sweep": {k: v for k, v in self.sweep.items() if k != "log"},
                "sweep_log": list(self.sweep["log"])[-25:],
                "log": list(self.log)[-40:],
                "ws": {"prg": bool(WS.prg and WS.prg.connected),
                       "vol": bool(WS.vol and WS.vol.connected)},
            }

    def is_enabled(self):
        """MainStyleThirdActivity.isEnabled(): only a checked-in client is
        blocked, and only when the server asks for check-in at all."""
        st = self.settings or {}
        if not st.get("needCheekIn"):
            return True
        c = self.client
        return not (c is not None and not c.get("enable", True))

    # ---- the individual server calls ------------------------------------- #
    def _fail(self, what, e):
        self.last_error = "%s: %s" % (what, e)
        self.note(self.last_error)

    def get_settings_from_server(self):
        """BaseApplication.getSettingsFromServer() + $9: this is the call that
        decides `connected`."""
        try:
            data = API.get_settings()
        except Exception as e:
            self.connected = False
            self._fail("GetSettings", e)
            return None
        if not isinstance(data, dict):
            self.connected = False
            self._fail("GetSettings", "answer is not an object (%r)" % type(data).__name__)
            return None
        self.connected = True
        self.last_ok = time.time()
        self.last_error = ""
        if data != self.settings:
            self.settings = data
            self.pms_type = int(data.get("pmsType") or 0)
            self.is_get_pms_data = self.pms_type != 0
            lang = data.get("language")
            if lang is not None and SETTINGS.get("server_language_flag") != lang:
                SETTINGS.set("server_language_flag", lang)
            dlang = data.get("defaultLanguage")
            if dlang is not None and SETTINGS.get("server_language_defalut_select_flag") != dlang:
                SETTINGS.set("server_language_defalut_select_flag", dlang)
            self.note("GetSettings ok: protocol=%s layout=%s showPackage=%s epg=%s "
                      "enterLivePage=%s pmsType=%s"
                      % (data.get("protocol"), data.get("layout"), data.get("showPackage"),
                         data.get("epg"), data.get("enterLivePage"), self.pms_type))
        return data

    def get_client_from_server(self):
        """BaseApplication.getClientFromServer() + $7 (only while isGetClient)."""
        if not self.is_get_client:
            return self.client
        try:
            data = API.get_client()
        except Exception as e:
            self._fail("GetClient", e)
            return None
        if isinstance(data, dict):
            self.connected = True
            self.is_get_client = False
            self.client = data
            self.note("GetClient ok: name=%r enable=%s" % (data.get("name"), data.get("enable")))
        return self.client

    def get_pms_status(self):
        """BaseApplication.getPmsStatus() - despite the name it calls GetRoomInfo."""
        try:
            data = API.get_room_info()
        except Exception as e:
            self._fail("GetRoomInfo", e)
            return None
        if isinstance(data, dict):
            self.client = data
            self.connected = True
            self.note("GetRoomInfo ok: name=%r" % data.get("name"))
        return data

    def update_client(self, playing=""):
        """BaseApplication.updateClient() + $6: also how the head-end hands this
        client its unit number (Client.name -> IptvSP.setRoomNumber)."""
        try:
            data = API.update_client(playing or self.cur_playing)
        except Exception as e:
            self._fail("UpdateClient", e)
            return None
        if not isinstance(data, dict):
            return None
        self.client = data
        self.connected = True
        tz = data.get("timeZone")
        if tz and tz != self.time_zone:
            self.get_time_from_server()
        name = data.get("name")
        if self.update_room_number and name and ":" not in str(name):
            self.server_room_num = SETTINGS.get("iptv_room_number") or ""
            if self.server_room_num != name:
                SETTINGS.set("iptv_room_number", name)
                self.note("UpdateClient: unit number set to %r (was %r)"
                          % (name, self.server_room_num))
        return data

    def get_time_from_server(self):
        try:
            data = API.get_time()
        except Exception as e:
            self._fail("GetCurrentTimeAndZone", e)
            return None
        if isinstance(data, dict):
            self.time_zone = data.get("timeZone") or self.time_zone
            try:
                self.server_time_mills = int(data.get("timeMills") or 0)
            except (TypeError, ValueError):
                pass
            self.note("GetCurrentTimeAndZone ok: %s %s"
                      % (data.get("timeMills"), self.time_zone or ""))
        return data

    def get_ping_ser_img_data(self):
        """BaseApplication.getPingSerImgData() + $5: GetAdvImage?type=11 becomes
        the boot-screen background (IptvSP.setPingSerBgImg)."""
        try:
            lst = API.get_adv_image(11)
        except Exception as e:
            self._fail("GetAdvImage?type=11", e)
            return
        items = [x for x in (lst if isinstance(lst, list) else []) if x]
        if not items:
            return
        self.is_get_ping_ser_img = False
        SETTINGS.set("ping_server_bg_image", SETTINGS.image_path(items[0]))
        self.note("boot background: %s" % items[0])

    def get_force_change_program(self):
        """BaseApplication.getForceChangeProgram() - GetInStream (even ticks)."""
        try:
            API.get_in_stream()
        except Exception:
            pass                              # the APK ignores this one silently

    def get_data_from_server(self):
        """BaseApplication.getDataFromServer(), in order."""
        self.get_settings_from_server()
        if self.is_get_ping_ser_img:
            self.get_ping_ser_img_data()
        if self.times1 % 2 == 0:
            self.times1 = 0
            self.update_client()
            if self.is_get_pms_data:
                self.get_pms_status()
        self.times1 += 1
        now = int(time.time() * 1000)
        if not self.connected or (now - self.system_cur_time) > DAY_MS:
            self.system_cur_time = now
            self.get_time_from_server()

    # ---- address adoption + sweep ---------------------------------------- #
    def adopt_server(self, ip, port, why):
        port = _port(port, SETTINGS.get("server_port"))
        old = SETTINGS.address()
        SETTINGS.set("server_ip", ip)
        SETTINGS.set("other_server_ip", ip)
        SETTINGS.set("server_port", port)
        self.note("server address adopted from %s: %s (was %s)" % (why, SETTINGS.address(), old))
        self.is_get_client = True
        self.get_settings_from_server()
        WS.start()

    def sweep_for_head_end(self):
        """Windows-port aid: try the addresses a building head-end usually has.
        Only runs when the APK's own paths (stored address + UDP announce) did
        not produce a GetSettings answer."""
        if self.sweep["running"] or not SWEEP_ENABLED:
            return None
        self.sweep["running"] = True

        def log(msg):
            self.sweep["log"].append(msg)
            self.note("sweep: " + msg)

        def answers(ip, port):
            try:
                sk = socket.create_connection((ip, int(port)), timeout=SWEEP_PORT_TIMEOUT)
                sk.close()
            except Exception:
                return False
            url = "http://%s:%s/iptv2/GetSettings" % (ip, port)
            try:
                data, _ct, _st = http_get(url, timeout=SWEEP_HTTP_TIMEOUT)
                obj = json.loads(data.decode("utf-8", "replace"))
                return isinstance(obj, dict) and bool(obj)
            except Exception:
                return False

        try:
            port = _port(SETTINGS.get("server_port"))
            gw = default_gateway()
            mine, hosts = local_subnet()
            first = [SETTINGS.get("server_ip"), DEFAULTS["server_ip"],
                     SETTINGS.get("other_server_ip"), gw,
                     mine.rsplit(".", 1)[0] + ".1" if check_ipaddress(mine) else "",
                     mine.rsplit(".", 1)[0] + ".254" if check_ipaddress(mine) else ""]
            seen, ordered = set(), []
            for ip in first:
                if ip and check_ipaddress(ip) and ip not in seen:
                    seen.add(ip)
                    ordered.append(ip)
            log("candidates: %s (gateway %s, local %s)" % (", ".join(ordered), gw or "-", mine))
            for ip in ordered:
                self.sweep["tried"] += 1
                if answers(ip, port):
                    log("head-end answered on %s:%s" % (ip, port))
                    self.sweep["found"] = "%s:%s" % (ip, port)
                    self.adopt_server(ip, port, "sweep")
                    return ip
            if not self.connected and hosts:
                log("scanning %d host(s) of %s/24 on port %d" % (len(hosts), mine.rsplit(".", 1)[0], port))
                found = []

                def probe(ip):
                    self.sweep["tried"] += 1
                    if answers(ip, port):
                        found.append(ip)

                threads = [threading.Thread(target=probe, args=(h,), daemon=True) for h in hosts]
                for t in threads[:64]:
                    t.start()
                for t in threads[:64]:
                    t.join(timeout=SWEEP_PORT_TIMEOUT + SWEEP_HTTP_TIMEOUT + 1)
                for chunk in range(64, len(threads), 64):
                    for t in threads[chunk:chunk + 64]:
                        t.start()
                    for t in threads[chunk:chunk + 64]:
                        t.join(timeout=SWEEP_PORT_TIMEOUT + SWEEP_HTTP_TIMEOUT + 1)
                    if found:
                        break
                if found:
                    ip = sorted(found, key=lambda x: int(x.rsplit(".", 1)[1]))[0]
                    log("head-end answered on %s:%s" % (ip, port))
                    self.sweep["found"] = "%s:%s" % (ip, port)
                    self.adopt_server(ip, port, "sweep")
                    return ip
                log("no head-end answered on this subnet")
            return None
        finally:
            self.sweep["running"] = False
            self.sweep["done"] = True

    # ---- the two APK loops ----------------------------------------------- #
    def app_tick(self):
        """BaseApplication$1.run() - Timer(task, 2000, 5000)."""
        if self.settings is not None and (self.times % 2) == 0:
            self.get_force_change_program()
        if self.times in (0, 5):
            self.times = 0
            self.get_client_from_server()
            self.get_data_from_server()
        self.times += 1

    def ping_tick(self):
        """PingServerActivity$2.run() - Timer(task, 0, 2000), 20 attempts."""
        if self.welcome is not None:
            return True                                   # isLeave: the timer is cancelled
        self.ping_times += 1
        if self.ping_times != PING_MAX_ATTEMPTS:
            self.get_settings_from_server()               # BaseApplication.getSettingsFromServer()
            self.ping_get_settings_from_server()          # the activity's own call
        else:
            self.note("ping: %d attempts without an answer -> welcome with layout 0"
                      % PING_MAX_ATTEMPTS)
            self.open_welcome(False, 0)
        return self.welcome is not None

    def ping_get_settings_from_server(self):
        """PingServerActivity.getSettingsFromServer() + $3: on the first parsed
        answer it stores the language/layout and opens the welcome screen."""
        data = self.get_settings_from_server()
        if not isinstance(data, dict) or self.welcome is not None:
            return
        layout = data.get("layout")
        if layout is not None:
            SETTINGS.set("app_layout_style", layout)
        lang = data.get("language")
        if lang is not None:
            SETTINGS.set("select_language_flag", lang)
        self.open_welcome(bool(data.get("advVideoEM")),
                          SETTINGS.get("app_layout_style", 0), lang)

    def open_welcome(self, adv_video_em, layout, language=None):
        """PingServerActivity.openWelcomeActivity(advVideoEM, layout[, language]):
        advVideoEM -> BootVideoActivity, layout 0 -> WelcomeStyleZeroActivity,
        any other layout (5 included, a decompiler artefact) -> WelcomeStyleOther."""
        if self.welcome is not None:
            return
        if self.settings is not None:
            SETTINGS.set("app_layout_style", layout)
        style = SETTINGS.get("app_layout_style", 0)
        if adv_video_em:
            screen = "bootvideo"
        elif style == 0 or style == 5:
            screen = "welcome_zero"
        else:
            screen = "welcome_other"
        self.welcome = {"advVideoEM": bool(adv_video_em), "layout": style,
                        "language": language, "screen": screen,
                        "connected": self.connected,
                        "main": "MainStyleThird" if style == 0 else "MainStyleFourth"}
        self.phase = "welcome"
        self.note("openWelcomeActivity(advVideoEM=%s, layout=%s) -> %s / %s"
                  % (adv_video_em, style, screen, self.welcome["main"]))

    def skip_ping(self):
        """PingServerActivity.onKeyDown(): any key leaves the boot screen at once."""
        if self.welcome is None:
            st = self.settings or {}
            self.open_welcome(bool(st.get("advVideoEM")),
                              int(st.get("layout") or SETTINGS.get("app_layout_style", 0) or 0),
                              st.get("language"))
            self.note("ping: left by a key press")
        return self.welcome

    def ping_loop(self):
        time.sleep(PING_INTERVAL)                    # the first tick sleeps 2 s
        while not self._stop.is_set() and self.welcome is None:
            try:
                done = self.ping_tick()
            except Exception as e:
                self._fail("ping tick", e)
                done = False
            if done:
                break
            self._stop.wait(PING_INTERVAL)

    def app_loop(self):
        while not self._stop.is_set():
            if self._stop.wait(APP_TIMER_PERIOD):
                break
            try:
                self.app_tick()
            except Exception as e:
                self._fail("maintenance loop", e)

    def sweep_loop(self):
        """Runs after the boot phase: if the APK's own paths found nothing, look
        for the head-end on the local subnet (Windows-port aid)."""
        self._stop.wait(PING_MAX_ATTEMPTS * PING_INTERVAL + 2)
        if self._stop.is_set() or self.connected:
            return
        self.sweep_for_head_end()
        if self.connected and self.welcome is None:
            self.ping_get_settings_from_server()

    # ---- lifecycle -------------------------------------------------------- #
    def on_create(self):
        """BaseApplication.onCreate(), in the APK's order."""
        self.started = time.time()
        self.system_cur_time = int(time.time() * 1000)
        self.note("onCreate: mac=%s iface=%s ip=%s server=%s"
                  % (SETTINGS.get("device_mac"), NETWORK.get("iface"),
                     NETWORK.get("ip"), SETTINGS.address()))
        # BaseApplication runs these in order, but on a real Windows box any one
        # of them can throw (odd adapter, proxy, code page, ...); a dead step
        # must never stop the chain or the PingServerActivity timers.
        for step in (self.get_pms_status, self.get_client_from_server,
                     self.get_data_from_server, self.start_server_ip_thread,
                     self.get_time_from_server, WS.start):
            try:
                step()
            except Exception as e:
                self._fail("onCreate:%s" % getattr(step, "__name__", "step"), e)
        self.phase = "ping"
        for target, name in ((self.app_loop, "iptv-app-timer"),
                             (self.ping_loop, "iptv-ping-timer"),
                             (self.sweep_loop, "iptv-sweep")):
            try:
                th = threading.Thread(target=target, daemon=True, name=name)
                th.start()
                self._threads.append(th)
            except Exception as e:
                self._fail("thread:%s" % name, e)

    def start_server_ip_thread(self):
        """BaseApplication.startServerIpThread() - at most 180 listener threads."""
        if self.discovery.is_alive():
            return
        self.server_ip_times += 1
        if self.server_ip_times > DISCOVERY_MAX_THREADS:
            return
        self.discovery = ServerDiscovery(self)
        self.discovery.start()

    def retry(self):
        """Settings -> "reconnect": the whole boot handshake again."""
        self.note("retry requested by the user")
        self.connected = False
        self.welcome = None
        self.ping_times = 0
        self.times = 0
        self.times1 = 0
        self.is_get_client = True
        self.is_get_ping_ser_img = True
        self.phase = "ping"
        self.sweep["done"] = False
        self.sweep["found"] = None
        self.get_client_from_server()
        self.get_data_from_server()
        self.start_server_ip_thread()
        threading.Thread(target=self.ping_loop, daemon=True, name="iptv-ping-retry").start()
        threading.Thread(target=self.sweep_loop, daemon=True, name="iptv-sweep-retry").start()
        return self.state()


CONNECTION = ConnectionEngine()


def _thread_excepthook(args):
    """A thread that dies silently is exactly how the boot screen froze on the
    field: log it into the engine (and backend.log) instead."""
    import traceback
    name = getattr(args.thread, "name", "?")
    CONNECTION.note("thread %s died: %r" % (name, args.exc_value))
    tb = "".join(traceback.format_exception(args.exc_type, args.exc_value,
                                            args.traceback)).strip()
    if tb:
        CONNECTION.note(tb[-900:])


threading.excepthook = _thread_excepthook


# --------------------------------------------------------------------------- #
# v2.7.2.06 local features
#   * SettingAppShowActivity + database/app.db  -> "APP show in menu"
#   * use_vlc_paly_live_prg                     -> hand playback to VLC
#   * util.BootReceiver                         -> start with Windows
# --------------------------------------------------------------------------- #
RUN_KEY = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
RUN_NAME = "PARDIK-SMART-IPTV"


# --------------------------------------------------------------------------- #
# Optional external channel list (m3u / m3u8 playlist)
#   A residential head-end is usually published as a plain playlist rather than
#   through the platform's GetLiveTV table. When it is enabled, the parsed
#   entries become the live channel list (group-title -> package) and the server
#   list is the fallback.
# --------------------------------------------------------------------------- #
def m3u_file():
    return os.path.join(data_dir(), "m3u.json")


def parse_m3u(text):
    out = []
    name, group, logo = "", "", ""
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.upper().startswith("#EXTINF"):
            attrs = dict(re.findall(r'([\w-]+)\s*=\s*"([^"]*)"', line))
            group = attrs.get("group-title") or group or ""
            logo = attrs.get("tvg-logo") or ""
            name = attrs.get("tvg-name") or (line.split(",", 1)[1].strip() if "," in line else "")
        elif line.startswith("#"):
            continue
        else:
            out.append({"id": "m3u-%d" % (len(out) + 1), "number": len(out) + 1,
                        "name": name or line, "url": line,
                        "group": group or "Channels", "logo": logo})
            name, logo = "", ""
    return out


def load_m3u():
    d = {"enabled": False, "url": "", "path": "", "text": "", "channels": [],
         "error": "", "updated": 0}
    try:
        with open(m3u_file(), "r", encoding="utf-8") as f:
            d.update(json.load(f))
    except Exception:
        pass
    return d


def save_m3u(d):
    try:
        tmp = m3u_file() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        os.replace(tmp, m3u_file())
    except Exception:
        pass
    return d


def refresh_m3u(d):
    """Read the playlist from url / path / pasted text and parse it."""
    text, err = d.get("text") or "", ""
    try:
        if d.get("url"):
            data, ctype, st = http_get(d["url"], timeout=25)
            if st != 200:
                err = "HTTP %s" % st
            text = data.decode("utf-8", "replace") if isinstance(data, bytes) else (data or "")
        elif d.get("path"):
            with open(os.path.expanduser(d["path"]), "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
    except Exception as e:
        err = str(e)
    chans = parse_m3u(text)
    d["channels"] = chans
    d["error"] = err or ("" if chans else "playlist is empty")
    d["updated"] = int(time.time())
    if not d.get("text") and text:
        d["text"] = text[:200000]        # keep a copy so the list survives offline
    return save_m3u(d)


def diagnose():
    """Pre-flight check for live playback: is the head-end reachable, does it hand
    out channels, and can this machine actually play the URLs it returns?
    Everything the UI shows in Settings -> "Connection check" comes from here."""
    out = {
        "mode": APP_MODE,
        "server": {"ip": SETTINGS.get("server_ip"), "port": SETTINGS.get("server_port"),
                   "rtsp_port": SETTINGS.get("rtsp_port"), "address": SETTINGS.address()},
        "unit": SETTINGS.get("iptv_room_number") or "",
        "network": {k: NETWORK.get(k) for k in ("mac", "iface", "kind", "ip", "wired")},
        "ffmpeg": bool(find_ffmpeg()),
        "ffmpeg_path": find_ffmpeg() or "",
        "vlc": bool(find_vlc()),
        "checks": [], "issues": [], "ok": True,
    }

    def chk(name, ok, detail="", hint=""):
        """hint is only reported when the check fails, so a green line never
        carries advice that reads like a problem."""
        ok = bool(ok)
        out["checks"].append({"name": name, "ok": ok,
                              "detail": detail if ok else (detail or hint),
                              "hint": "" if ok else hint})
        if not ok:
            out["ok"] = False
            out["issues"].append(hint or detail or name)

    # 1. the cable itself: a MAC and an IP that is not APIPA/self-assigned
    wired = bool(NETWORK.get("wired"))
    ip = NETWORK.get("ip") or ""
    chk("network_adapter", bool(NETWORK.get("mac")),
        "%s (%s) mac=%s ip=%s" % (NETWORK.get("iface") or "-", NETWORK.get("kind") or "-",
                                  NETWORK.get("mac") or "-", ip or "-"),
        "هیچ کارت شبکهٔ فیزیکی‌ای پیدا نشد؛ کابل شبکه را بررسی کنید.")
    if not wired:
        out["checks"].append({"name": "wired_link", "ok": False,
                              "detail": "کارت شبکهٔ انتخاب‌شده %s است" % (NETWORK.get("kind") or "-"),
                              "hint": "ترجیح با کابل شبکه است: کابل را وصل کنید و «اتصال مجدد به سرور» را بزنید."})
    if ip.startswith("169.254."):
        out["checks"].append({"name": "ip_address", "ok": False, "detail": ip,
                              "hint": "آی‌پی 169.254.x.x یعنی DHCP روی LAN پاسخ نداده؛ با مدیر مجتمع "
                                      "بررسی کنید یا آی‌پی ثابت ست کنید."})

    # 2. TCP to the head-end (fast, tells a wrong IP from a blocked port)
    tcp_ms, tcp_err = None, ""
    try:
        t0 = time.time()
        sk = socket.create_connection((str(SETTINGS.get("server_ip")), int(SETTINGS.get("server_port"))), timeout=4)
        sk.close()
        tcp_ms = int((time.time() - t0) * 1000)
    except Exception as e:
        tcp_err = str(e)
    chk("tcp_head_end", tcp_ms is not None,
        ("%d ms" % tcp_ms) if tcp_ms is not None else tcp_err,
        "به %s نمی‌رسیم؛ آی‌پی/پورت هداند را در تنظیمات وارد کنید (پیش‌فرض کارخانه %s "
        "است و ممکن است مال شبکهٔ شما نباشد)." % (SETTINGS.address(), DEFAULT_SERVER_HINT))

    # 3. the APK's own handshake: is the boot loop connected, and did the
    #    head-end announce itself on UDP 27777 (BaseApplication$3)?
    conn = CONNECTION.state()
    out["connection"] = {k: conn[k] for k in ("connected", "phase", "ping_times", "ping_max",
                                              "last_error", "server_room_num", "enabled")}
    out["discovery"] = conn["discovery"]
    out["sweep"] = conn["sweep"]
    disc = conn["discovery"]
    chk("udp_announce", bool(disc.get("bound")),
        ("UDP %s فعال، %d بسته" % (disc.get("port"), disc.get("packets") or 0))
        if disc.get("bound") else (disc.get("error") or "شنونده بسته است"),
        "شنوندهٔ UDP %s بالا نیامد؛ اگر برنامهٔ دیگری این پورت را گرفته آن را ببندید. "
        "هداند پاردیک آدرسش را روی همین پورت اعلام می‌کند." % disc.get("port"))
    if disc.get("packets"):
        out["checks"].append({"name": "server_announce", "ok": bool(disc.get("last")),
                              "detail": json.dumps(disc.get("last") or {}, ensure_ascii=False),
                              "hint": ""})
    chk("handshake", bool(conn.get("connected")),
        "connected=%s phase=%s تلاش %d/%d" % (conn.get("connected"), conn.get("phase"),
                                              conn.get("ping_times"), conn.get("ping_max")),
        "دست‌دادن GetSettings انجام نشد؛ برنامه مثل نرم‌افزار برج ۲۰ بار هر ۲ ثانیه تلاش "
        "می‌کند و تا پاسخ نگیرد وارد منوی پخش زنده نمی‌شود. آدرس هداند را در تنظیمات "
        "وارد کنید یا «جستجوی هداند» را بزنید.")

    # 4. the platform contract: GetSettings then the live tables
    st = None
    if tcp_ms is not None:
        try:
            st = API.get_settings()
            chk("get_settings", isinstance(st, dict),
                "protocol=%s showPackage=%s epg=%s activeAdv=%s" % (
                    (st or {}).get("protocol"), (st or {}).get("showPackage"),
                    (st or {}).get("epg"), (st or {}).get("activeAdv")),
                "GetSettings پاسخ نداد؛ سرویس iptv2 روی سرور در حال اجرا نیست؟")
        except Exception as e:
            chk("get_settings", False, str(e),
                "GetSettings خطا داد: %s" % e)

    chans, pkgs = [], []
    if isinstance(st, dict):
        try:
            pkgs = API.get_live_packages() or []
        except Exception:
            pkgs = []
        try:
            chans = API.get_live_tv(-1) or []
        except Exception as e:
            chk("get_live_tv", False, str(e), "GetLiveTV خطا داد: %s" % e)
        if chans:
            chk("get_live_tv", True, "%d کانال در %d بسته" % (len(chans), len(pkgs) or 0), "")
        else:
            chk("get_live_tv", False, "هیچ کانالی برنگشت",
                "سرور کانالی برای این MAC/واحد برنگرداند؛ ثبت دستگاه در پنل پردیک را بررسی کنید.")

    # 5. can those URLs be played here?
    kinds = {}
    for c in chans:
        for f in ("hlsUrl", "httpUrl", "rtspUrl", "url"):
            v = c.get(f) or ""
            if v:
                kinds[classify(v)] = kinds.get(classify(v), 0) + 1
                break
    out["source_kinds"] = kinds
    proto = ((st or {}).get("protocol") or "").lower()
    out["protocol"] = proto or "(بدون protocol؛ انتخاب خودکار hls→http→url→rtsp)"
    needs_ff = bool(kinds.get("rtsp") or kinds.get("udp") or kinds.get("mpegts")) or proto in ("rtsp", "udp")
    if chans or needs_ff:
        chk("ffmpeg", out["ffmpeg"], out["ffmpeg_path"] or "پیدا نشد",
            "کانال‌های RTSP/TS/UDP بدون FFmpeg پخش نمی‌شوند: فایل ffmpeg.exe را در "
            "tools\\ کنار برنامه بگذارید (نصب‌کننده خودش از PyPI می‌گیرد).")

    # 6. the alternative source: an m3u playlist from the head-end
    m = m3u_public(load_m3u())
    out["m3u"] = {k: v for k, v in m.items() if k != "channels"}
    if m.get("enabled"):
        chk("m3u", bool(m.get("count")), "%d کانال از %s" % (m.get("count") or 0, m.get("url") or m.get("path") or "-"),
            "فهرست m3u خوانده نشد: %s" % (m.get("error") or "خطای نامشخص"))
    out["sample_channels"] = [
        {"number": c.get("number"), "name": c.get("name") or c.get("name_1") or "",
         "src": (c.get("hlsUrl") or c.get("httpUrl") or c.get("url") or c.get("rtspUrl") or "")[:120],
         "kind": classify(c.get("hlsUrl") or c.get("httpUrl") or c.get("url") or c.get("rtspUrl") or "")}
        for c in chans[:6]]
    return out


def m3u_public(d):
    return {"enabled": bool(d.get("enabled")), "url": d.get("url", ""),
            "path": d.get("path", ""), "error": d.get("error", ""),
            "updated": d.get("updated", 0), "count": len(d.get("channels") or []),
            "groups": sorted({c.get("group") or "" for c in (d.get("channels") or [])}),
            "channels": d.get("channels") or []}


def apps_file():
    return os.path.join(data_dir(), "apps.json")


def load_apps():
    try:
        with open(apps_file(), "r", encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, dict):
            return d
    except Exception:
        pass
    return {"custom": [], "selected": []}


def save_apps(d):
    try:
        with open(apps_file(), "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
    except Exception:
        pass


def installed_apps():
    """Windows equivalent of PackageManager.queryIntentActivities(MAIN):
    everything the user can launch from the Start Menu, plus manually added
    entries (the Android app.db table `app(package_name, name)`)."""
    out = []
    seen = set()
    store = load_apps()
    for a in store.get("custom", []):
        n = (a.get("name") or "").strip()
        p = (a.get("path") or "").strip()
        if n and p and n not in seen:
            seen.add(n)
            out.append({"name": n, "path": p, "custom": True})
    if os.name == "nt":
        roots = []
        for env in ("APPDATA", "ProgramData"):
            base = os.environ.get(env)
            if base:
                roots.append(os.path.join(
                    base, "Microsoft", "Windows", "Start Menu", "Programs"))
        for root in roots:
            for dp, _dn, fn in os.walk(root):
                for f in fn:
                    if not f.lower().endswith(".lnk"):
                        continue
                    name = os.path.splitext(f)[0]
                    if name in seen or name.lower().startswith("uninstall"):
                        continue
                    seen.add(name)
                    out.append({"name": name,
                                "path": os.path.join(dp, f),
                                "custom": False})
    out.sort(key=lambda a: a["name"].lower())
    return out


def launch_app(name):
    for a in installed_apps():
        if a["name"] == name:
            if os.name == "nt":
                os.startfile(a["path"])  # noqa - Windows only
            else:
                subprocess.Popen(["xdg-open", a["path"]])
            return {"ok": True, "app": name}
    return {"ok": False, "error": "app not found"}


def find_vlc():
    """org.videolan.vlc on Android -> vlc.exe on Windows."""
    cands = [os.environ.get("IPTV_VLC")] if os.environ.get("IPTV_VLC") else []
    if os.name == "nt":
        for base in (os.environ.get("ProgramFiles"),
                     os.environ.get("ProgramFiles(x86)"),
                     os.environ.get("LOCALAPPDATA")):
            if base:
                cands.append(os.path.join(base, "VideoLAN", "VLC", "vlc.exe"))
    else:
        for b in ("/usr/bin/vlc", "/usr/local/bin/vlc", "/snap/bin/vlc"):
            cands.append(b)
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def play_with_vlc(url, title=""):
    """Mirrors LivePlayerActivity.playWithVlc(): if VLC is missing the Android
    app toasts `vlc_player_install_tips` and keeps the internal player."""
    vlc = find_vlc()
    if not vlc or not url:
        return {"ok": False, "installed": bool(vlc), "reason": "not_installed"}
    args = [vlc, "--play-and-exit", "--no-video-title-show"]
    if title:
        args += ["--meta-title=" + title]
    args.append(url)
    try:
        subprocess.Popen(args, close_fds=True)
        return {"ok": True, "installed": True, "player": vlc}
    except Exception as e:
        return {"ok": False, "installed": True, "reason": str(e)}


def autostart_state():
    if os.name != "nt":
        return bool(SETTINGS.get("autostart"))
    try:
        out = subprocess.run(["reg", "query", RUN_KEY, "/v", RUN_NAME],
                             capture_output=True, timeout=10)
        return out.returncode == 0
    except Exception:
        return bool(SETTINGS.get("autostart"))


def set_autostart(on):
    """util.BootReceiver equivalent: relaunch the app when Windows starts."""
    SETTINGS.set("autostart", bool(on))
    if os.name != "nt":
        return {"ok": True, "enabled": bool(on), "note": "non-windows: stored only"}
    try:
        if on:
            exe = sys.argv[0]
            cmd = '"%s"' % os.path.abspath(exe)
            subprocess.run(["reg", "add", RUN_KEY, "/v", RUN_NAME,
                            "/t", "REG_SZ", "/d", cmd, "/f"],
                           capture_output=True, timeout=10)
        else:
            subprocess.run(["reg", "delete", RUN_KEY, "/v", RUN_NAME, "/f"],
                           capture_output=True, timeout=10)
        return {"ok": True, "enabled": autostart_state()}
    except Exception as e:
        return {"ok": False, "error": str(e)}

# --------------------------------------------------------------------------- #
# FFmpeg stream engine  (RTSP / MPEG-TS / UDP  ->  HLS for the browser)
# --------------------------------------------------------------------------- #
FFMPEG = None


# Where the self-heal drop lands: <install>\tools by default, overridable for
# tests so a verification run never writes into the repository.
FF_DIR = os.environ.get("IPTV_FFMPEG_DIR") or os.path.join(os.path.dirname(HERE), "tools")


def find_ffmpeg():
    global FFMPEG
    if FFMPEG:
        return FFMPEG
    cands = []
    env = os.environ.get("IPTV_FFMPEG")
    if env:
        cands.append(env)
    cands.append(os.path.join(FF_DIR, "ffmpeg.exe"))
    cands.append(os.path.join(FF_DIR, "ffmpeg"))
    tools = os.path.join(os.path.dirname(HERE), "tools")
    cands.append(os.path.join(tools, "ffmpeg.exe"))
    cands.append(os.path.join(tools, "ffmpeg"))
    cands.append("ffmpeg")
    cands.append("ffmpeg.exe")
    for c in cands:
        try:
            if os.path.sep in c or c in ("ffmpeg", "ffmpeg.exe"):
                p = subprocess.run([c, "-version"], stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=10)
                if p.returncode == 0:
                    FFMPEG = c
                    return c
        except Exception:
            continue
    return None


# --------------------------------------------------------------------------- #
# FFmpeg self-heal: the installer's PowerShell download can die on old TLS
# stacks or a blocked PyPI, and a building LAN is sometimes offline at install
# time but online later. Python's urllib speaks modern TLS, so the backend can
# fetch the same static Windows build (the ffmpeg.exe inside the imageio-ffmpeg
# wheel) into <install>\tools\ while the app runs, and the UI replays the
# channel the moment it lands.
# --------------------------------------------------------------------------- #
FFMPEG_FETCH = {"running": False, "done": False, "error": "", "path": "", "bytes": 0}
FFMPEG_PINNED = ("https://files.pythonhosted.org/packages/82/0c/a1d49f3dd268bbbd750b4986f8e271ad11f8e729a896070ea25f587b44da8/"
                 "imageio_ffmpeg-0.8.1-py3-none-win_amd64.whl")


def ffmpeg_fetch_enabled():
    return os.environ.get("IPTV_FFMPEG_FETCH", "1") not in ("0", "false", "no")


def ffmpeg_fetch_state():
    d = dict(FFMPEG_FETCH)
    d["enabled"] = ffmpeg_fetch_enabled()
    return d


def ensure_ffmpeg(reason=""):
    if not ffmpeg_fetch_enabled():
        FFMPEG_FETCH["error"] = "disabled (IPTV_FFMPEG_FETCH=0)"
        return ffmpeg_fetch_state()
    if FFMPEG_FETCH["running"] or FFMPEG_FETCH["done"] or find_ffmpeg():
        return ffmpeg_fetch_state()
    FFMPEG_FETCH["running"] = True
    threading.Thread(target=_ffmpeg_fetch_loop, args=(reason,), daemon=True,
                     name="ffmpeg-fetch").start()
    return ffmpeg_fetch_state()


def _ffmpeg_fetch_loop(reason):
    global FFMPEG
    tmp = ""
    try:
        CONNECTION.note("ffmpeg: self-heal download started (%s)" % reason)
        urls = []
        try:
            data, _ct, _st = http_get("https://pypi.org/pypi/imageio-ffmpeg/json", timeout=20)
            for u in json.loads(data.decode("utf-8", "replace")).get("urls", []):
                if "win_amd64.whl" in (u.get("filename") or ""):
                    urls.append(u.get("url"))
        except Exception as e:
            CONNECTION.note("ffmpeg: PyPI json failed: %r" % (e,))
        urls.append(FFMPEG_PINNED)
        os.makedirs(FF_DIR, exist_ok=True)
        tmp = os.path.join(FF_DIR, "ffmpeg-wheel.zip.tmp")
        last = None
        for u in urls:
            try:
                req = urllib.request.Request(u, headers={
                    "User-Agent": "PARDIK-SMART-IPTV-Win/%s" % APP_VERSION_NAME})
                with _NO_PROXY.open(req, timeout=300) as r, open(tmp, "wb") as f:
                    while True:
                        chunk = r.read(1 << 16)
                        if not chunk:
                            break
                        f.write(chunk)
                        FFMPEG_FETCH["bytes"] += len(chunk)
                last = None
                break
            except Exception as e:
                last = e
        if last is not None:
            raise last
        import zipfile as _zf
        with _zf.ZipFile(tmp) as z:
            member = next((n for n in z.namelist()
                           if n.lower().endswith(".exe") and "ffmpeg" in n.lower()), None)
            if not member:
                raise IOError("no ffmpeg exe inside the wheel")
            blob = z.read(member)
        dest = os.path.join(FF_DIR, "ffmpeg.exe")
        with open(dest, "wb") as f:
            f.write(blob)
        FFMPEG = None
        ok = bool(find_ffmpeg())
        FFMPEG_FETCH.update(running=False, done=True, path=dest if ok else "",
                            error="" if ok else "extracted but -version failed")
        CONNECTION.note("ffmpeg: installed to %s (ok=%s, %d bytes)"
                        % (dest, ok, FFMPEG_FETCH["bytes"]))
    except Exception as e:
        FFMPEG_FETCH.update(running=False, done=False, error=str(e))
        CONNECTION.note("ffmpeg: self-heal failed: %r" % (e,))
    finally:
        try:
            if tmp and os.path.exists(tmp):
                os.remove(tmp)
        except Exception:
            pass


class StreamSession(object):
    """One ffmpeg -> HLS remux job."""

    def __init__(self, key, source, protocol):
        self.key = key
        self.source = source
        self.protocol = protocol
        self.dir = os.path.join(data_dir(), "hls", key)
        os.makedirs(self.dir, exist_ok=True)
        self.playlist = os.path.join(self.dir, "index.m3u8")
        self.proc = None
        self.started = time.time()
        self.last_use = time.time()
        self.error = None
        self.restarting = False
        self.restarts = 0
        self.codec = ""                    # probed: "hevc (main10)" / "h264 ..."
        self.log = collections.deque(maxlen=40)   # ffmpeg stderr tail

    def start(self):
        ff = find_ffmpeg()
        if not ff:
            self.error = "ffmpeg-missing"
            return False
        args = [ff, "-hide_banner", "-loglevel", "error", "-y"]
        if self.protocol == "rtsp":
            args += ["-rtsp_transport", "tcp"]
        args += ["-i", self.source,
                 "-c", "copy",
                 "-f", "hls",
                 "-hls_time", "2",
                 "-hls_list_size", "6",
                 "-hls_flags", "delete_segments+append_list",
                 "-hls_segment_filename", os.path.join(self.dir, "seg%05d.ts"),
                 self.playlist]
        try:
            self.proc = subprocess.Popen(
                args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except Exception as e:
            self.error = str(e)
            return False
        # Nobody reading a PIPE lets it fill up (64 KB) and then ffmpeg blocks
        # forever mid-remux - which on a chatty stream looks exactly like
        # "Decoding video failed!" in the browser. Drain it, keep the tail.
        threading.Thread(target=self._drain, daemon=True, name="ff-stderr").start()
        threading.Thread(target=self._probe, daemon=True, name="ff-probe").start()
        return True

    def _drain(self):
        try:
            for line in iter(self.proc.stderr.readline, b""):
                txt = line.decode("utf-8", "replace").strip()
                if txt:
                    self.log.append(txt)
        except Exception:
            pass

    def _probe(self):
        """Read the stream header once so the UI can name the real codec
        (an H.265 head-end cannot be decoded by Edge's MSE - the player must
        say so and hand over to VLC instead of a generic banner)."""
        try:
            ff = find_ffmpeg()
            if not ff:
                return
            p = subprocess.Popen([ff, "-hide_banner", "-i", self.source,
                                  "-t", "0", "-f", "null", "-"],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            try:
                err = (p.communicate(timeout=8)[1] or b"").decode("utf-8", "replace")
            except Exception:
                try: p.kill()
                except Exception: pass
                return
            v = re.search(r"Video: ([^,\r\n]+)", err)
            a = re.search(r"Audio: ([^,\r\n]+)", err)
            self.codec = " / ".join(x.group(1).strip() for x in (v, a) if x)
        except Exception:
            pass

    def alive(self):
        return self.proc is not None and self.proc.poll() is None

    def check(self):
        """Record a hard failure when ffmpeg exited non-zero (bad source), and
        give a session that died mid-watch one automatic restart (a flaky
        RTSP hop must not strand the viewer on an error banner)."""
        if self.proc is not None and self.proc.poll() not in (None, 0):
            if not os.path.exists(self.playlist):
                self.error = "ffmpeg exit %s %s" % (
                    self.proc.poll(), " | ".join(list(self.log)[-4:]))
            if (not self.restarting and self.restarts < 2
                    and time.time() - self.last_use < 60):
                self.restarts += 1
                self.restarting = True
                threading.Thread(target=self._restart, daemon=True,
                                 name="ff-restart").start()

    def _restart(self):
        time.sleep(1.0)
        self.proc = None
        self.restarting = False
        self.start()

    def stop(self):
        try:
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
                self.proc.wait(timeout=3)
        except Exception:
            pass


class StreamEngine(object):
    def __init__(self):
        self.sessions = {}
        self.lock = threading.RLock()
        threading.Thread(target=self._reaper, daemon=True).start()

    def _reaper(self):
        while True:
            time.sleep(20)
            now = time.time()
            with self.lock:
                # keep finished (finite/VOD) sessions so their segments stay
                # playable; drop only sessions idle for >2 minutes.
                dead = [k for k, s in self.sessions.items()
                        if now - s.last_use > 120]
                for k in dead:
                    s = self.sessions.pop(k, None)
                    if s:
                        s.stop()

    def key_for(self, source):
        return hashlib.md5(source.encode("utf-8")).hexdigest()[:16]

    def ensure(self, source, protocol):
        key = self.key_for(source)
        with self.lock:
            s = self.sessions.get(key)
            live = protocol in ("rtsp", "udp")
            if s is None or (live and not s.alive() and s.error is None
                             and not s.restarting):
                if s is not None:
                    s.restarting = True
                    s.stop()
                s = StreamSession(key, source, protocol)
                self.sessions[key] = s
                if not s.start():
                    return s
            s.last_use = time.time()
            return s

    def playlist_for(self, source, protocol):
        s = self.ensure(source, protocol)
        # wait briefly for the first playlist
        for _ in range(60):
            if os.path.exists(s.playlist):
                break
            time.sleep(0.25)
        return s

    def status(self):
        with self.lock:
            return [{
                "key": s.key, "source": s.source, "protocol": s.protocol,
                "alive": s.alive(), "error": s.error,
                "age": int(time.time() - s.started),
                "codec": s.codec, "restarts": s.restarts,
                "log": list(s.log)[-6:],
            } for s in self.sessions.values()]


STREAMS = StreamEngine()


def choose_play_source(item, settings_obj=None):
    """Replicates Android protocol selection over LiveTV/VodVideo fields."""
    s = settings_obj or SETTINGS
    try:
        proto = (s.get("_server_protocol") or "rtsp").lower()
    except Exception:
        proto = "rtsp"
    rtsp = item.get("rtspUrl") or ""
    hls = item.get("hlsUrl") or ""
    http = item.get("httpUrl") or ""
    url = item.get("url") or ""
    if proto == "hls" and hls:
        return hls, "hls"
    if proto == "http" and http:
        return http, "http"
    if proto == "udp" and url.startswith("udp"):
        return url, "udp"
    if proto == "rtsp" and rtsp:
        return rtsp, "rtsp"
    # graceful fallbacks
    for cand, p in ((hls, "hls"), (http, "http"), (url, "auto"), (rtsp, "rtsp")):
        if cand:
            return cand, p
    return url or rtsp or http or hls, proto


def classify(url):
    u = url.lower()
    if u.startswith("rtsp://"):
        return "rtsp"
    if u.startswith("udp://") or u.startswith("rtp://"):
        return "udp"
    if ".m3u8" in u:
        return "hls"
    if u.endswith(".ts") or "/ts" in u or u.startswith("http") and ".ts?" in u:
        return "mpegts"
    return "http"


# --------------------------------------------------------------------------- #
# Minimal RFC-6455 WebSocket client (volume + program control channels)
# --------------------------------------------------------------------------- #
class WsClient(threading.Thread):
    def __init__(self, url, on_message=None, headers=None, heartbeat=20.0,
                 name="ws"):
        super(WsClient, self).__init__(daemon=True)
        self.url = url
        self.on_message = on_message
        self.headers = headers or {}
        self.heartbeat = heartbeat
        self.name = name
        self.sock = None
        self.connected = False
        self.stop_flag = False

    def _connect(self):
        p = urllib.parse.urlsplit(self.url)
        host = p.hostname
        port = p.port or 80
        self.sock = socket.create_connection((host, port), timeout=8)
        key = base64.b64encode(os.urandom(16)).decode()
        path = p.path or "/"
        if p.query:
            path += "?" + p.query
        req = ["GET %s HTTP/1.1" % path,
               "Host: %s:%d" % (host, port),
               "Upgrade: websocket",
               "Connection: Upgrade",
               "Sec-WebSocket-Key: %s" % key,
               "Sec-WebSocket-Version: 13"]
        for k, v in self.headers.items():
            req.append("%s: %s" % (k, v))
        self.sock.sendall(("\r\n".join(req) + "\r\n\r\n").encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise IOError("ws handshake closed")
            resp += chunk
        if b"101" not in resp.split(b"\r\n")[0]:
            raise IOError("ws handshake refused")
        self.connected = True

    def _recv_exact(self, n):
        buf = b""
        while len(buf) < n:
            c = self.sock.recv(n - len(buf))
            if not c:
                raise IOError("ws closed")
            buf += c
        return buf

    def _read_frame(self):
        h = self._recv_exact(2)
        op = h[0] & 0x0F
        masked = h[1] & 0x80
        ln = h[1] & 0x7F
        if ln == 126:
            ln = struct.unpack(">H", self._recv_exact(2))[0]
        elif ln == 127:
            ln = struct.unpack(">Q", self._recv_exact(8))[0]
        mask = self._recv_exact(4) if masked else None
        payload = self._recv_exact(ln) if ln else b""
        if mask:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        return op, payload

    def send_text(self, text):
        if not self.connected:
            return
        data = text.encode("utf-8")
        header = bytearray([0x81])
        n = len(data)
        mask = os.urandom(4)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        header += mask
        body = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        try:
            self.sock.sendall(bytes(header) + body)
        except Exception:
            self.connected = False

    def run(self):
        while not self.stop_flag:
            try:
                self._connect()
                last_hb = time.time()
                while not self.stop_flag:
                    self.sock.settimeout(1.0)
                    try:
                        op, payload = self._read_frame()
                    except socket.timeout:
                        if time.time() - last_hb > self.heartbeat:
                            self.send_text('{"type":"ping"}')
                            last_hb = time.time()
                        continue
                    if op == 0x8:
                        break
                    if op == 0x9:  # ping -> pong
                        self.send_text("")
                        continue
                    if op in (0x1, 0x0) and payload:
                        last_hb = time.time()
                        if self.on_message:
                            try:
                                self.on_message(payload.decode("utf-8", "replace"))
                            except Exception:
                                pass
            except Exception:
                self.connected = False
            self.connected = False
            if not self.stop_flag:
                time.sleep(5)

    def stop(self):
        self.stop_flag = True
        try:
            if self.sock:
                self.sock.close()
        except Exception:
            pass


class WsManager(object):
    """Runs both Android WebSocket services."""

    def __init__(self):
        self.prg = None
        self.vol = None
        self.volume = 45
        self.muted = False
        self.listeners = []
        self.lock = threading.RLock()

    def add_listener(self, fn):
        self.listeners.append(fn)

    def _emit(self, kind, payload):
        for fn in list(self.listeners):
            try:
                fn(kind, payload)
            except Exception:
                pass

    def _on_prg(self, text):
        try:
            msg = json.loads(text)
        except Exception:
            return
        self._emit("prg", msg)

    def _on_vol(self, text):
        try:
            msg = json.loads(text)
        except Exception:
            return
        t = msg.get("type")
        if t == 1:
            self.volume = max(0, min(100, self.volume + int(msg.get("value", 5))))
        elif t == 2:
            self.volume = max(0, min(100, self.volume - int(msg.get("value", 5))))
        elif t == 3:
            self.muted = not self.muted
        elif t == 4:
            self.volume = max(0, min(100, int(msg.get("value", self.volume))))
        self._emit("vol", {"volume": self.volume, "muted": self.muted})

    def start(self):
        with self.lock:
            if self.prg is None or not self.prg.is_alive():
                url = "ws://%s/dx-admin/websocket/%s" % (
                    SETTINGS.ser_address(), SETTINGS.get("device_mac"))
                self.prg = WsClient(url, on_message=self._on_prg, headers={
                    "hotel_id": "1001", "room_number": "1001"}, name="prg")
                self.prg.start()
            room = SETTINGS.get("iptv_room_number")
            if room and (self.vol is None or not self.vol.is_alive()):
                url = "ws://%s/iptv2/websocket/%s" % (
                    SETTINGS.ser_address(), urllib.parse.quote(str(room)))
                self.vol = WsClient(url, on_message=self._on_vol, name="vol")
                self.vol.start()

    def stop(self):
        with self.lock:
            for c in (self.prg, self.vol):
                if c:
                    c.stop()
            self.prg = self.vol = None


WS = WsManager()

# --------------------------------------------------------------------------- #
# Local HTTP server (web UI + API proxy + stream proxy/remux)
# --------------------------------------------------------------------------- #
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".m3u8": "application/vnd.apple.mpegurl",
    ".ts": "video/mp2t",
    ".mp4": "video/mp4",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "PARDIK-IPTV-Win"

    def log_message(self, *a):
        pass

    # ---- helpers ----
    def _send(self, code, body, ctype="application/json; charset=utf-8",
              extra=None, stream=None, length=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        if stream is not None:
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            self._pump(stream)
            return
        if length is not None:
            self.send_header("Content-Length", str(length))
        else:
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _pump(self, gen):
        try:
            for chunk in gen:
                if not chunk:
                    continue
                self.wfile.write(("%x\r\n" % len(chunk)).encode())
                self.wfile.write(chunk)
                self.wfile.write(b"\r\n")
        except Exception:
            pass
        finally:
            try:
                self.wfile.write(b"0\r\n\r\n")
            except Exception:
                pass

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    # ---- routing ----
    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        path = u.path
        q = urllib.parse.parse_qs(u.query)
        try:
            if path == "/" or path == "/index.html":
                return self._static_file(os.path.join(WEB_DIR, "index.html"))
            if path.startswith("/web/"):
                return self._static_file(os.path.join(WEB_DIR, path[5:]))
            if path.startswith("/assets/img/"):
                return self._app_image(path[len("/assets/img/"):])
            if path == "/api/config":
                return self._json({
                    "version": APP_VERSION_NAME,
                    "version_code": APP_VERSION_CODE,
                    "settings": {k: v for k, v in SETTINGS.d.items()
                                 if k != "password"},
                    "server": {
                        "address": SETTINGS.address(),
                        "protocol": SETTINGS.get("_server_protocol", "rtsp"),
                    },
                    "local_ip": detect_local_ip(),
                    "mac": SETTINGS.get("device_mac"),
                    "ffmpeg": bool(find_ffmpeg()),
                    "ffmpeg_fetch": ffmpeg_fetch_state(),
                    "streams": STREAMS.status(),
                    "ws": {"prg": bool(WS.prg and WS.prg.connected),
                           "vol": bool(WS.vol and WS.vol.connected),
                           "volume": WS.volume, "muted": WS.muted},
                    # v2.7.2.06 additions
                    "vlc_installed": bool(find_vlc()),
                    "autostart": autostart_state(),
                    "apps_selected": load_apps().get("selected", []),
                    # residential deployment (Pardik / Ronika Palace Kahak)
                    "mode": APP_MODE,
                    "branding": BRANDING[APP_MODE],
                    "network": {k: NETWORK.get(k) for k in ("mac", "iface", "kind", "ip", "wired")},
                    "m3u": {k: v for k, v in m3u_public(load_m3u()).items() if k != "channels"},
                    # connection handshake (BaseApplication / PingServerActivity)
                    "connection": {k: v for k, v in CONNECTION.state().items()
                                   if k not in ("log", "sweep_log", "client",
                                                "server_settings")},
                })
            if path == "/api/network":
                global NETWORK
                NETWORK = detect_network()
                mac = NETWORK.get("mac")
                if mac and mac != "02:00:00:00:00:00":
                    SETTINGS.d["device_mac"] = mac
                SETTINGS.d["device_iface"] = NETWORK.get("iface", "")
                SETTINGS.d["device_iface_kind"] = NETWORK.get("kind", "unknown")
                SETTINGS.save()
                return self._json({"ok": True, "network": NETWORK})
            if path == "/api/ffmpeg/status":
                return self._json(ffmpeg_fetch_state())
            if path == "/api/connection":
                # BaseApplication.isConnected() + PingServerActivity state: the
                # UI reads this to know whether the live-TV menu may open.
                return self._json(CONNECTION.state())
            if path == "/api/diagnose":
                return self._json(diagnose())
            if path == "/api/m3u":
                d = load_m3u()
                if q.get("refresh", ["0"])[0] in ("1", "true"):
                    d = refresh_m3u(d)
                return self._json(m3u_public(d))
            if path == "/api/apps":
                store = load_apps()
                return self._json({
                    "installed": installed_apps(),
                    "selected": store.get("selected", []),
                    "custom": store.get("custom", []),
                })
            if path == "/api/autostart":
                return self._json({"enabled": autostart_state()})
            if path == "/api/call":
                ep = q.get("ep", [""])[0]
                params = {PARAM_ALIAS.get(k, k): v[0] for k, v in q.items() if k != "ep"}
                try:
                    fn = getattr(API, "get_" + ep) if hasattr(API, "get_" + ep) else None
                    if fn is None:
                        return self._json({"error": "unknown endpoint"}, 404)
                    return self._json(fn(**params) if params else fn())
                except Exception as e:
                    return self._json({"error": str(e)}, 502)
            if path == "/api/raw":
                rp = q.get("path", [""])[0]
                try:
                    data, ctype, st = api_get_raw(rp, timeout=15)
                    return self._send(st, data, ctype or "application/octet-stream")
                except Exception as e:
                    return self._json({"error": str(e)}, 502)
            if path == "/api/img":
                rel = q.get("path", [""])[0]
                try:
                    data, ctype, st = api_get_raw("/iptv2/manager/" + rel, timeout=15)
                    return self._send(st, data, ctype or "image/jpeg")
                except Exception:
                    return self._send(404, b"", "text/plain")
            if path.startswith("/stream/"):
                return self._stream(path, q)
            if path == "/proxy":
                return self._proxy(q)
            return self._send(404, b'{"error":"not found"}')
        except BrokenPipeError:
            pass
        except Exception as e:
            try:
                self._json({"error": str(e)}, 500)
            except Exception:
                pass

    def do_POST(self):
        u = urllib.parse.urlsplit(self.path)
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        try:
            data = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            data = {}
        if u.path == "/api/ffmpeg/ensure":
            # the player's "needs FFmpeg" banner asks the backend to fetch the
            # static build in the background (Python TLS, not PowerShell).
            return self._json(ensure_ffmpeg("player banner"))
        if u.path == "/api/settings":
            # SettingsActivity.onClick(): an IP field that contains letters is
            # checked as a domain, otherwise it must be a dotted quad; either
            # way a rejected value is not written and the caller is told why.
            bad = ""
            if "server_ip" in data:
                ip = str(data.get("server_ip") or "").strip()
                if has_letter(ip):
                    if not is_valid_domain(ip):
                        bad = "invalid_domain"
                elif not check_ipaddress(ip):
                    bad = "invalid_ip"
                if not bad:
                    data["other_server_ip"] = ip
            if bad:
                return self._json({"ok": False, "error": bad})
            changed_addr = any(k in data for k in ("server_ip", "server_port"))
            for k, v in data.items():
                SETTINGS.set(k, v)
            WS.start()
            if changed_addr:
                # a new address means a new handshake, exactly as after an announce
                CONNECTION.retry()
                return self._json({"ok": True, "connection": CONNECTION.state()})
            return self._json({"ok": True})
        if u.path == "/api/ws/start":
            WS.start()
            return self._json({"ok": True})
        if u.path == "/api/connection/retry":
            # Settings -> "reconnect": run the whole boot handshake again.
            return self._json({"ok": True, "connection": CONNECTION.retry()})
        if u.path == "/api/connection/skip":
            # PingServerActivity.onKeyDown(): any key leaves the boot screen and
            # calls openWelcomeActivity() with whatever the handshake produced.
            w = CONNECTION.skip_ping()
            return self._json({"ok": True, "welcome": w, "connection": CONNECTION.state()})
        if u.path == "/api/connection/sweep":
            threading.Thread(target=CONNECTION.sweep_for_head_end, daemon=True,
                             name="iptv-sweep-manual").start()
            return self._json({"ok": True, "connection": CONNECTION.state()})
        if u.path == "/api/connection/playing":
            # BaseApplication.curPlayingLiveProgramName - UpdateClient?name=...
            CONNECTION.cur_playing = str(data.get("name") or "")[:120]
            return self._json({"ok": True, "name": CONNECTION.cur_playing})
        if u.path == "/api/connection/announce":
            # The same adoption path as the UDP announce, for a head-end that
            # cannot broadcast (or an installer that already knows the address).
            ok = CONNECTION.discovery.adopt(data, "manual", "api")
            return self._json({"ok": bool(ok), "connection": CONNECTION.state()})
        if u.path == "/api/m3u":
            d = load_m3u()
            for k in ("url", "path", "text"):
                if k in data:
                    d[k] = str(data.get(k) or "").strip()
            if "enabled" in data:
                d["enabled"] = bool(data.get("enabled"))
            d = refresh_m3u(d)
            return self._json({"ok": True, "m3u": m3u_public(d)})
        if u.path == "/api/volume":
            if "volume" in data:
                WS.volume = max(0, min(100, int(data["volume"])))
            if "muted" in data:
                WS.muted = bool(data["muted"])
            return self._json({"volume": WS.volume, "muted": WS.muted})
        if u.path == "/api/apps":
            store = load_apps()
            if "select" in data:
                sel = [str(x) for x in (data.get("select") or [])]
                known = set(a["name"] for a in installed_apps())
                store["selected"] = [s for s in sel if s in known]
                save_apps(store)
                return self._json({"ok": True, "selected": store["selected"]})
            if "toggle" in data:
                name = str(data.get("toggle") or "")
                sel = store.get("selected", [])
                if name in sel:
                    sel.remove(name)
                else:
                    sel.append(name)
                store["selected"] = sel
                save_apps(store)
                return self._json({"ok": True, "selected": sel})
            if "add" in data:
                a = data.get("add") or {}
                name = (a.get("name") or "").strip()
                p = (a.get("path") or "").strip()
                if name and p:
                    custom = [c for c in store.get("custom", [])
                              if c.get("name") != name]
                    custom.append({"name": name, "path": p})
                    store["custom"] = custom
                    save_apps(store)
                    return self._json({"ok": True, "custom": custom})
                return self._json({"ok": False, "error": "name and path required"})
            if "remove" in data:
                name = str(data.get("remove") or "")
                store["custom"] = [c for c in store.get("custom", [])
                                   if c.get("name") != name]
                if name in store.get("selected", []):
                    store["selected"].remove(name)
                save_apps(store)
                return self._json({"ok": True})
            return self._json({"ok": False, "error": "nothing to do"})
        if u.path == "/api/launch":
            try:
                return self._json(launch_app(str(data.get("app") or "")))
            except Exception as e:
                return self._json({"ok": False, "error": str(e)})
        if u.path == "/api/external_player":
            return self._json(play_with_vlc(data.get("url") or "",
                                            data.get("title") or ""))
        if u.path == "/api/autostart":
            return self._json(set_autostart(bool(data.get("enabled"))))
        if u.path == "/api/post":
            ep = data.pop("ep", "")
            data = {PARAM_ALIAS.get(k, k): v for k, v in data.items()}
            try:
                fn = getattr(API, ep, None)
                if fn is None:
                    return self._json({"error": "unknown"}, 404)
                return self._json(fn(**data))
            except Exception as e:
                return self._json({"error": str(e)}, 502)
        return self._send(404, b'{"error":"not found"}')

    # ---- static / images ----
    def _safe(self, base, rel):
        p = os.path.normpath(os.path.join(base, rel))
        if not p.startswith(os.path.normpath(base)):
            return None
        return p

    def _static_file(self, fp):
        fp = os.path.normpath(fp)
        if not fp.startswith(os.path.normpath(WEB_DIR)):
            return self._send(403, b"")
        if not os.path.isfile(fp):
            return self._send(404, b"")
        ext = os.path.splitext(fp)[1].lower()
        with open(fp, "rb") as f:
            data = f.read()
        return self._send(200, data, MIME.get(ext, "application/octet-stream"))

    def _app_image(self, name):
        idx = os.path.join(os.path.dirname(HERE), "app_assets", "img")
        fp = self._safe(idx, name)
        if not fp or not os.path.isfile(fp):
            return self._send(404, b"")
        ext = os.path.splitext(fp)[1].lower()
        with open(fp, "rb") as f:
            data = f.read()
        return self._send(200, data, MIME.get(ext, "image/png"))

    # ---- streams ----
    def _stream(self, path, q):
        m = re.match(r"^/stream/seg/([0-9a-f]{16})/(.+)$", path)
        if m:
            key, seg = m.group(1), m.group(2)
            with STREAMS.lock:
                s = STREAMS.sessions.get(key)
            if not s:
                return self._send(404, b"gone", "text/plain")
            s.last_use = time.time()
            fp = os.path.join(s.dir, os.path.basename(seg))
            if not os.path.isfile(fp):
                return self._send(404, b"gone", "text/plain")
            with open(fp, "rb") as f:
                data = f.read()
            return self._send(200, data, MIME[".ts"])
        # /stream/play?src=<url>&proto=<rtsp|hls|http|udp>
        src = q.get("src", [""])[0]
        proto = (q.get("proto", [""])[0] or classify(src)).lower()
        kind = classify(src)
        if kind == "hls":
            return self._proxy_hls(src)
        if kind == "http" and not src.lower().endswith(".ts"):
            return self._proxy_http(src, self.headers.get("Range"))
        if kind in ("rtsp", "udp", "mpegts"):
            s = STREAMS.playlist_for(src, proto)
            if s.error:
                return self._json({"error": s.error}, 500)
            return self._serve_local_hls(s)
        return self._proxy_http(src, self.headers.get("Range"))

    def _serve_local_hls(self, session):
        fp = session.playlist
        if not os.path.isfile(fp):
            return self._send(404, b"waiting", "text/plain")
        with open(fp, "rb") as f:
            data = f.read()
        data = re.sub(rb"(seg\d+\.ts)",
                      lambda mm: b"/stream/seg/" + session.key.encode() + b"/" + mm.group(1),
                      data)
        return self._send(200, data, MIME[".m3u8"])

    def _proxy_hls(self, src):
        try:
            data, ctype, st = http_get(src, timeout=15, binary=True)
        except Exception as e:
            return self._json({"error": str(e)}, 502)
        base = src.rsplit("/", 1)[0] + "/"
        text = data.decode("utf-8", "replace")
        out = []
        for line in text.splitlines():
            s = line.strip()
            if s and not s.startswith("#"):
                out.append("/proxy?url=" + urllib.parse.quote(
                    urllib.parse.urljoin(base, s), safe=""))
            elif s.startswith("#EXT-X-KEY") or s.startswith("#EXT-X-MAP"):
                m = re.search(r'URI="([^"]+)"', s)
                if m:
                    absu = urllib.parse.urljoin(base, m.group(1))
                    s = s.replace(m.group(1), "/proxy?url=" +
                                  urllib.parse.quote(absu, safe=""))
                out.append(s)
            else:
                out.append(s)
        body = "\n".join(out).encode("utf-8")
        return self._send(200, body, MIME[".m3u8"])

    def _proxy_http(self, src, range_header):
        headers = {"User-Agent": "PARDIK-SMART-IPTV-Win"}
        if range_header:
            headers["Range"] = range_header
        try:
            req = urllib.request.Request(src, headers=headers)
            r = urllib.request.urlopen(req, timeout=20)
        except urllib.error.HTTPError as e:
            r = e
        except Exception as e:
            return self._json({"error": str(e)}, 502)
        ctype = r.headers.get("Content-Type", "application/octet-stream")
        clen = r.headers.get("Content-Length")
        code = r.status if hasattr(r, "status") else r.code
        extra = {}
        if r.headers.get("Accept-Ranges"):
            extra["Accept-Ranges"] = r.headers.get("Accept-Ranges")
        if r.headers.get("Content-Range"):
            extra["Content-Range"] = r.headers.get("Content-Range")

        def gen():
            while True:
                chunk = r.read(128 * 1024)
                if not chunk:
                    break
                yield chunk
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        for k, v in extra.items():
            self.send_header(k, v)
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        self._pump(gen())
        return None

    def _proxy(self, q):
        src = q.get("url", [""])[0]
        kind = classify(src)
        if kind == "hls":
            return self._proxy_hls(src)
        return self._proxy_http(src, self.headers.get("Range"))

    def do_OPTIONS(self):
        self._send(204, b"", extra={"Access-Control-Allow-Origin": "*",
                                    "Access-Control-Allow-Headers": "*",
                                    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"})


def main():
    port = int(os.environ.get("IPTV_PORT", "8787"))
    host = os.environ.get("IPTV_HOST", "127.0.0.1")
    # BaseApplication.onCreate(): the handshake, the UDP 27777 announce listener
    # and the 5 s maintenance loop all start before the first request is served.
    CONNECTION.on_create()
    srv = None
    for attempt in range(1, 11):
        try:
            srv = ThreadingHTTPServer((host, port), Handler)
            break
        except OSError as e:
            # An older install that is still running holds the port; serving
            # nothing is better than exiting silently and leaving the OLD code
            # (which has no /api/connection) answering the NEW web UI.
            CONNECTION.note("port %d busy (%s) - retry %d/10" % (port, e, attempt))
            time.sleep(1.0)
    if srv is None:
        msg = ("FATAL: port %d is held by another process (an older PARDIK IPTV "
               "instance?). Close it (Task Manager) or reboot, then start again."
               % port)
        CONNECTION.note(msg)
        append_log(msg)
        try:
            print(msg)
        except Exception:
            pass
        return
    srv.daemon_threads = True
    print("%s backend on http://%s:%d/ (mode=%s)" % (BRANDING[APP_MODE]["install_name"], host, port, APP_MODE))
    sys.stdout.flush()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
