"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Executor = void 0;
const survive_1 = require("./goals/survive");
const gather_1 = require("./goals/gather");
const explore_1 = require("./goals/explore");
const build_1 = require("./goals/build");
const craft_1 = require("./goals/craft");
const farm_1 = require("./goals/farm");
const social_1 = require("./goals/social");
const mobs_1 = require("./data/mobs");
const logger_1 = require("./utils/logger");
class Executor {
    bot;
    learning;
    trust;
    world;
    constructor(bot, learning, trust, world) {
        this.bot = bot;
        this.learning = learning;
        this.trust = trust;
        this.world = world;
    }
    async run(goal) {
        logger_1.log.goal(`${goal.goal}(${goal.target}) — ${goal.reason}`);
        const start = Date.now();
        let result = { success: false, reason: 'not run' };
        try {
            switch (goal.goal) {
                case 'survive':
                    result = await (0, survive_1.executeSurvive)(this.bot, goal.target);
                    break;
                case 'gather':
                    result = await (0, gather_1.executeGather)(this.bot, goal.target);
                    break;
                case 'explore':
                    result = await (0, explore_1.executeExplore)(this.bot, goal.target, this.world);
                    break;
                case 'build':
                    result = await (0, build_1.executeBuild)(this.bot, goal.target);
                    break;
                // smelt routes through executeCraft — craft.ts already handles smelting via executeSmelt internally
                case 'craft':
                case 'smelt':
                    result = await (0, craft_1.executeCraft)(this.bot, goal.target);
                    break;
                case 'hunt':
                    result = await (0, farm_1.executeFarm)(this.bot, goal.target);
                    break;
                case 'social':
                    result = await (0, social_1.executeSocial)(this.bot, goal.target, this.trust);
                    break;
                default: result = { success: false, reason: 'unknown goal type' };
            }
        }
        catch (err) {
            result = { success: false, reason: err.message };
        }
        const duration = Date.now() - start;
        result.success
            ? logger_1.log.success(`${goal.goal}(${goal.target}): ${result.reason} [${(duration / 1000).toFixed(1)}s]`)
            : logger_1.log.warn(`${goal.goal}(${goal.target}) failed: ${result.reason}`);
        this.learning.record({
            goal: goal.goal,
            target: goal.target,
            success: result.success,
            duration,
            gained: result.gained ? { [goal.target]: result.gained } : {},
            timeOfDay: this.bot.time.timeOfDay < 12000 ? 'day' : 'night',
            nearbyThreats: this.nearbyHostileNames(),
            timestamp: Date.now(),
        });
        return result;
    }
    /** Pure-code emergency override — checked before every brain cycle, no LLM. */
    emergency() {
        const hp = this.bot.health;
        const food = this.bot.food;
        if (hp <= 4)
            return { goal: 'survive', target: 'flee', reason: 'critical health' };
        if (hp <= 8 && food > 14)
            return { goal: 'survive', target: 'flee', reason: 'low health flee' };
        if (food <= 6)
            return { goal: 'survive', target: 'eat', reason: 'starving' };
        if (hp <= 14 && food <= 14)
            return { goal: 'survive', target: 'eat', reason: 'eat to heal' };
        const hostile = (0, mobs_1.getNearestHostile)(this.bot, 5);
        if (hostile)
            return { goal: 'survive', target: 'flee', reason: `${hostile.name} too close` };
        return null;
    }
    nearbyHostileNames() {
        return Object.values(this.bot.entities)
            .filter(e => ['zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'drowned', 'husk'].includes(e.name ?? '') &&
            e.position?.distanceTo(this.bot.entity.position) < 16)
            .map(e => e.name);
    }
}
exports.Executor = Executor;
