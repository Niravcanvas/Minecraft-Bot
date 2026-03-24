import { Bot } from 'mineflayer';
import { BLOCK_ALIASES, TOOL_FOR_BLOCK, MIN_TIER_FOR_ORE, TOOL_TIERS } from '../data/blocks';
import { getBestTool } from '../data/items';
import { navigateTo, wander, stopNavigation } from '../utils/navigation';
import { log } from '../utils/logger';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Blocks that REQUIRE a tool to drop items ──────────────────────────────
// Everything else (logs, dirt, sand, gravel, etc.) can be mined by hand

const TOOL_REQUIRED_FOR_DROP = new Set([
  'stone', 'cobblestone', 'deepslate', 'andesite', 'granite', 'diorite', 'tuff',
  'coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'diamond_ore',
  'emerald_ore', 'lapis_ore', 'redstone_ore',
  'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_copper_ore',
  'deepslate_gold_ore', 'deepslate_diamond_ore', 'deepslate_emerald_ore',
  'deepslate_lapis_ore', 'deepslate_redstone_ore',
  'cobblestone_stairs', 'stone_bricks', 'nether_bricks',
]);

// ─── Smart tool equipping ───────────────────────────────────────────────────

async function equipToolForBlock(bot: Bot, blockName: string): Promise<boolean> {
  const toolType = TOOL_FOR_BLOCK[blockName] ?? 'any';

  if (toolType === 'any') return true;

  const tool = getBestTool(bot, toolType);

  if (!tool) {
    // No tool available — can we mine by hand?
    if (TOOL_REQUIRED_FOR_DROP.has(blockName)) {
      // This block won't drop anything without proper tool
      return false;
    }
    // Tool is optional (e.g., axe for wood) — mine by hand slowly
    return true;
  }

  // Check minimum tier for ores
  if (toolType === 'pickaxe') {
    const minTier = MIN_TIER_FOR_ORE[blockName] ?? 0;
    const heldTier = TOOL_TIERS.findIndex(t => t.pickaxe === tool.name);
    if (heldTier >= 0 && heldTier < minTier) {
      log.warn(`[gather] ${tool.name} too weak for ${blockName} (need tier ${minTier}+)`);
      return false;
    }
  }

  try {
    await bot.equip(tool, 'hand');
  } catch {}
  return true;
}

// ─── Block scanning ─────────────────────────────────────────────────────────

function scanForBlocks(bot: Bot, blockIds: number[], maxDist = 64): any[] {
  const blocks = bot.findBlocks({ matching: blockIds, maxDistance: maxDist, count: 10 });
  const pos = bot.entity.position;
  return blocks
    .map(p => ({ pos: p, dist: p.distanceTo(pos) }))
    .sort((a, b) => a.dist - b.dist)
    .map(b => b.pos);
}

// ─── Drop collection ────────────────────────────────────────────────────────

async function collectNearbyDrops(bot: Bot) {
  const drops = (Object.values(bot.entities) as any[]).filter(e =>
    e.type === 'object' && e.objectType === 'item' &&
    e.position?.distanceTo(bot.entity.position) < 10
  ).slice(0, 6);
  for (const d of drops) {
    try { await navigateTo(bot, d.position.x, d.position.y, d.position.z, 1, 3000); } catch {}
  }
}

// ─── Main gather ────────────────────────────────────────────────────────────

export async function executeGather(bot: Bot, target: string): Promise<{ success: boolean; reason: string; gained: number }> {
  const mcData = require('minecraft-data')(bot.version);

  const blockNames = BLOCK_ALIASES[target] ?? [target];
  const blockIds = blockNames.map(n => mcData.blocksByName[n]?.id).filter(Boolean) as number[];
  if (!blockIds.length) return { success: false, reason: `no block ids for ${target}`, gained: 0 };

  let mined = 0;
  let navFails = 0;
  let wanderAttempts = 0;
  const MAX_NAV_FAILS = 4;
  const MAX_WANDER_ATTEMPTS = 2;
  const targetCount = target === 'wood' ? 16 : target === 'stone' ? 24 : 8;
  const triedPositions = new Set<string>();

  for (let attempt = 0; attempt < 30 && mined < targetCount; attempt++) {
    if (navFails >= MAX_NAV_FAILS) {
      log.warn(`[gather] Too many nav failures (${navFails}), stopping`);
      break;
    }

    // Find nearest untried block
    const positions = scanForBlocks(bot, blockIds, 64);
    let blockPos = null;

    for (const pos of positions) {
      const key = `${pos.x},${pos.y},${pos.z}`;
      if (!triedPositions.has(key)) {
        blockPos = pos;
        triedPositions.add(key);
        break;
      }
    }

    // Expand range if nothing nearby
    if (!blockPos) {
      const farPositions = scanForBlocks(bot, blockIds, 128);
      for (const pos of farPositions) {
        const key = `${pos.x},${pos.y},${pos.z}`;
        if (!triedPositions.has(key)) {
          blockPos = pos;
          triedPositions.add(key);
          break;
        }
      }

      // Still nothing? Wander to a new area and try again (up to 2 times)
      if (!blockPos && wanderAttempts < MAX_WANDER_ATTEMPTS) {
        wanderAttempts++;
        log.info(`[gather] No ${target} found — wandering to new area (attempt ${wanderAttempts}/${MAX_WANDER_ATTEMPTS})`);
        const wandered = await wander(bot, 120, 3);
        if (wandered) {
          // Re-scan from new location
          const newPositions = scanForBlocks(bot, blockIds, 64);
          if (newPositions.length > 0) {
            blockPos = newPositions[0];
            triedPositions.add(`${blockPos.x},${blockPos.y},${blockPos.z}`);
          }
        }
        if (!blockPos) continue;   // try next attempt
      }

      if (!blockPos) break;
    }

    const block = bot.blockAt(blockPos);
    if (!block || !blockIds.includes(block.type)) continue;

    // Check tool — skip ONLY if tool is mandatory and missing
    const canMine = await equipToolForBlock(bot, block.name);
    if (!canMine) continue; // Silently skip (don't spam logs)

    // If it's wood/leaves, we only care about getting near the XZ coordinates (don't try to climb the tree)
    const isTree = block.name.endsWith('_log') || block.name.endsWith('_leaves');
    const targetY = isTree ? null : block.position.y;

    // Navigate
    const reached = await navigateTo(bot, block.position.x, targetY, block.position.z, 3, 12_000);
    if (!reached) { navFails++; continue; }

    // Verify block still exists
    const current = bot.blockAt(block.position);
    if (!current || !blockIds.includes(current.type)) continue;

    // Re-equip tool before digging
    await equipToolForBlock(bot, current.name);

    try {
      await bot.dig(current, true);
      mined++;
      navFails = 0;
      await sleep(150);

      // Collect the drop
      await sleep(200);
      await collectNearbyDrops(bot);
    } catch (e: any) {
      log.warn(`[gather] Dig failed: ${e.message}`);
      continue;
    }
  }

  stopNavigation(bot);
  if (mined > 0) await collectNearbyDrops(bot);

  const status = mined > 0 ? 'success' : 'failed';
  log[mined > 0 ? 'success' : 'warn'](`gather(${target}): mined ${mined}x ${target}`);
  return { success: mined > 0, reason: `mined ${mined}x ${target}`, gained: mined };
}