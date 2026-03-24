"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Agent = void 0;
const memory_1 = require("./memory");
const skills_1 = require("./skills");
const logger_1 = require("./utils/logger");
// ── All actions the LLM can choose from ───────────────────────────────────────
const ACTIONS = {
    // Observation
    look_around: {
        description: 'Observe surroundings — always do this first each session',
        run: async (bot) => skills_1.survival.getStatus(bot),
    },
    // Movement
    go_to: {
        description: 'Pathfind to exact coordinates. params: x, y, z',
        run: async (bot, p) => skills_1.movement.goTo(bot, p.x, p.y, p.z),
    },
    go_near: {
        description: 'Walk near coordinates (within range). params: x, y, z, range?',
        run: async (bot, p) => skills_1.movement.goNear(bot, p.x, p.y, p.z, p.range),
    },
    go_to_block: {
        description: 'Find nearest block of a type and walk to it. params: blockName, maxDistance?',
        run: async (bot, p) => skills_1.movement.goToBlock(bot, p.blockName, p.maxDistance),
    },
    follow: {
        description: 'Follow a player or entity by name. params: targetName',
        run: async (bot, p) => skills_1.movement.follow(bot, p.targetName),
    },
    stop_moving: {
        description: 'Stop all movement immediately',
        run: async (bot) => skills_1.movement.stop(bot),
    },
    // Gathering
    mine: {
        description: 'Mine N blocks of a type. params: blockName, count?',
        run: async (bot, p) => skills_1.gather.mine(bot, p.blockName, p.count),
    },
    collect_drops: {
        description: 'Pick up nearby dropped items on the ground. params: maxDistance?',
        run: async (bot, p) => skills_1.gather.collectDrops(bot, p.maxDistance),
    },
    craft: {
        description: 'Craft an item. params: itemName, count?',
        run: async (bot, p) => skills_1.gather.craft(bot, p.itemName, p.count),
    },
    smelt: {
        description: 'Smelt items in a nearby furnace. params: inputName, fuelName, count?',
        run: async (bot, p) => skills_1.gather.smelt(bot, p.inputName, p.fuelName, p.count),
    },
    equip_tool: {
        description: 'Equip best tool of a type. params: toolType (pickaxe/axe/sword/shovel)',
        run: async (bot, p) => skills_1.gather.equipBestTool(bot, p.toolType),
    },
    place_block: {
        description: 'Place a block at coordinates. params: blockName, x, y, z',
        run: async (bot, p) => skills_1.gather.placeBlock(bot, p.blockName, p.x, p.y, p.z),
    },
    // Combat
    attack: {
        description: 'Attack a specific mob by name. params: mobName',
        run: async (bot, p) => skills_1.combat.attack(bot, p.mobName),
    },
    attack_nearest: {
        description: 'Attack the nearest hostile mob automatically',
        run: async (bot) => skills_1.combat.attackNearest(bot),
    },
    flee: {
        description: 'Run away from nearby hostile mobs. params: distance?',
        run: async (bot, p) => skills_1.combat.flee(bot, p.distance),
    },
    // Survival
    eat: {
        description: 'Eat food from inventory. params: foodName? (omit for auto-best)',
        run: async (bot, p) => skills_1.survival.eat(bot, p.foodName),
    },
    sleep: {
        description: 'Sleep in a nearby bed to skip the night',
        run: async (bot) => skills_1.survival.sleep(bot),
    },
    // Utility
    chat: {
        description: 'Send a chat message. params: message',
        run: async (bot, p) => { bot.chat(p.message); return `Said: "${p.message}"`; },
    },
    wait: {
        description: 'Wait and do nothing. params: seconds (max 10)',
        run: async (_bot, p) => {
            await new Promise((r) => setTimeout(r, Math.min(p.seconds ?? 3, 10) * 1000));
            return `Waited ${p.seconds}s`;
        },
    },
};
// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt() {
    const actionList = Object.entries(ACTIONS)
        .map(([name, a]) => `  • ${name} — ${a.description}`)
        .join('\n');
    return `You are an intelligent autonomous Minecraft survival bot running on version 1.21.4.
Each tick you receive the current game state and must decide what to do next.

Respond ONLY with a valid JSON object in this exact format:
{
  "thought": "your reasoning about the current situation and what to do",
  "action": "action_name",
  "params": { "param": value },
  "remember": { "key": "some_key", "fact": "something important to remember" }
}

Set "remember" to null if nothing important to save.
"params" can be {} if the action takes no parameters.

AVAILABLE ACTIONS:
${actionList}

SURVIVAL PRIORITIES (follow this order):
1. If health <= 6 — flee or eat immediately
2. If food < 14 — eat before doing anything else
3. If night time (and have a bed) — sleep
4. If hostile mobs nearby — fight or flee based on gear
5. Otherwise — work toward current goal

PROGRESSION GOALS (early game order):
  punch logs → craft planks → craft crafting_table → craft wooden_pickaxe
  → mine stone → craft stone_pickaxe → mine coal + iron
  → smelt iron → craft iron_pickaxe → build shelter → craft bed

MEMORY TIPS:
  Use "remember" to save important things like:
  - "base"         → your base coordinates
  - "current_goal" → what you are working toward
  - "shelter"      → where your shelter is
  - "death_spot"   → where you last died

Output ONLY the JSON. No extra text, no markdown, no explanation.`;
}
// ── Agent class ───────────────────────────────────────────────────────────────
class Agent {
    bot;
    llm;
    memory;
    running = false;
    tick = 0;
    tickMs;
    memoryResetTicks;
    constructor(bot, llm, tickMs = 4000, memoryResetTicks = 100) {
        this.bot = bot;
        this.llm = llm;
        this.memory = new memory_1.Memory(40);
        this.tickMs = tickMs;
        this.memoryResetTicks = memoryResetTicks;
    }
    // ── Perceive ─────────────────────────────────────────────────────────────────
    perceive() {
        const threats = skills_1.combat.scanThreats(this.bot);
        const status = skills_1.survival.getStatus(this.bot);
        return `${status}\nThreats: ${threats}`;
    }
    // ── Think ─────────────────────────────────────────────────────────────────────
    async think(state) {
        const userMsg = {
            role: 'user',
            content: `[Tick ${this.tick}]\n${state}`,
        };
        this.memory.push(userMsg);
        const messages = this.memory.buildMessages(buildSystemPrompt());
        const raw = await this.llm.chat(messages);
        // Parse — strip fences just in case
        try {
            const clean = raw.replace(/```json|```/g, '').trim();
            const decision = JSON.parse(clean);
            if (typeof decision.action !== 'string')
                throw new Error('Missing action');
            if (!decision.params)
                decision.params = {};
            if (!decision.thought)
                decision.thought = '...';
            this.memory.push({ role: 'assistant', content: raw });
            return decision;
        }
        catch {
            logger_1.log.warn(`Failed to parse LLM output: ${raw.slice(0, 120)}`);
            // Safe fallback
            const fallback = {
                thought: 'Parse error — observing to recover',
                action: 'look_around',
                params: {},
                remember: null,
            };
            this.memory.push({ role: 'assistant', content: JSON.stringify(fallback) });
            return fallback;
        }
    }
    // ── Act ───────────────────────────────────────────────────────────────────────
    async act(decision) {
        const { thought, action, params, remember } = decision;
        logger_1.log.divider();
        logger_1.log.think(thought);
        logger_1.log.act(`${action}(${JSON.stringify(params)})`);
        // Save to long-term memory if requested
        if (remember?.key && remember?.fact) {
            this.memory.remember(remember.key, remember.fact, this.tick);
        }
        const actionDef = ACTIONS[action];
        if (!actionDef) {
            const msg = `Unknown action "${action}"`;
            logger_1.log.warn(msg);
            this.memory.push({ role: 'user', content: `Result: ${msg}` });
            return;
        }
        try {
            const result = await actionDef.run(this.bot, params ?? {});
            logger_1.log.success(result);
            this.memory.push({ role: 'user', content: `Result: ${result}` });
        }
        catch (err) {
            const msg = `Action "${action}" failed: ${err.message}`;
            logger_1.log.error(msg);
            this.memory.push({ role: 'user', content: `Result: ${msg}` });
        }
    }
    // ── Main loop ─────────────────────────────────────────────────────────────────
    async start() {
        this.running = true;
        logger_1.log.divider();
        logger_1.log.info(`Agent started — model: ${this.llm.getModel()}`);
        logger_1.log.info(`Tick interval: ${this.tickMs}ms`);
        logger_1.log.divider();
        while (this.running) {
            this.tick++;
            // Periodically clear short-term memory to prevent context drift
            if (this.tick % this.memoryResetTicks === 0) {
                this.memory.clearShortTerm();
                logger_1.log.info('Periodic memory reset');
            }
            try {
                const state = this.perceive();
                const decision = await this.think(state);
                await this.act(decision);
            }
            catch (err) {
                logger_1.log.error(`Tick ${this.tick} error: ${err.message}`);
            }
            await new Promise((r) => setTimeout(r, this.tickMs));
        }
    }
    stop() {
        this.running = false;
        logger_1.log.warn('Agent stopped');
    }
    // ── External controls ─────────────────────────────────────────────────────────
    /** Inject a priority instruction (e.g. from chat command) */
    inject(instruction) {
        this.memory.push({
            role: 'user',
            content: `[Priority instruction from player]: ${instruction}`,
        });
        logger_1.log.info(`Injected: "${instruction}"`);
    }
    dumpMemory() {
        this.memory.dump();
    }
}
exports.Agent = Agent;
