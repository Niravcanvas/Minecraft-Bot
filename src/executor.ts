import { Bot } from 'mineflayer';
import { LearningMemory } from './memory/learning';
import { TrustMemory }    from './memory/trust';
import { WorldMemory }    from './memory/world';
import { executeSurvive } from './goals/survive';
import { executeGather }  from './goals/gather';
import { executeExplore } from './goals/explore';
import { executeBuild }   from './goals/build';
import { executeCraft }   from './goals/craft';
import { executeFarm }    from './goals/farm';
import { executeSocial }  from './goals/social';
import { getNearestHostile } from './data/mobs';
import { log } from './utils/logger';

export interface Goal {
  goal: 'survive' | 'gather' | 'explore' | 'build' | 'craft' | 'smelt' | 'hunt' | 'social';
  target: string;
  reason: string;
}

export class Executor {
  constructor(
    private bot:      Bot,
    private learning: LearningMemory,
    private trust:    TrustMemory,
    private world:    WorldMemory,
  ) {}

  async run(goal: Goal): Promise<{ success: boolean; reason: string }> {
    log.goal(`${goal.goal}(${goal.target}) — ${goal.reason}`);
    const start = Date.now();
    let result: { success: boolean; reason: string; gained?: number } = { success: false, reason: 'not run' };

    try {
      switch (goal.goal) {
        case 'survive': result = await executeSurvive(this.bot, goal.target);                  break;
        case 'gather':  result = await executeGather(this.bot, goal.target);                   break;
        case 'explore': result = await executeExplore(this.bot, goal.target, this.world);      break;
        case 'build':   result = await executeBuild(this.bot, goal.target);                    break;
        // smelt routes through executeCraft — craft.ts already handles smelting via executeSmelt internally
        case 'craft':
        case 'smelt':   result = await executeCraft(this.bot, goal.target);                    break;
        case 'hunt':    result = await executeFarm(this.bot, goal.target);                     break;
        case 'social':  result = await executeSocial(this.bot, goal.target, this.trust);       break;
        default:        result = { success: false, reason: 'unknown goal type' };
      }
    } catch (err: any) {
      result = { success: false, reason: err.message };
    }

    const duration = Date.now() - start;
    result.success
      ? log.success(`${goal.goal}(${goal.target}): ${result.reason} [${(duration/1000).toFixed(1)}s]`)
      : log.warn(`${goal.goal}(${goal.target}) failed: ${result.reason}`);

    this.learning.record({
      goal:          goal.goal,
      target:        goal.target,
      success:       result.success,
      duration,
      gained:        result.gained ? { [goal.target]: result.gained } : {},
      timeOfDay:     this.bot.time.timeOfDay < 12000 ? 'day' : 'night',
      nearbyThreats: this.nearbyHostileNames(),
      timestamp:     Date.now(),
    });

    return result;
  }

  /** Pure-code emergency override — checked before every brain cycle, no LLM. */
  emergency(): Goal | null {
    const hp   = this.bot.health;
    const food = this.bot.food;

    if (hp <= 4)                    return { goal: 'survive', target: 'flee', reason: 'critical health' };
    if (hp <= 8 && food > 14)       return { goal: 'survive', target: 'flee', reason: 'low health flee' };
    if (food <= 6)                  return { goal: 'survive', target: 'eat',  reason: 'starving'        };
    if (hp <= 14 && food <= 14)     return { goal: 'survive', target: 'eat',  reason: 'eat to heal'     };

    const hostile = getNearestHostile(this.bot, 5);
    if (hostile) return { goal: 'survive', target: 'flee', reason: `${hostile.name} too close` };

    return null;
  }

  private nearbyHostileNames(): string[] {
    return (Object.values(this.bot.entities) as any[])
      .filter(e =>
        ['zombie','skeleton','creeper','spider','cave_spider','drowned','husk'].includes(e.name ?? '') &&
        e.position?.distanceTo(this.bot.entity.position) < 16,
      )
      .map(e => e.name);
  }
}