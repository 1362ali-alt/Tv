/* Headless smoke test of the PARDIK IPTV web UI against a running backend. */
const { JSDOM } = require("jsdom");

const BASE = process.env.BASE || "http://127.0.0.1:8787";
const errors = [];
const logs = [];

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: BASE + "/" });

async function main() {
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
      console.log("[v2] after skip: overlay hidden =", adBox().hidden, "| src =", (doc.querySelector("#video").currentSrc || doc.querySelector("#video").src || "").slice(0, 90));
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

  // if welcome is showing, pick Persian
  if (active() === "scr-welcome") {
    const fa = doc.querySelector('#wel-langs .langbtn[data-lang="fa"]');
    if (fa) fa.click();
    await sleep(800);
  }
  console.log("after language, active =", active());
  const menu = Array.from(doc.querySelectorAll("#home-menu .menu-item")).map(n => n.textContent.trim());
  console.log("menu items =", JSON.stringify(menu));

  // open LIVE
  const liveBtn = Array.from(doc.querySelectorAll("#home-menu .menu-item")).find(n => /زنده|LIVE/i.test(n.textContent));
  if (liveBtn) { liveBtn.click(); await sleep(1500); }
  console.log("after LIVE click, active =", active());
  const pkgs = Array.from(doc.querySelectorAll("#pkg-list .pkg-item")).map(n => n.textContent.trim());
  console.log("packages =", JSON.stringify(pkgs));
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

  // --- EPG + speed inside the live player
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
