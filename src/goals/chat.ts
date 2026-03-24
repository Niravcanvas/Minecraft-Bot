import { Bot } from 'mineflayer';
import { OllamaClient } from '../llm';
import { Goal } from '../executor';
import { log } from '../utils/logger';

// ─── Keyword-based intent parser ─────────────────────────────────────────────
// FIX: runs BEFORE the LLM so commands always register even when qwen2.5:1.5b
// misparses them. The small model is unreliable; keywords are not.

const VALID_GOALS = new Set([
  'survive', 'gather', 'craft', 'smelt', 'hunt',
  'explore', 'build', 'combat', 'social',
]);

function keywordParse(username: string, msg: string): ChatIntent | null {
  const m = msg.toLowerCase().trim();

  // Follow / come here
  if (/^(follow( me)?|come here|come to me|follow me please)/.test(m))
    return { intent: 'command', goal: 'social', target: 'follow_trusted', reply: `Following you, ${username}! 🏃` };

  // Stop following
  if (/^(stop|halt|freeze|stay( here)?|stop following)/.test(m))
    return { intent: 'command', goal: null, target: null, reply: 'Stopping! 🛑' };

  // Gather wood
  if (/\b(get|gather|collect|chop|cut|bring me|find me?)\b.*(wood|log|tree)/.test(m))
    return { intent: 'command', goal: 'gather', target: 'wood', reply: 'Chopping trees! 🪓' };

  // Gather stone / cobblestone
  if (/\b(get|gather|mine|collect)\b.*(stone|cobble)/.test(m))
    return { intent: 'command', goal: 'gather', target: 'stone', reply: 'Mining stone! ⛏' };

  // Gather iron
  if (/\b(get|gather|mine|collect|find)\b.*(iron)/.test(m))
    return { intent: 'command', goal: 'gather', target: 'iron', reply: 'Looking for iron! ⛏' };

  // Gather coal
  if (/\b(get|gather|mine|collect|find)\b.*(coal)/.test(m))
    return { intent: 'command', goal: 'gather', target: 'coal', reply: 'Mining coal!' };

  // Gather diamonds
  if (/\b(get|gather|mine|collect|find)\b.*(diamond)/.test(m))
    return { intent: 'command', goal: 'gather', target: 'diamond', reply: 'Hunting diamonds! 💎' };

  // Gather food
  if (/\b(get|gather|collect|find)\b.*(food|eat)/.test(m))
    return { intent: 'command', goal: 'gather', target: 'food', reply: 'Getting food! 🍖' };

  // Hunt cow
  if (/\b(hunt|kill|get|find)\b.*(cow|beef|steak)/.test(m))
    return { intent: 'command', goal: 'hunt', target: 'cow', reply: 'Hunting cows! 🐄' };

  // Hunt sheep
  if (/\b(hunt|kill|get|find)\b.*(sheep|wool|mutton)/.test(m))
    return { intent: 'command', goal: 'hunt', target: 'sheep', reply: 'Hunting sheep! 🐑' };

  // Hunt chicken
  if (/\b(hunt|kill|get|find)\b.*(chicken)/.test(m))
    return { intent: 'command', goal: 'hunt', target: 'chicken', reply: 'Hunting chickens! 🐔' };

  // Hunt pig
  if (/\b(hunt|kill|get|find)\b.*(pig|pork)/.test(m))
    return { intent: 'command', goal: 'hunt', target: 'pig', reply: 'Hunting pigs! 🐷' };

  // Explore
  if (/\b(explore|go explore|look around|wander|roam)\b/.test(m))
    return { intent: 'command', goal: 'explore', target: 'any', reply: 'Going exploring! 🗺️' };

  // Find village
  if (/\b(find|look for|locate|explore)\b.*(village|town|settlement)/.test(m))
    return { intent: 'command', goal: 'explore', target: 'village', reply: 'Searching for a village! 🏘️' };

  // Find cave
  if (/\b(find|look for|locate|explore)\b.*(cave|cavern|underground)/.test(m))
    return { intent: 'command', goal: 'explore', target: 'cave', reply: 'Looking for caves! 🕳️' };

  // Combat
  if (/\b(fight|attack|kill|defeat)\b.*(mob|zombie|skeleton|monster|hostile)/.test(m))
    return { intent: 'command', goal: 'combat', target: 'nearest', reply: 'Fighting! ⚔️' };

  // Craft pickaxe
  if (/\b(craft|make|build)\b.*(pickaxe|pick axe)/.test(m)) {
    const tier = /iron/.test(m) ? 'iron_pickaxe' : /stone/.test(m) ? 'stone_pickaxe' : 'wooden_pickaxe';
    return { intent: 'command', goal: 'craft', target: tier, reply: `Crafting a ${tier}! ⛏` };
  }

  // Craft sword
  if (/\b(craft|make|build)\b.*(sword)/.test(m)) {
    const tier = /iron/.test(m) ? 'iron_sword' : /stone/.test(m) ? 'stone_sword' : 'wooden_sword';
    return { intent: 'command', goal: 'craft', target: tier, reply: `Crafting a ${tier}! ⚔️` };
  }

  // Craft axe
  if (/\b(craft|make|build)\b.*(axe)/.test(m)) {
    const tier = /iron/.test(m) ? 'iron_axe' : /stone/.test(m) ? 'stone_axe' : 'wooden_axe';
    return { intent: 'command', goal: 'craft', target: tier, reply: `Crafting a ${tier}!` };
  }

  // Craft furnace
  if (/\b(craft|make|build)\b.*(furnace)/.test(m))
    return { intent: 'command', goal: 'craft', target: 'furnace', reply: 'Crafting a furnace! 🔥' };

  // Craft bed
  if (/\b(craft|make|build)\b.*(bed)/.test(m))
    return { intent: 'command', goal: 'craft', target: 'white_bed', reply: 'Crafting a bed! 🛏️' };

  // Smelt iron
  if (/\b(smelt|cook|melt)\b.*(iron)/.test(m))
    return { intent: 'command', goal: 'smelt', target: 'iron_ingot', reply: 'Smelting iron! 🔥' };

  // Build shelter
  if (/\b(build|make|construct)\b.*(shelter|house|base|home)/.test(m))
    return { intent: 'command', goal: 'build', target: 'shelter', reply: 'Building a shelter! 🏠' };

  // Sleep / bed
  if (/\b(sleep|go to (bed|sleep)|rest)\b/.test(m))
    return { intent: 'command', goal: 'survive', target: 'sleep', reply: 'Trying to sleep! 😴' };

  // Status / what are you doing
  if (/\b(what('re| are) you doing|status|how are you|what('s| is) up)\b/.test(m))
    return { intent: 'question', goal: null, target: null, reply: 'Busy surviving! Ask me to do something.' };

  return null; // let LLM handle anything else
}

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
If it's a question about the bot, set intent=question and answer in the reply.
ONLY use goal/target values from the lists above. NEVER invent new values.`;

export interface ChatIntent {
  intent: 'command' | 'suggestion' | 'question' | 'conversation';
  goal:   string | null;
  target: string | null;
  reply:  string;
}

/**
 * Parse a player's chat message.
 * FIX: keyword parser runs first — LLM is only called as a fallback.
 * This means common commands always work even when the tiny LLM misparses.
 */
export async function parseChatIntent(
  llm: OllamaClient,
  username: string,
  message: string,
  botContext: string,
): Promise<ChatIntent> {
  // ── Fast path: keyword match ──
  const kw = keywordParse(username, message);
  if (kw) {
    log.info(`[chat] keyword-matched: ${kw.goal}(${kw.target})`);
    return kw;
  }

  // ── Slow path: LLM ──
  try {
    const raw = await llm.chat([
      { role: 'system', content: INTENT_PROMPT },
      { role: 'user', content: `Player "${username}" says: "${message}"\nBot context: ${botContext}` },
    ], 'json');

    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean) as ChatIntent;

    if (!parsed.intent) parsed.intent = 'conversation';
    if (!parsed.reply)  parsed.reply  = 'Got it!';

    // FIX: validate LLM output — reject hallucinated goal types
    if (parsed.goal && !VALID_GOALS.has(parsed.goal)) {
      log.warn(`[chat] LLM returned invalid goal "${parsed.goal}" — ignoring`);
      parsed.goal   = null;
      parsed.target = null;
    }

    return parsed;
  } catch (e: any) {
    log.warn(`Chat parse failed: ${e.message}`);
    return {
      intent: 'conversation',
      goal:   null,
      target: null,
      reply:  "Hmm, didn't get that — try '!follow' or '!inv'!",
    };
  }
}

/**
 * Convert a parsed chat intent into an actionable Goal, or null if
 * it's just conversation.
 */
export function intentToGoal(intent: ChatIntent): Goal | null {
  if (!intent.goal || !intent.target) return null;
  if (intent.intent === 'conversation') return null;
  // FIX: validate before casting to avoid runtime errors from bad LLM output
  if (!VALID_GOALS.has(intent.goal)) return null;

  return {
    goal:   intent.goal as Goal['goal'],
    target: intent.target,
    reason: `player requested`,
  };
}

// ─── Proactive chat ──────────────────────────────────────────────────────────

const CHAT_COOLDOWN_MS = 30_000;
let lastProactiveChat = 0;

const ACTIVITY_MESSAGES: Record<string, string[]> = {
  gather_wood:    ['Chopping some trees 🪓', 'Getting wood...'],
  gather_stone:   ['Mining stone...', 'Getting cobblestone.'],
  gather_iron:    ['Hunting for iron ore ⛏', 'Going mining!'],
  gather_coal:    ['Looking for coal...', 'Mining coal!'],
  craft:          ['Crafting some stuff...', 'Time to craft!'],
  explore_any:    ['Going exploring! 🗺️', 'Heading out to explore.'],
  build_shelter:  ['Building a shelter 🏠', 'Making a base!'],
  combat_nearest: ['Fighting mobs! ⚔️', 'Engaging hostiles!'],
  survive_sleep:  ['Going to bed 😴', 'Time to sleep!'],
  hunt_cow:       ['Hunting for food 🍖', 'Going hunting.'],
  hunt_sheep:     ['Hunting sheep 🐑', 'Looking for sheep!'],
  smelt_iron_ingot: ['Smelting iron 🔥', 'Using the furnace!'],
};

const DISCOVERY_MESSAGES: Record<string, string[]> = {
  village:        ['Found a village nearby! 🏘️', "Hey, there's a village over here!"],
  cave_entrance:  ['Found a cave! Might have ores.', 'Spotted a cave entrance.'],
  diamond:        ['DIAMONDS! 💎', 'I see diamonds!'],
  iron_ore:       ['Found iron ore!', 'Iron ore spotted nearby.'],
};

export function proactiveChat(bot: Bot, category: string, detail?: string, chatFn?: (bot: Bot, msg: string) => void): void {
  const now = Date.now();
  if (now - lastProactiveChat < CHAT_COOLDOWN_MS) return;

  const players = Object.values(bot.players).filter(p => p.username !== bot.username);
  if (players.length === 0) return;

  const messages = ACTIVITY_MESSAGES[category] ?? DISCOVERY_MESSAGES[category];
  if (!messages?.length) return;

  const msg  = messages[Math.floor(Math.random() * messages.length)];
  const full = detail ? `${msg} ${detail}` : msg;

  if (chatFn) chatFn(bot, full); else bot.chat(full);
  lastProactiveChat = now;
  log.info(`[chat] proactive: ${full}`);
}

export function askForHelp(bot: Bot, need: string): void {
  const now = Date.now();
  if (now - lastProactiveChat < CHAT_COOLDOWN_MS * 2) return;

  const players = Object.values(bot.players).filter(p => p.username !== bot.username);
  if (players.length === 0) return;

  const asks: Record<string, string[]> = {
    food:    ["Anyone got spare food? I'm starving!", 'Could use some food here...'],
    iron:    ['Need iron! Know where to find some?', 'Looking for iron ore.'],
    wool:    ['Need wool for a bed. Seen any sheep?', 'Looking for sheep!'],
    shelter: ['Need a safe spot for the night!', 'Where should I build?'],
  };

  const msgs = asks[need];
  if (!msgs) return;

  const msg = msgs[Math.floor(Math.random() * msgs.length)];
  bot.chat(msg);
  lastProactiveChat = now;
  log.info(`[chat] asking: ${msg}`);
}

export function buildBotContext(bot: Bot): string {
  const hp   = Math.round(bot.health ?? 20);
  const food = Math.round((bot as any).food ?? 20);
  const inv  = bot.inventory.items().slice(0, 8).map(i => `${i.name}x${i.count}`).join(', ');
  const pos  = bot.entity.position;
  const time = (bot.time?.timeOfDay ?? 0) < 12542 ? 'day' : 'night';
  return `hp=${hp}/20 food=${food}/20 time=${time} pos=(${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}) inventory=[${inv || 'empty'}]`;
}