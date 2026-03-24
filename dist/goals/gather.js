"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeGather = executeGather;
const blocks_1 = require("../data/blocks");
const items_1 = require("../data/items");
const navigation_1 = require("../utils/navigation");
const logger_1 = require("../utils/logger");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// ─── Blocks that REQUIRE a tool to drop items ──────────────────────────────
// Everything else (logs, dirt, sand, gravel, etc.) can be mined by hand
const TOOL_REQUIRED_FOR_DROP = new Set([
    'stone', 'cobblestone', 'deepslate', 'andesite', 'granite', 'diorite', 'tuff',
    'coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'diamond_ore',
    'emerald_ore', 'lapis_ore', 'redstone_ore',
    'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_copper_ore',
    'deepslate_gold_ore', 'deepslate_diamond_ore', 'deepslate_emerald_ore',
    'deepslate_lapis_ore', 'deepslate_redstone_ore',
    'cobblestone_stairs', 'stone_bricks', 'nether_bricks',
]);
// ─── Smart tool equipping ───────────────────────────────────────────────────
async function equipToolForBlock(bot, blockName) {
    const toolType = blocks_1.TOOL_FOR_BLOCK[blockName] ?? 'any';
    if (toolType === 'any')
        return true;
    const tool = (0, items_1.getBestTool)(bot, toolType);
    if (!tool) {
        // No tool available — can we mine by hand?
        if (TOOL_REQUIRED_FOR_DROP.has(blockName)) {
            // This block won't drop anything without proper tool
            return false;
        }
        // Tool is optional (e.g., axe for wood) — mine by hand slowly
        return true;
    }
    // Check minimum tier for ores
    if (toolType === 'pickaxe') {
        const minTier = blocks_1.MIN_TIER_FOR_ORE[blockName] ?? 0;
        const heldTier = blocks_1.TOOL_TIERS.findIndex(t => t.pickaxe === tool.name);
        if (heldTier >= 0 && heldTier < minTier) {
            logger_1.log.warn(`[gather] ${tool.name} too weak for ${blockName} (need tier ${minTier}+)`);
            return false;
        }
    }
    try {
        await bot.equip(tool, 'hand');
    }
    catch { }
    return true;
}
// ─── Block scanning ─────────────────────────────────────────────────────────
function scanForBlocks(bot, blockIds, maxDist = 64) {
    const blocks = bot.findBlocks({ matching: blockIds, maxDistance: maxDist, count: 10 });
    const pos = bot.entity.position;
    return blocks
        .map(p => ({ pos: p, dist: p.distanceTo(pos) }))
        .sort((a, b) => a.dist - b.dist)
        .map(b => b.pos);
}
// ─── Drop collection ────────────────────────────────────────────────────────
async function collectNearbyDrops(bot) {
    const drops = Object.values(bot.entities).filter(e => e.type === 'object' && e.objectType === 'item' &&
        e.position?.distanceTo(bot.entity.position) < 10).slice(0, 6);
    for (const d of drops) {
        try {
            await (0, navigation_1.navigateTo)(bot, d.position.x, d.position.y, d.position.z, 1, 3000);
        }
        catch { }
    }
}
// ─── Main gather ────────────────────────────────────────────────────────────
async function executeGather(bot, target) {
    const mcData = require('minecraft-data')(bot.version);
    const blockNames = blocks_1.BLOCK_ALIASES[target] ?? [target];
    const blockIds = blockNames.map(n => mcData.blocksByName[n]?.id).filter(Boolean);
    if (!blockIds.length)
        return { success: false, reason: `no block ids for ${target}`, gained: 0 };
    let mined = 0;
    let navFails = 0;
    const MAX_NAV_FAILS = 4;
    const targetCount = target === 'wood' ? 16 : target === 'stone' ? 24 : 8;
    const triedPositions = new Set();
    for (let attempt = 0; attempt < 30 && mined < targetCount; attempt++) {
        if (navFails >= MAX_NAV_FAILS) {
            logger_1.log.warn(`[gather] Too many nav failures (${navFails}), stopping`);
            break;
        }
        // Find nearest untried block
        const positions = scanForBlocks(bot, blockIds, 64);
        let blockPos = null;
        for (const pos of positions) {
            const key = `${pos.x},${pos.y},${pos.z}`;
            if (!triedPositions.has(key)) {
                blockPos = pos;
                triedPositions.add(key);
                break;
            }
        }
        // Expand range if nothing nearby
        if (!blockPos) {
            const farPositions = scanForBlocks(bot, blockIds, 128);
            for (const pos of farPositions) {
                const key = `${pos.x},${pos.y},${pos.z}`;
                if (!triedPositions.has(key)) {
                    blockPos = pos;
                    triedPositions.add(key);
                    break;
                }
            }
            if (!blockPos)
                break;
        }
        const block = bot.blockAt(blockPos);
        if (!block || !blockIds.includes(block.type))
            continue;
        // Check tool — skip ONLY if tool is mandatory and missing
        const canMine = await equipToolForBlock(bot, block.name);
        if (!canMine)
            continue; // Silently skip (don't spam logs)
        // Navigate
        const reached = await (0, navigation_1.navigateTo)(bot, block.position.x, block.position.y, block.position.z, 3, 12_000);
        if (!reached) {
            navFails++;
            continue;
        }
        // Verify block still exists
        const current = bot.blockAt(block.position);
        if (!current || !blockIds.includes(current.type))
            continue;
        // Re-equip tool before digging
        await equipToolForBlock(bot, current.name);
        try {
            await bot.dig(current, true);
            mined++;
            navFails = 0;
            await sleep(150);
            // Collect the drop
            await sleep(200);
            await collectNearbyDrops(bot);
        }
        catch (e) {
            logger_1.log.warn(`[gather] Dig failed: ${e.message}`);
            continue;
        }
    }
    try {
        bot.pathfinder.setGoal(null);
    }
    catch { }
    if (mined > 0)
        await collectNearbyDrops(bot);
    const status = mined > 0 ? 'success' : 'failed';
    logger_1.log[mined > 0 ? 'success' : 'warn'](`gather(${target}): mined ${mined}x ${target}`);
    return { success: mined > 0, reason: `mined ${mined}x ${target}`, gained: mined };
}
