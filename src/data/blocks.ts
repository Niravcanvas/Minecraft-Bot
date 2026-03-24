// ─── Block group constants ─────────────────────────────────────────────────

export const WOOD_BLOCKS = [
  'oak_log','birch_log','spruce_log','jungle_log',
  'acacia_log','dark_oak_log','mangrove_log','cherry_log',
];

export const STONE_BLOCKS = [
  'stone','cobblestone','andesite','granite','diorite','tuff','deepslate','calcite',
];

export const ORE_BLOCKS = [
  'coal_ore',      'iron_ore',      'copper_ore',   'gold_ore',
  'diamond_ore',   'emerald_ore',   'lapis_ore',    'redstone_ore',
  'deepslate_coal_ore',    'deepslate_iron_ore',    'deepslate_copper_ore',
  'deepslate_gold_ore',    'deepslate_diamond_ore', 'deepslate_emerald_ore',
  'deepslate_lapis_ore',   'deepslate_redstone_ore',
];

export const SAND_BLOCKS  = ['sand', 'red_sand', 'gravel'];

export const PLANT_BLOCKS = [
  'wheat','carrots','potatoes','beetroots',
  'sugar_cane','bamboo','kelp','melon','pumpkin',
];

export const BED_BLOCKS = [
  'white_bed','orange_bed','magenta_bed','light_blue_bed','yellow_bed',
  'lime_bed','pink_bed','gray_bed','light_gray_bed','cyan_bed',
  'purple_bed','blue_bed','brown_bed','green_bed','red_bed','black_bed',
];

export const HOSTILE_MOBS = [
  'zombie','skeleton','creeper','spider','cave_spider','enderman',
  'witch','slime','phantom','drowned','husk','stray','pillager',
  'vindicator','ravager','blaze','ghast','magma_cube','wither_skeleton',
] as const;

export type HostileMob = typeof HOSTILE_MOBS[number];

// ─── Block aliases (gather target → block names) ───────────────────────────

export const BLOCK_ALIASES: Record<string, string[]> = {
  wood:      WOOD_BLOCKS,
  stone:     STONE_BLOCKS,
  coal:      ['coal_ore',      'deepslate_coal_ore'    ],
  iron:      ['iron_ore',      'deepslate_iron_ore'    ],
  copper:    ['copper_ore',    'deepslate_copper_ore'  ],
  gold:      ['gold_ore',      'deepslate_gold_ore'    ],
  diamond:   ['diamond_ore',   'deepslate_diamond_ore' ],
  emerald:   ['emerald_ore',   'deepslate_emerald_ore' ],
  lapis:     ['lapis_ore',     'deepslate_lapis_ore'   ],
  redstone:  ['redstone_ore',  'deepslate_redstone_ore'],
  sand:      SAND_BLOCKS,
  food:      PLANT_BLOCKS,
  bed:       BED_BLOCKS,
};

/** Resolve a short gather alias ('iron', 'coal') → block name list. */
export function resolveBlockAlias(target: string): string[] {
  return BLOCK_ALIASES[target] ?? [target];
}

// ─── Tool type ─────────────────────────────────────────────────────────────

export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'any';

export const TOOL_FOR_BLOCK: Record<string, ToolType> = {
  // Stone / ores → pickaxe
  stone: 'pickaxe', cobblestone: 'pickaxe', deepslate: 'pickaxe',
  andesite: 'pickaxe', granite: 'pickaxe', diorite: 'pickaxe', tuff: 'pickaxe',
  coal_ore: 'pickaxe', iron_ore: 'pickaxe', copper_ore: 'pickaxe',
  gold_ore: 'pickaxe', diamond_ore: 'pickaxe', emerald_ore: 'pickaxe',
  lapis_ore: 'pickaxe', redstone_ore: 'pickaxe',
  deepslate_coal_ore: 'pickaxe', deepslate_iron_ore: 'pickaxe',
  deepslate_copper_ore: 'pickaxe', deepslate_gold_ore: 'pickaxe',
  deepslate_diamond_ore: 'pickaxe', deepslate_emerald_ore: 'pickaxe',
  deepslate_lapis_ore: 'pickaxe', deepslate_redstone_ore: 'pickaxe',
  // Logs → axe
  oak_log: 'axe', birch_log: 'axe', spruce_log: 'axe', jungle_log: 'axe',
  acacia_log: 'axe', dark_oak_log: 'axe', mangrove_log: 'axe', cherry_log: 'axe',
  // Dirt / sand → shovel
  dirt: 'shovel', grass_block: 'shovel', podzol: 'shovel', mycelium: 'shovel',
  sand: 'shovel', red_sand: 'shovel', gravel: 'shovel',
  clay: 'shovel', snow: 'shovel', snow_block: 'shovel',
  // Crops → hoe
  wheat: 'hoe', carrots: 'hoe', potatoes: 'hoe', beetroots: 'hoe',
  // Leaves / cobweb → sword
  cobweb: 'sword',
};

/** Returns the best tool type for a block, defaulting to 'any'. */
export function getToolForBlock(blockName: string): ToolType {
  return TOOL_FOR_BLOCK[blockName] ?? 'any';
}

// ─── Tool tiers ────────────────────────────────────────────────────────────

export interface TierTools {
  pickaxe: string;
  axe:     string;
  shovel:  string;
}

/** Index 0 = wooden, 1 = stone, 2 = iron, 3 = diamond / netherite */
export const TOOL_TIERS: TierTools[] = [
  { pickaxe: 'wooden_pickaxe',  axe: 'wooden_axe',  shovel: 'wooden_shovel'  }, // 0
  { pickaxe: 'stone_pickaxe',   axe: 'stone_axe',   shovel: 'stone_shovel'   }, // 1
  { pickaxe: 'iron_pickaxe',    axe: 'iron_axe',    shovel: 'iron_shovel'    }, // 2
  { pickaxe: 'diamond_pickaxe', axe: 'diamond_axe', shovel: 'diamond_shovel' }, // 3
];

/** Returns the tool item name for a given tier and type. */
export function getToolItem(tier: number, type: 'pickaxe' | 'axe' | 'shovel'): string {
  const t = TOOL_TIERS[Math.min(tier, TOOL_TIERS.length - 1)];
  return t[type];
}

// ─── Minimum tier to mine ──────────────────────────────────────────────────

/** Minimum pickaxe tier required for the ore to drop anything (0 = wooden). */
export const MIN_TIER_FOR_ORE: Record<string, number> = {
  // Surface ores
  coal_ore:      0,
  iron_ore:      1,
  copper_ore:    1,
  gold_ore:      2,
  diamond_ore:   2,
  emerald_ore:   2,
  lapis_ore:     1,
  redstone_ore:  2,
  // Deepslate variants (same tier requirements)
  deepslate_coal_ore:      0,
  deepslate_iron_ore:      1,
  deepslate_copper_ore:    1,
  deepslate_gold_ore:      2,
  deepslate_diamond_ore:   2,
  deepslate_emerald_ore:   2,
  deepslate_lapis_ore:     1,
  deepslate_redstone_ore:  2,
};

/**
 * Returns the minimum pickaxe tier needed to mine a block.
 * Returns 0 (wooden pickaxe) if the block has no special requirement.
 */
export function getMinTier(blockName: string): number {
  return MIN_TIER_FOR_ORE[blockName] ?? 0;
}

/**
 * Returns true if the bot's current pickaxe is good enough to mine the block.
 * Pass the item name of the pickaxe the bot is holding, e.g. 'stone_pickaxe'.
 */
export function canMineBlock(blockName: string, heldPickaxe: string): boolean {
  const minTier = getMinTier(blockName);
  const heldTier = TOOL_TIERS.findIndex(t => t.pickaxe === heldPickaxe);
  if (heldTier === -1) return minTier === 0; // unknown tool = wooden tier
  return heldTier >= minTier;
}