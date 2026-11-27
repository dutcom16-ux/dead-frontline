// Installable web app: service worker registration, "offline ready" status, install prompt.
// The service worker (sw.js, written by tools/build.mjs) precaches every game file, so after the
// first visit over HTTPS the game starts with no connection. Same-origin only: no third parties.
export class PWA {
  constructor(onChange, onUpdate) {
    this.onChange = onChange || (() => {});
    this.onUpdate = onUpdate || (() => {});   // a new version has taken over this page
    this.state = { offline: "checking", progress: 0, installed: false, canInstall: false, update: false, brave: false, standalone: false };
    this.deferred = null;
  }
  set(patch) { Object.assign(this.state, patch); this.onChange(this.state); }

  async start() {
    try { this.state.brave = !!(navigator.brave && (await navigator.brave.isBrave())); } catch (e) { /* not Brave */ }
    const standalone = matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches || navigator.standalone === true;
    this.set({ standalone, installed: standalone });
    addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); this.deferred = e; this.set({ canInstall: true }); });
    addEventListener("appinstalled", () => { this.deferred = null; this.set({ installed: true, canInstall: false }); });
    if (location.protocol === "file:") return this.set({ offline: "file" });
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return this.set({ offline: "unsupported" });
    navigator.serviceWorker.addEventListener("message", (ev) => {
      const d = ev.data || {};
      if (d.type === "progress") this.set({ offline: this.state.offline === "updating" ? "updating" : "downloading", progress: d.total ? d.done / d.total : 0 });
      if (d.type === "ready") this.check(); // confirm against the cache itself
      if (d.type === "error") this.set({ offline: "error", error: d.message });
    });
    // a new version took control (it activates as soon as it has downloaded): reload into it
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || this.state.update) return;          // first install: nothing to reload
      this.set({ update: true });
      this.onUpdate();
    });
    try {
      const reg = await navigator.serviceWorker.register("sw.js", { scope: "./" });
      // look for a new version now and whenever the game comes back to the foreground
      reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
      setInterval(() => reg.update().catch(() => {}), 10 * 60 * 1000);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        if (!w || !navigator.serviceWorker.controller) return;
        this.set({ offline: "updating", progress: 0 });
      });
      // a version left waiting by an older service worker: let it take over now
      if (reg.waiting && navigator.serviceWorker.controller) reg.waiting.postMessage({ type: "skipWaiting" });
      await navigator.serviceWorker.ready;
      await this.check();
    } catch (e) {
      this.set({ offline: "error", error: e.message });
    }
  }
  // every file in the precache list is in the cache -> the game can start offline
  async check() {
    try {
      const r = await fetch("asset-list.json", { cache: "no-store" }).catch(() => null) || await caches.match("asset-list.json");
      const list = await r.json();
      const cache = await caches.open(list.cache);
      let n = 0;
      for (const a of list.assets) if (await cache.match(a)) n++;
      this.assets = list;
      this.set({ offline: n === list.assets.length ? "ready" : "downloading", progress: n / list.assets.length, version: list.version });
      return n === list.assets.length;
    } catch (e) {
      this.set({ offline: "error", error: "cannot read the cache: " + e.message });
      return false;
    }
  }
  async install() {
    if (!this.deferred) return false;
    this.deferred.prompt();
    const choice = await this.deferred.userChoice.catch(() => null);
    this.deferred = null;
    this.set({ canInstall: false, installed: choice && choice.outcome === "accepted" });
    return this.state.installed;
  }
  applyUpdate() {
    navigator.serviceWorker.getRegistration().then((reg) => { if (reg && reg.waiting) reg.waiting.postMessage({ type: "skipWaiting" }); });
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
  }
  describe() {
    const s = this.state;
    switch (s.offline) {
      case "ready": return "Offline ready: every game file is stored on this device" + (s.version ? ` · build ${s.version.slice(0, 7)}` : "");
      case "updating": return `Downloading the new version… ${Math.round(s.progress * 100)}%`;
      case "downloading": return `Downloading for offline play… ${Math.round(s.progress * 100)}%`;
      case "file": return "Opened as a file: plays offline, but cannot be installed (use the HTTPS link to install)";
      case "unsupported": return "Offline install not available here (needs HTTPS and service workers)";
      case "error": return "Offline caching failed: " + (s.error || "unknown error");
      default: return "Checking offline status…";
    }
  }
  installHint() {
    const s = this.state;
    if (s.installed) return "Installed as an app";
    if (s.canInstall) return "";
    if (/Android/i.test(navigator.userAgent)) return s.brave ? "To install: Brave menu ⋮ → Install app (or Add to Home screen)" : "To install: browser menu ⋮ → Install app / Add to Home screen";
    if (/Firefox/i.test(navigator.userAgent)) return "Firefox desktop cannot install web apps; it still plays and saves offline after the first visit";
    return s.brave ? "To install: Brave menu → Install app (icon in the address bar)" : "To install: browser menu → Install app";
  }
}
