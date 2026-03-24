"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.combat = void 0;
const mineflayer_pathfinder_1 = require("mineflayer-pathfinder");
const { GoalFollow, GoalNear } = mineflayer_pathfinder_1.goals;
const HOSTILE_MOBS = [
    'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
    'enderman', 'witch', 'phantom', 'drowned', 'husk',
    'pillager', 'vindicator', 'ravager', 'blaze', 'ghast',
    'zombie_piglin', 'wither_skeleton', 'slime', 'magma_cube',
];
function getMovements(bot) {
    const movements = new mineflayer_pathfinder_1.Movements(bot);
    movements.allowSprinting = true;
    return movements;
}
exports.combat = {
    /** Attack a specific mob by name */
    async attack(bot, mobName) {
        const target = Object.values(bot.entities).find((e) => e.name?.includes(mobName) && e.position);
        if (!target)
            return `No ${mobName} found nearby`;
        bot.pathfinder.setMovements(getMovements(bot));
        await bot.pathfinder.goto(new GoalFollow(target, 2));
        bot.attack(target);
        return `Attacking ${target.name}`;
    },
    /** Attack the nearest hostile mob automatically */
    async attackNearest(bot) {
        const pos = bot.entity.position;
        const target = Object.values(bot.entities)
            .filter((e) => {
            if (!e.name || !e.position)
                return false;
            return HOSTILE_MOBS.some((h) => e.name.includes(h));
        })
            .sort((a, b) => a.position.distanceTo(pos) - b.position.distanceTo(pos))[0];
        if (!target)
            return 'No hostile mobs nearby';
        bot.pathfinder.setMovements(getMovements(bot));
        await bot.pathfinder.goto(new GoalFollow(target, 2));
        bot.attack(target);
        return `Attacking nearest hostile: ${target.name}`;
    },
    /** Flee from all nearby hostile mobs */
    async flee(bot, distance = 16) {
        const pos = bot.entity.position;
        const threats = Object.values(bot.entities).filter((e) => {
            if (!e.name || !e.position)
                return false;
            return (HOSTILE_MOBS.some((h) => e.name.includes(h)) &&
                e.position.distanceTo(pos) < distance);
        });
        if (!threats.length)
            return 'No threats to flee from';
        // Run in the opposite direction of the average threat position
        const avgX = threats.reduce((s, e) => s + e.position.x, 0) / threats.length;
        const avgZ = threats.reduce((s, e) => s + e.position.z, 0) / threats.length;
        const fleeX = pos.x + (pos.x - avgX) * 2;
        const fleeZ = pos.z + (pos.z - avgZ) * 2;
        bot.pathfinder.setMovements(getMovements(bot));
        await bot.pathfinder.goto(new GoalNear(Math.round(fleeX), Math.round(pos.y), Math.round(fleeZ), 2));
        return `Fled from ${threats.length} threat(s)`;
    },
    /** Check for nearby threats and return a summary */
    scanThreats(bot, radius = 16) {
        const pos = bot.entity.position;
        const threats = Object.values(bot.entities).filter((e) => {
            if (!e.name || !e.position)
                return false;
            return (HOSTILE_MOBS.some((h) => e.name.includes(h)) &&
                e.position.distanceTo(pos) < radius);
        });
        if (!threats.length)
            return 'No threats detected';
        return threats
            .map((e) => {
            const dist = Math.round(e.position.distanceTo(pos));
            return `${e.name}(${dist}m)`;
        })
            .join(', ');
    },
};
