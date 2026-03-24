"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_TIERS_ORDERED = exports.FOOD_NAMES = exports.FOODS = void 0;
exports.getBestFood = getBestFood;
exports.getBestTool = getBestTool;
exports.countItem = countItem;
exports.hasItem = hasItem;
exports.hasAny = hasAny;
exports.FOODS = [
    { name: 'golden_carrot', hunger: 6, saturation: 14.4 },
    { name: 'cooked_beef', hunger: 8, saturation: 12.8 },
    { name: 'cooked_porkchop', hunger: 8, saturation: 12.8 },
    { name: 'cooked_mutton', hunger: 6, saturation: 9.6 },
    { name: 'cooked_chicken', hunger: 6, saturation: 7.2 },
    { name: 'cooked_salmon', hunger: 6, saturation: 9.6 },
    { name: 'golden_apple', hunger: 4, saturation: 9.6 },
    { name: 'bread', hunger: 5, saturation: 6.0 },
    { name: 'baked_potato', hunger: 5, saturation: 6.0 },
    { name: 'carrot', hunger: 3, saturation: 3.6 },
    { name: 'apple', hunger: 4, saturation: 2.4 },
    { name: 'melon_slice', hunger: 2, saturation: 1.2 },
    { name: 'cookie', hunger: 2, saturation: 0.4 },
];
exports.FOOD_NAMES = exports.FOODS.map(f => f.name);
exports.TOOL_TIERS_ORDERED = [
    'netherite', 'diamond', 'iron', 'stone', 'wooden', 'golden'
];
function getBestFood(bot) {
    const mcData = require('minecraft-data')(bot.version);
    for (const food of exports.FOODS) {
        const id = mcData.itemsByName[food.name]?.id;
        const item = id ? bot.inventory.findInventoryItem(id, null, false) : null;
        if (item)
            return item;
    }
    return null;
}
function getBestTool(bot, toolType) {
    const mcData = require('minecraft-data')(bot.version);
    for (const tier of exports.TOOL_TIERS_ORDERED) {
        const name = `${tier}_${toolType}`;
        const id = mcData.itemsByName[name]?.id;
        const item = id ? bot.inventory.findInventoryItem(id, null, false) : null;
        if (item)
            return item;
    }
    return null;
}
function countItem(bot, name) {
    const mcData = require('minecraft-data')(bot.version);
    const id = mcData.itemsByName[name]?.id;
    if (!id)
        return 0;
    return bot.inventory.items().filter((i) => i.type === id).reduce((s, i) => s + i.count, 0);
}
function hasItem(bot, name, count = 1) {
    return countItem(bot, name) >= count;
}
function hasAny(bot, names) {
    return names.some(n => hasItem(bot, n));
}
