import mineflayer, { Bot, BotOptions } from 'mineflayer';
import { log }                         from './utils/logger';

const baritone = require('@miner-org/mineflayer-baritone');
const pathfinder = baritone.loader;
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
    // Configure baritone (ashfinder) settings
    const ash = (bot as any).ashfinder;
    if (ash) {
      ash.config.breakBlocks      = true;
      ash.config.placeBlocks      = true;
      ash.config.parkour          = true;
      ash.config.swimming         = true;
      ash.config.maxFallDist      = 4;
      ash.config.thinkTimeout     = 30_000;
      ash.config.blocksToAvoid    = ['crafting_table', 'chest', 'furnace'];
      ash.config.disposableBlocks = ['dirt', 'cobblestone', 'stone', 'andesite', 'granite', 'diorite', 'netherrack'];
    }

    log.divider();
    log.success(`Bot "${bot.username}" spawned on ${cfg.host}:${cfg.port}`);
    log.info(`Version: ${bot.version}`);
    log.info('Baritone pathfinder loaded ✔');
    log.divider();

    if (cfg.password) {
      // Wait for the server to actually send a chat message containing
      // "register", "login", or "password" before responding.
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
      await sleep(2000);
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