"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.movement = void 0;
const mineflayer_pathfinder_1 = require("mineflayer-pathfinder");
const { GoalBlock, GoalNear, GoalFollow, GoalXZ } = mineflayer_pathfinder_1.goals;
const reg = (bot) => bot.registry;
function getMovements(bot) {
    const movements = new mineflayer_pathfinder_1.Movements(bot);
    movements.canDig = true;
    movements.allowSprinting = true;
    return movements;
}
exports.movement = {
    /** Walk to exact block coordinates */
    async goTo(bot, x, y, z) {
        bot.pathfinder.setMovements(getMovements(bot));
        await bot.pathfinder.goto(new GoalBlock(Math.round(x), Math.round(y), Math.round(z)));
        return `Arrived at (${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)})`;
    },
    /** Walk to within N blocks of coordinates */
    async goNear(bot, x, y, z, range = 2) {
        bot.pathfinder.setMovements(getMovements(bot));
        await bot.pathfinder.goto(new GoalNear(Math.round(x), Math.round(y), Math.round(z), range));
        return `Reached near (${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)})`;
    },
    /** Walk to an XZ position ignoring Y */
    async goToSurface(bot, x, z) {
        bot.pathfinder.setMovements(getMovements(bot));
        await bot.pathfinder.goto(new GoalXZ(Math.round(x), Math.round(z)));
        return `Reached surface position (${Math.round(x)}, ${Math.round(z)})`;
    },
    /** Follow an entity by name */
    async follow(bot, targetName) {
        const target = Object.values(bot.entities).find((e) => e.name === targetName || e.username === targetName);
        if (!target)
            return `Cannot find "${targetName}" to follow`;
        bot.pathfinder.setMovements(getMovements(bot));
        bot.pathfinder.setGoal(new GoalFollow(target, 2), true);
        return `Following ${targetName}`;
    },
    /** Stop all movement immediately */
    async stop(bot) {
        bot.pathfinder.stop();
        return 'Stopped moving';
    },
    /** Find nearest block of a type and walk to it */
    async goToBlock(bot, blockName, maxDistance = 64) {
        const blockType = reg(bot).blocksByName[blockName];
        if (!blockType)
            return `Unknown block: ${blockName}`;
        const block = bot.findBlock({
            matching: blockType.id,
            maxDistance,
        });
        if (!block)
            return `No ${blockName} found within ${maxDistance} blocks`;
        bot.pathfinder.setMovements(getMovements(bot));
        await bot.pathfinder.goto(new GoalNear(block.position.x, block.position.y, block.position.z, 2));
        return `Reached ${blockName} at (${block.position.x}, ${block.position.y}, ${block.position.z})`;
    },
};
