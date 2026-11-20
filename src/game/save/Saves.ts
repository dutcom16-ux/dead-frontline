// Save slots on this device (IndexedDB → localStorage → memory fallback, see engine/storage.js).
// @ts-ignore engine is plain JS
import { SaveStore } from "../../engine/storage.js";
import type { CampaignState } from "../campaign/Campaign";

export const SLOTS = ["auto", "1", "2", "3"] as const;
export type Slot = (typeof SLOTS)[number];
export interface SlotInfo { slot: Slot; empty: boolean; updated?: number; label?: string; detail?: string }

export class Saves {
  store: any = null;
  async open() { this.store = await SaveStore.open(); return this; }
  get kind(): string { return this.store ? this.store.kind : "memory"; }
  describe(): string { return this.store ? this.store.describe() : "Saves unavailable"; }
  async put(slot: Slot, c: CampaignState) { c.updated = Date.now(); await this.store.put("campaign:" + slot, c); }
  async get(slot: Slot): Promise<CampaignState | null> { try { return (await this.store.get("campaign:" + slot)) || null; } catch (e) { return null; } }
  async del(slot: Slot) { await this.store.del("campaign:" + slot); }
  async list(): Promise<SlotInfo[]> {
    const out: SlotInfo[] = [];
    for (const s of SLOTS) {
      const c = await this.get(s);
      if (!c) { out.push({ slot: s, empty: true }); continue; }
      const m = c.mission;
      const done = Object.values(c.ops).filter((v) => v === "complete").length;
      out.push({ slot: s, empty: false, updated: c.updated, label: `${c.name} · ${c.difficulty}`,
        detail: m ? `In mission: ${m.missionName || "Retake Toledo City"} · ${Math.floor((m.time || 0) / 60)} min` : `${done} operation${done === 1 ? "" : "s"} complete${c.fob ? " · FOB established" : ""}` });
    }
    return out;
  }
}
