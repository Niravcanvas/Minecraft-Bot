import { Bot }  from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import {
  getCraftingRecipe,
  getSmeltingRecipes,
  resolveRawMaterials,
  checkCraftability,
  CraftingRecipe,
  SmeltingRecipe,
} from '../data/recipes';

// ─── Helpers ────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Returns how many of `itemName` the bot currently holds. */
function countInInventory(bot: Bot, itemName: string): number {
  const mcData = require('minecraft-data')(bot.version);
  const id = mcData.itemsByName[itemName]?.id;
  if (!id) return 0;
  return bot.inventory.items()
    .filter(i => i.type === id)
    .reduce((sum, i) => sum + i.count, 0);
}

/** Walk to a block and wait until actually there (no blind sleep). */
async function goTo(bot: Bot, block: { position: { x: number; y: number; z: number } }, reach = 2): Promise<void> {
  const { x, y, z } = block.position;
  return new Promise((resolve, reject) => {
    bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, reach), true);

    const timeout = setTimeout(() => { cleanup(); reject(new Error('navigation timeout')); }, 10_000);

    const onReached = () => { cleanup(); resolve(); };
    // path_update fires with { status: 'noPath' } when pathfinder gives up
    const onPathUpdate = (r: { status: string }) => {
      if (r.status === 'noPath') { cleanup(); reject(new Error('no path to target')); }
    };

    function cleanup() {
      clearTimeout(timeout);
      bot.off('goal_reached', onReached);
      bot.off('path_update',  onPathUpdate);
    }

    bot.once('goal_reached', onReached);
    bot.on('path_update',    onPathUpdate);
  });
}

// ─── Station finders ────────────────────────────────────────────────────────

async function findOrPlaceCraftingTable(bot: Bot): Promise<object | null> {
  const mcData = require('minecraft-data')(bot.version);
  const ctBlockId = mcData.blocksByName['crafting_table']?.id;
  if (!ctBlockId) return null;

  // Already nearby?
  let block = bot.findBlock({ matching: ctBlockId, maxDistance: 48 });
  if (block) {
    await goTo(bot, block);
    return block;
  }

  // Place one from inventory
  const ctItemId = mcData.itemsByName['crafting_table']?.id;
  const ctItem   = ctItemId ? bot.inventory.findInventoryItem(ctItemId, null, false) : null;
  if (!ctItem) return null;

  try {
    await bot.equip(ctItem, 'hand');
    const below = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (!below) return null;
    const Vec3 = require('vec3');
    await bot.placeBlock(below, new Vec3(0, 1, 0));
    await sleep(300);
    block = bot.findBlock({ matching: ctBlockId, maxDistance: 4 });
    return block ?? null;
  } catch {
    return null;
  }
}

async function findOrPlaceFurnace(bot: Bot): Promise<object | null> {
  const mcData = require('minecraft-data')(bot.version);
  const furnaceBlockId = mcData.blocksByName['furnace']?.id;
  if (!furnaceBlockId) return null;

  let block = bot.findBlock({ matching: furnaceBlockId, maxDistance: 48 });
  if (block) {
    await goTo(bot, block);
    return block;
  }

  // Try to craft a furnace first, then place it
  const craftResult = await executeCraftSingle(bot, 'furnace');
  if (!craftResult.success) return null;

  const furnaceItemId = mcData.itemsByName['furnace']?.id;
  const furnaceItem   = furnaceItemId ? bot.inventory.findInventoryItem(furnaceItemId, null, false) : null;
  if (!furnaceItem) return null;

  try {
    await bot.equip(furnaceItem, 'hand');
    const below = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (!below) return null;
    const Vec3 = require('vec3');
    await bot.placeBlock(below, new Vec3(0, 1, 0));
    await sleep(300);
    block = bot.findBlock({ matching: furnaceBlockId, maxDistance: 4 });
    return block ?? null;
  } catch {
    return null;
  }
}

// ─── Smelting ───────────────────────────────────────────────────────────────

async function executeSmelt(
  bot: Bot,
  recipe: SmeltingRecipe,
  quantity: number,
): Promise<{ success: boolean; reason: string }> {
  const furnaceBlock = await findOrPlaceFurnace(bot) as any;
  if (!furnaceBlock) return { success: false, reason: 'cannot find or place furnace' };

  try {
    await goTo(bot, furnaceBlock);
    const furnace = await bot.openFurnace(furnaceBlock);

    // Put fuel in
    const mcData  = require('minecraft-data')(bot.version);
    const fuelId  = mcData.itemsByName[recipe.fuel]?.id;
    const fuelItem = fuelId ? bot.inventory.findInventoryItem(fuelId, null, false) : null;
    const fuelNeeded = Math.ceil(recipe.fuelPerSmelt * quantity);

    if (!fuelItem || fuelItem.count < fuelNeeded) {
      furnace.close();
      return { success: false, reason: `not enough ${recipe.fuel} for fuel (need ${fuelNeeded})` };
    }
    await furnace.putFuel(fuelId, null, fuelNeeded);

    // Put input in
    const inputId   = mcData.itemsByName[recipe.input]?.id;
    const inputItem = inputId ? bot.inventory.findInventoryItem(inputId, null, false) : null;
    if (!inputItem || inputItem.count < quantity) {
      furnace.close();
      return { success: false, reason: `not enough ${recipe.input} to smelt` };
    }
    await furnace.putInput(inputId, null, quantity);

    // Wait for smelting (roughly 10 s per item in vanilla, poll instead of sleeping blindly)
    const maxWait = quantity * 12_000;
    const start   = Date.now();
    while (Date.now() - start < maxWait) {
      await sleep(1_000);
      if ((furnace.outputItem()?.count ?? 0) >= quantity) break;
    }

    await furnace.takeOutput();
    furnace.close();
    return { success: true, reason: `smelted ${quantity}x ${recipe.result}` };
  } catch (e: any) {
    return { success: false, reason: `smelt failed: ${e.message}` };
  }
}

// ─── Core recursive crafter ─────────────────────────────────────────────────

/**
 * Ensures the bot has at least `quantity` of `item` in its inventory.
 * Recursively crafts or smelts prerequisites as needed.
 */
export async function ensureItem(
  bot: Bot,
  item: string,
  quantity: number,
  depth = 0,
): Promise<{ success: boolean; reason: string }> {
  if (depth > 12) return { success: false, reason: `recursion too deep trying to get ${item}` };

  // Already have enough?
  const have = countInInventory(bot, item);
  if (have >= quantity) return { success: true, reason: `already have ${item}` };

  const still = quantity - have;

  // Try crafting recipe
  const craftRecipe = getCraftingRecipe(item);
  if (craftRecipe) {
    const runs = Math.ceil(still / craftRecipe.count);
    // Recursively ensure each ingredient
    for (const [ingredient, perRun] of Object.entries(craftRecipe.requires)) {
      const total = perRun * runs;
      const sub   = await ensureItem(bot, ingredient, total, depth + 1);
      if (!sub.success) return { success: false, reason: `cannot get ingredient ${ingredient}: ${sub.reason}` };
    }
    // Now craft
    return executeCraftSingle(bot, item, runs);
  }

  // Try smelting recipe
  const smeltRecipes = getSmeltingRecipes(item);
  if (smeltRecipes.length > 0) {
    const smelt = smeltRecipes[0];
    // Ensure the input ore
    const inputSub = await ensureItem(bot, smelt.input, still, depth + 1);
    if (!inputSub.success) return { success: false, reason: `cannot get ${smelt.input}: ${inputSub.reason}` };
    // Ensure fuel
    const fuelNeeded = Math.ceil(smelt.fuelPerSmelt * still);
    const fuelSub    = await ensureItem(bot, smelt.fuel, fuelNeeded, depth + 1);
    if (!fuelSub.success) return { success: false, reason: `cannot get fuel ${smelt.fuel}: ${fuelSub.reason}` };
    return executeSmelt(bot, smelt, still);
  }

  // No recipe — this is a raw material; bot must gather it from the world
  return {
    success: false,
    reason:  `${item} is a raw material — bot must mine/gather it (need ${still} more)`,
  };
}

// ─── Single-level craft (calls mineflayer's bot.craft) ──────────────────────

async function executeCraftSingle(
  bot: Bot,
  target: string,
  runs = 1,
): Promise<{ success: boolean; reason: string }> {
  const mcData   = require('minecraft-data')(bot.version);
  const targetId = mcData.itemsByName[target]?.id;
  if (!targetId) return { success: false, reason: `unknown item: ${target}` };

  const craftRecipe = getCraftingRecipe(target);
  if (!craftRecipe) return { success: false, reason: `no crafting recipe for ${target}` };

  let ctBlock: object | null = null;
  if (craftRecipe.station === 'crafting_table') {
    ctBlock = await findOrPlaceCraftingTable(bot);
    if (!ctBlock) return { success: false, reason: 'cannot find or place crafting table' };
  }

  const recipe = bot.recipesFor(targetId, null, 1, (ctBlock ?? null) as any)[0];
  if (!recipe) return { success: false, reason: `mineflayer found no recipe for ${target} — missing materials?` };

  try {
    await bot.craft(recipe, runs, (ctBlock ?? null) as any);
    return { success: true, reason: `crafted ${runs}x ${target}` };
  } catch (e: any) {
    return { success: false, reason: `craft failed: ${e.message}` };
  }
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * The main function your brain/executor calls.
 * Fully resolves and crafts `target`, including all prerequisites.
 */
export async function executeCraft(
  bot: Bot,
  target: string,
  quantity = 1,
): Promise<{ success: boolean; reason: string }> {
  const mcData   = require('minecraft-data')(bot.version);
  const targetId = mcData.itemsByName[target]?.id;
  if (!targetId) return { success: false, reason: `unknown item: ${target}` };

  // Quick feasibility snapshot (informational — ensureItem will do the real work)
  const inv = Object.fromEntries(
    bot.inventory.items().map(i => [
      Object.values(mcData.items as Record<string, { name: string }>)
        .find((d) => (d as any).id === i.type)?.name ?? String(i.type),
      i.count,
    ])
  );
  const check = checkCraftability(target, quantity, inv);
  if (!check.canCraft) {
    // Don't bail — ensureItem will try to sort out what's missing.
    // Log it so the brain knows what the gap is.
    console.log(`[craft] missing for ${target}:`, check.missing);
  }

  return ensureItem(bot, target, quantity);
}