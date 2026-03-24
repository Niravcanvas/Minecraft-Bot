"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeGather = executeGather;
const blocks_1 = require("../data/blocks");
const items_1 = require("../data/items");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function equipForBlock(bot, blockName) {
    const toolType = blocks_1.TOOL_FOR_BLOCK[blockName] ?? 'any';
    if (toolType === 'any')
        return;
    const tool = (0, items_1.getBestTool)(bot, toolType);
    if (tool)
        try {
            await bot.equip(tool, 'hand');
        }
        catch { }
}
async function collectNearbyDrops(bot) {
    const { goals } = require('mineflayer-pathfinder');
    const drops = Object.values(bot.entities).filter(e => e.type === 'object' && e.objectType === 'item' &&
        e.position.distanceTo(bot.entity.position) < 12).slice(0, 8);
    for (const d of drops) {
        bot.pathfinder.setGoal(new goals.GoalNear(d.position.x, d.position.y, d.position.z, 1), true);
        await sleep(1200);
    }
}
async function executeGather(bot, target) {
    const { goals } = require('mineflayer-pathfinder');
    const mcData = require('minecraft-data')(bot.version);
    const blockNames = blocks_1.BLOCK_ALIASES[target] ?? [target];
    const blockIds = blockNames.map(n => mcData.blocksByName[n]?.id).filter(Boolean);
    if (!blockIds.length)
        return { success: false, reason: `no block ids for ${target}`, gained: 0 };
    let mined = 0;
    const targetCount = target === 'wood' ? 16 : target === 'stone' ? 32 : 12;
    for (let attempt = 0; attempt < 30 && mined < targetCount; attempt++) {
        const block = bot.findBlock({ matching: blockIds, maxDistance: 96, count: 1 });
        if (!block)
            break;
        // Equip best tool
        await equipForBlock(bot, block.name);
        // Navigate
        bot.pathfinder.setGoal(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2), true);
        // Wait until close enough or timeout
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
            await sleep(200);
            if (bot.entity.position.distanceTo(block.position) < 4)
                break;
        }
        // Check if block still exists
        const current = bot.blockAt(block.position);
        if (!current || !blockIds.includes(current.type))
            continue;
        try {
            await bot.dig(current, true);
            mined++;
            await sleep(150);
        }
        catch {
            continue;
        }
    }
    bot.pathfinder.setGoal(null);
    await collectNearbyDrops(bot);
    return { success: mined > 0, reason: `mined ${mined}x ${target}`, gained: mined };
}
