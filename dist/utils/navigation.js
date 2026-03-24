"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.navigateTo = navigateTo;
exports.goToBlock = goToBlock;
exports.lookAround = lookAround;
exports.lookAtNearestPlayer = lookAtNearestPlayer;
const mineflayer_pathfinder_1 = require("mineflayer-pathfinder");
const logger_1 = require("./logger");
// ─── Config ──────────────────────────────────────────────────────────────────
const DEFAULT_NAV_TIMEOUT_MS = 15_000;
const STUCK_CHECK_INTERVAL = 2_500;
const STUCK_MIN_MOVE = 0.3;
const STUCK_MAX_TICKS = 3; // 3 × 2.5s = 7.5s
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// ─── Stuck recovery behaviors ────────────────────────────────────────────────
async function unstick(bot) {
    // Try a sequence of recovery actions
    try {
        // 1. Stop all movement
        bot.clearControlStates();
        await sleep(200);
        // 2. Jump
        bot.setControlState('jump', true);
        await sleep(400);
        bot.setControlState('jump', false);
        // 3. Walk in a random direction briefly
        const dir = ['forward', 'back', 'left', 'right'][Math.floor(Math.random() * 4)];
        bot.setControlState(dir, true);
        bot.setControlState('jump', true);
        await sleep(800);
        bot.clearControlStates();
        await sleep(200);
        // 4. Try to dig the block in front of us if it's blocking
        try {
            const pos = bot.entity.position;
            const lookDir = bot.entity.yaw;
            const frontX = Math.round(pos.x - Math.sin(lookDir));
            const frontZ = Math.round(pos.z + Math.cos(lookDir));
            const Vec3 = require('vec3');
            // Check blocks at eye level and foot level
            for (const yOff of [0, 1]) {
                const blockPos = new Vec3(frontX, Math.floor(pos.y) + yOff, frontZ);
                const block = bot.blockAt(blockPos);
                if (block && block.type !== 0 && block.name !== 'bedrock') {
                    await bot.dig(block);
                    logger_1.log.info('[nav] Dug blocking block to unstick');
                    break;
                }
            }
        }
        catch { }
    }
    catch { }
}
// ─── Core navigation ─────────────────────────────────────────────────────────
async function navigateTo(bot, x, y, z, reach = 2, timeoutMs = DEFAULT_NAV_TIMEOUT_MS) {
    const goal = y !== null
        ? new mineflayer_pathfinder_1.goals.GoalNear(x, y, z, reach)
        : new mineflayer_pathfinder_1.goals.GoalXZ(x, z);
    return new Promise(resolve => {
        let lastPos = bot.entity.position.clone();
        let stuckTicks = 0;
        const timeout = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
        const stuckChecker = setInterval(async () => {
            const cur = bot.entity.position;
            const moved = cur.distanceTo(lastPos);
            if (moved < STUCK_MIN_MOVE) {
                stuckTicks++;
                if (stuckTicks >= STUCK_MAX_TICKS) {
                    logger_1.log.warn('[nav] stuck — attempting recovery');
                    // Try to unstick before giving up
                    try {
                        bot.pathfinder.setGoal(null);
                    }
                    catch { }
                    await unstick(bot);
                    cleanup();
                    resolve(false);
                }
            }
            else {
                stuckTicks = 0;
            }
            lastPos = cur.clone();
        }, STUCK_CHECK_INTERVAL);
        function onReached() { cleanup(); resolve(true); }
        function onFailed() { cleanup(); resolve(false); }
        bot.once('goal_reached', onReached);
        bot.once('goal_failed', onFailed);
        function cleanup() {
            clearTimeout(timeout);
            clearInterval(stuckChecker);
            bot.removeListener('goal_reached', onReached);
            bot.removeListener('goal_failed', onFailed);
            try {
                bot.pathfinder.setGoal(null);
            }
            catch { }
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
async function goToBlock(bot, block, reach = 2) {
    const { x, y, z } = block.position;
    return navigateTo(bot, x, y, z, reach);
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
