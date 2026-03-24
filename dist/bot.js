"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBot = createBot;
const mineflayer_1 = __importDefault(require("mineflayer"));
const mineflayer_pathfinder_1 = require("mineflayer-pathfinder");
const logger_1 = require("./utils/logger");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function createBot(cfg) {
    const bot = mineflayer_1.default.createBot({
        host: cfg.host, port: cfg.port, username: cfg.username,
        version: cfg.version, auth: 'offline',
    });
    bot.loadPlugin(mineflayer_pathfinder_1.pathfinder);
    try {
        const { plugin: pvp } = require('mineflayer-pvp');
        bot.loadPlugin(pvp);
        logger_1.log.info('PvP plugin loaded');
    }
    catch {
        logger_1.log.warn('mineflayer-pvp not available — combat will use manual attacks');
    }
    bot.once('spawn', async () => {
        const mcData = require('minecraft-data')(bot.version);
        const movements = new mineflayer_pathfinder_1.Movements(bot);
        movements.canDig = true;
        movements.digCost = 1;
        movements.allowSprinting = true;
        movements.allowParkour = true;
        movements.allowFreeMotion = false;
        movements.blocksCantBreak = new Set([
            mcData.blocksByName['bedrock']?.id,
            mcData.blocksByName['obsidian']?.id,
        ].filter(Boolean));
        bot.pathfinder.setMovements(movements);
        logger_1.log.divider();
        logger_1.log.success(`Bot "${bot.username}" spawned on ${cfg.host}:${cfg.port}`);
        logger_1.log.info(`Version: ${bot.version}`);
        logger_1.log.divider();
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
            await new Promise(resolve => {
                const handler = (_username, message) => {
                    const lower = message.toLowerCase();
                    if (lower.includes('register') ||
                        lower.includes('login') ||
                        lower.includes('password') ||
                        lower.includes('authenticate')) {
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
            logger_1.log.info('Sending /register...');
            bot.chat(`/register ${cfg.password} ${cfg.password}`);
            await sleep(2000); // give server time to process register before login
            logger_1.log.info('Sending /login...');
            bot.chat(`/login ${cfg.password}`);
            await sleep(1000);
            logger_1.log.success('Auth complete');
        }
    });
    bot.on('death', () => {
        logger_1.log.warn('Died — respawning...');
        try {
            bot.respawn();
        }
        catch { }
        setTimeout(() => {
            logger_1.log.info('Running /grave to recover items...');
            bot.chat('/grave');
        }, 3000);
    });
    bot.on('error', (e) => logger_1.log.error(`Error: ${e.message}`));
    bot.on('end', () => logger_1.log.warn('Disconnected'));
    bot.on('kicked', (r) => logger_1.log.warn(`Kicked: ${r}`));
    return bot;
}
