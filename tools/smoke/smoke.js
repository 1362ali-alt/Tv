/* Headless smoke test of the PARDIK IPTV web UI against a running backend. */
const { JSDOM } = require("jsdom");

const BASE = process.env.BASE || "http://127.0.0.1:8787";
const errors = [];
const logs = [];

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: BASE + "/" });

async function main() {
  const cfg0 = await (await fetch(BASE + "/api/config")).json();
  const mode = cfg0.mode || "residential";
  console.log("deployment mode =", mode, "| product =", (cfg0.branding || {}).product,
    "| subtitle =", (cfg0.branding || {}).subtitle);
  const res = await fetch(BASE + "/");
  const html = await res.text();
  const d = new JSDOM(html, {
    url: BASE + "/",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (input, init) => {
        const u = new URL(input, BASE);
        return fetch(u, init);
      };
      window.addEventListener("error", (e) => errors.push("window.onerror: " + (e.message || e.error)));
      const origErr = window.console.error;
      window.console.error = (...a) => { errors.push("console.error: " + a.join(" ")); };
      window.console.log = (...a) => { logs.push(a.join(" ")); };
      // minimal media stubs so <video> doesn't explode
      window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
      window.HTMLMediaElement.prototype.pause = function () {};
      window.HTMLMediaElement.prototype.load = function () {};
      Object.defineProperty(window.HTMLMediaElement.prototype, "volume", { get() { return 1; }, set(v) {} });
      window.confirm = () => true;
    },
  });
  const w = d.window, doc = w.document;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const active = () => (doc.querySelector(".screen.active") || {}).id;
  /* adapter_main_menu_layout.xml tiles (MainStyleThirdActivity's menu) */
  const tiles = () => Array.from(doc.querySelectorAll("#home-menu .mm-item"));
  const homeBtn = (re) => tiles().find(n => re.test(n.textContent));
  /* MainStyleThirdActivity.onKeyDown(): the settings activity opens by typing
     IptvSP.getPassword() on the main screen - there is no settings tile. */
  const typeCode = async (code) => {
    for (const ch of String(code)) {
      doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: ch, bubbles: true }));
      await sleep(25);
    }
    await sleep(450);
  };
  const openSettingsByCode = async (code) => {
    await typeCode(code || "111999");
    if (active() !== "scr-settings") {
      /* inputNumberTimer expired mid-sequence (the APK's own 2 s rule): again */
      await sleep(2200);
      await typeCode(code || "111999");
    }
  };
  // v2.7.2.06: channels 1-2 carry a pre-roll advert (GetNextAdv). Wait for it and skip it.
  const adBox = () => doc.querySelector("#ad-countdown");
  const skipAd = async (label) => {
    for (let i = 0; i < 12; i++) {
      if (adBox() && !adBox().hidden) break;
      await sleep(200);
    }
    const on = adBox() && !adBox().hidden;
    console.log("[v2] advert overlay visible =", !!on, on ? "| text = " + adBox().textContent.trim() : "");
    if (on) {
      doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await sleep(900);
      const vid = doc.querySelector("#video");
      const afterSrc = (vid.currentSrc || vid.src || "");
      const errTxt = ((doc.querySelector("#player-error-txt") || {}).textContent || "");
      const errShown = !doc.querySelector("#player-error").hidden;
      console.log("[v2] after skip: overlay hidden =", adBox().hidden, "| src =", afterSrc.slice(0, 90),
        errShown ? "| banner = " + errTxt.slice(0, 60) : "");
      /* the decode-failure panel must carry the diagnosis + recovery actions */
      if (errShown) {
        console.log("[v2] error detail hidden =", doc.querySelector("#player-error-detail").hidden,
          "| retry btn =", !!doc.querySelector("#player-retry"),
          "| vlc btn hidden =", doc.querySelector("#player-vlc").hidden);
        if (!doc.querySelector("#player-retry")) errors.push("the decode-failure panel has no retry button");
        if (!doc.querySelector("#player-error-detail")) errors.push("the decode-failure panel has no diagnosis line");
      }
      /* the channel must either be loading, or the player must say exactly why it
         is not - a missing ffmpeg.exe is the only accepted reason here */
      if (!/stream\/play|proxy\?url=/.test(afterSrc) && !(errShown && /FFmpeg/.test(errTxt))) {
        errors.push("after the advert the channel neither loaded nor reported a reason");
      }
    }
    return on;
  };

  await new Promise((resolve) => {
    if (doc.readyState === "complete") return resolve();
    w.addEventListener("load", resolve);
    setTimeout(resolve, 4000);
  });
  /* ---- the boot screen is PingServerActivity (activity_ping_server.xml):
     a ProgressBar over @drawable/progress_bg, #text_view = connecting_server_tips
     and #tips_txt = welcome_alert, while the backend runs BaseApplication's
     handshake (GetRoomInfo -> GetClient -> GetSettings -> UDP 27777 ->
     GetCurrentTimeAndZone) and its Timer(task, 0, 2000), 20 attempts. ---- */
  await sleep(600);
  console.log("boot screen =", active(), "| #ping-text =", (doc.querySelector("#ping-text") || {}).textContent,
    "| #ping-tips =", (doc.querySelector("#ping-tips") || {}).textContent);
  if (active() !== "scr-boot" && active() !== "scr-bootvideo") errors.push("the boot screen is not PingServerActivity: " + active());
  const pingBg = w.getComputedStyle(doc.querySelector("#ping-bg")).backgroundImage || "";
  console.log("[ping] background =", pingBg.slice(0, 80));
  if (!/pic_ping_bg/.test(pingBg)) errors.push("the boot background is not @mipmap/pic_ping_bg: " + pingBg);

  const conn = await (await fetch(BASE + "/api/connection")).json();
  console.log("[ping] connected =", conn.connected, "| phase =", conn.phase, "| settings_ok =", conn.settings_ok,
    "| attempts =", conn.ping_times + "/" + conn.ping_max, "| server =", (conn.server || {}).address,
    "| udp bound =", (conn.discovery || {}).bound, "| udp packets =", (conn.discovery || {}).packets);
  console.log("[ping] welcome payload =", JSON.stringify(conn.welcome));
  console.log("[ping] state panel =", ((doc.querySelector("#ping-state") || {}).textContent || "").replace(/\s+/g, " ").slice(0, 150));
  if (!conn.connected) errors.push("BaseApplication.isConnected() is false - the handshake never completed: " + (conn.last_error || ""));
  if (!conn.settings_ok) errors.push("GetSettings did not answer, so the live-TV gate stays closed");
  if (!(conn.discovery || {}).bound) errors.push("the UDP 27777 announce listener is not bound: " + ((conn.discovery || {}).error || ""));
  if (!conn.welcome) errors.push("openWelcomeActivity() never ran (no welcome payload after " + conn.ping_times + " attempts)");
  if (conn.welcome && conn.welcome.main !== "MainStyleThird" && conn.welcome.main !== "MainStyleFourth") {
    errors.push("the welcome payload does not name a main activity: " + JSON.stringify(conn.welcome));
  }
  if (!(conn.server_settings || {}).layout && (conn.server_settings || {}).layout !== 0) {
    errors.push("the server Settings bean has no layout");
  }
  console.log("[ping] Settings from the head-end =", Object.keys(conn.server_settings || {}).length, "fields |",
    "layout =", (conn.server_settings || {}).layout, "| indexArea =", (conn.server_settings || {}).indexArea,
    "| showPackage =", (conn.server_settings || {}).showPackage, "| epg =", (conn.server_settings || {}).epg,
    "| enterLivePage =", (conn.server_settings || {}).enterLivePage);

  /* BaseApplication$3 + startServerIpThread(): the head-end broadcasts
     ServerIpAddrBean {"ip","port"} to UDP 27777 and the client adopts it. */
  const headEnd = (conn.server || {}).address || "http://127.0.0.1:8030";
  try { await fetch(headEnd + "/mock/announce?on=1&ip=127.0.0.1&port=8030&every=2"); } catch (e) {}
  await sleep(3600);
  const connA = await (await fetch(BASE + "/api/connection")).json();
  const disc = connA.discovery || {};
  console.log("[ping] UDP 27777 announce -> bound =", disc.bound, "| packets =", disc.packets,
    "| adopted =", JSON.stringify(disc.last));
  if (!(disc.packets > 0)) errors.push("BaseApplication$3: the UDP 27777 listener received no announcement");
  if (!((disc.last || {}).ip === "127.0.0.1" && (disc.last || {}).port === 8030)) {
    errors.push("ServerIpAddrBean was not adopted from the announce: " + JSON.stringify(disc.last));
  }
  try { await fetch(headEnd + "/mock/announce?on=0"); } catch (e) {}
  await sleep(300);

  /* the screen must leave the boot activity on its own, without a key press */
  for (let i = 0; i < 40 && active() === "scr-boot"; i++) await sleep(250);
  console.log("after the handshake, active screen =", active());
  if (active() === "scr-boot") errors.push("the boot screen never left PingServerActivity");

  /* v2.7.2.06: settings.advVideoEM -> PingServerActivity starts BootVideoActivity,
     which plays GetAdvVideoEM[0] full screen before the welcome screen. */
  if (active() === "scr-bootvideo") {
    const bv = doc.querySelector("#boot-video");
    console.log("[v2] boot advert src =", ((bv && (bv.currentSrc || bv.src)) || "").slice(0, 110));
    console.log("[v2] boot advert hint =", ((doc.querySelector("#bootvideo-hint") || {}).textContent || "").trim());
    if (!bv || !/stream\/play|proxy\?url=/.test(bv.src || "")) errors.push("boot advert video has no source (GetAdvVideoEM)");
    // VOLUME_UP/VOLUME_DOWN must not leave the boot video (BootVideoActivity.onKeyDown)
    doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    await sleep(300);
    console.log("[v2] after volume key, active =", active());
    if (active() !== "scr-bootvideo") errors.push("a volume key left the boot advert video");
    // any other key -> welcome screen
    doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await sleep(1200);
    console.log("[v2] after skip key, active =", active());
    if (active() !== "scr-welcome") errors.push("the boot advert video did not continue to the welcome screen");
  } else {
    errors.push("expected the boot advert video screen (settings.advVideoEM)");
  }

  /* ---- WelcomeStyleZeroActivity (activity_welcome.xml): the 900x450dp card over
     @mipmap/bg_welcome, GetAdvImage?type=1 in the banner, type=12 as the manager
     signature, type=17 as the title image, GetClient -> tv_user_name,
     GetWelcomWord -> tv_welcome_word_zh, apk/getWeatherDays -> both weather
     layouts, apk/getClientBackgroundMusics looped. ---- */
  if (active() === "scr-welcome") {
    await sleep(2200);
    const ppt = doc.querySelector("#wel-ppt"), sign = doc.querySelector("#wel-sign"), mus = doc.querySelector("#bg-music");
    const card = w.getComputedStyle(doc.querySelector(".wel-card"));
    console.log("[wel] card =", card.width + " x " + card.height, "| bg =", (w.getComputedStyle(doc.querySelector("#welcome-bg")).backgroundImage || "").slice(0, 60));
    console.log("[wel] ppt hidden =", ppt.hidden, "| src =", (ppt.src || "").slice(0, 90));
    console.log("[wel] sign hidden =", sign.hidden, "| src =", (sign.src || "").slice(0, 90));
    console.log("[wel] bg music src =", ((mus && mus.src) || "none").slice(0, 90));
    console.log("[wel] background video hidden =", doc.querySelector("#wel-video").hidden);
    console.log("[wel] title image hidden =", doc.querySelector("#wel-title-img").hidden, "(GetAdvImage?type=17 was empty)");
    console.log("[wel] user =", (doc.querySelector("#wel-user") || {}).textContent,
      "| word =", ((doc.querySelector("#wel-word") || {}).textContent || "").slice(0, 70),
      "| manager =", (doc.querySelector("#wel-manager") || {}).textContent);
    console.log("[wel] time =", (doc.querySelector("#wel-time") || {}).textContent,
      "| date =", (doc.querySelector("#wel-date") || {}).textContent,
      "| weather hidden =", doc.querySelector("#wel-weather").hidden,
      "|", (doc.querySelector("#wel-weather-txt") || {}).textContent, (doc.querySelector("#wel-weather-range") || {}).textContent,
      "| forecast hidden =", doc.querySelector("#wel-forecast").hidden,
      "|", Array.from(doc.querySelectorAll(".wel-fday span")).map(n => n.textContent).join(","));
    if (ppt.hidden) errors.push("welcome slideshow (GetAdvImage?type=1) is not showing");
    if (sign.hidden) errors.push("manager signature (GetAdvImage?type=12) is not showing");
    if (!mus || !mus.src) errors.push("welcome background music (apk/getClientBackgroundMusics) not started");
    if (doc.querySelector("#wel-user").hidden) errors.push("tv_user_name is still GONE after GetClient");
    if (!/guest/.test((doc.querySelector("#wel-user") || {}).textContent || "")) {
      errors.push("tv_user_name does not carry Client.checkPerson: " + (doc.querySelector("#wel-user") || {}).textContent);
    }
    if (!/رونیکا|complex|مجتمع/i.test((doc.querySelector("#wel-manager") || {}).textContent || "")) {
      errors.push("welcome_end_hotel_manager does not carry Settings.hotelName: " + (doc.querySelector("#wel-manager") || {}).textContent);
    }
    if (!/18/.test((doc.querySelector("#wel-weather-txt") || {}).textContent || "")) {
      errors.push("the welcome weather is not filled from apk/getWeatherDays");
    }
    if (doc.querySelector("#wel-weather").hidden || doc.querySelector("#wel-forecast").hidden) {
      errors.push("setShowWeather() did not make both weather layouts visible");
    }
    if (!/\d{2}:\d{2}/.test((doc.querySelector("#wel-time") || {}).textContent || "")) {
      errors.push("cur_time_view is not HH:mm");
    }
    /* onKeyDown: UP/LEFT -> tv_chinese, DOWN/RIGHT -> tv_english, and the screen
       waits for the guest instead of walking on by itself. */
    doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await sleep(200);
    console.log("[wel] after RIGHT, focused =", (doc.activeElement || {}).id, "| active screen =", active());
    if ((doc.activeElement || {}).id !== "wel-en") errors.push("DOWN/RIGHT did not focus tv_english");
    doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await sleep(200);
    if ((doc.activeElement || {}).id !== "wel-zh") errors.push("UP/LEFT did not focus tv_chinese");
    if (active() !== "scr-welcome") errors.push("the welcome screen left on its own (it must wait for a language choice)");
  }

  /* onClick(tv_chinese) -> setSelectLanguage(1) -> openMain() */
  if (active() === "scr-welcome") {
    doc.querySelector("#wel-zh").click();
    await sleep(1200);
  }
  console.log("after the language choice, active =", active());
  if (active() !== "scr-home") errors.push("openMain() did not reach MainStyleThirdActivity: " + active());
  const menu = tiles().map(n => n.textContent.trim());
  console.log("menu items =", JSON.stringify(menu));

  /* The overlays are hidden with the `hidden` attribute while their classes set
     `display:flex`; without `[hidden]{display:none !important}` in styles.css the
     browser paints empty dialogs/OSDs on top of the screen. The rule is not
     derived from the APK, so guard both its presence in the stylesheet and its
     effect on the computed style. */
  const css = await (await fetch(BASE + "/web/styles.css")).text();
  const hasHiddenRule = /\[hidden\][^{]*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/.test(css);
  console.log("[css] [hidden]{display:none !important} present =", hasHiddenRule,
    "| occurrences =", (css.match(/\[hidden\]/g) || []).length);
  if (!hasHiddenRule) errors.push("styles.css lost the [hidden]{display:none !important} rule");
  const overlays = ["#confirm-modal", "#input-modal", "#vod-detail", "#order-detail", "#epg-panel",
    "#epg-detail", "#vol-osd", "#player-osd", "#ch-badge", "#player-error", "#toast",
    "#ad-countdown", "#side-list", "#wel-weather", "#wel-forecast", "#wel-title-img", "#wel-sign",
    "#main-wifi", "#main-weather", "#main-logo", "#main-title", "#main-room-label", "#main-banner"];
  let shown = [];
  overlays.forEach((sel) => {
    const n = doc.querySelector(sel);
    if (!n) { shown.push(sel + " (missing)"); return; }
    if (n.hasAttribute("hidden") && w.getComputedStyle(n).display !== "none") shown.push(sel);
  });
  console.log("[css] overlays painted while hidden =", shown.length ? JSON.stringify(shown) : "none");
  if (shown.length) errors.push("hidden overlays are still displayed: " + shown.join(", "));

  /* ---- MainStyleThirdActivity (activity_main_ijk_style_third.xml): the top bar
     (iv_logo, tv_room_num, wifi_status_layout, weather_layout_main, the clock),
     ll_main_menu sliding in from the left, and one adapter_main_menu_layout tile
     per GetHomepageIcon entry. ---- */
  {
    const scr = doc.querySelector("#scr-home");
    console.log("[main] style-four =", scr.classList.contains("style-four"), "(Settings.layout =",
      (conn.server_settings || {}).layout, ") | menu strip slid in =", scr.classList.contains("menu-in"));
    if ((conn.server_settings || {}).layout === 0 && scr.classList.contains("style-four")) {
      errors.push("layout 0 must use activity_main_ijk_style_third, not style four");
    }
    await sleep(300);
    if (!doc.querySelector("#scr-home").classList.contains("menu-in")) {
      errors.push("right_show_action() never made ll_main_menu visible");
    }
    const bg = w.getComputedStyle(doc.querySelector("#main-bg")).backgroundImage || "";
    console.log("[main] background =", bg.slice(0, 70),
      "| room =", (doc.querySelector("#main-room-num") || {}).textContent,
      "| room label hidden =", doc.querySelector("#main-room-label").hidden,
      "| logo hidden =", doc.querySelector("#main-logo").hidden,
      "| clock =", (doc.querySelector("#main-time") || {}).textContent, (doc.querySelector("#main-date") || {}).textContent);
    if (!/bg_welcome|main_bg/.test(bg)) errors.push("main_layout_background_img is not @mipmap/bg_welcome: " + bg);
    if ((doc.querySelector("#main-room-num") || {}).textContent !== "Ronika") {
      errors.push("tv_room_num does not print Client.name: " + (doc.querySelector("#main-room-num") || {}).textContent);
    }
    if (!doc.querySelector("#main-room-label").hidden) errors.push("tv_room_text_view must stay GONE");
    if (!doc.querySelector("#main-logo").hidden) errors.push("iv_logo must stay empty while GetAdvImage?type=2 is empty");
    if (!/\d{2}:\d{2}/.test((doc.querySelector("#main-time") || {}).textContent || "")) errors.push("the main clock is not HH:mm");
    const wifi = doc.querySelector("#main-wifi");
    console.log("[main] wifi hidden =", wifi.hidden, "|", (doc.querySelector("#main-wifi-name") || {}).textContent,
      "|", (doc.querySelector("#main-wifi-pass") || {}).textContent);
    if (wifi.hidden) errors.push("isShowWifi() hid a client that has wifiName + wifiPassword");
    if (!/RONIKA-RESIDENTS/.test((doc.querySelector("#main-wifi-name") || {}).textContent || "")) {
      errors.push("wifi_name_View is not R$string.account + Client.wifiName");
    }
    const wx = doc.querySelector("#main-weather");
    console.log("[main] weather hidden =", wx.hidden, "|", (doc.querySelector("#main-weather-status") || {}).textContent,
      (doc.querySelector("#main-weather-range") || {}).textContent,
      "| banner hidden =", doc.querySelector("#main-banner").hidden, "(indexArea =", (conn.server_settings || {}).indexArea, ")");
    if (wx.hidden) errors.push("weather_layout_main is hidden although the welcome screen got weather");
    if ((conn.server_settings || {}).indexArea === 1 && doc.querySelector("#main-banner").hidden) {
      errors.push("indexArea 1 must run the GetAdvImage?type=0 banner behind the menu");
    }
    /* the tiles are the head-end's list, in order, with the APK's own artwork */
    const want = (conn.server_settings || {}) && menu.length;
    const icons = tiles().map(n => ((n.querySelector("img") || {}).src || "").replace(/^.*\//, ""));
    console.log("[main] tiles =", JSON.stringify(menu), "| icons =", JSON.stringify(icons));
    if (!want || menu.length < 2) errors.push("GetHomepageIcon did not build the menu: " + JSON.stringify(menu));
    if (icons[0] !== "mipmap__icon_live.png") errors.push("the live tile is not @mipmap/icon_live: " + icons[0]);
    const t0 = tiles()[0];
    if (t0) {
      t0.dispatchEvent(new w.FocusEvent("focus"));
      await sleep(120);
      const focused = ((t0.querySelector("img") || {}).src || "").replace(/^.*\//, "");
      console.log("[main] focused icon =", focused);

  /* The APK opens SettingsActivity only by typing 111999; the port adds a
     discoverable gear tile at the end of the menu - still password-gated. */
  const setTile = tiles().find(n => /تنظیمات|Settings|设置/i.test(n.textContent));
  if (!setTile) errors.push("the main menu has no visible settings tile");
  else {
    setTile.click(); await sleep(600);
    const gate = doc.querySelector("#set-gate");
    console.log("[main] settings tile -> active =", active(), "| gate shown =",
      gate.style.display !== "none", "| factory hint hidden =", (doc.querySelector("#gate-hint") || {}).hidden);
    if (active() !== "scr-settings") errors.push("the settings tile did not open SettingsActivity: " + active());
    if (gate.style.display === "none") errors.push("the settings tile skipped the password gate");
    if ((doc.querySelector("#gate-hint") || {}).hidden !== false) {
      errors.push("the gate hides the factory-password hint while the password is unchanged");
    }
    doc.querySelector("#gate-pass").value = "111999";
    doc.querySelector("#gate-ok").click(); await sleep(500);
    if (doc.querySelector("#set-body").hidden) errors.push("the gate rejected the factory password 111999");
    for (let i = 0; i < 6 && active() !== "scr-home"; i++) {
      doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(250);
    }
    if (active() !== "scr-home") errors.push("could not leave SettingsActivity back to the menu");
  }
      if (focused !== "mipmap__icon_live_large.png") errors.push("onItemSelected did not swap to icon_live_large: " + focused);
      t0.dispatchEvent(new w.FocusEvent("blur"));
      await sleep(80);
    }
    /* the tile label follows getMenuItemName(); Persian uses the APK's own
       string resource for that tile type because MainPageItemBean has no fa column */
    if (!/زنده|LIVE|直播/i.test(menu[0] || "")) errors.push("the first tile is not the live tile: " + menu[0]);
    console.log("[mode] deployment =", mode, "| menu =", JSON.stringify(menu));
  }

  // open LIVE
  const liveBtn = homeBtn(/زنده|LIVE|直播/i);
  if (liveBtn) { liveBtn.click(); await sleep(1500); }
  console.log("after LIVE click, active =", active());
  const pkgs = Array.from(doc.querySelectorAll("#pkg-list .pkg-item")).map(n => n.textContent.trim());
  console.log("packages =", JSON.stringify(pkgs));
  if (mode === "residential" && !/داخلی/.test(pkgs.join(" "))) {
    errors.push("the residential bouquets (domestic/satellite) are missing: " + JSON.stringify(pkgs));
  }
  const pkg = doc.querySelector("#pkg-list .pkg-item");
  if (pkg) { pkg.click(); await sleep(2500); }
  console.log("after package click, active =", active());
  const video = doc.querySelector("#video");
  console.log("video src/currentSrc =", video && (video.currentSrc || video.src));
  console.log("player loading visible =", doc.querySelector("#player-loading").style.display);
  console.log("ch badge =", (doc.querySelector("#ch-name") || {}).textContent);
  const sawAd = await skipAd();
  if (!sawAd) errors.push("expected a pre-roll advert on channel 1 (GetNextAdv)");

  // back to home, open VOD
  for (let i = 0; i < 3; i++) { doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(400); }
  console.log("after escapes, active =", active());
  const vodBtn = homeBtn(/ویدئو|VOD|点播/i);
  if (vodBtn) { vodBtn.click(); await sleep(1500); }
  console.log("after VOD, active =", active());
  const types = Array.from(doc.querySelectorAll("#vod-types .type-item")).map(n => n.textContent.trim());
  const posters = doc.querySelectorAll("#vod-grid .poster").length;
  console.log("vod types =", JSON.stringify(types), "posters =", posters);
  const poster = doc.querySelector("#vod-grid .poster");
  if (poster) { poster.click(); await sleep(600); }
  console.log("vod detail hidden =", doc.querySelector("#vod-detail").hidden, "title =", (doc.querySelector("#vd-title") || {}).textContent);

  /* Settings: MainStyleThirdActivity.onKeyDown() collects digits and opens
     SettingsActivity when the buffer equals IptvSP.getPassword() - the menu has
     no settings tile, exactly like the APK. */
  for (let i = 0; i < 4; i++) { doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(300); }
  if (active() !== "scr-home") errors.push("BACK did not return to the main screen: " + active());
  const wrongCode = async () => {
    for (const ch of "12345") { doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: ch, bubbles: true })); await sleep(20); }
    await sleep(300);
    const a = active();
    for (let i = 0; i < 3; i++) { doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(200); }
    return a;
  };
  const wrong1 = await wrongCode();
  console.log("[main] after a wrong code, active =", wrong1, "(must stay scr-home)");
  if (wrong1 !== "scr-home") errors.push("a wrong digit sequence opened the settings activity");
  await sleep(2200);                       // let inputNumberTimer clear the buffer
  await openSettingsByCode("111999");
  console.log("settings active =", active(), "gate shown =", doc.querySelector("#set-gate").style.display,
    "| body hidden =", doc.querySelector("#set-body").hidden);
  if (active() !== "scr-settings") errors.push("typing 111999 on the main screen did not open SettingsActivity");
  if (doc.querySelector("#set-body").hidden) errors.push("the code was correct but the settings gate asked again");
  console.log("[mode] head-end row =", (doc.querySelector("#set-headend-value") || {}).textContent);
  if (!/:\d+/.test((doc.querySelector("#set-headend-value") || {}).textContent || "")) {
    errors.push("the head-end row does not show the configured address: " + (doc.querySelector("#set-headend-value") || {}).textContent);
  }
  console.log("[mode] device link =", (doc.querySelector("#set-link-value") || {}).textContent,
    "| room/unit label =", (doc.querySelector("#set-room-label") || {}).textContent,
    "| m3u =", (doc.querySelector("#set-m3u-value") || {}).textContent);
  if (!/کابل شبکه|Ethernet|وای|Wi-?Fi/i.test((doc.querySelector("#set-link-value") || {}).textContent || "")) {
    errors.push("the device-connection row is empty: " + (doc.querySelector("#set-link-value") || {}).textContent);
  }
  console.log("settings body hidden =", doc.querySelector("#set-body").hidden,
    "ip =", (doc.querySelector("#set-ip") || {}).textContent,
    "port =", (doc.querySelector("#set-port") || {}).textContent,
    "mac =", (doc.querySelector("#set-mac") || {}).textContent);

  /* ===================== v2.7.2.06 features ===================== */
  const goHome = async () => {
    for (let i = 0; i < 6; i++) {
      if (active() === "scr-home") break;
      doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(250);
    }
  };
  await goHome();

  // --- settings: VLC / speed / autostart rows + apps screen
  console.log("\n[v2] settings rows: vlc =", (doc.querySelector("#set-vlc-value") || {}).textContent,
    "| speed =", (doc.querySelector("#set-speed-value") || {}).textContent,
    "| autostart =", (doc.querySelector("#set-autostart-value") || {}).textContent,
    "| apps =", (doc.querySelector("#set-apps-value") || {}).textContent);
  doc.querySelector("#set-speed").click(); await sleep(400);
  console.log("[v2] after speed click =", (doc.querySelector("#set-speed-value") || {}).textContent);
  doc.querySelector("#set-speed").click(); await sleep(300);
  const autoBefore = (doc.querySelector("#set-autostart-value") || {}).textContent;
  doc.querySelector("#set-autostart").click(); await sleep(600);
  console.log("[v2] autostart", autoBefore, "->", (doc.querySelector("#set-autostart-value") || {}).textContent);
  doc.querySelector("#set-autostart").click(); await sleep(600);
  doc.querySelector("#set-vlc").click(); await sleep(600);
  console.log("[v2] vlc row ->", (doc.querySelector("#set-vlc-value") || {}).textContent);
  doc.querySelector("#set-vlc").click(); await sleep(600);
  doc.querySelector("#set-apps").click(); await sleep(900);
  console.log("[v2] apps screen active =", active(),
    "items =", Array.from(doc.querySelectorAll("#app-grid .app-item")).map(n => n.textContent.replace("✓", "").trim()).join(","));
  const custom = doc.querySelector("#app-grid .app-item");
  if (custom) { custom.click(); await sleep(700); }
  doc.querySelector("#app-back").click(); await sleep(600);
  console.log("[v2] after app-back active =", active());

  /* --- live-playback pre-flight check (Settings -> "بررسی پخش زنده") --- */
  await goHome();
  await openSettingsByCode();
  console.log("[diag] ffmpeg row =", (doc.querySelector("#set-ffmpeg-value") || {}).textContent,
    "| check row =", (doc.querySelector("#set-diag-value") || {}).textContent);
  const diagRow = doc.querySelector("#set-diag");
  if (diagRow) {
    diagRow.click(); await sleep(4000);
    const rows = Array.from(doc.querySelectorAll("#diag-list .diag-item"));
    console.log("[diag] dialog hidden =", doc.querySelector("#input-modal").hidden,
      "| rows =", rows.length, "|", rows.map(n => n.textContent.trim().slice(0, 46)).join(" || "));
    if (doc.querySelector("#input-modal").hidden) errors.push("the live-playback check did not open its dialog");
    if (!rows.length) errors.push("the live-playback check reported nothing");
    if (!rows.some(n => /GetLiveTV|فهرست کانال/.test(n.textContent))) {
      errors.push("the check does not cover the channel list (GetLiveTV)");
    }
    if (!rows.some(n => /هداند|head-end/i.test(n.textContent))) {
      errors.push("the check does not cover head-end reachability");
    }
    const okBtn = doc.querySelector("#input-ok");
    const ffst = await (await fetch(BASE + "/api/ffmpeg/status")).json();
  console.log("[diag] ffmpeg self-heal state =", JSON.stringify(ffst));
  if (typeof ffst.enabled !== "boolean") errors.push("/api/ffmpeg/status lacks the enabled flag");
  console.log("[diag] verdict button =", okBtn.textContent, "| data-i18n =", okBtn.getAttribute("data-i18n"));
    okBtn.click(); await sleep(500);
    console.log("[diag] after close: dialog hidden =", doc.querySelector("#input-modal").hidden,
      "| list removed =", !doc.querySelector("#diag-list"),
      "| ok label =", doc.querySelector("#input-ok").textContent,
      "| row value =", (doc.querySelector("#set-diag-value") || {}).textContent);
    if (!doc.querySelector("#input-modal").hidden) errors.push("the check dialog did not close");
    if (doc.querySelector("#diag-list")) errors.push("the check dialog left its result list behind");
  } else errors.push("no live-playback check row in settings");
  // the m3u dialog reuses the same modal - make sure it still works afterwards
  doc.querySelector("#set-m3u").click(); await sleep(500);
  const mfield = doc.querySelector("#input-field");
  console.log("[diag] m3u dialog input type =", mfield.type, "| hint hidden =", doc.querySelector("#input-hint").hidden);
  if (mfield.type !== "text") errors.push("the m3u dialog inherited the hidden input from the check dialog");
  doc.querySelector("#input-cancel").click(); await sleep(400);

  /* --- external playlist source (residential head-end): Settings -> m3u --- */
  await goHome();
  await openSettingsByCode();
  const m3uRow = doc.querySelector("#set-m3u");
  if (m3uRow) {
    m3uRow.click(); await sleep(500);
    console.log("[m3u] dialog hidden =", doc.querySelector("#input-modal").hidden,
      "| hint =", ((doc.querySelector("#input-hint") || {}).textContent || "").slice(0, 60));
    const inp = doc.querySelector("#input-field");
    inp.value = "http://127.0.0.1:8030/iptv2/residential/channels.m3u";
    doc.querySelector("#input-ok").click(); await sleep(2000);
    const rowVal = (doc.querySelector("#set-m3u-value") || {}).textContent || "";
    console.log("[m3u] row value =", rowVal);
    if (!/[0-9۰-۹]+ کانال/.test(rowVal)) errors.push("the playlist was not parsed: " + rowVal);
    await goHome();
    const lb = homeBtn(/زنده|LIVE|直播/i);
    if (lb) { lb.click(); await sleep(1500); }
    const mpkgs = Array.from(doc.querySelectorAll("#pkg-list .pkg-item")).map(n => n.textContent.trim());
    console.log("[m3u] packages from playlist =", JSON.stringify(mpkgs));
    if (!mpkgs.some(x => /داخلی/.test(x)) || !mpkgs.some(x => /ماهواره/.test(x))) {
      errors.push("playlist groups are not used as packages: " + JSON.stringify(mpkgs));
    }
    const mp = Array.from(doc.querySelectorAll("#pkg-list .pkg-item")).find(n => /ماهواره/.test(n.textContent));
    if (mp) { mp.click(); await sleep(2200); }
    const msrc = ((doc.querySelector("#video") || {}).src || "");
    console.log("[m3u] satellite bouquet player =", active(), "| src =", msrc.slice(0, 100),
      "| channel badge =", (doc.querySelector("#ch-name") || {}).textContent);
    if (active() !== "scr-player" || !/stream\/play|proxy/.test(msrc)) errors.push("a playlist channel did not start");
    if (doc.querySelector("#ad-countdown") && !doc.querySelector("#ad-countdown").hidden) {
      errors.push("playlist channels must not run the platform advert flow");
    }
    await goHome();
    // turn the playlist off again so the rest of the run uses the server list
    await openSettingsByCode();
    doc.querySelector("#set-m3u").click(); await sleep(600);
    const cok2 = doc.querySelector("#confirm-ok");
    console.log("[m3u] disable confirm hidden =", doc.querySelector("#confirm-modal").hidden);
    if (cok2) { cok2.click(); await sleep(1000); }
    console.log("[m3u] row value after disable =", (doc.querySelector("#set-m3u-value") || {}).textContent);
    if (/●/.test((doc.querySelector("#set-m3u-value") || {}).textContent || "")) errors.push("the playlist is still enabled");
    await goHome();
  }

  // --- EPG + speed inside the live player (server channel table, not the playlist)
  await fetch(BASE + "/api/m3u", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false }) });
  await goHome();
  const liveBtn2 = homeBtn(/زنده|LIVE|直播/i);
  if (liveBtn2) { liveBtn2.click(); await sleep(800); }
  const pkg2 = doc.querySelector("#pkg-list .pkg-item");
  if (pkg2) { pkg2.click(); await sleep(2200); }
  await skipAd();
  console.log("[v2] player active =", active(), "epg btn hidden =", doc.querySelector("#btn-epg").hidden,
    "speed btn =", (doc.querySelector("#speed-val") || {}).textContent);
  doc.querySelector("#btn-epg").click(); await sleep(900);
  const epgItems = Array.from(doc.querySelectorAll("#epg-list .epg-item")).map(n => n.textContent.trim());
  console.log("[v2] epg panel hidden =", doc.querySelector("#epg-panel").hidden, "items =", epgItems.length, JSON.stringify(epgItems.slice(0, 3)));
  const ts = Array.from(doc.querySelectorAll("#epg-list .epg-item")).find(n => /پخش با تأخیر|timeshift/i.test(n.textContent));
  const plain = Array.from(doc.querySelectorAll("#epg-list .epg-item")).find(n => !/در حال پخش|پخش با تأخیر|now|timeshift/i.test(n.textContent));
  if (plain) { plain.click(); await sleep(500); console.log("[v2] epg detail hidden =", doc.querySelector("#epg-detail").hidden, "|", (doc.querySelector("#epg-detail-title") || {}).textContent); }
  if (ts) { ts.click(); await sleep(1200); console.log("[v2] after timeshift click active =", active(), "title =", (doc.querySelector("#osd-title") || {}).textContent); }
  doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "s", bubbles: true })); await sleep(400);
  console.log("[v2] speed after 's' =", (doc.querySelector("#speed-val") || {}).textContent);
  await goHome();

  /* The hotel-platform services (catering, room service, laundry, taxi,
     check-out, orders) only exist when the backend runs with IPTV_MODE=hotel;
     Pardik's residential deployment for Ronika Palace has none of them. */
  if (mode === "hotel") {
    // --- catering: country selector (caterSub) -> types -> basket -> orders
    const dinnerBtn = homeBtn(/شام|CATERING|DINNER|美食/i);
    if (dinnerBtn) { dinnerBtn.click(); await sleep(900); }
    console.log("[v2] dinner active =", active(), "countries =", Array.from(doc.querySelectorAll("#country-list .country-item")).map(n => n.textContent.trim()).join(","));
    const c0 = doc.querySelector("#country-list .country-item");
    if (c0) { c0.click(); await sleep(1000); }
    console.log("[v2] catering active =", active(), "types =", Array.from(doc.querySelectorAll("#dinner-types .type-item")).map(n => n.textContent.trim()).join(","),
      "items =", doc.querySelectorAll("#dinner-items .food-item").length);
    const f0 = doc.querySelector("#dinner-items .food-item");
    if (f0) { f0.click(); await sleep(400); }
    console.log("[v2] orders badge =", (doc.querySelector("#dinner-orders") || {}).textContent);
    doc.querySelector("#dinner-orders").click(); await sleep(1100);
    const oRows = Array.from(doc.querySelectorAll("#order-list .order-item"));
    console.log("[v2] orders active =", active(), "rows =", oRows.length, JSON.stringify(oRows.map(n => n.textContent.trim()).slice(0, 4)));
    const submitBtn = Array.from(doc.querySelectorAll("#order-list button")).find(b => /ارسال|submit/i.test(b.textContent));
    if (submitBtn) { submitBtn.click(); await sleep(1000); console.log("[v2] after submit rows =", doc.querySelectorAll("#order-list .order-item").length); }
    const hist = Array.from(doc.querySelectorAll("#order-list .order-item"))
      .find(n => !/ارسال|submit/i.test(n.textContent) && !/لغو|cancel/i.test(n.textContent));
    if (hist) { hist.click(); await sleep(600); }
    console.log("[v2] order detail hidden =", doc.querySelector("#order-detail").hidden,
      "total =", (doc.querySelector("#od-total") || {}).textContent, "status =", (doc.querySelector("#od-status") || {}).textContent,
      "cancel disabled =", doc.querySelector("#od-cancel").disabled);
    const cancelBtn = doc.querySelector("#od-cancel");
    if (cancelBtn && !cancelBtn.disabled) {
      cancelBtn.click(); await sleep(400);
      const okBtn = doc.querySelector("#confirm-ok");
      console.log("[v2] confirm modal hidden =", doc.querySelector("#confirm-modal").hidden, "|", (doc.querySelector("#confirm-title") || {}).textContent);
      if (okBtn) { okBtn.click(); await sleep(900); }
    }
    console.log("[v2] after cancel, active =", active(), "detail hidden =", doc.querySelector("#order-detail").hidden);
    await goHome();

    // --- room service (GetServiceIcon) incl. taxi / checkout / service record
    const svcBtn = homeBtn(/خدمت|SERVICE|服务/i);
    if (svcBtn) { svcBtn.click(); await sleep(900); }
    console.log("[v2] service active =", active(), "tiles =", doc.querySelectorAll("#svc-grid .svc-item").length);
    const tile = (re) => Array.from(doc.querySelectorAll("#svc-grid .svc-item")).find(n => re.test(n.textContent));
    const t8 = tile(/سوابق|record|Record/i) || doc.querySelectorAll("#svc-grid .svc-item")[7];
    if (t8) { t8.click(); await sleep(900); }
    console.log("[v2] service-record active =", active(), "rows =", doc.querySelectorAll("#svcrec-body tr").length);
    await goHome();
    if (homeBtn(/خدمت|SERVICE|服务/i)) { homeBtn(/خدمت|SERVICE|服务/i).click(); await sleep(900); }
    const t6 = tile(/تسویه|checkout|Check/i) || doc.querySelectorAll("#svc-grid .svc-item")[5];
    if (t6) { t6.click(); await sleep(600); }
    console.log("[v2] checkout confirm hidden =", doc.querySelector("#confirm-modal").hidden, "| title =", (doc.querySelector("#confirm-title") || {}).textContent);
    const cok = doc.querySelector("#confirm-ok");
    if (cok) { cok.click(); await sleep(900); }
    await goHome();
    if (homeBtn(/خدمت|SERVICE|服务/i)) { homeBtn(/خدمت|SERVICE|服务/i).click(); await sleep(900); }
    const t7 = tile(/تاکسی|taxi|Taxi/i) || doc.querySelectorAll("#svc-grid .svc-item")[6];
    if (t7) { t7.click(); await sleep(700); }
    console.log("[v2] taxi/wakeup active =", active(), "label =", (doc.querySelector("#wk-label") || {}).textContent);
    const wk = doc.querySelector("#wk-submit");
    if (wk) { wk.click(); await sleep(900); }
    console.log("[v2] after taxi submit active =", active());
    await goHome();

    // --- laundry uses the new GetClothingType endpoint
    if (homeBtn(/خدمت|SERVICE|服务/i)) { homeBtn(/خدمت|SERVICE|服务/i).click(); await sleep(900); }
    const t3 = tile(/لباس|laundry|wash/i) || doc.querySelectorAll("#svc-grid .svc-item")[2];
    if (t3) { t3.click(); await sleep(900); }
    console.log("[v2] laundry active =", active(), "title =", (doc.querySelector("#rent-title") || {}).textContent,
      "items =", doc.querySelectorAll("#rent-grid .food-item").length);
    await goHome();

  } else {
    console.log("[mode] hotel-platform flows skipped (residential deployment)");
    await goHome();
  }

  // --- record/EPG screen (GetRecTV + GetEpgRecProgram)
  const recBtn = homeBtn(/دوباره|REPLAY|RECORD|回看/i);
  if (recBtn) { recBtn.click(); await sleep(1000); }
  console.log("[v2] rec active =", active(), "channels =", doc.querySelectorAll("#rec-channels .rec-item").length);
  const rc = doc.querySelector("#rec-channels .rec-item");
  if (rc) { rc.click(); await sleep(1000); }
  console.log("[v2] rec dates =", doc.querySelectorAll("#rec-dates .rec-item").length, "progs =", doc.querySelectorAll("#rec-progs .rec-item").length);
  await goHome();
  console.log("[v2] final active screen =", active());

  /* ---- the gate itself: with no head-end the menu must refuse and say why
     (isConnectServer() -> Toast status_disconnected), and the boot screen must
     still leave after its 20 attempts instead of hanging. ---- */
  await goHome();
  const goodIp = ((await (await fetch(BASE + "/api/config")).json()).settings || {}).server_ip;
  console.log("\n[gate] pointing the client at an unreachable head-end (was " + goodIp + ")");
  await fetch(BASE + "/api/settings", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ server_ip: "10.255.255.1" }) });
  /* the frontend re-reads isConnected() every 5 s (BaseApplication's timer), so
     give it time to notice before probing the gate */
  await sleep(6500);
  let c2 = await (await fetch(BASE + "/api/connection")).json();
  console.log("[gate] connected =", c2.connected, "| settings_ok =", c2.settings_ok, "| last_error =", (c2.last_error || "").slice(0, 70));
  if (c2.connected) errors.push("the client still claims to be connected without a head-end");
  if (homeBtn(/زنده|LIVE|直播/i)) homeBtn(/زنده|LIVE|直播/i).click();
  let toastTxt = "";
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    const tn = doc.querySelector("#toast");
    if (tn && !tn.hidden && /سرور قطع شد|Disconnect Server/i.test(tn.textContent)) { toastTxt = tn.textContent; break; }
    if (active() !== "scr-home") break;
    toastTxt = (tn || {}).textContent || "";
  }
  console.log("[gate] after LIVE with no server: active =", active(), "| toast =", toastTxt,
    "| hidden =", (doc.querySelector("#toast") || {}).hidden);
  if (active() === "scr-player" || active() === "scr-livepkg") errors.push("live TV opened although BaseApplication.isConnected() is false");
  if (!/سرور قطع شد|Disconnect Server/i.test(toastTxt)) errors.push("isConnectServer() did not toast status_disconnected: " + toastTxt);
  /* PingServerActivity.onKeyDown(): leaving the boot screen by a key press must
     always produce a welcome payload, connected or not. */
  const skipped = await (await fetch(BASE + "/api/connection/skip", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: "{}" })).json();
  console.log("[gate] skip payload =", JSON.stringify(skipped.welcome));
  if (!skipped.welcome || !skipped.welcome.screen) errors.push("openWelcomeActivity() produced no screen while disconnected");
  /* and the handshake must recover as soon as the address is right again */
  await fetch(BASE + "/api/settings", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ server_ip: goodIp }) });
  for (let i = 0; i < 24; i++) {
    c2 = await (await fetch(BASE + "/api/connection")).json();
    if (c2.connected && c2.settings_ok && c2.welcome) break;
    await sleep(500);
  }
  console.log("[gate] after restoring " + goodIp + ": connected =", c2.connected, "| settings_ok =", c2.settings_ok,
    "| attempts =", c2.ping_times, "| welcome =", JSON.stringify(c2.welcome));
  if (!c2.connected || !c2.settings_ok) errors.push("the handshake did not recover after the address was restored");
  if (!c2.welcome) errors.push("no openWelcomeActivity() payload after reconnecting");

  console.log("\n=== ERRORS (" + errors.length + ") ===");
  errors.slice(0, 25).forEach(e => console.log(" *", e));
  process.exit(errors.length ? 1 : 0);
}
main().catch(e => { console.error("smoke crashed:", e); process.exit(2); });
