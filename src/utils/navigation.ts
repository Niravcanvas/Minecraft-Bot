import { Bot } from 'mineflayer';
import { log } from './logger';

// ─── Baritone goals ──────────────────────────────────────────────────────────

const baritone = require('@miner-org/mineflayer-baritone');
const goals    = baritone.goals;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Vec3 = require('vec3');

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_NAV_TIMEOUT_MS = 15_000;
const STUCK_CHECK_INTERVAL   = 3_000;
const STUCK_MIN_MOVE         = 0.1;
const STUCK_MAX_TICKS        = 4;
const MAX_STUCK_RESETS       = 3;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Ashfinder helper ────────────────────────────────────────────────────────

function ash(bot: Bot): any {
  return (bot as any).ashfinder;
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

  const targetPos = new Vec3(x, y ?? bot.entity.position.y, z);
  const dist = bot.entity.position.distanceTo(targetPos);

  // Already close enough
  if (dist <= reach) return true;

  // Adaptive timeout — far targets get more time
  const adaptiveTimeout = Math.max(timeoutMs, Math.min(dist * 500, 90_000));

  const goal = y !== null
    ? new goals.GoalNear(targetPos, Math.max(2, reach))
    : new goals.GoalXZ(targetPos);

  let done = false;
  let stuckTicks = 0;
  let stuckResets = 0;
  let lastPos = bot.entity.position.clone();

  // Stuck checker — polls position every STUCK_CHECK_INTERVAL ms
  const stuckChecker = setInterval(() => {
    if (done) return;

    const cur = bot.entity.position;
    const moved = cur.distanceTo(lastPos);

    if (moved < STUCK_MIN_MOVE) {
      stuckTicks++;

      if (stuckTicks >= STUCK_MAX_TICKS) {
        stuckTicks = 0;
        stuckResets++;

        if (stuckResets > MAX_STUCK_RESETS) {
          log.warn('[nav] stuck — giving up after baritone retries');
          done = true;
          try { ash(bot).stop(); } catch {}
          return;
        }

        log.warn(`[nav] stuck — forcing baritone re-plan (${stuckResets}/${MAX_STUCK_RESETS})`);
        try { ash(bot).stop(); } catch {}
      }
    } else {
      stuckTicks   = 0;
      stuckResets  = 0;
    }

    lastPos = cur.clone();
  }, STUCK_CHECK_INTERVAL);

  try {
    // Race: baritone goto vs timeout
    const result = await Promise.race([
      (async () => {
        // If stuck checker stopped it, retry up to MAX_STUCK_RESETS times
        for (let attempt = 0; attempt <= MAX_STUCK_RESETS; attempt++) {
          if (done) return false;

          try {
            await ash(bot).goto(goal);
            return true;  // goal reached
          } catch (e: any) {
            // If we're done (stuck checker gave up), don't retry
            if (done) return false;

            // If baritone was stopped by stuck checker, loop will retry
            if (stuckResets > 0 && attempt < MAX_STUCK_RESETS) {
              await sleep(300);
              continue;
            }

            // Genuine pathfinding failure
            log.warn(`[nav] pathfinding failed: ${e.message ?? e}`);
            return false;
          }
        }
        return false;
      })(),
      sleep(adaptiveTimeout).then(() => {
        log.warn('[nav] timeout reached');
        return false;
      }),
    ]);

    return result;
  } finally {
    done = true;
    clearInterval(stuckChecker);
    try { ash(bot).stop(); } catch {}
    bot.clearControlStates();
  }
}

// ─── Block navigation ─────────────────────────────────────────────────────────

export async function goToBlock(
  bot: Bot,
  block: { position: { x: number; y: number; z: number } },
  reach = 2,
): Promise<boolean> {
  const { x, y, z } = block.position;
  return navigateTo(bot, x, y, z, reach);
}

// ─── Follow entity (replaces GoalFollow) ──────────────────────────────────────

export async function followEntity(
  bot: Bot,
  entity: { position: { x: number; y: number; z: number } } | null,
  range = 3,
  durationMs = 30_000,
  getEntity?: () => ({ position: { x: number; y: number; z: number } } | null),
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < durationMs) {
    const target = getEntity ? getEntity() : entity;
    if (!target) return false;

    const dist = bot.entity.position.distanceTo(
      new Vec3(target.position.x, target.position.y, target.position.z)
    );

    if (dist > range + 1) {
      // Move closer — short timeout so we re-evaluate often
      await navigateTo(
        bot,
        target.position.x,
        target.position.y,
        target.position.z,
        range,
        3_000,
      );
    } else {
      // Already in range, just wait a tick
      await sleep(300);
    }
  }
  return true;
}

// ─── Wander ───────────────────────────────────────────────────────────────────

export async function wander(bot: Bot, radius = 20, attempts = 5): Promise<boolean> {
  const pos = bot.entity.position;
  for (let i = 0; i < attempts; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = radius * 0.5 + Math.random() * radius * 0.5;
    const tx    = Math.round(pos.x + Math.cos(angle) * dist);
    const tz    = Math.round(pos.z + Math.sin(angle) * dist);
    const ok    = await navigateTo(bot, tx, null, tz, 3, 12_000);
    if (ok) return true;
  }
  return false;
}

// ─── Stop navigation ──────────────────────────────────────────────────────────

export function stopNavigation(bot: Bot): void {
  try { ash(bot).stop(); } catch {}
  bot.clearControlStates();
}

// ─── Head movement ────────────────────────────────────────────────────────────

export async function lookAround(bot: Bot): Promise<void> {
  const yaw   = (Math.random() - 0.5) * Math.PI;
  const pitch = (Math.random() - 0.5) * 0.6;
  try { await bot.look(bot.entity.yaw + yaw, pitch, false); } catch { }
}

export async function lookAtNearestPlayer(bot: Bot, range = 16): Promise<void> {
  const players = Object.values(bot.players).filter(
    p => p.entity && p.username !== bot.username
      && p.entity.position.distanceTo(bot.entity.position) < range
  );
  if (players.length > 0 && players[0].entity) {
    try { await bot.lookAt(players[0].entity.position.offset(0, 1.6, 0)); } catch { }
  }
}