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
    goalTickMs: Number(process.env.GOAL_TICK_MS ?? 30000),
    safetyTickMs: Number(process.env.SAFETY_TICK_MS ?? 1500),
};
async function main() {
    logger_1.log.divider();
    logger_1.log.info(`🤖 Minecraft AI Bot v4`);
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
        // Safety loop — pure code, checks every 1.5s
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
        // Goal loop — runs next goal when bot is free
        setInterval(async () => {
            if (!running || busy)
                return;
            busy = true;
            try {
                const goal = await brain.pickGoal();
                const result = await executor.run(goal);
                brain.recordOutcome(goal.goal, goal.target, result.success, result.reason);
            }
            catch (e) {
                logger_1.log.error(`Goal error: ${e.message}`);
            }
            busy = false;
        }, cfg.goalTickMs);
        // First goal after 4s
        setTimeout(async () => {
            if (busy)
                return;
            busy = true;
            try {
                const goal = await brain.pickGoal();
                const result = await executor.run(goal);
                brain.recordOutcome(goal.goal, goal.target, result.success, result.reason);
            }
            catch (e) {
                logger_1.log.error(e.message);
            }
            busy = false;
        }, 4000);
    });
    // Chat commands
    bot.on('chat', (username, message) => {
        if (username === bot.username || !message.startsWith('!'))
            return;
        trust.onChat(username, message);
        logger_1.log.chat(username, message);
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
                bot.chat(`hp=${Math.round(bot.health)} food=${Math.round(bot.food)} model=${llm.getModel()}`);
                break;
            case 'trust':
                logger_1.log.info(JSON.stringify(trust.players, null, 2));
                bot.chat('Trust dumped.');
                break;
            case 'world':
                bot.chat(`Known: ${world.summary()}`);
                break;
            case 'inv':
                bot.chat(`Inv: ${bot.inventory.items().slice(0, 6).map(i => `${i.name}x${i.count}`).join(', ')}`);
                break;
            default: bot.chat(`Got it: "${cmd}"`);
        }
    });
    // Detect attacks
    bot.on('entityHurt', (entity) => {
        if (entity !== bot.entity)
            return;
        const attacker = Object.values(bot.entities).find(e => e.type === 'player' && e.position?.distanceTo(bot.entity.position) < 5);
        if (attacker?.username) {
            trust.onAttacked(attacker.username);
            logger_1.log.warn(`${attacker.username} attacked me!`);
        }
    });
    process.on('SIGINT', () => { running = false; bot.quit(); process.exit(0); });
}
main().catch(e => { logger_1.log.error(`Fatal: ${e.message}`); process.exit(1); });
