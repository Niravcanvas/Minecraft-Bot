"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Brain = void 0;
const strategies_1 = require("./data/strategies");
const items_1 = require("./data/items");
const combat_1 = require("./goals/combat");
const logger_1 = require("./utils/logger");
// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM = `You are the decision-making brain of a Minecraft survival bot. Reply ONLY with a single JSON object — no markdown, no explanation.

Schema: {"goal":"<goal>","target":"<target>","reason":"<8 words max>"}

Valid 'goal' values and their allowed 'target' values:
  survive  → eat | flee | sleep | equip_armor | health
  gather   → wood | stone | coal | iron | diamond | food | sand | gravel
  craft    → crafting_table | wooden_pickaxe | wooden_axe | wooden_sword | wooden_shovel |
             stone_pickaxe | stone_sword | furnace | iron_pickaxe | iron_sword | iron_axe |
             iron_helmet | iron_chestplate | iron_leggings | iron_boots | shield | torch | chest | white_bed
  smelt    → iron_ingot | charcoal
  hunt     → cow | sheep | chicken | pig
  explore  → village | cave | any | iron_ore | diamond_ore
  build    → shelter | chest_room | furnace_station
  combat   → nearest
  social   → greet | flee_threat | follow_trusted

IMPORTANT: You MUST use ONLY the goal and target values listed above. Never invent new goals or targets.
Pick the goal that best fits the bot's current state. Prioritise survival, then progression, then exploration.`;
// ─── Threat helpers ───────────────────────────────────────────────────────────
const HOSTILE_SET = new Set([
    'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
    'enderman', 'witch', 'slime', 'phantom', 'drowned', 'husk', 'stray',
]);
function nearestHostile(bot, radius = 16) {
    const pos = bot.entity.position;
    let closest = null, closestDist = radius + 1;
    for (const entity of Object.values(bot.entities)) {
        if (!entity?.position)
            continue;
        const name = entity.name?.toLowerCase() ?? '';
        if (!HOSTILE_SET.has(name))
            continue;
        const dist = entity.position.distanceTo(pos);
        if (dist < closestDist) {
            closest = entity;
            closestDist = dist;
        }
    }
    return closest;
}
function canSleep(bot, world) {
    const t = bot.time.timeOfDay;
    return t > 12542 && t < 23460
        && (hasBedInInventory(bot) || world.knows('bed'))
        && !nearestHostile(bot, 8);
}
// ─── Inventory helpers (WOOD-TYPE AGNOSTIC) ──────────────────────────────────
function inv(bot, name) { return (0, items_1.hasItem)(bot, name); }
function invAny(bot, names) { return (0, items_1.hasAny)(bot, names); }
function count(bot, name) { return (0, items_1.countItem)(bot, name); }
/** Check if bot has ANY type of log */
function hasAnyLogs(bot) {
    return bot.inventory.items().some(i => i.name.includes('_log'));
}
/** Count ALL logs regardless of wood type */
function totalLogCount(bot) {
    return bot.inventory.items()
        .filter(i => i.name.includes('_log'))
        .reduce((s, i) => s + i.count, 0);
}
/** Check if bot has ANY type of planks */
function hasAnyPlanks(bot) {
    return bot.inventory.items().some(i => i.name.includes('_planks'));
}
function totalPlanksCount(bot) {
    return bot.inventory.items()
        .filter(i => i.name.includes('_planks'))
        .reduce((s, i) => s + i.count, 0);
}
/** Check BEST pickaxe tier the bot currently has */
function bestPickaxeTier(bot) {
    const items = bot.inventory.items().map(i => i.name);
    if (items.some(n => n === 'diamond_pickaxe' || n === 'netherite_pickaxe'))
        return 3;
    if (items.some(n => n === 'iron_pickaxe'))
        return 2;
    if (items.some(n => n === 'stone_pickaxe'))
        return 1;
    if (items.some(n => n.includes('pickaxe')))
        return 0;
    return -1; // No pickaxe at all
}
function hasSword(bot) {
    return bot.inventory.items().some(i => i.name.includes('sword'));
}
function bestSwordTier(bot) {
    const items = bot.inventory.items().map(i => i.name);
    if (items.some(n => n === 'diamond_sword' || n === 'netherite_sword'))
        return 3;
    if (items.some(n => n === 'iron_sword'))
        return 2;
    if (items.some(n => n === 'stone_sword'))
        return 1;
    if (items.some(n => n.includes('sword')))
        return 0;
    return -1;
}
function hasFullIronArmor(bot) {
    return ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'].every(p => inv(bot, p));
}
function missingIronArmorPiece(bot) {
    for (const p of ['iron_chestplate', 'iron_leggings', 'iron_boots', 'iron_helmet']) {
        if (!inv(bot, p))
            return p;
    }
    return null;
}
function hasAnyArmor(bot) {
    return bot.inventory.items().some(i => i.name.includes('helmet') || i.name.includes('chestplate') ||
        i.name.includes('leggings') || i.name.includes('boots'));
}
/** Check if bot has any UNEQUIPPED armor in inventory */
function hasUnequippedArmor(bot) {
    const equipped = new Set();
    for (let slot = 5; slot <= 8; slot++) {
        const item = bot.inventory.slots[slot];
        if (item)
            equipped.add(item.type);
    }
    return bot.inventory.items().some(i => (i.name.includes('helmet') || i.name.includes('chestplate') ||
        i.name.includes('leggings') || i.name.includes('boots')) &&
        !equipped.has(i.type));
}
function hasFood(bot) {
    return invAny(bot, [
        'bread', 'golden_carrot', 'golden_apple', 'cooked_beef', 'cooked_chicken',
        'cooked_porkchop', 'cooked_mutton', 'carrot', 'apple', 'baked_potato', 'cooked_rabbit',
    ]);
}
function hasBedInInventory(bot) {
    return bot.inventory.items().some(i => i.name.includes('_bed'));
}
function woolCount(bot) {
    return bot.inventory.items()
        .filter(i => i.name.includes('wool'))
        .reduce((s, i) => s + i.count, 0);
}
function detectPhase(bot) {
    if (bestPickaxeTier(bot) >= 2 && hasFullIronArmor(bot))
        return 'late_game';
    if (bestPickaxeTier(bot) >= 1 && (inv(bot, 'furnace') || bot.inventory.items().some(i => i.name === 'furnace')))
        return 'mid_game';
    return 'early_game';
}
const LOOP_WINDOW_MS = 120_000;
const LOOP_THRESHOLD = 3;
const SUPPRESS_MS = 90_000;
const FLEE_SAFE_COOLDOWN_MS = 30_000;
// ─── Brain ────────────────────────────────────────────────────────────────────
class Brain {
    bot;
    llm;
    learning;
    trust;
    world;
    strategyQueue = [];
    lastLLMCall = 0;
    currentPhase;
    fleeSafeUntil = 0;
    failHistory = [];
    suppressed = new Map();
    playerGoals = [];
    constructor(bot, llm, learning, trust, world) {
        this.bot = bot;
        this.llm = llm;
        this.learning = learning;
        this.trust = trust;
        this.world = world;
        this.currentPhase = 'early_game';
        this.strategyQueue = [...(strategies_1.STRATEGIES.early_game ?? [])];
    }
    pushPlayerGoal(goal) {
        this.playerGoals.push(goal);
        logger_1.log.brain(`[player] queued: ${goal.goal}(${goal.target})`);
    }
    recordOutcome(goal, target, success, reason) {
        const key = `${goal}:${target}`;
        if (success) {
            if (goal === 'survive' && target === 'flee' && reason.includes('safe'))
                this.fleeSafeUntil = Date.now() + FLEE_SAFE_COOLDOWN_MS;
            this.suppressed.delete(key);
            return;
        }
        const now = Date.now();
        this.failHistory.push({ ts: now, goal, target });
        this.failHistory = this.failHistory.filter(r => r.ts > now - LOOP_WINDOW_MS);
        const fails = this.failHistory.filter(r => r.goal === goal && r.target === target).length;
        if (fails >= LOOP_THRESHOLD) {
            this.suppressed.set(key, now + SUPPRESS_MS);
            logger_1.log.warn(`[brain] suppressing ${key} for ${SUPPRESS_MS / 1000}s (failed ${fails}x)`);
            this.failHistory = this.failHistory.filter(r => !(r.goal === goal && r.target === target));
        }
    }
    isSuppressed(goal, target) {
        const until = this.suppressed.get(`${goal}:${target}`);
        if (!until)
            return false;
        if (Date.now() > until) {
            this.suppressed.delete(`${goal}:${target}`);
            return false;
        }
        return true;
    }
    // ── Main entry ────────────────────────────────────────────────────────────
    async pickGoal() {
        const phase = detectPhase(this.bot);
        if (phase !== this.currentPhase) {
            logger_1.log.brain(`[phase] ${this.currentPhase} → ${phase}`);
            this.currentPhase = phase;
            this.strategyQueue = [...(strategies_1.STRATEGIES[phase] ?? [])];
        }
        // 0. Player goals (highest)
        while (this.playerGoals.length > 0) {
            const pg = this.playerGoals.shift();
            if (!this.isSuppressed(pg.goal, pg.target))
                return pg;
        }
        // 1. Deterministic
        const det = this.deterministicGoal();
        if (det && !this.isSuppressed(det.goal, det.target)) {
            logger_1.log.brain(`[det] ${det.goal}(${det.target}) — ${det.reason}`);
            return det;
        }
        // 2. Strategy queue
        while (this.strategyQueue.length > 0) {
            const next = this.strategyQueue[0];
            if (this.alreadyAchieved(next) || this.isSuppressed(next.goal, next.target) || !this.canAttempt(next)) {
                this.strategyQueue.shift();
                continue;
            }
            this.strategyQueue.shift();
            logger_1.log.brain(`[strategy] ${next.goal}(${next.target})`);
            return next;
        }
        // 3. LLM (rate-limited 15s)
        if (Date.now() - this.lastLLMCall > 15_000) {
            this.lastLLMCall = Date.now();
            try {
                const goal = await this.llmGoal();
                if (!this.isSuppressed(goal.goal, goal.target)) {
                    logger_1.log.brain(`[llm] ${goal.goal}(${goal.target}) — ${goal.reason}`);
                    return goal;
                }
            }
            catch (err) {
                logger_1.log.warn(`LLM failed: ${err.message}`);
            }
        }
        // 4. Fallback — never idle
        return this.fallback();
    }
    // ── Deterministic — INVENTORY AWARE ───────────────────────────────────────
    deterministicGoal() {
        const hp = this.bot.health;
        const food = this.bot.food;
        // ── 0. Equip armor if we have unequipped pieces ──
        if (hasUnequippedArmor(this.bot))
            return { goal: 'survive', target: 'equip_armor', reason: 'unequipped armor in inventory' };
        // ── 1. Threat response ──
        const hostile = nearestHostile(this.bot, 12);
        if (hostile) {
            if ((0, combat_1.shouldFight)(this.bot) && hostile.position.distanceTo(this.bot.entity.position) < 16)
                return { goal: 'combat', target: 'nearest', reason: `${hostile.name} nearby — fighting` };
            if (hp <= 10 || hostile.position.distanceTo(this.bot.entity.position) < 5) {
                if (Date.now() > this.fleeSafeUntil)
                    return { goal: 'survive', target: 'flee', reason: `${hostile.name} attacking` };
            }
        }
        // ── 2. Health/hunger ──
        if (hp <= 10 && !hostile && hasFood(this.bot))
            return { goal: 'survive', target: 'eat', reason: 'low health, regen' };
        if (food <= 6)
            return { goal: 'survive', target: 'eat', reason: 'starving' };
        if (food <= 14 && hp < 18 && hasFood(this.bot))
            return { goal: 'survive', target: 'eat', reason: 'eat to regen' };
        // ── 3. Sleep ──
        if (canSleep(this.bot, this.world))
            return { goal: 'survive', target: 'sleep', reason: 'night time' };
        // ── 3b. Bed crafting if night and no bed ──
        const isNight = this.bot.time.timeOfDay > 12542;
        if (isNight && !hasBedInInventory(this.bot) && !this.world.knows('bed')) {
            if (woolCount(this.bot) >= 3 && hasAnyPlanks(this.bot))
                return { goal: 'craft', target: 'white_bed', reason: 'craft bed for night' };
            if (woolCount(this.bot) < 3)
                return { goal: 'hunt', target: 'sheep', reason: 'need wool for bed' };
        }
        // ── 4. Basic wood (only if truly empty) ──
        if (!hasAnyLogs(this.bot) && !hasAnyPlanks(this.bot))
            return { goal: 'gather', target: 'wood', reason: 'no wood at all' };
        // ── 5. Crafting table ──
        if (!inv(this.bot, 'crafting_table') && !this.world.knows('crafting_table'))
            return { goal: 'craft', target: 'crafting_table', reason: 'need crafting table' };
        // ── 6. Pickaxe — ONLY if we don't have one at all ──
        if (bestPickaxeTier(this.bot) < 0) {
            if (totalLogCount(this.bot) >= 2 || hasAnyPlanks(this.bot))
                return { goal: 'craft', target: 'wooden_pickaxe', reason: 'need first pickaxe' };
            return { goal: 'gather', target: 'wood', reason: 'need logs for pickaxe' };
        }
        // ── 7. Sword — ONLY if we don't have one at all ──
        if (!hasSword(this.bot)) {
            if (totalLogCount(this.bot) >= 1 || hasAnyPlanks(this.bot))
                return { goal: 'craft', target: 'wooden_sword', reason: 'need sword' };
            return { goal: 'gather', target: 'wood', reason: 'need logs for sword' };
        }
        // ── 8. Stone pickaxe UPGRADE (only if stuck on wooden) ──
        if (bestPickaxeTier(this.bot) < 1) {
            if (count(this.bot, 'cobblestone') >= 3)
                return { goal: 'craft', target: 'stone_pickaxe', reason: 'upgrade pickaxe' };
            return { goal: 'gather', target: 'stone', reason: 'need cobblestone' };
        }
        // ── 9. Food ──
        if (!hasFood(this.bot))
            return { goal: 'hunt', target: 'cow', reason: 'no food at all' };
        // ── 10. Furnace ──
        if (!inv(this.bot, 'furnace') && !this.world.knows('furnace')) {
            if (count(this.bot, 'cobblestone') >= 8)
                return { goal: 'craft', target: 'furnace', reason: 'need furnace' };
            return { goal: 'gather', target: 'stone', reason: 'need 8 cobblestone' };
        }
        // ── 11. Coal / fuel ──
        const hasCoal = count(this.bot, 'coal') > 0 || count(this.bot, 'charcoal') > 0;
        if (!hasCoal)
            return { goal: 'gather', target: 'coal', reason: 'need fuel' };
        // ── 12. Iron progression (only if we don't already have iron pickaxe) ──
        const hasRawIron = count(this.bot, 'raw_iron') > 0;
        if (bestPickaxeTier(this.bot) < 2) {
            if (count(this.bot, 'iron_ingot') >= 3)
                return { goal: 'craft', target: 'iron_pickaxe', reason: 'upgrade to iron' };
            if (hasRawIron && hasCoal)
                return { goal: 'smelt', target: 'iron_ingot', reason: 'smelt iron' };
            return { goal: 'explore', target: 'iron_ore', reason: 'find iron ore' };
        }
        // ── 13. Iron sword upgrade ──
        if (bestSwordTier(this.bot) < 2 && count(this.bot, 'iron_ingot') >= 2)
            return { goal: 'craft', target: 'iron_sword', reason: 'better sword' };
        // ── 14. Iron armor ──
        if (!hasFullIronArmor(this.bot)) {
            const missing = missingIronArmorPiece(this.bot);
            if (missing) {
                const cost = { iron_chestplate: 8, iron_leggings: 7, iron_boots: 4, iron_helmet: 5 };
                if (count(this.bot, 'iron_ingot') >= (cost[missing] ?? 5))
                    return { goal: 'craft', target: missing, reason: 'craft armor' };
                if (hasRawIron && hasCoal)
                    return { goal: 'smelt', target: 'iron_ingot', reason: 'smelt for armor' };
                return { goal: 'explore', target: 'iron_ore', reason: 'need more iron' };
            }
        }
        return null;
    }
    // ── Already achieved ─────────────────────────────────────────────────────
    alreadyAchieved(goal) {
        if (goal.goal === 'craft') {
            // Tool crafting: skip if we already have same or better tier
            if (goal.target.includes('pickaxe')) {
                const tier = goal.target.startsWith('wooden') ? 0 :
                    goal.target.startsWith('stone') ? 1 :
                        goal.target.startsWith('iron') ? 2 : 3;
                return bestPickaxeTier(this.bot) >= tier;
            }
            if (goal.target.includes('sword')) {
                const tier = goal.target.startsWith('wooden') ? 0 :
                    goal.target.startsWith('stone') ? 1 :
                        goal.target.startsWith('iron') ? 2 : 3;
                return bestSwordTier(this.bot) >= tier;
            }
            if (goal.target.includes('axe')) {
                // Skip if we have any axe already
                return this.bot.inventory.items().some(i => i.name.includes('_axe'));
            }
            return inv(this.bot, goal.target);
        }
        if (goal.goal === 'gather') {
            const thresholds = { wood: 16, stone: 16, coal: 8, iron: 12, food: 8 };
            const threshold = thresholds[goal.target] ?? 1;
            // Check all possible item names for this gather target
            if (goal.target === 'wood')
                return totalLogCount(this.bot) >= threshold || totalPlanksCount(this.bot) >= threshold;
            return count(this.bot, goal.target) >= threshold;
        }
        return false;
    }
    // ── Prerequisite check ───────────────────────────────────────────────────
    canAttempt(goal) {
        if (goal.goal === 'gather') {
            if (goal.target === 'stone')
                return bestPickaxeTier(this.bot) >= 0;
            if (goal.target === 'coal')
                return bestPickaxeTier(this.bot) >= 0;
            if (goal.target === 'iron')
                return bestPickaxeTier(this.bot) >= 1;
            if (goal.target === 'diamond')
                return bestPickaxeTier(this.bot) >= 2;
        }
        return true;
    }
    // ── LLM decision ─────────────────────────────────────────────────────────
    async llmGoal() {
        const pos = this.bot.entity.position;
        const near = Object.values(this.bot.entities)
            .filter(e => e?.position && e.position.distanceTo(pos) < 32)
            .map(e => {
            const name = e.name ?? e.username ?? 'unknown';
            const dist = Math.round(e.position.distanceTo(pos));
            return `${HOSTILE_SET.has(name) ? '!' : ''}${name}(${dist}m)`;
        }).slice(0, 6).join(' ');
        const invStr = this.bot.inventory.items().slice(0, 15).map(i => `${i.name}x${i.count}`).join(',');
        const craftable = (() => { try {
            return require('./goals/craft').listCraftable(this.bot).slice(0, 8).join(',');
        }
        catch {
            return '';
        } })();
        const time = this.bot.time.timeOfDay;
        const armed = (0, combat_1.shouldFight)(this.bot) ? 'armed' : 'unarmed';
        const pickTier = bestPickaxeTier(this.bot);
        const prompt = `phase=${this.currentPhase} hp=${Math.round(this.bot.health)}/20 food=${Math.round(this.bot.food)}/20 ` +
            `time=${time < 12542 ? 'day' : 'night'}(${time}) y=${Math.round(pos.y)} ${armed} pickaxe_tier=${pickTier}\n` +
            `nearby: ${near || 'none'}\ninventory: ${invStr || 'empty'}\n` +
            `craftable_now: ${craftable || 'nothing'}\n` +
            `has_bed: ${hasBedInInventory(this.bot) || this.world.knows('bed')}\n` +
            `learned: ${this.learning.lastThree()}\nknown: ${this.world.summary()}\n` +
            `What should I do next?`;
        const raw = await this.llm.chat([
            { role: 'system', content: SYSTEM },
            { role: 'user', content: prompt },
        ], 'json');
        const clean = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        if (!parsed.goal || !parsed.target)
            throw new Error('malformed');
        parsed.reason = parsed.reason ?? '';
        // Validate goal type
        const validGoals = new Set(['survive', 'gather', 'craft', 'smelt', 'hunt', 'explore', 'build', 'combat', 'social']);
        if (!validGoals.has(parsed.goal))
            throw new Error(`invalid goal: ${parsed.goal}`);
        return parsed;
    }
    // ── Fallback ─────────────────────────────────────────────────────────────
    fallback() {
        const queue = strategies_1.STRATEGIES[this.currentPhase] ?? [];
        const unachieved = queue.filter(g => !this.alreadyAchieved(g) && !this.isSuppressed(g.goal, g.target));
        if (unachieved.length > 0) {
            this.strategyQueue = [...unachieved];
            const next = this.strategyQueue.shift();
            logger_1.log.brain(`[fallback] reset queue → ${next.goal}(${next.target})`);
            return next;
        }
        logger_1.log.brain(`[fallback] exploring`);
        return { goal: 'explore', target: 'any', reason: 'roaming' };
    }
}
exports.Brain = Brain;
