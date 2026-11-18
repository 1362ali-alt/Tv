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

  console.log("\n=== ERRORS (" + errors.length + ") ===");
  errors.slice(0, 25).forEach(e => console.log(" *", e));
  process.exit(errors.length ? 1 : 0);
}
main().catch(e => { console.error("smoke crashed:", e); process.exit(2); });
