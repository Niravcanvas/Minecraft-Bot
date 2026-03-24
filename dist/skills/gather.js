"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gather = void 0;
const mineflayer_pathfinder_1 = require("mineflayer-pathfinder");
const { GoalNear } = mineflayer_pathfinder_1.goals;
// Shorthand so we don't repeat the cast everywhere
const reg = (bot) => bot.registry;
exports.gather = {
    /** Mine N blocks of a given type */
    async mine(bot, blockName, count = 1) {
        const blockType = reg(bot).blocksByName[blockName];
        if (!blockType)
            return `Unknown block: ${blockName}`;
        let mined = 0;
        for (let i = 0; i < count; i++) {
            const block = bot.findBlock({
                matching: blockType.id,
                maxDistance: 32,
            });
            if (!block)
                return `No more ${blockName} nearby. Mined ${mined}/${count}`;
            bot.pathfinder.setMovements(new mineflayer_pathfinder_1.Movements(bot));
            await bot.pathfinder.goto(new GoalNear(block.position.x, block.position.y, block.position.z, 3));
            // Equip best tool manually (no plugin needed)
            await equipBestToolFor(bot, blockName);
            await bot.dig(block);
            mined++;
        }
        return `Mined ${mined}× ${blockName}`;
    },
    /** Pick up nearby dropped items */
    async collectDrops(bot, maxDistance = 8) {
        const drops = Object.values(bot.entities).filter((e) => e.name === 'item' && e.position);
        if (!drops.length)
            return 'No dropped items nearby';
        let collected = 0;
        for (const drop of drops) {
            const dist = bot.entity.position.distanceTo(drop.position);
            if (dist > maxDistance)
                continue;
            bot.pathfinder.setMovements(new mineflayer_pathfinder_1.Movements(bot));
            await bot.pathfinder.goto(new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1));
            collected++;
        }
        return `Collected ${collected} dropped item(s)`;
    },
    /** Craft an item — looks for nearby crafting table automatically */
    async craft(bot, itemName, count = 1) {
        const item = reg(bot).itemsByName[itemName];
        if (!item)
            return `Unknown item: ${itemName}`;
        const craftingTableBlock = bot.findBlock({
            matching: reg(bot).blocksByName['crafting_table']?.id,
            maxDistance: 6,
        });
        const recipes = bot.recipesFor(item.id, null, 1, craftingTableBlock);
        if (!recipes.length) {
            return `No recipe available for ${itemName} — missing materials or crafting table?`;
        }
        await bot.craft(recipes[0], count, craftingTableBlock);
        return `Crafted ${count}× ${itemName}`;
    },
    /** Smelt an item in a nearby furnace */
    async smelt(bot, inputName, fuelName, count = 1) {
        const furnaceBlock = bot.findBlock({
            matching: reg(bot).blocksByName['furnace']?.id,
            maxDistance: 6,
        });
        if (!furnaceBlock)
            return 'No furnace nearby';
        const furnace = await bot.openFurnace(furnaceBlock);
        const inputItem = bot.inventory.items().find((i) => i.name === inputName);
        if (!inputItem) {
            furnace.close();
            return `No ${inputName} in inventory`;
        }
        const fuelItem = bot.inventory.items().find((i) => i.name === fuelName);
        if (!fuelItem) {
            furnace.close();
            return `No ${fuelName} in inventory`;
        }
        await furnace.putInput(inputItem.type, null, count);
        await furnace.putFuel(fuelItem.type, null, count);
        await new Promise((r) => setTimeout(r, count * 10000));
        const result = furnace.outputItem();
        if (result)
            await furnace.takeOutput();
        furnace.close();
        return `Smelted ${count}× ${inputName}`;
    },
    /** Equip the best available tool for a given tool type */
    async equipBestTool(bot, toolType) {
        return equipBestToolFor(bot, toolType);
    },
    /** Place a block from inventory at given coordinates */
    async placeBlock(bot, blockName, x, y, z) {
        const item = bot.inventory.items().find((i) => i.name === blockName);
        if (!item)
            return `${blockName} not in inventory`;
        await bot.equip(item, 'hand');
        const refBlock = bot.blockAt({ x: Math.round(x), y: Math.round(y) - 1, z: Math.round(z) });
        if (!refBlock)
            return `No surface to place ${blockName} on`;
        await bot.placeBlock(refBlock, { x: 0, y: 1, z: 0 });
        return `Placed ${blockName} at (${x}, ${y}, ${z})`;
    },
};
// ── Internal helper ────────────────────────────────────────────────────────────
async function equipBestToolFor(bot, material) {
    const tiers = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];
    const types = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'];
    // If caller passed a tool type directly (e.g. "pickaxe"), use that
    const knownType = types.find((t) => material.includes(t));
    const tryTypes = knownType ? [knownType] : types;
    for (const tier of tiers) {
        for (const type of tryTypes) {
            const item = bot.inventory.items().find((i) => i.name === `${tier}_${type}`);
            if (item) {
                await bot.equip(item, 'hand');
                return `Equipped ${tier}_${type}`;
            }
        }
    }
    return `No suitable tool found for "${material}"`;
}
