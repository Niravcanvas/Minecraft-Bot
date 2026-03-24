# Minecraft AI Bot — Bug Report & Fix Guide
> Version 7 · All 14 bugs below are **FIXED** in the current codebase. Additionally, 10 new issues were fixed in the v7 overhaul (see Info.md § v7 Additional Fixes).

---

## SEVERITY KEY
- 🔴 **Critical** — causes the bot to freeze, die, or become completely unresponsive
- 🟠 **Serious** — frequent failures, wasted resources, wrong behaviour
- 🟡 **Moderate** — occasional failures, suboptimal logic
- 🟢 **Minor** — edge cases, quality issues

---

## 🔴 BUG #1 — Emergency Blocked During Long Goals

**File:** `src/index.ts` — safety loop  
**Symptom:** Bot dies to creepers, starves, or walks into lava while smelting, exploring, or building. Safety ticker fires but does nothing.

**Root cause:**
```typescript
// CURRENT (broken):
setInterval(async () => {
  if (!running || emergencyBusy || goalBusy) return;  // ← goalBusy blocks all emergencies
  world.scan(bot);
  const emergency = executor.emergency();
  ...
}, cfg.safetyTickMs);
```
When `goalBusy = true` (any goal is running — smelting can hold this for 90 s), the safety check is **completely skipped**. The bot cannot react to a creeper at 2 m or 0 food.

**Fix:**
```typescript
// FIXED: remove || goalBusy from the guard
setInterval(async () => {
  if (!running || emergencyBusy) return;
  world.scan(bot);
  const emergency = executor.emergency();
  if (!emergency) return;

  emergencyBusy = true;
  try {
    const result = await executor.run(emergency);
    brain.recordOutcome(emergency.goal, emergency.target, result.success, result.reason);
  } catch (e: any) {
    log.error(`Emergency error: ${e.message}`);
  } finally {
    emergencyBusy = false;  // always reset
  }
}, cfg.safetyTickMs);
```

> **Note:** For a complete fix you also need Bug #3's interrupt flag so the active goal yields cleanly.

---

## 🔴 BUG #2 — `GOAL_TICK_MS` Env Var Is Ignored

**File:** `src/index.ts` — goal loop  
**Symptom:** Bot cycles through goals every ~500 ms regardless of config. Spams the same goal. Hammers the LLM. CPU thrashes.

**Root cause:**
```typescript
// In cfg:
goalTickMs: Number(process.env.GOAL_TICK_MS ?? 8000),  // parsed but...

// In goal loop:
while (running) {
  // ...run goal...
  await sleep(500);   // cfg.goalTickMs is NEVER referenced
}
```

**Fix:**
```typescript
// Replace the hardcoded sleep with the configured value:
await sleep(cfg.goalTickMs);   // respects GOAL_TICK_MS=8000 from .env
```

---

## 🟠 BUG #3 — `smelt()` Blocks Up To 90 s With No Emergency Exit

**File:** `src/goals/craft.ts` — `smelt()` function  
**Symptom:** Bot starts smelting iron, gets attacked, cannot flee or eat for up to 90 seconds.

**Root cause:**
```typescript
// Current: polls every 2 s for up to 90 s, no way to break out
while (Date.now() - start < Math.min(count * 12_000, 90_000)) {
  await sleep(2_000);
  const out = furnace.outputItem();
  if (out && out.count >= quantity) break;
}
```

**Fix — add a shared interrupt flag:**
```typescript
// In index.ts, export a flag:
export let interruptGoal = false;

// In the safety loop, before running emergency:
interruptGoal = true;
await sleep(100);   // give current goal a tick to see the flag
interruptGoal = false;

// In smelt():
import { interruptGoal } from '../index';

while (Date.now() - start < Math.min(count * 12_000, 30_000)) {  // also cap at 30s
  if (interruptGoal) {
    log.warn('Smelt interrupted by emergency');
    break;
  }
  await sleep(500);   // poll faster for interrupt
  const out = furnace.outputItem();
  if (out && out.count >= quantity) break;
}
// Always take partial output before closing
const out = furnace.outputItem();
if (out) await furnace.takeOutput();
await furnace.close();
```

---

## 🟠 BUG #4 — Fuel Math Wrong in `tryCookMeat()`

**File:** `src/goals/farm.ts` — `tryCookMeat()`  
**Symptom:** Bot dumps all its coal into the furnace when it only needs 1 or 2 pieces. Wastes coal aggressively.

**Root cause:**
```typescript
// CURRENT (wrong): assumes 1 fuel = 2 smelt ops
const cookCount = Math.min(rawMeat.count, fuelItem.count * 2);
```
Coal actually smelts **8 items**. A log smelts 1.5 items. This over-estimates fuel by 4×.

**Fix:**
```typescript
const SMELT_PER_FUEL: Record<string, number> = {
  coal: 8,      charcoal: 8,
  oak_log: 1.5, birch_log: 1.5, spruce_log: 1.5, jungle_log: 1.5,
  acacia_log: 1.5, dark_oak_log: 1.5, mangrove_log: 1.5, cherry_log: 1.5,
  oak_planks: 1.5, stick: 0.5,
};

const fuelName   = fuelItem.name;
const perFuel    = SMELT_PER_FUEL[fuelName] ?? 1;
const fuelNeeded = Math.ceil(rawMeat.count / perFuel);
const fuelToUse  = Math.min(fuelItem.count, fuelNeeded);
const cookCount  = Math.min(rawMeat.count, Math.floor(fuelToUse * perFuel));

await furnace.putFuel(fuelItem.type, null, fuelToUse);  // exact amount
```

---

## 🟡 BUG #5 — Flee Cooldown Blocks Re-Flee in Active Danger

**File:** `src/brain.ts` — `deterministicGoal()`  
**Symptom:** Bot successfully flees a zombie, explore goal walks it back into the same area 10 seconds later, but flee is blocked for 30 more seconds because `fleeSafeUntil` isn't reset. Bot gets killed.

**Root cause:**
```typescript
// CURRENT: sets a 30 s window after any successful flee
if (result.success) this.fleeSafeUntil = Date.now() + 30_000;

// In deterministicGoal:
if (Date.now() < this.fleeSafeUntil) {
  // flee skipped even if hostile is 2 m away right now
}
```

**Fix — only suppress flee if we've actually moved away:**
```typescript
// After successful flee, check actual distance from the danger position
// OR: use a much shorter cooldown (5 s is enough to prevent flip-flopping)
if (result.success) this.fleeSafeUntil = Date.now() + 5_000;  // was 30_000

// OR: don't block flee in deterministicGoal at all for HP ≤ 6 cases:
const hostile = getNearestHostile(this.bot, 16);
if (hostile) {
  const dist = hostile.position.distanceTo(this.bot.entity.position);
  if (this.bot.health <= 6 || dist <= 5) {
    // Always flee in critical cases, ignore cooldown
    return { goal: 'survive', target: 'flee', reason: 'critical — ignore cooldown' };
  }
  if (Date.now() > this.fleeSafeUntil) {
    return { goal: 'survive', target: 'flee', reason: 'hostile nearby' };
  }
}
```

---

## 🟡 BUG #6 — Wood Gather Only Triggers on Absolute Zero

**File:** `src/brain.ts` — `deterministicGoal()` step 4  
**Symptom:** Bot tries to craft a wooden pickaxe with 2 planks (needs 3 + 2 sticks), fails, gets suppressed, wanders aimlessly. Never proactively gathers enough wood to craft.

**Root cause:**
```typescript
// CURRENT: only gathers if BOTH logs AND planks are empty
if (!hasAnyLogs(this.bot) && !hasAnyPlanks(this.bot))
  return { goal: 'gather', target: 'wood', reason: 'no wood at all' };
```

**Fix — add a low-stock check with a proper floor:**
```typescript
const logCount   = WOOD_BLOCKS.reduce((n, b) => n + countItem(this.bot, b), 0);
const plankCount = ['oak_planks','birch_planks','spruce_planks','jungle_planks',
                    'acacia_planks','dark_oak_planks','mangrove_planks','cherry_planks']
                    .reduce((n, b) => n + countItem(this.bot, b), 0);

// Gather if stock is critically low (< 4 logs AND < 8 planks)
if (logCount < 4 && plankCount < 8) {
  return { goal: 'gather', target: 'wood', reason: `low wood stock (${logCount} logs, ${plankCount} planks)` };
}
```

---

## 🟡 BUG #7 — Strategy Queue Drains and Never Refills

**File:** `src/brain.ts` — `pickGoal()`  
**Symptom:** Bot progresses through early_game goals, runs out of queued goals, falls to 15 s LLM tier, then wanders forever doing nothing useful. No phase transition has fired yet.

**Root cause:**
```typescript
// Strategy queue uses shift() — items removed forever once run
const next = this.strategyQueue.shift();
// Queue never rebuilt until a phase transition
```

**Fix — rebuild queue from unachieved goals when drained:**
```typescript
// In pickGoal(), Tier 2 block:
if (this.strategyQueue.length === 0) {
  // Rebuild from goals not yet achieved, not suppressed, and prereqs met
  const rebuilt = STRATEGIES[this.currentPhase].filter(g =>
    !this.alreadyAchieved(g) &&
    !this.isSuppressed(g.goal, g.target) &&
    this.canAttempt(g)
  );
  if (rebuilt.length > 0) {
    this.strategyQueue = rebuilt;
    log.brain(`[queue] rebuilt ${rebuilt.length} goals for ${this.currentPhase}`);
  }
}

const next = this.strategyQueue.shift();
if (next && !this.alreadyAchieved(next) && !this.isSuppressed(next.goal, next.target)) {
  return next;
}
```

---

## 🟡 BUG #8 — First `noPath` Is Silently Ignored

**File:** `src/utils/navigation.ts`  
**Symptom:** Bot tries to path to a block surrounded by lava or inside a wall. Pathfinder returns `noPath` immediately. Bot waits out the full 30–90 s timeout doing nothing.

**Root cause:**
```typescript
function onPathUpdate(r: any) {
  if (r.status === 'noPath') {
    if (unstickCount >= 2) {  // only acts on 2nd+ noPath
      cleanup(); resolve(false);
    }
    // First noPath: falls through — nothing happens
  }
}
```

**Fix — act on first `noPath` immediately:**
```typescript
function onPathUpdate(r: any) {
  if (r.status === 'noPath') {
    unstickCount++;
    if (unstickCount === 1) {
      // First noPath: try wandering to reposition, then retry
      wander(bot, 8, 3).then(() => {
        bot.pathfinder.setGoal(goal);  // retry once
      });
    } else {
      // Second noPath: give up
      log.warn(`navigateTo: no path after reposition, giving up`);
      cleanup();
      resolve(false);
    }
  }
}
```

---

## 🟡 BUG #9 — `build.ts` Has Its Own Broken `navigateTo()`

**File:** `src/goals/build.ts`  
**Symptom:** Build goals fail navigation frequently. Bot gets stuck on terrain during construction and never recovers. Build attempts time out after 10 s.

**Root cause:**
```typescript
// build.ts defines its own local version:
const NAV_TIMEOUT_MS = 10_000;
async function navigateTo(bot: any, x: number, y: number, z: number, reach = 2): Promise<boolean> {
  // ... simplified version, no stuck recovery, no adaptive timeout
}
```
This shadows and ignores the full-featured `utils/navigation.ts`.

**Fix:**
```typescript
// Remove the local navigateTo from build.ts entirely.
// Add this import at the top:
import { navigateTo } from '../utils/navigation';

// No other changes needed — the function signatures are compatible.
```

---

## 🟡 BUG #10 — `getPhase()` Triggers `mid_game` on Any Iron Item

**File:** `src/data/strategies.ts`  
**Symptom:** Bot finds a single `iron_ingot` drop from a zombie, immediately "upgrades" to mid_game phase, clears its early_game strategy queue, and starts trying to craft iron_pickaxe without having gathered enough iron. Gets stuck in a smelt/gather loop.

**Root cause:**
```typescript
export function getPhase(bot: any): 'early_game' | 'mid_game' | 'late_game' {
  const items = bot.inventory.items().map((i: any) => i.name);
  if (items.some((n: string) => n.includes('iron_'))) return 'mid_game';  // too broad
  if (items.some((n: string) => n.includes('diamond_'))) return 'late_game' as any;
  return 'early_game';
}
```
`iron_ingot`, `raw_iron`, `iron_ore` all match `'iron_'`.

**Fix — gate on meaningful progression items:**
```typescript
export function getPhase(bot: any): 'early_game' | 'mid_game' | 'late_game' {
  const items = bot.inventory.items().map((i: any) => i.name);
  const IRON_TOOLS    = ['iron_pickaxe','iron_sword','iron_axe','iron_shovel'];
  const DIAMOND_TOOLS = ['diamond_pickaxe','diamond_sword','diamond_axe'];
  const hasIronTool    = items.some((n: string) => IRON_TOOLS.includes(n));
  const hasDiamondTool = items.some((n: string) => DIAMOND_TOOLS.includes(n));
  if (hasDiamondTool) return 'late_game' as any;
  if (hasIronTool)    return 'mid_game';
  return 'early_game';
}
```

---

## 🟡 BUG #11 — `getNearestHostile()` Returns First Found, Not Nearest

**File:** `src/data/mobs.ts`  
**Symptom:** Bot targets a skeleton 30 m away (which fires arrows at it) while ignoring a creeper at 4 m. Gets blown up or shot to death when it could have fought the close threat.

**Root cause:**
```typescript
// CURRENT: Array.find() — first match in JS object iteration order (not sorted by distance)
export function getNearestHostile(bot: any, maxDist = 24): any | null {
  return Object.values(bot.entities).find((e: any) =>
    HOSTILE_NAMES.includes(e.name ?? '') &&
    e.position?.distanceTo(bot.entity.position) < maxDist
  ) ?? null;
}
```

**Fix — sort by distance like `getNearestPassive()` already does:**
```typescript
export function getNearestHostile(bot: any, maxDist = 24): any | null {
  let best: any = null, bestDist = maxDist;
  for (const e of Object.values(bot.entities) as any[]) {
    if (!HOSTILE_NAMES.includes(e.name ?? '')) continue;
    const d = e.position?.distanceTo(bot.entity.position) ?? 999;
    if (d < bestDist) { best = e; bestDist = d; }
  }
  return best;
}
```

---

## 🟢 BUG #12 — Dual Suppression Systems Never Cross-Check

**Files:** `src/memory/learning.ts` + `src/brain.ts`  
**Symptom:** A goal suppressed in `LearningMemory` is still attempted by `Brain`. Or a goal cleared in Brain is still blocked by LearningMemory. Results in inconsistent blacklisting.

**Root cause:**
- `Brain` has its own `failHistory` map with 3-fail/120 s window → 90 s suppress
- `LearningMemory` has its own `isSuppressed()` with 3-fail/5 min window → 3 min suppress
- Brain's `isSuppressed()` only checks its own map, never `this.learning.isSuppressed()`

**Fix:**
```typescript
// In brain.ts, rename the private method and wrap both checks:
private isSuppressedByBrain(goal: string, target: string): boolean {
  // existing failHistory logic here
}

private isSuppressed(goal: string, target: string): boolean {
  return this.isSuppressedByBrain(goal, target) ||
         this.learning.isSuppressed(goal, target);
}
```

---

## 🟢 BUG #13 — `num_predict: 80` Truncates JSON Mid-Stream

**File:** `src/llm.ts`  
**Symptom:** LLM returns `{"goal":"gather","target":"wo` — truncated mid-value. JSON parse fails, goal is discarded, bot wanders aimlessly. Happens more often on longer goal names (`iron_chestplate`, `stone_pickaxe`).

**Root cause:**
```typescript
options: { temperature: 0.15, num_predict: 80, repeat_penalty: 1.1 }
//                                         ^^^
// A full goal JSON is ~45–70 tokens. 80 is barely enough.
// Any model "thinking" prefix or preamble pushes it over.
```

**Fix:**
```typescript
options: { temperature: 0.15, num_predict: 150, repeat_penalty: 1.1 }
```

---

## 🟢 BUG #14 — Auth Sequence May Fire Before Server Prompt

**File:** `src/bot.ts`  
**Symptom:** On slow servers, `/register` and `/login` are sent before the server displays the auth prompt. Server ignores them. Bot never authenticates, can't act.

**Root cause:**
```typescript
await sleep(2000);   // may not be enough on slow/loaded servers
bot.chat(`/register ${cfg.password} ${cfg.password}`);
await sleep(1500);
bot.chat(`/login ${cfg.password}`);
```

**Fix — wait for server chat prompt instead of a fixed delay:**
```typescript
if (cfg.password) {
  await new Promise<void>(resolve => {
    const handler = (username: string, message: string) => {
      const lower = message.toLowerCase();
      if (lower.includes('register') || lower.includes('login') || lower.includes('password')) {
        bot.removeListener('chat', handler);
        resolve();
      }
    };
    bot.on('chat', handler);
    // Fallback timeout in case server never sends the prompt
    setTimeout(resolve, 8000);
  });

  bot.chat(`/register ${cfg.password} ${cfg.password}`);
  await sleep(2000);
  bot.chat(`/login ${cfg.password}`);
  await sleep(1000);
  log.success('Auth complete');
}
```

---

## Fix Priority Order

Apply these in order for maximum impact with minimum risk:

1. **Bug #2** (GOAL_TICK_MS) — 1-line fix, zero risk
2. **Bug #11** (getNearestHostile sort) — 5-line fix, immediate combat improvement
3. **Bug #10** (getPhase iron check) — prevents bad phase transitions
4. **Bug #4** (fuel math) — stops coal waste
5. **Bug #1** (emergency blocked) — critical fix, removes `|| goalBusy`
6. **Bug #6** (wood stock floor) — prevents crafting failures
7. **Bug #7** (strategy queue rebuild) — stops aimless wandering
8. **Bug #5** (flee cooldown) — shorten from 30 s to 5 s
9. **Bug #13** (num_predict) — increase to 150
10. **Bug #8** (noPath handling) — stops silent timeout waste
11. **Bug #9** (build navigation) — remove local navigateTo from build.ts
12. **Bug #3** (smelt interrupt) — requires interrupt flag architecture
13. **Bug #12** (dual suppression) — cleanup / consolidate
14. **Bug #14** (auth timing) — fix for flaky server connections