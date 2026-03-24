import { Bot }        from 'mineflayer';
import { goals }      from 'mineflayer-pathfinder';
import { WorldMemory } from '../memory/world';
import { navigateTo, goToBlock } from '../utils/navigation';
import { log }         from '../utils/logger';

// ─── Config ──────────────────────────────────────────────────────────────────

const ORE_Y_LEVELS: Record<string, number> = {
  coal_ore: 64, iron_ore: 16, copper_ore: 48,
  gold_ore: -16, diamond_ore: -58,
};

const SURFACE_TARGETS = new Set([
  'village', 'temple', 'cow', 'pig', 'sheep', 'chicken', 'horse',
  'oak_log', 'birch_log', 'spruce_log', 'sand', 'gravel', 'clay',
]);

const WALK_DISTANCE_MIN = 80;
const WALK_DISTANCE_MAX = 160;
const EXPLORED_CELL_SIZE = 64;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Explored tracker ────────────────────────────────────────────────────────

const exploredCells = new Set<string>();
function cellKey(x: number, z: number): string { return `${Math.floor(x / EXPLORED_CELL_SIZE)},${Math.floor(z / EXPLORED_CELL_SIZE)}`; }
function markExplored(x: number, z: number) { exploredCells.add(cellKey(x, z)); }
function isExplored(x: number, z: number): boolean { return exploredCells.has(cellKey(x, z)); }

function pickUnexploredDestination(fromX: number, fromZ: number): { x: number; z: number } {
  for (let i = 0; i < 12; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = WALK_DISTANCE_MIN + Math.random() * (WALK_DISTANCE_MAX - WALK_DISTANCE_MIN);
    const tx = Math.round(fromX + Math.cos(angle) * dist);
    const tz = Math.round(fromZ + Math.sin(angle) * dist);
    if (!isExplored(tx, tz)) return { x: tx, z: tz };
  }
  const angle = (exploredCells.size * 137.5 * Math.PI) / 180;
  return {
    x: Math.round(fromX + Math.cos(angle) * WALK_DISTANCE_MAX),
    z: Math.round(fromZ + Math.sin(angle) * WALK_DISTANCE_MAX),
  };
}

// ─── Chest looting ───────────────────────────────────────────────────────────

async function lootNearbyChests(bot: Bot, world: WorldMemory): Promise<number> {
  const mcData = require('minecraft-data')(bot.version);
  const chestId = mcData.blocksByName['chest']?.id;
  if (!chestId) return 0;

  const chests = bot.findBlocks({ matching: chestId, maxDistance: 24, count: 3 });
  let looted = 0;

  for (const chestPos of chests) {
    const block = bot.blockAt(chestPos);
    if (!block) continue;

    const reached = await goToBlock(bot, block);
    if (!reached) continue;

    try {
      const chest = await bot.openContainer(block);
      const items = chest.containerItems();

      if (items.length === 0) { chest.close(); continue; }

      // Take useful items only
      const USEFUL = new Set([
        'iron_ingot', 'gold_ingot', 'diamond', 'emerald', 'coal', 'charcoal',
        'bread', 'apple', 'golden_apple', 'cooked_beef', 'cooked_porkchop',
        'iron_pickaxe', 'iron_sword', 'iron_axe', 'diamond_pickaxe', 'diamond_sword',
        'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots',
        'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots',
        'shield', 'bow', 'arrow', 'torch', 'obsidian', 'ender_pearl',
        'saddle', 'string', 'book', 'compass', 'clock',
      ]);

      for (const item of items) {
        if (USEFUL.has(item.name)) {
          try {
            await chest.withdraw(item.type, null, item.count);
            log.success(`[chest] Took ${item.count}x ${item.name}`);
            looted++;
          } catch {}
        }
      }

      chest.close();
      world.discover('chest', chestPos);
    } catch (e: any) {
      log.warn(`[chest] Failed to open: ${e.message}`);
    }
  }

  return looted;
}

// ─── Drop collection ──────────────────────────────────────────────────────────

async function collectNearbyDrops(bot: Bot): Promise<void> {
  const drops = (Object.values(bot.entities) as any[]).filter(e =>
    e.type === 'object' && e.objectType === 'item' &&
    e.position?.distanceTo(bot.entity.position) < 8
  ).slice(0, 4);
  for (const d of drops) {
    try { await navigateTo(bot, d.position.x, d.position.y, d.position.z, 1, 3000); } catch {}
  }
}

// ─── Torch placement ─────────────────────────────────────────────────────────

async function placeTorchIfDark(bot: Bot): Promise<void> {
  if (bot.entity.position.y >= 50) return;
  const mcData = require('minecraft-data')(bot.version);
  const torchId = mcData.itemsByName['torch']?.id;
  if (!torchId) return;
  const torch = bot.inventory.findInventoryItem(torchId, null, false);
  if (!torch) return;
  const block = bot.blockAt(bot.entity.position.floored());
  if (block && (block as any).light <= 7) {
    try {
      await bot.equip(torch, 'hand');
      const below = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      if (below && below.type !== 0) {
        const Vec3 = require('vec3');
        await bot.placeBlock(below, new Vec3(0, 1, 0));
        log.info('[explore] Placed torch');
      }
    } catch {}
  }
}

// ─── Search strategies ───────────────────────────────────────────────────────

async function surfaceScan(bot: Bot, target: string, world: WorldMemory): Promise<ExploreResult> {
  const pos = bot.entity.position;
  const dest = pickUnexploredDestination(pos.x, pos.z);

  const reached = await navigateTo(bot, dest.x, null, dest.z, 6);
  markExplored(dest.x, dest.z);
  markExplored(bot.entity.position.x, bot.entity.position.z);

  await collectNearbyDrops(bot);
  await lootNearbyChests(bot, world);

  world.scan(bot);
  const known = world.getNearest(target);
  if (known) return { success: true, found: true, reason: `found ${target} at ${fmt(known)}` };

  return {
    success: reached,
    found: false,
    reason: reached ? `explored to ${dest.x},${dest.z} — ${target} not found` : `got stuck`,
  };
}

async function deepDig(bot: Bot, target: string, world: WorldMemory): Promise<ExploreResult> {
  const targetY = ORE_Y_LEVELS[target] ?? 16;
  const pos = bot.entity.position;

  if (Math.abs(pos.y - targetY) > 8) {
    const reached = await navigateTo(bot, pos.x, targetY, pos.z, 4);
    if (!reached) return { success: false, found: false, reason: `could not reach Y=${targetY}` };
  }

  await placeTorchIfDark(bot);
  world.scan(bot);
  const known = world.getNearest(target);
  if (known) return { success: true, found: true, reason: `found ${target} at ${fmt(known)}` };

  const angle = Math.random() * Math.PI * 2;
  const branchX = Math.round(bot.entity.position.x + Math.cos(angle) * 24);
  const branchZ = Math.round(bot.entity.position.z + Math.sin(angle) * 24);
  await navigateTo(bot, branchX, targetY, branchZ, 4);

  await placeTorchIfDark(bot);
  await lootNearbyChests(bot, world);
  world.scan(bot);

  const found = world.getNearest(target);
  if (found) return { success: true, found: true, reason: `found ${target} at ${fmt(found)}` };

  return { success: true, found: false, reason: `dug branch at Y=${targetY} — ${target} not found` };
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export type ExploreResult = { success: boolean; found: boolean; reason: string };

export async function executeExplore(bot: Bot, target: string, world: WorldMemory): Promise<ExploreResult> {
  const pos = bot.entity.position;
  const known = world.getNearest(target);

  if (known) {
    const dist = Math.hypot(pos.x - known.x, pos.z - known.z);
    if (dist < 20) {
      world.scan(bot);
      await lootNearbyChests(bot, world);
      return { success: true, found: true, reason: `already near ${target}` };
    }
    const reached = await navigateTo(bot, known.x, known.y, known.z, 6);
    if (reached) {
      world.scan(bot);
      await lootNearbyChests(bot, world);
      return { success: true, found: true, reason: `arrived at ${target}` };
    }
  }

  // Scan immediately
  world.scan(bot);
  const nearby = world.getNearest(target);
  if (nearby) return { success: true, found: true, reason: `found ${target} nearby` };

  // Pick strategy
  if (target in ORE_Y_LEVELS) return deepDig(bot, target, world);
  return surfaceScan(bot, target, world);
}

function fmt(pos: { x: number; y: number; z: number }): string {
  return `(${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`;
}