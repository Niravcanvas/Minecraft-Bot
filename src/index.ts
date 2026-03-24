import 'dotenv/config';
import { createBot }      from './bot';
import { OllamaClient }   from './llm';
import { Brain }          from './brain';
import { Executor }       from './executor';
import { LearningMemory } from './memory/learning';
import { TrustMemory }    from './memory/trust';
import { WorldMemory }    from './memory/world';
import { parseChatIntent, intentToGoal, proactiveChat, buildBotContext } from './goals/chat';
import { lookAround, lookAtNearestPlayer } from './utils/navigation';
import { log }            from './utils/logger';
import { initChatQueue, queueChat } from './utils/chat_queue';
import { setInterrupt }   from './interrupt';
import { shouldFight }    from './goals/combat';
import { Bot }            from 'mineflayer';

const cfg = {
  mc: {
    host:     process.env.MC_HOST     ?? 'localhost',
    port:     Number(process.env.MC_PORT ?? 25565),
    username: process.env.MC_USERNAME ?? 'AIBot',
    version:  process.env.MC_VERSION  ?? '1.21.4',
    password: process.env.MC_PASSWORD ?? '',
  },
  ollamaUrl:    process.env.OLLAMA_URL    ?? 'http://localhost:11434',
  ollamaModel:  process.env.OLLAMA_MODEL  ?? 'qwen2.5:1.5b',
  goalTickMs:   Number(process.env.GOAL_TICK_MS    ?? 8000),
  safetyTickMs: Number(process.env.SAFETY_TICK_MS  ?? 1000),
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Auto-reconnect state ──────────────────────────────────────────────────
const RECONNECT_DELAY_MS  = 5000;
const MAX_RECONNECT_TRIES = 50;   // effectively infinite (50 × 5s = ~4 min then resets)
let reconnectCount = 0;

async function main() {
  log.divider();
  log.info(`🤖 Minecraft AI Bot v7`);
  log.info(`   Server : ${cfg.mc.host}:${cfg.mc.port}`);
  log.info(`   Model  : ${cfg.ollamaModel}`);
  log.divider();

  const llm = new OllamaClient(cfg.ollamaModel, cfg.ollamaUrl);

  // ── Ollama is now OPTIONAL — warn but don't exit ──
  const ollamaReady = await llm.ping();
  if (!ollamaReady) {
    log.warn('Bot will start in DETERMINISTIC-ONLY mode.');
    log.warn('Chat responses and LLM decisions disabled until Ollama comes online.');
  }
  llm.startBackgroundPing();   // checks every 60s if Ollama becomes available

  const learning = new LearningMemory();
  const trust    = new TrustMemory();
  const world    = new WorldMemory();

  startBot(llm, learning, trust, world);
}

function startBot(
  llm: OllamaClient,
  learning: LearningMemory,
  trust: TrustMemory,
  world: WorldMemory,
): void {
  const bot      = createBot(cfg.mc);
  const brain    = new Brain(bot, llm, learning, trust, world);
  const executor = new Executor(bot, learning, trust, world);

  initChatQueue(bot);

  let running       = false;
  let emergencyBusy = false;
  let goalBusy      = false;
  let guardMode     = false;

  // Track timers so we can clean up on disconnect
  const timers: ReturnType<typeof setInterval>[] = [];

  bot.once('spawn', () => {
    running = true;
    reconnectCount = 0;   // reset on successful spawn

    // ─── Safety loop ──────────────────────────────────────────────────────
    timers.push(setInterval(async () => {
      if (!running || emergencyBusy) return;
      world.scan(bot);
      const emergency = executor.emergency();
      if (!emergency) return;

      emergencyBusy = true;
      setInterrupt(true);
      await sleep(100);

      try {
        const result = await executor.run(emergency);
        brain.recordOutcome(emergency.goal, emergency.target, result.success, result.reason);
      } catch (e: any) {
        log.error(`Emergency error: ${e.message}`);
      } finally {
        setInterrupt(false);
        emergencyBusy = false;
      }
    }, cfg.safetyTickMs));

    // ─── Look around behaviors ────────────────────────────────────────────
    timers.push(setInterval(async () => {
      if (!running || goalBusy) return;
      try { await lookAtNearestPlayer(bot, 12); } catch {}
    }, 3000));

    timers.push(setInterval(async () => {
      if (!running || goalBusy) return;
      try { await lookAround(bot); } catch {}
    }, 8000));

    // ─── Guard mode — periodic combat scan ────────────────────────────────
    timers.push(setInterval(async () => {
      if (!running || !guardMode || goalBusy || emergencyBusy) return;
      const hostile = executor.emergency();
      if (hostile && hostile.goal === 'combat') {
        goalBusy = true;
        try {
          const result = await executor.run(hostile);
          brain.recordOutcome(hostile.goal, hostile.target, result.success, result.reason);
        } catch {} finally { goalBusy = false; }
      }
    }, 2000));

    // ─── Auto-equip armor when inventory changes ──────────────────────────
    bot.inventory.on('updateSlot' as any, async () => {
      if (goalBusy) return;
      const ARMOUR_SLOTS: Array<{ slot: number; names: string[] }> = [
        { slot: 5, names: ['helmet'] },
        { slot: 6, names: ['chestplate'] },
        { slot: 7, names: ['leggings'] },
        { slot: 8, names: ['boots'] },
      ];

      for (const { slot, names } of ARMOUR_SLOTS) {
        const current   = (bot.inventory as any).slots[slot];
        const candidate = bot.inventory.items().find(i =>
          names.some(n => i.name.includes(n)) &&
          (!current || i.type !== current.type)
        );
        if (candidate && !current) {
          try {
            const dest = slot === 5 ? 'head' : slot === 6 ? 'torso' : slot === 7 ? 'legs' : 'feet';
            await bot.equip(candidate, dest as any);
            log.success(`[auto-equip] Equipped ${candidate.name}`);
          } catch {}
        }
      }
    });

    // ─── Goal loop ────────────────────────────────────────────────────────
    async function goalLoop() {
      while (running) {
        if (goalBusy || emergencyBusy) { await sleep(200); continue; }

        goalBusy = true;
        try {
          const goal = await brain.pickGoal();
          proactiveChat(bot, `${goal.goal}_${goal.target}`, undefined, queueChat);
          const result = await executor.run(goal);
          brain.recordOutcome(goal.goal, goal.target, result.success, result.reason);
        } catch (e: any) {
          log.error(`Goal error: ${e.message}`);
        } finally {
          goalBusy = false;
        }

        await sleep(cfg.goalTickMs);
      }
    }

    setTimeout(() => goalLoop(), 1500);
  });

  // ─── Smart Chat ─────────────────────────────────────────────────────────
  bot.on('chat', async (username, message) => {
    if (username === bot.username) return;
    trust.onChat(username, message);
    log.chat(username, message);

    if (message.startsWith('!')) {
      const parts = message.slice(1).trim().toLowerCase().split(/\s+/);
      const cmd = parts[0];
      const arg = parts.slice(1).join(' ');

      switch (cmd) {
        case 'stop':    running = false; queueChat(bot, 'Stopped.'); break;
        case 'start':   running = true;  queueChat(bot, 'Running!'); break;
        case 'status':  queueChat(bot, `hp=${Math.round(bot.health)} food=${Math.round(bot.food)} busy=${goalBusy} guard=${guardMode}`); break;
        case 'inv':     queueChat(bot, `Inv: ${bot.inventory.items().slice(0,8).map(i => `${i.name}x${i.count}`).join(', ')}`); break;
        case 'world':   queueChat(bot, `Known: ${world.summary()}`); break;
        case 'pos':     {
          const p = bot.entity.position;
          queueChat(bot, `Pos: ${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}`);
          break;
        }
        case 'follow':
        case 'come': {
          brain.pushPlayerGoal({ goal: 'social', target: 'follow_trusted', reason: `${username} asked` });
          queueChat(bot, `Following you, ${username}! 🏃`);
          break;
        }
        case 'mine':
        case 'gather': {
          const resource = arg || 'wood';
          const valid = ['wood', 'stone', 'coal', 'iron', 'diamond', 'food', 'sand', 'gravel'];
          if (valid.includes(resource)) {
            brain.pushPlayerGoal({ goal: 'gather', target: resource, reason: `${username} asked` });
            queueChat(bot, `Mining ${resource}! ⛏`);
          } else {
            queueChat(bot, `I can mine: ${valid.join(', ')}`);
          }
          break;
        }
        case 'craft': {
          if (!arg) { queueChat(bot, 'Tell me what to craft! e.g. !craft iron_pickaxe'); break; }
          brain.pushPlayerGoal({ goal: 'craft', target: arg.replace(/\s+/g, '_'), reason: `${username} asked` });
          queueChat(bot, `Crafting ${arg}! 🔨`);
          break;
        }
        case 'smelt': {
          if (!arg) { queueChat(bot, '!smelt iron_ingot | charcoal'); break; }
          brain.pushPlayerGoal({ goal: 'smelt', target: arg.replace(/\s+/g, '_'), reason: `${username} asked` });
          queueChat(bot, `Smelting ${arg}! 🔥`);
          break;
        }
        case 'build': {
          const target = arg || 'shelter';
          brain.pushPlayerGoal({ goal: 'build', target: target.replace(/\s+/g, '_'), reason: `${username} asked` });
          queueChat(bot, `Building ${target}! 🏠`);
          break;
        }
        case 'explore': {
          const target = arg || 'any';
          brain.pushPlayerGoal({ goal: 'explore', target, reason: `${username} asked` });
          queueChat(bot, `Exploring${target !== 'any' ? ' for ' + target : ''}! 🗺️`);
          break;
        }
        case 'hunt': {
          const target = arg || 'cow';
          brain.pushPlayerGoal({ goal: 'hunt', target, reason: `${username} asked` });
          queueChat(bot, `Hunting ${target}! 🏹`);
          break;
        }
        case 'eat': {
          brain.pushPlayerGoal({ goal: 'survive', target: 'eat', reason: `${username} asked` });
          queueChat(bot, 'Eating! 🍖');
          break;
        }
        case 'sleep': {
          brain.pushPlayerGoal({ goal: 'survive', target: 'sleep', reason: `${username} asked` });
          queueChat(bot, 'Going to sleep! 😴');
          break;
        }
        case 'fight':
        case 'attack': {
          brain.pushPlayerGoal({ goal: 'combat', target: 'nearest', reason: `${username} asked` });
          queueChat(bot, 'Fighting! ⚔️');
          break;
        }
        case 'guard': {
          guardMode = !guardMode;
          queueChat(bot, guardMode ? 'Guard mode ON — fighting nearby hostiles! 🛡️' : 'Guard mode OFF.');
          break;
        }
        case 'drop': {
          if (!arg) { queueChat(bot, 'What should I drop? e.g. !drop cobblestone'); break; }
          const itemName = arg.replace(/\s+/g, '_');
          const item = bot.inventory.items().find(i => i.name.includes(itemName));
          if (item) {
            try {
              await bot.tossStack(item);
              queueChat(bot, `Dropped ${item.name} x${item.count}!`);
            } catch (e: any) { queueChat(bot, `Drop failed: ${e.message}`); }
          } else {
            queueChat(bot, `Don't have ${arg} in inventory.`);
          }
          break;
        }
        case 'help': {
          queueChat(bot, '!stop !start !status !inv !pos !follow !mine <res> !craft <item> !smelt <item> !build [type] !explore [target] !hunt [mob] !eat !sleep !fight !guard !drop <item> !help');
          break;
        }
        default: queueChat(bot, `Unknown: ${cmd}. Try !help`);
      }
      return;
    }

    // ── Natural language chat ──
    try {
      const context = buildBotContext(bot);
      const intent  = await parseChatIntent(llm, username, message, context);
      log.info(`[chat] intent=${intent.intent} goal=${intent.goal}(${intent.target}) reply="${intent.reply}"`);
      if (intent.reply) queueChat(bot, intent.reply);
      const goal = intentToGoal(intent);
      if (goal) {
        brain.pushPlayerGoal(goal);
        log.info(`[chat] queued: ${goal.goal}(${goal.target})`);
      }
    } catch (e: any) {
      log.error(`Chat error: ${e.message}`);
      // Fallback when LLM is unavailable
      if (llm.isAvailable()) {
        try {
          const response = await llm.chat([
            { role: 'system', content: 'You are a Minecraft bot. Be short and fun.' },
            { role: 'user',   content: `${username}: ${message}` },
          ]);
          queueChat(bot, response);
        } catch {}
      } else {
        queueChat(bot, "Hey! I'm busy surviving. Try !help for commands!");
      }
    }
  });

  // ─── Combat retaliation — fight back when attacked ──────────────────────
  bot.on('entityHurt', (entity) => {
    if (entity !== bot.entity) return;

    // Find who/what hit us
    const pos = bot.entity.position;
    const attacker = (Object.values(bot.entities) as any[]).find(e =>
      e && e !== bot.entity && e.position &&
      e.position.distanceTo(pos) < 6
    );

    if (!attacker) return;

    // Player attack
    if (attacker.type === 'player' && attacker.username) {
      trust.onAttacked(attacker.username);
      log.warn(`⚔ ${attacker.username} attacked me!`);

      // Fight back if we have a weapon
      if (shouldFight(bot)) {
        brain.pushPlayerGoal({ goal: 'combat', target: 'nearest', reason: `${attacker.username} attacked me` });
        // Immediate counter-attack
        try { bot.attack(attacker); } catch {}
      } else {
        brain.pushPlayerGoal({ goal: 'survive', target: 'flee', reason: 'attacked by player' });
      }
      return;
    }

    // Mob attack — push immediate combat if armed
    if (attacker.type === 'mob') {
      log.warn(`⚔ ${attacker.name ?? 'mob'} hit me!`);
      if (shouldFight(bot)) {
        // Immediate counter-attack
        try { bot.attack(attacker); } catch {}
      }
    }
  });

  // ─── Pick up items ───────────────────────────────────────────────────────
  bot.on('playerCollect' as any, (collector: any) => {
    if (collector.username === bot.username) log.info(`[pickup] Collected item`);
  });

  // ─── Auto-reconnect on disconnect ──────────────────────────────────────
  function cleanupTimers() {
    for (const t of timers) clearInterval(t);
    timers.length = 0;
  }

  bot.on('end', () => {
    running = false;
    cleanupTimers();
    log.warn('Disconnected');
    attemptReconnect(llm, learning, trust, world);
  });

  bot.on('kicked', (reason) => {
    running = false;
    cleanupTimers();
    log.warn(`Kicked: ${reason}`);
    attemptReconnect(llm, learning, trust, world);
  });

  bot.on('error', (e) => log.error(`Error: ${e.message}`));

  process.on('SIGINT', () => {
    running = false;
    cleanupTimers();
    llm.stopBackgroundPing();
    bot.quit();
    process.exit(0);
  });
}

async function attemptReconnect(
  llm: OllamaClient,
  learning: LearningMemory,
  trust: TrustMemory,
  world: WorldMemory,
): Promise<void> {
  reconnectCount++;
  if (reconnectCount > MAX_RECONNECT_TRIES) {
    log.error(`Max reconnect attempts (${MAX_RECONNECT_TRIES}) reached. Giving up.`);
    process.exit(1);
  }

  log.info(`Reconnecting in ${RECONNECT_DELAY_MS / 1000}s... (attempt ${reconnectCount}/${MAX_RECONNECT_TRIES})`);
  await sleep(RECONNECT_DELAY_MS);

  try {
    startBot(llm, learning, trust, world);
  } catch (e: any) {
    log.error(`Reconnect failed: ${e.message}`);
    attemptReconnect(llm, learning, trust, world);
  }
}

main().catch(e => { log.error(`Fatal: ${e.message}`); process.exit(1); });