import { Bot }  from 'mineflayer';
import { Vec3 } from 'vec3';
import { goToBlock, navigateTo } from '../utils/navigation';
import { log } from '../utils/logger';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Inventory helpers ──────────────────────────────────────────────────────

function countOf(bot: Bot, name: string): number {
  const mcData = require('minecraft-data')(bot.version);
  const id = mcData.itemsByName[name]?.id;
  if (!id) return 0;
  return bot.inventory.items().filter(i => i.type === id).reduce((s, i) => s + i.count, 0);
}

function invSummary(bot: Bot): string {
  return bot.inventory.items().map(i => `${i.name}x${i.count}`).join(', ');
}

// ─── Place a block from inventory right next to the bot ─────────────────────

async function placeNextToBot(bot: Bot, itemToPlace: any): Promise<any | null> {
  try {
    await bot.equip(itemToPlace, 'hand');
    await sleep(200);

    // Try placing on the block below the bot
    const pos = bot.entity.position.floored();
    const directions = [
      new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1), new Vec3(0, 0, -1),
      new Vec3(1, 0, 1), new Vec3(-1, 0, -1),
    ];

    for (const dir of directions) {
      const targetPos = pos.plus(dir);
      const blockAt = bot.blockAt(targetPos);
      const blockBelow = bot.blockAt(targetPos.offset(0, -1, 0));

      // Need air at target and solid below
      if (blockAt && blockAt.type === 0 && blockBelow && blockBelow.type !== 0) {
        try {
          await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
          await sleep(400);
          // Find the placed block
          return bot.blockAt(targetPos) ?? null;
        } catch (e: any) {
          log.warn(`[place] attempt failed at ${targetPos}: ${e.message}`);
          continue;
        }
      }
    }

    // Fallback: try placing on any adjacent solid face
    for (const dir of directions) {
      const adjacentPos = pos.plus(dir);
      const adjacent = bot.blockAt(adjacentPos);
      if (adjacent && adjacent.type !== 0) {
        try {
          const faceVec = new Vec3(-dir.x, 0, -dir.z);
          await bot.placeBlock(adjacent, faceVec);
          await sleep(400);
          const placed = bot.blockAt(pos.plus(new Vec3(0, 0, 0)));
          if (placed && placed.type !== 0) return placed;
          // Check if it went on top
          const onTop = bot.blockAt(adjacentPos.offset(0, 1, 0));
          if (onTop && onTop.type !== 0) return onTop;
        } catch { continue; }
      }
    }
  } catch (e: any) {
    log.warn(`[place] equip/place failed: ${e.message}`);
  }
  return null;
}

// ─── Get a crafting table block ─────────────────────────────────────────────

async function getCraftingTable(bot: Bot): Promise<any | null> {
  const mcData = require('minecraft-data')(bot.version);
  const ctBlockId = mcData.blocksByName['crafting_table']?.id;
  if (!ctBlockId) return null;

  // 1. Check for nearby placed crafting table (very close only)
  const nearby = bot.findBlock({ matching: ctBlockId, maxDistance: 6 });
  if (nearby) {
    const dist = bot.entity.position.distanceTo(nearby.position);
    if (dist < 4) return nearby; // Already close enough
    const reached = await goToBlock(bot, nearby);
    if (reached) return nearby;
  }

  // 2. Place from inventory
  const ctItemId = mcData.itemsByName['crafting_table']?.id;
  let ctItem = ctItemId ? bot.inventory.findInventoryItem(ctItemId, null, false) : null;

  // 3. If no crafting table in inventory, craft one from planks
  if (!ctItem) {
    const hasPlanks = bot.inventory.items().some(i => i.name.includes('_planks'));
    const planksCount = bot.inventory.items().filter(i => i.name.includes('_planks')).reduce((s, i) => s + i.count, 0);

    if (planksCount < 4) {
      // Convert logs to planks first
      await convertLogsToPlanks(bot, 4);
    }

    // Try to craft crafting_table without a crafting table (it's a 2x2 recipe)
    if (ctItemId) {
      const recipe = bot.recipesFor(ctItemId, null, 1, null as any)[0];
      if (recipe) {
        try {
          await bot.craft(recipe, 1, null as any);
          log.info('[craft] Crafted crafting_table from planks');
          ctItem = bot.inventory.findInventoryItem(ctItemId, null, false);
        } catch (e: any) {
          log.warn(`[craft] Failed to craft crafting_table: ${e.message}`);
        }
      }
    }
  }

  if (!ctItem) {
    log.warn('[craft] No crafting table available');
    return null;
  }

  // Place it right next to the bot
  log.info('[craft] Placing crafting table next to bot...');
  const placed = await placeNextToBot(bot, ctItem);
  if (placed) {
    log.success(`[craft] Placed crafting table at ${placed.position}`);
    return placed;
  }

  log.warn('[craft] Could not place crafting table');
  return null;
}

// ─── Get a furnace block ────────────────────────────────────────────────────

async function getFurnace(bot: Bot): Promise<any | null> {
  const mcData = require('minecraft-data')(bot.version);
  const furnaceBlockId = mcData.blocksByName['furnace']?.id;
  if (!furnaceBlockId) return null;

  const nearby = bot.findBlock({ matching: furnaceBlockId, maxDistance: 16 });
  if (nearby) {
    const reached = await goToBlock(bot, nearby);
    if (reached) return nearby;
  }

  const furnaceItemId = mcData.itemsByName['furnace']?.id;
  const furnaceItem = furnaceItemId ? bot.inventory.findInventoryItem(furnaceItemId, null, false) : null;
  if (!furnaceItem) return null;

  const placed = await placeNextToBot(bot, furnaceItem);
  if (placed) { log.success(`[craft] Placed furnace at ${placed.position}`); return placed; }
  return null;
}

// ─── Convert any logs to planks ─────────────────────────────────────────────

async function convertLogsToPlanks(bot: Bot, needed: number): Promise<boolean> {
  const existing = bot.inventory.items()
    .filter(i => i.name.includes('_planks'))
    .reduce((s, i) => s + i.count, 0);
  if (existing >= needed) return true;

  const mcData = require('minecraft-data')(bot.version);

  // Find any log in inventory
  const logItem = bot.inventory.items().find(i =>
    i.name.endsWith('_log') && !i.name.includes('stripped')
  );
  if (!logItem) return false;

  // Each log → 4 planks. Figure out which planks this log makes.
  // Try each plank type and see which recipe uses this log
  const plankTypes = Object.keys(mcData.itemsByName as Record<string, any>)
    .filter(n => n.endsWith('_planks'));

  for (const plankName of plankTypes) {
    const plankId = mcData.itemsByName[plankName]?.id;
    if (!plankId) continue;

    const recipes = bot.recipesFor(plankId, null, 1, null as any);
    if (recipes.length > 0) {
      const logsNeeded = Math.ceil((needed - existing) / 4);
      const runs = Math.min(logsNeeded, logItem.count);
      try {
        await bot.craft(recipes[0], runs, null as any);
        log.info(`[craft] Converted ${runs} ${logItem.name} → ${plankName}`);
        return true;
      } catch { continue; }
    }
  }
  return false;
}

// ─── Ensure sticks ──────────────────────────────────────────────────────────

async function ensureSticks(bot: Bot, needed: number): Promise<boolean> {
  const have = countOf(bot, 'stick');
  if (have >= needed) return true;

  const mcData = require('minecraft-data')(bot.version);
  const stickId = mcData.itemsByName['stick']?.id;
  if (!stickId) return false;

  // Ensure enough planks first (2 planks → 4 sticks)
  const sticksNeeded = needed - have;
  const planksNeeded = Math.ceil(sticksNeeded / 4) * 2;
  await convertLogsToPlanks(bot, planksNeeded);

  const recipe = bot.recipesFor(stickId, null, 1, null as any)[0];
  if (!recipe) return false;

  try {
    const runs = Math.ceil(sticksNeeded / 4);
    await bot.craft(recipe, runs, null as any);
    log.info(`[craft] Made ${runs * 4} sticks`);
    return true;
  } catch { return false; }
}

// ─── Main craft function ────────────────────────────────────────────────────

export async function executeCraft(
  bot: Bot,
  target: string,
  quantity = 1,
): Promise<{ success: boolean; reason: string }> {
  const mcData = require('minecraft-data')(bot.version);
  const targetId = mcData.itemsByName[target]?.id;
  if (!targetId) return { success: false, reason: `unknown item: ${target}` };

  // Already have it?
  if (countOf(bot, target) >= quantity)
    return { success: true, reason: `already have ${target}` };

  // ── Handle smelting ──
  const SMELT: Record<string, { input: string; fuel: string }> = {
    iron_ingot: { input: 'raw_iron', fuel: 'coal' },
    gold_ingot: { input: 'raw_gold', fuel: 'coal' },
    charcoal:   { input: 'oak_log',  fuel: 'oak_log' },
    cooked_beef:    { input: 'beef',     fuel: 'coal' },
    cooked_porkchop:{ input: 'porkchop', fuel: 'coal' },
    cooked_chicken: { input: 'chicken',  fuel: 'coal' },
    cooked_mutton:  { input: 'mutton',   fuel: 'coal' },
  };

  if (target in SMELT) {
    let { input, fuel } = SMELT[target];
    // Use whatever log type for charcoal
    if (target === 'charcoal') {
      const anyLog = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (anyLog) input = anyLog.name;
    }
    // Try alternate fuels
    if (countOf(bot, fuel) === 0) {
      if (countOf(bot, 'charcoal') > 0) fuel = 'charcoal';
      else {
        const logFuel = bot.inventory.items().find(i => i.name.endsWith('_log'));
        if (logFuel) fuel = logFuel.name;
      }
    }
    if (countOf(bot, input) > 0 && countOf(bot, fuel) > 0)
      return smelt(bot, input, fuel, quantity);
    return { success: false, reason: `need ${input} + ${fuel}` };
  }

  // ── Pre-craft: ensure planks and sticks from any wood ──
  const hasLogs = bot.inventory.items().some(i => i.name.endsWith('_log') && !i.name.includes('stripped'));
  if (hasLogs) {
    await convertLogsToPlanks(bot, 12);
    await ensureSticks(bot, 8);
  }

  // ── Try crafting WITHOUT crafting table first (2x2 recipes) ──
  const simpleRecipe = bot.recipesFor(targetId, null, 1, null as any)[0];
  if (simpleRecipe) {
    try {
      await bot.craft(simpleRecipe, quantity, null as any);
      log.success(`[craft] Crafted ${quantity}x ${target} (no table needed)`);
      return { success: true, reason: `crafted ${quantity}x ${target}` };
    } catch (e: any) {
      log.warn(`[craft] Simple craft failed: ${e.message}`);
    }
  }

  // ── Get/place crafting table and try 3x3 recipes ──
  const ctBlock = await getCraftingTable(bot);
  if (!ctBlock) {
    log.warn(`[craft] Cannot craft ${target} — no crafting table. Inventory: ${invSummary(bot)}`);
    return { success: false, reason: 'no crafting table available' };
  }

  const tableRecipe = bot.recipesFor(targetId, null, 1, ctBlock)[0];
  if (!tableRecipe) {
    log.warn(`[craft] No recipe for ${target} even with crafting table. Inventory: ${invSummary(bot)}`);
    return { success: false, reason: `no recipe for ${target} — missing materials` };
  }

  try {
    await bot.craft(tableRecipe, quantity, ctBlock);
    log.success(`[craft] Crafted ${quantity}x ${target} (with table)`);
    return { success: true, reason: `crafted ${quantity}x ${target}` };
  } catch (e: any) {
    return { success: false, reason: `craft failed: ${e.message}` };
  }
}

// ─── Smelting ───────────────────────────────────────────────────────────────

async function smelt(
  bot: Bot, input: string, fuel: string, quantity: number,
): Promise<{ success: boolean; reason: string }> {
  const furnace = await getFurnace(bot);
  if (!furnace) return { success: false, reason: 'no furnace' };

  try {
    await goToBlock(bot, furnace);
    const f = await bot.openFurnace(furnace);
    const mcData = require('minecraft-data')(bot.version);

    const fuelId = mcData.itemsByName[fuel]?.id;
    const inputId = mcData.itemsByName[input]?.id;
    if (!fuelId || !inputId) { f.close(); return { success: false, reason: 'unknown items' }; }

    const inputItem = bot.inventory.findInventoryItem(inputId, null, false);
    const fuelItem = bot.inventory.findInventoryItem(fuelId, null, false);
    if (!inputItem || !fuelItem) { f.close(); return { success: false, reason: `missing ${input} or ${fuel}` }; }

    const count = Math.min(quantity, inputItem.count);
    await f.putFuel(fuelId, null, Math.min(Math.ceil(count / 2), fuelItem.count));
    await f.putInput(inputId, null, count);

    const start = Date.now();
    while (Date.now() - start < Math.min(count * 12_000, 90_000)) {
      await sleep(2_000);
      if ((f.outputItem()?.count ?? 0) >= count) break;
    }

    await f.takeOutput();
    f.close();
    return { success: true, reason: `smelted ${count}x ${input}` };
  } catch (e: any) {
    return { success: false, reason: `smelt failed: ${e.message}` };
  }
}

// ─── Utility exports ────────────────────────────────────────────────────────

export function listCraftable(bot: Bot): string[] {
  const mcData = require('minecraft-data')(bot.version);
  const items = [
    'crafting_table','furnace','chest','torch','stick',
    'wooden_pickaxe','wooden_axe','wooden_sword',
    'stone_pickaxe','stone_axe','stone_sword',
    'iron_pickaxe','iron_axe','iron_sword',
    'iron_helmet','iron_chestplate','iron_leggings','iron_boots',
    'shield','white_bed','bread',
  ];
  return items.filter(name => {
    try {
      const id = mcData.itemsByName[name]?.id;
      return id && bot.recipesFor(id, null, 1, null as any).length > 0;
    } catch { return false; }
  });
}

export async function ensureItem(bot: Bot, item: string, quantity: number): Promise<{ success: boolean; reason: string }> {
  return executeCraft(bot, item, quantity);
}