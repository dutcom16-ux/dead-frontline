// Campaign saves on this device. IndexedDB first; if a browser blocks it (Brave Shields / strict
// privacy settings, some private windows, file:// in Firefox) fall back to localStorage, then to
// memory only, and say so in the menu instead of failing. No cookies, nothing leaves the device.
const DB = "deadfrontline", STORE = "saves";

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB not available"));
    let req;
    try { req = indexedDB.open(DB, 1); } catch (e) { return reject(e); }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
    setTimeout(() => reject(new Error("IndexedDB timed out")), 4000);
  });
}
const tx = (db, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
  const r = fn(s);
  t.oncomplete = () => resolve(r && "result" in r ? r.result : undefined);
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error || new Error("transaction aborted"));
});

export class SaveStore {
  static async open() {
    const s = new SaveStore();
    try {
      s.db = await idbOpen();
      await tx(s.db, "readwrite", (st) => st.put({ t: Date.now() }, "__probe__")); // writes really work?
      s.kind = "indexeddb";
    } catch (e) {
      s.db = null;
      s.error = e.message;
      try {
        localStorage.setItem("df-probe", "1"); localStorage.removeItem("df-probe");
        s.kind = "localstorage";
      } catch (e2) { s.kind = "memory"; s.mem = new Map(); }
    }
    // ask the browser not to evict saves under storage pressure (granted silently for installed apps)
    try { s.persisted = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (e) { s.persisted = false; }
    return s;
  }
  get durable() { return this.kind !== "memory"; }
  describe() {
    if (this.kind === "indexeddb") return "Saves are stored on this device (IndexedDB)" + (this.persisted ? ", protected from clean-up" : "");
    if (this.kind === "localstorage") return "Saves use backup storage (IndexedDB blocked: " + (this.error || "unknown") + ")";
    return "Saves last only until you close this tab: this browser blocks storage here (private window or strict privacy settings)";
  }
  async get(key) {
    if (this.kind === "indexeddb") return tx(this.db, "readonly", (st) => st.get(key));
    if (this.kind === "localstorage") { const v = localStorage.getItem("df-save:" + key); return v ? JSON.parse(v) : undefined; }
    return this.mem.get(key);
  }
  async put(key, value) {
    value = JSON.parse(JSON.stringify(value)); // plain data only
    if (this.kind === "indexeddb") return tx(this.db, "readwrite", (st) => st.put(value, key));
    if (this.kind === "localstorage") return localStorage.setItem("df-save:" + key, JSON.stringify(value));
    this.mem.set(key, value);
  }
  async del(key) {
    if (this.kind === "indexeddb") return tx(this.db, "readwrite", (st) => st.delete(key));
    if (this.kind === "localstorage") return localStorage.removeItem("df-save:" + key);
    this.mem.delete(key);
  }
}
