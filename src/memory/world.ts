import * as fs   from 'fs';
import * as path from 'path';
import { HOSTILE_NAMES } from '../data/mobs';

export interface Discovery { name: string; pos: { x: number; y: number; z: number }; timestamp: number; }

export class WorldMemory {
  discoveries: Record<string, Discovery[]> = {};
  private file: string;

  constructor(dataDir = './data') {
    this.file = path.join(dataDir, 'world.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.load();
  }

  private load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      // Migrate from old format (single discovery per key) to array format
      for (const [key, val] of Object.entries(raw)) {
        if (Array.isArray(val)) {
          this.discoveries[key] = val as Discovery[];
        } else if (val && typeof val === 'object' && 'pos' in (val as any)) {
          this.discoveries[key] = [val as Discovery];
        }
      }
    } catch { this.discoveries = {}; }
  }

  private save() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.discoveries, null, 2)); } catch {}
  }

  discover(name: string, pos: { x: number; y: number; z: number }): boolean {
    const rounded = { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) };

    if (!this.discoveries[name]) this.discoveries[name] = [];

    // Don't re-discover same position (within 10 blocks)
    const existing = this.discoveries[name].some(d =>
      Math.abs(d.pos.x - rounded.x) < 10 &&
      Math.abs(d.pos.y - rounded.y) < 10 &&
      Math.abs(d.pos.z - rounded.z) < 10
    );
    if (existing) return false;

    this.discoveries[name].push({ name, pos: rounded, timestamp: Date.now() });
    // Keep max 5 per type
    if (this.discoveries[name].length > 5) this.discoveries[name].shift();
    this.save();
    return true;
  }

  scan(bot: any) {
    const pos     = bot.entity.position;
    const entities = Object.values(bot.entities) as any[];

    if (entities.filter(e => e.name === 'villager').length >= 3)
      if (this.discover('village', pos)) console.log('🗺  Discovered: village!');

    // Scan nearby interesting blocks
    const targets: Record<string, string> = {
      chest: 'chest', furnace: 'furnace', crafting_table: 'crafting_table',
      smithing_table: 'smithing_table', enchanting_table: 'enchanting_table',
    };
    for (const [blockName, key] of Object.entries(targets)) {
      try {
        const mcData = require('minecraft-data')(bot.version);
        const block = bot.findBlock({ matching: mcData.blocksByName[blockName]?.id, maxDistance: 24 });
        if (block) this.discover(key, block.position);
      } catch {}
    }

    // Scan for beds
    try {
      const mcData = require('minecraft-data')(bot.version);
      const BED_BLOCKS: string[] = require('../data/blocks').BED_BLOCKS;
      const bedIds = BED_BLOCKS.map((n: string) => mcData.blocksByName[n]?.id).filter(Boolean);
      const bed = bot.findBlock({ matching: bedIds, maxDistance: 48 });
      if (bed) this.discover('bed', bed.position);
    } catch {}

    // Detect caves (air below y=50)
    if (pos.y < 50) this.discover('cave_entrance', pos);
  }

  getNearest(name: string): { x: number; y: number; z: number } | null {
    const list = this.discoveries[name];
    if (!list || list.length === 0) return null;
    return list[list.length - 1].pos;
  }

  /** Get nearest discovery by distance to a position */
  getNearestTo(name: string, pos: { x: number; y: number; z: number }): { x: number; y: number; z: number } | null {
    const list = this.discoveries[name];
    if (!list || list.length === 0) return null;
    let best = list[0].pos;
    let bestDist = Infinity;
    for (const d of list) {
      const dist = Math.hypot(d.pos.x - pos.x, d.pos.y - pos.y, d.pos.z - pos.z);
      if (dist < bestDist) { best = d.pos; bestDist = dist; }
    }
    return best;
  }

  knows(name: string): boolean {
    return !!this.discoveries[name] && this.discoveries[name].length > 0;
  }

  summary(): string {
    return Object.keys(this.discoveries).filter(k => this.discoveries[k].length > 0).slice(0, 8).join(',') || 'nothing';
  }
}