// Typed access to the JSON game definitions in /data (bundled at build time).
import infantry from "../../data/units/infantry.json";
import vehicles from "../../data/units/vehicles.json";
import weapons from "../../data/units/weapons.json";
import zombies from "../../data/zombies/zombies.json";
import structures from "../../data/structures/structures.json";
import supplies from "../../data/supplies/supplies.json";
import campaign from "../../data/campaign/philippines.json";
import op01 from "../../data/missions/op01.json";

export type C3 = [number, number, number];
export interface WeaponDef {
  name: string; damage: number; range: number; interval: number; mag: number; reserve: number; reload: number;
  accuracy: number; noise: number; sound: string; pellets?: number; cone?: number; pierce?: number; suppress?: number;
  ignite?: { dps: number; time: number }; projectile?: { speed: number; radius: number }; minRange?: number;
}
export interface UnitDef {
  name: string; hp: number; armor: number; speed: number; sight: number; weapon: string | null; color: C3;
  suppressionResist?: number; role?: string; heal?: { rate: number; radius: number; kits: number }; build?: { speed: number; clear: number };
  capacity?: number; size?: [number, number, number]; crush?: number; cargo?: boolean; repair?: number;
}
export interface ZombieDef {
  name: string; hp: number; armor: number; speed: number; run: number; attack: [number, number]; sight: number; hearing: number;
  size: number; weight: number; color: C3; lowProfile?: number; doorBreaker?: number; knockback?: number; infect?: number;
  explode?: { radius: number; damage: number }; scream?: { radius: number; cooldown: number }; leap?: number; slam?: { radius: number }; boss?: boolean;
}
export interface StructureDef {
  name: string; fob?: boolean; deploy?: boolean; size?: [number, number]; height?: number; model?: string; roof?: string; color?: C3;
  enter?: boolean; build?: number; cover?: boolean; slow?: number; dps?: number; turret?: string; gate?: boolean; light?: number;
  vision?: number; wall?: boolean; heal?: number; resupply?: boolean; repair?: number; spawn?: boolean; antenna?: boolean;
}
export interface SupplyDef {
  category: string; name: string; stock: number; delivery: number; cooldown: number; via: "air" | "land" | "sea"; requires?: string;
  crate?: { ammo?: number; medical?: number; heal?: number }; units?: string[]; vehicle?: string; deploy?: Record<string, number>;
  engineering?: { clear: number; repair: number }; unlocks?: string[]; strike?: { radius: number; damage: number; shells: number; line?: boolean }; note?: string;
}
const strip = <T>(o: any): Record<string, T> => { const r: any = {}; for (const k in o) if (!k.startsWith("_")) r[k] = o[k]; return r; };

export const INFANTRY = strip<UnitDef>(infantry);
export const VEHICLES = strip<UnitDef>(vehicles);
export const WEAPONS = strip<WeaponDef>(weapons);
export const ZOMBIES = strip<ZombieDef>(zombies);
export const STRUCTURES = strip<StructureDef>(structures);
export const SUPPLIES = strip<SupplyDef>(supplies);
export const CAMPAIGN = campaign as unknown as { phases: { id: string; name: string; operations: { id: string; name: string; pos: [number, number]; status: string; requires?: string; mission?: string }[] }[] };
export const OP01 = op01 as any;
export const unitDef = (type: string): UnitDef => INFANTRY[type] || VEHICLES[type];
export const isVehicleType = (type: string) => !!VEHICLES[type];

export const RANKS = ["Pvt.", "Pfc.", "Cpl.", "Sgt."];
export const SURNAMES = ["Santos", "Reyes", "Cruz", "Bautista", "Ocampo", "Garcia", "Mendoza", "Torres", "Flores", "Villanueva", "Ramos", "Aquino",
  "Castillo", "Dela Cruz", "Navarro", "Gonzales", "Lim", "Tan", "Abad", "Cabrera", "Domingo", "Pascual", "Salazar", "Rosales", "Mercado", "Manalo",
  "Soriano", "Alcantara", "Panganiban", "Macaraeg", "Lagman", "Dizon", "Yap", "Sison", "Tolentino", "Magbanua"];
