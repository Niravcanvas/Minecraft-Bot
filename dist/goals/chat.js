"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseChatIntent = parseChatIntent;
exports.intentToGoal = intentToGoal;
exports.proactiveChat = proactiveChat;
exports.askForHelp = askForHelp;
exports.buildBotContext = buildBotContext;
const logger_1 = require("../utils/logger");
// ─── Chat intent parsing ─────────────────────────────────────────────────────
const INTENT_PROMPT = `You are a Minecraft bot's chat parser. A player sent a message. Classify it and respond ONLY with JSON, no markdown.

Schema: {"intent":"<command|suggestion|question|conversation>","goal":"<goal_type or null>","target":"<target or null>","reply":"<short reply to player, max 60 chars>"}

Valid goals: survive, gather, craft, smelt, hunt, explore, build, combat, social
Valid targets for each:
  gather → wood, stone, coal, iron, diamond, food, sand
  craft  → any craftable item name
  hunt   → cow, sheep, chicken, pig
  explore → any, village, cave, iron_ore, diamond_ore
  build  → shelter, chest_room, furnace_station
  combat → nearest
  social → greet, follow_trusted

If the player says something like "come here" or "follow me", set goal=social, target=follow_trusted.
If the player asks for items or help, set goal to the most relevant action.
If it's just chat/conversation, set intent=conversation with a fun reply.
If it's a question about the bot, set intent=question and answer in the reply.`;
/**
 * Parse a player's chat message through the LLM to determine intent.
 */
async function parseChatIntent(llm, username, message, botContext) {
    try {
        const raw = await llm.chat([
            { role: 'system', content: INTENT_PROMPT },
            { role: 'user', content: `Player "${username}" says: "${message}"\nBot context: ${botContext}` },
        ], 'json');
        const clean = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        if (!parsed.intent)
            parsed.intent = 'conversation';
        if (!parsed.reply)
            parsed.reply = 'Got it!';
        return parsed;
    }
    catch (e) {
        logger_1.log.warn(`Chat parse failed: ${e.message}`);
        return { intent: 'conversation', goal: null, target: null, reply: "Hmm, I didn't quite get that!" };
    }
}
/**
 * Convert a parsed chat intent into an actionable Goal, or null if
 * it's just conversation.
 */
function intentToGoal(intent) {
    if (!intent.goal || !intent.target)
        return null;
    if (intent.intent === 'conversation')
        return null;
    return {
        goal: intent.goal,
        target: intent.target,
        reason: `player requested`,
    };
}
// ─── Proactive chat ──────────────────────────────────────────────────────────
const CHAT_COOLDOWN_MS = 30_000;
let lastProactiveChat = 0;
const DISCOVERY_MESSAGES = {
    village: ['Found a village nearby! 🏘️', 'Hey, there\'s a village over here!'],
    cave_entrance: ['Found a cave! Might have ores.', 'Spotted a cave entrance.'],
    diamond: ['DIAMONDS! 💎', 'I see diamonds!'],
    iron_ore: ['Found iron ore!', 'Iron ore spotted nearby.'],
};
const ACTIVITY_MESSAGES = {
    gather_wood: ['Chopping some trees 🪓', 'Getting wood...'],
    gather_stone: ['Mining stone...', 'Getting cobblestone.'],
    craft: ['Crafting some stuff...', 'Time to craft!'],
    explore: ['Going exploring! 🗺️', 'Heading out to explore.'],
    build_shelter: ['Building a shelter 🏠', 'Making a base!'],
    combat: ['Fighting mobs! ⚔️', 'Engaging hostiles!'],
    sleep: ['Going to bed 😴', 'Time to sleep!'],
    hunt: ['Hunting for food 🍖', 'Going hunting.'],
};
/**
 * Send a proactive chat message about what the bot is doing.
 * Rate-limited to avoid spam.
 */
function proactiveChat(bot, category, detail) {
    const now = Date.now();
    if (now - lastProactiveChat < CHAT_COOLDOWN_MS)
        return;
    // Check if any players are online
    const players = Object.values(bot.players).filter(p => p.username !== bot.username);
    if (players.length === 0)
        return;
    const messages = ACTIVITY_MESSAGES[category] ?? DISCOVERY_MESSAGES[category];
    if (!messages || messages.length === 0)
        return;
    const msg = messages[Math.floor(Math.random() * messages.length)];
    const full = detail ? `${msg} ${detail}` : msg;
    bot.chat(full);
    lastProactiveChat = now;
    logger_1.log.info(`[chat] proactive: ${full}`);
}
/**
 * Bot asks for help or mentions needs.
 */
function askForHelp(bot, need) {
    const now = Date.now();
    if (now - lastProactiveChat < CHAT_COOLDOWN_MS * 2)
        return;
    const players = Object.values(bot.players).filter(p => p.username !== bot.username);
    if (players.length === 0)
        return;
    const asks = {
        food: ['Anyone got spare food? I\'m starving!', 'Could use some food here...'],
        iron: ['Need iron! Know where to find some?', 'Looking for iron ore.'],
        wool: ['Need wool for a bed. Seen any sheep?', 'Looking for sheep!'],
        shelter: ['Need a safe spot for the night!', 'Where should I build?'],
    };
    const msgs = asks[need];
    if (!msgs)
        return;
    const msg = msgs[Math.floor(Math.random() * msgs.length)];
    bot.chat(msg);
    lastProactiveChat = now;
    logger_1.log.info(`[chat] asking: ${msg}`);
}
/**
 * Build a context string for the LLM about the bot's current state.
 */
function buildBotContext(bot) {
    const hp = Math.round(bot.health ?? 20);
    const food = Math.round(bot.food ?? 20);
    const inv = bot.inventory.items().slice(0, 8).map(i => `${i.name}x${i.count}`).join(', ');
    const pos = bot.entity.position;
    const time = (bot.time?.timeOfDay ?? 0) < 12542 ? 'day' : 'night';
    return `hp=${hp}/20 food=${food}/20 time=${time} pos=(${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}) inventory=[${inv || 'empty'}]`;
}
