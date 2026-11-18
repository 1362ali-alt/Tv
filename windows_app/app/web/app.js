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

/* ----------------------------- toast ----------------------------- */
let toastTimer = null;
function toast(msg) {
  const n = $("#toast"); n.textContent = msg; n.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => n.hidden = true, 2600);
}

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
  if ($("#vod-detail").hidden === false) { $("#vod-detail").hidden = true; focusFirst(S.cur); return; }
  if ($("#input-modal").hidden === false) { $("#input-modal").hidden = true; focusFirst(S.cur); return; }
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
  return $$(".focusable, button, input, select, .menu-item, .pkg-item, .poster, .type-item, .svc-item, .food-item, .side-item, .rec-item, .set-row[data-edit], .hotel-item, .scen-item", scr)
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
  if (e.key === "Escape" || e.key === "Backspace") { if (!typing) { e.preventDefault(); back(); } return; }
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
  $$("#wel-langs .langbtn").forEach(b => {
    b.onclick = () => { S.lang = b.dataset.lang; apiPost("/api/settings", { app_language: S.lang }); applyI18n(); enterHome(); };
  });
  // any key skips after 800ms (mirrors "press any key to skip")
  setTimeout(() => {
    const skip = (e) => { if (S.cur !== "scr-welcome") return; enterHome(); window.removeEventListener("keydown", skip); };
    window.addEventListener("keydown", skip);
  }, 800);
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
    d.appendChild(el("span", null, p.name || ""));
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
function playItem(item) {
  S.playerCtx.item = item;
  const video = $("#video");
  stopVideo(false);
  $("#player-loading").style.display = "flex";
  $("#player-error").hidden = true;
  const [src, proto] = pickSource(item);
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
        if (d.fatal) { $("#player-loading").style.display = "none"; $("#player-error").hidden = false; }
      });
    } else {
      video.src = playUrl;
      video.play().catch(() => {});
    }
  } catch (e) {
    $("#player-error").hidden = false;
  }
  video.onplaying = () => { $("#player-loading").style.display = "none"; $("#player-error").hidden = true; };
  video.onwaiting = () => { $("#player-loading").style.display = "flex"; };
  video.onerror = () => { $("#player-loading").style.display = "none"; $("#player-error").hidden = false; };
  // overlays
  const badge = $("#ch-badge");
  if (S.playerCtx.kind === "live") {
    badge.hidden = false;
    $("#ch-number").textContent = item.number != null ? item.number : "";
    $("#ch-name").textContent = item.name || "";
    apiPost("/api/settings", { last_channel: item.id });
    clearTimeout(S._badgeT); S._badgeT = setTimeout(() => badge.hidden = true, 4000);
    pollEpg(item);
  } else {
    badge.hidden = true;
    $("#osd-title").textContent = item.videoName || item.name || "";
  }
  // watermark
  const wm = $("#watermark");
  wm.onerror = () => { wm.hidden = true; };
  if (S.settings && S.settings.showWaterMark) { wm.hidden = false; wm.src = imgUrl("res/watermark.png"); }
  else wm.hidden = true;
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
function armOsd() {
  const osd = $("#player-osd");
  const kick = () => { osd.hidden = false; clearTimeout(S.idleTimer); S.idleTimer = setTimeout(() => { osd.hidden = true; }, 4000); };
  window.onmousemove = kick; kick();
  $("#btn-fav").onclick = toggleFav;
  $("#btn-list").onclick = toggleSideList;
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
      d.appendChild(el("span", null, c.name || c.videoName || ""));
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
      d.textContent = ty.name || "";
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
      p.appendChild(el("div", "cap", v.videoName || ""));
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
async function openRec() {
  show("scr-rec");
  try {
    const chs = (await apiGet("live_tv", { packageId: -1 })) || [];
    const c1 = $("#rec-channels"); c1.innerHTML = "";
    chs.slice(0, 60).forEach(c => {
      const d = el("div", "rec-item focusable"); d.textContent = (c.number != null ? c.number + "  " : "") + (c.name || "");
      d.onclick = async () => {
        const progs = (await apiGet("epg_rec_program", { liveId: c.id })) || [];
        const c3 = $("#rec-progs"); c3.innerHTML = "";
        (Array.isArray(progs) ? progs : []).forEach(p => {
          const dd = el("div", "rec-item focusable"); dd.textContent = (p.name || "") + (p.url ? "" : "");
          dd.onclick = () => startPlayer("vod", { videoName: p.name, url: p.url, rtspUrl: p.rtspUrl, hlsUrl: p.hlsUrl, httpUrl: p.httpUrl });
          c3.appendChild(dd);
        });
      };
      c1.appendChild(d);
    });
  } catch (e) {}
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
      d.appendChild(img); d.appendChild(el("div", "cap", it.name || it.title || ""));
      g.appendChild(d);
    });
  } catch (e) {}
}

/* ----------------------------- DINNER / CATERING ----------------------------- */
async function openDinner() {
  show("scr-dinner");
  try {
    const types = (await apiGet("food_type")) || [];
    const tr = $("#dinner-types"); tr.innerHTML = "";
    types.forEach((ty, i) => {
      const d = el("div", "type-item focusable" + (i === 0 ? " active" : ""));
      d.textContent = ty.name || "";
      d.onclick = () => { $$("#dinner-types .type-item").forEach(x => x.classList.remove("active")); d.classList.add("active"); loadFood(ty.id); };
      tr.appendChild(d);
    });
    if (types.length) loadFood(types[0].id);
  } catch (e) {}
}
async function loadFood(typeId) {
  try {
    const foods = (await apiGet("food", { typeId: typeId })) || [];
    const g = $("#dinner-items"); g.innerHTML = "";
    foods.forEach(f => {
      const d = el("div", "food-item focusable");
      const img = el("img"); img.src = imgUrl(f.imagePath || f.cover || "");
      img.onerror = () => img.src = "/assets/img/mipmap__icon_food_count.png";
      d.appendChild(img);
      d.appendChild(el("div", "cap", f.name || ""));
      d.appendChild(el("div", "price", f.price != null ? String(f.price) : ""));
      d.onclick = async () => {
        try { await apiPost("/api/post", { ep: "add_food_order", payload: { foodId: f.id, count: 1 } }); toast(t("submit_success", "ارسال شد")); }
        catch (e) { toast(t("submit_failed", "ارسال ناموفق")); }
      };
      g.appendChild(d);
    });
  } catch (e) {}
}

/* ----------------------------- SERVICE ----------------------------- */
function openService() {
  show("scr-service");
  const g = $("#svc-grid"); g.innerHTML = "";
  const defs = [
    { ico: "🛎", label: t("butler_service", "خدمات اتاق"), act: () => orderService(1, t("butler_service")) },
    { ico: "🧺", label: t("clothes_service", "خدمات لباس"), act: () => orderService(2, t("clothes_service")) },
    { ico: "", label: t("goods_service", "اقلام"), act: () => openRent() },
    { ico: "⏰", label: t("wake_up_service", "بیدارباش"), act: () => openWakeup() },
    { ico: "🧾", label: t("main_menu_consume", "صورتحساب"), act: () => openConsume() },
    { ico: "🚪", label: t("checking_out", "تسویه حساب"), act: () => checkout() },
  ];
  defs.forEach(d => {
    const b = el("div", "svc-item focusable");
    b.appendChild(el("div", "ico", d.ico));
    b.appendChild(el("div", "cap", d.label));
    b.onclick = d.act;
    g.appendChild(b);
  });
}
async function orderService(typeId, label) {
  try { await apiPost("/api/post", { ep: "add_goods_order", type_id: typeId }); toast(t("submit_success", "درخواست ثبت شد") + ": " + label); }
  catch (e) { toast(t("submit_failed", "ناموفق")); }
}
async function openRent() {
  show("scr-rent");
  $("#rent-title").textContent = t("goods_service", "اقلام");
  try {
    const goods = (await apiGet("goods")) || [];
    const g = $("#rent-grid"); g.innerHTML = "";
    (Array.isArray(goods) ? goods : []).forEach(it => {
      const d = el("div", "food-item focusable");
      const img = el("img"); img.src = imgUrl(it.imagePath || it.icon || "");
      img.onerror = () => img.src = "/assets/img/mipmap__icon_service.png";
      d.appendChild(img); d.appendChild(el("div", "cap", it.name || ""));
      d.appendChild(el("div", "price", it.price != null ? String(it.price) : ""));
      d.onclick = async () => { try { await apiPost("/api/post", { ep: "add_goods_order", type_id: it.id || it.typeId }); toast(t("submit_success", "ثبت شد")); } catch (e) { toast(t("submit_failed", "ناموفق")); } };
      g.appendChild(d);
    });
  } catch (e) {}
}
function openWakeup() {
  show("scr-wakeup");
  const day = $("#wk-day"), hr = $("#wk-hour"), mn = $("#wk-min");
  if (!day.options.length) {
    for (let i = 0; i < 3; i++) day.add(new Option(t("wake_up_date_day", "روز") + " +" + i, i));
    for (let h = 0; h < 24; h++) hr.add(new Option(String(h).padStart(2, "0"), h));
    for (let m = 0; m < 60; m += 5) mn.add(new Option(String(m).padStart(2, "0"), m));
    hr.value = String(serverNow().getHours());
  }
  $("#wk-submit").onclick = async () => {
    const when = Date.now() + (+day.value) * 86400000;
    const d = new Date(when); d.setHours(+hr.value, +mn.value, 0, 0);
    try { await apiPost("/api/post", { ep: "add_goods_order", type_id: 4, wakeupTime: d.getTime() }); toast(t("submit_success", "ثبت شد")); }
    catch (e) { toast(t("submit_failed", "ناموفق")); }
  };
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
async function checkout() {
  if (!confirm(t("check_out_tip", "آیا مطمئن هستید؟"))) return;
  try { await apiPost("/api/post", { ep: "add_checkout_order" }); toast(t("checkout_success", "تسویه انجام شد")); }
  catch (e) { toast(t("checking_out_failed", "ناموفق")); }
}

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
      cap.innerHTML = "<b>" + (it.name || it.title || "") + "</b><br>" + (it.content || it.description || "");
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
      d.textContent = c.name || "";
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
      d.appendChild(img); d.appendChild(el("div", "cap", m.name || m.videoName || ""));
      d.onclick = () => { const a = $("#audio"); a.src = "/proxy?url=" + enc(m.url || ""); a.play().catch(() => {}); toast("♪ " + (m.name || "")); };
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

/* ----------------------------- enter-screen hook ----------------------------- */
function onEnter(id) {
  if (id !== "scr-player") { clearInterval(S._epgT); }
}

window.addEventListener("load", boot);
})();
