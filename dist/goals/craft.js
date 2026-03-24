"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeCraft = executeCraft;
exports.listCraftable = listCraftable;
exports.ensureItem = ensureItem;
const vec3_1 = require("vec3");
const navigation_1 = require("../utils/navigation");
const logger_1 = require("../utils/logger");
// FIX Bug #3: import shared interrupt flag so the safety loop in index.ts can
// signal smelt() to abort early when an emergency (creeper, starvation) fires.
const interrupt_1 = require("../interrupt");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// ─── Fuel smelting rates ─────────────────────────────────────────────────────
// FIX Bug #3 / craft.ts fuel math: the old code used Math.ceil(count / 2)
// which assumed 1 fuel = 2 smelt operations. Coal actually smelts 8 items.
// This lookup gives the correct smelt-count per fuel item so we don't
// dump all our coal into the furnace for a 3-item smelt.
const SMELT_PER_FUEL = {
    coal: 8, charcoal: 8,
    oak_log: 1.5, birch_log: 1.5, spruce_log: 1.5, jungle_log: 1.5,
    acacia_log: 1.5, dark_oak_log: 1.5, mangrove_log: 1.5, cherry_log: 1.5,
    oak_planks: 1.5, birch_planks: 1.5, spruce_planks: 1.5,
    stick: 0.5,
};
// ─── Inventory helpers ──────────────────────────────────────────────────────
function countOf(bot, name) {
    const mcData = require('minecraft-data')(bot.version);
    const id = mcData.itemsByName[name]?.id;
    if (!id)
        return 0;
    return bot.inventory.items().filter(i => i.type === id).reduce((s, i) => s + i.count, 0);
}
function invSummary(bot) {
    return bot.inventory.items().map(i => `${i.name}x${i.count}`).join(', ');
}
// ─── Place a block from inventory right next to the bot ─────────────────────
async function placeNextToBot(bot, itemToPlace) {
    try {
        await bot.equip(itemToPlace, 'hand');
        await sleep(200);
        const pos = bot.entity.position.floored();
        const directions = [
            new vec3_1.Vec3(1, 0, 0), new vec3_1.Vec3(-1, 0, 0),
            new vec3_1.Vec3(0, 0, 1), new vec3_1.Vec3(0, 0, -1),
            new vec3_1.Vec3(1, 0, 1), new vec3_1.Vec3(-1, 0, -1),
        ];
        for (const dir of directions) {
            const targetPos = pos.plus(dir);
            const blockAt = bot.blockAt(targetPos);
            const blockBelow = bot.blockAt(targetPos.offset(0, -1, 0));
            if (blockAt && blockAt.type === 0 && blockBelow && blockBelow.type !== 0) {
                try {
                    await bot.placeBlock(blockBelow, new vec3_1.Vec3(0, 1, 0));
                    await sleep(400);
                    return bot.blockAt(targetPos) ?? null;
                }
                catch (e) {
                    logger_1.log.warn(`[place] attempt failed at ${targetPos}: ${e.message}`);
                    continue;
                }
            }
        }
        for (const dir of directions) {
            const adjacentPos = pos.plus(dir);
            const adjacent = bot.blockAt(adjacentPos);
            if (adjacent && adjacent.type !== 0) {
                try {
                    const faceVec = new vec3_1.Vec3(-dir.x, 0, -dir.z);
                    await bot.placeBlock(adjacent, faceVec);
                    await sleep(400);
                    const placed = bot.blockAt(pos.plus(new vec3_1.Vec3(0, 0, 0)));
                    if (placed && placed.type !== 0)
                        return placed;
                    const onTop = bot.blockAt(adjacentPos.offset(0, 1, 0));
                    if (onTop && onTop.type !== 0)
                        return onTop;
                }
                catch {
                    continue;
                }
            }
        }
    }
    catch (e) {
        logger_1.log.warn(`[place] equip/place failed: ${e.message}`);
    }
    return null;
}
// ─── Get a crafting table block ─────────────────────────────────────────────
async function getCraftingTable(bot) {
    const mcData = require('minecraft-data')(bot.version);
    const ctBlockId = mcData.blocksByName['crafting_table']?.id;
    if (!ctBlockId)
        return null;
    const nearby = bot.findBlock({ matching: ctBlockId, maxDistance: 6 });
    if (nearby) {
        const dist = bot.entity.position.distanceTo(nearby.position);
        if (dist < 4)
            return nearby;
        const reached = await (0, navigation_1.goToBlock)(bot, nearby);
        if (reached)
            return nearby;
    }
    const ctItemId = mcData.itemsByName['crafting_table']?.id;
    let ctItem = ctItemId ? bot.inventory.findInventoryItem(ctItemId, null, false) : null;
    if (!ctItem) {
        const planksCount = bot.inventory.items().filter(i => i.name.includes('_planks')).reduce((s, i) => s + i.count, 0);
        if (planksCount < 4) {
            await convertLogsToPlanks(bot, 4);
        }
        if (ctItemId) {
            const recipe = bot.recipesFor(ctItemId, null, 1, null)[0];
            if (recipe) {
                try {
                    await bot.craft(recipe, 1, null);
                    logger_1.log.info('[craft] Crafted crafting_table from planks');
                    ctItem = bot.inventory.findInventoryItem(ctItemId, null, false);
                }
                catch (e) {
                    logger_1.log.warn(`[craft] Failed to craft crafting_table: ${e.message}`);
                }
            }
        }
    }
    if (!ctItem) {
        logger_1.log.warn('[craft] No crafting table available');
        return null;
    }
    logger_1.log.info('[craft] Placing crafting table next to bot...');
    const placed = await placeNextToBot(bot, ctItem);
    if (placed) {
        logger_1.log.success(`[craft] Placed crafting table at ${placed.position}`);
        return placed;
    }
    logger_1.log.warn('[craft] Could not place crafting table');
    return null;
}
// ─── Get a furnace block ────────────────────────────────────────────────────
async function getFurnace(bot) {
    const mcData = require('minecraft-data')(bot.version);
    const furnaceBlockId = mcData.blocksByName['furnace']?.id;
    if (!furnaceBlockId)
        return null;
    const nearby = bot.findBlock({ matching: furnaceBlockId, maxDistance: 16 });
    if (nearby) {
        const reached = await (0, navigation_1.goToBlock)(bot, nearby);
        if (reached)
            return nearby;
    }
    const furnaceItemId = mcData.itemsByName['furnace']?.id;
    const furnaceItem = furnaceItemId ? bot.inventory.findInventoryItem(furnaceItemId, null, false) : null;
    if (!furnaceItem)
        return null;
    const placed = await placeNextToBot(bot, furnaceItem);
    if (placed) {
        logger_1.log.success(`[craft] Placed furnace at ${placed.position}`);
        return placed;
    }
    return null;
}
// ─── Convert any logs to planks ─────────────────────────────────────────────
async function convertLogsToPlanks(bot, needed) {
    const existing = bot.inventory.items()
        .filter(i => i.name.includes('_planks'))
        .reduce((s, i) => s + i.count, 0);
    if (existing >= needed)
        return true;
    const mcData = require('minecraft-data')(bot.version);
    const logItem = bot.inventory.items().find(i => i.name.endsWith('_log') && !i.name.includes('stripped'));
    if (!logItem)
        return false;
    const plankTypes = Object.keys(mcData.itemsByName)
        .filter(n => n.endsWith('_planks'));
    for (const plankName of plankTypes) {
        const plankId = mcData.itemsByName[plankName]?.id;
        if (!plankId)
            continue;
        const recipes = bot.recipesFor(plankId, null, 1, null);
        if (recipes.length > 0) {
            const logsNeeded = Math.ceil((needed - existing) / 4);
            const runs = Math.min(logsNeeded, logItem.count);
            try {
                await bot.craft(recipes[0], runs, null);
                logger_1.log.info(`[craft] Converted ${runs} ${logItem.name} → ${plankName}`);
                return true;
            }
            catch {
                continue;
            }
        }
    }
    return false;
}
// ─── Ensure sticks ──────────────────────────────────────────────────────────
async function ensureSticks(bot, needed) {
    const have = countOf(bot, 'stick');
    if (have >= needed)
        return true;
    const mcData = require('minecraft-data')(bot.version);
    const stickId = mcData.itemsByName['stick']?.id;
    if (!stickId)
        return false;
    const sticksNeeded = needed - have;
    const planksNeeded = Math.ceil(sticksNeeded / 4) * 2;
    await convertLogsToPlanks(bot, planksNeeded);
    const recipe = bot.recipesFor(stickId, null, 1, null)[0];
    if (!recipe)
        return false;
    try {
        const runs = Math.ceil(sticksNeeded / 4);
        await bot.craft(recipe, runs, null);
        logger_1.log.info(`[craft] Made ${runs * 4} sticks`);
        return true;
    }
    catch {
        return false;
    }
}
// ─── Main craft function ────────────────────────────────────────────────────
async function executeCraft(bot, target, quantity = 1) {
    const mcData = require('minecraft-data')(bot.version);
    const targetId = mcData.itemsByName[target]?.id;
    if (!targetId)
        return { success: false, reason: `unknown item: ${target}` };
    if (countOf(bot, target) >= quantity)
        return { success: true, reason: `already have ${target}` };
    // ── Handle smelting ──
    const SMELT = {
        iron_ingot: { input: 'raw_iron', fuel: 'coal' },
        gold_ingot: { input: 'raw_gold', fuel: 'coal' },
        charcoal: { input: 'oak_log', fuel: 'oak_log' },
        cooked_beef: { input: 'beef', fuel: 'coal' },
        cooked_porkchop: { input: 'porkchop', fuel: 'coal' },
        cooked_chicken: { input: 'chicken', fuel: 'coal' },
        cooked_mutton: { input: 'mutton', fuel: 'coal' },
    };
    if (target in SMELT) {
        let { input, fuel } = SMELT[target];
        if (target === 'charcoal') {
            const anyLog = bot.inventory.items().find(i => i.name.endsWith('_log'));
            if (anyLog)
                input = anyLog.name;
        }
        if (countOf(bot, fuel) === 0) {
            if (countOf(bot, 'charcoal') > 0)
                fuel = 'charcoal';
            else {
                const logFuel = bot.inventory.items().find(i => i.name.endsWith('_log'));
                if (logFuel)
                    fuel = logFuel.name;
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
    const simpleRecipe = bot.recipesFor(targetId, null, 1, null)[0];
    if (simpleRecipe) {
        try {
            await bot.craft(simpleRecipe, quantity, null);
            logger_1.log.success(`[craft] Crafted ${quantity}x ${target} (no table needed)`);
            return { success: true, reason: `crafted ${quantity}x ${target}` };
        }
        catch (e) {
            logger_1.log.warn(`[craft] Simple craft failed: ${e.message}`);
        }
    }
    // ── Get/place crafting table and try 3x3 recipes ──
    const ctBlock = await getCraftingTable(bot);
    if (!ctBlock) {
        logger_1.log.warn(`[craft] Cannot craft ${target} — no crafting table. Inventory: ${invSummary(bot)}`);
        return { success: false, reason: 'no crafting table available' };
    }
    const tableRecipe = bot.recipesFor(targetId, null, 1, ctBlock)[0];
    if (!tableRecipe) {
        logger_1.log.warn(`[craft] No recipe for ${target} even with crafting table. Inventory: ${invSummary(bot)}`);
        return { success: false, reason: `no recipe for ${target} — missing materials` };
    }
    try {
        await bot.craft(tableRecipe, quantity, ctBlock);
        logger_1.log.success(`[craft] Crafted ${quantity}x ${target} (with table)`);
        return { success: true, reason: `crafted ${quantity}x ${target}` };
    }
    catch (e) {
        return { success: false, reason: `craft failed: ${e.message}` };
    }
}
// ─── Smelting ───────────────────────────────────────────────────────────────
async function smelt(bot, input, fuel, quantity) {
    const furnace = await getFurnace(bot);
    if (!furnace)
        return { success: false, reason: 'no furnace' };
    try {
        await (0, navigation_1.goToBlock)(bot, furnace);
        const f = await bot.openFurnace(furnace);
        const mcData = require('minecraft-data')(bot.version);
        const fuelId = mcData.itemsByName[fuel]?.id;
        const inputId = mcData.itemsByName[input]?.id;
        if (!fuelId || !inputId) {
            f.close();
            return { success: false, reason: 'unknown items' };
        }
        const inputItem = bot.inventory.findInventoryItem(inputId, null, false);
        const fuelItem = bot.inventory.findInventoryItem(fuelId, null, false);
        if (!inputItem || !fuelItem) {
            f.close();
            return { success: false, reason: `missing ${input} or ${fuel}` };
        }
        const count = Math.min(quantity, inputItem.count);
        // FIX Bug #3 / fuel math: was Math.ceil(count / 2) which assumed 1 fuel = 2 items.
        // Coal smelts 8 items, logs smelt 1.5, sticks 0.5. Use the lookup table.
        const perFuel = SMELT_PER_FUEL[fuel] ?? 1;
        const fuelNeeded = Math.ceil(count / perFuel);
        const fuelToUse = Math.min(fuelItem.count, fuelNeeded);
        await f.putFuel(fuelId, null, fuelToUse);
        await f.putInput(inputId, null, count);
        // FIX Bug #3: cap wait at 30s (was up to 90s), poll every 500ms (was 2s),
        // and check the interrupt flag each iteration so an emergency can abort.
        const start = Date.now();
        const maxWait = Math.min(count * 12_000, 30_000);
        while (Date.now() - start < maxWait) {
            // FIX Bug #3: yield to safety loop — break immediately if emergency fires
            if (interrupt_1.interruptGoal) {
                logger_1.log.warn('[smelt] interrupted by emergency');
                break;
            }
            await sleep(500);
            if ((f.outputItem()?.count ?? 0) >= count)
                break;
        }
        // FIX Bug #3: always take whatever partial output exists before closing
        const output = f.outputItem();
        if (output)
            await f.takeOutput();
        f.close();
        return { success: true, reason: `smelted ${count}x ${input}` };
    }
    catch (e) {
        return { success: false, reason: `smelt failed: ${e.message}` };
    }
}
// ─── Utility exports ────────────────────────────────────────────────────────
function listCraftable(bot) {
    const mcData = require('minecraft-data')(bot.version);
    const items = [
        'crafting_table', 'furnace', 'chest', 'torch', 'stick',
        'wooden_pickaxe', 'wooden_axe', 'wooden_sword',
        'stone_pickaxe', 'stone_axe', 'stone_sword',
        'iron_pickaxe', 'iron_axe', 'iron_sword',
        'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots',
        'shield', 'white_bed', 'bread',
    ];
    return items.filter(name => {
        try {
            const id = mcData.itemsByName[name]?.id;
            return id && bot.recipesFor(id, null, 1, null).length > 0;
        }
        catch {
            return false;
        }
    });
}
async function ensureItem(bot, item, quantity) {
    return executeCraft(bot, item, quantity);
}
