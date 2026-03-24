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
// FIX Bug #3: import interrupt flag so the safety loop can signal long-running
// goals (especially smelt) to abort early when an emergency fires.
import { setInterrupt }   from './interrupt';

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

async function main() {
  log.divider();
  log.info(`🤖 Minecraft AI Bot v6`);
  log.info(`   Server : ${cfg.mc.host}:${cfg.mc.port}`);
  log.info(`   Model  : ${cfg.ollamaModel}`);
  log.divider();

  const llm = new OllamaClient(cfg.ollamaModel, cfg.ollamaUrl);
  if (!await llm.ping()) process.exit(1);

  const learning = new LearningMemory();
  const trust    = new TrustMemory();
  const world    = new WorldMemory();
  const bot      = createBot(cfg.mc);
  const brain    = new Brain(bot, llm, learning, trust, world);
  const executor = new Executor(bot, learning, trust, world);

  let running       = false;
  let emergencyBusy = false;
  let goalBusy      = false;

  bot.once('spawn', () => {
    running = true;

    // ─── Safety loop ──────────────────────────────────────────────────────
    // FIX Bug #1: removed `|| goalBusy` from the guard. Previously any active
    // goal (smelting, exploring, building — up to 90s) completely blocked the
    // emergency check. The bot could die from a creeper or starve while
    // waiting for furnace output and never react.
    setInterval(async () => {
      if (!running || emergencyBusy) return;   // goalBusy intentionally removed
      world.scan(bot);
      const emergency = executor.emergency();
      if (!emergency) return;

      emergencyBusy = true;
      // FIX Bug #3: signal any long-running goal (smelt etc.) to abort early,
      // give it one tick to see the flag, then run the emergency.
      setInterrupt(true);
      await sleep(100);

      try {
        const result = await executor.run(emergency);
        brain.recordOutcome(emergency.goal, emergency.target, result.success, result.reason);
      } catch (e: any) {
        log.error(`Emergency error: ${e.message}`);
      } finally {
        setInterrupt(false);   // FIX Bug #3: always clear interrupt after emergency
        emergencyBusy = false;
      }
    }, cfg.safetyTickMs);

    // ─── Look around behaviors ────────────────────────────────────────────
    setInterval(async () => {
      if (!running || goalBusy) return;
      try { await lookAtNearestPlayer(bot, 12); } catch {}
    }, 3000);

    setInterval(async () => {
      if (!running || goalBusy) return;
      try { await lookAround(bot); } catch {}
    }, 8000);

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
          proactiveChat(bot, `${goal.goal}_${goal.target}`);
          const result = await executor.run(goal);
          brain.recordOutcome(goal.goal, goal.target, result.success, result.reason);
        } catch (e: any) {
          log.error(`Goal error: ${e.message}`);
        } finally {
          goalBusy = false;
        }

        // FIX Bug #2: was hardcoded `await sleep(500)` which ignored the
        // GOAL_TICK_MS env var entirely. Now uses the configured value so
        // the bot doesn't spam goals every 500ms regardless of config.
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
      const cmd = message.slice(1).trim().toLowerCase();
      switch (cmd) {
        case 'stop':   running = false; bot.chat('Stopped.'); break;
        case 'start':  running = true;  bot.chat('Running.'); break;
        case 'status': bot.chat(`hp=${Math.round(bot.health)} food=${Math.round(bot.food)} busy=${goalBusy}`); break;
        case 'inv':    bot.chat(`Inv: ${bot.inventory.items().slice(0,8).map(i => `${i.name}x${i.count}`).join(', ')}`); break;
        case 'world':  bot.chat(`Known: ${world.summary()}`); break;
        case 'follow': {
          brain.pushPlayerGoal({ goal: 'social', target: 'follow_trusted', reason: `${username} asked` });
          bot.chat(`Following you, ${username}!`);
          break;
        }
        default: bot.chat(`Unknown: ${cmd}`);
      }
      return;
    }

    try {
      const context = buildBotContext(bot);
      const intent  = await parseChatIntent(llm, username, message, context);
      log.info(`[chat] intent=${intent.intent} goal=${intent.goal}(${intent.target}) reply="${intent.reply}"`);
      if (intent.reply) bot.chat(intent.reply);
      const goal = intentToGoal(intent);
      if (goal) {
        brain.pushPlayerGoal(goal);
        log.info(`[chat] queued: ${goal.goal}(${goal.target})`);
      }
    } catch (e: any) {
      log.error(`Chat error: ${e.message}`);
      try {
        const response = await llm.chat([
          { role: 'system', content: 'You are a Minecraft bot. Be short and fun.' },
          { role: 'user',   content: `${username}: ${message}` },
        ]);
        bot.chat(response);
      } catch {}
    }
  });

  // ─── Detect player attacks ──────────────────────────────────────────────
  bot.on('entityHurt', (entity) => {
    if (entity !== bot.entity) return;
    const attacker = (Object.values(bot.entities) as any[]).find(e =>
      e.type === 'player' && e.position?.distanceTo(bot.entity.position) < 5
    );
    if (attacker?.username) {
      trust.onAttacked(attacker.username);
      log.warn(`${attacker.username} attacked me!`);
    }
  });

  // ─── Pick up items ───────────────────────────────────────────────────────
  bot.on('playerCollect' as any, (collector: any) => {
    if (collector.username === bot.username) log.info(`[pickup] Collected item`);
  });

  process.on('SIGINT', () => { running = false; bot.quit(); process.exit(0); });
}

main().catch(e => { log.error(`Fatal: ${e.message}`); process.exit(1); });