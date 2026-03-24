"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeSocial = executeSocial;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const GREETINGS = ['Hello!', 'Hey!', 'Hi there!', 'Howdy!'];
async function executeSocial(bot, target, trust) {
    const { goals } = require('mineflayer-pathfinder');
    const players = Object.values(bot.players).filter(p => p.username !== bot.username && p.entity);
    if (target === 'greet') {
        if (!players.length)
            return { success: false, reason: 'no players online' };
        bot.chat(GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
        for (const p of players)
            trust.onChat(p.username, 'greeted');
        return { success: true, reason: `greeted ${players.length} player(s)` };
    }
    if (target === 'flee_threat') {
        const threats = players.filter(p => trust.isThreat(p.username) && p.entity);
        for (const t of threats) {
            if (t.entity.position.distanceTo(bot.entity.position) < 20) {
                bot.chat('Stay away from me!');
                const away = bot.entity.position.minus(t.entity.position).normalize().scale(20);
                const dest = bot.entity.position.plus(away);
                bot.pathfinder.setGoal(new goals.GoalXZ(dest.x, dest.z));
                await sleep(5000);
                bot.pathfinder.setGoal(null);
                return { success: true, reason: `fled from threat ${t.username}` };
            }
        }
        return { success: true, reason: 'no nearby threats' };
    }
    if (target === 'follow_trusted') {
        const trusted = players.filter(p => trust.isTrusted(p.username) && p.entity);
        if (!trusted.length)
            return { success: false, reason: 'no trusted players online' };
        const t = trusted[0];
        bot.pathfinder.setGoal(new goals.GoalFollow(t.entity, 3), true);
        await sleep(12000);
        bot.pathfinder.setGoal(null);
        return { success: true, reason: `followed ${t.username}` };
    }
    return { success: false, reason: `unknown social target: ${target}` };
}
