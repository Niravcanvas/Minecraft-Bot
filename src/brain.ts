import { Bot }            from 'mineflayer';
import { OllamaClient }   from './llm';
import { LearningMemory } from './memory/learning';
import { TrustMemory }    from './memory/trust';
import { WorldMemory }    from './memory/world';
import { Goal }           from './executor';
import { getPhase, STRATEGIES } from './data/strategies';
import { hasItem, hasAny, countItem } from './data/items';
import { WOOD_BLOCKS } from './data/blocks';
import { log } from './utils/logger';

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM = `You are the decision-making brain of a Minecraft survival bot. Reply ONLY with a single JSON object — no markdown, no explanation.

Schema: {"goal":"<goal>","target":"<target>","reason":"<8 words max"}

Goals and valid targets:
  survive  → eat | flee | sleep | equip_armor | health
  gather   → wood | stone | coal | iron | diamond | food | sand | gravel
  craft    → crafting_table | wooden_pickaxe | wooden_axe | wooden_sword | wooden_shovel |
             stone_pickaxe | stone_sword | furnace | iron_pickaxe | iron_sword | iron_axe |
             iron_helmet | iron_chestplate | iron_leggings | iron_boots | shield | torch | chest
  smelt    → iron_ingot | charcoal
  hunt     → cow | sheep | chicken | pig
  explore  → village | cave | any | iron_ore | diamond_ore
  build    → shelter | chest_room | furnace_station
  social   → greet | flee_threat | follow_trusted

Pick the goal that best fits the bot's current state. Prioritise survival, then progression.`;

// ─── Threat helpers ───────────────────────────────────────────────────────────

const HOSTILE_NAMES = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
  'enderman', 'witch', 'slime', 'phantom', 'drowned', 'husk', 'stray',
]);

function nearestHostile(bot: Bot, radius = 16): any | null {
  const pos = bot.entity.position;
  let closest: any = null;
  let closestDist = radius + 1;
  for (const entity of Object.values(bot.entities) as any[]) {
    if (!entity?.position) continue;
    const name = entity.name?.toLowerCase() ?? entity.type?.toLowerCase() ?? '';
    if (!HOSTILE_NAMES.has(name)) continue;
    const dist = entity.position.distanceTo(pos);
    if (dist < closestDist) { closest = entity; closestDist = dist; }
  }
  return closest;
}

function isUnderThreat(bot: Bot, radius = 12): boolean {
  return nearestHostile(bot, radius) !== null;
}

function canSleep(bot: Bot, world: WorldMemory): boolean {
  const t = bot.time.timeOfDay;
  return t > 12542 && t < 23460
    && world.knows('bed')
    && !isUnderThreat(bot, 8);
}

// ─── Inventory helpers ────────────────────────────────────────────────────────

function inv(bot: Bot, name: string): boolean  { return hasItem(bot, name); }
function invAny(bot: Bot, names: string[]): boolean { return hasAny(bot, names); }
function count(bot: Bot, name: string): number  { return countItem(bot, name); }

function hasPickaxeTier(bot: Bot, tier: 'any' | 'stone' | 'iron' | 'diamond'): boolean {
  const items = bot.inventory.items().map(i => i.name);
  if (tier === 'any')     return items.some(n => n.includes('pickaxe'));
  if (tier === 'stone')   return items.some(n => n === 'stone_pickaxe' || hasPickaxeTier(bot, 'iron'));
  if (tier === 'iron')    return items.some(n => n === 'iron_pickaxe'  || hasPickaxeTier(bot, 'diamond'));
  if (tier === 'diamond') return items.some(n => n === 'diamond_pickaxe');
  return false;
}

function hasSword(bot: Bot): boolean {
  return bot.inventory.items().some(i => i.name.includes('sword'));
}

function hasFullIronArmor(bot: Bot): boolean {
  return ['iron_helmet','iron_chestplate','iron_leggings','iron_boots'].every(p => inv(bot, p));
}

function hasAnyIronArmor(bot: Bot): boolean {
  return ['iron_helmet','iron_chestplate','iron_leggings','iron_boots'].some(p => inv(bot, p));
}

function missingIronArmorPiece(bot: Bot): string | null {
  for (const p of ['iron_chestplate','iron_leggings','iron_boots','iron_helmet']) {
    if (!inv(bot, p)) return p;
  }
  return null;
}

function hasFood(bot: Bot): boolean {
  return invAny(bot, [
    'bread','golden_carrot','golden_apple','cooked_beef','cooked_chicken',
    'cooked_porkchop','cooked_mutton','carrot','apple','baked_potato','cooked_rabbit',
  ]);
}

function hasLogs(bot: Bot): boolean {
  return bot.inventory.items().some(i => WOOD_BLOCKS.some(w => i.name === w));
}

function hasPlanks(bot: Bot): boolean {
  return bot.inventory.items().some(i => i.name.includes('_planks'));
}

// ─── Wood count helper ────────────────────────────────────────────────────────

function logCount(bot: Bot): number {
  return bot.inventory.items()
    .filter(i => WOOD_BLOCKS.some(w => i.name === w))
    .reduce((s, i) => s + i.count, 0);
}

// ─── Phase tracking ───────────────────────────────────────────────────────────

type Phase = 'early_game' | 'mid_game' | 'late_game';

function detectPhase(bot: Bot): Phase {
  if (hasPickaxeTier(bot, 'iron') && hasFullIronArmor(bot)) return 'late_game';
  if (hasPickaxeTier(bot, 'stone') && inv(bot, 'furnace'))   return 'mid_game';
  return 'early_game';
}

// ─── Loop / cooldown tracking ─────────────────────────────────────────────────

interface FailRecord { ts: number; goal: string; target: string }

const FLEE_SAFE_COOLDOWN_MS = 30_000;   // after "no hostiles nearby", don't flee again for 30s
const LOOP_WINDOW_MS        = 120_000;  // 2-minute window to detect looping
const LOOP_THRESHOLD        = 3;        // same goal+target failing this many times = suppressed
const SUPPRESS_MS           = 90_000;   // suppressed goals cool down for 90s

// ─── Brain ────────────────────────────────────────────────────────────────────

export class Brain {
  private strategyQueue: Goal[] = [];
  private lastLLMCall   = 0;
  private currentPhase: Phase;

  // Flee cooldown — after a "safe" flee result, don't re-trigger for a while
  private fleeSafeUntil = 0;

  // Per-goal failure tracking for loop detection
  private failHistory: FailRecord[] = [];
  private suppressed: Map<string, number> = new Map(); // key → suppress-until ts

  constructor(
    private bot:      Bot,
    private llm:      OllamaClient,
    private learning: LearningMemory,
    private trust:    TrustMemory,
    private world:    WorldMemory,
  ) {
    this.currentPhase  = 'early_game';
    this.strategyQueue = [...(STRATEGIES.early_game ?? [])];
  }

  // ── Called by executor after a goal completes ─────────────────────────────

  /**
   * Record a goal outcome. Brain uses this to suppress looping goals and
   * manage the flee-safe cooldown.
   */
  recordOutcome(goal: string, target: string, success: boolean, reason: string): void {
    const key = `${goal}:${target}`;

    if (success) {
      // If flee succeeded because "no hostiles nearby", start cooldown so we
      // don't immediately re-trigger flee on the next tick due to low HP.
      if (goal === 'survive' && target === 'flee' && reason.includes('no hostiles')) {
        this.fleeSafeUntil = Date.now() + FLEE_SAFE_COOLDOWN_MS;
        log.brain(`[flee] safe cooldown for ${FLEE_SAFE_COOLDOWN_MS / 1000}s`);
      }
      // Successful goal clears its suppression
      this.suppressed.delete(key);
      return;
    }

    // Track failure
    const now = Date.now();
    this.failHistory.push({ ts: now, goal, target });

    // Prune old records outside the window
    const cutoff = now - LOOP_WINDOW_MS;
    this.failHistory = this.failHistory.filter(r => r.ts > cutoff);

    // Count recent failures for this key
    const recentFails = this.failHistory.filter(
      r => r.goal === goal && r.target === target,
    ).length;

    if (recentFails >= LOOP_THRESHOLD) {
      const until = now + SUPPRESS_MS;
      this.suppressed.set(key, until);
      log.warn(`[brain] suppressing ${key} for ${SUPPRESS_MS / 1000}s (failed ${recentFails}x)`);
      // Clear from fail history so it can recover after cooldown
      this.failHistory = this.failHistory.filter(
        r => !(r.goal === goal && r.target === target),
      );
    }
  }

  private isSuppressed(goal: string, target: string): boolean {
    const key   = `${goal}:${target}`;
    const until = this.suppressed.get(key);
    if (!until) return false;
    if (Date.now() > until) { this.suppressed.delete(key); return false; }
    return true;
  }

  // ── Main entry ────────────────────────────────────────────────────────────

  async pickGoal(): Promise<Goal> {
    // Phase transition
    const phase = detectPhase(this.bot);
    if (phase !== this.currentPhase) {
      log.brain(`[phase] ${this.currentPhase} → ${phase}`);
      this.currentPhase  = phase;
      this.strategyQueue = [...(STRATEGIES[phase] ?? [])];
    }

    // 1. Deterministic — instant, no LLM
    const det = this.deterministicGoal();
    if (det) {
      if (this.isSuppressed(det.goal, det.target)) {
        log.brain(`[det] suppressed ${det.goal}(${det.target}), skipping`);
      } else {
        log.brain(`[det] ${det.goal}(${det.target}) — ${det.reason}`);
        return det;
      }
    }

    // 2. Strategy queue
    while (this.strategyQueue.length > 0) {
      const next = this.strategyQueue[0];
      if (this.alreadyAchieved(next)) {
        log.brain(`[strategy] skip ${next.goal}(${next.target}) — already done`);
        this.strategyQueue.shift();
        continue;
      }
      if (this.isSuppressed(next.goal, next.target)) {
        log.brain(`[strategy] suppressed ${next.goal}(${next.target}), skipping`);
        this.strategyQueue.shift();
        continue;
      }
      this.strategyQueue.shift();
      log.brain(`[strategy] ${next.goal}(${next.target})`);
      return next;
    }

    // 3. LLM — rate-limited to once per 60s
    const now = Date.now();
    if (now - this.lastLLMCall > 60_000) {
      this.lastLLMCall = now;
      try {
        const goal = await this.llmGoal();
        if (!this.isSuppressed(goal.goal, goal.target)) {
          log.brain(`[llm] ${goal.goal}(${goal.target}) — ${goal.reason}`);
          return goal;
        }
        log.brain(`[llm] suppressed ${goal.goal}(${goal.target}), using fallback`);
      } catch (err: any) {
        log.warn(`LLM failed: ${err.message} — using fallback`);
      }
    }

    // 4. Hardcoded fallback
    return this.fallback();
  }

  // ── Deterministic goal logic ──────────────────────────────────────────────

  private deterministicGoal(): Goal | null {
    const hp   = this.bot.health;
    const food = this.bot.food;

    // ── 1. Immediate threat ────────────────────────────────────────────────
    const hostile = nearestHostile(this.bot, 12);
    if (hostile) {
      const dist = hostile.position.distanceTo(this.bot.entity.position);
      if (hp <= 10 || dist < 5) {
        // Only flee if not in the "safe" cooldown window
        if (Date.now() > this.fleeSafeUntil) {
          return { goal: 'survive', target: 'flee', reason: `${hostile.name} attacking` };
        }
      }
      if (!hasSword(this.bot) && dist < 8 && Date.now() > this.fleeSafeUntil) {
        return { goal: 'survive', target: 'flee', reason: 'no sword, enemy near' };
      }
    }

    // ── 2. Low health with NO hostile nearby — don't flee, just eat ───────
    //    This is the core fix: hp ≤ 10 with no hostile = eat, not flee.
    if (hp <= 10 && !hostile) {
      if (hasFood(this.bot)) return { goal: 'survive', target: 'eat', reason: 'low health, regen' };
      // No food and low hp — flee cooldown is done, but there's nothing to flee FROM.
      // Just wait it out by exploring rather than spam-fleeing.
    }

    // ── 3. Hunger / healing ────────────────────────────────────────────────
    if (food <= 6)  return { goal: 'survive', target: 'eat', reason: 'starving' };
    if (food <= 14 && hp < 18)
                    return { goal: 'survive', target: 'eat', reason: 'eat to regen' };

    // ── 4. Night / sleep ───────────────────────────────────────────────────
    if (canSleep(this.bot, this.world))
      return { goal: 'survive', target: 'sleep', reason: 'night time' };

    // ── 5. Wood — but only if we REALLY need it ───────────────────────────
    //    Check log count; if we have some planks, don't re-gather yet.
    if (!hasLogs(this.bot) && !hasPlanks(this.bot))
      return { goal: 'gather', target: 'wood', reason: 'no wood at all' };

    // ── 6. Crafting table ──────────────────────────────────────────────────
    if (!inv(this.bot, 'crafting_table') && !this.world.knows('crafting_table'))
      return { goal: 'craft', target: 'crafting_table', reason: 'need crafting table' };

    // ── 7. Basic tools — with prerequisite awareness ───────────────────────
    //    BEFORE returning "craft wooden_pickaxe", verify we have enough logs.
    //    If not, gather first. This stops the craft→fail→craft loop.
    if (!hasPickaxeTier(this.bot, 'any')) {
      // wooden_pickaxe needs 3 planks (1.5 logs) + 2 sticks — so 2 logs minimum
      if (logCount(this.bot) >= 2 || hasPlanks(this.bot))
        return { goal: 'craft', target: 'wooden_pickaxe', reason: 'need pickaxe' };
      return { goal: 'gather', target: 'wood', reason: 'need logs for pickaxe' };
    }

    if (!hasSword(this.bot)) {
      if (logCount(this.bot) >= 1 || hasPlanks(this.bot))
        return { goal: 'craft', target: 'wooden_sword', reason: 'need sword' };
      return { goal: 'gather', target: 'wood', reason: 'need logs for sword' };
    }

    // ── 8. Crafting table prerequisite check ──────────────────────────────
    //    (Only relevant if we somehow skipped step 6)
    if (!inv(this.bot, 'crafting_table') && !this.world.knows('crafting_table')) {
      if (logCount(this.bot) >= 1 || hasPlanks(this.bot))
        return { goal: 'craft', target: 'crafting_table', reason: 'need crafting table' };
      return { goal: 'gather', target: 'wood', reason: 'need logs for crafting table' };
    }

    // ── 9. Stone pickaxe upgrade ───────────────────────────────────────────
    if (!hasPickaxeTier(this.bot, 'stone')) {
      if (count(this.bot, 'cobblestone') >= 3)
        return { goal: 'craft', target: 'stone_pickaxe', reason: 'upgrade pickaxe' };
      return { goal: 'gather', target: 'stone', reason: 'need cobblestone' };
    }

    // ── 10. Food supply ────────────────────────────────────────────────────
    if (!hasFood(this.bot))
      return { goal: 'hunt', target: 'cow', reason: 'no food at all' };

    // ── 11. Furnace ────────────────────────────────────────────────────────
    if (!inv(this.bot, 'furnace') && !this.world.knows('furnace')) {
      if (count(this.bot, 'cobblestone') >= 8)
        return { goal: 'craft', target: 'furnace', reason: 'need furnace for smelting' };
      return { goal: 'gather', target: 'stone', reason: 'need 8 cobblestone for furnace' };
    }

    // ── 12. Coal (fuel before iron) ────────────────────────────────────────
    const hasCoal = count(this.bot, 'coal') > 0 || count(this.bot, 'charcoal') > 0;
    if (!hasCoal)
      return { goal: 'gather', target: 'coal', reason: 'need fuel for smelting' };

    // ── 13. Iron progression ───────────────────────────────────────────────
    const hasRawIron = count(this.bot, 'raw_iron') > 0 || count(this.bot, 'iron_ore') > 0;

    if (!hasPickaxeTier(this.bot, 'iron')) {
      if (count(this.bot, 'iron_ingot') >= 3)
        return { goal: 'craft', target: 'iron_pickaxe', reason: 'upgrade to iron' };
      if (hasRawIron && hasCoal)
        return { goal: 'smelt', target: 'iron_ingot', reason: 'smelt iron ore' };
      return { goal: 'explore', target: 'iron_ore', reason: 'find iron ore' };
    }

    // ── 14. Iron armor (piece by piece) ───────────────────────────────────
    if (!hasFullIronArmor(this.bot)) {
      const missing = missingIronArmorPiece(this.bot);
      if (missing) {
        const ingotCost: Record<string, number> = {
          iron_chestplate: 8, iron_leggings: 7, iron_boots: 4, iron_helmet: 5,
        };
        const needed = ingotCost[missing] ?? 5;
        if (count(this.bot, 'iron_ingot') >= needed)
          return { goal: 'craft', target: missing, reason: 'craft armor piece' };
        if (hasRawIron && hasCoal)
          return { goal: 'smelt', target: 'iron_ingot', reason: 'smelt iron for armor' };
        return { goal: 'explore', target: 'iron_ore', reason: 'need more iron' };
      }
    }

    // ── 15. Equip armor if crafted but not worn ────────────────────────────
    if (hasAnyIronArmor(this.bot))
      return { goal: 'survive', target: 'equip_armor', reason: 'put on armor' };

    return null;
  }

  // ── Already achieved check ────────────────────────────────────────────────

  private alreadyAchieved(goal: Goal): boolean {
    const bot = this.bot;

    if (goal.goal === 'craft' || goal.goal === 'build') {
      const mcData = require('minecraft-data')(bot.version);
      const id = mcData.itemsByName[goal.target]?.id;
      return id ? bot.inventory.findInventoryItem(id, null, false) !== null : false;
    }

    if (goal.goal === 'gather') {
      const thresholds: Record<string, number> = {
        wood: 16, stone: 16, coal: 8, iron: 12, food: 8,
      };
      const threshold = thresholds[goal.target] ?? 1;
      return count(bot, goal.target) >= threshold
          || count(bot, `${goal.target}_ore`) >= threshold
          || count(bot, `raw_${goal.target}`) >= threshold;
    }

    return false;
  }

  // ── LLM decision ─────────────────────────────────────────────────────────

  private async llmGoal(): Promise<Goal> {
    const pos  = this.bot.entity.position;

    const near = (Object.values(this.bot.entities) as any[])
      .filter(e => e?.position && e.position.distanceTo(pos) < 32)
      .map(e => {
        const name = e.name ?? e.username ?? e.type ?? 'unknown';
        const dist = Math.round(e.position.distanceTo(pos));
        const hostile = HOSTILE_NAMES.has(name.toLowerCase()) ? '!' : '';
        return `${hostile}${name}(${dist}m)`;
      })
      .slice(0, 6)
      .join(' ');

    const invStr = this.bot.inventory.items()
      .slice(0, 12)
      .map(i => `${i.name}x${i.count}`)
      .join(',');

    const time  = this.bot.time.timeOfDay;
    const phase = this.currentPhase;

    // Include suppressed goals so LLM doesn't suggest them
    const suppressedList = [...this.suppressed.entries()]
      .filter(([, until]) => Date.now() < until)
      .map(([key]) => key)
      .join(', ');

    const prompt =
      `phase=${phase} hp=${Math.round(this.bot.health)}/20 food=${Math.round(this.bot.food)}/20 ` +
      `time=${time < 12542 ? 'day' : 'night'}(${time}) y=${Math.round(pos.y)}\n` +
      `nearby: ${near || 'none'}\n` +
      `inventory: ${invStr || 'empty'}\n` +
      `learned: ${this.learning.lastThree()}\n` +
      `known_locations: ${this.world.summary()}\n` +
      `threats: ${this.trust.threats()}\n` +
      (suppressedList ? `AVOID these (recently failed): ${suppressedList}\n` : '') +
      `What should I do next?`;

    const raw    = await this.llm.chat([
      { role: 'system', content: SYSTEM },
      { role: 'user',   content: prompt },
    ]);
    const clean  = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean) as Goal;

    if (!parsed.goal || !parsed.target) throw new Error('malformed LLM response');
    parsed.reason = parsed.reason ?? '';
    return parsed;
  }

  // ── Fallback ──────────────────────────────────────────────────────────────

  private fallback(): Goal {
    const queue = STRATEGIES[this.currentPhase] ?? [];
    if (queue.length) {
      this.strategyQueue = [...queue];
      const next = this.strategyQueue.shift()!;
      log.brain(`[fallback] reset queue → ${next.goal}(${next.target})`);
      return next;
    }
    return { goal: 'explore', target: 'any', reason: 'nothing else to do' };
  }
}