/* PARDIK SMART IPTV — Windows 10 client (mirrors com.dexin.wanchuan.iptv3) */
(function () {
"use strict";

/* ----------------------------- helpers ----------------------------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const enc = (u) => encodeURIComponent(u);
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const S = {
  lang: "fa",
  config: null,
  settings: null,          // server Settings bean
  client: null,            // server Client bean
  menu: [],
  channels: [],
  packages: [],
  stack: [],
  cur: null,
  playerCtx: null,
  hls: null,
  volume: 0.6,
  muted: false,
  favourites: [],
  idleTimer: null,
  clockTimer: null,
  /* v2.7.2.06 */
  speed: 1.0,              // txt_play_speed
  speeds: [1, 1.25, 1.5, 2, 0.5, 0.75],
  epg: [],                 // LiveProgEpgDataBean list of the current channel
  epgIndex: -1,
  apps: [],                // SettingAppShowActivity / app.db equivalent
  appsSelected: [],
  basket: {},              // MyOrderActivity: chosen foods (id -> count)
  basketItems: {},
  ad: null,                // v2: in-player advert {id, canSkip, remains, startedAt, item}
  adTimer: null,
  liveWatch: null,         // v2: AddAdvHistory type=1 watch time of the live programme
  bootVideos: [],          // v2: GetAdvVideoEM list (BootVideoActivity)
  bootVideoIndex: 0,
  bootLeft: false,         // v2: BootVideoActivity.isLeave - one transition only
  bootHls: null,
  bootHintTimer: null,
  bootStallTimer: null,
  welVideos: [],           // v2: welcome background clips (same endpoint)
  isPlayVideo: false,      // v2: WelcomeStyleZeroActivity.isPlayVideo
  pptTimer: null,          // v2: welcome GetAdvImage?type=1 slideshow
  pptIndex: 0,
  pptImages: [],
  bgMusic: null,           // v2: apk/getClientBackgroundMusics loop
  /* residential deployment (Pardik / Ronika Palace Kahak) */
  mode: "residential",     // /api/config.mode: residential | hotel
  branding: {},            // title/subtitle/welcome/unit labels for this deployment
  m3u: {},                 // external playlist source {enabled,count,url,path,error}
  m3uChannels: [],         // parsed playlist entries
  vlc: false,
  autostart: false,
  loadAnim: null,
  /* the connection handshake (BaseApplication + PingServerActivity) lives in the
     backend; the screens only read its state, exactly like the APK's activities
     read BaseApplication.getInstance(). */
  conn: null,              // last /api/connection snapshot
  connected: false,        // BaseApplication.isConnected()
  welcome: null,           // openWelcomeActivity(advVideoEM, layout) payload
  connTimer: null,         // PingServerActivity$2 poll
  serverSettings: null,    // BaseApplication.getSettings() - bean.Settings
  inputNumber: "",         // MainStyleThirdActivity.onKeyDown digit buffer
  inputNumberTimer: null,
  playTypendex: 0,         // Settings.indexArea -> what plays behind the menu
  mainBannerTimer: null,   // MZBannerView, 8 s a page (initPpt)
  mainBannerImages: [],
  mainBgVideos: [],        // apk/getClientBackgroundVideos
  mainHls: null,
  mainMenuTimer: null,     // right_show_action(): the strip slides in over 2 s
  homepageIcons: [],       // GetHomepageIcon answer
  mainMenus: [],           // bean.MainMenu list handed to the adapter
  thirdApkBeanList: [],    // GetAPK answer (type 0 / type 8 tiles)
  loacalThirdApkBeans: [], // readLocalThirdAppDatas() - the Windows apps
  connPoll: null,          // the 5 s read of BaseApplication.isConnected()
  mainEntered: false,      // onResume() of the main activity already ran once
  mainMusic: null,         // apk/getClientBackgroundMusics on the main screen
  mainLiveList: [],        // GetLiveTV?packageId=0 behind the menu (indexArea 3)
  mainLiveErrors: 0,
  curPlaying: "",          // BaseApplication.curPlayingLiveProgramName
  /* WelcomeStyleZeroActivity fields */
  selectLanguage: 1,       // IptvSP.selectLanguage: 0 = English, 1 = the other
  appLanguageType: 0,      // Settings.language / Client.language flag
  persionName: "",         // Client.checkPerson
  welcomeWordZh: "", welcomeWordEn: "", welcomeWordText: "",
  isGetWelcomeWordSuccessCh: false, isGetWelcomeWordSuccessEn: false,
  welDelay: null,
  weatherToday: null,      // EVENT_TODAY_WEATHER, sticky for the main screen
  /* MainStyleThirdActivity fields */
  isShowPackage: false, isShowEpgInfo: false, isShowAppInMenu: false, recordMode: 0,
};

/* ----------------------------- i18n ----------------------------- */
function t(key, fallback) {
  const e = (window.I18N || {})[key];
  if (!e) return fallback || key;
  return e[S.lang] || e.fa || e.en || e.zh || fallback || key;
}
function applyI18n() {
  const rtl = (S.lang === "fa" || S.lang === "ar");
  document.documentElement.lang = S.lang;
  document.documentElement.dir = rtl ? "rtl" : "ltr";
  $$("[data-i18n]").forEach(n => { n.textContent = t(n.dataset.i18n, n.textContent); });
  applyBranding();
}

/* The APK is one platform that each deployment rebrands. Pardik's build for the
   Ronika Palace residential complex in Kahak is a pure IPTV client, so the
   titles, the welcome wording and "unit" instead of "room" come from
   /api/config.branding rather than from the hotel strings. */
function applyBranding() {
  /* The APK is one platform that each deployment rebrands through the head-end
     (Settings.hotelName, Client.welcomeWord, GetAdvImage). The Windows port
     keeps the same views - it only falls back to /api/config.branding when the
     server sends nothing, so a residential complex reads like itself. */
  const b = S.branding || {};
  const en = S.lang === "en";
  document.title = b.product || "PARDIK IPTV";
  const setTxt = (sel, v) => { const n = $(sel); if (n && v != null && v !== "") n.textContent = v; };
  const setHtml = (sel, v) => { const n = $(sel); if (n && v != null && v !== "") n.innerHTML = v; };
  /* tv_room_text_view / activity_title_name stay GONE, as in the layouts. */
  setTxt("#main-room-label", en ? (b.unit_label_en || "Unit number") : (b.unit_label || "شمارهٔ واحد"));
  setTxt("#set-room-label", en ? (b.unit_label_en || "Unit number") : (b.unit_label || "شمارهٔ واحد"));
  /* welcome: tv_user_name + tv_welcome_word_zh, filled by showGuestName() and
     showWelcomeText(); the branding text is only the fallback. */
  if (!S.welcomeWordText) {
    setTxt("#wel-word", en ? (b.welcome_word_en || b.welcome_word || "") : (b.welcome_word || ""));
  }
  setHtml("#wel-manager", "");
  void setHtml;
}

/* ----------------------------- API ----------------------------- */
async function cfg() {
  const r = await fetch("/api/config"); const d = await r.json();
  try {
    if (d && d.build) document.title = "PARDIK IPTV " + d.build;
  } catch (e) {}
  return d;
}
async function apiGet(ep, params) {
  const q = new URLSearchParams(Object.assign({ ep: ep }, params || {}));
  const r = await fetch("/api/call?" + q.toString());
  const j = await r.json();
  if (j && j.error) throw new Error(j.error);
  return j;
}
async function apiPost(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  return r.json();
}
const imgUrl = (rel) => "/api/img?path=" + enc(rel || "");

/* IptvSP.getUrl(ep) = getAddress() + "/iptv2/" + ep  (paths from GetAdvVideoEM
   and res/adv/... are relative to /iptv2/, unlike GetNextAdv's resource.url). */
function iptvUrl(rel) {
  const r = rel || "";
  if (/^https?:\/\//i.test(r)) return r;
  const s = S.config && S.config.settings ? S.config.settings : {};
  const base = "http://" + (s.server_ip || "10.21.0.10") + ":" + (s.server_port || 8030);
  return base + "/iptv2/" + r.replace(/^\/+/, "");
}

/* BootVideoActivity$1$1 / WelcomeStyleZeroActivity$4: keep the entries that are
   non-empty and contain a "/" that is not the last character, then URL-encode
   only the final path segment. */
function sanitiseAdvPaths(list) {
  const arr = Array.isArray(list) ? list : ((list && list.list) || []);
  const out = [];
  arr.forEach((s) => {
    if (!s || typeof s !== "string") return;
    const i = s.lastIndexOf("/");
    if (i === -1 || i === s.length - 1) return;
    out.push(s.substring(0, i + 1) + enc(s.substring(i + 1)));
  });
  return out;
}

/* how the browser gets hold of a stream: HLS through the proxy (+hls.js),
   everything else (mp4/ts/rtsp/udp) through the local remux/proxy endpoint. */
function mediaSrc(url) {
  return classify(url) === "hls" ? "/proxy?url=" + enc(url) : "/stream/play?src=" + enc(url);
}

/* Browsers refuse autoplay with sound until there is a user gesture, while the
   Android box always plays. Try with sound, fall back to muted so the advert is
   never lost (install/launch.ps1 also passes --autoplay-policy=...). */
function tryPlay(el) {
  try {
    const p = el.play();
    if (p && p.catch) p.catch(() => { try { el.muted = true; el.play().catch(() => {}); } catch (e) {} });
  } catch (e) {}
}

/* ----------------------------- toast ----------------------------- */
let toastTimer = null;
function toast(msg) {
  const n = $("#toast"); n.textContent = msg; n.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => n.hidden = true, 2600);
}

/* v2.7.2.06: the Android app shows its own dialogs (layout_dialog_new,
   dialog_order_cancel/commit) instead of the platform confirm(). */
function askConfirm(title, text, okLabel) {
  return new Promise((resolve) => {
    const m = $("#confirm-modal");
    $("#confirm-title").textContent = title || "";
    $("#confirm-text").textContent = text || "";
    $("#confirm-ok").textContent = okLabel || t("ok", "تأیید");
    m.hidden = false;
    const done = (v) => { m.hidden = true; $("#confirm-ok").onclick = null; $("#confirm-cancel").onclick = null; resolve(v); focusFirst(S.cur); };
    $("#confirm-ok").onclick = () => done(true);
    $("#confirm-cancel").onclick = () => done(false);
    setTimeout(() => { try { $("#confirm-ok").focus(); } catch (e) {} }, 40);
  });
}

/* Android picks the Chinese or the English bean field with
   `getSelectLanguage() != 0 ? getName() : getName_1()`; v2.7.2.06 added the
   matching *_1 fields (name_1, content_1, description_1, foodTypeName_1). */
function nm(o, key) {
  if (!o) return "";
  const k = key || "name";
  const zh = o[k], alt = o[k + "_1"];
  const preferAlt = (S.config && S.config.settings.select_language_flag === 0) || S.lang === "en";
  return (preferAlt ? (alt || zh) : (zh || alt)) || o[k + "En"] || o["englishName"] || "";
}

/* drawable/loading1..8 -> the APK's own buffering animation */
function startLoadAnim() {
  const img = $("#load-anim"); if (!img) return;
  let i = 1; img.src = "/assets/img/drawable__loading1.png";
  img.onerror = () => { img.hidden = true; };
  clearInterval(S.loadAnim);
  S.loadAnim = setInterval(() => { i = (i % 8) + 1; img.src = "/assets/img/drawable__loading" + i + ".png"; }, 110);
}
function stopLoadAnim() { clearInterval(S.loadAnim); S.loadAnim = null; }

/* ----------------------------- screens / nav ----------------------------- */
function show(id, push) {
  const cur = $(".screen.active");
  if (push !== false && cur && cur.id !== id) S.stack.push(cur.id);
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === id));
  S.cur = id;
  onEnter(id);
  focusFirst(id);
}
function back() {
  if ($("#confirm-modal").hidden === false) { $("#confirm-modal").hidden = true; focusFirst(S.cur); return; }
  if ($("#vod-detail").hidden === false) { $("#vod-detail").hidden = true; focusFirst(S.cur); return; }
  if ($("#order-detail").hidden === false) { $("#order-detail").hidden = true; focusFirst(S.cur); return; }
  if ($("#input-modal").hidden === false) { $("#input-modal").hidden = true; focusFirst(S.cur); return; }
  if ($("#epg-detail").hidden === false) { $("#epg-detail").hidden = true; focusFirst(S.cur); return; }
  if ($("#epg-panel").hidden === false) { $("#epg-panel").hidden = true; focusFirst(S.cur); return; }
  if ($("#side-list").hidden === false) { $("#side-list").hidden = true; focusFirst(S.cur); return; }
  if (S.cur === "scr-player" && S.playerCtx && S.playerCtx.kind === "live") {
    // Android: press back twice to exit
    const now = Date.now();
    if (S._lastBack && now - S._lastBack < 2500) { stopVideo(); const p = S.stack.pop() || "scr-home"; show(p, false); }
    else { S._lastBack = now; toast(t("live_player_click_exit", "برای خروج دوباره بزنید")); }
    return;
  }
  stopVideo();
  const p = S.stack.pop();
  show(p || "scr-home", false);
}
function focusables(id) {
  const scr = document.getElementById(id);
  if (!scr) return [];
  return $$(".focusable, button, input, select, .mm-item, .pkg-item, .poster, .type-item, .svc-item, .food-item, .side-item, .rec-item, .set-row[data-edit], .set-row[data-act], .hotel-item, .scen-item, .epg-item, .order-item, .country-item, .app-item", scr)
    .filter(n => n.offsetParent !== null && !n.disabled);
}
function focusFirst(id) {
  const f = focusables(id);
  if (f.length) { try { f[0].focus({ preventScroll: false }); } catch (e) { f[0].focus(); } }
}
function nearest(from, dx, dy) {
  const list = focusables(S.cur).filter(n => n !== from);
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bd = 1e9;
  for (const n of list) {
    const b = n.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const vx = bx - ax, vy = by - ay;
    const along = vx * dx + vy * dy;
    if (along <= 4) continue;
    const off = Math.abs(vx * dy - vy * dx);
    const d = along + off * 2.2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}
document.addEventListener("keydown", (e) => {
  const tag = (document.activeElement || {}).tagName;
  const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  if (e.key === "Escape" || e.key === "Backspace") {
    // the boot advert video treats BACK like any other key: on to the welcome screen
    if (S.cur === "scr-bootvideo") { e.preventDefault(); leaveBootVideo(); return; }
    /* MainStyleThirdActivity.onKeyDown(): keyCode 4 is consumed - the main
       screen is the home of the app, there is nothing to go back to. */
    if (S.cur === "scr-home") { e.preventDefault(); return; }
    if (!typing) { e.preventDefault(); back(); }
    return;
  }
  /* v2.7.2.06: while an advert is playing only BACK and the volume keys work;
     any other key skips the advert when the server allows it (allowSkip).
     Like the APK's onKeyDown this is checked before any focus/typing guard. */
  if (S.ad) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); bumpVolume(e.key === "ArrowUp" ? 5 : -5); return; }
    e.preventDefault();
    if (S.ad.canSkip) finishAd(2);
    return;
  }
  /* BootVideoActivity.onKeyDown: every key except VOLUME_UP/VOLUME_DOWN leaves
     the boot advert video and enters the welcome screen. */
  if (S.cur === "scr-bootvideo") {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); bumpVolume(e.key === "ArrowUp" ? 5 : -5); return; }
    e.preventDefault();
    leaveBootVideo();
    return;
  }
  /* PingServerActivity.onKeyDown(): any key leaves the boot screen at once and
     calls openWelcomeActivity() with whatever the handshake produced so far. */
  if (S.cur === "scr-boot") {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); bumpVolume(e.key === "ArrowUp" ? 5 : -5); return; }
    e.preventDefault();
    skipPing();
    return;
  }
  /* WelcomeStyleZeroActivity.onKeyDown(): UP/LEFT focus tv_chinese, DOWN/RIGHT
     focus tv_english, OK clicks the focused button (which calls openMain()) and
     every other key is swallowed - only VOLUME_UP/DOWN reach the system. */
  if (S.cur === "scr-welcome") {
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault(); const zh = $("#wel-zh"); if (zh) zh.focus(); return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault(); const en = $("#wel-en"); if (en) en.focus(); return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const a = document.activeElement;
      if (a && a.click) a.click();
      return;
    }
    e.preventDefault();
    return;
  }
  /* MainStyleThirdActivity.onKeyDown(): BACK is consumed on the main screen and
     digits collect into inputNumber; when the buffer equals
     IptvSP.getPassword() (111999) the settings activity opens. A 2 s timer
     clears the buffer (inputNumberTimer). */
  if (S.cur === "scr-home" && /^[0-9]$/.test(e.key)) { e.preventDefault(); mainDigit(e.key); return; }
  if (typing) return;
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (dir) {
    e.preventDefault();
    if (S.cur === "scr-player" && (e.key === "ArrowUp" || e.key === "ArrowDown")) { bumpVolume(e.key === "ArrowUp" ? 5 : -5); return; }
    const n = nearest(document.activeElement, dir[0], dir[1]);
    if (n) n.focus();
    return;
  }
  if (e.key === "Enter" || e.key === " " || e.key === "MediaPlay") {
    if (document.activeElement && document.activeElement.click) { e.preventDefault(); document.activeElement.click(); }
    return;
  }
  if (S.cur === "scr-player") {
    if (e.key === "m" || e.key === "M") { toggleMute(); }
    if (e.key === "f" || e.key === "F") { toggleFav(); }
    if (e.key === "l" || e.key === "L") { toggleSideList(); }
    if (e.key === "e" || e.key === "E") { toggleEpg(); }          // v2: EPG panel
    if (e.key === "i" || e.key === "I") { showEpgDetail(-1); }    // v2: programme details
    if (e.key === "s" || e.key === "S") { cycleSpeed(); }         // v2: txt_play_speed
    if (e.key === "Enter") { toggleFullscreen(); }
  }
});

/* PingServerActivity.onKeyDown() -> openWelcomeActivity(): the backend answers
   with the same payload the 20-attempt timer would have produced. */
async function skipPing() {
  if (S.pingSkipped) return;
  S.pingSkipped = true;
  clearInterval(S.connTimer); S.connTimer = null;
  let r = null;
  try { r = await apiPost("/api/connection/skip", {}); } catch (e) { r = null; }
  const c = (r && r.connection) || null;
  if (c) applyConnection(c);
  const w = (r && r.welcome) || (c && c.welcome) || { screen: "welcome_zero", layout: 0, main: "MainStyleThird" };
  openWelcomeActivity(w);
}

/* MainStyleThirdActivity.onKeyDown() digit buffer -> SettingsActivity */
function mainDigit(key) {
  S.inputNumber = String(S.inputNumber || "") + key;
  const pass = String((S.config.settings && S.config.settings.password) || "111999");
  if (S.inputNumber === pass) {
    S.inputNumber = "";
    clearTimeout(S.inputNumberTimer);
    openSettings(true);
    return;
  }
  if (S.inputNumber.length > pass.length) S.inputNumber = S.inputNumber.slice(-pass.length);
  clearTimeout(S.inputNumberTimer);
  S.inputNumberTimer = setTimeout(() => { S.inputNumber = ""; }, 2000);
}

/* ----------------------------- clock ----------------------------- */
/* widget.DigitalClock: cur_time_view prints SimpleDateFormat("HH:mm") of
   DigitalClock.currentTimeMillis() (the server clock from GetCurrentTimeAndZone,
   falling back to the local one) and cur_date_view "yyyy/MM/dd  EEEE"
   (WelcomeStyleZeroActivity.showWeekDay()). Both screens have their own pair. */
function startClock() {
  const fmt = () => {
    const d = serverNow();
    const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
    const loc = S.lang === "fa" ? "fa-IR" : (S.lang === "zh" ? "zh-CN" : (S.lang === "ar" ? "ar" : "en-GB"));
    const ds = d.toLocaleDateString(loc, { year: "numeric", month: "2-digit", day: "2-digit" })
      .replace(/\//g, "/") + "  "
      + d.toLocaleDateString(loc, { weekday: "long" });
    ["#wel-time", "#main-time"].forEach(x => { const n = $(x); if (n) n.textContent = hh + ":" + mm; });
    ["#wel-date", "#main-date"].forEach(x => { const n = $(x); if (n) n.textContent = ds; });
  };
  clearInterval(S.clockTimer); S.clockTimer = setInterval(fmt, 1000); fmt();
}
let timeOffset = 0;
function serverNow() { return new Date(Date.now() + timeOffset); }
/* BaseApplication.getTimeFromServer() -> GetCurrentTimeAndZone?mac= */
function applyServerTime(st) {
  if (st && st.server_time) timeOffset = Number(st.server_time) - Date.now();
}

/* ----------------------------- boot ----------------------------- */
async function boot() {
  applyI18n();
  S.config = await cfg();
  S.lang = S.config.settings.app_language || "fa";
  S.favourites = S.config.settings.favourites || [];
  /* v2.7.2.06 local preferences */
  S.speed = Number(S.config.settings.play_speed || 1);
  S.vlc = !!S.config.settings.use_vlc_paly_live_prg;
  S.autostart = !!S.config.autostart;
  S.appsSelected = S.config.apps_selected || [];
  /* deployment flavour + branding + optional external playlist */
  S.mode = S.config.mode || "residential";
  S.branding = S.config.branding || {};
  S.m3u = S.config.m3u || {};
  applyI18n();
  if (S.m3u.enabled) {
    try {
      const d = await (await fetch("/api/m3u")).json();
      S.m3uChannels = d.channels || [];
      S.m3u = { enabled: d.enabled, count: d.count, url: d.url, path: d.path, error: d.error };
    } catch (e) { S.m3uChannels = []; }
  }
  startClock();
  /* the boot screen is PingServerActivity: it waits for the handshake that the
     backend has been running since BaseApplication.onCreate(). */
  enterPingServer();
  startConnectionPoll();
}

/* BaseApplication's Timer(task, 2000, 5000) keeps isConnected() current inside
   the APK's own process. The port's handshake runs in the backend, so the screens
   re-read it every 5 s: a menu click must never be gated on a stale answer (the
   head-end can disappear long after the boot screen was left). */
function startConnectionPoll() {
  clearInterval(S.connPoll);
  S.connPoll = setInterval(async () => {
    if (S.cur === "scr-boot") return;             // the boot screen polls faster
    try { applyConnection(await (await fetch("/api/connection")).json()); } catch (e) {}
  }, 5000);
}

/* ---------------------------------------------------------------------------
   PingServerActivity + BaseApplication - the boot handshake.

   The Android client does not "log in": BaseApplication.onCreate() runs
   GetRoomInfo -> GetClient -> GetSettings -> the UDP 27777 listener ->
   GetCurrentTimeAndZone plus a Timer(task, 2000, 5000) maintenance loop, while
   PingServerActivity shows activity_ping_server.xml and runs its own
   Timer(task, 0, 2000):

     times != 20 -> BaseApplication.getSettingsFromServer() and its own copy;
                    the first parsed answer stores selectLanguage /
                    appLayoutStyle = settings.getLayout() and calls
                    openWelcomeActivity(settings.isAdvVideoEM(), layout)
     times == 20 -> openWelcomeActivity(false, 0) anyway
     any key      -> openWelcomeActivity(...) at once

   `connected` becomes true only when GetSettings / GetClient / GetRoomInfo /
   UpdateClient answer, so this screen is the real "am I on the building
   network?" gate - and every menu action is gated on it later.

   A browser cannot bind UDP 27777 or keep the 5 s timer while it is in the
   background, so the whole handshake runs in the backend
   (iptv_backend.ConnectionEngine) and this screen polls /api/connection.
   --------------------------------------------------------------------------- */
function enterPingServer() {
  show("scr-boot", false);
  const txt = $("#ping-text"), tips = $("#ping-tips");
  if (txt) txt.textContent = t("connecting_server_tips", "در حال دریافت آدرس سرور…");
  if (tips) tips.textContent = t("welcome_alert", "برای رد شدن هر کلیدی را بزنید");
  /* IptvSP.getPingSerBgImg(): GetAdvImage?type=11 replaces @mipmap/pic_ping_bg */
  const bg = $("#ping-bg");
  if (bg && S.conn && S.conn.ping_bg) bg.style.backgroundImage = 'url("' + imgUrl(S.conn.ping_bg) + '")';
  clearInterval(S.connTimer);
  S.bootAt = Date.now();
  S.badConn = 0;
  pollConnection();
  S.connTimer = setInterval(pollConnection, 700);
  /* mouse users: a click on the boot screen is "any key" as well */
  const scr = $("#scr-boot");
  if (scr) scr.onclick = () => skipPing();
}

async function pollConnection() {
  let c = null;
  try { c = await (await fetch("/api/connection")).json(); } catch (e) { c = null; }
  if (!c || c.ping_max == null) {
    /* A process that answers /api/connection without the engine shape is an
       OLD backend left over from a previous install (it keeps the port and
       serves the new web files from disk). Say so, and offer the local escape
       hatch instead of freezing at "attempt 0 of 20" forever. */
    S.badConn = (S.badConn || 0) + 1;
    renderPingState(Object.assign({}, c || {}, { stale_backend: true }));
    if (S.badConn >= 2) bootStaleHint(true);
    if (S.bootAt && Date.now() - S.bootAt > 20000) localWelcome();
    return;
  }
  S.badConn = 0;
  applyConnection(c);
  renderPingState(c);
  if (c.welcome) {
    clearInterval(S.connTimer); S.connTimer = null;
    openWelcomeActivity(c.welcome);
    return;
  }
  /* PingServerActivity leaves at attempt 20 even with no answer; if the engine
     itself is gone (crashed thread, old process, ...), the 50 s wall clock is
     the last resort so a user can never be trapped on the boot screen. */
  if (S.bootAt && !c.connected && Date.now() - S.bootAt > 50000) localWelcome();
}

function bootStaleHint(on) {
  const tips = $("#ping-tips");
  if (tips && on) {
    tips.textContent = S.lang === "fa" || !S.lang
      ? "بک‌اند قدیمی روی پورت 8787 پاسخ می‌دهد؛ هر کلیدی بزنید تا بدون سرور ادامه دهید"
      : "An old backend answers on port 8787; press any key to continue without it";
  }
}

/* openWelcomeActivity() without a head-end: the APK's own offline path once
   PingServerActivity gave up - welcome card first, main menu from
   addDefaultMenu(), and Settings reachable to fix the server address. */
function localWelcome() {
  if (S.welcome || S.cur !== "scr-boot") return;
  const st = S.serverSettings || {};
  const style = Number(st.layout != null ? st.layout
    : ((S.config.settings || {}).app_layout_style || 0));
  clearInterval(S.connTimer); S.connTimer = null;
  openWelcomeActivity({ advVideoEM: false, layout: style, language: null,
    screen: (style === 0 || style === 5) ? "welcome_zero" : "welcome_other",
    connected: false, main: style === 0 ? "MainStyleThird" : "MainStyleFourth" });
}

/* BaseApplication.getInstance(): the screens read the handshake from here. */
function applyConnection(c) {
  if (!c) return;
  S.conn = c;
  S.connected = !!c.connected;
  if (c.server_settings) S.serverSettings = c.server_settings;
  S.settings = S.serverSettings || S.settings || {};
  if (c.client) S.client = c.client;
  applyServerTime(c);
}

/* The APK logs the handshake to logcat; the port prints the same facts on the
   boot screen so whoever installs it can see why the head-end is not answering.
   This panel is a Windows-port addition - activity_ping_server.xml has no such
   view. */
function renderPingState(c) {
  const box = $("#ping-state");
  if (!box) return;
  const srv = c.server || {}, dis = c.discovery || {}, sw = c.sweep || {};
  const row = (k, v, cls) => "<div>" + esc(k) + ": <b" + (cls ? ' class="' + cls + '"' : "") + ">"
    + esc(v) + "</b></div>";
  let h = "";
  h += row("تلاش", (c.ping_times || 0) + " از " + (c.ping_max || 20), c.connected ? "good" : "");
  h += row("نشانی سرور", srv.address || "-", c.connected ? "good" : "bad");
  h += row("GetSettings", c.settings_ok ? "پاسخ دریافت شد" : "بدون پاسخ", c.settings_ok ? "good" : "bad");
  h += row("اعلان UDP " + (dis.port || 27777),
    dis.bound ? ("در حال گوش دادن" + (dis.packets ? " — " + dis.packets + " بسته" : ""))
              : ("در دسترس نیست: " + (dis.error || "?")), dis.bound ? "good" : "bad");
  if (sw.running || sw.tried) {
    h += row("جست‌وجوی شبکه", sw.found ? ("پیدا شد: " + sw.found) : (sw.tried + " آدرس آزموده شد"),
      sw.found ? "good" : "");
  }
  h += row("واحد/اتاق", c.unit || "-", "");
  if (c.last_error) h += row("آخرین خطا", c.last_error, "bad");
  if (c.stale_backend) {
    h += row("هشدار", "پاسخ‌دهندهٔ 8787 موتور اتصال ندارد (بک‌اند قدیمی؟)", "bad");
    h += row("راه‌حل", "هر کلیدی بزنید؛ سپس از تنظیمات آی‌پی سرور را بنویسید", "");
  }
  if (c.engine_error) h += row("خطای موتور", c.engine_error, "bad");
  box.innerHTML = h;
}

/* PingServerActivity.openWelcomeActivity(advVideoEM, layout[, language]):
   advVideoEM -> BootVideoActivity, layout 0 -> WelcomeStyleZeroActivity,
   anything else -> WelcomeStyleOtherActivity (the same card, other artwork). */
function openWelcomeActivity(w) {
  S.welcome = w || S.welcome || {};
  if (S.welcome.language != null) applyServerLanguage(S.welcome.language);
  if (S.welcome.screen === "bootvideo") enterBootVideo();
  else enterWelcome();
}

/* PingServerActivity.setLanguageData(): the server's language flag -> a Locale.
   The port ships fa/en/zh, so any other language keeps the local choice. */
const SERVER_LANGUAGE = {
  1: "en", 2: "zh", 3: "zh", 4: "th", 5: "th", 6: "ka", 7: "ka", 8: "fa", 9: "fa",
  10: "in", 11: "in", 12: "ar", 13: "ar", 14: "fr", 15: "fr", 16: "ru", 17: "ru",
  20: "hy", 21: "hy", 22: "vi", 23: "vi", 24: "es", 25: "es", 26: "it", 27: "it",
  28: "bg", 29: "bg", 30: "bg", 32: "pt", 33: "pt", 35: "tr",
};
const PORT_LANGUAGES = ["fa", "en", "zh"];
function applyServerLanguage(flag) {
  const want = SERVER_LANGUAGE[Number(flag)];
  if (!want || PORT_LANGUAGES.indexOf(want) < 0 || want === S.lang) return;
  S.lang = want;
  apiPost("/api/settings", { app_language: want }).catch(() => {});
  applyI18n();
  startClock();
}

/* ------------- v2.7.2.06: boot advert video (BootVideoActivity) -------------
   GetAdvVideoEM?mac= (WebTag.TAG_BOOT_VIDEO) -> List<String> of clips relative to
   /iptv2/. The first one plays full screen; onCompletion, onError or any key
   except VOLUME_UP/VOLUME_DOWN moves on to the welcome screen (isLeave guards a
   single transition). An empty list goes straight there. */
async function enterBootVideo() {
  S.bootLeft = false;
  S.bootVideoIndex = 0;
  S.bootVideos = [];
  show("scr-bootvideo", false);
  const hint = $("#bootvideo-hint");
  if (hint) {
    hint.classList.remove("fade");
    clearTimeout(S.bootHintTimer);
    S.bootHintTimer = setTimeout(() => hint.classList.add("fade"), 5000);
  }
  try { S.bootVideos = sanitiseAdvPaths(await apiGet("adv_video_em")); }
  catch (e) { S.bootVideos = []; }
  if (S.cur !== "scr-bootvideo") return;
  if (!S.bootVideos.length) { leaveBootVideo(); return; }
  playBootVideo(0);
}
function playBootVideo(i) {
  const video = $("#boot-video");
  if (!video || !S.bootVideos[i] || S.cur !== "scr-bootvideo") return;
  S.bootVideoIndex = i;
  const url = iptvUrl(S.bootVideos[i]);
  video.onended = () => leaveBootVideo();
  video.onerror = () => leaveBootVideo();
  const src = mediaSrc(url);
  try {
    if (classify(url) === "hls" && window.Hls && Hls.isSupported()) {
      if (S.bootHls) { try { S.bootHls.destroy(); } catch (e) {} }
      S.bootHls = new Hls({ manifestLoadingTimeOut: 12000, manifestLoadingMaxRetry: 2 });
      S.bootHls.loadSource(src);
      S.bootHls.attachMedia(video);
      S.bootHls.on(Hls.Events.MANIFEST_PARSED, () => tryPlay(video));
      S.bootHls.on(Hls.Events.ERROR, (e, d) => { if (d.fatal) leaveBootVideo(); });
    } else { video.src = src; tryPlay(video); }
  } catch (e) { leaveBootVideo(); }
  /* Safety net for the browser: a clip that never starts (autoplay refused even
     muted) is the APK's onError case, so retry muted and then move on instead of
     leaving the guest on a black screen. */
  clearTimeout(S.bootStallTimer);
  S.bootStallTimer = setTimeout(() => {
    if (S.bootLeft || S.cur !== "scr-bootvideo") return;
    const v = $("#boot-video");
    if (!v || v.currentTime > 0 || !v.paused) return;
    try { v.muted = true; tryPlay(v); } catch (e) {}
    clearTimeout(S.bootStallTimer);
    S.bootStallTimer = setTimeout(() => {
      if (S.bootLeft || S.cur !== "scr-bootvideo") return;
      const v2 = $("#boot-video");
      if (!v2 || (v2.paused && !(v2.currentTime > 0))) leaveBootVideo();
    }, 2500);
  }, 3500);
}
function stopBootVideo() {
  clearTimeout(S.bootHintTimer);
  clearTimeout(S.bootStallTimer);
  if (S.bootHls) { try { S.bootHls.destroy(); } catch (e) {} S.bootHls = null; }
  const video = $("#boot-video");
  if (!video) return;
  video.onended = null; video.onerror = null;
  try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) {}
}
function leaveBootVideo() {
  if (S.bootLeft) return;              // BootVideoActivity.isLeave
  S.bootLeft = true;
  stopBootVideo();
  /* BootVideoActivity always finishes into the welcome activity chosen by
     openWelcomeActivity(); WelcomeStyleZeroActivity.initData() is what honours
     Settings.skipWelcomePage. */
  enterWelcome();
}

/* BaseApplication.updateClient() runs inside the backend's Timer(task, 2000,
   5000); the screens only tell it what is on screen so UpdateClient?name=
   carries curPlayingLiveProgramName, exactly like the APK. */
function reportPlaying(name) {
  const v = name || "";
  if (S.curPlaying === v) return;
  S.curPlaying = v;
  apiPost("/api/connection/playing", { name: v }).catch(() => {});
}

/* ---------------------------------------------------------------------------
   WelcomeStyleZeroActivity - activity_welcome.xml

   onCreate -> initView() (binds the 900x450dp card, the MZBannerView, the
   IjkVideoView and the two language buttons, then simulates DPAD_UP so 中文
   starts focused) -> initData():

     getSettingsFromServer()
     isSkipWelcomePage() -> setSelectLanguage(from the device locale) -> openMain()
     getWelcomeWordTitleImage()  GetAdvImage?type=17 -> img_wel_word_title, which
                                 stays INVISIBLE while the list is empty
     isAdvVideoEM() ? playPptBGImage()   GetAdvImage?type=1, MZBannerView 5 s a page
                    : getWelcomeVideo()  GetAdvVideoEM -> isPlayVideo
     getWelcomeWord()      showHotelManager(false) + GetClient?mac=; CheckPerson
                           becomes persionName, Client.language is applied, then
                           showGuestName() and getWelcomeWordData()
                           (GetWelcomWord?mac=) -> showWelcomeText() + showWeekDay()
     getManagerSignImg()   GetAdvImage?type=12 -> manager_sign_img
     postDelayed(playWelcomeVideoOrNot, 1500)
     getWeather()          apk/getWeatherDays -> setShowWeather() + the three days
     getBgMusic()          apk/getClientBackgroundMusics, random and looped

   onKeyDown: UP/LEFT -> tv_chinese, DOWN/RIGHT -> tv_english, anything else is
   swallowed; onClick stores IptvSP.setSelectLanguage(0 for English, 1 otherwise)
   and calls openMain(). The screen therefore waits for the guest, exactly like
   the APK - only Settings.skipWelcomePage walks straight through.
   --------------------------------------------------------------------------- */
async function enterWelcome() {
  show("scr-welcome", false);
  S.persionName = "";
  S.welcomeWordZh = ""; S.welcomeWordEn = "";
  S.isGetWelcomeWordSuccessCh = false; S.isGetWelcomeWordSuccessEn = false;
  S.welcomeWordText = "";
  await refreshConnection();                       // getSettingsFromServer()
  const st = S.settings || {};
  if (st.skipWelcomePage) {                        // initData(): straight to main
    S.selectLanguage = selectLanguageFromLocale();
    openMain();
    return;
  }
  resetWelcomeCard();
  getWelcomeWordTitleImage();
  if (st.advVideoEM) playWelcomePpt();             // playPptBGImage()
  else await getWelcomeVideo();                    // GetAdvVideoEM -> isPlayVideo
  getWelcomeWord();
  getManagerSignImg();
  clearTimeout(S.welDelay);
  S.welDelay = setTimeout(playWelcomeVideoOrNot, 1500);
  getWeatherWelcome();
  loadBgMusic();
  initWelcomeListener();
  const zh = $("#wel-zh"); if (zh) { try { zh.focus(); } catch (e) {} }   // initPPT()
}

/* initListener(): tv_chinese and tv_english are the only clickable views. */
function initWelcomeListener() {
  const zh = $("#wel-zh"), en = $("#wel-en");
  if (zh) {
    zh.onclick = () => welcomeLanguage("zh");
    zh.onfocus = () => showWelcomeText(false);      // onFocusChange -> Chinese text
  }
  if (en) {
    en.onclick = () => welcomeLanguage("en");
    en.onfocus = () => showWelcomeText(true);       // onFocusChange -> English text
  }
}

/* WelcomeStyleZeroActivity.getSettingsFromServer(): every activity re-reads the
   handshake before it draws, so the screens always show the server's Settings. */
async function refreshConnection() {
  try { applyConnection(await (await fetch("/api/connection")).json()); } catch (e) {}
  return S.conn;
}

/* initData(): "en" (or ar with appLanguageType 35, ru with 30) -> selectLanguage
   0 = English, everything else -> 1. */
function selectLanguageFromLocale() {
  const loc = String((window.navigator && navigator.language) || S.lang || "").toLowerCase();
  return loc.indexOf("en") === 0 ? 0 : 1;
}

/* The card as activity_welcome.xml declares it: tv_user_name, tv_welcome_word_en
   and welcome_end_hotel_manager GONE, img_wel_word_title INVISIBLE, both weather
   layouts empty until apk/getWeatherDays answers. */
function resetWelcomeCard() {
  ["#wel-user", "#wel-word-en", "#wel-manager", "#wel-sign", "#wel-title-img",
   "#wel-weather", "#wel-forecast"].forEach(sel => { const n = $(sel); if (n) n.hidden = true; });
  const w = $("#wel-word"); if (w) { w.textContent = ""; w.hidden = false; }
  applyBranding();                                  // branding is the fallback text
}

const advList = (r) => (Array.isArray(r) ? r : ((r && r.list) || [])).filter(x => x);

/* GetAdvImage?type=17 -> img_wel_word_title (Glide .error(@mipmap/iv_welcome)) */
async function getWelcomeWordTitleImage() {
  const img = $("#wel-title-img");
  if (!img) return;
  img.hidden = true;
  let list = [];
  try { list = advList(await apiGet("adv_image", { type: 17 })); } catch (e) { list = []; }
  if (!list.length || S.cur !== "scr-welcome") return;
  img.onerror = () => { img.src = "/assets/img/mipmap__iv_welcome.png"; };
  img.src = imgUrl(list[0]);
  img.hidden = false;
}

/* GetAdvVideoEM?mac= -> WelcomeStyleZeroActivity$4: isPlayVideo = the list is
   not empty; playWelcomeVideoOrNot() runs 1500 ms later. */
async function getWelcomeVideo() {
  try { S.welVideos = sanitiseAdvPaths(await apiGet("adv_video_em")); } catch (e) { S.welVideos = []; }
  S.isPlayVideo = S.welVideos.length > 0;
}
function playWelcomeVideoOrNot() {
  if (S.cur !== "scr-welcome") return;
  if (!S.isPlayVideo) playWelcomePpt();
  else playWelcomeVideo(Math.floor(Math.random() * S.welVideos.length));
}
function playWelcomeVideo(i) {
  const video = $("#wel-video"), ppt = $("#wel-ppt");
  if (!video || !S.welVideos.length || S.cur !== "scr-welcome") return;
  const idx = ((i % S.welVideos.length) + S.welVideos.length) % S.welVideos.length;
  if (ppt) ppt.hidden = true;
  video.hidden = false;
  // onCompletion -> another random clip; onError -> isPlayVideo = 0, slideshow
  video.onended = () => { if (S.cur === "scr-welcome") playWelcomeVideo(Math.floor(Math.random() * S.welVideos.length)); };
  video.onerror = () => { S.isPlayVideo = false; if (S.cur === "scr-welcome") playWelcomePpt(); };
  video.src = mediaSrc(iptvUrl(S.welVideos[idx]));
  tryPlay(video);
}

/* playPptBGImage() / getBgPptAndMusic(): GetAdvImage?type=1 into the
   MZBannerView - initPPT() sets 5000 ms a page and hides nothing else. A single
   image is not rotated (setAutoPlay(size != 1)). */
async function playWelcomePpt() {
  const video = $("#wel-video"), ppt = $("#wel-ppt");
  if (video) {
    video.onended = null; video.onerror = null; video.hidden = true;
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) {}
  }
  if (!ppt) return;
  let list = [];
  try { list = advList(await apiGet("adv_image", { type: 1 })); } catch (e) { list = []; }
  if (!list.length || S.cur !== "scr-welcome") { ppt.hidden = true; return; }
  S.pptImages = list; S.pptIndex = 0;
  ppt.hidden = false;
  const paint = () => {
    if (S.cur !== "scr-welcome") return;
    const src = imgUrl(S.pptImages[S.pptIndex % S.pptImages.length]);
    S.pptIndex++;
    ppt.classList.add("switch");
    setTimeout(() => { ppt.src = src; ppt.classList.remove("switch"); }, 350);
  };
  paint();
  clearInterval(S.pptTimer); S.pptTimer = null;
  if (list.length > 1) S.pptTimer = setInterval(paint, 5000);
}

/* getWelcomeWord(): showHotelManager(false) first, then GetClient?mac= ($8) -
   CheckPerson becomes persionName, Client.language is applied through
   setAppLanguageData(), and finally showGuestName() + getWelcomeWordData(). */
async function getWelcomeWord() {
  showHotelManager(false);
  let c = null;
  try { c = await apiGet("client"); } catch (e) { c = null; }
  if (c && typeof c === "object") {
    S.client = c;
    if (c.checkPerson) S.persionName = String(c.checkPerson);
    const flag = parseInt(c.language, 10);
    if (!isNaN(flag)) {
      S.appLanguageType = flag;
      apiPost("/api/settings", { server_language_defalut_select_flag: flag, server_language_flag: flag }).catch(() => {});
      applyServerLanguage(flag);
    }
  }
  showGuestName();
  getWelcomeWordData();
}

/* showGuestName(): tv_user_name */
function showGuestName() {
  const n = $("#wel-user");
  if (!n) return;
  const st = S.settings || {};
  if (!S.persionName) {
    n.textContent = t("welcome_title_text_default", "میهمانان عزیز:");
  } else {
    const key = Number(st.pmsType) === 4 ? "welcome_word_guest_name_no_male" : "welcome_word_guest_name";
    n.textContent = t(key, "آقای/خانم . {0}").replace("{0}", S.persionName);
  }
  n.hidden = false;
}

/* showHotelManager(isEn): welcome_end_hotel_manager = "<hotel> <sign_text>", or
   "sign_text_hotel sign_text" when Settings carries no name. The residential
   deployment's complex name comes from the branding when the server is quiet. */
function showHotelManager(isEn) {
  const n = $("#wel-manager");
  if (!n) return;
  const st = S.settings || {}, b = S.branding || {};
  let name = isEn ? (st.hotelNameEn || "") : (st.hotelName || "");
  if (!name && S.mode !== "hotel") name = isEn ? (b.subtitle_en || "") : (b.subtitle || "");
  n.textContent = (name || t("sign_text_hotel", "هتل")) + " " + t("sign_text", "مدیرکل");
  n.hidden = false;
}

/* getWelcomeWordData(): GetWelcomWord?mac= ($9). "%s%" is the guest's name and
   "%s%:" the salutation; a missing side falls back to welcome_text_en. */
async function getWelcomeWordData() {
  const dflt = t("welcome_text_en", "به هتل ما خوش آمدید. در خدمت شما هستیم!");
  let w = null;
  try { w = await apiGet("welcome_word"); } catch (e) { w = null; }
  if (!w || typeof w !== "object") {
    S.isGetWelcomeWordSuccessEn = false; S.isGetWelcomeWordSuccessCh = false;
    S.welcomeWordEn = dflt; S.welcomeWordZh = dflt;
  } else {
    const en = w.content_en || "", zh = w.content || "";
    if (S.persionName) {
      S.isGetWelcomeWordSuccessEn = !!en;
      S.welcomeWordEn = en ? en.split("%s%").join(S.persionName) : dflt;
      S.isGetWelcomeWordSuccessCh = !!zh;
      S.welcomeWordZh = zh ? zh.split("%s%").join(S.persionName) : dflt;
    } else {
      S.isGetWelcomeWordSuccessEn = !!en;
      S.welcomeWordEn = en ? en.split("%s%:").join(t("welcome_title_text_default_en", "Guests:")) : dflt;
      S.isGetWelcomeWordSuccessCh = !!zh;
      S.welcomeWordZh = zh ? zh.split("%s%:").join(t("welcome_title_text_default_cur", "میهمانان عزیز:")) : dflt;
    }
  }
  S.welcomeWordText = S.welcomeWordZh;              // applyBranding() steps aside
  showWelcomeText(S.selectLanguage === 0);
}

/* showWelcomeText(isEnglish): tv_welcome_word_zh. Text that carries HTML goes to
   the WebView in the APK (tv_welcome_word_zh_web); the port renders it into the
   same view - the head-end is the author of both. */
function showWelcomeText(isEn) {
  const n = $("#wel-word");
  if (!n) return;
  const ok = isEn ? S.isGetWelcomeWordSuccessEn : S.isGetWelcomeWordSuccessCh;
  const txt = ok ? (isEn ? S.welcomeWordEn : S.welcomeWordZh)
                 : t("welcome_text_en", "به هتل ما خوش آمدید. در خدمت شما هستیم!");
  if (/style|&nbsp;|<p>/i.test(txt)) n.innerHTML = txt;
  else n.textContent = txt;
  n.hidden = false;
  const en2 = $("#wel-word-en"); if (en2) en2.hidden = true;      // GONE in the layout
  showWeekDay();
}

/* showWeekDay(): cur_date_view is "yyyy/MM/dd  EEEE" and the three forecast
   cells print "EE" of +1, +2 and +3 days (WelcomeStyleZeroActivity$10.onStart). */
function showWeekDay() {
  const d = serverNow();
  const n = $("#wel-date");
  if (n) n.textContent = fmtDate(d) + "  " + fmtWeek(d, "long");
  [["#wel-f1-week", 1], ["#wel-f2-week", 2], ["#wel-f3-week", 3]].forEach(pair => {
    const x = $(pair[0]);
    if (x) x.textContent = fmtWeek(new Date(d.getTime() + pair[1] * 86400000), "short");
  });
}
function localeTag() {
  return S.lang === "fa" ? "fa-IR" : (S.lang === "zh" ? "zh-CN" : (S.lang === "ar" ? "ar" : "en-GB"));
}
function fmtDate(d) {
  const p = (x) => String(x).padStart(2, "0");
  return d.getFullYear() + "/" + p(d.getMonth() + 1) + "/" + p(d.getDate());
}
function fmtWeek(d, len) {
  try { return d.toLocaleDateString(localeTag(), { weekday: len }); } catch (e) { return ""; }
}

/* GetAdvImage?type=12 -> manager_sign_img (a random entry, h=70dp) */
async function getManagerSignImg() {
  const img = $("#wel-sign");
  if (!img) return;
  img.hidden = true;
  let list = [];
  try { list = advList(await apiGet("adv_image", { type: 12 })); } catch (e) { return; }
  if (!list.length || S.cur !== "scr-welcome") return;
  img.src = imgUrl(list[Math.floor(Math.random() * list.length)]);
  img.hidden = false;
}

/* getWeather(): apk/getWeatherDays -> WeatherBean{status:"1000", data:[DataBean]}
   with DataBean{type, wendu, low, high}. data[0] is today, the rest are the
   three forecast cells; setShowWeather() makes both layouts visible. */
async function getWeatherWelcome() {
  let w = null;
  try { w = await apiGet("weather_days"); } catch (e) { return; }
  const list = (w && w.status != null && String(w.status) !== "1000") ? null : ((w && w.data) || null);
  if (!Array.isArray(list) || !list.length) return;
  S.weatherToday = list[0];
  if (S.cur === "scr-home") { initMainWeather(); return; }
  setShowWeather(true);
  const cur = list[0];
  const img = $("#wel-weather-img");
  if (img) img.src = weatherIcon(cur);
  const txt = $("#wel-weather-txt"); if (txt) txt.textContent = cur.wendu || "";
  const rng = $("#wel-weather-range"); if (rng) rng.textContent = rangeOf(cur);
  [["#wel-f1-img", 1], ["#wel-f2-img", 2], ["#wel-f3-img", 3]].forEach(pair => {
    const day = list[pair[1]], n = $(pair[0]);
    if (day && n) { n.src = weatherIcon(day, true); n.parentNode.hidden = false; }
  });
}
function rangeOf(d) {
  if (!d) return "";
  const lo = d.low != null ? d.low : "", hi = d.high != null ? d.high : "";
  return (lo === "" && hi === "") ? "" : (lo + "~" + hi);
}
/* setShowWeather(): no data -> weather_layout_gone GONE and
   weather_layout_invisible INVISIBLE; data -> both VISIBLE. */
function setShowWeather(has) {
  const inv = $("#wel-weather"), gone = $("#wel-forecast");
  if (inv) inv.hidden = !has;
  if (gone) gone.hidden = !has;
}
/* WeatherBean.WEATHER_FORECAST_STATUS_MAP keys the icon off the Chinese label,
   with an "n"/"d" suffix added before 06:00 and after 20:00. The port ships the
   four mipmaps the APK's map resolves to. */
function weatherIcon(d, forecast) {
  const type = String((d && (d.convertType || d.type)) || "");
  const hhmm = fmtHM(serverNow());
  const night = !forecast && (hhmm <= "06:00" || hhmm >= "20:00");
  let f = "sun";
  if (/雨|rain/i.test(type)) f = "rainy";
  else if (/云|cloud|阴|overcast/i.test(type)) f = "cloudy";
  else if (/雪|snow/i.test(type)) f = "cloudy";
  else if (/晴|clear|sun/i.test(type)) f = night ? "moon" : "sun";
  return "/assets/img/mipmap__" + f + ".png";
}
function fmtHM(d) {
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

/* apk/getClientBackgroundMusics -> res/adv/music/<url>, a random entry looped */
async function loadBgMusic() {
  let list = [];
  try { list = (advList(await apiGet("bg_musics"))).filter(x => x && x.url); } catch (e) { return; }
  if (!list.length || S.cur !== "scr-welcome") return;
  let a = S.bgMusic;
  if (!a) {
    a = document.createElement("audio");
    a.id = "bg-music";
    document.body.appendChild(a);
    S.bgMusic = a;
  }
  const next = () => {
    const b = list[Math.floor(Math.random() * list.length)];
    a.src = mediaSrc(iptvUrl("res/adv/music/" + enc(b.url)));
    tryPlay(a);
  };
  a.onended = () => { if (S.bgMusic && S.cur === "scr-welcome") next(); };
  next();
}
function stopWelcomeAdv() {
  clearInterval(S.pptTimer); S.pptTimer = null;
  clearTimeout(S.welDelay);
  const video = $("#wel-video"), ppt = $("#wel-ppt");
  if (video) {
    video.onended = null; video.onerror = null; video.hidden = true;
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) {}
  }
  if (ppt) ppt.hidden = true;
  stopBgMusic();
}
function stopBgMusic() {
  const a = S.bgMusic;
  if (!a) return;
  a.onended = null;
  try { a.pause(); a.removeAttribute("src"); a.load(); } catch (e) {}
}

/* onClick(tv_chinese / tv_english) -> setAppLanguageData() + setSelectLanguage()
   + openMain(). The APK's two buttons are Chinese and English; the port keeps
   both views and maps the non-English one to the language this deployment
   actually uses (Persian here), so the guest never lands in a language nobody
   in the building reads. */
function welcomeLanguage(which) {
  S.selectLanguage = which === "en" ? 0 : 1;
  apiPost("/api/settings", { select_language_flag: S.selectLanguage }).catch(() => {});
  const want = which === "en" ? "en" : (S.lang === "fa" ? "fa" : "zh");
  if (want !== S.lang) {
    S.lang = want;
    apiPost("/api/settings", { app_language: want }).catch(() => {});
    applyI18n();
    startClock();
  }
  openMain();
}

/* openMain(): IptvSP.setAppLayoutStyle(settings.getLayout()); 0 ->
   MainStyleThirdActivity (activity_main_ijk_style_third), anything else ->
   MainStyleFourthActivity (activity_main_ijk_style_fourth). */
function openMain() {
  const st = S.settings || {};
  const layout = Number(st.layout != null ? st.layout : (S.config.settings.app_layout_style || 0));
  apiPost("/api/settings", { app_layout_style: layout }).catch(() => {});
  const scr = $("#scr-home");
  if (scr) scr.classList.toggle("style-four", layout !== 0);
  stopWelcomeAdv();
  enterMain(layout);
}

/* ---------------------------------------------------------------------------
   MainStyleThirdActivity - activity_main_ijk_style_third.xml
   (MainStyleFourthActivity is the same code on activity_main_ijk_style_fourth)

   onCreate posts a Runnable that runs initTitleData() and then, according to
   Settings.indexArea, one of:
     1 -> initPpt() + getBgPptAndMusic() (GetAdvImage?type=0, 8 s a page) + getBgMusic()
     2 -> initBgVideo() + getBgVideo()   (apk/getClientBackgroundVideos)
     3 -> initPlayer() + getLiveProgList() (GetLiveTV?packageId=0 behind the menu)
   and re-posts itself after 30 s while BaseApplication.isConnected() is false.

   initView()  binds the views and paints main_layout_background_img with
               IptvSP.getMainBgImg(), else @mipmap/bg_welcome.
   initData()  isShowAppInMenu / isEpg, then the auto-entry:
               isEnabled() && settings.isEnterLivePage() -> LivePlayer(WithEpg)Activity.
   onResume()  switchToPlayBg(1) + right_show_action(): ll_main_menu slides in
               from the left over 2000 ms (it starts INVISIBLE).
   getMainPageMenu() -> GetHomepageIcon; a failed or empty answer means
               addMenuItemData(null) -> addDefaultMenu().
   Every startActivity() is gated by isConnectServer() (Toast status_disconnected)
   and isEnabled() (Toast status_disabled).
   onKeyDown() collects digits; when the buffer equals IptvSP.getPassword()
   (111999) it opens SettingsActivity, and a 2 s timer clears the buffer.
   --------------------------------------------------------------------------- */
function enterMain(layout) {
  S.mainEntered = false;                  // show() must not re-run initData()
  show("scr-home", false);
  S.stack = [];
  const scr = $("#scr-home");
  if (scr) scr.classList.remove("menu-in");
  initMainView(layout);
  initMainTitleData();
  isShowWifi();
  initMainWeather();
  getMainPageMenu();
  /* right_show_action(): the strip slides in, 2000 ms */
  clearTimeout(S.mainMenuTimer);
  S.mainMenuTimer = setTimeout(() => { const s2 = $("#scr-home"); if (s2) s2.classList.add("menu-in"); }, 60);
  initMainBackground();
  initMainData();
  S.mainEntered = true;
}

/* initView(): backgrounds, logo, room number, wifi, weather, clock. */
function initMainView(layout) {
  const st = S.settings || {};
  S.playTypendex = Number(st.indexArea || 0);
  /* main_layout_background_img: IptvSP.getMainBgImg() else @mipmap/bg_welcome */
  const bg = $("#main-bg");
  if (bg) {
    const saved = (S.config && S.config.settings && S.config.settings.main_bg_image) || "";
    bg.style.backgroundImage = saved ? 'url("' + imgUrl(saved) + '")'
      : 'url("/assets/img/mipmap__bg_welcome.png")';
  }
  /* tv_room_num: initTitleData() prints Client.name; the room label stays GONE */
  const room = $("#main-room-num");
  if (room) room.textContent = (S.client && S.client.name) || (S.config.settings.iptv_room_number || "");
  const rl = $("#main-room-label"); if (rl) rl.hidden = true;
  const tt = $("#main-title"); if (tt) tt.hidden = true;
  /* iv_logo has no src in the layout: it stays blank until GetAdvImage?type=2 */
  const logo = $("#main-logo"); if (logo) logo.hidden = true;
  startClock();
}

/* initTitleData(): GetAdvImage?mac=&type=2 -> iv_logo (a random entry). */
async function initMainTitleData() {
  let list = [];
  try { list = advList(await apiGet("adv_image", { type: 2 })); } catch (e) { list = []; }
  const logo = $("#main-logo");
  if (!logo || !list.length || S.cur !== "scr-home") return;
  logo.src = imgUrl(list[Math.floor(Math.random() * list.length)]);
  logo.hidden = false;
}

/* isShowWifi(): Client.wifiName + wifiPassword, formatted with R$string.account
   and R$string.password; anything missing hides wifi_status_layout. */
function isShowWifi() {
  const box = $("#main-wifi");
  if (!box) return;
  const c = S.client || {};
  const name = c.wifiName || "", pass = c.wifiPassword || "";
  if (!name || !pass) { box.hidden = true; return; }
  box.hidden = false;
  const pic = $(".main-wifi-pic", box); if (pic) pic.hidden = true;   // GONE in the layout
  $("#main-wifi-name").textContent = t("account", "نام：{0}").replace("{0}", name);
  $("#main-wifi-pass").textContent = t("password", "رمز：{0}").replace("{0}", pass);
}

/* EVENT_TODAY_WEATHER (posted by the welcome screen) fills weather_layout_main;
   without weather data the layout's own @mipmap/sun stays and the texts are
   empty, as on a head-end that does not publish weather. */
function initMainWeather() {
  const box = $("#main-weather");
  if (!box) return;
  const st = S.settings || {};
  const d = S.weatherToday;
  if (!d) {
    /* EVENT_TODAY_WEATHER is sticky in the APK: the welcome screen already
       fetched it. Entering main directly (skipWelcomePage) has to fetch it. */
    box.hidden = true;
    if (st.showWeather !== false) getWeatherWelcome().then(() => initMainWeather());
    return;
  }
  if (st.showWeather === false) { box.hidden = true; return; }
  box.hidden = false;
  const img = $("#main-weather-img"); if (img) img.src = weatherIcon(d);
  const s1 = $("#main-weather-status"); if (s1) s1.textContent = d.wendu || "";
  const s2 = $("#main-weather-range"); if (s2) s2.textContent = rangeOf(d);
}

/* getMainPageMenu(): GetHomepageIcon -> addMenuItemData(list); onFailure or an
   empty list -> addMenuItemData(null) -> addDefaultMenu(). */
async function getMainPageMenu() {
  let list = null;
  try {
    const r = await apiGet("homepage_icon");
    list = Array.isArray(r) ? r : ((r && r.list) || null);
  } catch (e) { list = null; }
  S.homepageIcons = Array.isArray(list) ? list : [];
  const st = S.settings || {};
  S.isShowPackage = !!st.showPackage;
  addMenuItemData(S.homepageIcons.length ? S.homepageIcons : null);
}

/* bean.MainMenu as the port needs it: id (the APK's type), icon/iconFocus (the
   server's icon1/icon), errorIcon/errorIconFocus (the built-in mipmaps), name,
   appName (the Intent extra), act (the activity to start), skip (false for the
   two popup tiles). */
function MainMenu(id, icon, iconFocus, mip, name, appName, act, skip) {
  return { id: id, icon: icon || "", iconFocus: iconFocus || "",
           errorIcon: "mipmap__icon_" + mip + ".png",
           errorIconFocus: "mipmap__icon_" + mip + "_large.png",
           name: name || "", appName: appName || "", act: act || null, skip: skip !== false };
}

/* The tile label: getMenuItemName() picks englishName when selectLanguage is 0
   and chineseName otherwise. MainPageItemBean has no Persian column, so a
   Persian UI uses the same string resource the APK uses for that tile type. */
function menuItemName(bean, typeKey) {
  if (!bean) return t(typeKey, typeKey);
  const en = bean.englishName || "", zh = bean.chineseName || "";
  if (S.lang === "fa") return t(typeKey, en || zh || typeKey);
  if (S.selectLanguage === 0) return en || zh || t(typeKey, typeKey);
  return zh || en || t(typeKey, typeKey);
}

/* addDefaultMenu(): what the APK shows when GetHomepageIcon fails - live, vod,
   playback (recordMode 2 -> the all-time list), scenery, dinner, the service
   popup, the third-app popup and the hotel/complex introduction. */
function addDefaultMenu() {
  const st = S.settings || {};
  const m = S.mainMenus = [];
  m.push(MainMenu(1, "", "", "live", t("live", "پخش زنده"), "activity_title_name_live",
    () => playLiveTV(), true));
  m.push(MainMenu(2, "", "", "vod", t("vod", "ویدئو"), "activity_title_name_vod",
    () => openVod(), true));
  m.push(MainMenu(3, "", "", "rec", t("main_menu_rec", "بازپخش"), "activity_title_name_play_back",
    () => openRec(), true));
  m.push(MainMenu(6, "", "", "scenery", t("scenery", "مناظر"), "activity_title_name_scenery",
    () => openScenery(), true));
  m.push(MainMenu(5, "", "", "dinner", t("dinner", "شام"), "activity_title_name_dinner",
    () => (st.caterSub ? openCountry() : openDinner()), true));
  m.push(MainMenu(7, "", "", "service", t("hotel_service", "خدمات"), "hotelService",
    () => openServicePopup(), false));
  m.push(MainMenu(8, "", "", "third_app", t("third_app", "اپلیکیشن سوم"), "thirdApp",
    () => openThirdAppPopup(), false));
  m.push(MainMenu(4, "", "", "hotel", t("hotel", "هتل"), "activity_title_name_hotel_intro",
    () => openHotel(), true));
  m.push(settingsMenuItem());
  if ((S.loacalThirdApkBeans || []).length && S.isShowAppInMenu) addLocalThirdAppInMenu();
  renderMainMenu();
}

/* addMenuItemData(list): the switch on MainPageItemBean.getType(). */
function addMenuItemData(list) {
  const st = S.settings || {};
  S.isShowEpgInfo = !!st.epg;
  S.isShowAppInMenu = !!st.appShowInMenu;
  S.isShowPackage = !!st.showPackage;
  S.recordMode = Number(st.recordMode || 0);
  const m = S.mainMenus = [];
  if (!list || !list.length) { addDefaultMenu(); return; }
  list.forEach(bean => {
    const type = Number(bean.type);
    const icon = bean.icon1 || "", iconFocus = bean.icon || "";
    switch (type) {
      case 0: {
        /* a third-party apk from GetAPK, matched by packageName or by name, and
           only while Settings.appShowInMenu is on. Its icon lives under
           ../res/client/apk/ on the head-end. */
        if (!S.isShowAppInMenu) break;
        const hit = (S.thirdApkBeanList || []).find(a =>
          (bean.packageName ? String(a.packageName || "") === String(bean.packageName)
                            : String(a.name || "") === (bean.chineseName || bean.englishName || "")));
        if (!hit) break;
        m.push(MainMenu(55, "res/client/apk/" + hit.icon, "res/client/apk/" + hit.icon, "settings",
          hit.name, hit.packageName, () => openThirdApkUrl(hit.url), true));
        break;
      }
      case 1:
        m.push(MainMenu(1, icon, iconFocus, "live", menuItemName(bean, "live"),
          "activity_title_name_live", () => playLiveTV(), true));
        break;
      case 2:
        m.push(MainMenu(2, icon, iconFocus, "vod", menuItemName(bean, "vod"),
          "activity_title_name_vod", () => openVod(), true));
        break;
      case 3:
        m.push(MainMenu(3, icon, iconFocus, "rec", menuItemName(bean, "main_menu_rec"),
          "activity_title_name_play_back", () => openRec(), true));
        break;
      case 4:
        m.push(MainMenu(4, icon, iconFocus, "hotel", menuItemName(bean, "hotel"),
          "activity_title_name_hotel_intro", () => openHotel(), true));
        break;
      case 5:
        m.push(MainMenu(5, icon, iconFocus, "dinner", menuItemName(bean, "dinner"),
          "activity_title_name_dinner", () => (st.caterSub ? openCountry() : openDinner()), true));
        break;
      case 6:
        m.push(MainMenu(6, icon, iconFocus, "scenery", menuItemName(bean, "scenery"),
          "activity_title_name_scenery", () => openScenery(), true));
        break;
      case 7:
        m.push(MainMenu(7, icon, iconFocus, "service", menuItemName(bean, "hotel_service"),
          "hotelService", () => openServicePopup(), false));
        break;
      case 8:
        /* with appShowInMenu the single tile is dropped: addLocalThirdAppInMenu()
           lists every chosen app instead. */
        if (S.isShowAppInMenu) break;
        m.push(MainMenu(8, icon, iconFocus, "third_app", menuItemName(bean, "third_app"),
          "thirdApp", () => openThirdAppPopup(), false));
        break;
      case 9:
        m.push(MainMenu(9, icon, iconFocus, "music", menuItemName(bean, "play_music"),
          "music_activity_title_name", () => openMusic(), true));
        break;
      default: break;
    }
  });
  m.push(settingsMenuItem());
  if ((S.loacalThirdApkBeans || []).length && S.isShowAppInMenu) addLocalThirdAppInMenu();
  renderMainMenu();
}

/* The APK reaches SettingsActivity only through the 111999 digit buffer; the
   Windows port keeps that, and adds a discoverable gear tile at the end of the
   menu (still password-gated, exactly like the activity). */
function settingsMenuItem() {
  return MainMenu(99, "", "", "settings", t("settings", "تنظیمات"), "settings",
    () => openSettings(false), true);
}

/* addLocalThirdAppInMenu(): readLocalThirdAppDatas() - the apps the installer
   chose in Settings, each as its own tile (type 55). */
function addLocalThirdAppInMenu() {
  (S.loacalThirdApkBeans || []).forEach(a => {
    S.mainMenus.push(MainMenu(55, "", "", "settings", a.name, a.packageName || a.name,
      () => launchApp(a.name), true));
  });
}

/* initAdapter() + StyleZeroMenuAdapter.convert(): adapter_main_menu_layout.xml,
   iv_menu 190x140dp and tv_menu_name 20sp #FFFFDD94. A server icon is loaded
   through IptvSP.getImagePath(); with none, the built-in mipmap shows - and the
   focused tile swaps to its *_large variant (onItemSelected). */
function renderMainMenu() {
  const nav = $("#home-menu");
  if (!nav) return;
  nav.innerHTML = "";
  S.mainMenus.forEach((item, i) => {
    const b = el("button", "mm-item focusable");
    b.dataset.index = String(i);
    const img = el("img");
    const local = (f) => "/assets/img/" + f;
    const paint = (focused) => {
      const srv = focused ? item.iconFocus : item.icon;
      const fallback = local(focused ? item.errorIconFocus : item.errorIcon);
      img.onerror = () => { img.onerror = null; img.src = fallback; };
      img.src = srv ? imgUrl(srv) : fallback;
    };
    paint(false);
    b.appendChild(img);
    b.appendChild(el("span", null, esc(item.name)));
    b.addEventListener("focus", () => paint(true));      // $7.onItemSelected
    b.addEventListener("blur", () => paint(false));      // $7.onItemPreSelected
    b.onclick = () => onMainMenuItem(i);
    nav.appendChild(b);
  });
  /* initAdapter(): fewer than six tiles are padded so the first one sits where
     the centred selection would put it (length_840/640/450/300/150). */
  const pad = { 1: 840, 2: 640, 3: 450, 4: 300, 5: 150 }[S.mainMenus.length];
  nav.style.paddingInlineStart = pad ? "calc(" + pad + " * var(--u))" : "";
  nav.style.paddingInlineEnd = pad ? "calc(" + pad + " * var(--u))" : "";
  focusFirst("scr-home");
}

/* $7.onItemClick(): a tile with skip=false opens its popup instead of an
   activity; both paths go through startActivity()'s two gates. */
function onMainMenuItem(i) {
  const item = S.mainMenus[i];
  if (!item) return;
  if (!item.skip) { item.act && item.act(); return; }
  startMainMenuActivity(item);
}

/* startActivity(cls, menu, title): isConnectServer() then isEnabled(). */
function startMainMenuActivity(item) {
  if (!isConnectServer()) return;
  if (!isEnabled()) return;
  stopMainBackground();
  if (item.act) item.act();
}
function isConnectServer() {
  if (S.connected) return true;
  toast(t("status_disconnected", "سرور قطع شد!"));
  return false;
}
function isEnabled() {
  const st = S.settings || {};
  if (!st.needCheekIn) return true;
  if (S.client && !S.client.enable) {
    toast(t("status_disabled", "درهتل پذیرش نشده."));
    return false;
  }
  return true;
}

/* The type 1 tile: !isShowPackage -> LivePlayer(WithEpg)Activity; isShowPackage
   -> showPackageStyle 1 ? LivePlayerWithPackageActivity : LivePackageActivity. */
function playLiveTV() {
  openLive();
}

/* The two popup tiles (type 7 service, type 8 third app). */
async function openServicePopup() {
  if (!isConnectServer() || !isEnabled()) return;
  openService();
}
async function openThirdAppPopup() {
  if (!isConnectServer() || !isEnabled()) return;
  openApps();
}
function openThirdApkUrl(url) {
  if (!url) return;
  window.open(iptvUrl(url), "_blank");
}

/* initData(): isShowAppInMenu / isEpg, then the auto-entry into live TV. */
function initMainData() {
  const st = S.settings || {};
  S.isShowAppInMenu = !!st.appShowInMenu;
  S.isShowEpgInfo = !!st.epg;
  if (isEnabled() && st.enterLivePage) {
    /* LivePlayerActivity, or LivePlayerWithEpgActivity when settings.epg */
    setTimeout(() => { if (S.cur === "scr-home") playLiveTV(); }, 400);
  }
  /* GetAPK (the type 0 tiles) and the locally chosen apps */
  apiGet("apk").then(r => { S.thirdApkBeanList = Array.isArray(r) ? r : []; })
    .catch(() => { S.thirdApkBeanList = []; });
  S.loacalThirdApkBeans = (S.appsSelected || []).map(n => ({ name: n, packageName: n }));
  if (S.isShowAppInMenu && S.loacalThirdApkBeans.length) getMainPageMenu();
}

/* The indexArea background: 1 = the MZBannerView slideshow (GetAdvImage?type=0,
   initPPT() -> 8000 ms a page) plus apk/getClientBackgroundMusics, 2 =
   apk/getClientBackgroundVideos in main_my_ijkplayer_view_vod, 3 = live TV in
   main_my_ijkplayer_view (getLiveProgList() -> playLiveTV()). */
function initMainBackground() {
  stopMainBackground();
  const kind = Number(S.playTypendex || 0);
  if (kind === 1) { mainPpt(); mainBgMusic(); }
  else if (kind === 2) { mainBgVideo(); }
  else if (kind === 3) { mainLiveBackground(); }
}
async function mainPpt() {
  const img = $("#main-banner");
  if (!img) return;
  let list = [];
  try { list = advList(await apiGet("adv_image", { type: 0 })); } catch (e) { list = []; }
  if (!list.length || S.cur !== "scr-home") return;
  S.mainBannerImages = list;
  let i = 0;
  const paint = () => {
    if (S.cur !== "scr-home") return;
    img.hidden = false;
    img.src = imgUrl(list[i % list.length]);
    i++;
  };
  paint();
  clearInterval(S.mainBannerTimer); S.mainBannerTimer = null;
  if (list.length > 1) S.mainBannerTimer = setInterval(paint, 8000);   // initPPT()
}
async function mainBgMusic() {
  let list = [];
  try { list = (advList(await apiGet("bg_musics"))).filter(x => x && x.url); } catch (e) { return; }
  if (!list.length || S.cur !== "scr-home") return;
  let a = S.mainMusic;
  if (!a) { a = document.createElement("audio"); a.id = "main-music"; document.body.appendChild(a); S.mainMusic = a; }
  const next = () => {
    const b = list[Math.floor(Math.random() * list.length)];
    a.src = mediaSrc(iptvUrl("res/adv/music/" + enc(b.url)));
    tryPlay(a);
  };
  a.onended = () => { if (S.mainMusic && S.cur === "scr-home") next(); };
  next();
}
async function mainBgVideo() {
  const v = $("#main-bgvideo");
  if (!v) return;
  let list = [];
  try { list = sanitiseAdvPaths(await apiGet("bg_videos")); } catch (e) { list = []; }
  if (!list.length || S.cur !== "scr-home") return;
  S.mainBgVideos = list;
  v.hidden = false;
  v.onended = () => { if (S.cur === "scr-home") attachSource(v, iptvUrl(list[Math.floor(Math.random() * list.length)]), "mainHls"); };
  attachSource(v, iptvUrl(list[0]), "mainHls");
}
/* getLiveProgList(): GetLiveTV?packageId=0 -> playLiveTV() behind the menu;
   lambda$initPlayer$0 retries at most three times on error. */
async function mainLiveBackground() {
  const v = $("#main-live");
  if (!v) return;
  let list = [];
  try {
    if (m3uActive()) list = (S.m3uChannels || []).map(m3uChannel);
    else list = (await apiGet("live_tv", { packageId: 0 })) || [];
  } catch (e) { list = []; }
  if (!Array.isArray(list) || !list.length || S.cur !== "scr-home") return;
  S.mainLiveList = list;
  const idx = Math.max(0, list.findIndex(c => c.id === S.config.settings.last_channel));
  const item = list[idx];
  const [src] = pickSource(item);
  if (!src) return;
  v.hidden = false;
  S.mainLiveErrors = 0;
  v.onerror = () => {
    S.mainLiveErrors = (S.mainLiveErrors || 0) + 1;
    if (S.mainLiveErrors <= 3 && S.cur === "scr-home") mainLiveBackground();
  };
  attachSource(v, src, "mainHls");
  reportPlaying(nm(item) || item.name || "");
}
/* one place that knows how to hand a URL to a <video>: HLS through the proxy
   with hls.js, everything else through the local remux. */
function attachSource(video, url, hlsKey) {
  const src = mediaSrc(url);
  try {
    if (classify(url) === "hls" && window.Hls && Hls.isSupported()) {
      if (S[hlsKey]) { try { S[hlsKey].destroy(); } catch (e) {} }
      const h = new Hls({ manifestLoadingTimeOut: 12000, manifestLoadingMaxRetry: 2 });
      S[hlsKey] = h;
      h.loadSource(src);
      h.attachMedia(video);
      h.on(Hls.Events.MANIFEST_PARSED, () => tryPlay(video));
      return;
    }
  } catch (e) {}
  video.src = src;
  tryPlay(video);
}
/* switchToPlayBg(0) / onPause / onDestroy: everything behind the menu stops. */
function stopMainBackground() {
  clearInterval(S.mainBannerTimer); S.mainBannerTimer = null;
  const img = $("#main-banner"); if (img) { img.hidden = true; img.removeAttribute("src"); }
  ["#main-bgvideo", "#main-live"].forEach(sel => {
    const v = $(sel);
    if (!v) return;
    v.onended = null; v.onerror = null; v.hidden = true;
    try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) {}
  });
  if (S.mainHls) { try { S.mainHls.destroy(); } catch (e) {} S.mainHls = null; }
  const a = S.mainMusic;
  if (a) { a.onended = null; try { a.pause(); a.removeAttribute("src"); a.load(); } catch (e) {} }
}

/* ----------------------------- LIVE ----------------------------- */
/* A residential head-end is usually published as an m3u playlist rather than
   through the platform's GetLiveTV table. Settings -> "Channel list (m3u)" sets
   the source; group-title becomes the package and every entry a channel. The
   server list stays as the fallback while the playlist is off. */
async function openM3u() {
  const m = S.m3u || {};
  if (m.enabled) {
    const off = await askConfirm(t("m3u_source", "فهرست کانال‌ها (m3u)"),
      m.count ? ("فهرست " + m.count + " کانال غیرفعال شود و کانال‌ها دوباره از سرور خوانده شوند؟")
              : "این فهرست غیرفعال شود؟",
      t("not_enabled", "غیرفعال"));
    if (off) {
      const r = await apiPost("/api/m3u", { enabled: false });
      S.m3u = (r && r.m3u) || {}; S.m3uChannels = [];
      S.config = await cfg(); fillSettings();
      toast(t("not_enabled", "غیرفعال"));
    }
    return;
  }
  const mo = $("#input-modal"); mo.hidden = false;
  const df = $("#diag-list"); if (df) df.remove();
  const dfield = $("#input-field"); if (dfield) dfield.type = "text";
  $("#input-title").textContent = t("m3u_source", "فهرست کانال‌ها (m3u)");
  const h = $("#input-hint");
  if (h) { h.hidden = false; h.textContent = t("m3u_source_hint", "نشانی یا مسیر فایل فهرست پخش") + " — http(s)://… .m3u یا C:\\lists\\channels.m3u8"; }
  const f = $("#input-field"); f.value = m.url || m.path || ""; f.focus();
  $("#input-ok").onclick = async () => {
    const v = f.value.trim();
    const isUrl = /^https?:\/\//i.test(v);
    const r = await apiPost("/api/m3u", { url: isUrl ? v : "", path: isUrl ? "" : v, enabled: !!v });
    mo.hidden = true;
    S.m3u = (r && r.m3u) || {};
    if (S.m3u.enabled && S.m3u.count) {
      try { const d = await (await fetch("/api/m3u")).json(); S.m3uChannels = d.channels || []; } catch (e) {}
    } else S.m3uChannels = [];
    S.config = await cfg(); fillSettings(); focusFirst("scr-settings");
    if (S.m3u.error) toast(S.m3u.error);
    else toast("● " + (S.m3u.count || 0) + " " + t("channel_count", "کانال"));
  };
  $("#input-cancel").onclick = () => { mo.hidden = true; focusFirst("scr-settings"); };
}
/* One-click pre-flight check for the thing that actually matters after the
   installer finishes: can this box reach the head-end, does the head-end hand out
   channels, and can this machine play the URLs it returns? Everything comes from
   the backend's /api/diagnose, which re-tests the socket, GetSettings, the live
   tables, ffmpeg and the m3u source. */
async function runDiagnose() {
  const dv = $("#set-diag-value");
  if (dv) { dv.textContent = "…"; dv.classList.remove("ok", "bad"); }
  let d = null;
  try { d = await (await fetch("/api/diagnose")).json(); }
  catch (e) { if (dv) { dv.textContent = t("status_disconnected", "خطا"); dv.classList.add("bad"); } return; }
  S.config = await cfg(); fillSettings();
  const m = $("#input-modal"); m.hidden = false;
  $("#input-title").textContent = t("diag_live_check", "بررسی پخش زنده");
  const h = $("#input-hint");
  if (h) {
    h.hidden = false;
    h.textContent = (d.server && d.server.address ? d.server.address : "") +
      " · RTSP " + (d.server && d.server.rtsp_port) +
      " · MAC " + ((d.network && d.network.mac) || "-") +
      (d.unit ? " · " + t("unit_number", "شمارهٔ واحد") + " " + d.unit : "") +
      (d.protocol ? " · protocol=" + d.protocol : "");
  }
  const f = $("#input-field");
  f.type = "hidden"; f.value = "";
  f.insertAdjacentHTML("afterend", '<div class="diag-list" id="diag-list"></div>');
  const list = $("#diag-list");
  (d.checks || []).forEach(c => {
    const row = el("div", "diag-item" + (c.ok ? "" : " bad"));
    row.appendChild(el("span", "mark", c.ok ? "✓" : "✗"));
    const body = el("div");
    body.appendChild(el("div", "nm", t("diag_" + c.name, c.name) + (c.detail ? " — " + c.detail : "")));
    if (!c.ok && c.hint) body.appendChild(el("div", "hn", c.hint));
    row.appendChild(body);
    list.appendChild(row);
  });
  if (d.sample_channels && d.sample_channels.length) {
    const row = el("div", "diag-item");
    row.appendChild(el("span", "mark", "≡"));
    const body = el("div");
    body.appendChild(el("div", "nm", t("diag_sample", "نمونهٔ کانال‌ها")));
    d.sample_channels.forEach(c => body.appendChild(el("div", "dt",
      (c.number != null ? c.number + ". " : "") + (c.name || "") + "  [" + c.kind + "] " + (c.src || ""))));
    row.appendChild(body); list.appendChild(row);
  }
  const rep = el("pre", "diag-report");
  rep.dir = "ltr";
  rep.textContent = JSON.stringify({
    version: S.config.version,
    ip: (S.config.network || {}).ip,
    server: d.server,
    multicast: d.multicast,
    ffmpeg: d.ffmpeg, vlc: d.vlc,
    channels: (d.sample_channels || []).map(c => ({ n: c.number, urls: c.urls })),
    player_log: d.player_log || [],
  }, null, 1);
  list.appendChild(rep);
  /* the dialog's buttons carry data-i18n, so drop it while they read as a
     verdict and let applyI18n() put it back in closeDiag() */
  const okBtn = $("#input-ok"), cancel = $("#input-cancel");
  okBtn.removeAttribute("data-i18n"); cancel.removeAttribute("data-i18n");
  okBtn.textContent = d.ok ? t("diag_ok", "همه‌چیز آماده است") : t("diag_has_issues", "نیاز به رسیدگی");
  okBtn.onclick = () => closeDiag();
  cancel.textContent = t("cancel", "انصراف");
  cancel.onclick = () => closeDiag();
  if (dv) { dv.textContent = d.ok ? "✓ " + t("ready", "آماده") : "✗ " + (d.issues || []).length; dv.classList.toggle("ok", !!d.ok); dv.classList.toggle("bad", !d.ok); }
  setTimeout(() => { try { okBtn.focus(); } catch (e) {} }, 40);
}
function closeDiag() {
  const m = $("#input-modal");
  const list = $("#diag-list"); if (list) list.remove();
  const f = $("#input-field"); if (f) { f.type = "text"; f.value = ""; }
  const h = $("#input-hint"); if (h) { h.hidden = true; h.textContent = ""; }
  const okBtn = $("#input-ok"), cancel = $("#input-cancel");
  okBtn.setAttribute("data-i18n", "submit"); cancel.setAttribute("data-i18n", "cancel");
  okBtn.textContent = t("submit", "تأیید"); cancel.textContent = t("cancel", "انصراف");
  m.hidden = true; focusFirst("scr-settings");
}
function m3uChannel(c) {
  /* classify() already defaults to "http", so every playlist entry ends up with a
     playable source: .m3u8 -> hlsUrl (hls.js), anything else -> httpUrl, which
     playItem() sends through /stream/play (FFmpeg remuxes MPEG-TS to HLS). */
  const o = { id: c.id, number: c.number, name: c.name, url: c.url, liveType: 0, _m3u: true };
  if (c.logo) o.icon = c.logo;
  if (classify(c.url) === "hls") o.hlsUrl = c.url;
  else o.httpUrl = c.url;
  return o;
}
function m3uPackages() {
  const groups = [];
  (S.m3uChannels || []).forEach(c => { if (groups.indexOf(c.group) < 0) groups.push(c.group); });
  return groups.map((g, i) => ({ id: "m3u:" + i, number: i + 1, name: g, _group: g }));
}
function m3uActive() {
  return !!(S.m3u && S.m3u.enabled && (S.m3uChannels || []).length);
}

/* playLiveTV(): !isShowPackage -> LivePlayerActivity, or LivePlayerWithEpgActivity
   when settings.epg (both are this port's player screen, with or without the EPG
   panel). isShowPackage -> showPackageStyle 1 ? LivePlayerWithPackageActivity
   (the player, packages switchable inside it) : LivePackageActivity (the list). */
async function openLive() {
  const st = S.settings || {};
  try {
    if (m3uActive()) {
      S.packages = m3uPackages();
      renderPackages();
      show("scr-livepkg");
      return;
    }
    if (st.showPackage) {
      S.packages = (await apiGet("live_packages")) || [];
      if (Number(st.showPackageStyle) === 1 && S.packages.length) {
        await loadChannels(S.packages[0].id);
        startPlayer("live");
        return;
      }
      renderPackages();
      show("scr-livepkg");
    } else {
      await loadChannels(-1);
      startPlayer("live");
    }
  } catch (e) { toast(t("status_disconnected", "خطا در دریافت کانال‌ها")); }
}
function renderPackages() {
  const list = $("#pkg-list"); list.innerHTML = "";
  S.packages.forEach(p => {
    const d = el("div", "pkg-item focusable");
    d.appendChild(el("span", "num", String(p.number != null ? p.number : p.id)));
    d.appendChild(el("span", null, nm(p) || p.name || ""));
    if (p.price) d.appendChild(el("span", "price", String(p.price)));
    d.onclick = async () => { await loadChannels(p.id); startPlayer("live"); };
    list.appendChild(d);
  });
}
async function loadChannels(packageId) {
  if (typeof packageId === "string" && packageId.indexOf("m3u:") === 0) {
    const g = ((S.packages || []).find(p => p.id === packageId) || {})._group;
    S.channels = (S.m3uChannels || []).filter(c => c.group === g).map(m3uChannel);
  } else if (packageId === -1 && m3uActive()) {
    S.channels = (S.m3uChannels || []).map(m3uChannel);
  } else {
    S.channels = (await apiGet("live_tv", { packageId: packageId })) || [];
  }
  S.channels.forEach(c => { if (S.favourites.indexOf(c.id) >= 0) c._fav = true; });
}
function pickSourceAll(item) {
  const proto = ((S.settings && S.settings.protocol) || "rtsp").toLowerCase();
  let rtsp = item.rtspUrl || "";
  const hls = item.hlsUrl || "", http = item.httpUrl || "", url = item.url || "";
  if (!rtsp && item.number != null && S.config && S.config.settings) {
    rtsp = "rtsp://" + (S.config.settings.server_ip || "") + ":" +
      (S.config.settings.rtsp_port || 554) + "/live/" + item.number + ".sdp";
  }
  const ff = !!(S.config && S.config.ffmpeg);
  const needsFf = (u) => { const k = classify(u); return k === "rtsp" || k === "udp" || k === "mpegts"; };
  let order;
  if (proto === "hls") order = [hls, rtsp, http, url];
  else if (proto === "http") order = [http, hls, rtsp, url];
  else order = [rtsp, hls, http, url];   // rtsp first: unicast beats multicast
  const protos = { };
  const out = [];
  for (const u of order) {
    if (!u || out.some(x => x[0] === u)) continue;
    if (!ff && needsFf(u)) continue;
    out.push([u, u === rtsp ? "rtsp" : (u === hls ? "hls" : (u === http ? "http" : "auto"))]);
  }
  if (!out.length) for (const u of order) if (u) out.push([u, "auto"]);
  return out;
}

function pickSource(item) {
  return pickSourceAll(item)[0] || ["", ""];
}

function pickSourceLegacy(item) {
  const proto = ((S.settings && S.settings.protocol) || "rtsp").toLowerCase();
  let rtsp = item.rtspUrl || "";
  const hls = item.hlsUrl || "", http = item.httpUrl || "", url = item.url || "";
  if (!rtsp && item.number != null && S.config && S.config.settings) {
    /* IptvSP.getLiveRtspUrl(n): the APK's UNICAST feed - rtsp://ip:554/live/n.sdp.
       A bean that only carries udp:// must not drag the player onto multicast:
       multicast dies at firewalls and subnet borders, unicast rtsp does not. */
    rtsp = "rtsp://" + (S.config.settings.server_ip || "") + ":" +
      (S.config.settings.rtsp_port || 554) + "/live/" + item.number + ".sdp";
  }
  const mc = (S.config && S.config.multicast) || null;
  const mcDead = mc && mc.bytes === 0 && (Date.now() / 1000 - (mc.at || 0)) < 600;
  if (mcDead && url.indexOf("udp") === 0) {
    const ff = !!(S.config && S.config.ffmpeg);
    if (rtsp && ff) return [rtsp, "rtsp"];
    if (hls) return [hls, "hls"];
    if (http) return [http, "http"];
  }
  /* RTSP / UDP / MPEG-TS only play through the local FFmpeg remux
     (/stream/play). If ffmpeg.exe is missing - a machine installed without
     internet, or a blocked PyPI download - preferring the head-end's HLS or
     plain-HTTP URL keeps the channel playing instead of showing a black screen. */
  const ff = !!(S.config && S.config.ffmpeg);
  const needsFf = (u) => { const k = classify(u); return k === "rtsp" || k === "udp" || k === "mpegts"; };
  if (proto === "hls" && hls) return [hls, "hls"];
  if (proto === "http" && http) return [http, "http"];
  if (proto === "udp" && url.indexOf("udp") === 0) {
    /* multicast is the last resort on Windows - see choose_play_source() */
    if (rtsp && ff) return [rtsp, "rtsp"];
    if (hls) return [hls, "hls"];
    if (http) return [http, "http"];
    return [url, "udp"];
  }
  if (proto === "rtsp" && rtsp) {
    if (ff || (!hls && !http)) return [rtsp, "rtsp"];
    return [hls || http, hls ? "hls" : "http"];
  }
  const cands = [[hls, "hls"], [http, "http"], [rtsp, "rtsp"], [url, "auto"]];
  for (const c of cands) {
    if (!c[0]) continue;
    if (!ff && needsFf(c[0])) continue;
    return c;
  }
  for (const c of cands) if (c[0]) return c;
  return [url || rtsp || http || hls, proto];
}
function classify(u) {
  u = (u || "").toLowerCase();
  if (u.indexOf("rtsp://") === 0) return "rtsp";
  if (u.indexOf("udp://") === 0 || u.indexOf("rtp://") === 0) return "udp";
  if (u.indexOf(".m3u8") >= 0) return "hls";
  if (u.slice(-3) === ".ts" || u.indexOf(".ts?") >= 0) return "mpegts";
  return "http";
}
function startPlayer(kind, item, list) {
  show("scr-player");
  S.playerCtx = { kind: kind, item: item, list: list || (kind === "live" ? S.channels : null), index: 0 };
  if (kind === "live" && !item) {
    const idx = Math.max(0, S.channels.findIndex(c => c.id === S.config.settings.last_channel));
    S.playerCtx.index = idx; item = S.channels[idx];
  }
  playItem(item);
  armOsd();
}
async function playItem(item, opts) {
  S.playerCtx.item = item;
  const video = $("#video");
  stopVideo(false);
  $("#player-loading").style.display = "flex";
  startLoadAnim();
  $("#player-error").hidden = true;
  const pet0 = $("#player-error-txt");
  if (pet0 && !pet0.hasAttribute("data-i18n")) {
    pet0.setAttribute("data-i18n", "decoding_video_failed"); applyI18n();
  }
  S.playerCtx.queue = (opts && opts.keepQueue && S.playerCtx.queue && S.playerCtx.queue.length)
    ? S.playerCtx.queue : pickSourceAll(item);
  const [src, proto] = S.playerCtx.queue[0] || ["", ""];
  S.playerCtx.origSrc = src;
  S.playerCtx.proto = proto;
  /* BaseApplication.curPlayingLiveProgramName -> UpdateClient?name=... */
  reportPlaying(S.playerCtx.kind === "live" ? (nm(item) || item.name || "") : "");
  /* v2.7.2.06: use_vlc_paly_live_prg hands live playback to the external
     player (LivePlayerActivity.playWithVlc). If VLC is missing the Android app
     toasts vlc_player_install_tips and keeps playing internally. */
  if (S.playerCtx.kind === "live" && S.vlc && src) {
    /* LivePlayerActivity.playWithVlc(): once the external player takes the
       stream it IS the player - the internal one must not race it. */
    let handed = false;
    try {
      const r = await apiPost("/api/external_player", { url: src, title: item.name || "" });
      handed = !!(r && r.ok);
    } catch (e) { handed = false; }
    if (handed) {
      $("#player-loading").style.display = "none"; stopLoadAnim();
      toast(t("external_player_on", "پخش به پخش‌کنندهٔ خارجی سپرده شد") + " (VLC)");
      return;
    }
    toast(t("vlc_player_install_tips", "پخش‌کننده VLC شناسایی نشد. لطفاً ابتدا آن را نصب کنید!"));
  }
  const kind = classify(src);
  /* RTSP / UDP / MPEG-TS are remuxed to HLS by the local FFmpeg, so without
     ffmpeg.exe (a machine installed with no internet, or a blocked PyPI
     download) those channels cannot play at all. The source is still classified
     below - the overlays, the EPG poll and the pre-roll advert are all armed
     first, and only then does the player say why there is no picture instead of
     leaving a black screen with a generic "decoding failed" banner. */
  const noFfmpeg = !S.config.ffmpeg && (kind === "rtsp" || kind === "udp" || kind === "mpegts");
  let playUrl;
  if (kind === "hls") playUrl = "/proxy?url=" + enc(src);
  else if (kind === "rtsp" || kind === "udp" || kind === "mpegts") playUrl = "/stream/play?src=" + enc(src) + "&proto=" + enc(proto);
  else playUrl = "/stream/play?src=" + enc(src);
  const useHls = (kind === "hls" || kind === "rtsp" || kind === "udp" || kind === "mpegts") && window.Hls && Hls.isSupported();
  // overlays
  const badge = $("#ch-badge");
  if (S.playerCtx.kind === "live") {
    badge.hidden = false;
    $("#ch-number").textContent = item.number != null ? item.number : "";
    $("#ch-name").textContent = nm(item) || item.name || "";
    apiPost("/api/settings", { last_channel: item.id });
    clearTimeout(S._badgeT); S._badgeT = setTimeout(() => badge.hidden = true, 4000);
    pollEpg(item);
    setupEpg(item);   // v2.7.2.06: settings.epg -> LivePlayerWithEpgActivity
    if (!(opts && opts.noAd)) startAdCheck(item);   // v2.7.2.06: settings.activeAdv
  } else {
    badge.hidden = true;
    $("#osd-title").textContent = item.videoName || nm(item) || item.name || "";
  }
  // watermark / advert image (v2: GetAdvImage?type=3 fills water_mark_image_view)
  const wm = $("#watermark");
  wm.onerror = () => { wm.hidden = true; };
  if (S.playerCtx.kind === "live") loadAdImage();
  else if (S.settings && (S.settings.showWaterMarkVod || S.settings.showWaterMark)) { wm.hidden = false; wm.src = imgUrl("res/watermark.png"); }
  else wm.hidden = true;
  // v2: report how long the previous live programme was watched (AddAdvHistory type=1)
  if (S.playerCtx.kind === "live") reportLiveWatch(item);
  applyVolume();
  if (noFfmpeg) {
    $("#player-loading").style.display = "none"; stopLoadAnim();
    $("#player-error").hidden = false;
    const pet = $("#player-error-txt");
    if (pet) {
      pet.removeAttribute("data-i18n");   // a port message, not an APK string
      pet.textContent = t("ffmpeg_missing_long",
        "این کانال برای پخش به FFmpeg نیاز دارد (tools\\ffmpeg.exe) و FFmpeg پیدا نشد.");
    }
    healFfmpeg(item);
    return;
  }
  const retryBtn = $("#player-retry");
  if (retryBtn) retryBtn.onclick = () => {
    $("#player-error").hidden = true;
    S.vlcTried = false;
    S.playerCtx.autoTried = false;
    playItem(S.playerCtx.item, { noAd: true });
  };
  const vlcBtn = $("#player-vlc");
  if (vlcBtn) {
    vlcBtn.hidden = !S.config.vlc_installed;
    vlcBtn.onclick = () => handToVlc();
  }
  try {
    if (useHls) {
      S.hls = new Hls({ manifestLoadingTimeOut: 12000, manifestLoadingMaxRetry: 2, levelLoadingTimeOut: 12000, fragLoadingTimeOut: 20000 });
      S.hls.loadSource(playUrl);
      S.hls.attachMedia(video);
      S.hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      S.hls.on(Hls.Events.ERROR, (e, d) => {
        if (d.fatal) showPlayerError("hls: " + d.type + "/" + d.details);
      });
    } else {
      video.src = playUrl;
      video.play().catch(() => {});
    }
  } catch (e) {
    showPlayerError("player setup exception: " + ((e && e.message) || e));
  }
  video.onplaying = () => { $("#player-loading").style.display = "none"; stopLoadAnim(); $("#player-error").hidden = true; applySpeed(); };
  video.onwaiting = () => { $("#player-loading").style.display = "flex"; startLoadAnim(); };
  video.onerror = () => {
    /* MEDIA_ERR_DECODE/SRC_NOT_SUPPORTED on the main element is exactly the
       APK's "Decoding video failed!" - name the codec and recover. */
    showPlayerError("video element error " + ((video.error && video.error.code) || "?"),
                    { decode: true });
  };
}
/* The installer's PowerShell download can die on old TLS stacks or an offline
   install day; the backend fetches the same static Windows build through
   Python's own TLS while the app runs. Ask it to, poll /api/config, and replay
   the channel the moment tools\ffmpeg.exe lands - no restart, no user action. */
/* IjkMediaPlayer's "Decoding video failed!" is what the APK shows for every
   playback death; the port keeps the string but no longer leaves the user
   guessing: it names the real codec (an H.265 head-end cannot be decoded by
   the browser's MSE), shows ffmpeg's own stderr tail, offers a retry, and
   hands the stream to VLC exactly like LivePlayerActivity.playWithVlc(). */
async function showPlayerError(extra, opts) {
  const q = (S.playerCtx && S.playerCtx.queue) || [];
  if (q.length > 1 && !S.playerCtx.autoTried) {
    S.playerCtx.autoTried = true;
    S.playerCtx.queue = q.slice(1);
    toast(t("src_fallback", "این منبع پخش نشد؛ منبع بعدی همان کانال امتحان می‌شود…"));
    playItem(S.playerCtx.item, { noAd: true, keepQueue: true });
    return;
  }
  $("#player-loading").style.display = "none";
  stopLoadAnim();
  $("#player-error").hidden = false;
  let sessions = [];
  try { sessions = (await (await fetch("/api/streams")).json()) || []; } catch (e) {}
  const mine = sessions.find(x => x.source === (S.playerCtx || {}).origSrc)
    || sessions[sessions.length - 1] || null;
  const codec = (mine && mine.codec) || "";
  const lines = [];
  lines.push("build " + ((S.config && S.config.build) || "?") +
    " · proto " + (((S.settings && S.settings.protocol) || "?")));
  if ((S.playerCtx || {}).origSrc) lines.push("src: " + S.playerCtx.origSrc);
  if (codec) lines.push((S.lang === "fa" ? "کدک جریان: " : "stream codec: ") + codec);
  if (mine && mine.error) lines.push("ffmpeg: " + String(mine.error).slice(-160));
  else if (mine && mine.log && mine.log.length) lines.push("ffmpeg: " + mine.log[mine.log.length - 1].slice(-160));
  if (((S.playerCtx || {}).origSrc || "").indexOf("udp") === 0) {
    const mc = (S.config && S.config.multicast) || null;
    lines.push(mc && mc.bytes >= 0
      ? "multicast probe: " + mc.bytes + " bytes / 2.5s"
      : "multicast probe: not run yet");
  }
  if (extra) lines.push(String(extra).slice(0, 160));
  const det = $("#player-error-detail");
  if (det) {
    det.hidden = !lines.length;
    det.textContent = lines.join("\n");
  }
  const hevc = /hevc|h265/i.test(codec);
  const decodeFail = !!(opts && opts.decode);
  const vlcBtn = $("#player-vlc");
  if (vlcBtn) vlcBtn.hidden = !S.config.vlc_installed;
  const instBtn = $("#player-vlc-install");
  if (instBtn) {
    instBtn.hidden = !((S.config.vlc_fetch || {}).enabled && !S.config.vlc_installed);
    instBtn.onclick = () => healVlc(S.playerCtx.item);
  }
  if (hevc && !S.config.vlc_installed && det) {
    det.textContent += "\n" + t("hevc_need_vlc",
      "این کانال H.265/HEVC است و مرورگر آن را کدگشایی نمی‌کند؛ VLC را نصب کنید تا پخش خودکار سپرده شود.");
  }
  if ((hevc || decodeFail) && S.config.vlc_installed && !S.vlcTried) {
    S.vlcTried = true;
    handToVlc();
  }
  try {
    apiPost("/api/player_report", { text: lines.join(" | ") + (extra ? " | " + extra : "") });
  } catch (e) {}
}

window.addEventListener("error", (ev) => {
  if (S.cur === "scr-player" && ev && ev.message) {
    showPlayerError("js: " + ev.message);
  }
});

/* In-app self update: one tap on Settings -> "Version update" downloads the
   sha-verified zip from the release manifest, stages it, swaps and relaunches.
   No zip juggling, no locked files, no half-installs - the round-trip that
   kept failing in the field is now entirely inside the app. */
async function runUpdate() {
  toast(t("update_check", "در حال بررسی بروزرسانی…"));
  let c = null;
  try { c = await (await fetch("/api/update/check")).json(); }
  catch (e) { c = null; }
  if (!c) { toast(t("update_fail", "بررسی بروزرسانی ناموفق بود؛ شبکه را بررسی کنید.")); return; }
  if (!c.available) {
    toast(t("update_latest", "نسخهٔ شما به‌روز است: build ") + (c.build || "?"));
    return;
  }
  toast(t("update_apply", "بروزرسانی دانلود شد؛ برنامه چند لحظه دیگر خودش را عوض و دوباره باز می‌کند…"));
  apiPost("/api/update/apply", {}).catch(() => {});
}

function handToVlc() {
  const src = (S.playerCtx || {}).origSrc;
  if (!src) return;
  apiPost("/api/external_player", { url: src, title: (S.playerCtx.item && S.playerCtx.item.name) || "" })
    .then(r => {
      if (r && r.ok) toast(t("external_player_on", "پخش به پخش‌کنندهٔ خارجی سپرده شد") + " (VLC)");
      else toast(t("vlc_player_install_tips", "پخش‌کننده VLC شناسایی نشد. لطفاً ابتدا آن را نصب کنید!"));
    }).catch(() => {});
}

/* Same background pattern as healFfmpeg: unpack portable VLC under tools\vlc
   and hand the very same stream over, so an HEVC head-end plays without any
   installer, admin rights or codec pack. */
function healVlc(item) {
  const instBtn = $("#player-vlc-install");
  if (instBtn) instBtn.disabled = true;
  toast(t("vlc_fetch_start", "دریافت VLC قابل‌حمل آغاز شد؛ کمی صبر کنید…"));
  apiPost("/api/vlc/ensure", {}).catch(() => {});
  let tries = 0;
  const poll = setInterval(async () => {
    tries += 1;
    let cfg = null;
    try { cfg = await (await fetch("/api/config")).json(); } catch (e) {}
    if (cfg && cfg.vlc_installed) {
      clearInterval(poll);
      S.config.vlc_installed = true;
      S.vlc = true;
      S.vlcTried = false;
      toast(t("vlc_ready", "VLC آماده شد؛ پخش به آن سپرده می‌شود."));
      handToVlc();
    } else if (tries >= 150) {
      clearInterval(poll);
      if (instBtn) instBtn.disabled = false;
      toast(t("vlc_fetch_fail", "دریافت VLC ناموفق بود؛ اگر LAN اینترنت ندارد، VLC را دستی نصب کنید."));
    }
  }, 4000);
}

function healFfmpeg(item) {
  if (!(S.config.ffmpeg_fetch || {}).enabled) return;
  apiPost("/api/ffmpeg/ensure", {}).catch(() => {});
  clearInterval(S.ffHealTimer);
  let tries = 0;
  S.ffHealTimer = setInterval(async () => {
    tries += 1;
    let cfg = null;
    try { cfg = await (await fetch("/api/config")).json(); } catch (e) { cfg = null; }
    if (cfg && cfg.ffmpeg) {
      clearInterval(S.ffHealTimer); S.ffHealTimer = null;
      S.config = cfg;
      toast(t("ffmpeg_installed", "FFmpeg نصب شد؛ پخش دوباره شروع می‌شود"));
      if (item) playItem(item, { noAd: true });
      return;
    }
    if (tries > 120) { clearInterval(S.ffHealTimer); S.ffHealTimer = null; }
  }, 4000);
}

function stopVideo(hideScreen) {
  reportPlaying("");                    // UpdateClient?name= is empty again
  const video = $("#video");
  try { if (S.hls) { S.hls.destroy(); S.hls = null; } } catch (e) {}
  try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) {}
  if (hideScreen !== false) { /* caller switches screen */ }
}
function pollEpg(item) {
  clearInterval(S._epgT);
  if (item && item._m3u) return;      // playlist channels have no platform EPG
  const tick = async () => {
    try {
      const st = await apiGet("live_status");
      if (Array.isArray(st)) {
        const cur = st.find(c => c.id === item.id) || {};
        $("#osd-sub").textContent = cur.name || item.name || "";
      }
    } catch (e) {}
  };
  tick(); S._epgT = setInterval(tick, 30000);
}

/* ------------- v2.7.2.06: EPG (LivePlayerWithEpgActivity) ------------- */
async function setupEpg(item) {
  const btn = $("#btn-epg");
  const on = !!(S.settings && S.settings.epg) && S.playerCtx && S.playerCtx.kind === "live";
  if (btn) btn.hidden = !on;
  S.epg = []; S.epgIndex = -1;
  if (!on) { $("#epg-panel").hidden = true; $("#epg-detail").hidden = true; return; }
  try {
    const list = await apiGet("live_epg", { liveId: item.id });
    S.epg = Array.isArray(list) ? list : ((list && list.list) || []);
    const cur = S.epg.findIndex(p => p.playing);
    S.epgIndex = cur >= 0 ? cur : 0;
    if (cur >= 0 && S.epg[cur].program) $("#osd-sub").textContent = S.epg[cur].program;
    renderEpg();
    if (!$("#epg-panel").hidden) focusFirst("scr-player");
  } catch (e) { S.epg = []; }
}
function renderEpg() {
  const box = $("#epg-list"); if (!box) return;
  const it = (S.playerCtx && S.playerCtx.item) || {};
  $("#epg-ch").textContent = it.name || "";
  box.innerHTML = "";
  S.epg.forEach((p, i) => {
    const d = el("div", "epg-item focusable" + (p.playing ? " now" : (p.timeshift ? " past" : "")));
    d.appendChild(el("span", "tm", (p.startTime || "") + "–" + (p.endTime || "")));
    d.appendChild(el("span", "pg", p.program || p.content || ""));
    if (p.playing) d.appendChild(el("span", "tag", t("now_playing", "در حال پخش")));
    else if (p.timeshift) d.appendChild(el("span", "tag", t("timeshift_play", "پخش با تأخیر")));
    d.onclick = () => {
      S.epgIndex = i;
      if (p.playing) { $("#epg-panel").hidden = true; $("#epg-detail").hidden = true; focusFirst("scr-player"); return; }
      if (p.timeshift) { playTimeshift(p); return; }
      showEpgDetail(i);
    };
    box.appendChild(d);
  });
  if (!S.epg.length) box.appendChild(el("div", "epg-item", t("no_epg_data", "اطلاعات برنامه‌ها در دسترس نیست")));
}
function toggleEpg() {
  const p = $("#epg-panel");
  if (!S.epg.length && !(S.settings && S.settings.epg)) return;
  p.hidden = !p.hidden;
  $("#epg-detail").hidden = true;
  if (!p.hidden) { renderEpg(); focusFirst("scr-player"); }
}
function showEpgDetail(idx) {
  if (!S.epg.length) return;
  let i = idx;
  if (i == null || i < 0) i = S.epg.findIndex(p => p.playing);
  if (i < 0) i = S.epgIndex >= 0 ? S.epgIndex : 0;
  const p = S.epg[i]; if (!p) return;
  S.epgIndex = i;
  $("#epg-detail-title").textContent = p.program || "";
  $("#epg-detail-time").textContent = (p.date || "") + "  " + (p.startTime || "") + "–" + (p.endTime || "");
  $("#epg-detail-content").textContent = p.content || "";
  $("#epg-detail").hidden = false;
  clearTimeout(S._epgDetT);
  S._epgDetT = setTimeout(() => { $("#epg-detail").hidden = true; }, 9000);
}
async function playTimeshift(prog) {
  /* Android plays a finished programme through the timeshift server
     (GetEpgRecProgram / GetRecProgram on the same liveId). */
  const it = (S.playerCtx && S.playerCtx.item) || {};
  try {
    const recs = await apiGet("epg_rec_program", { liveId: it.id });
    const list = Array.isArray(recs) ? recs : ((recs && recs.list) || []);
    const hit = list.find(r => (r.program || r.name) === (prog.program || prog.name)) || list[0];
    if (hit && (hit.url || hit.httpUrl || hit.hlsUrl)) {
      $("#epg-panel").hidden = true;
      startPlayer("vod", { videoName: (prog.program || hit.name || ""), url: hit.url || hit.httpUrl || hit.hlsUrl });
      return;
    }
  } catch (e) {}
  toast(t("timeshift_unavailable", "پخش با تأخیر برای این برنامه در دسترس نیست"));
}

/* ------------- v2.7.2.06: playback speed (txt_play_speed) ------------- */
function applySpeed() {
  const v = $("#video");
  try { v.playbackRate = S.speed; } catch (e) {}
  const sv = $("#speed-val"); if (sv) sv.textContent = (Math.round(S.speed * 100) / 100) + "x";
  if (v && v.playbackRate && Math.abs(v.playbackRate - S.speed) > 0.02) {
    S.speed = 1; try { v.playbackRate = 1; } catch (e) {}
    if (sv) sv.textContent = "1x";
    toast(t("play_speed_error", "تنظیم انجام نشد؛ پخش با سرعت عادی ادامه می‌یابد!"));
  }
}
function cycleSpeed() {
  const v = $("#video");
  const started = v && v.readyState > 1 && !v.paused;
  if (!started) { toast(t("play_speed_tips", "لطفاً سرعت پخش را پس از شروع ویدئو تنظیم کنید!")); return; }
  const i = S.speeds.indexOf(S.speed);
  S.speed = S.speeds[(i + 1) % S.speeds.length];
  applySpeed();
  apiPost("/api/settings", { play_speed: S.speed }).catch(() => {});
  toast(t("play_speed_txt", "سرعت") + ": " + S.speed + "x");
}

/* ------------- v2.7.2.06: in-player advertising -------------
   LivePlayerWithEpgActivity: GetAdvImage?type=3 (image in the watermark view),
   GetNextAdv?mac=&liveId= (pre-roll video, status 200 + resource{url,allowSkip}),
   a countdown from ad_video_time_remains, and AddAdvHistory?mac=&id=&type=&time=&check=
   (type 1 = live watch time, type 2 = advert; check 1 = seen to the end, 2 = skipped). */
async function loadAdImage() {
  const wm = $("#watermark");
  try {
    const list = await apiGet("adv_image", { type: 3 });
    const arr = Array.isArray(list) ? list : ((list && list.list) || []);
    if (arr.length) {
      wm.hidden = false;
      wm.src = imgUrl(arr[Math.floor(Math.random() * arr.length)]);
      return;
    }
  } catch (e) {}
  if (S.settings && S.settings.showWaterMark) { wm.hidden = false; wm.src = imgUrl("res/watermark.png"); }
  else wm.hidden = true;
}
async function startAdCheck(item) {
  if (!(S.settings && S.settings.activeAdv)) return;
  if (item._m3u) return;                          // playlist channels: no platform advert/EPG ids
  if (item.liveType === 1) return;              // liveType 1 channels carry no pre-roll
  let bean = null;
  try {
    const list = await apiGet("next_adv", { liveId: item.id });
    bean = Array.isArray(list) && list.length ? list[0] : null;
  } catch (e) { return; }
  if (!bean || bean.status !== 200 || !bean.resource || !bean.resource.url) return;
  if (!S.ad && S.playerCtx.item === item && S.cur === "scr-player") playAd(bean.resource, item);
}
function playAd(res, item) {
  const video = $("#video");
  stopVideo(false);
  S.ad = {
    id: res.id != null ? res.id : -1, canSkip: !!res.allowSkip, item: item,
    startedAt: Date.now(), remains: parseInt(res.countTime || "0", 10) || 15,
  };
  const base = "http://" + S.config.settings.server_ip + ":" + S.config.settings.server_port;
  const url = res.url.indexOf("http") === 0 ? res.url : base + (res.url.charAt(0) === "/" ? "" : "/") + res.url;
  $("#player-loading").style.display = "flex"; startLoadAnim();
  const kind = classify(url);
  const playUrl = kind === "hls" ? "/proxy?url=" + enc(url) : "/stream/play?src=" + enc(url);
  try {
    if (kind === "hls" && window.Hls && Hls.isSupported()) {
      S.hls = new Hls({ manifestLoadingTimeOut: 12000, manifestLoadingMaxRetry: 2 });
      S.hls.loadSource(playUrl); S.hls.attachMedia(video);
      S.hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
    } else { video.src = playUrl; video.play().catch(() => {}); }
  } catch (e) { finishAd(2); return; }
  $("#ad-countdown").hidden = false;
  paintAdCountdown();
  clearInterval(S.adTimer);
  S.adTimer = setInterval(() => {
    if (!S.ad) return;
    S.ad.remains -= 1;
    if (S.ad.remains <= 0) { finishAd(1); return; }   // played to the end
    paintAdCountdown();
  }, 1000);
  video.onloadedmetadata = () => {
    if (S.ad && video.duration && isFinite(video.duration)) {
      S.ad.remains = Math.max(1, Math.round(video.duration)); paintAdCountdown();
    }
  };
  video.onplaying = () => { $("#player-loading").style.display = "none"; stopLoadAnim(); };
  video.onended = () => finishAd(1);
  video.onerror = () => finishAd(2);
  $("#osd-title").textContent = res.name || t("ad_video_time_remains", "Ad");
  $("#ch-badge").hidden = true;
}
function paintAdCountdown() {
  if (!S.ad) return;
  const n = $("#ad-countdown-txt");
  if (n) n.innerHTML = t("ad_video_time_remains", "{0}S│Ad countdown").replace("{0}", "<b>" + S.ad.remains + "</b>");
}
function finishAd(check) {
  const ad = S.ad; if (!ad) return;
  S.ad = null;
  clearInterval(S.adTimer); S.adTimer = null;
  const box = $("#ad-countdown"); if (box) box.hidden = true;
  const video = $("#video");
  video.onended = null; video.onerror = null; video.onloadedmetadata = null;
  const elapsed = Date.now() - ad.startedAt;
  apiPost("/api/post", { ep: "add_adv_history", id: ad.id, type: 2, time: elapsed, check: check }).catch(() => {});
  playItem(ad.item, { noAd: true });            // back to the channel the guest picked
}
/* AddAdvHistory type=1: watch time of the live programme we are leaving */
function reportLiveWatch(nextItem) {
  const w = S.liveWatch;
  if (w && w._m3u) { S.liveWatch = null; return; }   // no AddAdvHistory ids for playlist channels
  if (w && (!nextItem || nextItem.id !== w.id)) {
    apiPost("/api/post", { ep: "add_adv_history", id: w.id, type: 1, time: Date.now() - w.startedAt, check: 1 }).catch(() => {});
  }
  S.liveWatch = (S.playerCtx && S.playerCtx.kind === "live" && nextItem && !nextItem._m3u)
    ? { id: nextItem.id, startedAt: Date.now() } : null;
}

/* ------------- v2.7.2.06: local apps (SettingAppShowActivity) ------------- */
async function launchApp(name) {
  try {
    const r = await apiPost("/api/launch", { app: name });
    if (!r || !r.ok) toast(t("app_launch_failed", "اجرای برنامه ناموفق بود") + (r && r.error ? " (" + r.error + ")" : ""));
  } catch (e) { toast(t("app_launch_failed", "اجرای برنامه ناموفق بود")); }
}

function armOsd() {
  const osd = $("#player-osd");
  const kick = () => { osd.hidden = false; clearTimeout(S.idleTimer); S.idleTimer = setTimeout(() => { osd.hidden = true; }, 4000); };
  window.onmousemove = kick; kick();
  $("#btn-fav").onclick = toggleFav;
  $("#btn-list").onclick = toggleSideList;
  $("#btn-epg").onclick = toggleEpg;
  $("#btn-speed").onclick = cycleSpeed;
  $("#btn-ratio").onclick = () => {
    const v = $("#video");
    v.style.objectFit = v.style.objectFit === "cover" ? "contain" : "cover";
  };
}
function toggleFav() {
  const it = S.playerCtx && S.playerCtx.item; if (!it) return;
  const i = S.favourites.indexOf(it.id);
  if (i >= 0) S.favourites.splice(i, 1); else S.favourites.push(it.id);
  apiPost("/api/settings", { favourites: S.favourites });
  toast(i >= 0 ? "حذف از علاقه‌مندی‌ها" : "افزوده شد به علاقه‌مندی‌ها ★");
}
function toggleSideList() {
  const sl = $("#side-list");
  if (!S.playerCtx || !S.playerCtx.list) return;
  sl.hidden = !sl.hidden;
  if (!sl.hidden) {
    sl.innerHTML = "";
    S.playerCtx.list.forEach((c, i) => {
      const d = el("div", "side-item focusable" + (i === S.playerCtx.index ? " sel" : ""));
      d.appendChild(el("span", "n", String(c.number != null ? c.number : i + 1)));
      d.appendChild(el("span", null, nm(c) || c.name || c.videoName || ""));
      d.onclick = () => { S.playerCtx.index = i; playItem(c); sl.hidden = true; };
      sl.appendChild(d);
    });
    focusFirst("scr-player");
  }
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}
function bumpVolume(d) {
  S.volume = Math.max(0, Math.min(1, S.volume + d / 100));
  applyVolume();
  const o = $("#vol-osd"); o.hidden = false;
  $("#vol-fill").style.width = (S.volume * 100) + "%";
  $("#vol-num").textContent = Math.round(S.volume * 100);
  clearTimeout(S._volT); S._volT = setTimeout(() => o.hidden = true, 1600);
  apiPost("/api/volume", { volume: Math.round(S.volume * 100) });
}
function toggleMute() { S.muted = !S.muted; applyVolume(); apiPost("/api/volume", { muted: S.muted }); }
function applyVolume() { const v = $("#video"); v.volume = S.volume; v.muted = S.muted; }

/* ----------------------------- VOD ----------------------------- */
let vodTypes = [], vodCur = null;
async function openVod() {
  show("scr-vod");
  try {
    vodTypes = (await apiGet("vod_types")) || [];
    const tr = $("#vod-types"); tr.innerHTML = "";
    vodTypes.forEach((ty, i) => {
      const d = el("div", "type-item focusable" + (i === 0 ? " active" : ""));
      d.textContent = nm(ty) || ty.name || "";
      d.onclick = () => { $$("#vod-types .type-item").forEach(x => x.classList.remove("active")); d.classList.add("active"); loadVodGrid(ty.id); };
      tr.appendChild(d);
    });
    if (vodTypes.length) loadVodGrid(vodTypes[0].id);
    else { $("#vod-grid").innerHTML = ""; toast(t("vod_no_video", "فایلی موجود نیست")); }
  } catch (e) { toast(t("vod_loading_failed", "بارگیری ناموفق")); }
}
async function loadVodGrid(typeId) {
  try {
    const list = (await apiGet("vod", { typeId: typeId })) || [];
    const g = $("#vod-grid"); g.innerHTML = "";
    list.forEach(v => {
      const p = el("div", "poster focusable");
      const img = el("img");
      const cover = v.imagePath || v.cover || v.icon || v.poster;
      img.src = cover ? imgUrl(cover) : imgUrl((v.videoName || v.id) + ".jpg");
      img.onerror = () => { img.src = "/assets/img/mipmap__icon_vod_type_default.png"; img.style.objectFit = "contain"; img.style.padding = "2em"; };
      p.appendChild(img);
      p.appendChild(el("div", "cap", v.videoName || nm(v) || ""));
      p.onclick = () => openVodDetail(v);
      g.appendChild(p);
    });
    if (!list.length) toast(t("vod_no_video", "فایلی موجود نیست"));
  } catch (e) {}
}
function openVodDetail(v) {
  vodCur = v;
  $("#vod-detail").hidden = false;
  $("#vd-title").textContent = v.videoName || "";
  const vc = v.imagePath || v.cover || v.icon || v.poster;
  $("#vd-poster").src = vc ? imgUrl(vc) : imgUrl((v.videoName || v.id) + ".jpg");
  $("#vd-poster").onerror = () => { $("#vd-poster").src = "/assets/img/mipmap__icon_vod_type_default.png"; };
  $("#vd-syn").textContent = v.synopsis || v.description || "";
  $("#vd-dir").textContent = v.director || "";
  $("#vd-dur").textContent = v.duration || "";
  $("#vd-price").textContent = v.price != null ? v.price : "";
  $("#vd-play").onclick = () => {
    $("#vod-detail").hidden = true;
    apiPost("/api/post", { ep: "update_vod_click", vodId: v.vodId || v.id }).catch(() => {});
    startPlayer("vod", v);
  };
  $("#vd-close").onclick = () => { $("#vod-detail").hidden = true; focusFirst("scr-vod"); };
  $("#vd-play").focus();
}

/* ----------------------------- REC / EPG ----------------------------- */
/* v2.7.2.06: RecordEpgActivity / RecordEpgAllTimeActivity
   GetRecTV (all recorded channels) -> GetEpgRecProgram?liveId= grouped by date */
let recProgs = [];
async function openRec() {
  show("scr-rec");
  const c1 = $("#rec-channels"), c2 = $("#rec-dates"), c3 = $("#rec-progs");
  c1.innerHTML = ""; c2.innerHTML = ""; c3.innerHTML = "";
  try {
    let chs = (await apiGet("rec_tv")) || [];
    if (!Array.isArray(chs) || !chs.length) chs = (await apiGet("live_tv", { packageId: -1 })) || [];
    chs.slice(0, 80).forEach(c => {
      const d = el("div", "rec-item focusable");
      d.textContent = (c.number != null ? c.number + "  " : "") + (nm(c) || c.name || "");
      d.onclick = () => loadRecDates(c);
      c1.appendChild(d);
    });
    if (!chs.length) c1.appendChild(el("div", "rec-item", t("no_data", "اطلاعاتی موجود نیست")));
  } catch (e) { toast(t("loading_failed", "بارگیری ناموفق")); }
  focusFirst("scr-rec");
}
async function loadRecDates(c) {
  const c2 = $("#rec-dates"), c3 = $("#rec-progs");
  c2.innerHTML = ""; c3.innerHTML = "";
  try {
    const progs = (await apiGet("epg_rec_program", { liveId: c.id })) || [];
    recProgs = Array.isArray(progs) ? progs : ((progs && progs.list) || []);
    const dates = [];
    recProgs.forEach(p => { const k = p.date || ""; if (k && dates.indexOf(k) < 0) dates.push(k); });
    if (!dates.length) dates.push("");
    dates.forEach(dt => {
      const d = el("div", "rec-item focusable", dt || t("all_time", "همه زمان‌ها"));
      d.onclick = () => renderRecProgs(dt);
      c2.appendChild(d);
    });
    renderRecProgs(dates[0]);
  } catch (e) { recProgs = []; }
}
function renderRecProgs(date) {
  const c3 = $("#rec-progs"); c3.innerHTML = "";
  const list = recProgs.filter(p => !date || (p.date || "") === date);
  list.forEach(p => {
    const dd = el("div", "rec-item focusable");
    const tm = (p.startTime && p.endTime) ? (p.startTime + "–" + p.endTime + "  ") : "";
    dd.textContent = tm + (nm(p, "program") || p.name || p.program || "");
    dd.onclick = () => startPlayer("vod", {
      videoName: nm(p, "program") || p.name || p.program || "",
      url: p.url || p.httpUrl || p.hlsUrl || "",
    });
    c3.appendChild(dd);
  });
  if (!list.length) c3.appendChild(el("div", "rec-item", t("no_data", "اطلاعاتی موجود نیست")));
}

/* ----------------------------- SCENERY ----------------------------- */
async function openScenery() {
  show("scr-scenery");
  try {
    const sc = await apiGet("scenery");
    const items = (sc && (sc.items || sc.list)) || (Array.isArray(sc) ? sc : []);
    const g = $("#scen-grid"); g.innerHTML = "";
    items.forEach(it => {
      const d = el("div", "poster scen-item focusable");
      const img = el("img"); img.src = imgUrl(it.imagePath || it.icon || it.url || "");
      img.onerror = () => img.src = "/assets/img/mipmap__pic_swimming_pool_demo.jpg";
      d.appendChild(img); d.appendChild(el("div", "cap", nm(it) || it.name || it.title || ""));
      g.appendChild(d);
    });
  } catch (e) {}
}

/* ----------------------------- DINNER / CATERING ----------------------------- */
/* v2.7.2.06: when the server sets caterSub, the dining menu opens
   CateringCountrySelecterActivity first; GetFoodType then returns the food
   types of the chosen country via ?parentId= */
async function openDinner() {
  const st = S.settings || {};
  if (st.caterSub) { openCountry(); return; }
  openCatering(null);
}
async function openCountry() {
  show("scr-country");
  const box = $("#country-list"); box.innerHTML = "";
  try {
    const cs = (await apiGet("food_type")) || [];
    (Array.isArray(cs) ? cs : []).forEach(c => {
      const d = el("div", "country-item focusable");
      if (c.imagePath) {
        const img = el("img"); img.src = imgUrl(c.imagePath);
        img.onerror = () => img.remove(); d.appendChild(img);
      }
      d.appendChild(el("div", null, nm(c) || ""));
      d.onclick = () => openCatering(c.id);
      box.appendChild(d);
    });
    if (!(Array.isArray(cs) ? cs : []).length) toast(t("no_data", "اطلاعاتی موجود نیست"));
  } catch (e) { toast(t("loading_failed", "بارگیری ناموفق")); }
  focusFirst("scr-country");
}
async function openCatering(parentId) {
  show("scr-dinner");
  try {
    const types = (await apiGet("food_type", parentId ? { parentId: parentId } : {})) || [];
    const tr = $("#dinner-types"); tr.innerHTML = "";
    (Array.isArray(types) ? types : []).forEach((ty, i) => {
      const d = el("div", "type-item focusable" + (i === 0 ? " active" : ""));
      d.textContent = nm(ty) || "";
      d.onclick = () => { $$("#dinner-types .type-item").forEach(x => x.classList.remove("active")); d.classList.add("active"); loadFood(ty.id); };
      tr.appendChild(d);
    });
    if (types.length) loadFood(types[0].id);
  } catch (e) { toast(t("loading_failed", "بارگیری ناموفق")); }
  $("#dinner-orders").onclick = () => openOrders();
  const badge = $("#dinner-orders");
  badge.textContent = t("my_order", "سفارش من") + (basketCount() ? " (" + basketCount() + ")" : "");
  focusFirst("scr-dinner");
}
function basketCount() { return Object.keys(S.basket || {}).reduce((a, k) => a + S.basket[k], 0); }
async function loadFood(typeId) {
  try {
    const foods = (await apiGet("food", { typeId: typeId })) || [];
    const g = $("#dinner-items"); g.innerHTML = "";
    (Array.isArray(foods) ? foods : []).forEach(f => {
      const d = el("div", "food-item focusable");
      const img = el("img"); img.src = imgUrl(f.imagePath || f.cover || "");
      img.onerror = () => img.src = "/assets/img/mipmap__icon_food_count.png";
      d.appendChild(img);
      d.appendChild(el("div", "cap", nm(f) || ""));
      d.appendChild(el("div", "price", f.price != null ? String(f.price) : ""));
      d.onclick = () => {
        S.basket = S.basket || {};
        const k = String(f.id);
        S.basket[k] = (S.basket[k] || 0) + 1;
        S.basketItems = S.basketItems || {};
        S.basketItems[k] = f;
        toast((nm(f) || "") + " ×" + S.basket[k]);
        const b = $("#dinner-orders");
        if (b) b.textContent = t("my_order", "سفارش من") + " (" + basketCount() + ")";
      };
      g.appendChild(d);
    });
    if (!(Array.isArray(foods) ? foods : []).length) toast(t("no_data", "اطلاعاتی موجود نیست"));
  } catch (e) {}
}

/* ---- v2.7.2.06: MyOrderActivity (basket) + MyHistoryOrderList/Detail ---- */
async function openOrders() {
  show("scr-orders");
  const box = $("#order-list"); box.innerHTML = "";
  // 1) current basket -> AddFoodOrder?countAndIds=&mac=
  const items = S.basketItems || {};
  const keys = Object.keys(S.basket || {}).filter(k => S.basket[k] > 0);
  if (keys.length) {
    const head = el("div", "order-item");
    head.appendChild(el("span", "oi-name", t("my_order", "سفارش من")));
    let total = 0;
    keys.forEach(k => { total += (Number(items[k] && items[k].price) || 0) * S.basket[k]; });
    head.appendChild(el("span", "oi-count", keys.map(k => (nm(items[k]) || k) + " ×" + S.basket[k]).join("، ")));
    const submit = el("button", "btn focusable", t("submit", "ارسال"));
    submit.onclick = async () => {
      const countAndIds = keys.map(k => k + ":" + S.basket[k]).join(",");
      try {
        await apiPost("/api/post", { ep: "add_food_order", payload: { countAndIds: countAndIds } });
        S.basket = {}; S.basketItems = {};
        toast(t("submit_success", "سفارش ثبت شد"));
        openOrders();
      } catch (e) { toast(t("submit_failed", "ثبت سفارش ناموفق بود")); }
    };
    head.appendChild(submit);
    box.appendChild(head);
  }
  // 2) history -> GetFoodOrder?mac=
  try {
    const r = await apiGet("food_order");
    const list = Array.isArray(r) ? r : ((r && r.list) || []);
    list.forEach(o => {
      const f = o.food || {};
      const d = el("div", "order-item focusable");
      d.appendChild(el("span", "oi-name", nm(f) || ("#" + (o.orderId || o.id))));
      d.appendChild(el("span", "oi-count", "×" + (o.count != null ? o.count : 1)));
      const st = el("span", "oi-status" + (o.status >= 3 ? " cancel" : ""), orderStatusText(o.status));
      d.appendChild(st);
      d.onclick = () => openOrderDetail(o);
      box.appendChild(d);
    });
    if (!list.length && !keys.length) box.appendChild(el("div", "order-item", t("no_orders", "سفارشی ثبت نشده است")));
  } catch (e) {}
  focusFirst("scr-orders");
}
function openOrderDetail(o) {
  const m = $("#order-detail"); m.hidden = false;
  const f = o.food || {};
  const items = $("#od-items"); items.innerHTML = "";
  const rows = (o.list && o.list.length) ? o.list : [Object.assign({ count: o.count }, f)];
  let total = 0;
  rows.forEach(x => {
    const c = Number(x.count) || 1, pr = Number(x.price) || 0;
    total += c * pr;
    const r = el("div", "oi");
    r.appendChild(el("span", null, (nm(x) || "") + " ×" + c));
    r.appendChild(el("span", null, pr ? String(pr) : ""));
    items.appendChild(r);
  });
  $("#od-total").textContent = String(total);
  $("#od-status").textContent = orderStatusText(o.status);
  const cancelBtn = $("#od-cancel");
  // Android refuses to cancel finished / already-cancelled / cancelling orders
  const blocked = o.status === 2 ? t("order_cannot_cancel_tips")
    : o.status === 4 ? t("order_canceled_tips")
    : o.status === 3 ? t("order_repeat_cancel_tips") : "";
  cancelBtn.disabled = !!blocked;
  cancelBtn.onclick = async () => {
    if (blocked) { toast(blocked); return; }
    const name = nm(f) || ("#" + (o.orderId || o.id));
    const ok = await askConfirm(t("cancel_the_order", "لغو سفارش"),
      t("cancel_order_dialog_title", "آیا مایل به لغو {0} هستید؟").replace("{0}", name));
    if (!ok) return;
    try {
      // AddFoodOrder (POST) cFlag=1 & id={orderId} & mac=
      await apiPost("/api/post", { ep: "add_food_order", payload: { cFlag: 1, id: o.orderId || o.id } });
      toast(t("submit_success", "درخواست لغو ثبت شد"));
      m.hidden = true; openOrders();
    } catch (e) { toast(t("submit_failed", "ناموفق")); }
  };
  $("#od-close").onclick = () => { m.hidden = true; focusFirst("scr-orders"); };
  setTimeout(() => { try { cancelBtn.disabled ? $("#od-close").focus() : cancelBtn.focus(); } catch (e) {} }, 40);
}

/* ----------------------------- SERVICE ----------------------------- */
/* v2.7.2.06: the room-service menu is built from GetServiceIcon and each id
   maps to a fixed action (StyleTwoRoomServiceFragment$1.onItemClick):
   1 housekeeping, 2 borrow things, 3 laundry, 4 wake-up, 5 bill,
   6 one-key checkout, 7 TAXI (new), 8 service record (new). */
const SVC_ICON = {
  1: "pic_style_three_housekeeper_service", 2: "pic_style_three_borrow_things_service",
  3: "pic_style_three_wash_clothes_service", 4: "pic_style_three_alarm_service",
  5: "pic_style_three_service_record", 6: "pic_style_three_one_key_checkout",
  7: "pic_style_three_taxi_service", 8: "pic_style_three_search_service",
};
const SVC_LABEL = {
  1: "butler_service", 2: "goods_service", 3: "clothes_service", 4: "wake_up_service",
  5: "main_menu_consume", 6: "checking_out", 7: "hotel_taxi__service", 8: "service_record",
};
const DEFAULT_SERVICES = [1, 2, 3, 4, 5, 6, 7, 8].map(id => ({ id: id }));

async function openService() {
  show("scr-service");
  const g = $("#svc-grid"); g.innerHTML = "";
  let list = [];
  try { const r = await apiGet("service_icon"); list = Array.isArray(r) ? r : ((r && r.list) || []); } catch (e) {}
  if (!list.length) list = DEFAULT_SERVICES;
  list.forEach(sv => {
    const id = sv.id != null ? sv.id : 0;
    const b = el("div", "svc-item focusable");
    const img = el("img");
    img.src = sv.image ? imgUrl(sv.image) : ("/assets/img/mipmap__" + (SVC_ICON[id] || "icon_service") + ".png");
    img.onerror = () => { img.remove(); const i = el("div", "ico", "🛎"); b.insertBefore(i, b.firstChild); };
    b.appendChild(img);
    b.appendChild(el("div", "cap", nm(sv) || t(SVC_LABEL[id] || "hotel_service", "خدمات")));
    b.onclick = () => svcAction(id, nm(sv) || t(SVC_LABEL[id] || "hotel_service", "خدمات"));
    g.appendChild(b);
  });
  focusFirst("scr-service");
}
async function svcAction(id, label) {
  switch (id) {
    case 1: {
      const txt = t("cleaning_ting_tops", "آیا به نظافت {0} نیاز دارید؟").replace("{0}", label || person);
      if (await askConfirm(t("service_main_page", "خدمات اتاق"), txt)) orderService(1, label);
      return;
    }
    case 2: return openRent(2, label);
    case 3: return openRent(3, label);
    case 4: return openWakeup(4, label);
    case 5: return openConsume();
    case 6: return checkoutNow();   // checkoutNow() shows the confirm dialog itself
    case 7: return openWakeup(7, label);           // v2: TAXI uses the wake-up time picker
    case 8: return openServiceRecord(label);        // v2: GetServiceOrder
    default: {
      if (await askConfirm(t("service_main_page", "خدمات اتاق"), label)) orderService(id, label);
    }
  }
}
async function orderService(typeId, label) {
  try {
    await apiPost("/api/post", { ep: "add_goods_order", type_id: typeId, wakeupTime: 0 });
    toast(t("submit_success", "درخواست ثبت شد") + (label ? ": " + label : ""));
  } catch (e) { toast(t("submit_failed", "ناموفق")); }
}
/* v2.7.2.06: RentThingsActivity uses GetGoods for serviceType 2 (borrow things)
   and the NEW GetClothingType for the laundry service. */
async function openRent(serviceType, title) {
  show("scr-rent");
  const isLaundry = serviceType !== 2;
  $("#rent-title").textContent = title || t(isLaundry ? "clothes_service" : "goods_service", "اقلام");
  try {
    const goods = (await apiGet(isLaundry ? "clothing_type" : "goods")) || [];
    const g = $("#rent-grid"); g.innerHTML = "";
    (Array.isArray(goods) ? goods : []).forEach(it => {
      const d = el("div", "food-item focusable");
      const img = el("img"); img.src = imgUrl(it.imagePath || it.icon || "");
      img.onerror = () => img.src = "/assets/img/mipmap__icon_service.png";
      d.appendChild(img);
      d.appendChild(el("div", "cap", nm(it) || ""));
      d.appendChild(el("div", "price", it.price != null ? String(it.price) : ""));
      d.onclick = async () => {
        const ok = await askConfirm(t("select_things_tip", "برای انتخاب موارد OK را بزنید"), nm(it) || "");
        if (!ok) return;
        try { await apiPost("/api/post", { ep: "add_goods_order", type_id: serviceType || it.typeId || it.id, wakeupTime: 0 }); toast(t("submit_success", "ثبت شد")); }
        catch (e) { toast(t("submit_failed", "ناموفق")); }
      };
      g.appendChild(d);
    });
    if (!(Array.isArray(goods) ? goods : []).length) toast(t("no_data", "اطلاعاتی موجود نیست"));
  } catch (e) { toast(t("loading_failed", "بارگیری ناموفق")); }
  focusFirst("scr-rent");
}
/* v2.7.2.06: WakeUpActivity serves both wake-up (typeId 4) and TAXI (typeId 7);
   only the title and the time label change. */
function openWakeup(typeId, title) {
  typeId = typeId || 4;
  show("scr-wakeup");
  const isTaxi = typeId !== 4;
  const h = $("#scr-wakeup .page-head h2");
  if (h) h.textContent = title || (isTaxi ? t("hotel_taxi__service", "تاکسی") : t("wake_up_service", "بیدارباش"));
  const lbl = $("#wk-label");
  if (lbl) lbl.textContent = isTaxi ? t("taxi_service_setting_time", "زمان استفاده از خودرو را تعیین کنید")
                                    : t("wake_up_setting_time", "تنظیم زمان بیداری:");
  const day = $("#wk-day"), hr = $("#wk-hour"), mn = $("#wk-min");
  if (!day.options.length) {
    for (let i = 0; i < 3; i++) day.add(new Option(t("wake_up_date_day", "روز") + " +" + i, i));
    for (let hh = 0; hh < 24; hh++) hr.add(new Option(String(hh).padStart(2, "0"), hh));
    for (let m = 0; m < 60; m += 5) mn.add(new Option(String(m).padStart(2, "0"), m));
  }
  // default to ~5 minutes from now (rounded up to the next 5-minute slot)
  const soon = new Date(serverNow().getTime() + 5 * 60000);
  hr.value = String(soon.getHours()).padStart(2, "0");
  mn.value = String(Math.ceil(soon.getMinutes() / 5) * 5 % 60).padStart(2, "0");
  day.value = (soon.getHours() < serverNow().getHours()) ? "1" : "0";
  $("#wk-submit").onclick = async () => {
    const when = Date.now() + (+day.value) * 86400000;
    const d = new Date(when); d.setHours(+hr.value, +mn.value, 0, 0);
    if (d.getTime() <= Date.now()) { toast(t("wake_up_notice", "زمان باید در آینده باشد")); return; }
    try {
      // AddGoodsOrder?mac=&typeId=&wakeupTime=
      await apiPost("/api/post", { ep: "add_goods_order", type_id: typeId, wakeupTime: d.getTime() });
      toast(t("submit_success", "ثبت شد"));
      back();
    } catch (e) { toast(t("submit_failed", "ناموفق")); }
  };
  focusFirst("scr-wakeup");
}
/* v2.7.2.06: StyleThreeServiceRecordActivity -> GetServiceOrder?mac= */
async function openServiceRecord(title) {
  show("scr-svcrecord");
  const h = $("#scr-svcrecord .page-head h2");
  if (h && title) h.textContent = title;
  const tb = $("#svcrec-body"); tb.innerHTML = "";
  try {
    const rows = await apiGet("service_order");
    const list = Array.isArray(rows) ? rows : ((rows && rows.list) || []);
    list.forEach(r => {
      const tr = el("tr");
      tr.appendChild(el("td", null, nm(r, "serviceName") || r.serviceName || r.serviceNameEn || ""));
      tr.appendChild(el("td", null, fmtTime(r.orderTime)));
      const goods = (r.list || []).map(x => (nm(x) || "") + (x.count > 1 ? " ×" + x.count : "")).filter(Boolean).join("، ");
      tr.appendChild(el("td", null, goods || nm(r, "gName") || r.gName || r.gNameEn || "—"));
      tr.appendChild(el("td", null, orderStatusText(r.status)));
      tb.appendChild(tr);
    });
    if (!list.length) tb.appendChild(el("tr")).appendChild(el("td", null, t("no_orders", "سفارشی ثبت نشده است")));
  } catch (e) { toast(t("loading_failed", "بارگیری ناموفق")); }
  focusFirst("scr-svcrecord");
}
function fmtTime(ms) {
  if (!ms) return "—";
  const d = new Date(Number(ms));
  if (isNaN(d.getTime())) return String(ms);
  return d.toLocaleDateString(S.lang === "fa" ? "fa-IR" : (S.lang === "zh" ? "zh-CN" : "en-GB")) + " " +
    String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
function orderStatusText(st) {
  const m = {
    0: t("order_status_new", "ثبت شده"),
    1: t("order_status_accepted", "تأیید شده"),
    2: t("order_status_finished", "تکمیل شده"),
    3: t("order_status_wait_cancel", "در انتظار لغو"),
    4: t("order_status_canceled", "لغو شده"),
  };
  return m[st] != null ? m[st] : String(st == null ? "" : st);
}

async function openConsume() {
  show("scr-consume");
  try {
    const f = await apiGet("folio", { pms_type: (S.settings && S.settings.pmsType) || 1 });
    const rows = (f && (f.items || f.list || f.BillDTO && f.BillDTO.items)) || [];
    const tb = $("#consume-body"); tb.innerHTML = "";
    let total = 0;
    (Array.isArray(rows) ? rows : []).forEach(r => {
      total += +(r.price || r.amount || 0);
      const tr = el("tr");
      ["time", "type", "content", "price"].forEach(k => tr.appendChild(el("td", null, r[k] != null ? String(r[k]) : (r.name || ""))));
      tb.appendChild(tr);
    });
    $("#consume-total").textContent = String(total);
  } catch (e) {}
}
/* AddClientCheckOutOrder?mac=  (v2: one-key checkout, service id 6) */
async function checkoutNow() {
  const ok = await askConfirm(t("checking_out", "تسویه حساب"),
    t("check_out_tip", "آیا مطمئن هستید؟"), t("ok", "تأیید"));
  if (!ok) return;
  try { await apiPost("/api/post", { ep: "add_checkout_order" }); toast(t("checkout_success", "تسویه انجام شد")); }
  catch (e) { toast(t("checking_out_failed", "ناموفق")); }
}
const checkout = checkoutNow;

/* ----------------------------- HOTEL ----------------------------- */
async function openHotel() {
  show("scr-hotel");
  try {
    const h = await apiGet("hotel");
    const wrap = $("#hotel-wrap"); wrap.innerHTML = "";
    const items = (h && (h.items || h.list)) || (Array.isArray(h) ? h : [h]);
    items.filter(Boolean).forEach(it => {
      const d = el("div", "hotel-item focusable");
      const img = el("img"); img.src = imgUrl(it.imagePath || it.icon || it.url || "");
      img.onerror = () => img.src = "/assets/img/mipmap__bg_welcome.png";
      d.appendChild(img);
      const cap = el("div", "cap");
      cap.innerHTML = "<b>" + (nm(it) || it.name || it.title || "") + "</b><br>" + (nm(it, "content") || it.content || it.description || "");
      d.appendChild(cap);
      wrap.appendChild(d);
    });
  } catch (e) {}
}

/* ----------------------------- MUSIC ----------------------------- */
async function openMusic() {
  show("scr-music");
  try {
    const cats = (await apiGet("music_category")) || [];
    const tr = $("#music-types"); tr.innerHTML = "";
    cats.forEach((c, i) => {
      const d = el("div", "type-item focusable" + (i === 0 ? " active" : ""));
      d.textContent = nm(c) || c.name || "";
      d.onclick = () => { $$("#music-types .type-item").forEach(x => x.classList.remove("active")); d.classList.add("active"); loadMusic(c.id); };
      tr.appendChild(d);
    });
    if (cats.length) loadMusic(cats[0].id);
  } catch (e) {}
}
async function loadMusic(albumId) {
  try {
    const list = (await apiGet("music_list", { albumId: albumId, language_type: 0 })) || [];
    const g = $("#music-grid"); g.innerHTML = "";
    (Array.isArray(list) ? list : []).forEach(m => {
      const d = el("div", "food-item focusable");
      const img = el("img"); img.src = imgUrl(m.imagePath || m.cover || "");
      img.onerror = () => img.src = "/assets/img/mipmap__pic_music_poster.png";
      d.appendChild(img); d.appendChild(el("div", "cap", nm(m) || m.name || m.videoName || ""));
      d.onclick = () => { const a = $("#audio"); a.src = "/proxy?url=" + enc(m.url || ""); a.play().catch(() => {}); toast("♪ " + (nm(m) || m.name || "")); };
      g.appendChild(d);
    });
  } catch (e) {}
}

/* ----------------------------- SETTINGS ----------------------------- */
/* `unlocked` is MainStyleThirdActivity.onKeyDown(): the code was already typed
   on the main screen, so the gate does not ask for it a second time. */
function openSettings(unlocked) {
  show("scr-settings");
  const gate = $("#set-gate"), body = $("#set-body");
  const need = !unlocked && S.config.settings.need_password !== false;
  gate.style.display = need ? "flex" : "none";
  body.hidden = need;
  if (!need) fillSettings();
  $("#gate-pass").value = "";
  $("#gate-ok").onclick = tryGate;
  $("#gate-cancel").onclick = () => back();
  $("#gate-pass").onkeydown = (e) => { if (e.key === "Enter") tryGate(); };
  if (need) {
    const hint = $("#gate-hint");
    if (hint) {
      const pass = String((S.config.settings || {}).password || "111999");
      hint.hidden = pass !== "111999";
    }
    setTimeout(() => $("#gate-pass").focus(), 50);
  }
}
function tryGate() {
  const v = $("#gate-pass").value;
  if (v === String(S.config.settings.password || "111999")) {
    $("#set-gate").style.display = "none"; $("#set-body").hidden = false; fillSettings();
    /* the password input must not keep focus once the gate is gone: while an
       INPUT is active the key handler treats every key as typing, so BACK
       would be swallowed (and the hidden input can never be left by D-pad). */
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
    focusFirst("scr-settings");
  } else { $("#gate-err").hidden = false; }
}
function fillSettings() {
  const c = S.config.settings;
  $("#set-room").textContent = c.iptv_room_number || "—";
  $("#set-ip").textContent = c.server_ip;
  $("#set-port").textContent = c.server_port;
  $("#set-localip").textContent = S.config.local_ip;
  $("#set-mac").textContent = S.config.mac;
  /* how the box reaches the head-end: the client is identified by the MAC of the
     wired adapter (IptvUtil.getMacAddress() reads eth0 before wlan0), which is
     what a cabled residential installation uses. */
  const net = S.config.network || {};
  const ll = $("#set-link-label");
  if (ll) ll.textContent = t("device_link", "اتصال دستگاه");
  const lv = $("#set-link-value");
  if (lv) {
    const kind = net.wired ? t("link_wired", "کابل شبکه (Ethernet)")
      : (net.kind === "wifi" ? t("link_wifi", "وای‌فای") : (net.kind || "—"));
    lv.textContent = kind + (net.iface ? " · " + net.iface : "") + (net.ip ? " · " + net.ip : "");
    lv.classList.toggle("ok", !!net.wired);
  }
  /* the head-end the live channels come from: address + RTSP port + the source in
     use, so one glance says whether the defaults are still the factory ones */
  const hv = $("#set-headend-value");
  if (hv) {
    const hl = $("#set-headend-label");
    if (hl) hl.textContent = t("head_end", "هداند");
    const sv = S.config.server || {};
    const m = S.m3u || {};
    hv.textContent = (sv.address || "-") + " · RTSP " + (c.rtsp_port || "554") + " · " +
      ((m.enabled && m.count) ? "m3u (" + m.count + ")" : "GetLiveTV");
  }
  /* live-playback readiness: the remuxer and the one-click pre-flight check */
  const fv = $("#set-ffmpeg-value");
  if (fv) {
    const fl = $("#set-ffmpeg-label");
    if (fl) fl.textContent = t("ffmpeg_status", "FFmpeg (کانال‌های RTSP/TS)");
    fv.textContent = S.config.ffmpeg ? "✓ " + t("ready", "آماده") : "✗ " + t("ffmpeg_missing", "یافت نشد");
    fv.classList.toggle("ok", !!S.config.ffmpeg);
    fv.classList.toggle("bad", !S.config.ffmpeg);
  }
  const dl = $("#set-diag-label");
  if (dl) dl.textContent = t("diag_live_check", "بررسی پخش زنده");
  fillConnectionRows();
  const mrow = $("#set-m3u");
  if (mrow) {
    mrow.querySelector(".set-label").textContent = t("m3u_source", "فهرست کانال‌ها (m3u)");
    const m = S.m3u || {};
    $("#set-m3u-value").textContent = (m.enabled && m.count)
      ? "● " + m.count + " " + t("channel_count", "کانال")
      : (m.enabled ? "● " + (m.error || "—") : "○ " + t("not_enabled", "غیرفعال"));
  }
  $("#set-lang").textContent = S.lang;
  $("#set-version").textContent = S.config.version +
    (S.config.build ? " (" + S.config.build + ")" : "") +
    (S.config.ffmpeg ? "" : "  (ffmpeg: —)");
  $$("#set-body .set-row[data-edit]").forEach(row => {
    row.onclick = () => editSetting(row.dataset.edit);
  });
  /* ---- v2.7.2.06 rows ---- */
  $("#set-vlc-value").textContent = S.vlc ? t("enable_vlc", "فعال") : t("not_enabled", "غیرفعال");
  $("#set-speed-value").textContent = S.speed + "x";
  $("#set-autostart-value").textContent = S.autostart ? t("enable_vlc", "فعال") : t("not_enabled", "غیرفعال");
  $("#set-apps-value").textContent = ((S.settings && S.settings.appShowInMenu) ? "● " : "○ ") +
    (S.appsSelected.length ? S.appsSelected.join("، ") : t("not_enabled", "غیرفعال"));
  $("#set-vlc").onclick = async () => {
    S.vlc = !S.vlc;
    await apiPost("/api/settings", { use_vlc_paly_live_prg: S.vlc });
    S.config = await cfg();
    if (S.vlc && !S.config.vlc_installed) toast(t("vlc_player_install_tips", "پخش‌کننده VLC شناسایی نشد. لطفاً ابتدا آن را نصب کنید!"));
    fillSettings();
  };
  $("#set-speed").onclick = () => {
    const i = S.speeds.indexOf(S.speed);
    S.speed = S.speeds[(i + 1) % S.speeds.length];
    apiPost("/api/settings", { play_speed: S.speed }).catch(() => {});
    applySpeed(); fillSettings();
  };
  $("#set-autostart").onclick = async () => {
    const r = await apiPost("/api/autostart", { enabled: !S.autostart });
    S.autostart = !!(r && r.enabled);
    fillSettings();
    toast(S.autostart ? t("boot_auto_start", "شروع خودکار با ویندوز") + ": " + t("enable_vlc", "فعال")
                      : t("boot_auto_start", "شروع خودکار با ویندوز") + ": " + t("not_enabled", "غیرفعال"));
  };
  $("#set-apps").onclick = () => openApps();
  if ($("#set-m3u")) $("#set-m3u").onclick = () => openM3u();
  if ($("#set-diag")) $("#set-diag").onclick = () => runDiagnose();
  const upRow = $("#set-update");
  if (upRow) upRow.onclick = () => runUpdate();
  /* the handshake again from the top: BaseApplication.onCreate() + the
     PingServerActivity timer, without reloading the screen */
  $("#set-reconnect").onclick = async () => {
    try { await fetch("/api/network"); } catch (e) {}
    const r = await apiPost("/api/connection/retry", {});
    if (r && r.connection) applyConnection(r.connection);
    fillConnectionRows();
    toast(t("settings_network", "تنظیمات شبکه") + " ↻");
  };
  /* the sweep is the Windows-port aid for a head-end that does not announce
     itself on UDP 27777: it walks the local subnet looking for GetSettings. */
  const sw = $("#set-sweep");
  if (sw) sw.onclick = async () => {
    const v = $("#set-sweep-value");
    if (v) v.textContent = "…";
    const r = await apiPost("/api/connection/sweep", {});
    if (r && r.connection) applyConnection(r.connection);
    setTimeout(fillConnectionRows, 2500);
    fillConnectionRows();
  };
  $("#set-lang").parentElement.onclick = () => {
    const order = ["fa", "en", "zh"];
    S.lang = order[(order.indexOf(S.lang) + 1) % order.length];
    apiPost("/api/settings", { app_language: S.lang }); applyI18n(); fillSettings();
  };
}
/* The three connection rows: exactly the facts the APK's own handshake holds -
   BaseApplication.isConnected(), the address in use, the UDP 27777 listener and
   the sweep that stands in for an announce on a Windows machine. */
async function fillConnectionRows() {
  await refreshConnection();
  const c = S.conn;
  if (!c) return;
  const cv = $("#set-conn-value");
  if (cv) {
    const srv = c.server || {};
    /* "متصل" is a port string: the APK has no "connected" label because its boot
       screen simply moves on when the handshake answers. */
    cv.textContent = (c.connected ? "● " + (S.lang === "en" ? "Connected" : "متصل")
                                  : "○ " + t("status_disconnected", "سرور قطع شد!"))
      + " · " + (srv.address || "-")
      + (c.unit ? " · " + (S.mode === "hotel" ? t("room", "اتاق") : t("unit_number", "شمارهٔ واحد")) + " " + c.unit : "")
      + " · " + (c.settings_ok ? "GetSettings ✓" : "GetSettings ✗");
    cv.classList.toggle("ok", !!c.connected);
    cv.classList.toggle("bad", !c.connected);
  }
  const dv = $("#set-disc-value");
  if (dv) {
    const d = c.discovery || {};
    dv.textContent = d.bound
      ? ("● UDP " + (d.port || 27777) + " · " + (d.packets || 0) + (S.lang === "en" ? " packet(s)" : " بسته"))
      : ("○ " + (d.error || "-"));
    dv.classList.toggle("ok", !!d.bound);
    dv.classList.toggle("bad", !d.bound);
  }
  const sv = $("#set-sweep-value");
  if (sv) {
    const w = c.sweep || {};
    sv.textContent = w.found ? ("● " + w.found) : (w.running ? "…" : (w.tried ? String(w.tried) : "⟳"));
    sv.classList.toggle("ok", !!w.found);
  }
}

function editSetting(key) {
  const m = $("#input-modal"); m.hidden = false;
  const h = $("#input-hint"); if (h) { h.hidden = true; h.textContent = ""; }
  const dl = $("#diag-list"); if (dl) dl.remove();
  const df = $("#input-field"); if (df) df.type = "text";
  const titles = { server_ip: t("settings_network_ip"), server_port: t("settings_network_port"),
                   iptv_room_number: S.mode === "hotel" ? t("room_number") : t("unit_number", "شمارهٔ واحد") };
  $("#input-title").textContent = titles[key] || key;
  const f = $("#input-field"); f.value = String(S.config.settings[key] || ""); f.focus();
  $("#input-ok").onclick = async () => {
    const v = f.value.trim(); if (!v) return;
    const payload = {}; payload[key] = (key === "server_port") ? parseInt(v, 10) : v;
    await apiPost("/api/settings", payload);
    m.hidden = true; S.config = await cfg(); fillSettings();
    toast(t("submit_success", "ذخیره شد"));
  };
  $("#input-cancel").onclick = () => { m.hidden = true; focusFirst("scr-settings"); };
}

/* ------------- v2.7.2.06: SettingAppShowActivity (app.db) ------------- */
async function openApps() {
  show("scr-apps");
  const g = $("#app-grid"); g.innerHTML = "";
  try {
    const r = await fetch("/api/apps"); const d = await r.json();
    S.apps = d.installed || [];
    S.appsSelected = d.selected || [];
    S.apps.forEach(a => {
      const on = S.appsSelected.indexOf(a.name) >= 0;
      const d2 = el("div", "app-item focusable" + (on ? " on" : ""));
      d2.appendChild(el("span", "bx", on ? "✓" : ""));
      d2.appendChild(el("span", "nm", a.name));
      d2.onclick = async () => {
        const res = await apiPost("/api/apps", { toggle: a.name });
        S.appsSelected = (res && res.selected) || [];
        d2.classList.toggle("on", S.appsSelected.indexOf(a.name) >= 0);
        d2.querySelector(".bx").textContent = S.appsSelected.indexOf(a.name) >= 0 ? "✓" : "";
        S.config = await cfg();
      };
      g.appendChild(d2);
    });
    if (!S.apps.length) g.appendChild(el("div", "app-item", t("apps_none_found", "برنامه‌ای یافت نشد")));
  } catch (e) { toast(t("loading_failed", "بارگیری ناموفق")); }
  $("#app-add").onclick = async () => {
    const name = $("#app-name").value.trim(), path = $("#app-path").value.trim();
    if (!name || !path) { toast(t("input_error", "نام و مسیر را وارد کنید")); return; }
    const r = await apiPost("/api/apps", { add: { name: name, path: path } });
    if (r && r.ok) { $("#app-name").value = ""; $("#app-path").value = ""; toast(t("submit_success", "افزوده شد")); openApps(); }
    else toast(t("submit_failed", "ناموفق"));
  };
  $("#app-back").onclick = () => { openSettings(); };
  focusFirst("scr-apps");
}

/* ----------------------------- enter-screen hook ----------------------------- */
function onEnter(id) {
  /* The menu is whatever GetHomepageIcon publishes (or addDefaultMenu()), so no
     screen is locked by the deployment flavour: a residential head-end that
     lists the service or introduction tiles gets exactly those screens. */
  if (id !== "scr-player") {
    clearInterval(S._epgT); stopLoadAnim();
    if (S.ad) { clearInterval(S.adTimer); S.ad = null; const ac = $("#ad-countdown"); if (ac) ac.hidden = true; }
    reportLiveWatch(null);
    const ep = $("#epg-panel"), ed = $("#epg-detail");
    if (ep) ep.hidden = true;
    if (ed) ed.hidden = true;
  }
  if (id !== "scr-welcome") stopWelcomeAdv();     // welcome activity finished
  if (id !== "scr-bootvideo") stopBootVideo();
  /* onPause() -> switchToPlayBg(0): whatever plays behind the menu stops when
     another activity covers it. onResume() -> switchToPlayBg(1) +
     right_show_action(): coming back re-reads the handshake, rebuilds the menu
     (the apps chosen in Settings may have changed) and restarts the background. */
  if (id !== "scr-home") stopMainBackground();
  if (id === "scr-home" && S.mainEntered) {
    cfg().then(c => {
      S.config = c;
      S.appsSelected = c.apps_selected || [];
      S.loacalThirdApkBeans = (S.appsSelected || []).map(n => ({ name: n, packageName: n }));
      return refreshConnection();
    }).then(() => {
      if (S.cur !== "scr-home") return;
      initMainView(Number((S.settings || {}).layout || 0));
      isShowWifi(); initMainWeather(); getMainPageMenu(); initMainBackground();
      const scr = $("#scr-home");
      if (scr) scr.classList.add("menu-in");
    }).catch(() => {});
  }
}

window.addEventListener("load", boot);
})();
