// Persistent campaign: operations unlocked, territory colours, the single FOB, veteran roster.
import { CAMPAIGN } from "../data";
import type { Difficulty } from "../Game";

export type Territory = "red" | "yellow" | "green" | "blue";
export type OpStatus = "locked" | "available" | "in_progress" | "complete";
export interface CampaignState {
  version: 1; name: string; created: number; updated: number; difficulty: Difficulty;
  ops: Record<string, OpStatus>; territory: Record<string, Territory>;
  fob: { op: string; x: number; y: number; rot: number; lat: number; lon: number; facilities: number } | null;
  roster: { type: string; name: string; kills: number; rank: number }[];
  totals: { kills: number; lost: number; rescued: number; missions: number; playTime: number };
  flags: string[];
  mission: any | null; // live mission snapshot when saved mid-mission
  lastDebrief?: any;
}
export function newCampaign(difficulty: Difficulty): CampaignState {
  const ops: Record<string, OpStatus> = {}, territory: Record<string, Territory> = {};
  for (const ph of CAMPAIGN.phases) for (const o of ph.operations) { ops[o.id] = o.status === "available" ? "available" : "locked"; territory[o.id] = "red"; }
  return { version: 1, name: "Operation Reclamation", created: Date.now(), updated: Date.now(), difficulty, ops, territory, fob: null, roster: [], totals: { kills: 0, lost: 0, rescued: 0, missions: 0, playTime: 0 }, flags: [], mission: null };
}
/** operations whose mission content exists in this build */
export const PLAYABLE = new Set(["op01"]);
export function completeOp(c: CampaignState, id: string) {
  c.ops[id] = "complete";
  for (const ph of CAMPAIGN.phases) for (const o of ph.operations) if (o.requires === id && c.ops[o.id] === "locked") c.ops[o.id] = "available";
}
export function phaseOf(id: string) { return CAMPAIGN.phases.find((p) => p.operations.some((o) => o.id === id)); }
