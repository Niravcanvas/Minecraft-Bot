"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeBuild = executeBuild;
const vec3_1 = require("vec3");
const craft_1 = require("./craft");
const craft_2 = require("./craft");
// ─── Config ──────────────────────────────────────────────────────────────────
const PLACE_REACH = 4;
const NAV_TIMEOUT_MS = 10_000;
const BETWEEN_PLACE_MS = 150; // small delay so server can keep up
// ─── Nav helper ──────────────────────────────────────────────────────────────
async function navigateTo(bot, x, y, z, reach = 2) {
    const { goals } = require('mineflayer-pathfinder');
    return new Promise(resolve => {
        const timeout = setTimeout(() => { cleanup(); resolve(false); }, NAV_TIMEOUT_MS);
        function onReached() { cleanup(); resolve(true); }
        function onFailed() { cleanup(); resolve(false); }
        bot.once('goal_reached', onReached);
        bot.once('goal_failed', onFailed);
        function cleanup() {
            clearTimeout(timeout);
            bot.removeListener('goal_reached', onReached);
            bot.removeListener('goal_failed', onFailed);
            bot.pathfinder.setGoal(null);
        }
        bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, reach), true);
    });
}
// ─── Site selection ──────────────────────────────────────────────────────────
/**
 * Finds a flat area of `width` x `depth` blocks near the bot.
 * Checks that the floor is solid and the space above is air.
 * Returns the origin corner (lowest x, ground y, lowest z) or null.
 */
function findFlatSite(bot, width, depth, searchRadius = 24) {
    const pos = bot.entity.position.floored();
    const mcData = require('minecraft-data')(bot.version);
    for (let dx = -searchRadius; dx <= searchRadius; dx += 2) {
        for (let dz = -searchRadius; dz <= searchRadius; dz += 2) {
            const origin = pos.offset(dx, 0, dz);
            let flat = true;
            outer: for (let x = 0; x < width; x++) {
                for (let z = 0; z < depth; z++) {
                    const floor = bot.blockAt(origin.offset(x, -1, z));
                    const space = bot.blockAt(origin.offset(x, 0, z));
                    const above = bot.blockAt(origin.offset(x, 1, z));
                    if (!floor || floor.type === 0) {
                        flat = false;
                        break outer;
                    } // not solid
                    if (!space || space.type !== 0) {
                        flat = false;
                        break outer;
                    } // not air
                    if (!above || above.type !== 0) {
                        flat = false;
                        break outer;
                    } // not air
                }
            }
            if (flat)
                return origin;
        }
    }
    return null;
}
// ─── Material preparation ─────────────────────────────────────────────────────
/** Tallies how many of each item a structure needs, then ensures the bot has them. */
async function prepareMaterials(bot, structure) {
    const needed = {};
    for (const spec of structure.blocks) {
        const itemName = structure.item(spec.block);
        needed[itemName] = (needed[itemName] ?? 0) + 1;
    }
    for (const [itemName, count] of Object.entries(needed)) {
        const result = await (0, craft_2.ensureItem)(bot, itemName, count);
        if (!result.success) {
            return { success: false, reason: `cannot gather material ${itemName} ×${count}: ${result.reason}` };
        }
    }
    return { success: true, reason: 'all materials ready' };
}
// ─── Block placement ──────────────────────────────────────────────────────────
async function placeBlock(bot, absolutePos, itemName) {
    const mcData = require('minecraft-data')(bot.version);
    const itemId = mcData.itemsByName[itemName]?.id;
    if (!itemId)
        return { success: false, reason: `unknown item: ${itemName}` };
    const item = bot.inventory.findInventoryItem(itemId, null, false);
    if (!item)
        return { success: false, reason: `${itemName} not in inventory` };
    // Navigate close enough to place
    const reached = await navigateTo(bot, absolutePos.x, absolutePos.y, absolutePos.z, PLACE_REACH);
    if (!reached)
        return { success: false, reason: `cannot reach placement position ${absolutePos}` };
    try {
        await bot.equip(item, 'hand');
        // We need to place against an adjacent solid face
        const offsets = [
            new vec3_1.Vec3(0, -1, 0), // below
            new vec3_1.Vec3(0, 1, 0), // above
            new vec3_1.Vec3(1, 0, 0),
            new vec3_1.Vec3(-1, 0, 0),
            new vec3_1.Vec3(0, 0, 1),
            new vec3_1.Vec3(0, 0, -1),
        ];
        for (const off of offsets) {
            const neighbor = bot.blockAt(absolutePos.plus(off));
            if (neighbor && neighbor.type !== 0) {
                await bot.placeBlock(neighbor, off.scaled(-1));
                return { success: true, reason: `placed ${itemName} at ${absolutePos}` };
            }
        }
        return { success: false, reason: `no solid face to place ${itemName} against at ${absolutePos}` };
    }
    catch (e) {
        return { success: false, reason: `place failed: ${e.message}` };
    }
}
// ─── Structure builder ────────────────────────────────────────────────────────
async function buildStructure(bot, structure, origin) {
    // Sort: place bottom layers first so we always have something to place against
    const sorted = [...structure.blocks].sort((a, b) => a.offset.y - b.offset.y);
    let placed = 0;
    const failures = [];
    for (const spec of sorted) {
        const absPos = origin.plus(new vec3_1.Vec3(spec.offset.x, spec.offset.y, spec.offset.z));
        const existing = bot.blockAt(absPos);
        // Skip if block is already there
        const mcData = require('minecraft-data')(bot.version);
        const targetId = mcData.blocksByName[spec.block]?.id;
        if (existing && existing.type === targetId) {
            placed++;
            continue;
        }
        const itemName = structure.item(spec.block);
        const result = await placeBlock(bot, absPos, itemName);
        if (result.success) {
            placed++;
        }
        else {
            failures.push(`${spec.block}@(${spec.offset.x},${spec.offset.y},${spec.offset.z}): ${result.reason}`);
        }
        await new Promise(r => setTimeout(r, BETWEEN_PLACE_MS));
    }
    const total = structure.blocks.length;
    if (failures.length === 0) {
        return { success: true, reason: `built ${structure.name} — ${placed}/${total} blocks placed` };
    }
    return {
        success: placed > 0,
        reason: `${structure.name}: ${placed}/${total} placed, ${failures.length} failed — first failure: ${failures[0]}`,
    };
}
// ─── Structure templates ──────────────────────────────────────────────────────
function makeShelt() {
    const blocks = [];
    // 5×5 footprint, 3 tall
    // Walls
    for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 5; x++) {
            blocks.push({ offset: { x, y, z: 0 }, block: 'oak_planks' }); // front
            blocks.push({ offset: { x, y, z: 4 }, block: 'oak_planks' }); // back
        }
        blocks.push({ offset: { x: 0, y, z: 1 }, block: 'oak_planks' }); // left
        blocks.push({ offset: { x: 0, y, z: 2 }, block: 'oak_planks' });
        blocks.push({ offset: { x: 0, y, z: 3 }, block: 'oak_planks' });
        blocks.push({ offset: { x: 4, y, z: 1 }, block: 'oak_planks' }); // right
        blocks.push({ offset: { x: 4, y, z: 2 }, block: 'oak_planks' });
        blocks.push({ offset: { x: 4, y, z: 3 }, block: 'oak_planks' });
    }
    // Roof
    for (let x = 0; x < 5; x++) {
        for (let z = 0; z < 5; z++) {
            blocks.push({ offset: { x, y: 3, z }, block: 'oak_planks' });
        }
    }
    // Door gap (front wall, centre, y=0 and y=1)
    // Remove those entries — filter them out
    const doorX = 2;
    const filtered = blocks.filter(b => !(b.offset.x === doorX && b.offset.z === 0 && b.offset.y <= 1));
    // Torches inside
    filtered.push({ offset: { x: 1, y: 2, z: 1 }, block: 'torch' });
    filtered.push({ offset: { x: 3, y: 2, z: 1 }, block: 'torch' });
    return {
        name: 'shelter',
        description: '5×5 wooden shelter with door gap and torches',
        blocks: filtered,
        item: (block) => block, // block name === item name for planks/torches
    };
}
function makeChestRoom() {
    const blocks = [];
    // 3×3 platform of cobblestone + ring of chests on top
    for (let x = 0; x < 3; x++) {
        for (let z = 0; z < 3; z++) {
            blocks.push({ offset: { x, y: 0, z }, block: 'cobblestone' });
        }
    }
    // Chest row
    for (let x = 0; x < 3; x++) {
        blocks.push({ offset: { x, y: 1, z: 0 }, block: 'chest' });
    }
    return {
        name: 'chest_room',
        description: 'Cobblestone base with chest row',
        blocks,
        item: (block) => block,
    };
}
function makeFurnaceStation() {
    return {
        name: 'furnace_station',
        description: 'Two furnaces side by side on a cobblestone slab',
        blocks: [
            { offset: { x: 0, y: 0, z: 0 }, block: 'cobblestone' },
            { offset: { x: 1, y: 0, z: 0 }, block: 'cobblestone' },
            { offset: { x: 2, y: 0, z: 0 }, block: 'cobblestone' },
            { offset: { x: 0, y: 1, z: 0 }, block: 'furnace' },
            { offset: { x: 2, y: 1, z: 0 }, block: 'furnace' },
            { offset: { x: 1, y: 1, z: 0 }, block: 'crafting_table' },
        ],
        item: (block) => block,
    };
}
const STRUCTURES = {
    shelter: makeShelt,
    chest_room: makeChestRoom,
    furnace_station: makeFurnaceStation,
};
// ─── Public entry point ───────────────────────────────────────────────────────
/**
 * Build a named structure near the bot.
 *
 * Supported targets:
 *   'shelter'         — basic 5×5 wooden shelter
 *   'chest_room'      — cobblestone base with chests
 *   'furnace_station' — two furnaces + crafting table
 *
 * For everything else it falls back to crafting (for "build a pickaxe" type commands).
 */
async function executeBuild(bot, target) {
    const structureFactory = STRUCTURES[target];
    if (!structureFactory) {
        // Fall back to crafting for item targets ('build a pickaxe' etc.)
        return (0, craft_1.executeCraft)(bot, target);
    }
    const structure = structureFactory();
    // 1. Find a suitable flat site
    const footprint = { w: 5, d: 5 }; // default; could be per-structure
    const origin = findFlatSite(bot, footprint.w, footprint.d);
    if (!origin) {
        return { success: false, reason: `no flat ${footprint.w}×${footprint.d} site found near bot for ${target}` };
    }
    // 2. Gather all required materials
    const matResult = await prepareMaterials(bot, structure);
    if (!matResult.success)
        return matResult;
    // 3. Build it
    return buildStructure(bot, structure, origin);
}
