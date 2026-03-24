import { Bot }  from 'mineflayer';
import { Entity }           from 'prismarine-entity';
import { Vec3 }             from 'vec3';
import { getBestFood }      from '../data/items';
import { getNearestHostile } from '../data/mobs';
import { navigateTo }       from '../utils/navigation';
import { log }              from '../utils/logger';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const HOSTILE_SCAN_RADIUS = 24;
const FLEE_DISTANCE       = 32;
const HUNGER_THRESHOLD    = 16;
const LOW_HEALTH          = 10;

// ─── Eat ─────────────────────────────────────────────────────────────────────

async function eat(bot: Bot): Promise<{ success: boolean; reason: string }> {
  const foodLevel = (bot as any).food ?? 20;
  if (foodLevel >= HUNGER_THRESHOLD) return { success: true, reason: `not hungry (food=${foodLevel})` };
  const food = getBestFood(bot);
  if (!food) return { success: false, reason: 'no food in inventory' };
  try {
    await bot.equip(food, 'hand');
    bot.setControlState('sprint', false);
    await bot.consume();
    return { success: true, reason: `ate ${food.name}` };
  } catch (e: any) { return { success: false, reason: `eat failed: ${e.message}` }; }
}

// ─── Flee ────────────────────────────────────────────────────────────────────

const HOSTILE = new Set([
  'zombie','skeleton','creeper','spider','cave_spider','enderman',
  'witch','pillager','vindicator','evoker','ravager','phantom',
  'drowned','husk','stray','blaze','ghast','slime','magma_cube',
]);

function getAllNearbyHostiles(bot: Bot, radius: number): Entity[] {
  return Object.values(bot.entities).filter(e =>
    e && e !== bot.entity && e.type === 'mob' &&
    bot.entity.position.distanceTo(e.position) <= radius &&
    HOSTILE.has(e.name ?? ''),
  );
}

async function flee(bot: Bot): Promise<{ success: boolean; reason: string }> {
  const hostiles = getAllNearbyHostiles(bot, HOSTILE_SCAN_RADIUS);
  if (hostiles.length === 0) return { success: true, reason: 'no hostiles nearby — safe' };

  const pos = bot.entity.position;
  let dx = 0, dz = 0;
  for (const h of hostiles) {
    const diff = pos.minus(h.position);
    const len = Math.hypot(diff.x, diff.z) || 1;
    dx += diff.x / len; dz += diff.z / len;
  }
  const len = Math.hypot(dx, dz) || 1;
  const dest = { x: Math.round(pos.x + (dx / len) * FLEE_DISTANCE), z: Math.round(pos.z + (dz / len) * FLEE_DISTANCE) };

  bot.setControlState('sprint', true);
  const reached = await navigateTo(bot, dest.x, null, dest.z, 4);
  bot.setControlState('sprint', false);

  const still = getAllNearbyHostiles(bot, HOSTILE_SCAN_RADIUS).length > 0;
  if (reached && !still) return { success: true, reason: `fled — now safe` };
  return { success: false, reason: `flee ${reached ? 'partial' : 'failed'}` };
}

// ─── Sleep — PRIORITY: use bed from inventory, place it RIGHT HERE ──────────

function isNight(bot: Bot): boolean {
  const t = bot.time?.timeOfDay ?? 0;
  return t >= 12_542 && t <= 23_460;
}

async function sleepInBed(bot: Bot): Promise<{ success: boolean; reason: string }> {
  if (!isNight(bot)) return { success: false, reason: 'not night time' };
  if (getAllNearbyHostiles(bot, 12).length > 0) return { success: false, reason: 'hostiles nearby' };

  const mcData = require('minecraft-data')(bot.version);
  const BED_BLOCKS: string[] = require('../data/blocks').BED_BLOCKS;
  const bedIds = BED_BLOCKS.map((n: string) => mcData.blocksByName[n]?.id).filter(Boolean);

  // ── STEP 1: If we have a bed in inventory, PLACE IT RIGHT HERE ──
  const bedItem = bot.inventory.items().find(i => i.name.includes('_bed'));
  if (bedItem) {
    log.info('[sleep] Have bed in inventory — placing it here');
    const result = await placeBedNearby(bot, bedItem, bedIds);
    if (result) return result;
  }

  // ── STEP 2: Check for a bed VERY nearby (16 blocks, not 256!) ──
  const nearbyBed = bot.findBlock({ matching: bedIds, maxDistance: 16 });
  if (nearbyBed) {
    log.info(`[sleep] Found bed ${Math.round(bot.entity.position.distanceTo(nearbyBed.position))}m away`);
    const reached = await navigateTo(bot, nearbyBed.position.x, nearbyBed.position.y, nearbyBed.position.z, 2, 8000);
    if (reached) {
      try {
        await (bot as any).sleep(nearbyBed);
        await new Promise<void>(r => { (bot as any).once('wake', r); setTimeout(r, 6000); });
        return { success: true, reason: 'slept through the night' };
      } catch (e: any) {
        return { success: false, reason: `sleep failed: ${e.message}` };
      }
    }
  }

  // ── STEP 3: Try to craft a bed if we have materials ──
  const woolCount = bot.inventory.items().filter(i => i.name.includes('wool')).reduce((s, i) => s + i.count, 0);
  const planksCount = bot.inventory.items().filter(i => i.name.includes('_planks')).reduce((s, i) => s + i.count, 0);

  if (woolCount >= 3 && planksCount >= 3) {
    log.info('[sleep] Have materials — crafting bed');
    try {
      const bedItemId = mcData.itemsByName['white_bed']?.id;
      if (bedItemId) {
        const recipe = bot.recipesFor(bedItemId, null, 1, null as any)[0];
        if (recipe) {
          await bot.craft(recipe, 1, null as any);
          log.success('[sleep] Crafted a bed!');
          const newBed = bot.inventory.items().find(i => i.name.includes('_bed'));
          if (newBed) {
            const result = await placeBedNearby(bot, newBed, bedIds);
            if (result) return result;
          }
        }
      }
    } catch (e: any) {
      log.warn(`[sleep] Bed craft failed: ${e.message}`);
    }
  }

  return { success: false, reason: `no bed (wool=${woolCount} planks=${planksCount})` };
}

async function placeBedNearby(bot: Bot, bedItem: any, bedIds: number[]): Promise<{ success: boolean; reason: string } | null> {
  try {
    await bot.equip(bedItem, 'hand');
    const pos = bot.entity.position;
    const directions = [
      { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
      { x: 1, z: 1 }, { x: -1, z: -1 }, { x: 1, z: -1 }, { x: -1, z: 1 },
      { x: 2, z: 0 }, { x: -2, z: 0 }, { x: 0, z: 2 }, { x: 0, z: -2 },
    ];
    for (const dir of directions) {
      const placePos = new Vec3(Math.floor(pos.x) + dir.x, Math.floor(pos.y), Math.floor(pos.z) + dir.z);
      const block = bot.blockAt(placePos);
      if (!block || block.name !== 'air') continue;
      const below = bot.blockAt(placePos.offset(0, -1, 0));
      if (!below || below.type === 0) continue;
      try {
        await bot.placeBlock(below, new Vec3(0, 1, 0));
        log.info(`[sleep] Placed bed at ${placePos}`);
        await sleep(400);
        const newBed = bot.findBlock({ matching: bedIds, maxDistance: 5 });
        if (newBed) {
          await sleep(200);
          await (bot as any).sleep(newBed);
          await new Promise<void>(r => { (bot as any).once('wake', r); setTimeout(r, 6000); });
          return { success: true, reason: 'placed and slept in bed' };
        }
      } catch (e: any) { log.warn(`[sleep] Place attempt failed: ${e.message}`); }
    }
  } catch {}
  return null;
}

// ─── Armor equipping ─────────────────────────────────────────────────────────

const ARMOUR_SLOTS = ['head', 'torso', 'legs', 'feet'] as const;
const ARMOUR_PRIORITY: Record<string, string[]> = {
  head:  ['netherite_helmet','diamond_helmet','iron_helmet','golden_helmet','chainmail_helmet','leather_helmet'],
  torso: ['netherite_chestplate','diamond_chestplate','iron_chestplate','golden_chestplate','chainmail_chestplate','leather_chestplate'],
  legs:  ['netherite_leggings','diamond_leggings','iron_leggings','golden_leggings','chainmail_leggings','leather_leggings'],
  feet:  ['netherite_boots','diamond_boots','iron_boots','golden_boots','chainmail_boots','leather_boots'],
};

async function equipBestArmour(bot: Bot): Promise<{ success: boolean; reason: string }> {
  const mcData = require('minecraft-data')(bot.version);
  const equipped: string[] = [];

  for (const slot of ARMOUR_SLOTS) {
    const slotIndex = slot === 'head' ? 5 : slot === 'torso' ? 6 : slot === 'legs' ? 7 : 8;
    const current = (bot.inventory as any).slots[slotIndex];
    const priority = ARMOUR_PRIORITY[slot];

    for (const name of priority) {
      const id = mcData.itemsByName[name]?.id;
      const item = id ? bot.inventory.findInventoryItem(id, null, false) : null;
      if (!item) continue;

      const currentIdx = current ? priority.indexOf(
        Object.values(mcData.items as Record<string, any>).find((d: any) => d.id === current.type)?.name ?? ''
      ) : Infinity;
      if (priority.indexOf(name) < currentIdx) {
        try { await bot.equip(item, slot as any); equipped.push(name); } catch {}
      }
      break;
    }
  }

  return equipped.length > 0
    ? { success: true, reason: `equipped: ${equipped.join(', ')}` }
    : { success: true, reason: 'armor already optimal' };
}

// ─── Health ──────────────────────────────────────────────────────────────────

async function checkHealth(bot: Bot): Promise<{ success: boolean; reason: string }> {
  if (bot.health <= LOW_HEALTH && getAllNearbyHostiles(bot, HOSTILE_SCAN_RADIUS).length > 0)
    return flee(bot);
  if ((bot as any).food < HUNGER_THRESHOLD) return eat(bot);
  return { success: true, reason: `hp=${bot.health}/20 — healthy` };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function executeSurvive(bot: Bot, target: string): Promise<{ success: boolean; reason: string }> {
  switch (target) {
    case 'eat':         return eat(bot);
    case 'flee':        return flee(bot);
    case 'sleep':       return sleepInBed(bot);
    case 'equip_armor': return equipBestArmour(bot);
    case 'health':      return checkHealth(bot);
    default:            return { success: false, reason: `unknown: ${target}` };
  }
}