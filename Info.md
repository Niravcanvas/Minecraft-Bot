# Minecraft AI Bot — Master Reference & INFO.md
> Version 7 · Mineflayer + Ollama (optional, qwen2.5:1.5b) · MC 1.21.4
> Use this as the master prompt context for every new chat about this bot.

---

## TABLE OF CONTENTS
1. [Architecture Overview](#architecture-overview)
2. [Entry Point — index.ts](#entry-point--indexts)
3. [Bot Creation — bot.ts](#bot-creation--botts)
4. [LLM Client — llm.ts](#llm-client--llmts)
5. [Brain — brain.ts (Decision Maker)](#brain--braints-decision-maker)
6. [Executor — executor.ts](#executor--executorts)
7. [Goal: Survive — goals/survive.ts](#goal-survive--goalssurvivets)
8. [Goal: Gather — goals/gather.ts](#goal-gather--goalsgatherts)
9. [Goal: Craft/Smelt — goals/craft.ts](#goal-craftsmelt--goalscraftts)
10. [Goal: Explore — goals/explore.ts](#goal-explore--goalsexplorets)
11. [Goal: Farm/Hunt — goals/farm.ts](#goal-farmhunt--goalsfarmts)
12. [Goal: Combat — goals/combat.ts](#goal-combat--goalscombatts)
13. [Goal: Social — goals/social.ts](#goal-social--goalssocialts)
14. [Goal: Build — goals/build.ts](#goal-build--goalsbildts)
15. [Goal: Chat — goals/chat.ts](#goal-chat--goalschats)
16. [Memory: Learning — memory/learning.ts](#memory-learning--memorylearningts)
17. [Memory: Trust — memory/trust.ts](#memory-trust--memorytrustts)
18. [Memory: World — memory/world.ts](#memory-world--memoryworldts)
19. [Navigation — utils/navigation.ts](#navigation--utilsnavigationts)
20. [Logger — utils/logger.ts](#logger--utilsloggerts)
21. [Data Files](#data-files)
22. [Configuration (.env)](#configuration-env)
23. [Goal / Target Reference Table](#goal--target-reference-table)
24. [Chat Commands Reference](#chat-commands-reference)
25. [⚠️ Logic Errors & Bugs](#️-logic-errors--bugs)
26. [Improvement Recommendations](#improvement-recommendations)

---

## Architecture Overview

```
index.ts  ←──── main loop, event wiring, safety ticker
    │
    ├── bot.ts          ← mineflayer bot creation, auth, pathfinder setup
    ├── llm.ts          ← Ollama HTTP client (qwen2.5:1.5b)
    ├── brain.ts        ← pickGoal() — decides WHAT to do next (4-tier priority)
    ├── executor.ts     ← run(goal) — dispatches to goal modules; emergency()
    │
    ├── goals/
    │   ├── survive.ts  ← eat, flee, sleep, equip_armor, health
    │   ├── gather.ts   ← mine blocks (wood, stone, coal, iron, diamond…)
    │   ├── craft.ts    ← craft items, smelt ores, manage furnace/table
    │   ├── explore.ts  ← surface scan, deep dig, chest looting
    │   ├── farm.ts     ← hunt mobs, cook meat
    │   ├── combat.ts   ← melee loop, creeper kite, shield equip
    │   ├── social.ts   ← greet, follow, flee threats
    │   ├── build.ts    ← place multi-block structures
    │   └── chat.ts     ← parse player chat → Goal; proactive chat
    │
    ├── memory/
    │   ├── learning.ts ← ring-buffer of outcomes, EWMA success scores
    │   ├── trust.ts    ← per-player trust score (0–1)
    │   └── world.ts    ← discovered locations (village, cave, furnace…)
    │
    └── utils/
        ├── navigation.ts ← navigateTo(), goToBlock(), wander(), lookAround()
        ├── chat_queue.ts ← global chat throttle, max 1 msg/1.5s
        └── logger.ts     ← coloured console output
```

**Data flow per tick:**
1. Safety timer (1 s) → `executor.emergency()` → run if threat/hunger
2. Goal loop → `brain.pickGoal()` → `executor.run(goal)` → `brain.recordOutcome()`
3. Chat event → keyword parser OR LLM → `brain.pushPlayerGoal()`

---

## Entry Point — index.ts

### Purpose
Wires all modules together, starts all timers, handles player chat and CLI commands.

### Key Variables
| Variable | Type | Purpose |
|---|---|---|
| `running` | boolean | Master on/off switch; `!stop` sets false |
| `emergencyBusy` | boolean | True while emergency goal is executing |
| `goalBusy` | boolean | True while goal loop is executing |

### Timers Started on Spawn
| Timer | Interval | Action |
|---|---|---|
| Safety loop | 1 000 ms | `world.scan()` → `executor.emergency()` → run if non-null |
| Look-at-player | 3 000 ms | Turn head toward nearest player ≤12 m |
| Look-around | 8 000 ms | Random head yaw/pitch (idle animation) |
| Guard scan | 2 000 ms | If guard mode ON, check for hostiles within 8 m |
| Goal loop | continuous (`cfg.goalTickMs` sleep between goals) | `brain.pickGoal()` → `executor.run()` |

### Inventory Auto-Equip
On every `bot.inventory.updateSlot` event: iterates armor slots 5–8 (head, chest, legs, feet), equips any unequipped armor piece found in inventory.

### Chat Commands (! prefix)
| Command | Effect |
|---|---|
| `!stop` | Sets `running=false`, bot idles |
| `!start` | Sets `running=true`, resumes goal loop |
| `!status` | Prints `hp`, `food`, `busy`, `guard` flags |
| `!inv` | Prints first 8 inventory items with counts |
| `!world` | Prints known discovery keys from WorldMemory |
| `!pos` | Prints bot's current coordinates |
| `!follow` / `!come` | Start following nearest player |
| `!mine <resource>` | Mine specified resource (wood, stone, coal, iron, diamond, etc) |
| `!craft <item>` | Craft specified item (e.g., !craft iron_pickaxe) |
| `!smelt <item>` | Smelt specified item (iron_ingot, charcoal) |
| `!build [type]` | Build structure (shelter, chest_room, furnace_station) |
| `!explore [target]` | Explore (any, village, cave) |
| `!hunt [mob]` | Hunt specified mob (cow, sheep, chicken, pig) |
| `!eat` | Force eat best food |
| `!sleep` | Force sleep in bed |
| `!fight` / `!attack` | Fight nearest hostile |
| `!guard` | Toggle guard mode — fight all nearby hostiles |
| `!drop <item>` | Drop specified item from inventory |
| `!help` | List all commands |

### Attack Detection
Listens to `entityHurt` on the bot entity. Finds the nearest player within 5 m and calls `trust.onAttacked()`.

---

## Bot Creation — bot.ts

### `createBot(cfg)`
- Creates mineflayer bot with `auth: 'offline'`
- Loads `mineflayer-pathfinder` plugin
- Attempts to load `mineflayer-pvp` plugin (optional, falls back gracefully)
- On `spawn`: configures `Movements` — canDig=true, digCost=1, allowSprinting=true, allowParkour=true, blocksCantBreak={bedrock, obsidian}
- If `cfg.password` is set: sends `/register <pw> <pw>` then `/login <pw>` with delays
- On `death`: calls `(bot as any).respawn()` and then `/grave` after 3 s (to recover items from grave plugins)
- Handles `error`, `end`, `kicked` events with log output

---

## LLM Client — llm.ts

### `OllamaClient`
| Method | Description |
|---|---|
| `ping()` | GET `/api/tags`, checks model exists, returns bool |
| `chat(messages, format?)` | POST `/api/chat`, stream=false, returns content string |
| `getModel()` | Returns model name string |

### Inference Settings
```
temperature: 0.15    ← low = deterministic, less hallucination
num_predict: 80      ← max tokens per response
repeat_penalty: 1.1  ← reduces repetition
```

### Format Parameter
Passing `'json'` to `chat()` enables Ollama JSON mode — model is forced to output valid JSON.

---

## Brain — brain.ts (Decision Maker)

### `Brain` — The core intelligence

#### `pickGoal()` — 4-tier priority cascade

```
Tier 0: Player goals (pushPlayerGoal queue)    ← highest priority
Tier 1: deterministicGoal()                    ← inventory-aware rules
Tier 2: Strategy queue (STRATEGIES[phase])     ← phase progression
Tier 3: llmGoal()  (rate-limited 15s)          ← Ollama fallback
Tier 4: fallback()                             ← always returns something
```

#### Phase Detection
| Phase | Condition |
|---|---|
| `early_game` | Default; no iron pickaxe or not full iron armor |
| `mid_game` | Stone pickaxe (tier ≥ 1) AND furnace in inv or world |
| `late_game` | Iron pickaxe (tier ≥ 2) AND full iron armor |

Phase change triggers a fresh strategy queue from `STRATEGIES[phase]`.

#### `deterministicGoal()` — 14-step priority waterfall
Each step returns a Goal or falls through to the next:

| Step | Condition | Goal |
|---|---|---|
| 0 | Unequipped armor in inventory | `survive/equip_armor` |
| 1a | Hostile ≤16 m + can fight | `combat/nearest` |
| 1b | Hostile + low HP or ≤5 m | `survive/flee` |
| 2a | HP ≤10, no hostile, has food | `survive/eat` |
| 2b | Food ≤6 | `survive/eat` |
| 2c | Food ≤14 and HP <18, has food | `survive/eat` |
| 3 | Night + has bed or knows bed location | `survive/sleep` |
| 3b | Night + no bed + enough wool+planks | `craft/white_bed` |
| 3c | Night + no bed + not enough wool | `hunt/sheep` |
| 4 | No logs AND no planks | `gather/wood` |
| 5 | No crafting table (inv or world) | `craft/crafting_table` or `gather/wood` |
| 6 | No pickaxe at all (tier=-1) | `craft/wooden_pickaxe` or `gather/wood` |
| 7 | No sword at all | `craft/wooden_sword` or `gather/wood` |
| 8 | Only wooden pickaxe (tier=0) | `craft/stone_pickaxe` or `gather/stone` |
| 9 | No food | `hunt/cow` |
| 10 | No furnace (inv or world) | `craft/furnace` or `gather/stone` |
| 11 | No coal/charcoal | `gather/coal` |
| 12 | No iron pickaxe (tier<2) | `craft/iron_pickaxe` or `smelt/iron_ingot` or `explore/iron_ore` |
| 13 | Iron sword tier <2 + enough ingots | `craft/iron_sword` |
| 14 | Missing iron armor piece + enough ingots | `craft/<piece>` or smelt/explore |

#### Loop Suppression
- Tracks fail timestamps in `failHistory` (120 s window)
- If same goal+target fails **3 times** → suppressed for **90 s**
- Suppressed goals are skipped at all tiers
- Successful gather wood un-suppresses all dependent craft goals

#### `fleeSafeUntil`
After a successful flee, blocks `survive/flee` for **30 s** to prevent flee loops.

#### LLM Prompt Contents
Sent to Ollama every ≥15 s when tiers 0–2 yield nothing:
```
phase, hp, food, time, y-level, armed/unarmed, pickaxe_tier
nearby entities (with ! prefix for hostiles)
inventory (first 15 items)
craftable_now (items bot can craft right now)
has_bed
learned (last 5 outcomes from LearningMemory)
known (discovered locations summary)
```

#### `alreadyAchieved()` — skip redundant strategy goals
- Pickaxe/sword: skips if current tier ≥ target tier
- Axe: skips if any axe present
- Gather: skips if count ≥ threshold (wood=16, stone=16, coal=8, iron=12, food=8)

#### `canAttempt()` — prerequisite gates
- `gather/stone`, `gather/coal`: need pickaxe tier ≥ 0
- `gather/iron`: need pickaxe tier ≥ 1
- `gather/diamond`: need pickaxe tier ≥ 2
- `craft/*`: need planks/logs for wood tools; cobblestone for stone tools; crafting table for 3×3 recipes

---

## Executor — executor.ts

### `run(goal: Goal)`
Dispatches to the appropriate goal module. Records outcome to `LearningMemory` including:
- goal, target, success, duration (ms)
- items gained (map of name→count)
- timeOfDay ('day'/'night')
- nearbyThreats (hostile names within 16 m)

### `emergency(): Goal | null`
Pure code — no LLM. Checked every 1 s by the safety timer.

| Condition | Goal |
|---|---|
| HP ≤ 4 | `survive/flee` — critical health |
| Food ≤ 6 | `survive/eat` — starving |
| HP ≤ 14 AND food ≤ 14 | `survive/eat` — eat to heal |
| Hostile ≤ 5 m + has weapon + HP > 6 | `combat/nearest` |
| Hostile ≤ 5 m + no weapon | `survive/flee` |

---

## Goal: Survive — goals/survive.ts

### `executeSurvive(bot, target)`
Dispatcher to sub-functions.

### `eat(bot)`
- Skips if food ≥ 16
- Calls `getBestFood(bot)` to pick highest-value food item
- `bot.equip(food, 'hand')` → `bot.consume()`

### `flee(bot)`
- Gets all hostiles within 24 m
- Computes average direction away from all hostiles (vector sum)
- Sprints 32 m in that direction using `navigateTo()`
- Returns success=true only if 0 hostiles remain within 24 m after fleeing

### `sleepInBed(bot)`
4-step process:
1. If bed item in inventory → call `placeBedNearby()` → sleep in placed bed
2. Check for existing bed ≤ 16 m → navigate → `bot.sleep()`
3. If wool ≥ 3 + planks ≥ 3 → craft `white_bed` → place it
4. Fail with reason string

**Conditions for sleep:** Must be night (`12542 < timeOfDay < 23460`), no hostiles within 12 m.

### `equipBestArmour(bot)`
- Checks 4 armor slots (5=head, 6=torso, 7=legs, 8=feet)
- For each slot, picks the best tier available from inventory
- Priority per slot: netherite > diamond > iron > golden > chainmail > leather
- Only equips if inventory item is better tier than currently equipped

### `checkHealth(bot)`
- If HP ≤ 10 + hostiles nearby → flee
- Else if food < 16 → eat
- Else → healthy, return success

---

## Goal: Gather — goals/gather.ts

### `executeGather(bot, target)`

**Target → Block names mapping** (via `BLOCK_ALIASES`):
- `wood` → all `*_log` variants
- `stone` → cobblestone, stone, deepslate variants
- `coal` → coal_ore, deepslate_coal_ore
- `iron` → iron_ore, deepslate_iron_ore, raw_iron
- `diamond` → diamond_ore, deepslate_diamond_ore
- etc.

**Target counts** (stops mining once reached):
- wood: 16, stone: 24, all others: 8

**Algorithm:**
1. `scanForBlocks()` — finds up to 10 nearest matching blocks within 64 m
2. Tracks `triedPositions` set to avoid retrying same block
3. Expands to 128 m if nothing found at 64 m
4. `equipToolForBlock()` — equips correct tool; skips block if tool required but missing
5. For tree logs: uses `y=null` in `navigateTo()` (GoalXZ — doesn't try to climb)
6. `bot.dig(block, true)` — instant-dig flag
7. `collectNearbyDrops()` — navigates to item entities within 10 m

**navFails counter:** Stops early if ≥ 4 consecutive navigation failures.

**Tool requirement:**
- Stone/ores: must have pickaxe or block won't drop
- Wood/sand/dirt: tool optional (mines slower by hand)

---

## Goal: Craft/Smelt — goals/craft.ts

### `executeCraft(bot, target, quantity=1)`

**Already have check:** Returns success immediately if `countOf(bot, target) >= quantity`.

**Smelting targets** (handled differently from crafting):
| Target | Input | Default Fuel |
|---|---|---|
| `iron_ingot` | raw_iron | coal |
| `gold_ingot` | raw_gold | coal |
| `charcoal` | any *_log | any *_log |
| `cooked_beef` | beef | coal |
| `cooked_porkchop` | porkchop | coal |
| `cooked_chicken` | chicken | coal |
| `cooked_mutton` | mutton | coal |

Fuel fallback order: coal → charcoal → any log

**Pre-craft wood processing:**
If bot has logs: auto-converts logs→planks (up to 12), then makes sticks (up to 8) before attempting any craft.

**3-step craft attempt:**
1. `bot.recipesFor(id, null, 1, null)` — try 2×2 (no table needed)
2. `getCraftingTable()` — find/place crafting table
3. `bot.recipesFor(id, null, 1, ctBlock)` — try 3×3 with table

### `getCraftingTable(bot)`
1. Find within 6 m → navigate → return
2. Place from inventory if available
3. If no table in inventory: `convertLogsToPlanks(4)` → craft 2×2 → place

### `getFurnace(bot)`
1. Find within 16 m → navigate → return
2. Place from inventory if available

### `smelt(bot, input, fuel, quantity)`
- Gets/places furnace
- `openFurnace()` → `putFuel()` → `putInput()`
- Waits up to `min(count × 12 000ms, 90 000ms)`
- Polls `outputItem().count` every 2 s
- `takeOutput()` → `furnace.close()`

### `convertLogsToPlanks(bot, needed)`
Converts any inventory log type to its matching planks. Handles all wood types dynamically via `bot.recipesFor()`.

### `ensureSticks(bot, needed)`
Converts planks → sticks as needed.

### `listCraftable(bot)` (exported utility)
Returns array of craftable item names given current inventory.

---

## Goal: Explore — goals/explore.ts

### `executeExplore(bot, target, world)`

**If target has known position in WorldMemory:**
- Navigate to it if dist > 20 m
- On arrival: `world.scan()` + `lootNearbyChests()`

**Strategy selection:**
- Ore targets (coal_ore, iron_ore, gold_ore, diamond_ore) → `deepDig()`
- Everything else (village, cave, any, etc.) → `surfaceScan()`

### `surfaceScan(bot, target, world)`
- Picks an unexplored destination 80–160 m away
- `isExplored()` grid: 64×64 block cells tracked in memory
- Navigates there, marks explored, scans world, loots chests
- Reports found/not-found

### `deepDig(bot, target, world)`
Target Y levels:
| Ore | Target Y |
|---|---|
| coal_ore | 64 |
| iron_ore | 16 |
| copper_ore | 48 |
| gold_ore | -16 |
| diamond_ore | -58 |

- Navigates to target Y if >8 blocks away
- Places torches if underground and dark
- Digs a branch tunnel 24 m in random direction
- Scans world at each point

### `lootNearbyChests(bot, world)`
- Finds up to 3 chests within 24 m
- Opens each, takes only items in `USEFUL` whitelist (iron, diamonds, food, weapons, armor, etc.)
- Records chest position in WorldMemory

### `collectNearbyDrops(bot)`
Navigates to up to 4 item entities within 8 m.

### `placeTorchIfDark(bot)`
Below y=50: checks light level, places torch from inventory if ≤7.

---

## Goal: Farm/Hunt — goals/farm.ts

### `executeFarm(bot, target)`
Valid targets: cow, sheep, chicken, pig, hunt (any food mob)

**Hunt loop:**
1. `getNearestPassive(bot, mobNames, 96)` — finds mob within 96 m
2. Equips best sword
3. `navigateTo()` within 2 m
4. Attack loop: up to 10 hits with 500 ms cooldown between each
5. Collect item drops within 10 m
6. Repeats up to 3× (sheep) or 4× (others) per goal call

**Post-hunt cooking:** `tryCookMeat()` — if raw meat + fuel + furnace available:
- Opens furnace, puts fuel and raw meat in
- Waits up to `min(count × 12 000ms, 60 000ms)`
- Takes cooked output

---

## Goal: Combat — goals/combat.ts

### `executeCombat(bot, target)`

**Target `'nearest'`:** Finds closest hostile within 16 m, sorted by distance.
**Target `'<mobName>'`:** Filters to that mob type within 16 m.

**Weapon selection:** `getBestTool(bot, 'sword')` first, then axe. Returns failure if no weapon.

**Shield:** Auto-equips off-hand shield when fighting skeleton, stray, pillager, or blaze.

**Melee loop (max 30 s):**
1. Check if mob is dead → collect drops → return success
2. Check HP ≤ 6 → sprint away 24 m → return `disengaged`
3. If dist > 3.5 m → `GoalFollow(mob, 2)` pathfinder
4. Attack with 600 ms cooldown

**Creeper special (`fightCreeper()`):**
- Hit at ≤3.5 m → immediately sprint 6 m away
- Repeat up to 15 s
- Prevents creeper explosion (hit-and-run)

### `shouldFight(bot)` — exported helper
Returns true if bot has sword OR axe AND HP > 6.
Used by Brain and Executor to decide fight vs flee.

---

## Goal: Social — goals/social.ts

### `executeSocial(bot, target, trust)`

**`target='greet'`:** Sends random greeting string to chat, increments trust for all online players.

**`target='flee_threat'`:** Finds trust-threat players (<0.25 score) within 20 m, runs opposite direction for 5 s.

**`target='follow_trusted'` or `'follow'`:**
- Picks nearest non-threat player (falls back to any player if all are threats)
- `GoalFollow(entity, 3)` with `dynamic=true` so pathfinder re-routes as player moves
- Polls every 500 ms for 30 s, refreshes entity reference each tick
- Stops if player disconnects

**`target='follow:<Name>'`:** Follows specific named player for 20 s.

---

## Goal: Build — goals/build.ts

### `executeBuild(bot, target)`
If target not in structures dictionary → falls back to `executeCraft(bot, target)`.

### Built-in Structures

**`shelter`:** 5×5 wooden shelter, 3 blocks tall, oak_planks walls + roof, door gap at x=2 z=0 y=0–1, 2 torches inside.

**`chest_room`:** 3×3 cobblestone platform with a row of 3 chests on top.

**`furnace_station`:** 3 cobblestone base blocks, furnace at x=0, crafting_table at x=1, furnace at x=2.

### Build Process
1. `findFlatSite(bot, w, d, radius=24)` — scans for flat 5×5 air+solid area
2. `prepareMaterials()` — tallies needed items → calls `ensureItem()` for each
3. `buildStructure()` — sorts blocks bottom-up, navigates to each, `placeBlock()`
4. `placeBlock()` — tries 6 adjacent faces for a solid surface to place against

---

## Goal: Chat — goals/chat.ts

### `parseChatIntent(llm, username, message, botContext)`

**Two-stage parsing:**
1. **Keyword parser** (runs first, no LLM cost) — regex matches on lowercase message
2. **LLM parser** — only called if keyword parser returns null

### Keyword Parser Coverage
| Pattern | Goal/Target |
|---|---|
| follow/come here | social/follow_trusted |
| stop/halt/freeze | null (no goal) |
| get/gather/chop + wood/log/tree | gather/wood |
| get/mine/gather + stone/cobble | gather/stone |
| get/mine + iron | gather/iron |
| get/mine + coal | gather/coal |
| get/mine + diamond | gather/diamond |
| hunt/kill/get + cow/beef/steak | hunt/cow |
| hunt/kill/get + sheep/wool | hunt/sheep |
| hunt/kill/get + chicken | hunt/chicken |
| hunt/kill/get + pig/pork | hunt/pig |
| explore/wander/roam | explore/any |
| find + village/town | explore/village |
| find + cave | explore/cave |
| fight/attack + mob/zombie/skeleton | combat/nearest |
| craft/make + pickaxe | craft/wooden|stone|iron_pickaxe |
| craft/make + sword | craft/wooden|stone|iron_sword |
| craft/make + furnace | craft/furnace |
| craft/make + bed | craft/white_bed |
| smelt/cook + iron | smelt/iron_ingot |
| build/make + shelter/house/base | build/shelter |
| sleep/rest/go to bed | survive/sleep |
| what are you doing / status | question (no goal) |

### `intentToGoal(intent)` → `Goal | null`
Validates goal type against VALID_GOALS set before casting.

### Proactive Chat (`proactiveChat()`)
- 30 s cooldown between messages
- Only fires if players are online
- Announces current activity (chopping trees, mining coal, etc.)

### `buildBotContext(bot)` — context string for LLM
Returns: `hp=X/20 food=Y/20 time=day|night pos=(x,y,z) inventory=[...]`

---

## Memory: Learning — memory/learning.ts

### `LearningMemory`
Ring buffer of up to 500 `LearningEntry` records, persisted to `data/learning.json`.

### Key Methods
| Method | Description |
|---|---|
| `record(entry)` | Appends entry, updates stats, triggers debounced save (2 s) |
| `getScore(goal, target)` | EWMA success rate 0–1 (0.5 if <2 attempts) |
| `isSuppressed(goal, target)` | True if failed ≥3 times in 5 min window (suppressed 3 min) |
| `lastThree(n=5)` | Compact string: `gather(wood)✓ craft(crafting_table)✗` |
| `successRate(goal)` | Overall success % for a goal type |
| `efficiency(goal, target)` | Items/minute for gather/hunt goals |
| `recentAttempts(goal, target, window)` | Count of attempts in time window |
| `summary()` | `wins:...  | avoid:...` for LLM prompt |

### EWMA (Exponentially Weighted Moving Average)
`alpha=0.3` — recent results count more than old ones.
Formula: `ewma = 0.3 * result + 0.7 * previous_ewma`

### Suppression Logic
- Window: 5 min (300 000 ms)
- Threshold: 3 failures within window
- Cooldown: 3 min (180 000 ms)
- Note: This is **separate** from Brain's own suppression — both run in parallel.

---

## Memory: Trust — memory/trust.ts

### `TrustMemory`
Persisted to `data/trust.json`. Per-player profile with trust score 0–1.

### Score Changes
| Event | Delta |
|---|---|
| Attacked bot | -0.40 |
| Gave item | +0.15 |
| Chat message | +0.01 |

### Thresholds
| Method | Threshold | Meaning |
|---|---|---|
| `isTrusted(u)` | score > 0.65 | Safe to interact with |
| `isThreat(u)` | score < 0.25 | Actively hostile player |

**Default starting score:** 0.7 (friendly by default — can follow, interact freely)
One attack drops to 0.3 (no longer trusted, not yet threat threshold).
Two attacks drop to ~0.0 (hard threat).

---

## Memory: World — memory/world.ts

### `WorldMemory`
Persisted to `data/world.json`. Stores up to 5 discoveries per location type.

### Discovery Keys
| Key | How Discovered |
|---|---|
| `village` | ≥3 villager entities nearby |
| `chest` | `findBlock` within 24 m |
| `furnace` | `findBlock` within 24 m |
| `crafting_table` | `findBlock` within 24 m |
| `smithing_table` | `findBlock` within 24 m |
| `enchanting_table` | `findBlock` within 24 m |
| `bed` | Any bed block within 48 m |
| `cave_entrance` | Bot's position when y < 50 |

### Key Methods
| Method | Description |
|---|---|
| `scan(bot)` | Runs all detection logic above |
| `discover(name, pos)` | Adds discovery if not already within 10 blocks |
| `getNearest(name)` | Returns most recently discovered position for key |
| `getNearestTo(name, pos)` | Returns position nearest to given coordinates |
| `knows(name)` | Returns true if any discovery exists for key |
| `summary()` | First 8 known keys as comma string |

---

## Navigation — utils/navigation.ts

### `navigateTo(bot, x, y|null, z, reach=2, timeoutMs=30000)`
- `y=null` → uses `GoalXZ` (ignores height — good for tree logs)
- `y=number` → uses `GoalNear(x,y,z,reach)`
- **Adaptive timeout:** `max(timeoutMs, min(dist×500, 90000))` — far targets get more time

### Stuck Detection
- Checks every 2 500 ms
- "Stuck" = moved < 0.1 blocks since last check
- After 5 stuck checks (12.5 s) → attempts recovery
- Max 4 recovery attempts before giving up

### Recovery Strategies (cycled)
| Attempt | Strategy |
|---|---|
| 0 | Jump + random strafe (forward/back/left/right) |
| 1 | Dig front-facing block at eye, foot, or below-foot level |
| 2 | Sprint backward + jump for 900 ms |
| 3 | Dig block below bot → jump |

### `goToBlock(bot, block, reach=2)`
Convenience wrapper around `navigateTo()` using block.position.

### `wander(bot, radius=20, attempts=5)`
Tries up to 5 random points within radius. Useful as last-resort unstick.

### `lookAround(bot)`
Adds random yaw (±π) and small pitch variation to current head angle.

### `lookAtNearestPlayer(bot, range=16)`
Turns to look at nearest player's head position.

### Movement Settings Applied per `navigateTo()` call
```
allowSprinting = true
canDig = true
digCost = 2
maxDropDown = 4
allow1by1towers = true
```

---

## Logger — utils/logger.ts

| Method | Color | Icon | Usage |
|---|---|---|---|
| `log.info(msg)` | cyan | ℹ | General info |
| `log.success(msg)` | green | ✔ | Goal completed |
| `log.warn(msg)` | yellow | ⚠ | Non-fatal issues |
| `log.error(msg)` | red | ✖ | Errors |
| `log.chat(u, m)` | magenta | 💬 | Player chat |
| `log.goal(msg)` | blue | 🎯 | Goal start |
| `log.brain(msg)` | magenta | 🧠 | Brain decisions |
| `log.divider()` | gray | ─×60 | Section break |

---

## Data Files

*(Not shown in provided code — referenced by other modules)*

### `src/data/blocks.ts` (referenced)
- `BLOCK_ALIASES`: target name → array of block names
- `TOOL_FOR_BLOCK`: block name → tool type ('pickaxe'/'axe'/'any')
- `MIN_TIER_FOR_ORE`: block name → minimum pickaxe tier (0=wood, 1=stone, 2=iron)
- `TOOL_TIERS`: array of `{pickaxe, axe, shovel}` name sets by tier
- `WOOD_BLOCKS`: array of wood block names
- `BED_BLOCKS`: array of all color bed block names

### `src/data/items.ts` (referenced)
- `hasItem(bot, name)` → boolean
- `hasAny(bot, names[])` → boolean
- `countItem(bot, name)` → number
- `getBestTool(bot, type)` → Item | null (picks highest-tier tool of given type)
- `getBestFood(bot)` → Item | null (picks highest-saturation food)

### `src/data/mobs.ts` (referenced)
- `HOSTILE_NAMES`: string[] of hostile mob names
- `FOOD_MOB_NAMES`: string[] of food mob names (cow, sheep, chicken, pig)
- `getNearestHostile(bot, radius)` → Entity | null
- `getNearestPassive(bot, names[], radius)` → Entity | null

### `src/data/strategies.ts` (referenced)
- `STRATEGIES`: `Record<Phase, Goal[]>` — ordered goal list per game phase
- `getPhase(bot)` → Phase

### `src/data/recipes.ts` (referenced but minimal — mineflayer handles recipes natively)

---

## Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `MC_HOST` | localhost | Server IP |
| `MC_PORT` | 25565 | Server port |
| `MC_USERNAME` | AIBot | Bot login name |
| `MC_VERSION` | 1.21.4 | MC protocol version |
| `MC_PASSWORD` | (empty) | Auth password for `/register` + `/login` |
| `OLLAMA_URL` | http://localhost:11434 | Ollama API base URL (optional — bot runs without it) |
| `OLLAMA_MODEL` | qwen2.5:1.5b | Model to use |
| `GOAL_TICK_MS` | 8000 | Sleep between goal cycles |
| `SAFETY_TICK_MS` | 1000 | Safety loop interval |

---

## Goal / Target Reference Table

| Goal | Valid Targets |
|---|---|
| `survive` | eat, flee, sleep, equip_armor, health |
| `gather` | wood, stone, coal, iron, diamond, food, sand, gravel |
| `craft` | crafting_table, wooden_pickaxe, wooden_axe, wooden_sword, wooden_shovel, stone_pickaxe, stone_sword, furnace, iron_pickaxe, iron_sword, iron_axe, iron_helmet, iron_chestplate, iron_leggings, iron_boots, shield, torch, chest, white_bed |
| `smelt` | iron_ingot, charcoal |
| `hunt` | cow, sheep, chicken, pig |
| `explore` | village, cave, any, iron_ore, diamond_ore |
| `build` | shelter, chest_room, furnace_station |
| `combat` | nearest |
| `social` | greet, flee_threat, follow_trusted, follow, follow:<Name> |

---

## Chat Commands Reference

### `!` Commands (direct, no LLM)
```
!stop       → pause bot
!start      → resume bot
!status     → hp / food / busy flag
!inv        → first 8 inventory slots
!world      → known locations
!follow     → start following you for 30 s
```

### Natural Language (keyword parsed first, then LLM)
```
"follow me"            → social/follow_trusted
"stop following"       → clears follow goal
"get some wood"        → gather/wood
"mine stone"           → gather/stone
"find iron"            → gather/iron
"hunt a cow"           → hunt/cow
"hunt sheep"           → hunt/sheep
"go explore"           → explore/any
"find a village"       → explore/village
"craft an iron sword"  → craft/iron_sword
"smelt iron"           → smelt/iron_ingot
"build a shelter"      → build/shelter
"go to sleep"          → survive/sleep
```

---

## ⚠️ Logic Errors & Bugs

> **All 14 bugs from v6 have been fixed.** See `Bugs.md` for the complete history of each fix.

### v7 Additional Fixes
| Issue | Fix |
|---|---|
| Bot crashed if Ollama not running | Ollama is now optional — bot starts in deterministic-only mode |
| Bot froze during LLM calls | 10s AbortSignal timeout on all LLM requests |
| Chat message spam | Global chat throttle via `chat_queue.ts` (max 1 msg/1.5s) |
| No auto-reconnect on disconnect | Auto-reconnect with 5s delay, up to 50 retries |
| Bot didn't fight back on attack | Combat retaliation via `entityHurt` event |
| Bot stuck without wood in barren area | Explore fallback when `gather/wood` is suppressed |
| LLM called too often (15s) | Rate-limited to 30s, skipped entirely when Ollama offline |
| No guard mode | `!guard` toggles periodic hostile scanning |
| Emergency detection too late (5m) | Emergency hostile radius widened to 8m |
| Flee blocked at critical HP | Critical flee at HP≤6 ignores cooldown |

---

## Improvement Recommendations

### High Impact
1. **Upgrade LLM model** — `qwen2.5:7b` is much more reliable; use `qwen2.5:1.5b` only for speed
2. **Add more exploration patterns** — spiral/grid search for systematic chunk coverage
3. **Persistent chunk memory** — save explored chunks to disk for 24/7 sessions

### Medium Impact
4. **Add `!goals` command** — print current strategy queue and suppressed goals
5. **Add `!brain` command** — show current phase and last 5 decisions
6. **World scan on `goal_reached`** — scan after each nav arrival to catch more discoveries

---

*Last updated: v7 overhaul*