import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { log } from './logger';

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_NAV_TIMEOUT_MS = 15_000;
const STUCK_CHECK_INTERVAL   = 2_500;
const STUCK_MIN_MOVE         = 0.1;   // Reduced from 0.3 to allow slow climbing
const STUCK_MAX_TICKS        = 4;     // 4 × 2.5s = 10s before determining stuck

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Stuck recovery behaviors ────────────────────────────────────────────────

async function unstick(bot: Bot): Promise<void> {
  // Try a sequence of recovery actions
  try {
    // 1. Stop all movement
    bot.clearControlStates();
    await sleep(200);

    // 2. Jump
    bot.setControlState('jump', true);
    await sleep(400);
    bot.setControlState('jump', false);

    // 3. Walk in a random direction briefly
    const dir = ['forward', 'back', 'left', 'right'][Math.floor(Math.random() * 4)] as any;
    bot.setControlState(dir, true);
    bot.setControlState('jump', true);
    await sleep(800);
    bot.clearControlStates();
    await sleep(200);

    // 4. Try to dig the block in front of us if it's blocking
    try {
      const pos = bot.entity.position;
      const lookDir = bot.entity.yaw;
      const frontX = Math.round(pos.x - Math.sin(lookDir));
      const frontZ = Math.round(pos.z + Math.cos(lookDir));
      const Vec3 = require('vec3');

      // Check blocks at eye level and foot level
      for (const yOff of [0, 1]) {
        const blockPos = new Vec3(frontX, Math.floor(pos.y) + yOff, frontZ);
        const block = bot.blockAt(blockPos);
        if (block && block.type !== 0 && block.name !== 'bedrock') {
          await bot.dig(block);
          log.info('[nav] Dug blocking block to unstick');
          break;
        }
      }
    } catch {}
  } catch {}
}

// ─── Core navigation ─────────────────────────────────────────────────────────

export async function navigateTo(
  bot: Bot,
  x: number,
  y: number | null,
  z: number,
  reach = 2,
  timeoutMs = DEFAULT_NAV_TIMEOUT_MS,
): Promise<boolean> {
  const goal = y !== null
    ? new goals.GoalNear(x, y, z, Math.max(2, reach))
    : new goals.GoalXZ(x, z);

  return new Promise<boolean>(resolve => {
    let lastPos = bot.entity.position.clone();
    let stuckTicks = 0;

    const timeout = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);

    const stuckChecker = setInterval(async () => {
      const cur = bot.entity.position;
      const moved = cur.distanceTo(lastPos);

      if (moved < STUCK_MIN_MOVE) {
        stuckTicks++;
        if (stuckTicks >= STUCK_MAX_TICKS) {
          log.warn('[nav] stuck — attempting recovery');
          // Try to unstick before giving up
          try { bot.pathfinder.setGoal(null); } catch {}
          await unstick(bot);
          cleanup();
          resolve(false);
        }
      } else {
        stuckTicks = 0;
      }
      lastPos = cur.clone();
    }, STUCK_CHECK_INTERVAL);

    function onReached() { cleanup(); resolve(true); }
    function onFailed()  { cleanup(); resolve(false); }
    function onPathUpdate(r: any) {
      if (r.status === 'noPath') {
        log.warn('[nav] no path to target');
        cleanup();
        resolve(false);
      }
    }

    bot.once('goal_reached', onReached);
    (bot as any).once('goal_failed', onFailed);
    (bot as any).on('path_update', onPathUpdate);

    function cleanup() {
      clearTimeout(timeout);
      clearInterval(stuckChecker);
      bot.removeListener('goal_reached', onReached);
      (bot as any).removeListener('goal_failed', onFailed);
      (bot as any).removeListener('path_update', onPathUpdate);
      try { bot.pathfinder.setGoal(null); } catch {}
    }

    try {
      bot.pathfinder.setGoal(goal, true);
    } catch {
      cleanup();
      resolve(false);
    }
  });
}

export async function goToBlock(
  bot: Bot,
  block: { position: { x: number; y: number; z: number } },
  reach = 2,
): Promise<boolean> {
  const { x, y, z } = block.position;
  return navigateTo(bot, x, y, z, reach);
}

// ─── Head movement ────────────────────────────────────────────────────────────

export async function lookAround(bot: Bot): Promise<void> {
  const yaw = (Math.random() - 0.5) * Math.PI;
  const pitch = (Math.random() - 0.5) * 0.6;
  try { await bot.look(bot.entity.yaw + yaw, pitch, false); } catch {}
}

export async function lookAtNearestPlayer(bot: Bot, range = 16): Promise<void> {
  const players = Object.values(bot.players).filter(
    p => p.entity && p.username !== bot.username
      && p.entity.position.distanceTo(bot.entity.position) < range
  );
  if (players.length > 0 && players[0].entity) {
    try { await bot.lookAt(players[0].entity.position.offset(0, 1.6, 0)); } catch {}
  }
}
