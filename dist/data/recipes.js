"use strict";
// ============================================================
//  recipes.ts — Crafting + Smelting knowledge for the bot
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROGRESSION = exports.SMELTING_RECIPES = exports.CRAFTING_RECIPES = void 0;
exports.getCraftingRecipe = getCraftingRecipe;
exports.getSmeltingRecipes = getSmeltingRecipes;
exports.getAnyRecipe = getAnyRecipe;
exports.resolveRawMaterials = resolveRawMaterials;
exports.checkCraftability = checkCraftability;
exports.nextProgressionGoal = nextProgressionGoal;
// --------------- Crafting Recipes ---------------
// IMPORTANT: ingredient names must exactly match result names below.
// 'planks' was renamed to 'oak_planks' everywhere for consistency.
exports.CRAFTING_RECIPES = [
    // Wood basics
    { kind: 'crafting', result: 'oak_planks', count: 4, requires: { oak_log: 1 }, station: 'hand' },
    { kind: 'crafting', result: 'stick', count: 4, requires: { oak_planks: 2 }, station: 'hand' },
    { kind: 'crafting', result: 'crafting_table', count: 1, requires: { oak_planks: 4 }, station: 'hand' },
    { kind: 'crafting', result: 'chest', count: 1, requires: { oak_planks: 8 }, station: 'crafting_table' },
    { kind: 'crafting', result: 'bowl', count: 4, requires: { oak_planks: 3 }, station: 'hand' },
    { kind: 'crafting', result: 'ladder', count: 3, requires: { stick: 7 }, station: 'crafting_table' },
    // Wooden tools
    { kind: 'crafting', result: 'wooden_pickaxe', count: 1, requires: { oak_planks: 3, stick: 2 }, station: 'crafting_table' },
    { kind: 'crafting', result: 'wooden_axe', count: 1, requires: { oak_planks: 3, stick: 2 }, station: 'crafting_table' },
    { kind: 'crafting', result: 'wooden_sword', count: 1, requires: { oak_planks: 2, stick: 1 }, station: 'crafting_table' },
    { kind: 'crafting', result: 'wooden_shovel', count: 1, requires: { oak_planks: 1, stick: 2 }, station: 'crafting_table' },
    // Stone tools
    { kind: 'crafting', result: 'stone_pickaxe', count: 1, requires: { cobblestone: 3, stick: 2 }, station: 'crafting_table' },
    { kind: 'crafting', result: 'stone_axe', count: 1, requires: { cobblestone: 3, stick: 2 }, station: 'crafting_table' },
    { kind: 'crafting', result: 'stone_sword', count: 1, requires: { cobblestone: 2, stick: 1 }, station: 'crafting_table' },
    { kind: 'crafting', result: 'stone_shovel', count: 1, requires: { cobblestone: 1, stick: 2 }, station: 'crafting_table' },
    // Infrastructure
    { kind: 'crafting', result: 'furnace', count: 1, requires: { cobblestone: 8 }, station: 'crafting_table' },
    // Iron tools & armor
    { kind: 'crafting', result: 'iron_pickaxe', count: 1, requires: { iron_ingot: 3, stick: 2 }, station: 'crafting_table' },
    { kind: 'crafting', result: 'iron_axe', count: 1, requires: { iron_ingot: 3, stick: 2 }, station: 'crafting_table' },
    { kind: 'crafting', result: 'iron_sword', count: 1, requires: { iron_ingot: 2, stick: 1 }, station: 'crafting_table' },
    { kind: 'crafting', result: 'iron_shovel', count: 1, requires: { iron_ingot: 1, stick: 2 }, station: 'crafting_table' },
    { kind: 'crafting', result: 'iron_helmet', count: 1, requires: { iron_ingot: 5 }, station: 'crafting_table' },
    { kind: 'crafting', result: 'iron_chestplate', count: 1, requires: { iron_ingot: 8 }, station: 'crafting_table' },
    { kind: 'crafting', result: 'iron_leggings', count: 1, requires: { iron_ingot: 7 }, station: 'crafting_table' },
    { kind: 'crafting', result: 'iron_boots', count: 1, requires: { iron_ingot: 4 }, station: 'crafting_table' },
    { kind: 'crafting', result: 'shield', count: 1, requires: { oak_planks: 6, iron_ingot: 1 }, station: 'crafting_table' },
    // Misc
    { kind: 'crafting', result: 'torch', count: 4, requires: { coal: 1, stick: 1 }, station: 'hand' },
    { kind: 'crafting', result: 'bread', count: 1, requires: { wheat: 3 }, station: 'hand' },
    { kind: 'crafting', result: 'bow', count: 1, requires: { stick: 3, string: 3 }, station: 'crafting_table' },
];
// --------------- Smelting Recipes ---------------
exports.SMELTING_RECIPES = [
    { kind: 'smelting', result: 'iron_ingot', count: 1, input: 'iron_ore', fuel: 'oak_log', fuelPerSmelt: 0.5 },
    { kind: 'smelting', result: 'iron_ingot', count: 1, input: 'raw_iron', fuel: 'oak_log', fuelPerSmelt: 0.5 },
    { kind: 'smelting', result: 'gold_ingot', count: 1, input: 'gold_ore', fuel: 'oak_log', fuelPerSmelt: 0.5 },
    { kind: 'smelting', result: 'gold_ingot', count: 1, input: 'raw_gold', fuel: 'oak_log', fuelPerSmelt: 0.5 },
    { kind: 'smelting', result: 'coal', count: 1, input: 'coal_ore', fuel: 'oak_log', fuelPerSmelt: 0.5 },
    { kind: 'smelting', result: 'cooked_beef', count: 1, input: 'beef', fuel: 'oak_log', fuelPerSmelt: 0.5 },
    { kind: 'smelting', result: 'cooked_porkchop', count: 1, input: 'porkchop', fuel: 'oak_log', fuelPerSmelt: 0.5 },
    { kind: 'smelting', result: 'cooked_chicken', count: 1, input: 'chicken', fuel: 'oak_log', fuelPerSmelt: 0.5 },
    { kind: 'smelting', result: 'glass', count: 1, input: 'sand', fuel: 'oak_log', fuelPerSmelt: 0.5 },
    { kind: 'smelting', result: 'charcoal', count: 1, input: 'oak_log', fuel: 'oak_log', fuelPerSmelt: 1 },
];
// --------------- Lookup helpers ---------------
/** Find a crafting recipe by result name. */
function getCraftingRecipe(result) {
    return exports.CRAFTING_RECIPES.find(r => r.result === result) ?? null;
}
/** Find all smelting recipes that produce a given result. */
function getSmeltingRecipes(result) {
    return exports.SMELTING_RECIPES.filter(r => r.result === result);
}
/** Find any recipe (crafting OR smelting) that produces a result. */
function getAnyRecipe(result) {
    return getCraftingRecipe(result) ?? getSmeltingRecipes(result)[0] ?? null;
}
/**
 * Recursively resolves what raw materials are needed to produce `quantity`
 * of `item`. Expands every intermediate recipe automatically.
 *
 * @param item     - the item name to produce
 * @param quantity - how many finished items you want
 * @param visited  - internal cycle-guard, leave empty
 */
function resolveRawMaterials(item, quantity, visited = new Set()) {
    const result = { gather: {}, smelt: {}, craft: {} };
    if (visited.has(item)) {
        // Cycle detected — treat as raw material
        result.gather[item] = (result.gather[item] ?? 0) + quantity;
        return result;
    }
    visited.add(item);
    // --- Try crafting recipe first ---
    const craftRecipe = getCraftingRecipe(item);
    if (craftRecipe) {
        // How many times do we need to run the recipe?
        const runs = Math.ceil(quantity / craftRecipe.count);
        result.craft[item] = (result.craft[item] ?? 0) + runs * craftRecipe.count;
        for (const [ingredient, needed] of Object.entries(craftRecipe.requires)) {
            const sub = resolveRawMaterials(ingredient, needed * runs, new Set(visited));
            mergeInto(result, sub);
        }
        return result;
    }
    // --- Try smelting recipe ---
    const smeltRecipes = getSmeltingRecipes(item);
    if (smeltRecipes.length > 0) {
        const smelt = smeltRecipes[0]; // pick first (bot can be smarter here later)
        const runs = Math.ceil(quantity / smelt.count);
        result.smelt[item] = (result.smelt[item] ?? 0) + runs;
        // Resolve the input ore/raw item
        const inputSub = resolveRawMaterials(smelt.input, runs, new Set(visited));
        mergeInto(result, inputSub);
        // Resolve fuel
        const fuelNeeded = Math.ceil(smelt.fuelPerSmelt * runs);
        const fuelSub = resolveRawMaterials(smelt.fuel, fuelNeeded, new Set(visited));
        mergeInto(result, fuelSub);
        return result;
    }
    // --- No recipe found — this IS a raw material (gather from world) ---
    result.gather[item] = (result.gather[item] ?? 0) + quantity;
    return result;
}
function mergeInto(target, source) {
    for (const [k, v] of Object.entries(source.gather))
        target.gather[k] = (target.gather[k] ?? 0) + v;
    for (const [k, v] of Object.entries(source.smelt))
        target.smelt[k] = (target.smelt[k] ?? 0) + v;
    for (const [k, v] of Object.entries(source.craft))
        target.craft[k] = (target.craft[k] ?? 0) + v;
}
/**
 * Given the bot's current inventory, can it craft `quantity` of `item`?
 * Returns what's missing and what stations are required.
 */
function checkCraftability(item, quantity, inventory) {
    const raw = resolveRawMaterials(item, quantity);
    const missing = {};
    for (const [mat, needed] of Object.entries(raw.gather)) {
        const have = inventory[mat] ?? 0;
        if (have < needed)
            missing[mat] = needed - have;
    }
    const needsFurnace = Object.keys(raw.smelt).length > 0;
    const needsCraftingTable = (() => {
        // Walk craft items and check if any need a crafting table
        for (const craftedItem of Object.keys(raw.craft)) {
            const r = getCraftingRecipe(craftedItem);
            if (r && r.station === 'crafting_table')
                return true;
        }
        // Also check the top-level item
        const topRecipe = getCraftingRecipe(item);
        if (topRecipe && topRecipe.station === 'crafting_table')
            return true;
        return false;
    })();
    return {
        canCraft: Object.keys(missing).length === 0,
        missing,
        needsFurnace,
        needsCraftingTable,
    };
}
// --------------- Progression path ---------------
/**
 * Ordered list of items the bot should aim to unlock.
 * Each step unlocks the next — the bot can use this to self-direct.
 */
exports.PROGRESSION = [
    'oak_planks', // first thing — convert a log
    'crafting_table', // unlocks shaped recipes
    'stick',
    'wooden_pickaxe', // mine stone
    'wooden_axe',
    'wooden_sword',
    'stone_pickaxe', // mine iron ore
    'stone_sword',
    'furnace', // smelt iron
    'iron_pickaxe', // mine diamonds eventually
    'iron_sword',
    'iron_axe',
    'iron_helmet',
    'iron_chestplate',
    'iron_leggings',
    'iron_boots',
    'shield',
];
/**
 * Returns the next item in the progression the bot hasn't crafted yet.
 * Pass in the bot's known crafted items as a Set.
 */
function nextProgressionGoal(crafted) {
    return exports.PROGRESSION.find(item => !crafted.has(item)) ?? null;
}
