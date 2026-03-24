"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.survival = void 0;
const mineflayer_pathfinder_1 = require("mineflayer-pathfinder");
const { GoalNear } = mineflayer_pathfinder_1.goals;
// Best foods ranked by saturation (high to low)
const FOOD_PRIORITY = [
    'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_salmon',
    'cooked_chicken', 'cooked_rabbit', 'golden_carrot', 'bread',
    'baked_potato', 'carrot', 'apple', 'melon_slice', 'beef',
    'porkchop', 'chicken', 'potato', 'raw_salmon',
];
exports.survival = {
    /** Eat the best available food in inventory */
    async eat(bot, foodName) {
        const candidates = foodName ? [foodName] : FOOD_PRIORITY;
        for (const food of candidates) {
            const item = bot.inventory.items().find((i) => i.name === food);
            if (item) {
                await bot.equip(item, 'hand');
                await bot.consume();
                return `Ate ${food} — food now ${Math.round(bot.food)}/20`;
            }
        }
        return 'No food found in inventory';
    },
    /** Sleep in a nearby bed to skip the night */
    async sleep(bot) {
        const bed = bot.findBlock({
            matching: (b) => !!bot.isABed(b),
            maxDistance: 8,
        });
        if (!bed)
            return 'No bed nearby';
        const movements = new mineflayer_pathfinder_1.Movements(bot);
        bot.pathfinder.setMovements(movements);
        await bot.pathfinder.goto(new GoalNear(bed.position.x, bed.position.y, bed.position.z, 2));
        try {
            await bot.sleep(bed);
            await new Promise((resolve) => {
                bot.once('wake', () => resolve());
            });
            return 'Slept through the night';
        }
        catch {
            return 'Could not sleep — maybe not night time, or bed is obstructed';
        }
    },
    /** Check if it is currently night time */
    isNight(bot) {
        return bot.time.timeOfDay > 13000 && bot.time.timeOfDay < 23000;
    },
    /** Returns a full status snapshot of the bot */
    getStatus(bot) {
        const pos = bot.entity.position;
        const time = bot.time.timeOfDay;
        let timeLabel;
        if (time < 6000)
            timeLabel = 'dawn';
        else if (time < 12000)
            timeLabel = 'day';
        else if (time < 13000)
            timeLabel = 'sunset';
        else if (time < 23000)
            timeLabel = 'night';
        else
            timeLabel = 'midnight';
        const inv = bot.inventory.items()
            .map((i) => `${i.name}×${i.count}`)
            .join(', ') || 'empty';
        const nearby = Object.values(bot.entities)
            .filter((e) => e.id !== bot.entity.id && e.position)
            .slice(0, 8)
            .map((e) => {
            const dist = Math.round(e.position.distanceTo(bot.entity.position));
            return `${e.name ?? e.type}(${dist}m)`;
        })
            .join(', ') || 'none';
        return [
            `Position : (${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`,
            `Health   : ${Math.round(bot.health)}/20  Food: ${Math.round(bot.food)}/20  XP: ${bot.experience.level}`,
            `Time     : ${timeLabel} (${time})`,
            `Nearby   : ${nearby}`,
            `Inventory: ${inv}`,
        ].join('\n');
    },
    /** Check if the bot needs food urgently */
    needsFood(bot) {
        return bot.food < 14;
    },
    /** Check if health is critically low */
    isCritical(bot) {
        return bot.health <= 6;
    },
    /** Check if has a specific item */
    hasItem(bot, itemName, minCount = 1) {
        const item = bot.inventory.items().find((i) => i.name === itemName);
        return !!item && item.count >= minCount;
    },
};
