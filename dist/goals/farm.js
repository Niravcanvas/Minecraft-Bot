"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeFarm = executeFarm;
const mobs_1 = require("../data/mobs");
const items_1 = require("../data/items");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function executeFarm(bot, target) {
    const { goals } = require('mineflayer-pathfinder');
    // Hunt animals
    if (mobs_1.FOOD_MOB_NAMES.includes(target) || target === 'hunt') {
        const mobNames = target === 'hunt' ? mobs_1.FOOD_MOB_NAMES : [target];
        const mob = (0, mobs_1.getNearestPassive)(bot, mobNames, 96);
        if (!mob)
            return { success: false, reason: `no ${target} nearby`, gained: 0 };
        const sword = (0, items_1.getBestTool)(bot, 'sword');
        if (sword)
            try {
                await bot.equip(sword, 'hand');
            }
            catch { }
        bot.pathfinder.setGoal(new goals.GoalNear(mob.position.x, mob.position.y, mob.position.z, 2), true);
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
            await sleep(200);
            if (bot.entity.position.distanceTo(mob.position) < 3)
                break;
        }
        let hits = 0;
        for (let i = 0; i < 8; i++) {
            if (!bot.entities[mob.id])
                break;
            try {
                await bot.attack(mob);
                hits++;
                await sleep(600);
            }
            catch {
                break;
            }
        }
        // Collect drops
        await sleep(800);
        const drops = Object.values(bot.entities).filter(e => e.type === 'object' && e.objectType === 'item' &&
            e.position?.distanceTo(mob.position) < 6);
        for (const d of drops) {
            bot.pathfinder.setGoal(new goals.GoalNear(d.position.x, d.position.y, d.position.z, 1), true);
            await sleep(1000);
        }
        bot.pathfinder.setGoal(null);
        return { success: hits > 0, reason: `attacked ${target} ${hits} times`, gained: hits > 0 ? 1 : 0 };
    }
    return { success: false, reason: `unknown farm target: ${target}`, gained: 0 };
}
