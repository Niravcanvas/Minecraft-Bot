"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.navigateTo = navigateTo;
exports.goToBlock = goToBlock;
exports.wander = wander;
exports.lookAround = lookAround;
exports.lookAtNearestPlayer = lookAtNearestPlayer;
const mineflayer_pathfinder_1 = require("mineflayer-pathfinder");
const logger_1 = require("./logger");
// ─── Config ──────────────────────────────────────────────────────────────────
const DEFAULT_NAV_TIMEOUT_MS = 30_000;
const STUCK_CHECK_INTERVAL = 2_500;
const STUCK_MIN_MOVE = 0.1;
const STUCK_MAX_TICKS = 5;
const MAX_UNSTICK_ATTEMPTS = 4;
const RECOVERY_BETWEEN_MS = 400;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Vec3 = require('vec3');
// ─── Stuck recovery ───────────────────────────────────────────────────────────
async function unstick(bot, attempt = 0) {
    try {
        bot.clearControlStates();
        await sleep(RECOVERY_BETWEEN_MS);
        switch (attempt % MAX_UNSTICK_ATTEMPTS) {
            case 0: {
                const dir = ['forward', 'back', 'left', 'right'][Math.floor(Math.random() * 4)];
                bot.setControlState('jump', true);
                bot.setControlState(dir, true);
                await sleep(700);
                bot.clearControlStates();
                break;
            }
            case 1: {
                try {
                    const pos = bot.entity.position;
                    const yaw = bot.entity.yaw;
                    const dx = -Math.sin(yaw);
                    const dz = Math.cos(yaw);
                    const fx = Math.round(pos.x + dx);
                    const fz = Math.round(pos.z + dz);
                    for (const yOff of [0, 1, -1]) {
                        const blockPos = new Vec3(fx, Math.floor(pos.y) + yOff, fz);
                        const block = bot.blockAt(blockPos);
                        if (block && block.type !== 0 && block.name !== 'bedrock') {
                            await bot.dig(block);
                            logger_1.log.info('[nav] Dug blocking block to unstick');
                            break;
                        }
                    }
                }
                catch { }
                break;
            }
            case 2: {
                bot.setControlState('back', true);
                bot.setControlState('jump', true);
                bot.setControlState('sprint', true);
                await sleep(900);
                bot.clearControlStates();
                break;
            }
            case 3: {
                try {
                    const pos = bot.entity.position;
                    const below = bot.blockAt(new Vec3(Math.floor(pos.x), Math.floor(pos.y) - 1, Math.floor(pos.z)));
                    if (below && below.type !== 0 && below.name !== 'bedrock') {
                        await bot.dig(below);
                        logger_1.log.info('[nav] Dug block below to unstick');
                    }
                }
                catch { }
                bot.setControlState('jump', true);
                await sleep(500);
                bot.clearControlStates();
                break;
            }
        }
        await sleep(RECOVERY_BETWEEN_MS);
    }
    catch {
        bot.clearControlStates();
    }
}
// ─── Pathfinder settings ─────────────────────────────────────────────────────
function applyMovements(bot) {
    try {
        const moves = new mineflayer_pathfinder_1.Movements(bot);
        moves.allowSprinting = true;
        moves.canDig = true;
        moves.digCost = 2;
        moves.maxDropDown = 4;
        moves.allow1by1towers = true;
        bot.pathfinder.setMovements(moves);
    }
    catch { }
}
// ─── Core navigation ─────────────────────────────────────────────────────────
async function navigateTo(bot, x, y, z, reach = 2, timeoutMs = DEFAULT_NAV_TIMEOUT_MS) {
    applyMovements(bot);
    const goal = y !== null
        ? new mineflayer_pathfinder_1.goals.GoalNear(x, y, z, Math.max(2, reach))
        : new mineflayer_pathfinder_1.goals.GoalXZ(x, z);
    return new Promise(resolve => {
        let lastPos = bot.entity.position.clone();
        let stuckTicks = 0;
        let unstickCount = 0;
        let noPathCount = 0; // FIX Bug #8: track noPath occurrences separately
        let done = false;
        const dist = bot.entity.position.distanceTo(new Vec3(x, y ?? bot.entity.position.y, z));
        const adaptiveTimeout = Math.max(timeoutMs, Math.min(dist * 500, 90_000));
        const timeout = setTimeout(() => { cleanup(); resolve(false); }, adaptiveTimeout);
        const stuckChecker = setInterval(async () => {
            if (done)
                return;
            const cur = bot.entity.position;
            const moved = cur.distanceTo(lastPos);
            if (moved < STUCK_MIN_MOVE) {
                stuckTicks++;
                if (stuckTicks >= STUCK_MAX_TICKS) {
                    stuckTicks = 0;
                    unstickCount++;
                    if (unstickCount > MAX_UNSTICK_ATTEMPTS) {
                        logger_1.log.warn('[nav] stuck — all recovery attempts failed');
                        cleanup();
                        resolve(false);
                        return;
                    }
                    logger_1.log.warn(`[nav] stuck — attempting recovery (${unstickCount}/${MAX_UNSTICK_ATTEMPTS})`);
                    try {
                        bot.pathfinder.setGoal(null);
                    }
                    catch { }
                    await unstick(bot, unstickCount - 1);
                    if (done)
                        return;
                    applyMovements(bot);
                    try {
                        bot.pathfinder.setGoal(goal, true);
                    }
                    catch {
                        cleanup();
                        resolve(false);
                    }
                }
            }
            else {
                stuckTicks = 0;
                unstickCount = 0;
            }
            lastPos = cur.clone();
        }, STUCK_CHECK_INTERVAL);
        function onReached() { cleanup(); resolve(true); }
        function onFailed() { cleanup(); resolve(false); }
        function onPathUpdate(r) {
            if (r.status !== 'noPath')
                return;
            noPathCount++;
            if (noPathCount === 1) {
                // FIX Bug #8: on first noPath, try wandering to reposition then retry.
                // Previously nothing happened on the first noPath — the bot silently
                // burned through the full timeout (up to 90s) doing nothing useful.
                logger_1.log.warn('[nav] no path — trying wander reposition then retry');
                wander(bot, 8, 3).then(() => {
                    if (done)
                        return;
                    applyMovements(bot);
                    try {
                        bot.pathfinder.setGoal(goal, true);
                    }
                    catch {
                        cleanup();
                        resolve(false);
                    }
                });
            }
            else {
                // FIX Bug #8: second noPath after repositioning — path is genuinely
                // blocked. Give up immediately rather than waiting for the timeout.
                logger_1.log.warn('[nav] no path after reposition, giving up');
                cleanup();
                resolve(false);
            }
        }
        bot.once('goal_reached', onReached);
        bot.once('goal_failed', onFailed);
        bot.on('path_update', onPathUpdate);
        function cleanup() {
            if (done)
                return;
            done = true;
            clearTimeout(timeout);
            clearInterval(stuckChecker);
            bot.removeListener('goal_reached', onReached);
            bot.removeListener('goal_failed', onFailed);
            bot.removeListener('path_update', onPathUpdate);
            try {
                bot.pathfinder.setGoal(null);
            }
            catch { }
            bot.clearControlStates();
        }
        try {
            bot.pathfinder.setGoal(goal, true);
        }
        catch {
            cleanup();
            resolve(false);
        }
    });
}
// ─── Block navigation ─────────────────────────────────────────────────────────
async function goToBlock(bot, block, reach = 2) {
    const { x, y, z } = block.position;
    return navigateTo(bot, x, y, z, reach);
}
// ─── Wander ───────────────────────────────────────────────────────────────────
async function wander(bot, radius = 20, attempts = 5) {
    const pos = bot.entity.position;
    for (let i = 0; i < attempts; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = radius * 0.5 + Math.random() * radius * 0.5;
        const tx = Math.round(pos.x + Math.cos(angle) * dist);
        const tz = Math.round(pos.z + Math.sin(angle) * dist);
        const ok = await navigateTo(bot, tx, null, tz, 3, 12_000);
        if (ok)
            return true;
    }
    return false;
}
// ─── Head movement ────────────────────────────────────────────────────────────
async function lookAround(bot) {
    const yaw = (Math.random() - 0.5) * Math.PI;
    const pitch = (Math.random() - 0.5) * 0.6;
    try {
        await bot.look(bot.entity.yaw + yaw, pitch, false);
    }
    catch { }
}
async function lookAtNearestPlayer(bot, range = 16) {
    const players = Object.values(bot.players).filter(p => p.entity && p.username !== bot.username
        && p.entity.position.distanceTo(bot.entity.position) < range);
    if (players.length > 0 && players[0].entity) {
        try {
            await bot.lookAt(players[0].entity.position.offset(0, 1.6, 0));
        }
        catch { }
    }
}
