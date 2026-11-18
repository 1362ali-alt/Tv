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
import base64
import hashlib
import threading
import subprocess
import urllib.parse
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP_VERSION_NAME = "2.7.2.06"
APP_VERSION_CODE = 20702006

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
        if not self.d.get("device_mac"):
            self.d["device_mac"] = detect_mac()
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


def detect_mac():
    try:
        node = uuid.getnode()
        mac = "%012x" % node
        return ":".join(mac[i:i + 2] for i in range(0, 12, 2)).upper()
    except Exception:
        return "02:00:00:00:00:00"


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


SETTINGS = Settings()

# --------------------------------------------------------------------------- #
# HTTP API client (mirrors HttpUtil / OkGo usage)
# --------------------------------------------------------------------------- #
TIMEOUT = 8.0


def http_get(url, timeout=TIMEOUT, binary=False, headers=None):
    req = urllib.request.Request(url, headers=headers or {
        "User-Agent": "PARDIK-SMART-IPTV-Win/%s" % APP_VERSION_NAME})
    with urllib.request.urlopen(req, timeout=timeout) as r:
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
# v2.7.2.06 local features
#   * SettingAppShowActivity + database/app.db  -> "APP show in menu"
#   * use_vlc_paly_live_prg                     -> hand playback to VLC
#   * util.BootReceiver                         -> start with Windows
# --------------------------------------------------------------------------- #
RUN_KEY = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
RUN_NAME = "PARDIK-SMART-IPTV"


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


def find_ffmpeg():
    global FFMPEG
    if FFMPEG:
        return FFMPEG
    cands = []
    env = os.environ.get("IPTV_FFMPEG")
    if env:
        cands.append(env)
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
            return True
        except Exception as e:
            self.error = str(e)
            return False

    def alive(self):
        return self.proc is not None and self.proc.poll() is None

    def check(self):
        """Record a hard failure when ffmpeg exited non-zero (bad source)."""
        if self.proc is not None and self.proc.poll() not in (None, 0):
            try:
                err = self.proc.stderr.read() if self.proc.stderr else b""
                err = (err or b"").decode("utf-8", "replace")[-300:]
            except Exception:
                err = ""
            if not os.path.exists(self.playlist):
                self.error = "ffmpeg exit %s %s" % (self.proc.poll(), err)

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
                    "streams": STREAMS.status(),
                    "ws": {"prg": bool(WS.prg and WS.prg.connected),
                           "vol": bool(WS.vol and WS.vol.connected),
                           "volume": WS.volume, "muted": WS.muted},
                    # v2.7.2.06 additions
                    "vlc_installed": bool(find_vlc()),
                    "autostart": autostart_state(),
                    "apps_selected": load_apps().get("selected", []),
                })
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
        if u.path == "/api/settings":
            for k, v in data.items():
                SETTINGS.set(k, v)
            WS.start()
            return self._json({"ok": True})
        if u.path == "/api/ws/start":
            WS.start()
            return self._json({"ok": True})
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
    WS.start()
    srv = ThreadingHTTPServer((host, port), Handler)
    srv.daemon_threads = True
    print("PARDIK SMART IPTV backend on http://%s:%d/" % (host, port))
    sys.stdout.flush()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
