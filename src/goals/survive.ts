import { Bot }  from 'mineflayer';
import { Entity }           from 'prismarine-entity';
import { Vec3 }             from 'vec3';
import { getBestFood }      from '../data/items';
import { getNearestHostile } from '../data/mobs';

// ─── Config ──────────────────────────────────────────────────────────────────

const FLEE_DISTANCE       = 32;
const HOSTILE_SCAN_RADIUS = 24;
const NAV_TIMEOUT_MS      = 30_000;
const HUNGER_THRESHOLD    = 16;
const LOW_HEALTH          = 10;

// ─── Nav helper ───────────────────────────────────────────────────────────────

async function navigateTo(
  bot: Bot,
  x: number,
  y: number | null,
  z: number,
  reach = 2,
): Promise<boolean> {
  const { goals } = require('mineflayer-pathfinder');
  const goal = y !== null
    ? new goals.GoalNear(x, y, z, reach)
    : new goals.GoalXZ(x, z);

  return new Promise<boolean>(resolve => {
    const timeout = setTimeout(() => { cleanup(); resolve(false); }, NAV_TIMEOUT_MS);

    function onReached() { cleanup(); resolve(true); }
    function onFailed()  { cleanup(); resolve(false); }

    bot.once('goal_reached',         onReached);
    (bot as any).once('goal_failed', onFailed);

    function cleanup() {
      clearTimeout(timeout);
      bot.removeListener('goal_reached',         onReached);
      (bot as any).removeListener('goal_failed', onFailed);
      bot.pathfinder.setGoal(null);
    }

    bot.pathfinder.setGoal(goal, true);
  });
}

// ─── Eat ─────────────────────────────────────────────────────────────────────

async function eat(bot: Bot): Promise<{ success: boolean; reason: string }> {
  const foodLevel = (bot as any).food ?? 20;
  if (foodLevel >= HUNGER_THRESHOLD) {
    return { success: true, reason: `not hungry (food=${foodLevel}/20)` };
  }

  const food = getBestFood(bot);
  if (!food) return { success: false, reason: 'no food in inventory' };

  try {
    await bot.equip(food, 'hand');
    bot.setControlState('sprint', false);
    await bot.consume();
    return { success: true, reason: `ate ${food.name} (food was ${foodLevel}/20)` };
  } catch (e: any) {
    return { success: false, reason: `eat failed: ${e.message}` };
  }
}

// ─── Flee ────────────────────────────────────────────────────────────────────

function getAllNearbyHostiles(bot: Bot, radius: number): Entity[] {
  const HOSTILE = new Set([
    'zombie','skeleton','creeper','spider','cave_spider','enderman',
    'witch','pillager','vindicator','evoker','ravager','phantom',
    'drowned','husk','stray','blaze','ghast','slime','magma_cube',
    'zombified_piglin','piglin_brute','wither_skeleton','guardian',
    'elder_guardian','shulker','silverfish','endermite',
  ]);
  return Object.values(bot.entities).filter(e => {
    if (!e || e === bot.entity) return false;
    if (e.type !== 'mob')       return false;
    const dist = bot.entity.position.distanceTo(e.position);
    if (dist > radius)          return false;
    return HOSTILE.has(e.name ?? '');
  });
}

function computeFleeDestination(
  bot: Bot,
  hostiles: Entity[],
  distance: number,
): { x: number; z: number } {
  const pos = bot.entity.position;
  let dx = 0, dz = 0;
  for (const h of hostiles) {
    const diff = pos.minus(h.position);
    const len  = Math.hypot(diff.x, diff.z) || 1;
    dx += diff.x / len;
    dz += diff.z / len;
  }
  const len = Math.hypot(dx, dz) || 1;
  dx = (dx / len) * distance;
  dz = (dz / len) * distance;
  return { x: Math.round(pos.x + dx), z: Math.round(pos.z + dz) };
}

async function flee(bot: Bot): Promise<{ success: boolean; reason: string }> {
  const hostiles = getAllNearbyHostiles(bot, HOSTILE_SCAN_RADIUS);

  // ── KEY FIX: if nothing is actually nearby, declare safe immediately.
  //    Brain.ts will see "no hostiles nearby" in the reason and start its
  //    flee-safe cooldown, preventing the 5-minute spam loop.
  if (hostiles.length === 0) {
    return { success: true, reason: 'no hostiles nearby — safe' };
  }

  const dest    = computeFleeDestination(bot, hostiles, FLEE_DISTANCE);
  const names   = [...new Set(hostiles.map(h => h.name))].join(', ');
  const reached = await navigateTo(bot, dest.x, null, dest.z, 4);

  // Re-check after moving
  const stillThreatened = getAllNearbyHostiles(bot, HOSTILE_SCAN_RADIUS).length > 0;

  if (reached && !stillThreatened) {
    return { success: true, reason: `fled from [${names}] — now safe` };
  }
  if (reached && stillThreatened) {
    // Reached destination but still threatened — don't mark success.
    // Brain will see this fail, loop detection will eventually suppress it
    // and try something else (like fighting).
    return { success: false, reason: `fled but still threatened by [${names}]` };
  }
  return { success: false, reason: `could not flee from [${names}] — path blocked` };
}

// ─── Sleep ───────────────────────────────────────────────────────────────────

function isNight(bot: Bot): boolean {
  const time = bot.time?.timeOfDay ?? 0;
  return time >= 13_000 && time <= 23_000;
}

async function sleepInBed(bot: Bot): Promise<{ success: boolean; reason: string }> {
  if (!isNight(bot)) {
    return { success: false, reason: `cannot sleep — daytime (time=${bot.time?.timeOfDay})` };
  }

  const hostiles = getAllNearbyHostiles(bot, HOSTILE_SCAN_RADIUS);
  if (hostiles.length > 0) {
    return { success: false, reason: 'cannot sleep — hostiles nearby' };
  }

  const mcData = require('minecraft-data')(bot.version);
  const BED_BLOCKS: string[] = require('../data/blocks').BED_BLOCKS;
  const bedIds = BED_BLOCKS.map((n: string) => mcData.blocksByName[n]?.id).filter(Boolean);

  const bed = bot.findBlock({ matching: bedIds, maxDistance: 256 });
  if (!bed) {
    // Check if bot has bed materials or can craft one
    const hasWool = bot.inventory.items().some(i => i.name.includes('wool'));
    const hasPlanks = bot.inventory.items().some(i => i.name.includes('_planks'));
    if (hasWool && hasPlanks) {
      // Try to craft a bed
      console.log(`[sleep] No bed found, trying to craft one`);
      try {
        // Need 3 wool, 3 planks
        const wool = bot.inventory.items().find(i => i.name.includes('wool'));
        const planks = bot.inventory.items().find(i => i.name.includes('_planks'));
        if (wool && wool.count >= 3 && planks && planks.count >= 3) {
          // Craft bed
          const recipe = mcData.recipes.find((r: any) => r.result?.name === 'white_bed');
          if (recipe) {
            await bot.craft(recipe, 1, undefined);
            console.log(`[sleep] Crafted a bed`);
            // Now find the crafted bed in inventory
            const craftedBed = bot.inventory.findInventoryItem(mcData.itemsByName['white_bed'].id, null, false);
            if (craftedBed) {
              // Place it near the bot
              const pos = bot.entity.position;
              const directions = [
                { x: 0, z: 1 }, { x: 0, z: -1 }, { x: 1, z: 0 }, { x: -1, z: 0 }
              ];
              for (const dir of directions) {
                const placePos = new Vec3(Math.floor(pos.x) + dir.x, Math.floor(pos.y), Math.floor(pos.z) + dir.z);
                const block = bot.blockAt(placePos);
                if (block && block.name === 'air') {
                  const below = bot.blockAt(new Vec3(placePos.x, placePos.y - 1, placePos.z));
                  if (below && ['grass_block', 'dirt', 'stone', 'cobblestone', 'planks'].includes(below.name)) {
                    try {
                      await bot.equip(craftedBed, 'hand');
                      await bot.placeBlock(block, new Vec3(0, 1, 0)); // place on top
                      console.log(`[sleep] Placed bed at ${placePos.x}, ${placePos.y}, ${placePos.z}`);
                      // Now try to sleep in the newly placed bed
                      const newBed = bot.findBlock({ matching: bedIds, maxDistance: 5 });
                      if (newBed) {
                        await new Promise(r => setTimeout(r, 300));
                        await (bot as any).sleep(newBed);
                        await new Promise<void>(resolve => {
                          (bot as any).once('wake', resolve);
                          setTimeout(resolve, 6_000);
                        });
                        return { success: true, reason: 'crafted, placed, and slept in new bed' };
                      }
                    } catch (e: any) {
                      console.log(`[sleep] Failed to place bed: ${e.message}`);
                    }
                  }
                }
              }
            }
          }
        }
      } catch (e: any) {
        console.log(`[sleep] Failed to craft bed: ${e.message}`);
      }
      return { success: false, reason: 'crafted bed but failed to place or sleep' };
    }
    const reason = hasWool && hasPlanks ? 'no bed found within 256 blocks, but has materials' : 'no bed found within 256 blocks, missing materials';
    return { success: false, reason };
  }

  console.log(`[sleep] Found bed at ${bed.position.x}, ${bed.position.y}, ${bed.position.z}`);
  console.log(`[sleep] Bot position: ${bot.entity.position.x}, ${bot.entity.position.y}, ${bot.entity.position.z}`);

  // ── Navigate with a tighter reach so the bot is actually adjacent ─────────
  const reached = await navigateTo(bot, bed.position.x, bed.position.y, bed.position.z, 2);
  if (!reached) {
    console.log(`[sleep] Could not navigate to bed at ${bed.position.x}, ${bed.position.y}, ${bed.position.z}`);
    // Fallback: try to place a bed if has one in inventory
    const bedItem = bot.inventory.findInventoryItem(mcData.itemsByName['white_bed']?.id || mcData.itemsByName['bed']?.id, null, false);
    if (bedItem) {
      console.log(`[sleep] Has bed in inventory, trying to place it`);
      // Find a suitable place to place the bed near the bot
      const pos = bot.entity.position;
      const directions = [
        { x: 0, z: 1 }, { x: 0, z: -1 }, { x: 1, z: 0 }, { x: -1, z: 0 }
      ];
      for (const dir of directions) {
        const placePos = new Vec3(Math.floor(pos.x) + dir.x, Math.floor(pos.y), Math.floor(pos.z) + dir.z);
        const block = bot.blockAt(placePos);
        if (block && block.name === 'air') {
          const below = bot.blockAt(new Vec3(placePos.x, placePos.y - 1, placePos.z));
          if (below && ['grass_block', 'dirt', 'stone', 'cobblestone', 'planks'].includes(below.name)) {
            try {
              await bot.equip(bedItem, 'hand');
              await bot.placeBlock(block, new Vec3(0, 1, 0)); // place on top
              console.log(`[sleep] Placed bed at ${placePos.x}, ${placePos.y}, ${placePos.z}`);
              // Now try to sleep in the newly placed bed
              const newBed = bot.findBlock({ matching: bedIds, maxDistance: 5 });
              if (newBed) {
                await new Promise(r => setTimeout(r, 300));
                await (bot as any).sleep(newBed);
                await new Promise<void>(resolve => {
                  (bot as any).once('wake', resolve);
                  setTimeout(resolve, 6_000);
                });
                return { success: true, reason: 'placed and slept in new bed' };
              }
            } catch (e: any) {
              console.log(`[sleep] Failed to place bed: ${e.message}`);
            }
          }
        }
      }
    }
    return { success: false, reason: 'could not reach the bed' };
  }

  // ── Small delay so the server registers our position before sleep ─────────
  await new Promise(r => setTimeout(r, 300));

  try {
    await (bot as any).sleep(bed);
    await new Promise<void>(resolve => {
      (bot as any).once('wake', resolve);
      setTimeout(resolve, 6_000);
    });
    return { success: true, reason: 'slept through the night' };
  } catch (e: any) {
    console.log(`[sleep] Sleep attempt failed: ${e.message}`);
    return { success: false, reason: `sleep failed: ${e.message}` };
  }
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
  const mcData  = require('minecraft-data')(bot.version);
  const equipped: string[] = [];

  for (const slot of ARMOUR_SLOTS) {
    const slotIndex = slot === 'head' ? 5 : slot === 'torso' ? 6 : slot === 'legs' ? 7 : 8;
    const current   = (bot.inventory as any).slots[slotIndex];
    const priority  = ARMOUR_PRIORITY[slot];

    for (const armourName of priority) {
      const id   = mcData.itemsByName[armourName]?.id;
      const item = id ? bot.inventory.findInventoryItem(id, null, false) : null;
      if (!item) continue;

      const currentPriority = current
        ? priority.indexOf(
            Object.values(mcData.items as Record<string, { name: string }>)
              .find(d => (d as any).id === current.type)?.name ?? '',
          )
        : Infinity;
      const newPriority = priority.indexOf(armourName);

      if (newPriority < currentPriority) {
        try { await bot.equip(item, slot as any); equipped.push(armourName); } catch {}
      }
      break;
    }
  }

  if (equipped.length === 0) return { success: true, reason: 'armour already optimal or none available' };
  return { success: true, reason: `equipped: ${equipped.join(', ')}` };
}

// ─── Health check ─────────────────────────────────────────────────────────────

async function checkHealth(bot: Bot): Promise<{ success: boolean; reason: string }> {
  const hp       = bot.health ?? 20;
  const foodLvl  = (bot as any).food ?? 20;
  const hostiles = getAllNearbyHostiles(bot, HOSTILE_SCAN_RADIUS);
  const parts    = [`hp=${hp}/20`, `food=${foodLvl}/20`];

  if (hp <= LOW_HEALTH && hostiles.length > 0) {
    const fleeResult = await flee(bot);
    parts.push(fleeResult.reason);
    return { success: fleeResult.success, reason: parts.join(' | ') };
  }

  if (foodLvl < HUNGER_THRESHOLD) {
    const eatResult = await eat(bot);
    parts.push(eatResult.reason);
    return { success: eatResult.success, reason: parts.join(' | ') };
  }

  return { success: true, reason: parts.join(' | ') + ' — healthy' };
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function executeSurvive(
  bot: Bot,
  target: string,
): Promise<{ success: boolean; reason: string }> {
  switch (target) {
    case 'eat':         return eat(bot);
    case 'flee':        return flee(bot);
    case 'sleep':       return sleepInBed(bot);
    case 'equip_armor': return equipBestArmour(bot);
    case 'health':      return checkHealth(bot);
    default:            return { success: false, reason: `unknown survive target: ${target}` };
  }
}