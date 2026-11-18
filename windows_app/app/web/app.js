/* PARDIK SMART IPTV — Windows 10 client (mirrors com.dexin.wanchuan.iptv3) */
(function () {
"use strict";

/* ----------------------------- helpers ----------------------------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const enc = (u) => encodeURIComponent(u);

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
  vlc: false,
  autostart: false,
  loadAnim: null,
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
}

/* ----------------------------- API ----------------------------- */
async function cfg() {
  const r = await fetch("/api/config"); return r.json();
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
  return $$(".focusable, button, input, select, .menu-item, .pkg-item, .poster, .type-item, .svc-item, .food-item, .side-item, .rec-item, .set-row[data-edit], .set-row[data-act], .hotel-item, .scen-item, .epg-item, .order-item, .country-item, .app-item", scr)
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

/* ----------------------------- clock ----------------------------- */
function startClock() {
  const fmt = () => {
    const d = serverNow();
    const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
    const ds = d.toLocaleDateString(S.lang === "fa" ? "fa-IR" : (S.lang === "zh" ? "zh-CN" : "en-GB"),
      { weekday: "short", year: "numeric", month: "short", day: "numeric" });
    ["#wel-time", "#home-time"].forEach(s => { const n = $(s); if (n) n.textContent = hh + ":" + mm; });
    ["#wel-date", "#home-date"].forEach(s => { const n = $(s); if (n) n.textContent = ds; });
  };
  clearInterval(S.clockTimer); S.clockTimer = setInterval(fmt, 1000); fmt();
}
let timeOffset = 0;
function serverNow() { return new Date(Date.now() + timeOffset); }

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
  applyI18n();
  const bar = $("#boot-progress"); const msg = $("#boot-msg");
  let tries = 0;
  while (tries < 6) {
    tries++;
    bar.style.width = Math.min(tries * 16, 92) + "%";
    msg.textContent = t("connecting_server_tips") + "  (" + S.config.server.address + ")";
    try {
      S.settings = await apiGet("settings");
      break;
    } catch (e) {
      msg.textContent = t("status_disconnected", "اتصال سرور برقرار نیست!") + " — " + e.message;
      await new Promise(r => setTimeout(r, 1500));
      S.config = await cfg();
    }
  }
  bar.style.width = "100%";
  apiPost("/api/ws/start", {});
  if (!S.settings) {
    // offline: still allow local settings + UI
    S.settings = {};
  }
  // server time
  try { const tm = await apiGet("time"); if (tm && tm.timeMills) timeOffset = tm.timeMills - Date.now(); } catch (e) {}
  startClock();
  heartbeat();
  /* PingServerActivity.openWelcomeActivity(settings.isAdvVideoEM(), layout):
     advVideoEM -> BootVideoActivity (full-screen advert) -> welcome screen. */
  if (S.settings && S.settings.advVideoEM) enterBootVideo();
  else if (S.settings && S.settings.skipWelcomePage) enterHome();
  else enterWelcome();
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
  if (S.settings && S.settings.skipWelcomePage) enterHome();
  else enterWelcome();
}

async function heartbeat() {
  setInterval(async () => {
    try { await apiGet("room_info"); } catch (e) {}
    try { await apiPost("/api/post", { ep: "update_client", playing: S.playerCtx ? (S.playerCtx.name || "") : "" }); } catch (e) {}
  }, 60000);
}

/* ----------------------------- welcome ----------------------------- */
function enterWelcome() {
  show("scr-welcome", false);
  const c = S.client || {};
  const name = (S.lang === "en" ? c.welcomeWordEn : c.welcomeWord) || "";
  if (name) $("#wel-name").textContent = t("welcome_word_guest_name", "جناب آقای/سرکار خانم {0}").replace("{0}", name);
  $("#wel-hotel").textContent = (S.settings && (S.lang === "en" ? S.settings.hotelNameEn : S.settings.hotelName)) || "";
  loadWeather("#wel-weather", "#wel-weather-img", "#wel-weather-temp", "#wel-weather-txt");
  loadWelcomeAdv();
  $$("#wel-langs .langbtn").forEach(b => {
    b.onclick = () => { S.lang = b.dataset.lang; apiPost("/api/settings", { app_language: S.lang }); applyI18n(); enterHome(); };
  });
  // any key skips after 800ms (mirrors "press any key to skip")
  setTimeout(() => {
    const skip = (e) => { if (S.cur !== "scr-welcome") return; enterHome(); window.removeEventListener("keydown", skip); };
    window.addEventListener("keydown", skip);
  }, 800);
}

/* ------------- v2.7.2.06: welcome screen advertising -------------
   WelcomeStyleZero/OtherActivity.initData():
     settings.advVideoEM ? playPptBGImage()            -> GetAdvImage?type=1, 5 s a page
                         : getWelcomeVideo()           -> GetAdvVideoEM as background
   plus getManagerSignImg() (GetAdvImage?type=12) and getBgMusic()
   (apk/getClientBackgroundMusics -> res/adv/music/<url>, random, looped). */
async function loadWelcomeAdv() {
  stopWelcomeAdv();
  loadManagerSign();
  loadBgMusic();
  S.isPlayVideo = false;
  if (!(S.settings && S.settings.advVideoEM)) {
    try { S.welVideos = sanitiseAdvPaths(await apiGet("adv_video_em")); } catch (e) { S.welVideos = []; }
    S.isPlayVideo = S.welVideos.length > 0;
  }
  if (S.cur !== "scr-welcome") return;
  if (S.isPlayVideo) playWelcomeVideo(0);
  else playWelcomePpt();
}
function playWelcomeVideo(i) {
  const video = $("#wel-video"), ppt = $("#wel-ppt");
  if (!video || !S.welVideos.length || S.cur !== "scr-welcome") return;
  const idx = ((i % S.welVideos.length) + S.welVideos.length) % S.welVideos.length;
  if (ppt) ppt.hidden = true;
  video.hidden = false;
  // onCompletion -> another random clip; onError -> fall back to the slideshow
  video.onended = () => { if (S.cur === "scr-welcome") playWelcomeVideo(Math.floor(Math.random() * S.welVideos.length)); };
  video.onerror = () => { S.isPlayVideo = false; if (S.cur === "scr-welcome") playWelcomePpt(); };
  video.src = mediaSrc(iptvUrl(S.welVideos[idx]));
  tryPlay(video);
}
async function playWelcomePpt() {
  const video = $("#wel-video"), ppt = $("#wel-ppt");
  if (video) {
    video.onended = null; video.onerror = null; video.hidden = true;
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) {}
  }
  if (!ppt) return;
  let list = [];
  try {
    const r = await apiGet("adv_image", { type: 1 });
    list = (Array.isArray(r) ? r : ((r && r.list) || [])).filter(x => x);
  } catch (e) { list = []; }
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
  // MZBannerView: a single page is not rotated (setAutoPlay(size != 1))
  if (list.length > 1) S.pptTimer = setInterval(paint, 5000);
}
async function loadManagerSign() {
  const img = $("#wel-sign");
  if (!img) return;
  img.hidden = true;
  try {
    const r = await apiGet("adv_image", { type: 12 });
    const list = (Array.isArray(r) ? r : ((r && r.list) || [])).filter(x => x);
    if (!list.length || S.cur !== "scr-welcome") return;
    img.src = imgUrl(list[Math.floor(Math.random() * list.length)]);
    img.hidden = false;
  } catch (e) { /* signature optional */ }
}
async function loadBgMusic() {
  let list = [];
  try {
    const r = await apiGet("bg_musics");
    list = (Array.isArray(r) ? r : ((r && r.list) || [])).filter(x => x && x.url);
  } catch (e) { return; }
  if (!list.length || S.cur !== "scr-welcome") return;
  let el = S.bgMusic;
  if (!el) {
    el = document.createElement("audio");
    el.id = "bg-music";
    document.body.appendChild(el);
    S.bgMusic = el;
  }
  el.onended = () => { if (S.bgMusic && S.cur === "scr-welcome") next(); };   // loop another random track
  const next = () => {
    const b = list[Math.floor(Math.random() * list.length)];
    el.src = mediaSrc(iptvUrl("res/adv/music/" + enc(b.url)));
    tryPlay(el);
  };
  next();
}
function stopWelcomeAdv() {
  clearInterval(S.pptTimer); S.pptTimer = null;
  const video = $("#wel-video"), ppt = $("#wel-ppt");
  if (video) {
    video.onended = null; video.onerror = null; video.hidden = true;
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) {}
  }
  if (ppt) ppt.hidden = true;
  stopBgMusic();
}
function stopBgMusic() {
  const el = S.bgMusic;
  if (!el) return;
  el.onended = null;
  try { el.pause(); el.removeAttribute("src"); el.load(); } catch (e) {}
}

async function loadWeather(boxSel, imgSel, tempSel, txtSel) {
  try {
    const w = await apiGet("weather_days");
    const d = w && (w.data || w.result || w);
    if (!d) return;
    const box = $(boxSel); box.hidden = false;
    const cur = d.now || d.current || (d.forecast && d.forecast[0]) || {};
    $(tempSel).textContent = (cur.temp || cur.temperature || "") + "°";
    $(txtSel).textContent = cur.text || cur.weather || "";
  } catch (e) { /* weather optional */ }
}

/* ----------------------------- home / menu ----------------------------- */
function enterHome() {
  show("scr-home", false);
  S.stack = [];
  const st = S.settings || {};
  $("#home-room").textContent = (S.config.settings.iptv_room_number || (S.client && S.client.name) || "");
  if (S.client && S.client.wifiName) {
    $("#home-wifi").hidden = false;
    $("#home-wifi-name").textContent = t("wifi_name", "Wifi: {0}").replace("{0}", S.client.wifiName);
    $("#home-wifi-pass").textContent = t("wifi_passwd", "Password: {0}").replace("{0}", S.client.wifiPassword || "");
  }
  loadWeather("#home-weather", "#home-weather-img", "#home-weather-txt", "#home-weather-txt");
  buildMenu(st);
}
function buildMenu(st) {
  const nav = $("#home-menu"); nav.innerHTML = "";
  const items = [
    { id: "live",    label: t("live", "پخش زنده"),        icon: "icon_live_large",    act: () => openLive() },
    { id: "vod",     label: t("vod", "ویدئو"),            icon: "icon_vod_large",     act: () => openVod(),      show: st.menuVodVisible !== false },
    { id: "rec",     label: t("main_menu_rec", "بازپخش"), icon: "icon_rec_large",     act: () => openRec(),      show: !!st.menuRecVisible },
    { id: "scenery", label: t("scenery", "مناظر"),        icon: "icon_scenery_large", act: () => openScenery(),  show: st.menuSceneryVisible !== false },
    { id: "dinner",  label: t("dinner", "غذا"),           icon: "icon_dinner_large",  act: () => openDinner(),   show: st.menuCaterVisible !== false },
    { id: "service", label: t("hotel_service", "خدمات"), icon: "icon_service_large", act: () => openService(),  show: st.menuRoomServiceVisible !== false },
    { id: "music",   label: "موسیقی",                     icon: "icon_music_large",   act: () => openMusic(),    show: true },
    { id: "hotel",   label: t("hotel", "هتل"),            icon: "icon_hotel_large",   act: () => openHotel(),    show: st.menuHotelVisible !== false },
    { id: "consume", label: t("main_menu_consume", "صورتحساب"), icon: "icon_money",   act: () => openConsume(),  show: st.menuConsumeVisible !== false },
    { id: "settings",label: t("settings_system", "تنظیمات"), icon: "icon_settings_large", act: () => openSettings(), show: st.menuSystemVisible !== false },
  ].filter(i => i.show !== false);
  /* v2.7.2.06: when the server sets appShowInMenu, MainStyleFourthActivity
     drops the single "third app" tile and adds one tile per chosen local app
     (addLocalThirdAppInMenu). The Windows port does the same with the apps
     selected in Settings -> "APP show in menu". */
  if (st.appShowInMenu && S.appsSelected && S.appsSelected.length) {
    S.appsSelected.forEach(name => items.push({
      id: "app:" + name, label: name, icon: "icon_third_app_large",
      isApp: true, appName: name, act: () => launchApp(name),
    }));
  }
  // overlay server-provided icons/labels where present
  apiGet("homepage_icon").then(list => {
    if (Array.isArray(list)) {
      S.serverIcons = list;
      list.forEach(si => {
        const m = items.find(i => matchIconKey(i.id, si));
        if (m) { m.serverIcon = si.icon || si.icon1; m.serverLabel = labelFor(si); }
      });
      renderMenu(items);
    }
  }).catch(() => renderMenu(items));
  renderMenu(items);
}
function matchIconKey(id, si) {
  const k = ((si.packageName || "") + " " + (si.englishName || "") + " " + (si.chineseName || "")).toLowerCase();
  return k.indexOf(id) >= 0 || (id === "live" && /live|tv/.test(k)) || (id === "vod" && /vod|movie/.test(k)) ||
    (id === "rec" && /rec|playback/.test(k)) || (id === "scenery" && /scen/.test(k)) || (id === "dinner" && /cater|food|dinner/.test(k)) ||
    (id === "service" && /service|room/.test(k)) || (id === "hotel" && /hotel/.test(k)) || (id === "consume" && /consume|bill/.test(k));
}
function labelFor(si) {
  if (S.lang === "en") return si.englishName || si.chineseName;
  if (S.lang === "zh") return si.chineseName || si.englishName;
  return si.englishName || si.chineseName;
}
function renderMenu(items) {
  const nav = $("#home-menu"); nav.innerHTML = "";
  items.forEach(i => {
    const b = el("button", "menu-item focusable");
    const img = el("img"); img.src = i.serverIcon ? imgUrl(i.serverIcon) : ("/assets/img/mipmap__" + i.icon + ".png");
    img.onerror = () => { img.src = "/assets/img/mipmap__" + i.icon + ".png"; };
    b.appendChild(img);
    b.appendChild(el("span", null, i.label));
    b.onclick = i.act;
    nav.appendChild(b);
  });
  focusFirst("scr-home");
}

/* ----------------------------- LIVE ----------------------------- */
async function openLive() {
  const st = S.settings || {};
  try {
    if (st.showPackage) {
      S.packages = (await apiGet("live_packages")) || [];
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
  S.channels = (await apiGet("live_tv", { packageId: packageId })) || [];
  S.channels.forEach(c => { if (S.favourites.indexOf(c.id) >= 0) c._fav = true; });
}
function pickSource(item) {
  const proto = ((S.settings && S.settings.protocol) || "rtsp").toLowerCase();
  const rtsp = item.rtspUrl || "", hls = item.hlsUrl || "", http = item.httpUrl || "", url = item.url || "";
  if (proto === "hls" && hls) return [hls, "hls"];
  if (proto === "http" && http) return [http, "http"];
  if (proto === "udp" && url.indexOf("udp") === 0) return [url, "udp"];
  if (proto === "rtsp" && rtsp) return [rtsp, "rtsp"];
  const cands = [[hls, "hls"], [http, "http"], [url, "auto"], [rtsp, "rtsp"]];
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
function playItem(item, opts) {
  S.playerCtx.item = item;
  const video = $("#video");
  stopVideo(false);
  $("#player-loading").style.display = "flex";
  startLoadAnim();
  $("#player-error").hidden = true;
  const [src, proto] = pickSource(item);
  /* v2.7.2.06: use_vlc_paly_live_prg hands live playback to the external
     player (LivePlayerActivity.playWithVlc). If VLC is missing the Android app
     toasts vlc_player_install_tips and keeps playing internally. */
  if (S.playerCtx.kind === "live" && S.vlc && src) {
    apiPost("/api/external_player", { url: src, title: item.name || "" }).then(r => {
      if (r && r.ok) { toast(t("external_player_on", "پخش به پخش‌کنندهٔ خارجی سپرده شد") + " (VLC)"); }
      else { toast(t("vlc_player_install_tips", "پخش‌کننده VLC شناسایی نشد. لطفاً ابتدا آن را نصب کنید!")); }
    }).catch(() => {});
  }
  const kind = classify(src);
  let playUrl;
  if (kind === "hls") playUrl = "/proxy?url=" + enc(src);
  else if (kind === "rtsp" || kind === "udp" || kind === "mpegts") playUrl = "/stream/play?src=" + enc(src) + "&proto=" + enc(proto);
  else playUrl = "/stream/play?src=" + enc(src);
  const useHls = (kind === "hls" || kind === "rtsp" || kind === "udp" || kind === "mpegts") && window.Hls && Hls.isSupported();
  try {
    if (useHls) {
      S.hls = new Hls({ manifestLoadingTimeOut: 12000, manifestLoadingMaxRetry: 2, levelLoadingTimeOut: 12000, fragLoadingTimeOut: 20000 });
      S.hls.loadSource(playUrl);
      S.hls.attachMedia(video);
      S.hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      S.hls.on(Hls.Events.ERROR, (e, d) => {
        if (d.fatal) { $("#player-loading").style.display = "none"; stopLoadAnim(); $("#player-error").hidden = false; }
      });
    } else {
      video.src = playUrl;
      video.play().catch(() => {});
    }
  } catch (e) {
    $("#player-error").hidden = false;
  }
  video.onplaying = () => { $("#player-loading").style.display = "none"; stopLoadAnim(); $("#player-error").hidden = true; applySpeed(); };
  video.onwaiting = () => { $("#player-loading").style.display = "flex"; startLoadAnim(); };
  video.onerror = () => { $("#player-loading").style.display = "none"; stopLoadAnim(); $("#player-error").hidden = false; };
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
}
function stopVideo(hideScreen) {
  const video = $("#video");
  try { if (S.hls) { S.hls.destroy(); S.hls = null; } } catch (e) {}
  try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) {}
  if (hideScreen !== false) { /* caller switches screen */ }
}
function pollEpg(item) {
  clearInterval(S._epgT);
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
  if (w && (!nextItem || nextItem.id !== w.id)) {
    apiPost("/api/post", { ep: "add_adv_history", id: w.id, type: 1, time: Date.now() - w.startedAt, check: 1 }).catch(() => {});
  }
  S.liveWatch = (S.playerCtx && S.playerCtx.kind === "live" && nextItem)
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
function openSettings() {
  show("scr-settings");
  const gate = $("#set-gate"), body = $("#set-body");
  const need = S.config.settings.need_password !== false;
  gate.style.display = need ? "flex" : "none";
  body.hidden = need;
  if (!need) fillSettings();
  $("#gate-pass").value = "";
  $("#gate-ok").onclick = tryGate;
  $("#gate-cancel").onclick = () => back();
  $("#gate-pass").onkeydown = (e) => { if (e.key === "Enter") tryGate(); };
  if (need) setTimeout(() => $("#gate-pass").focus(), 50);
}
function tryGate() {
  const v = $("#gate-pass").value;
  if (v === String(S.config.settings.password || "111999")) {
    $("#set-gate").style.display = "none"; $("#set-body").hidden = false; fillSettings(); focusFirst("scr-settings");
  } else { $("#gate-err").hidden = false; }
}
function fillSettings() {
  const c = S.config.settings;
  $("#set-room").textContent = c.iptv_room_number || "—";
  $("#set-ip").textContent = c.server_ip;
  $("#set-port").textContent = c.server_port;
  $("#set-localip").textContent = S.config.local_ip;
  $("#set-mac").textContent = S.config.mac;
  $("#set-lang").textContent = S.lang;
  $("#set-version").textContent = S.config.version + (S.config.ffmpeg ? "" : "  (ffmpeg: —)");
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
  $("#set-reconnect").onclick = () => location.reload();
  $("#set-lang").parentElement.onclick = () => {
    const order = ["fa", "en", "zh"];
    S.lang = order[(order.indexOf(S.lang) + 1) % order.length];
    apiPost("/api/settings", { app_language: S.lang }); applyI18n(); fillSettings();
  };
}
function editSetting(key) {
  const m = $("#input-modal"); m.hidden = false;
  const titles = { server_ip: t("settings_network_ip"), server_port: t("settings_network_port"), iptv_room_number: t("room_number") };
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
  if (id === "scr-home") {
    // keep the menu in sync with the apps chosen in Settings
    cfg().then(c => { S.config = c; S.appsSelected = c.apps_selected || []; buildMenu(S.settings || {}); }).catch(() => {});
  }
}

window.addEventListener("load", boot);
})();
