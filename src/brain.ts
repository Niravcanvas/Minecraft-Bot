import { Bot } from 'mineflayer';
import { OllamaClient } from './llm';
import { LearningMemory } from './memory/learning';
import { TrustMemory } from './memory/trust';
import { WorldMemory } from './memory/world';
import { Goal } from './executor';
import { getPhase, STRATEGIES } from './data/strategies';
import { hasItem, hasAny, countItem } from './data/items';
import { WOOD_BLOCKS } from './data/blocks';
import { shouldFight } from './goals/combat';
import { log } from './utils/logger';

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM = `You are the decision-making brain of a Minecraft survival bot. Reply ONLY with a single JSON object — no markdown, no explanation.

Schema: {"goal":"<goal>","target":"<target>","reason":"<8 words max>"}

Valid 'goal' values and their allowed 'target' values:
  survive  → eat | flee | sleep | equip_armor | health
  gather   → wood | stone | coal | iron | diamond | food | sand | gravel
  craft    → crafting_table | wooden_pickaxe | wooden_axe | wooden_sword | wooden_shovel |
             stone_pickaxe | stone_sword | furnace | iron_pickaxe | iron_sword | iron_axe |
             iron_helmet | iron_chestplate | iron_leggings | iron_boots | shield | torch | chest | white_bed
  smelt    → iron_ingot | charcoal
  hunt     → cow | sheep | chicken | pig
  explore  → village | cave | any | iron_ore | diamond_ore
  build    → shelter | chest_room | furnace_station
  combat   → nearest
  social   → greet | flee_threat | follow_trusted

IMPORTANT: You MUST use ONLY the goal and target values listed above. Never invent new goals or targets.
Pick the goal that best fits the bot's current state. Prioritise survival, then progression, then exploration.`;

// ─── Threat helpers ───────────────────────────────────────────────────────────

const HOSTILE_SET = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
  'enderman', 'witch', 'slime', 'phantom', 'drowned', 'husk', 'stray',
]);

function nearestHostile(bot: Bot, radius = 16): any | null {
  const pos = bot.entity.position;
  let closest: any = null, closestDist = radius + 1;
  for (const entity of Object.values(bot.entities) as any[]) {
    if (!entity?.position) continue;
    const name = entity.name?.toLowerCase() ?? '';
    if (!HOSTILE_SET.has(name)) continue;
    const dist = entity.position.distanceTo(pos);
    if (dist < closestDist) { closest = entity; closestDist = dist; }
  }
  return closest;
}

function canSleep(bot: Bot, world: WorldMemory): boolean {
  const t = bot.time.timeOfDay;
  return t > 12542 && t < 23460
    && (hasBedInInventory(bot) || world.knows('bed'))
    && !nearestHostile(bot, 8);
}

// ─── Inventory helpers (WOOD-TYPE AGNOSTIC) ──────────────────────────────────

function inv(bot: Bot, name: string): boolean { return hasItem(bot, name); }
function invAny(bot: Bot, names: string[]): boolean { return hasAny(bot, names); }
function count(bot: Bot, name: string): number { return countItem(bot, name); }

function hasAnyLogs(bot: Bot): boolean {
  return bot.inventory.items().some(i => i.name.includes('_log'));
}

function totalLogCount(bot: Bot): number {
  return bot.inventory.items()
    .filter(i => i.name.includes('_log'))
    .reduce((s, i) => s + i.count, 0);
}

function hasAnyPlanks(bot: Bot): boolean {
  return bot.inventory.items().some(i => i.name.includes('_planks'));
}

function totalPlanksCount(bot: Bot): number {
  return bot.inventory.items()
    .filter(i => i.name.includes('_planks'))
    .reduce((s, i) => s + i.count, 0);
}

function bestPickaxeTier(bot: Bot): number {
  const items = bot.inventory.items().map(i => i.name);
  if (items.some(n => n === 'diamond_pickaxe' || n === 'netherite_pickaxe')) return 3;
  if (items.some(n => n === 'iron_pickaxe')) return 2;
  if (items.some(n => n === 'stone_pickaxe')) return 1;
  if (items.some(n => n.includes('pickaxe'))) return 0;
  return -1;
}

function hasSword(bot: Bot): boolean {
  return bot.inventory.items().some(i => i.name.includes('sword'));
}

function bestSwordTier(bot: Bot): number {
  const items = bot.inventory.items().map(i => i.name);
  if (items.some(n => n === 'diamond_sword' || n === 'netherite_sword')) return 3;
  if (items.some(n => n === 'iron_sword')) return 2;
  if (items.some(n => n === 'stone_sword')) return 1;
  if (items.some(n => n.includes('sword'))) return 0;
  return -1;
}

function hasFullIronArmor(bot: Bot): boolean {
  return ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'].every(p => inv(bot, p));
}

function missingIronArmorPiece(bot: Bot): string | null {
  for (const p of ['iron_chestplate', 'iron_leggings', 'iron_boots', 'iron_helmet']) {
    if (!inv(bot, p)) return p;
  }
  return null;
}

function hasAnyArmor(bot: Bot): boolean {
  return bot.inventory.items().some(i =>
    i.name.includes('helmet') || i.name.includes('chestplate') ||
    i.name.includes('leggings') || i.name.includes('boots')
  );
}

function hasUnequippedArmor(bot: Bot): boolean {
  const equipped = new Set<number>();
  for (let slot = 5; slot <= 8; slot++) {
    const item = (bot.inventory as any).slots[slot];
    if (item) equipped.add(item.type);
  }
  return bot.inventory.items().some(i =>
    (i.name.includes('helmet') || i.name.includes('chestplate') ||
      i.name.includes('leggings') || i.name.includes('boots')) &&
    !equipped.has(i.type)
  );
}

function hasFood(bot: Bot): boolean {
  return invAny(bot, [
    'bread', 'golden_carrot', 'golden_apple', 'cooked_beef', 'cooked_chicken',
    'cooked_porkchop', 'cooked_mutton', 'carrot', 'apple', 'baked_potato', 'cooked_rabbit',
  ]);
}

function hasBedInInventory(bot: Bot): boolean {
  return bot.inventory.items().some(i => i.name.includes('_bed'));
}

function woolCount(bot: Bot): number {
  return bot.inventory.items()
    .filter(i => i.name.includes('wool'))
    .reduce((s, i) => s + i.count, 0);
}

// ─── Phase tracking ───────────────────────────────────────────────────────────

type Phase = 'early_game' | 'mid_game' | 'late_game';

function detectPhase(bot: Bot): Phase {
  if (bestPickaxeTier(bot) >= 2 && hasFullIronArmor(bot)) return 'late_game';
  if (bestPickaxeTier(bot) >= 1 && (inv(bot, 'furnace') || bot.inventory.items().some(i => i.name === 'furnace'))) return 'mid_game';
  return 'early_game';
}

// ─── Loop / cooldown tracking ─────────────────────────────────────────────────

interface FailRecord { ts: number; goal: string; target: string }

const LOOP_WINDOW_MS = 120_000;
const LOOP_THRESHOLD = 3;
const SUPPRESS_MS = 90_000;

// FIX Bug #5: was 30_000 — too long. Bot would re-enter danger area within
// 30s during explore/gather and be unable to flee again. 5s is enough to
// prevent flip-flopping without blocking legitimate re-flee.
const FLEE_SAFE_COOLDOWN_MS = 5_000;

// ─── Brain ────────────────────────────────────────────────────────────────────

export class Brain {
  private strategyQueue: Goal[] = [];
  private lastLLMCall = 0;
  private currentPhase: Phase;
  private fleeSafeUntil = 0;
  private failHistory: FailRecord[] = [];
  private suppressed: Map<string, number> = new Map();
  private playerGoals: Goal[] = [];

  constructor(
    private bot: Bot,
    private llm: OllamaClient,
    private learning: LearningMemory,
    private trust: TrustMemory,
    private world: WorldMemory,
  ) {
    this.currentPhase = 'early_game';
    this.strategyQueue = [...(STRATEGIES.early_game ?? [])];
  }

  pushPlayerGoal(goal: Goal): void {
    this.playerGoals.push(goal);
    log.brain(`[player] queued: ${goal.goal}(${goal.target})`);
  }

  recordOutcome(goal: string, target: string, success: boolean, reason: string): void {
    const key = `${goal}:${target}`;
    if (success) {
      if (goal === 'survive' && target === 'flee')
        this.fleeSafeUntil = Date.now() + FLEE_SAFE_COOLDOWN_MS;
      this.suppressed.delete(key);

      if (goal === 'gather' && target === 'wood') {
        this.suppressed.delete('craft:crafting_table');
        this.suppressed.delete('craft:wooden_pickaxe');
        this.suppressed.delete('craft:wooden_sword');
        this.suppressed.delete('craft:wooden_axe');
      }
      return;
    }
    const now = Date.now();
    this.failHistory.push({ ts: now, goal, target });
    this.failHistory = this.failHistory.filter(r => r.ts > now - LOOP_WINDOW_MS);
    const fails = this.failHistory.filter(r => r.goal === goal && r.target === target).length;
    if (fails >= LOOP_THRESHOLD) {
      this.suppressed.set(key, now + SUPPRESS_MS);
      log.warn(`[brain] suppressing ${key} for ${SUPPRESS_MS / 1000}s (failed ${fails}x)`);
      this.failHistory = this.failHistory.filter(r => !(r.goal === goal && r.target === target));
    }
  }

  // FIX Bug #12: split into two methods so we can check BOTH suppression
  // sources — Brain's own failHistory AND LearningMemory's 5-min window.
  // Previously only Brain's map was checked; goals suppressed by LearningMemory
  // were still attempted (and vice versa), giving inconsistent blacklisting.
  private isSuppressedByBrain(goal: string, target: string): boolean {
    const until = this.suppressed.get(`${goal}:${target}`);
    if (!until) return false;
    if (Date.now() > until) { this.suppressed.delete(`${goal}:${target}`); return false; }
    return true;
  }

  private isSuppressed(goal: string, target: string): boolean {
    // FIX Bug #12: check both suppression systems
    return this.isSuppressedByBrain(goal, target) || this.learning.isSuppressed(goal, target);
  }

  // ── Main entry ────────────────────────────────────────────────────────────

  async pickGoal(): Promise<Goal> {
    const phase = detectPhase(this.bot);
    if (phase !== this.currentPhase) {
      log.brain(`[phase] ${this.currentPhase} → ${phase}`);
      this.currentPhase = phase;
      this.strategyQueue = [...(STRATEGIES[phase] ?? [])];
    }

    // 0. Player goals (highest)
    while (this.playerGoals.length > 0) {
      const pg = this.playerGoals.shift()!;
      if (!this.isSuppressed(pg.goal, pg.target)) return pg;
    }

    // 1. Deterministic
    const det = this.deterministicGoal();
    if (det && !this.isSuppressed(det.goal, det.target)) {
      log.brain(`[det] ${det.goal}(${det.target}) — ${det.reason}`);
      return det;
    }

    // 2. Strategy queue
    // FIX Bug #7: when queue is empty, rebuild from unachieved goals before
    // falling to the LLM tier. Previously the queue was never refilled until
    // a phase transition, causing aimless wandering when all queued goals were
    // either achieved or popped.
    if (this.strategyQueue.length === 0) {
      const rebuilt = (STRATEGIES[this.currentPhase] ?? []).filter(g =>
        !this.alreadyAchieved(g) &&
        !this.isSuppressed(g.goal, g.target) &&
        this.canAttempt(g)
      );
      if (rebuilt.length > 0) {
        this.strategyQueue = rebuilt;
        log.brain(`[queue] rebuilt ${rebuilt.length} goals for ${this.currentPhase}`);
      }
    }

    while (this.strategyQueue.length > 0) {
      const next = this.strategyQueue[0];
      if (this.alreadyAchieved(next) || this.isSuppressed(next.goal, next.target) || !this.canAttempt(next)) {
        this.strategyQueue.shift();
        continue;
      }
      this.strategyQueue.shift();
      log.brain(`[strategy] ${next.goal}(${next.target})`);
      return next;
    }

    // 3. LLM (rate-limited 15s)
    if (Date.now() - this.lastLLMCall > 15_000) {
      this.lastLLMCall = Date.now();
      try {
        const goal = await this.llmGoal();
        if (!this.isSuppressed(goal.goal, goal.target)) {
          log.brain(`[llm] ${goal.goal}(${goal.target}) — ${goal.reason}`);
          return goal;
        }
      } catch (err: any) { log.warn(`LLM failed: ${err.message}`); }
    }

    // 4. Fallback — never idle
    return this.fallback();
  }

  // ── Deterministic — INVENTORY AWARE ───────────────────────────────────────

  private deterministicGoal(): Goal | null {
    const hp = this.bot.health;
    const food = this.bot.food;

    // ── 0. Equip armor if we have unequipped pieces ──
    if (hasUnequippedArmor(this.bot))
      return { goal: 'survive', target: 'equip_armor', reason: 'unequipped armor in inventory' };

    // ── 1. Threat response ──
    const hostile = nearestHostile(this.bot, 12);
    if (hostile) {
      if (shouldFight(this.bot) && hostile.position.distanceTo(this.bot.entity.position) < 16)
        return { goal: 'combat', target: 'nearest', reason: `${hostile.name} nearby — fighting` };
      if (hp <= 10 || hostile.position.distanceTo(this.bot.entity.position) < 5) {
        if (Date.now() > this.fleeSafeUntil)
          return { goal: 'survive', target: 'flee', reason: `${hostile.name} attacking` };
      }
    }

    // ── 2. Health/hunger ──
    if (hp <= 10 && !hostile && hasFood(this.bot))
      return { goal: 'survive', target: 'eat', reason: 'low health, regen' };
    if (food <= 6)
      return { goal: 'survive', target: 'eat', reason: 'starving' };
    if (food <= 14 && hp < 18 && hasFood(this.bot))
      return { goal: 'survive', target: 'eat', reason: 'eat to regen' };

    // ── 3. Sleep ──
    if (canSleep(this.bot, this.world))
      return { goal: 'survive', target: 'sleep', reason: 'night time' };

    // ── 3b. Bed crafting if night and no bed ──
    const isNight = this.bot.time.timeOfDay > 12542;
    if (isNight && !hasBedInInventory(this.bot) && !this.world.knows('bed')) {
      if (woolCount(this.bot) >= 3 && hasAnyPlanks(this.bot))
        return { goal: 'craft', target: 'white_bed', reason: 'craft bed for night' };
      if (woolCount(this.bot) < 3)
        return { goal: 'hunt', target: 'sheep', reason: 'need wool for bed' };
    }

    // ── 4. Wood stock check ──
    // FIX Bug #6: was only triggered on absolute zero (no logs AND no planks).
    // Bot would try to craft a pickaxe with 1 plank and fail, then get
    // suppressed, then wander aimlessly. Now triggers if stock is critically
    // low so the bot proactively tops up before it runs dry.
    const logCount = totalLogCount(this.bot);
    const plankCount = totalPlanksCount(this.bot);
    if (logCount < 4 && plankCount < 8) {
      return {
        goal: 'gather', target: 'wood',
        reason: logCount === 0 && plankCount === 0
          ? 'no wood at all'
          : `low wood (${logCount} logs, ${plankCount} planks)`,
      };
    }

    // ── 5. Crafting table ──
    if (!inv(this.bot, 'crafting_table') && !this.world.knows('crafting_table')) {
      if (hasAnyLogs(this.bot) || totalPlanksCount(this.bot) >= 4)
        return { goal: 'craft', target: 'crafting_table', reason: 'need crafting table' };
      return { goal: 'gather', target: 'wood', reason: 'need logs for crafting table' };
    }

    // ── 6. Pickaxe — ONLY if we don't have one at all ──
    if (bestPickaxeTier(this.bot) < 0) {
      if (totalLogCount(this.bot) >= 2 || hasAnyPlanks(this.bot))
        return { goal: 'craft', target: 'wooden_pickaxe', reason: 'need first pickaxe' };
      return { goal: 'gather', target: 'wood', reason: 'need logs for pickaxe' };
    }

    // ── 7. Sword — ONLY if we don't have one at all ──
    if (!hasSword(this.bot)) {
      if (totalLogCount(this.bot) >= 1 || hasAnyPlanks(this.bot))
        return { goal: 'craft', target: 'wooden_sword', reason: 'need sword' };
      return { goal: 'gather', target: 'wood', reason: 'need logs for sword' };
    }

    // ── 8. Stone pickaxe UPGRADE (only if stuck on wooden) ──
    if (bestPickaxeTier(this.bot) < 1) {
      if (count(this.bot, 'cobblestone') >= 3)
        return { goal: 'craft', target: 'stone_pickaxe', reason: 'upgrade pickaxe' };
      return { goal: 'gather', target: 'stone', reason: 'need cobblestone' };
    }

    // ── 9. Food ──
    if (!hasFood(this.bot))
      return { goal: 'hunt', target: 'cow', reason: 'no food at all' };

    // ── 10. Furnace ──
    if (!inv(this.bot, 'furnace') && !this.world.knows('furnace')) {
      if (count(this.bot, 'cobblestone') >= 8)
        return { goal: 'craft', target: 'furnace', reason: 'need furnace' };
      return { goal: 'gather', target: 'stone', reason: 'need 8 cobblestone' };
    }

    // ── 11. Coal / fuel ──
    const hasCoal = count(this.bot, 'coal') > 0 || count(this.bot, 'charcoal') > 0;
    if (!hasCoal)
      return { goal: 'gather', target: 'coal', reason: 'need fuel' };

    // ── 12. Iron progression ──
    const hasRawIron = count(this.bot, 'raw_iron') > 0;
    if (bestPickaxeTier(this.bot) < 2) {
      if (count(this.bot, 'iron_ingot') >= 3)
        return { goal: 'craft', target: 'iron_pickaxe', reason: 'upgrade to iron' };
      if (hasRawIron && hasCoal)
        return { goal: 'smelt', target: 'iron_ingot', reason: 'smelt iron' };
      return { goal: 'explore', target: 'iron_ore', reason: 'find iron ore' };
    }

    // ── 13. Iron sword upgrade ──
    if (bestSwordTier(this.bot) < 2 && count(this.bot, 'iron_ingot') >= 2)
      return { goal: 'craft', target: 'iron_sword', reason: 'better sword' };

    // ── 14. Iron armor ──
    if (!hasFullIronArmor(this.bot)) {
      const missing = missingIronArmorPiece(this.bot);
      if (missing) {
        const cost: Record<string, number> = { iron_chestplate: 8, iron_leggings: 7, iron_boots: 4, iron_helmet: 5 };
        if (count(this.bot, 'iron_ingot') >= (cost[missing] ?? 5))
          return { goal: 'craft', target: missing, reason: 'craft armor' };
        if (hasRawIron && hasCoal)
          return { goal: 'smelt', target: 'iron_ingot', reason: 'smelt for armor' };
        return { goal: 'explore', target: 'iron_ore', reason: 'need more iron' };
      }
    }

    return null;
  }

  // ── Already achieved ─────────────────────────────────────────────────────

  private alreadyAchieved(goal: Goal): boolean {
    if (goal.goal === 'craft') {
      if (goal.target.includes('pickaxe')) {
        const tier = goal.target.startsWith('wooden') ? 0 :
          goal.target.startsWith('stone') ? 1 :
            goal.target.startsWith('iron') ? 2 : 3;
        return bestPickaxeTier(this.bot) >= tier;
      }
      if (goal.target.includes('sword')) {
        const tier = goal.target.startsWith('wooden') ? 0 :
          goal.target.startsWith('stone') ? 1 :
            goal.target.startsWith('iron') ? 2 : 3;
        return bestSwordTier(this.bot) >= tier;
      }
      if (goal.target.includes('axe')) {
        return this.bot.inventory.items().some(i => i.name.includes('_axe'));
      }
      return inv(this.bot, goal.target);
    }

    if (goal.goal === 'gather') {
      const thresholds: Record<string, number> = { wood: 16, stone: 16, coal: 8, iron: 12, food: 8 };
      const threshold = thresholds[goal.target] ?? 1;
      if (goal.target === 'wood') return totalLogCount(this.bot) >= threshold || totalPlanksCount(this.bot) >= threshold;
      return count(this.bot, goal.target) >= threshold;
    }

    return false;
  }

  // ── Prerequisite check ───────────────────────────────────────────────────

  private canAttempt(goal: Goal): boolean {
    if (goal.goal === 'gather') {
      if (goal.target === 'stone') return bestPickaxeTier(this.bot) >= 0;
      if (goal.target === 'coal') return bestPickaxeTier(this.bot) >= 0;
      if (goal.target === 'iron') return bestPickaxeTier(this.bot) >= 1;
      if (goal.target === 'diamond') return bestPickaxeTier(this.bot) >= 2;
    }

    if (goal.goal === 'craft') {
      const logs = totalLogCount(this.bot);
      const planks = totalPlanksCount(this.bot);
      const cob = this.bot.inventory.items()
        .filter(i => i.name === 'cobblestone').reduce((s, i) => s + i.count, 0);

      if (goal.target === 'crafting_table') return logs >= 1 || planks >= 4;
      if (goal.target === 'wooden_planks') return logs >= 1;

      const hasCraftingTable = inv(this.bot, 'crafting_table') || this.world.knows('crafting_table');
      if (!hasCraftingTable) return false;

      if (goal.target === 'wooden_pickaxe') return logs >= 1 || planks >= 2;
      if (goal.target === 'wooden_axe') return logs >= 1 || planks >= 3;
      if (goal.target === 'wooden_sword') return logs >= 1 || planks >= 2;
      if (goal.target === 'stone_pickaxe') return cob >= 3 && (planks >= 2 || logs >= 1);
      if (goal.target === 'stone_sword') return cob >= 2 && (planks >= 1 || logs >= 1);
      if (goal.target === 'furnace') return cob >= 8;
    }

    return true;
  }

  // ── LLM decision ─────────────────────────────────────────────────────────

  private async llmGoal(): Promise<Goal> {
    const pos = this.bot.entity.position;
    const near = (Object.values(this.bot.entities) as any[])
      .filter(e => e?.position && e.position.distanceTo(pos) < 32)
      .map(e => {
        const name = e.name ?? e.username ?? 'unknown';
        const dist = Math.round(e.position.distanceTo(pos));
        return `${HOSTILE_SET.has(name) ? '!' : ''}${name}(${dist}m)`;
      }).slice(0, 6).join(' ');

    const invStr = this.bot.inventory.items().slice(0, 15).map(i => `${i.name}x${i.count}`).join(',');
    const craftable = (() => { try { return require('./goals/craft').listCraftable(this.bot).slice(0, 8).join(','); } catch { return ''; } })();
    const time = this.bot.time.timeOfDay;
    const armed = shouldFight(this.bot) ? 'armed' : 'unarmed';
    const pickTier = bestPickaxeTier(this.bot);

    const prompt =
      `phase=${this.currentPhase} hp=${Math.round(this.bot.health)}/20 food=${Math.round(this.bot.food)}/20 ` +
      `time=${time < 12542 ? 'day' : 'night'}(${time}) y=${Math.round(pos.y)} ${armed} pickaxe_tier=${pickTier}\n` +
      `nearby: ${near || 'none'}\ninventory: ${invStr || 'empty'}\n` +
      `craftable_now: ${craftable || 'nothing'}\n` +
      `has_bed: ${hasBedInInventory(this.bot) || this.world.knows('bed')}\n` +
      `learned: ${this.learning.lastThree()}\nknown: ${this.world.summary()}\n` +
      `What should I do next?`;

    const raw = await this.llm.chat([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: prompt },
    ], 'json');
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean) as Goal;
    if (!parsed.goal || !parsed.target) throw new Error('malformed');
    parsed.reason = parsed.reason ?? '';

    const validGoals = new Set(['survive', 'gather', 'craft', 'smelt', 'hunt', 'explore', 'build', 'combat', 'social']);
    if (!validGoals.has(parsed.goal)) throw new Error(`invalid goal: ${parsed.goal}`);

    return parsed;
  }

  // ── Fallback ─────────────────────────────────────────────────────────────

  private fallback(): Goal {
    if (!hasAnyLogs(this.bot) && !hasAnyPlanks(this.bot)) {
      if (!this.isSuppressed('gather', 'wood')) {
        log.brain(`[fallback] no materials — gather wood`);
        return { goal: 'gather', target: 'wood', reason: 'need logs' };
      }
    }

    if (this.world.knows('village') && !this.isSuppressed('explore', 'village')) {
      log.brain(`[fallback] heading to known village`);
      return { goal: 'explore', target: 'village', reason: 'use village resources' };
    }

    const queue = STRATEGIES[this.currentPhase] ?? [];
    const unachieved = queue.filter(g =>
      !this.alreadyAchieved(g) &&
      !this.isSuppressed(g.goal, g.target) &&
      this.canAttempt(g)
    );

    if (unachieved.length > 0) {
      this.strategyQueue = [...unachieved];
      const next = this.strategyQueue.shift()!;
      log.brain(`[fallback] reset queue → ${next.goal}(${next.target})`);
      return next;
    }

    log.brain(`[fallback] exploring`);
    return { goal: 'explore', target: 'any', reason: 'roaming' };
  }
}