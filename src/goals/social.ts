import { Bot } from 'mineflayer';
import { TrustMemory } from '../memory/trust';
import { navigateTo, followEntity, stopNavigation } from '../utils/navigation';
import { log } from '../utils/logger';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const GREETINGS = ['Hello!', 'Hey!', 'Hi there!', 'Howdy!', "What's up!"];

export async function executeSocial(
  bot: Bot,
  target: string,
  trust: TrustMemory,
): Promise<{ success: boolean; reason: string }> {

  // All online players except the bot itself, with a valid entity
  const players = Object.values(bot.players).filter(
    p => p.username !== bot.username && p.entity,
  );

  // ─── Greet ───────────────────────────────────────────────────────────────
  if (target === 'greet') {
    if (!players.length) return { success: false, reason: 'no players online' };
    bot.chat(GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
    for (const p of players) trust.onChat(p.username, 'greeted');
    return { success: true, reason: `greeted ${players.length} player(s)` };
  }

  // ─── Flee threat ─────────────────────────────────────────────────────────
  if (target === 'flee_threat') {
    const threats = players.filter(p => trust.isThreat(p.username) && p.entity);
    for (const t of threats) {
      if (t.entity!.position.distanceTo(bot.entity.position) < 20) {
        bot.chat('Stay away from me!');
        const away = bot.entity.position
          .minus(t.entity!.position)
          .normalize()
          .scale(20);
        const dest = bot.entity.position.plus(away);
        await navigateTo(bot, dest.x, null, dest.z, 4, 6_000);
        return { success: true, reason: `fled from threat ${t.username}` };
      }
    }
    return { success: true, reason: 'no nearby threats' };
  }

  // ─── Follow ───────────────────────────────────────────────────────────────
  if (target === 'follow_trusted' || target === 'follow') {
    if (!players.length) return { success: false, reason: 'no players online' };

    // Pick nearest non-threat, fall back to nearest player if none qualify
    const sorted = [...players].sort((a, b) =>
      a.entity!.position.distanceTo(bot.entity.position) -
      b.entity!.position.distanceTo(bot.entity.position),
    );
    const chosen =
      sorted.find(p => !trust.isThreat(p.username)) ?? sorted[0];

    if (!chosen?.entity) return { success: false, reason: 'no valid follow target' };

    bot.chat(`Following you, ${chosen.username}! 🏃`);
    log.brain(`[social] Following ${chosen.username}`);

    const FOLLOW_MS = 30_000;

    // Use followEntity with a getter that re-acquires the entity each poll
    await followEntity(
      bot,
      null,
      3,
      FOLLOW_MS,
      () => {
        const p = bot.players[chosen.username];
        if (!p?.entity) return null;
        return p.entity;
      },
    );

    stopNavigation(bot);
    bot.chat(`Done following ${chosen.username}.`);
    return { success: true, reason: `followed ${chosen.username} for ${FOLLOW_MS / 1000}s` };
  }

  // ─── Follow a specific named player ──────────────────────────────────────
  if (target.startsWith('follow:')) {
    const name = target.slice(7);
    const p = bot.players[name];
    if (!p?.entity) return { success: false, reason: `${name} not found` };

    bot.chat(`On my way to ${name}!`);

    await followEntity(
      bot,
      null,
      3,
      20_000,
      () => {
        const player = bot.players[name];
        if (!player?.entity) return null;
        return player.entity;
      },
    );

    stopNavigation(bot);
    return { success: true, reason: `followed ${name}` };
  }

  return { success: false, reason: `unknown social target: ${target}` };
}