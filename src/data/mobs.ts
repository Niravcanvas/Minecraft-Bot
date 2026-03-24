export interface MobInfo {
  name: string;
  threat: 'passive' | 'neutral' | 'hostile' | 'boss';
  fleeDistance: number;
  attackDistance: number;
  drops: string[];
}

export const MOBS: Record<string, MobInfo> = {
  zombie:           { name: 'zombie',           threat: 'hostile',  fleeDistance: 16, attackDistance: 3,  drops: ['rotten_flesh'] },
  skeleton:         { name: 'skeleton',         threat: 'hostile',  fleeDistance: 20, attackDistance: 16, drops: ['bone','arrow'] },
  creeper:          { name: 'creeper',          threat: 'hostile',  fleeDistance: 20, attackDistance: 4,  drops: ['gunpowder'] },
  spider:           { name: 'spider',           threat: 'hostile',  fleeDistance: 12, attackDistance: 2,  drops: ['string','spider_eye'] },
  witch:            { name: 'witch',            threat: 'hostile',  fleeDistance: 16, attackDistance: 10, drops: ['glass_bottle','gunpowder'] },
  pillager:         { name: 'pillager',         threat: 'hostile',  fleeDistance: 24, attackDistance: 16, drops: ['arrow'] },
  enderman:         { name: 'enderman',         threat: 'neutral',  fleeDistance: 0,  attackDistance: 2,  drops: ['ender_pearl'] },
  zombie_villager:  { name: 'zombie_villager',  threat: 'hostile',  fleeDistance: 16, attackDistance: 3,  drops: ['rotten_flesh'] },
  drowned:          { name: 'drowned',          threat: 'hostile',  fleeDistance: 16, attackDistance: 3,  drops: ['rotten_flesh'] },
  husk:             { name: 'husk',             threat: 'hostile',  fleeDistance: 16, attackDistance: 3,  drops: ['rotten_flesh'] },
  phantom:          { name: 'phantom',          threat: 'hostile',  fleeDistance: 20, attackDistance: 3,  drops: ['phantom_membrane'] },
  cow:              { name: 'cow',              threat: 'passive',  fleeDistance: 0,  attackDistance: 2,  drops: ['beef','leather'] },
  sheep:            { name: 'sheep',            threat: 'passive',  fleeDistance: 0,  attackDistance: 2,  drops: ['mutton','white_wool'] },
  chicken:          { name: 'chicken',          threat: 'passive',  fleeDistance: 0,  attackDistance: 2,  drops: ['chicken','feather'] },
  pig:              { name: 'pig',              threat: 'passive',  fleeDistance: 0,  attackDistance: 2,  drops: ['porkchop'] },
  villager:         { name: 'villager',         threat: 'passive',  fleeDistance: 0,  attackDistance: 0,  drops: [] },
};

export const HOSTILE_NAMES  = Object.values(MOBS).filter(m => m.threat === 'hostile').map(m => m.name);
export const PASSIVE_NAMES  = Object.values(MOBS).filter(m => m.threat === 'passive').map(m => m.name);
export const FOOD_MOB_NAMES = ['cow','sheep','chicken','pig'];

export function getNearestHostile(bot: any, maxDist = 24): any | null {
  return Object.values(bot.entities).find((e: any) =>
    HOSTILE_NAMES.includes(e.name ?? '') &&
    e.position?.distanceTo(bot.entity.position) < maxDist
  ) ?? null;
}

export function getNearestPassive(bot: any, names: string[], maxDist = 64): any | null {
  let best: any = null, bestDist = maxDist;
  for (const e of Object.values(bot.entities) as any[]) {
    if (!names.includes(e.name ?? '')) continue;
    const d = e.position?.distanceTo(bot.entity.position) ?? 999;
    if (d < bestDist) { best = e; bestDist = d; }
  }
  return best;
}