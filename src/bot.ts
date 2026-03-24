import mineflayer, { Bot, BotOptions } from 'mineflayer';
import { pathfinder, Movements }       from 'mineflayer-pathfinder';
import { log }                         from './utils/logger';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function createBot(cfg: {
  host: string; port: number; username: string; version: string; password: string;
}): Bot {
  const bot = mineflayer.createBot({
    host: cfg.host, port: cfg.port, username: cfg.username,
    version: cfg.version, auth: 'offline',
  } as BotOptions);

  bot.loadPlugin(pathfinder);

  try {
    const { plugin: pvp } = require('mineflayer-pvp');
    bot.loadPlugin(pvp);
    log.info('PvP plugin loaded');
  } catch {
    log.warn('mineflayer-pvp not available — combat will use manual attacks');
  }

  bot.once('spawn', async () => {
    const mcData    = require('minecraft-data')(bot.version);
    const movements = new Movements(bot);
    movements.canDig          = true;
    movements.digCost         = 1;
    movements.allowSprinting  = true;
    movements.allowParkour    = true;
    movements.allowFreeMotion = false;
    movements.blocksCantBreak = new Set([
      mcData.blocksByName['bedrock']?.id,
      mcData.blocksByName['obsidian']?.id,
    ].filter(Boolean));
    bot.pathfinder.setMovements(movements);

    log.divider();
    log.success(`Bot "${bot.username}" spawned on ${cfg.host}:${cfg.port}`);
    log.info(`Version: ${bot.version}`);
    log.divider();

    if (cfg.password) {
      // FIX Bug #14: old code used fixed sleeps (2000ms + 1500ms) which fired
      // /register before the server's auth prompt arrived on slow/loaded
      // servers, causing the commands to be silently ignored and the bot to
      // never authenticate.
      //
      // New approach: wait for the server to actually send a chat message
      // containing "register", "login", or "password" before responding.
      // Falls back to an 8s timeout if the server never sends a prompt
      // (e.g. a server that uses a different auth plugin).
      await new Promise<void>(resolve => {
        const handler = (_username: string, message: string) => {
          const lower = message.toLowerCase();
          if (
            lower.includes('register') ||
            lower.includes('login') ||
            lower.includes('password') ||
            lower.includes('authenticate')
          ) {
            bot.removeListener('chat', handler);
            resolve();
          }
        };
        bot.on('chat', handler);
        // Safety fallback — don't wait forever if server has no auth prompt
        setTimeout(() => {
          bot.removeListener('chat', handler);
          resolve();
        }, 8000);
      });

      log.info('Sending /register...');
      bot.chat(`/register ${cfg.password} ${cfg.password}`);
      await sleep(2000);   // give server time to process register before login
      log.info('Sending /login...');
      bot.chat(`/login ${cfg.password}`);
      await sleep(1000);
      log.success('Auth complete');
    }
  });

  bot.on('death', () => {
    log.warn('Died — respawning...');
    try { (bot as any).respawn(); } catch {}
    setTimeout(() => {
      log.info('Running /grave to recover items...');
      bot.chat('/grave');
    }, 3000);
  });

  bot.on('error',  (e) => log.error(`Error: ${e.message}`));
  bot.on('end',    ()  => log.warn('Disconnected'));
  bot.on('kicked', (r) => log.warn(`Kicked: ${r}`));

  return bot;
}