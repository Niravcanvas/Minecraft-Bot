import { Bot } from 'mineflayer';
import { getNearestPassive, FOOD_MOB_NAMES } from '../data/mobs';
import { getBestTool } from '../data/items';
import { navigateTo } from '../utils/navigation';
import { log } from '../utils/logger';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// FIX Bug #4: correct smelt-items-per-fuel-unit lookup.
// The old code used `fuelItem.count * 2` which assumed 1 fuel = 2 smelt ops.
// Coal actually smelts 8 items. A log smelts 1.5. This over-estimated fuel
// needed by 4×, dumping all coal into the furnace for a 3-item smelt.
const SMELT_PER_FUEL: Record<string, number> = {
  coal: 8,        charcoal: 8,
  oak_log: 1.5,   birch_log: 1.5,   spruce_log: 1.5,   jungle_log: 1.5,
  acacia_log: 1.5, dark_oak_log: 1.5, mangrove_log: 1.5, cherry_log: 1.5,
  oak_planks: 1.5, birch_planks: 1.5, spruce_planks: 1.5,
  stick: 0.5,
};

export async function executeFarm(
  bot: Bot,
  target: string,
): Promise<{ success: boolean; reason: string; gained: number }> {
  const validTargets = [...FOOD_MOB_NAMES, 'sheep', 'hunt'];
  if (validTargets.includes(target)) {
    const mobNames  = target === 'hunt' ? FOOD_MOB_NAMES : [target];
    let totalKills  = 0;
    const maxHunts  = target === 'sheep' ? 3 : 4;

    for (let hunt = 0; hunt < maxHunts; hunt++) {
      const mob = getNearestPassive(bot, mobNames, 96);
      if (!mob) break;

      const sword = getBestTool(bot, 'sword');
      if (sword) try { await bot.equip(sword, 'hand'); } catch {}

      const reached = await navigateTo(bot, mob.position.x, mob.position.y, mob.position.z, 2, 10_000);
      if (!reached) continue;

      let hits = 0;
      for (let i = 0; i < 10; i++) {
        if (!bot.entities[mob.id]) break;
        try { await bot.attack(mob); hits++; await sleep(500); } catch { break; }
      }

      if (hits > 0) totalKills++;

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

  // Find raw meat in inventory
  let rawMeat: { name: string; count: number; item: any } | null = null;
  for (const raw of Object.keys(RAW_TO_COOKED)) {
    const id   = mcData.itemsByName[raw]?.id;
    const item = id ? bot.inventory.findInventoryItem(id, null, false) : null;
    if (item) { rawMeat = { name: raw, count: item.count, item }; break; }
  }
  if (!rawMeat) return;

  // Find fuel
  const fuelNames = ['coal', 'charcoal', 'oak_log', 'birch_log', 'spruce_log'];
  let fuelItem: any  = null;
  let fuelName       = '';
  let fuelId: number = 0;
  for (const f of fuelNames) {
    const id   = mcData.itemsByName[f]?.id;
    const item = id ? bot.inventory.findInventoryItem(id, null, false) : null;
    if (item) { fuelItem = item; fuelName = f; fuelId = id; break; }
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

    // FIX Bug #4: use correct fuel rate instead of the broken `fuelItem.count * 2`.
    // Previously coal (8 items/unit) was treated as if it only smelted 2, so
    // the bot dumped all its coal into the furnace for a 3-item cook job.
    const perFuel    = SMELT_PER_FUEL[fuelName] ?? 1;
    const cookCount  = Math.min(rawMeat.count, Math.floor(fuelItem.count * perFuel));
    const fuelNeeded = Math.ceil(cookCount / perFuel);
    const fuelToUse  = Math.min(fuelItem.count, fuelNeeded);

    await furnace.putFuel(fuelId, null, fuelToUse);   // exact amount needed
    await furnace.putInput(rawId, null, cookCount);

    // Wait for cooking (max 60s)
    const start = Date.now();
    while (Date.now() - start < Math.min(cookCount * 12_000, 60_000)) {
      await sleep(2_000);
      if ((furnace.outputItem()?.count ?? 0) >= cookCount) break;
    }

    await furnace.takeOutput();
    furnace.close();
    log.success(`[farm] Cooked ${cookCount}x ${rawMeat.name} (used ${fuelToUse}x ${fuelName})`);
  } catch (e: any) {
    log.warn(`[farm] Cooking failed: ${e.message}`);
  }
}