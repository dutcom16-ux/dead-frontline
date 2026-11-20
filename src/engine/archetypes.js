// Philippine building archetype library. Each archetype is a parameter set that the mesh
// generator applies to a REAL footprint; the archetype never moves or reshapes a building.
// ground / front / upper: facade tiles (front = the entrance wall's ground floor).
import { T } from "./atlas.js";

const base = {
  module: 3.0, ground: T.jalousie, front: T.jalousie, upper: T.jalousie, door: T.door_wood,
  doorW: 0.9, doorH: 2.1, roofTile: T.roof_gi, overhang: 0.45, raised: 0, details: [],
};
const A = (o) => ({ ...base, ...o });

export const ARCH = {
  concrete_house_1f: A({ ground: T.grille, front: T.grille, upper: T.grille, details: ["tank?"] }),
  concrete_house_2f: A({ ground: T.grille, front: T.grille, upper: T.jalousie, details: ["tank?"] }),
  light_material_house: A({ ground: T.wood, front: T.wood, upper: T.sawali, roofTile: T.roof_nipa, overhang: 0.7,
    raised: 0.9, module: 2.5, door: T.door_wood, details: ["stilts"] }),
  heritage_house: A({ ground: T.stone, front: T.stone, upper: T.capiz, roofTile: T.roof_tile, overhang: 0.8, module: 2.6 }),
  apartment_block: A({ ground: T.aluminium, front: T.grille, upper: T.balcony, door: T.door_gate, doorW: 1.2, details: ["tank?"] }),
  sari_sari_store: A({ ground: T.grille, front: T.shutter, upper: T.grille, door: T.door_gate, doorW: 1.0, details: ["awning"] }),
  shophouse: A({ ground: T.shutter, front: T.shutter, upper: T.aluminium, door: T.door_gate, doorW: 1.2, details: ["awning", "sign"] }),
  shop_commercial: A({ ground: T.shopfront, front: T.shopfront, upper: T.aluminium, door: T.door_glass, doorW: 1.8, doorH: 2.4, details: ["awning", "sign"] }),
  commercial_block: A({ ground: T.shopfront, front: T.shopfront, upper: T.aluminium, door: T.door_glass, doorW: 2.0, doorH: 2.5, details: ["sign"] }),
  school_block: A({ ground: T.school, front: T.school, upper: T.school, door: T.door_wood, doorW: 1.2, doorH: 2.3, module: 3.5, overhang: 1.2 }),
  college_block: A({ ground: T.civic, front: T.civic, upper: T.school, door: T.door_glass, doorW: 2.0, doorH: 2.6, module: 3.5 }),
  church: A({ ground: T.church, front: T.church, upper: T.church, door: T.door_wood, doorW: 2.4, doorH: 3.6, module: 4.0, roofTile: T.roof_gi, overhang: 0.6 }),
  chapel: A({ ground: T.church, front: T.church, upper: T.church, door: T.door_wood, doorW: 1.8, doorH: 2.8, module: 3.5 }),
  hospital_block: A({ ground: T.civic, front: T.civic, upper: T.aluminium, door: T.door_glass, doorW: 2.0, doorH: 2.5, details: ["cross"] }),
  government_hall: A({ ground: T.civic, front: T.civic, upper: T.civic, door: T.door_glass, doorW: 2.0, doorH: 2.8, module: 3.5 }),
  industrial_plant: A({ ground: T.industrial, front: T.industrial, upper: T.industrial, door: T.garage, doorW: 4.0, doorH: 4.0, module: 6.0, overhang: 0.3 }),
  warehouse: A({ ground: T.corrugated, front: T.corrugated, upper: T.corrugated, door: T.garage, doorW: 4.0, doorH: 4.0, module: 6.0, overhang: 0.4 }),
  port_shed: A({ ground: T.corrugated, front: T.corrugated, upper: T.corrugated, door: T.garage, doorW: 5.0, doorH: 4.5, module: 6.0 }),
  market_hall: A({ ground: T.open_bay, front: T.open_bay, upper: T.louvre_vent, door: T.doorway, doorW: 3.0, doorH: 3.2, module: 4.5, overhang: 1.0 }),
  // covered court / gym: CHB walls, louvred upper band for air, big GI roof (rows = facade bands drawn)
  sports_hall: A({ ground: T.plain, front: T.civic, upper: T.louvre_vent, door: T.garage, doorW: 3.6, doorH: 3.4, module: 5.0,
    overhang: 0.9, rows: 2 }),
  utility_shed: A({ ground: T.corrugated, front: T.corrugated, upper: T.corrugated, door: T.door_gate, module: 3.0 }),
  canopy: A({ ground: T.plain, front: T.plain, upper: T.plain, details: ["posts"] }),
  construction_site: A({ ground: T.plain, front: T.plain, upper: T.plain, roofTile: T.roof_concrete, details: [] }),
  ruin: A({ ground: T.stone, front: T.stone, upper: T.stone, roofTile: T.roof_concrete }),
  // ---- landmarks: individually parameterised models. Architectural details are estimated and
  // must be checked against permitted references; placement and footprint are always OSM's.
  landmark_city_hall: A({ ground: T.civic, front: T.civic, upper: T.civic, door: T.door_glass, doorW: 2.6, doorH: 3.0, module: 3.5,
    details: ["portico", "flagpole"] }),
  landmark_church: A({ ground: T.church, front: T.church, upper: T.church, door: T.door_wood, doorW: 3.0, doorH: 4.2, module: 4.5,
    details: ["belltower", "facade"] }),
  landmark_market: A({ ground: T.open_bay, front: T.open_bay, upper: T.louvre_vent, door: T.doorway, doorW: 4.0, doorH: 3.5, module: 4.5,
    overhang: 1.4, details: ["sign"] }),
  landmark_hospital: A({ ground: T.civic, front: T.civic, upper: T.aluminium, door: T.door_glass, doorW: 2.4, doorH: 2.8, details: ["cross", "canopy_front"] }),
  landmark_college: A({ ground: T.civic, front: T.civic, upper: T.school, door: T.door_glass, doorW: 2.4, doorH: 2.8, module: 3.5, details: ["sign", "flagpole"] }),
  landmark_port: A({ ground: T.corrugated, front: T.corrugated, upper: T.corrugated, door: T.garage, doorW: 6.0, doorH: 5.0, module: 6.0 }),
  landmark_power_plant: A({ ground: T.industrial, front: T.industrial, upper: T.industrial, door: T.garage, doorW: 5.0, doorH: 5.0, module: 6.0,
    details: ["stacks"] }),
  landmark_mine: A({ ground: T.industrial, front: T.industrial, upper: T.industrial, door: T.garage, doorW: 5.0, doorH: 5.0, module: 6.0 }),
};

export const ARCH_LABEL = {
  concrete_house_1f: "Concrete house, 1 storey", concrete_house_2f: "Concrete house, 2 storeys",
  light_material_house: "Traditional light-material house", heritage_house: "Bahay na bato (heritage)",
  apartment_block: "Apartment / boarding house", sari_sari_store: "House with sari-sari store",
  shophouse: "Shophouse (shop + residence)", shop_commercial: "Commercial shop", commercial_block: "Commercial block",
  school_block: "School block", college_block: "College building", church: "Church", chapel: "Chapel",
  hospital_block: "Hospital / clinic", government_hall: "Government hall", industrial_plant: "Industrial building",
  warehouse: "Warehouse", port_shed: "Port shed", market_hall: "Market hall", utility_shed: "Shed / utility",
  sports_hall: "Sports hall / gymnasium", canopy: "Canopy (roof on posts)", construction_site: "Under construction", ruin: "Ruin",
  landmark_city_hall: "Landmark: city hall model", landmark_church: "Landmark: parish church model",
  landmark_market: "Landmark: public market model", landmark_hospital: "Landmark: hospital model",
  landmark_college: "Landmark: college model", landmark_port: "Landmark: port model",
  landmark_power_plant: "Landmark: power plant model", landmark_mine: "Landmark: mine model",
};

export const CATEGORY_COLOR = {
  residential: "#e3b778", apartment: "#d99a5b", mixed: "#e8806b", commercial: "#e0605a", school: "#6aa9e8",
  university: "#4b7fd6", church: "#b48ad8", hospital: "#ec5f9b", government: "#4fbfa6", industrial: "#9a8f86",
  warehouse: "#8c8c9c", port: "#5f8fa8", market: "#f0a030", utility: "#b8b0a0", canopy: "#cfc6b0",
  sports: "#38d9a9", construction: "#c8c060", ruins: "#857a70", unknown: "#c9c1b4",
};
