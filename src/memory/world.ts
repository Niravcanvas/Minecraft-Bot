import * as fs   from 'fs';
import * as path from 'path';
import { HOSTILE_NAMES } from '../data/mobs';

export interface Discovery { name: string; pos: { x: number; y: number; z: number }; timestamp: number; }

export class WorldMemory {
  discoveries: Record<string, Discovery> = {};
  private file: string;

  constructor(dataDir = './data') {
    this.file = path.join(dataDir, 'world.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.load();
  }

  private load() {
    try { if (fs.existsSync(this.file)) this.discoveries = JSON.parse(fs.readFileSync(this.file, 'utf-8')); }
    catch { this.discoveries = {}; }
  }

  private save() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.discoveries, null, 2)); } catch {}
  }

  discover(name: string, pos: { x: number; y: number; z: number }): boolean {
    if (this.discoveries[name]) return false;
    this.discoveries[name] = { name, pos: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) }, timestamp: Date.now() };
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

    // Detect caves (air below y=50)
    if (pos.y < 50) this.discover('cave_entrance', pos);
  }

  getNearest(name: string) { return this.discoveries[name]?.pos ?? null; }
  knows(name: string)      { return !!this.discoveries[name]; }
  summary(): string        { return Object.keys(this.discoveries).slice(0, 8).join(',') || 'nothing'; }
}