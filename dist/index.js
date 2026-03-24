"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const bot_1 = require("./bot");
const llm_1 = require("./llm");
const brain_1 = require("./brain");
const executor_1 = require("./executor");
const learning_1 = require("./memory/learning");
const trust_1 = require("./memory/trust");
const world_1 = require("./memory/world");
const chat_1 = require("./goals/chat");
const navigation_1 = require("./utils/navigation");
const logger_1 = require("./utils/logger");
const cfg = {
    mc: {
        host: process.env.MC_HOST ?? 'localhost',
        port: Number(process.env.MC_PORT ?? 25565),
        username: process.env.MC_USERNAME ?? 'AIBot',
        version: process.env.MC_VERSION ?? '1.21.4',
        password: process.env.MC_PASSWORD ?? '',
    },
    ollamaUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL ?? 'qwen2.5:1.5b',
    goalTickMs: Number(process.env.GOAL_TICK_MS ?? 8000),
    safetyTickMs: Number(process.env.SAFETY_TICK_MS ?? 1000),
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function main() {
    logger_1.log.divider();
    logger_1.log.info(`🤖 Minecraft AI Bot v6`);
    logger_1.log.info(`   Server : ${cfg.mc.host}:${cfg.mc.port}`);
    logger_1.log.info(`   Model  : ${cfg.ollamaModel}`);
    logger_1.log.divider();
    const llm = new llm_1.OllamaClient(cfg.ollamaModel, cfg.ollamaUrl);
    if (!await llm.ping())
        process.exit(1);
    const learning = new learning_1.LearningMemory();
    const trust = new trust_1.TrustMemory();
    const world = new world_1.WorldMemory();
    const bot = (0, bot_1.createBot)(cfg.mc);
    const brain = new brain_1.Brain(bot, llm, learning, trust, world);
    const executor = new executor_1.Executor(bot, learning, trust, world);
    let running = false;
    let busy = false;
    bot.once('spawn', () => {
        running = true;
        // ─── Safety loop (1s) — emergency checks ──────────────────────────────
        setInterval(async () => {
            if (!running || busy)
                return;
            world.scan(bot);
            const emergency = executor.emergency();
            if (emergency) {
                busy = true;
                const result = await executor.run(emergency);
                brain.recordOutcome(emergency.goal, emergency.target, result.success, result.reason);
                busy = false;
            }
        }, cfg.safetyTickMs);
        // ─── Look around behaviors ────────────────────────────────────────────
        setInterval(async () => {
            if (!running || busy)
                return;
            try {
                await (0, navigation_1.lookAtNearestPlayer)(bot, 12);
            }
            catch { }
        }, 3000);
        setInterval(async () => {
            if (!running || busy)
                return;
            try {
                await (0, navigation_1.lookAround)(bot);
            }
            catch { }
        }, 8000);
        // ─── Auto-equip armor when inventory changes ──────────────────────────
        bot.inventory.on('updateSlot', async () => {
            if (busy)
                return;
            // Check if we have unequipped armor pieces
            const mcData = require('minecraft-data')(bot.version);
            const ARMOUR_SLOTS = [
                { slot: 5, names: ['helmet'] },
                { slot: 6, names: ['chestplate'] },
                { slot: 7, names: ['leggings'] },
                { slot: 8, names: ['boots'] },
            ];
            for (const { slot, names } of ARMOUR_SLOTS) {
                const current = bot.inventory.slots[slot];
                const candidate = bot.inventory.items().find(i => names.some(n => i.name.includes(n)) &&
                    (!current || i.type !== current.type));
                if (candidate && !current) {
                    try {
                        const dest = slot === 5 ? 'head' : slot === 6 ? 'torso' : slot === 7 ? 'legs' : 'feet';
                        await bot.equip(candidate, dest);
                        logger_1.log.success(`[auto-equip] Equipped ${candidate.name}`);
                    }
                    catch { }
                }
            }
        });
        // ─── Event-driven goal loop ───────────────────────────────────────────
        async function goalLoop() {
            while (running) {
                if (busy) {
                    await sleep(500);
                    continue;
                }
                busy = true;
                try {
                    const goal = await brain.pickGoal();
                    (0, chat_1.proactiveChat)(bot, `${goal.goal}_${goal.target}`);
                    const result = await executor.run(goal);
                    brain.recordOutcome(goal.goal, goal.target, result.success, result.reason);
                }
                catch (e) {
                    logger_1.log.error(`Goal error: ${e.message}`);
                }
                busy = false;
                await sleep(800);
            }
        }
        setTimeout(() => goalLoop(), 4000);
    });
    // ─── Smart Chat ─────────────────────────────────────────────────────────
    bot.on('chat', async (username, message) => {
        if (username === bot.username)
            return;
        trust.onChat(username, message);
        logger_1.log.chat(username, message);
        if (message.startsWith('!')) {
            const cmd = message.slice(1).trim().toLowerCase();
            switch (cmd) {
                case 'stop':
                    running = false;
                    bot.chat('Stopped.');
                    break;
                case 'start':
                    running = true;
                    bot.chat('Running.');
                    break;
                case 'status':
                    bot.chat(`hp=${Math.round(bot.health)} food=${Math.round(bot.food)}`);
                    break;
                case 'inv':
                    bot.chat(`Inv: ${bot.inventory.items().slice(0, 8).map(i => `${i.name}x${i.count}`).join(', ')}`);
                    break;
                case 'world':
                    bot.chat(`Known: ${world.summary()}`);
                    break;
                default: bot.chat(`Unknown: ${cmd}`);
            }
            return;
        }
        try {
            const context = (0, chat_1.buildBotContext)(bot);
            const intent = await (0, chat_1.parseChatIntent)(llm, username, message, context);
            logger_1.log.info(`[chat] intent=${intent.intent} goal=${intent.goal}(${intent.target}) reply="${intent.reply}"`);
            if (intent.reply)
                bot.chat(intent.reply);
            const goal = (0, chat_1.intentToGoal)(intent);
            if (goal) {
                brain.pushPlayerGoal(goal);
                logger_1.log.info(`[chat] queued: ${goal.goal}(${goal.target})`);
            }
        }
        catch (e) {
            logger_1.log.error(`Chat error: ${e.message}`);
            try {
                const response = await llm.chat([
                    { role: 'system', content: 'You are a Minecraft bot. Be short and fun.' },
                    { role: 'user', content: `${username}: ${message}` },
                ]);
                bot.chat(response);
            }
            catch { }
        }
    });
    // ─── Detect player attacks ──────────────────────────────────────────────
    bot.on('entityHurt', (entity) => {
        if (entity !== bot.entity)
            return;
        const attacker = Object.values(bot.entities).find(e => e.type === 'player' && e.position?.distanceTo(bot.entity.position) < 5);
        if (attacker?.username) {
            trust.onAttacked(attacker.username);
            logger_1.log.warn(`${attacker.username} attacked me!`);
        }
    });
    // ─── Pick up items dropped near the bot ─────────────────────────────────
    bot.on('playerCollect', (collector, collected) => {
        if (collector.username === bot.username) {
            logger_1.log.info(`[pickup] Collected item`);
        }
    });
    process.on('SIGINT', () => { running = false; bot.quit(); process.exit(0); });
}
main().catch(e => { logger_1.log.error(`Fatal: ${e.message}`); process.exit(1); });
