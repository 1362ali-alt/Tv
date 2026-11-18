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
  const homeBtn = (re) => Array.from(doc.querySelectorAll("#home-menu .menu-item")).find(n => re.test(n.textContent));
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
  await sleep(2500);
  console.log("after boot, active screen =", active());
  console.log("boot msg =", (doc.querySelector("#boot-msg") || {}).textContent);

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

  // welcome background advertising (GetAdvImage type=1 slideshow / type=12 sign / bg music)
  if (active() === "scr-welcome") {
    await sleep(900);
    const ppt = doc.querySelector("#wel-ppt"), sign = doc.querySelector("#wel-sign"), mus = doc.querySelector("#bg-music");
    console.log("[v2] welcome ppt hidden =", ppt.hidden, "| src =", (ppt.src || "").slice(0, 90));
    console.log("[v2] welcome sign hidden =", sign.hidden, "| src =", (sign.src || "").slice(0, 90));
    console.log("[v2] welcome bg music src =", ((mus && mus.src) || "none").slice(0, 90));
    console.log("[v2] welcome background video hidden =", doc.querySelector("#wel-video").hidden);
    if (ppt.hidden) errors.push("welcome slideshow (GetAdvImage?type=1) is not showing");
    if (mode === "hotel" && sign.hidden) errors.push("manager signature (GetAdvImage?type=12) is not showing");
    if (mode !== "hotel" && !sign.hidden) errors.push("the hotel manager signature must not show in residential mode");
    if (!mus || !mus.src) errors.push("welcome background music (apk/getClientBackgroundMusics) not started");
  }

  // if welcome is showing, pick Persian
  if (active() === "scr-welcome") {
    const fa = doc.querySelector('#wel-langs .langbtn[data-lang="fa"]');
    if (fa) fa.click();
    await sleep(800);
  }
  console.log("after language, active =", active());
  const menu = Array.from(doc.querySelectorAll("#home-menu .menu-item")).map(n => n.textContent.trim());
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
    "#ad-countdown", "#side-list", "#wel-weather", "#home-wifi", "#home-weather"];
  let shown = [];
  overlays.forEach((sel) => {
    const n = doc.querySelector(sel);
    if (!n) { shown.push(sel + " (missing)"); return; }
    if (n.hasAttribute("hidden") && w.getComputedStyle(n).display !== "none") shown.push(sel);
  });
  console.log("[css] overlays painted while hidden =", shown.length ? JSON.stringify(shown) : "none");
  if (shown.length) errors.push("hidden overlays are still displayed: " + shown.join(", "));

  /* ============ deployment flavour: Pardik residential vs hotel platform ============ */
  if (mode === "residential") {
    const hotelOnly = /شام|غذا|خدمات|هتل|صورتحساب|CATERING|SERVICE|HOTEL/i;
    const leaked = menu.filter(m => hotelOnly.test(m));
    console.log("[mode] residential menu =", JSON.stringify(menu));
    if (leaked.length) errors.push("hotel tiles in the residential menu: " + leaked.join(", "));
    const brand = ((doc.querySelector("#home-title") || {}).textContent || "") + " | " +
                  ((doc.querySelector("#home-subtitle") || {}).textContent || "");
    console.log("[mode] branding =", brand);
    if (!/PARDIK/i.test(brand) || !/رونیکا پالاس/.test(brand)) errors.push("residential branding missing: " + brand);
    const unit = (doc.querySelector("#home-roomlabel") || {}).textContent || "";
    console.log("[mode] unit label =", unit, "| welcome =", (doc.querySelector("#wel-guest") || {}).textContent);
    if (!/واحد/.test(unit)) errors.push("the home bar still says room instead of unit: " + unit);
    if (/مهمان|میهمان/.test((doc.querySelector("#wel-guest") || {}).textContent || "")) errors.push("welcome still addresses hotel guests");
  } else {
    console.log("[mode] hotel platform menu =", JSON.stringify(menu));
    if (!menu.some(m => /خدمت|SERVICE/i.test(m))) errors.push("hotel mode lost the room-service tile");
  }

  // open LIVE
  const liveBtn = Array.from(doc.querySelectorAll("#home-menu .menu-item")).find(n => /زنده|LIVE/i.test(n.textContent));
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
  const vodBtn = Array.from(doc.querySelectorAll("#home-menu .menu-item")).find(n => /ویدئو|VOD/i.test(n.textContent));
  if (vodBtn) { vodBtn.click(); await sleep(1500); }
  console.log("after VOD, active =", active());
  const types = Array.from(doc.querySelectorAll("#vod-types .type-item")).map(n => n.textContent.trim());
  const posters = doc.querySelectorAll("#vod-grid .poster").length;
  console.log("vod types =", JSON.stringify(types), "posters =", posters);
  const poster = doc.querySelector("#vod-grid .poster");
  if (poster) { poster.click(); await sleep(600); }
  console.log("vod detail hidden =", doc.querySelector("#vod-detail").hidden, "title =", (doc.querySelector("#vd-title") || {}).textContent);

  // settings gate
  for (let i = 0; i < 4; i++) { doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(300); }
  const setBtn = Array.from(doc.querySelectorAll("#home-menu .menu-item")).find(n => /تنظیمات/i.test(n.textContent));
  if (setBtn) { setBtn.click(); await sleep(600); }
  console.log("settings active =", active(), "gate shown =", doc.querySelector("#set-gate").style.display);
  const gp = doc.querySelector("#gate-pass");
  if (gp) { gp.value = "111999"; doc.querySelector("#gate-ok").click(); await sleep(500); }
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
  if (homeBtn(/تنظیمات/i)) { homeBtn(/تنظیمات/i).click(); await sleep(600); }
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
  if (homeBtn(/تنظیمات/i)) { homeBtn(/تنظیمات/i).click(); await sleep(600); }
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
    if (!/10/.test(rowVal)) errors.push("the playlist was not parsed: " + rowVal);
    await goHome();
    const lb = homeBtn(/زنده|LIVE/i);
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
    if (homeBtn(/تنظیمات/i)) { homeBtn(/تنظیمات/i).click(); await sleep(600); }
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
  const liveBtn2 = homeBtn(/زنده|LIVE/i);
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
    const dinnerBtn = homeBtn(/شام|CATERING|DINNER/i);
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
    const svcBtn = homeBtn(/خدمت|SERVICE/i);
    if (svcBtn) { svcBtn.click(); await sleep(900); }
    console.log("[v2] service active =", active(), "tiles =", doc.querySelectorAll("#svc-grid .svc-item").length);
    const tile = (re) => Array.from(doc.querySelectorAll("#svc-grid .svc-item")).find(n => re.test(n.textContent));
    const t8 = tile(/سوابق|record|Record/i) || doc.querySelectorAll("#svc-grid .svc-item")[7];
    if (t8) { t8.click(); await sleep(900); }
    console.log("[v2] service-record active =", active(), "rows =", doc.querySelectorAll("#svcrec-body tr").length);
    await goHome();
    if (homeBtn(/خدمت|SERVICE/i)) { homeBtn(/خدمت|SERVICE/i).click(); await sleep(900); }
    const t6 = tile(/تسویه|checkout|Check/i) || doc.querySelectorAll("#svc-grid .svc-item")[5];
    if (t6) { t6.click(); await sleep(600); }
    console.log("[v2] checkout confirm hidden =", doc.querySelector("#confirm-modal").hidden, "| title =", (doc.querySelector("#confirm-title") || {}).textContent);
    const cok = doc.querySelector("#confirm-ok");
    if (cok) { cok.click(); await sleep(900); }
    await goHome();
    if (homeBtn(/خدمت|SERVICE/i)) { homeBtn(/خدمت|SERVICE/i).click(); await sleep(900); }
    const t7 = tile(/تاکسی|taxi|Taxi/i) || doc.querySelectorAll("#svc-grid .svc-item")[6];
    if (t7) { t7.click(); await sleep(700); }
    console.log("[v2] taxi/wakeup active =", active(), "label =", (doc.querySelector("#wk-label") || {}).textContent);
    const wk = doc.querySelector("#wk-submit");
    if (wk) { wk.click(); await sleep(900); }
    console.log("[v2] after taxi submit active =", active());
    await goHome();

    // --- laundry uses the new GetClothingType endpoint
    if (homeBtn(/خدمت|SERVICE/i)) { homeBtn(/خدمت|SERVICE/i).click(); await sleep(900); }
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
  const recBtn = homeBtn(/دوباره|REPLAY|RECORD/i);
  if (recBtn) { recBtn.click(); await sleep(1000); }
  console.log("[v2] rec active =", active(), "channels =", doc.querySelectorAll("#rec-channels .rec-item").length);
  const rc = doc.querySelector("#rec-channels .rec-item");
  if (rc) { rc.click(); await sleep(1000); }
  console.log("[v2] rec dates =", doc.querySelectorAll("#rec-dates .rec-item").length, "progs =", doc.querySelectorAll("#rec-progs .rec-item").length);
  await goHome();
  console.log("[v2] final active screen =", active());

  console.log("\n=== ERRORS (" + errors.length + ") ===");
  errors.slice(0, 25).forEach(e => console.log(" *", e));
  process.exit(errors.length ? 1 : 0);
}
main().catch(e => { console.error("smoke crashed:", e); process.exit(2); });
