"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeCombat = executeCombat;
exports.shouldFight = shouldFight;
const mobs_1 = require("../data/mobs");
const items_1 = require("../data/items");
const navigation_1 = require("../utils/navigation");
const logger_1 = require("../utils/logger");
// ─── Config ──────────────────────────────────────────────────────────────────
const ATTACK_REACH = 3.5;
const ENGAGE_RANGE = 16;
const DISENGAGE_HP = 6;
const MAX_COMBAT_TIME_MS = 30_000;
const HIT_COOLDOWN_MS = 600;
const SHIELD_MOBS = new Set(['skeleton', 'stray', 'pillager', 'blaze']);
const CREEPER_FLEE_DIST = 6;
// ─── Helpers ─────────────────────────────────────────────────────────────────
function findHostilesInRange(bot, range) {
    const pos = bot.entity.position;
    return Object.values(bot.entities).filter(e => {
        if (!e?.position || e === bot.entity)
            return false;
        const name = (e.name ?? '').toLowerCase();
        if (!mobs_1.HOSTILE_NAMES.includes(name))
            return false;
        return e.position.distanceTo(pos) < range;
    });
}
async function equipBestMelee(bot) {
    const sword = (0, items_1.getBestTool)(bot, 'sword');
    const axe = (0, items_1.getBestTool)(bot, 'axe');
    const weapon = sword ?? axe;
    if (!weapon)
        return false;
    try {
        await bot.equip(weapon, 'hand');
        return true;
    }
    catch {
        return false;
    }
}
async function equipShield(bot) {
    const mcData = require('minecraft-data')(bot.version);
    const shieldId = mcData.itemsByName['shield']?.id;
    if (!shieldId)
        return false;
    const shield = bot.inventory.findInventoryItem(shieldId, null, false);
    if (!shield)
        return false;
    try {
        await bot.equip(shield, 'off-hand');
        return true;
    }
    catch {
        return false;
    }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// ─── Main combat executor ────────────────────────────────────────────────────
async function executeCombat(bot, target) {
    // Find what to fight
    let mob = null;
    if (target === 'nearest') {
        const hostiles = findHostilesInRange(bot, ENGAGE_RANGE);
        if (hostiles.length === 0)
            return { success: true, reason: 'no hostiles nearby' };
        // Sort by distance, fight closest
        hostiles.sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
        mob = hostiles[0];
    }
    else {
        // Find specific mob type
        const hostiles = findHostilesInRange(bot, ENGAGE_RANGE)
            .filter(e => (e.name ?? '').toLowerCase() === target.toLowerCase());
        if (hostiles.length === 0)
            return { success: false, reason: `no ${target} nearby` };
        mob = hostiles[0];
    }
    if (!mob)
        return { success: false, reason: 'no target found' };
    const mobName = mob.name ?? 'unknown';
    logger_1.log.goal(`⚔ Engaging ${mobName}`);
    // Equip weapon
    const armed = await equipBestMelee(bot);
    if (!armed) {
        return { success: false, reason: 'no weapon available — cannot fight' };
    }
    // Equip shield if fighting ranged mobs
    if (SHIELD_MOBS.has(mobName.toLowerCase())) {
        await equipShield(bot);
    }
    // Special case: creepers — hit and back away
    if (mobName.toLowerCase() === 'creeper') {
        return fightCreeper(bot, mob);
    }
    // Melee combat loop
    const start = Date.now();
    let hits = 0;
    let lastHit = 0;
    while (Date.now() - start < MAX_COMBAT_TIME_MS) {
        // Check if mob is dead
        if (!bot.entities[mob.id]) {
            logger_1.log.success(`⚔ Killed ${mobName} (${hits} hits)`);
            // Collect drops
            await collectDrops(bot, mob.position);
            return { success: true, reason: `killed ${mobName} in ${hits} hits` };
        }
        // Check HP — disengage if critical
        if (bot.health <= DISENGAGE_HP) {
            logger_1.log.warn(`⚔ Disengaging — HP critical (${bot.health})`);
            // Run away
            const away = bot.entity.position.minus(mob.position).normalize().scale(24);
            const dest = bot.entity.position.plus(away);
            await (0, navigation_1.navigateTo)(bot, dest.x, null, dest.z, 4, 8000);
            return { success: false, reason: `disengaged from ${mobName} — HP critical` };
        }
        const dist = bot.entity.position.distanceTo(mob.position);
        // Close in if too far
        if (dist > ATTACK_REACH) {
            bot.pathfinder.setGoal(new (require('mineflayer-pathfinder').goals.GoalFollow)(mob, 2), true);
            await sleep(300);
            continue;
        }
        // Attack with cooldown timing
        const now = Date.now();
        if (now - lastHit >= HIT_COOLDOWN_MS) {
            try {
                await bot.attack(mob);
                hits++;
                lastHit = now;
            }
            catch {
                break;
            }
        }
        await sleep(50);
    }
    bot.pathfinder.setGoal(null);
    return {
        success: hits > 0,
        reason: hits > 0 ? `fought ${mobName} (${hits} hits, still alive)` : `could not engage ${mobName}`,
    };
}
// ─── Creeper special handling ─────────────────────────────────────────────────
async function fightCreeper(bot, creeper) {
    let hits = 0;
    const start = Date.now();
    while (Date.now() - start < 15_000) {
        if (!bot.entities[creeper.id]) {
            await collectDrops(bot, creeper.position);
            return { success: true, reason: `killed creeper with hit-and-run (${hits} hits)` };
        }
        const dist = bot.entity.position.distanceTo(creeper.position);
        if (dist > ATTACK_REACH + 1) {
            // Move in for a hit
            const { goals: g } = require('mineflayer-pathfinder');
            bot.pathfinder.setGoal(new g.GoalFollow(creeper, 2), true);
            await sleep(400);
        }
        else if (dist <= ATTACK_REACH) {
            // Hit and immediately retreat
            try {
                await bot.attack(creeper);
                hits++;
            }
            catch { }
            // Sprint away
            const away = bot.entity.position.minus(creeper.position).normalize().scale(CREEPER_FLEE_DIST);
            const dest = bot.entity.position.plus(away);
            bot.setControlState('sprint', true);
            await (0, navigation_1.navigateTo)(bot, dest.x, null, dest.z, 2, 3000);
            bot.setControlState('sprint', false);
            await sleep(500);
        }
        await sleep(50);
    }
    bot.pathfinder.setGoal(null);
    return { success: hits > 0, reason: `fought creeper (${hits} hits)` };
}
// ─── Drop collection ──────────────────────────────────────────────────────────
async function collectDrops(bot, nearPos) {
    await sleep(500);
    const drops = Object.values(bot.entities).filter(e => e.type === 'object' && e.objectType === 'item' &&
        e.position?.distanceTo(nearPos) < 8).slice(0, 5);
    for (const d of drops) {
        try {
            await (0, navigation_1.navigateTo)(bot, d.position.x, d.position.y, d.position.z, 1, 3000);
        }
        catch { }
    }
}
// ─── Decision helper ──────────────────────────────────────────────────────────
/**
 * Should the bot fight or flee? Call this from brain/executor.
 */
function shouldFight(bot) {
    const hasSword = bot.inventory.items().some(i => i.name.includes('sword'));
    const hasAxe = bot.inventory.items().some(i => i.name.includes('_axe'));
    return (hasSword || hasAxe) && bot.health > DISENGAGE_HP;
}
