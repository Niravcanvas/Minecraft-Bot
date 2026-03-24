import { Bot } from 'mineflayer';
import { getNearestPassive, FOOD_MOB_NAMES } from '../data/mobs';
import { getBestTool } from '../data/items';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function executeFarm(bot: Bot, target: string): Promise<{ success: boolean; reason: string; gained: number }> {
  const { goals } = require('mineflayer-pathfinder');

  // Hunt animals
  if (FOOD_MOB_NAMES.includes(target) || target === 'hunt') {
    const mobNames = target === 'hunt' ? FOOD_MOB_NAMES : [target];
    const mob = getNearestPassive(bot, mobNames, 96);
    if (!mob) return { success: false, reason: `no ${target} nearby`, gained: 0 };

    const sword = getBestTool(bot, 'sword');
    if (sword) try { await bot.equip(sword, 'hand'); } catch {}

    bot.pathfinder.setGoal(new goals.GoalNear(mob.position.x, mob.position.y, mob.position.z, 2), true);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await sleep(200);
      if (bot.entity.position.distanceTo(mob.position) < 3) break;
    }

    let hits = 0;
    for (let i = 0; i < 8; i++) {
      if (!bot.entities[mob.id]) break;
      try { await bot.attack(mob); hits++; await sleep(600); } catch { break; }
    }

    // Collect drops
    await sleep(800);
    const drops = (Object.values(bot.entities) as any[]).filter(e =>
      e.type === 'object' && e.objectType === 'item' &&
      e.position?.distanceTo(mob.position) < 6
    );
    for (const d of drops) {
      bot.pathfinder.setGoal(new goals.GoalNear(d.position.x, d.position.y, d.position.z, 1), true);
      await sleep(1000);
    }
    bot.pathfinder.setGoal(null);

    return { success: hits > 0, reason: `attacked ${target} ${hits} times`, gained: hits > 0 ? 1 : 0 };
  }

  return { success: false, reason: `unknown farm target: ${target}`, gained: 0 };
}