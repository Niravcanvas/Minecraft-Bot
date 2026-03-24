"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldMemory = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class WorldMemory {
    discoveries = {};
    file;
    constructor(dataDir = './data') {
        this.file = path.join(dataDir, 'world.json');
        fs.mkdirSync(dataDir, { recursive: true });
        this.load();
    }
    load() {
        try {
            if (!fs.existsSync(this.file))
                return;
            const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
            // Migrate from old format (single discovery per key) to array format
            for (const [key, val] of Object.entries(raw)) {
                if (Array.isArray(val)) {
                    this.discoveries[key] = val;
                }
                else if (val && typeof val === 'object' && 'pos' in val) {
                    this.discoveries[key] = [val];
                }
            }
        }
        catch {
            this.discoveries = {};
        }
    }
    save() {
        try {
            fs.writeFileSync(this.file, JSON.stringify(this.discoveries, null, 2));
        }
        catch { }
    }
    discover(name, pos) {
        const rounded = { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) };
        if (!this.discoveries[name])
            this.discoveries[name] = [];
        // Don't re-discover same position (within 10 blocks)
        const existing = this.discoveries[name].some(d => Math.abs(d.pos.x - rounded.x) < 10 &&
            Math.abs(d.pos.y - rounded.y) < 10 &&
            Math.abs(d.pos.z - rounded.z) < 10);
        if (existing)
            return false;
        this.discoveries[name].push({ name, pos: rounded, timestamp: Date.now() });
        // Keep max 5 per type
        if (this.discoveries[name].length > 5)
            this.discoveries[name].shift();
        this.save();
        return true;
    }
    scan(bot) {
        const pos = bot.entity.position;
        const entities = Object.values(bot.entities);
        if (entities.filter(e => e.name === 'villager').length >= 3)
            if (this.discover('village', pos))
                console.log('🗺  Discovered: village!');
        // Scan nearby interesting blocks
        const targets = {
            chest: 'chest', furnace: 'furnace', crafting_table: 'crafting_table',
            smithing_table: 'smithing_table', enchanting_table: 'enchanting_table',
        };
        for (const [blockName, key] of Object.entries(targets)) {
            try {
                const mcData = require('minecraft-data')(bot.version);
                const block = bot.findBlock({ matching: mcData.blocksByName[blockName]?.id, maxDistance: 24 });
                if (block)
                    this.discover(key, block.position);
            }
            catch { }
        }
        // Scan for beds
        try {
            const mcData = require('minecraft-data')(bot.version);
            const BED_BLOCKS = require('../data/blocks').BED_BLOCKS;
            const bedIds = BED_BLOCKS.map((n) => mcData.blocksByName[n]?.id).filter(Boolean);
            const bed = bot.findBlock({ matching: bedIds, maxDistance: 48 });
            if (bed)
                this.discover('bed', bed.position);
        }
        catch { }
        // Detect caves (air below y=50)
        if (pos.y < 50)
            this.discover('cave_entrance', pos);
    }
    getNearest(name) {
        const list = this.discoveries[name];
        if (!list || list.length === 0)
            return null;
        return list[list.length - 1].pos;
    }
    /** Get nearest discovery by distance to a position */
    getNearestTo(name, pos) {
        const list = this.discoveries[name];
        if (!list || list.length === 0)
            return null;
        let best = list[0].pos;
        let bestDist = Infinity;
        for (const d of list) {
            const dist = Math.hypot(d.pos.x - pos.x, d.pos.y - pos.y, d.pos.z - pos.z);
            if (dist < bestDist) {
                best = d.pos;
                bestDist = dist;
            }
        }
        return best;
    }
    knows(name) {
        return !!this.discoveries[name] && this.discoveries[name].length > 0;
    }
    summary() {
        return Object.keys(this.discoveries).filter(k => this.discoveries[k].length > 0).slice(0, 8).join(',') || 'nothing';
    }
}
exports.WorldMemory = WorldMemory;
