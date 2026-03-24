"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeBuild = executeBuild;
const vec3_1 = require("vec3");
const craft_1 = require("./craft");
const craft_2 = require("./craft");
// FIX Bug #9: removed the local navigateTo() that had a hardcoded 10s timeout
// and no stuck-recovery logic. Now imports the full-featured version from
// utils/navigation which has adaptive timeouts, 4-strategy stuck recovery,
// and noPath handling — so build navigation is as robust as gather/explore.
const navigation_1 = require("../utils/navigation");
// ─── Config ──────────────────────────────────────────────────────────────────
const PLACE_REACH = 4;
const BETWEEN_PLACE_MS = 150;
// NOTE: NAV_TIMEOUT_MS removed — utils/navigation uses adaptive timeouts.
// ─── Site selection ──────────────────────────────────────────────────────────
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
                    }
                    if (!space || space.type !== 0) {
                        flat = false;
                        break outer;
                    }
                    if (!above || above.type !== 0) {
                        flat = false;
                        break outer;
                    }
                }
            }
            if (flat)
                return origin;
        }
    }
    return null;
}
// ─── Material preparation ─────────────────────────────────────────────────────
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
    // FIX Bug #9: now calls the full navigateTo from utils/navigation instead of
    // the old local stub. Adaptive timeout + stuck recovery applies here too.
    const reached = await (0, navigation_1.navigateTo)(bot, absolutePos.x, absolutePos.y, absolutePos.z, PLACE_REACH);
    if (!reached)
        return { success: false, reason: `cannot reach placement position ${absolutePos}` };
    try {
        await bot.equip(item, 'hand');
        const offsets = [
            new vec3_1.Vec3(0, -1, 0),
            new vec3_1.Vec3(0, 1, 0),
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
    const sorted = [...structure.blocks].sort((a, b) => a.offset.y - b.offset.y);
    let placed = 0;
    const failures = [];
    for (const spec of sorted) {
        const absPos = origin.plus(new vec3_1.Vec3(spec.offset.x, spec.offset.y, spec.offset.z));
        const existing = bot.blockAt(absPos);
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
    for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 5; x++) {
            blocks.push({ offset: { x, y, z: 0 }, block: 'oak_planks' });
            blocks.push({ offset: { x, y, z: 4 }, block: 'oak_planks' });
        }
        blocks.push({ offset: { x: 0, y, z: 1 }, block: 'oak_planks' });
        blocks.push({ offset: { x: 0, y, z: 2 }, block: 'oak_planks' });
        blocks.push({ offset: { x: 0, y, z: 3 }, block: 'oak_planks' });
        blocks.push({ offset: { x: 4, y, z: 1 }, block: 'oak_planks' });
        blocks.push({ offset: { x: 4, y, z: 2 }, block: 'oak_planks' });
        blocks.push({ offset: { x: 4, y, z: 3 }, block: 'oak_planks' });
    }
    for (let x = 0; x < 5; x++) {
        for (let z = 0; z < 5; z++) {
            blocks.push({ offset: { x, y: 3, z }, block: 'oak_planks' });
        }
    }
    const doorX = 2;
    const filtered = blocks.filter(b => !(b.offset.x === doorX && b.offset.z === 0 && b.offset.y <= 1));
    filtered.push({ offset: { x: 1, y: 2, z: 1 }, block: 'torch' });
    filtered.push({ offset: { x: 3, y: 2, z: 1 }, block: 'torch' });
    return {
        name: 'shelter',
        description: '5×5 wooden shelter with door gap and torches',
        blocks: filtered,
        item: (block) => block,
    };
}
function makeChestRoom() {
    const blocks = [];
    for (let x = 0; x < 3; x++) {
        for (let z = 0; z < 3; z++) {
            blocks.push({ offset: { x, y: 0, z }, block: 'cobblestone' });
        }
    }
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
async function executeBuild(bot, target) {
    const structureFactory = STRUCTURES[target];
    if (!structureFactory) {
        return (0, craft_1.executeCraft)(bot, target);
    }
    const structure = structureFactory();
    const footprint = { w: 5, d: 5 };
    const origin = findFlatSite(bot, footprint.w, footprint.d);
    if (!origin) {
        return { success: false, reason: `no flat ${footprint.w}×${footprint.d} site found near bot for ${target}` };
    }
    const matResult = await prepareMaterials(bot, structure);
    if (!matResult.success)
        return matResult;
    return buildStructure(bot, structure, origin);
}
