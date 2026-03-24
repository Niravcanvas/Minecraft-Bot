// ─── Global chat throttle ──────────────────────────────────────────────────
// Prevents the bot from spamming chat messages. Queues messages and sends
// at most one every THROTTLE_MS. All bot.chat() calls should go through
// queueChat() instead.

import { Bot } from 'mineflayer';
import { log } from './logger';

const THROTTLE_MS = 1500;    // minimum gap between messages
const MAX_QUEUE   = 8;       // drop oldest if queue grows too big

let queue: string[]       = [];
let lastSent              = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let currentBot: Bot | null = null;

export function initChatQueue(bot: Bot): void {
  currentBot = bot;
  queue      = [];
  lastSent   = 0;
  if (timer) { clearTimeout(timer); timer = null; }
}

export function queueChat(bot: Bot, msg: string): void {
  currentBot = bot;
  const now = Date.now();

  // If enough time has passed, send immediately
  if (now - lastSent >= THROTTLE_MS && queue.length === 0) {
    sendNow(bot, msg);
    return;
  }

  // Queue it
  queue.push(msg);
  if (queue.length > MAX_QUEUE) {
    const dropped = queue.shift();
    log.warn(`[chat-queue] dropped: "${dropped?.slice(0, 40)}…"`);
  }

  // Start drain timer if not already running
  if (!timer) {
    const wait = Math.max(0, THROTTLE_MS - (now - lastSent));
    timer = setTimeout(drain, wait);
  }
}

function sendNow(bot: Bot, msg: string): void {
  try {
    // Truncate to MC chat limit (256 chars)
    bot.chat(msg.slice(0, 256));
  } catch {}
  lastSent = Date.now();
}

function drain(): void {
  timer = null;
  if (!currentBot || queue.length === 0) return;

  const msg = queue.shift()!;
  sendNow(currentBot, msg);

  // Schedule next if more messages are queued
  if (queue.length > 0) {
    timer = setTimeout(drain, THROTTLE_MS);
  }
}
