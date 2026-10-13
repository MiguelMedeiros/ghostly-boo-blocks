/**
 * The kinds of block. A block id is one byte, kept in the world and sent to the contact: an id never changes meaning,
 * and a new kind gets a new id (an older Boo Blocks shows an id it does not know as air and keeps it as it is).
 */

export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const COBBLE = 4;
export const SAND = 5;
export const LOG = 6;
export const PLANKS = 7;
export const LEAVES = 8;
export const GLASS = 9;
export const BRICK = 10;
export const SNOW = 11;
export const WATER = 12;
export const LANTERN = 13;
export const CLAY = 14;
export const BEDROCK = 15;

/** How a block is drawn and how it behaves. */
export interface BlockKind {
  id: number;
  /** A key into the strings (the block's name in the hotbar). */
  key: "grass" | "dirt" | "stone" | "cobble" | "sand" | "log" | "planks" | "leaves" | "glass" | "brick" | "snow" | "water" | "lantern" | "clay" | "bedrock";
  /** Atlas tiles: top, sides, bottom. */
  tiles: [number, number, number];
  /** The player cannot walk through it. */
  solid: boolean;
  /** "opaque" hides the faces next to it; "cutout" is drawn with holes (leaves, glass); "liquid" is drawn see-through, last. */
  draw: "opaque" | "cutout" | "liquid";
  /** Which sound it makes when broken or placed. */
  sound: "stone" | "wood" | "soft" | "glass" | "sand" | "water";
  /** Gives off light (drawn at full brightness). */
  glow?: boolean;
  /** Cannot be broken (the world's floor). */
  fixed?: boolean;
}

/** Atlas tiles, in the order src/render/atlas.ts draws them. */
export const TILE = {
  grassTop: 0,
  grassSide: 1,
  dirt: 2,
  stone: 3,
  cobble: 4,
  sand: 5,
  logSide: 6,
  logTop: 7,
  planks: 8,
  leaves: 9,
  glass: 10,
  brick: 11,
  snow: 12,
  snowSide: 13,
  water: 14,
  lantern: 15,
  clay: 16,
  bedrock: 17,
  ghostFace: 18,
  ghostBody: 19,
} as const;
export const TILE_COUNT = 20;

const kinds: BlockKind[] = [
  { id: GRASS, key: "grass", tiles: [TILE.grassTop, TILE.grassSide, TILE.dirt], solid: true, draw: "opaque", sound: "soft" },
  { id: DIRT, key: "dirt", tiles: [TILE.dirt, TILE.dirt, TILE.dirt], solid: true, draw: "opaque", sound: "soft" },
  { id: STONE, key: "stone", tiles: [TILE.stone, TILE.stone, TILE.stone], solid: true, draw: "opaque", sound: "stone" },
  { id: COBBLE, key: "cobble", tiles: [TILE.cobble, TILE.cobble, TILE.cobble], solid: true, draw: "opaque", sound: "stone" },
  { id: SAND, key: "sand", tiles: [TILE.sand, TILE.sand, TILE.sand], solid: true, draw: "opaque", sound: "sand" },
  { id: LOG, key: "log", tiles: [TILE.logTop, TILE.logSide, TILE.logTop], solid: true, draw: "opaque", sound: "wood" },
  { id: PLANKS, key: "planks", tiles: [TILE.planks, TILE.planks, TILE.planks], solid: true, draw: "opaque", sound: "wood" },
  { id: LEAVES, key: "leaves", tiles: [TILE.leaves, TILE.leaves, TILE.leaves], solid: true, draw: "cutout", sound: "soft" },
  { id: GLASS, key: "glass", tiles: [TILE.glass, TILE.glass, TILE.glass], solid: true, draw: "cutout", sound: "glass" },
  { id: BRICK, key: "brick", tiles: [TILE.brick, TILE.brick, TILE.brick], solid: true, draw: "opaque", sound: "stone" },
  { id: SNOW, key: "snow", tiles: [TILE.snow, TILE.snowSide, TILE.dirt], solid: true, draw: "opaque", sound: "soft" },
  { id: WATER, key: "water", tiles: [TILE.water, TILE.water, TILE.water], solid: false, draw: "liquid", sound: "water" },
  { id: LANTERN, key: "lantern", tiles: [TILE.lantern, TILE.lantern, TILE.lantern], solid: true, draw: "opaque", sound: "glass", glow: true },
  { id: CLAY, key: "clay", tiles: [TILE.clay, TILE.clay, TILE.clay], solid: true, draw: "opaque", sound: "soft" },
  { id: BEDROCK, key: "bedrock", tiles: [TILE.bedrock, TILE.bedrock, TILE.bedrock], solid: true, draw: "opaque", sound: "stone", fixed: true },
];

/** Every kind, by id; undefined for air and for an id this version does not know. */
export const BLOCKS: (BlockKind | undefined)[] = [];
for (const kind of kinds) BLOCKS[kind.id] = kind;

/** The highest block id this version knows. */
export const MAX_BLOCK = Math.max(...kinds.map((k) => k.id));

/** The blocks a person can place, in the hotbar's order (keys 1 to 9, then 0, -, =). */
export const PALETTE = [GRASS, DIRT, STONE, COBBLE, PLANKS, LOG, BRICK, GLASS, LEAVES, SAND, SNOW, LANTERN, CLAY, WATER];

export const isSolid = (id: number): boolean => BLOCKS[id]?.solid ?? false;
/** Hides the face of a block next to it. */
export const isOpaque = (id: number): boolean => BLOCKS[id]?.draw === "opaque";
/** A block id the world may hold: one byte. Ids this version does not know are kept and shown as air. */
export const isBlockId = (id: unknown): id is number => Number.isInteger(id) && (id as number) >= 0 && (id as number) <= 255;
