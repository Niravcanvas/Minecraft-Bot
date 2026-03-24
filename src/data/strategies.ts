import { Goal } from '../executor';

// Pre-built goal sequences for common situations
export const STRATEGIES: Record<string, Goal[]> = {
  early_game: [
    { goal: 'gather',  target: 'wood',            reason: 'need logs'          },
    { goal: 'craft',   target: 'crafting_table',  reason: 'need crafting table'},
    { goal: 'craft',   target: 'wooden_pickaxe',  reason: 'need pickaxe'       },
    { goal: 'craft',   target: 'wooden_axe',      reason: 'need axe'           },
    { goal: 'craft',   target: 'wooden_sword',    reason: 'need sword'         },
    { goal: 'gather',  target: 'stone',           reason: 'upgrade tools'      },
    { goal: 'craft',   target: 'stone_pickaxe',   reason: 'better pickaxe'     },
    { goal: 'craft',   target: 'stone_sword',     reason: 'better sword'       },
    { goal: 'gather',  target: 'coal',            reason: 'need torches/fuel'  },
    { goal: 'craft',   target: 'furnace',         reason: 'need smelting'      },
    { goal: 'gather',  target: 'iron',            reason: 'iron age'           },
  ],
  mid_game: [
    { goal: 'craft',   target: 'iron_pickaxe',    reason: 'iron tools'         },
    { goal: 'craft',   target: 'iron_sword',      reason: 'iron sword'         },
    { goal: 'craft',   target: 'iron_helmet',     reason: 'armor'              },
    { goal: 'craft',   target: 'iron_chestplate', reason: 'armor'              },
    { goal: 'craft',   target: 'iron_leggings',   reason: 'armor'              },
    { goal: 'craft',   target: 'iron_boots',      reason: 'armor'              },
    { goal: 'gather',  target: 'diamond',         reason: 'end game gear'      },
  ],
  starving: [
    { goal: 'survive', target: 'eat',    reason: 'critical hunger'  },
    { goal: 'hunt',    target: 'cow',    reason: 'need food'        },
    { goal: 'hunt',    target: 'chicken',reason: 'need food'        },
    { goal: 'gather',  target: 'food',   reason: 'harvest crops'   },
  ],
};

// Decide which strategy phase the bot is in
export function getPhase(bot: any): 'early_game' | 'mid_game' | 'late_game' {
  const items = bot.inventory.items().map((i: any) => i.name);
  if (items.some((n: string) => n.includes('iron_')))    return 'mid_game';
  if (items.some((n: string) => n.includes('diamond_'))) return 'late_game' as any;
  return 'early_game';
}