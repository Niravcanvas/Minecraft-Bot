import { Bot } from 'mineflayer';
import { getNearestPassive, FOOD_MOB_NAMES } from '../data/mobs';
import { getBestTool } from '../data/items';
import { navigateTo } from '../utils/navigation';
import { log } from '../utils/logger';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function executeFarm(bot: Bot, target: string): Promise<{ success: boolean; reason: string; gained: number }> {
  const { goals } = require('mineflayer-pathfinder');

  // Hunt animals
  const validTargets = [...FOOD_MOB_NAMES, 'sheep', 'hunt'];
  if (validTargets.includes(target)) {
    const mobNames = target === 'hunt' ? FOOD_MOB_NAMES : [target];
    let totalKills = 0;
    const maxHunts = target === 'sheep' ? 3 : 4; // Hunt multiple animals per goal

    for (let hunt = 0; hunt < maxHunts; hunt++) {
      const mob = getNearestPassive(bot, mobNames, 96);
      if (!mob) break;

      const sword = getBestTool(bot, 'sword');
      if (sword) try { await bot.equip(sword, 'hand'); } catch {}

      // Navigate to mob
      const reached = await navigateTo(bot, mob.position.x, mob.position.y, mob.position.z, 2, 10_000);
      if (!reached) continue;

      // Attack loop
      let hits = 0;
      for (let i = 0; i < 10; i++) {
        if (!bot.entities[mob.id]) break;
        try { await bot.attack(mob); hits++; await sleep(500); } catch { break; }
      }

      if (hits > 0) totalKills++;

      // Collect drops
      await sleep(600);
      const drops = (Object.values(bot.entities) as any[]).filter(e =>
        e.type === 'object' && e.objectType === 'item' &&
        e.position?.distanceTo(bot.entity.position) < 10
      );
      for (const d of drops) {
        try {
          await navigateTo(bot, d.position.x, d.position.y, d.position.z, 1, 3000);
        } catch {}
      }
    }

    bot.pathfinder.setGoal(null);

    if (totalKills === 0) return { success: false, reason: `no ${target} found or killed`, gained: 0 };

    // Try to cook raw meat if furnace available
    await tryCookMeat(bot);

    return { success: true, reason: `hunted ${totalKills}x ${target}`, gained: totalKills };
  }

  return { success: false, reason: `unknown farm target: ${target}`, gained: 0 };
}

// ─── Cook raw meat ───────────────────────────────────────────────────────────

async function tryCookMeat(bot: Bot): Promise<void> {
  const mcData = require('minecraft-data')(bot.version);

  const RAW_TO_COOKED: Record<string, string> = {
    beef: 'cooked_beef',
    porkchop: 'cooked_porkchop',
    chicken: 'cooked_chicken',
    mutton: 'cooked_mutton',
    rabbit: 'cooked_rabbit',
  };

  // Check if we have raw meat
  let rawMeat: { name: string; count: number; item: any } | null = null;
  for (const [raw, _cooked] of Object.entries(RAW_TO_COOKED)) {
    const id = mcData.itemsByName[raw]?.id;
    const item = id ? bot.inventory.findInventoryItem(id, null, false) : null;
    if (item) {
      rawMeat = { name: raw, count: item.count, item };
      break;
    }
  }
  if (!rawMeat) return;

  // Check if we have fuel
  const fuelNames = ['coal', 'charcoal', 'oak_log', 'birch_log', 'spruce_log'];
  let fuelItem: any = null;
  let fuelId: number = 0;
  for (const f of fuelNames) {
    const id = mcData.itemsByName[f]?.id;
    const item = id ? bot.inventory.findInventoryItem(id, null, false) : null;
    if (item) { fuelItem = item; fuelId = id; break; }
  }
  if (!fuelItem) return;

  // Find furnace
  const furnaceBlockId = mcData.blocksByName['furnace']?.id;
  if (!furnaceBlockId) return;
  const furnaceBlock = bot.findBlock({ matching: furnaceBlockId, maxDistance: 48 });
  if (!furnaceBlock) return;

  try {
    await navigateTo(bot, furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2, 8000);
    const furnace = await bot.openFurnace(furnaceBlock);

    const rawId = mcData.itemsByName[rawMeat.name]?.id;
    if (!rawId) { furnace.close(); return; }

    const cookCount = Math.min(rawMeat.count, fuelItem.count * 2); // each fuel smelts ~2 items

    await furnace.putFuel(fuelId, null, Math.ceil(cookCount / 2));
    await furnace.putInput(rawId, null, cookCount);

    // Wait for cooking (max 60s)
    const maxWait = cookCount * 12_000;
    const start = Date.now();
    while (Date.now() - start < Math.min(maxWait, 60_000)) {
      await sleep(2_000);
      if ((furnace.outputItem()?.count ?? 0) >= cookCount) break;
    }

    await furnace.takeOutput();
    furnace.close();
    log.success(`[farm] Cooked ${cookCount}x ${rawMeat.name}`);
  } catch (e: any) {
    log.warn(`[farm] Cooking failed: ${e.message}`);
  }
}