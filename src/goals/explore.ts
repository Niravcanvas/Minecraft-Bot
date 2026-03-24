import { Bot }        from 'mineflayer';
import { goals }      from 'mineflayer-pathfinder';
import { WorldMemory } from '../memory/world';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExploreResult = { success: boolean; found: boolean; reason: string };

/** How to search for different categories of target */
type SearchStrategy = 'nearby_block' | 'surface_scan' | 'random_walk' | 'deep_dig';

// ─── Config ──────────────────────────────────────────────────────────────────

/** How far underground each ore typically lives (Y level) */
const ORE_Y_LEVELS: Record<string, number> = {
  coal_ore:     64,
  iron_ore:     16,
  copper_ore:   48,
  gold_ore:    -16,
  diamond_ore: -58,
  ancient_debris: -58,
};

/** Surface/structure targets — just roam until you find one */
const SURFACE_TARGETS = new Set([
  'village', 'temple', 'dungeon', 'stronghold',
  'woodland_mansion', 'ocean_monument', 'witch_hut',
  'cow', 'pig', 'sheep', 'chicken', 'horse',
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
  'sand', 'gravel', 'clay',
]);

const NAV_TIMEOUT_MS      = 15_000;
const SCAN_RADIUS         = 32;       // blocks, for world.scan
const WALK_DISTANCE_MIN   = 80;
const WALK_DISTANCE_MAX   = 160;
const ALREADY_NEAR_RADIUS = 20;
const EXPLORED_CELL_SIZE  = 64;       // chunk-like grid cells to avoid revisiting

// ─── Explored area tracker ───────────────────────────────────────────────────

/** Persistent across calls within a session — tracks which grid cells were visited */
const exploredCells = new Set<string>();

function cellKey(x: number, z: number): string {
  const cx = Math.floor(x / EXPLORED_CELL_SIZE);
  const cz = Math.floor(z / EXPLORED_CELL_SIZE);
  return `${cx},${cz}`;
}

function markExplored(x: number, z: number): void {
  exploredCells.add(cellKey(x, z));
}

function isExplored(x: number, z: number): boolean {
  return exploredCells.has(cellKey(x, z));
}

/**
 * Picks a destination that hasn't been explored yet.
 * Tries up to `attempts` random angles before giving up and picking the least-visited.
 */
function pickUnexploredDestination(
  fromX: number,
  fromZ: number,
  attempts = 12,
): { x: number; z: number } {
  for (let i = 0; i < attempts; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = WALK_DISTANCE_MIN + Math.random() * (WALK_DISTANCE_MAX - WALK_DISTANCE_MIN);
    const tx    = Math.round(fromX + Math.cos(angle) * dist);
    const tz    = Math.round(fromZ + Math.sin(angle) * dist);
    if (!isExplored(tx, tz)) return { x: tx, z: tz };
  }
  // Fallback: pick the furthest angle from the most recent explored cells (spiral outward)
  const angle = (exploredCells.size * 137.5 * Math.PI) / 180; // golden angle spiral
  const dist  = WALK_DISTANCE_MAX;
  return {
    x: Math.round(fromX + Math.cos(angle) * dist),
    z: Math.round(fromZ + Math.sin(angle) * dist),
  };
}

// ─── Navigation helper ───────────────────────────────────────────────────────

/**
 * Navigate to (x, y, z) and await arrival or failure.
 * Returns true if the bot reached within `reach` blocks, false otherwise.
 */
async function navigateTo(
  bot: Bot,
  x: number,
  y: number | null,
  z: number,
  reach = 4,
): Promise<boolean> {
  const goal = y !== null
    ? new goals.GoalNear(x, y, z, reach)
    : new goals.GoalXZ(x, z);

  return new Promise<boolean>(resolve => {
    const timeout = setTimeout(() => { cleanup(); resolve(false); }, NAV_TIMEOUT_MS);

    function onReached() { cleanup(); resolve(true); }
    function onFailed()  { cleanup(); resolve(false); }

    // goal_reached is in BotEvents; goal_failed is injected by mineflayer-pathfinder
    // and not in the type definitions, so we cast to any for those calls.
    bot.once('goal_reached',        onReached);
    (bot as any).once('goal_failed', onFailed);

    function cleanup() {
      clearTimeout(timeout);
      bot.removeListener('goal_reached',             onReached);
      (bot as any).removeListener('goal_failed',     onFailed);
      bot.pathfinder.setGoal(null);
    }

    bot.pathfinder.setGoal(goal, true);
  });
}

// ─── Strategy selector ───────────────────────────────────────────────────────

function pickStrategy(target: string): SearchStrategy {
  if (target in ORE_Y_LEVELS)    return 'deep_dig';
  if (SURFACE_TARGETS.has(target)) return 'surface_scan';
  return 'random_walk';
}

// ─── Sub-strategies ──────────────────────────────────────────────────────────

/** Look for a nearby block right now without moving */
async function searchNearby(bot: Bot, target: string, world: WorldMemory): Promise<ExploreResult> {
  world.scan(bot);
  const known = world.getNearest(target);
  if (known) {
    return { success: true, found: true, reason: `found ${target} nearby at ${fmt(known)}` };
  }
  return { success: true, found: false, reason: `${target} not visible nearby` };
}

/** Walk the surface scanning for the target */
async function surfaceScan(
  bot: Bot,
  target: string,
  world: WorldMemory,
): Promise<ExploreResult> {
  const pos  = bot.entity.position;
  const dest = pickUnexploredDestination(pos.x, pos.z);

  const reached = await navigateTo(bot, dest.x, null, dest.z, 6);
  markExplored(dest.x, dest.z);
  markExplored(bot.entity.position.x, bot.entity.position.z);

  world.scan(bot);
  const known = world.getNearest(target);
  if (known) {
    return { success: true, found: true, reason: `found ${target} at ${fmt(known)} while exploring` };
  }

  return {
    success: reached,
    found:   false,
    reason:  reached
      ? `explored to ${dest.x},${dest.z} — ${target} not found yet`
      : `got stuck navigating to ${dest.x},${dest.z}`,
  };
}

/** Dig down toward an ore's optimal Y level, then branch */
async function deepDig(
  bot: Bot,
  target: string,
  world: WorldMemory,
): Promise<ExploreResult> {
  const targetY = ORE_Y_LEVELS[target] ?? 16;
  const pos     = bot.entity.position;

  if (Math.abs(pos.y - targetY) > 8) {
    // Navigate toward Y level (pathfinder handles the digging if dig plugin is active)
    const reached = await navigateTo(bot, pos.x, targetY, pos.z, 4);
    if (!reached) {
      return { success: false, found: false, reason: `could not reach Y=${targetY} for ${target}` };
    }
  }

  // Now scan sideways for the ore
  world.scan(bot);
  const known = world.getNearest(target);
  if (known) {
    return { success: true, found: true, reason: `found ${target} at ${fmt(known)}` };
  }

  // Dig a short tunnel branch at this Y level
  const angle   = Math.random() * Math.PI * 2;
  const branchX = Math.round(bot.entity.position.x + Math.cos(angle) * 24);
  const branchZ = Math.round(bot.entity.position.z + Math.sin(angle) * 24);
  await navigateTo(bot, branchX, targetY, branchZ, 4);
  world.scan(bot);

  const found = world.getNearest(target);
  if (found) {
    return { success: true, found: true, reason: `found ${target} at ${fmt(found)} in branch tunnel` };
  }

  return {
    success: true,
    found:   false,
    reason:  `dug branch at Y=${targetY} — ${target} not found, expand search`,
  };
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * Explore for `target`. Will navigate to known locations, scan nearby,
 * or pick a smart strategy based on the target type.
 *
 * @param bot    - the mineflayer bot
 * @param target - block/mob/structure name to search for
 * @param world  - WorldMemory instance for caching known positions
 */
export async function executeExplore(
  bot: Bot,
  target: string,
  world: WorldMemory,
): Promise<ExploreResult> {
  const pos   = bot.entity.position;
  const known = world.getNearest(target);

  // ── Case 1: already standing near a known location ──
  if (known) {
    const dist = Math.hypot(pos.x - known.x, pos.z - known.z);
    if (dist < ALREADY_NEAR_RADIUS) {
      world.scan(bot);
      return { success: true, found: true, reason: `already near ${target} at ${fmt(known)}` };
    }

    // ── Case 2: known location exists, navigate there ──
    const reached = await navigateTo(bot, known.x, known.y, known.z, 6);
    world.scan(bot);

    if (reached) {
      return { success: true, found: true, reason: `arrived at known ${target} at ${fmt(known)}` };
    }

    // Navigation failed — fall through to active search below
    console.warn(`[explore] could not reach known ${target} at ${fmt(known)}, searching fresh`);
  }

  // ── Case 3: scan immediately before walking anywhere ──
  const nearbyResult = await searchNearby(bot, target, world);
  if (nearbyResult.found) return nearbyResult;

  // ── Case 4: pick strategy and actively search ──
  const strategy = pickStrategy(target);

  switch (strategy) {
    case 'deep_dig':     return deepDig(bot, target, world);
    case 'surface_scan': return surfaceScan(bot, target, world);
    default:             return surfaceScan(bot, target, world);
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function fmt(pos: { x: number; y: number; z: number }): string {
  return `(${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`;
}