export interface FoodItem { name: string; hunger: number; saturation: number }

export const FOODS: FoodItem[] = [
  { name: 'golden_carrot',     hunger: 6,  saturation: 14.4 },
  { name: 'cooked_beef',       hunger: 8,  saturation: 12.8 },
  { name: 'cooked_porkchop',   hunger: 8,  saturation: 12.8 },
  { name: 'cooked_mutton',     hunger: 6,  saturation: 9.6  },
  { name: 'cooked_chicken',    hunger: 6,  saturation: 7.2  },
  { name: 'cooked_salmon',     hunger: 6,  saturation: 9.6  },
  { name: 'golden_apple',      hunger: 4,  saturation: 9.6  },
  { name: 'bread',             hunger: 5,  saturation: 6.0  },
  { name: 'baked_potato',      hunger: 5,  saturation: 6.0  },
  { name: 'carrot',            hunger: 3,  saturation: 3.6  },
  { name: 'apple',             hunger: 4,  saturation: 2.4  },
  { name: 'melon_slice',       hunger: 2,  saturation: 1.2  },
  { name: 'cookie',            hunger: 2,  saturation: 0.4  },
];

export const FOOD_NAMES = FOODS.map(f => f.name);

export const TOOL_TIERS_ORDERED = [
  'netherite','diamond','iron','stone','wooden','golden'
];

export function getBestFood(bot: any): any | null {
  const mcData = require('minecraft-data')(bot.version);
  for (const food of FOODS) {
    const id   = mcData.itemsByName[food.name]?.id;
    const item = id ? bot.inventory.findInventoryItem(id, null, false) : null;
    if (item) return item;
  }
  return null;
}

export function getBestTool(bot: any, toolType: string): any | null {
  const mcData = require('minecraft-data')(bot.version);
  for (const tier of TOOL_TIERS_ORDERED) {
    const name = `${tier}_${toolType}`;
    const id   = mcData.itemsByName[name]?.id;
    const item = id ? bot.inventory.findInventoryItem(id, null, false) : null;
    if (item) return item;
  }
  return null;
}

export function countItem(bot: any, name: string): number {
  const mcData = require('minecraft-data')(bot.version);
  const id = mcData.itemsByName[name]?.id;
  if (!id) return 0;
  return bot.inventory.items().filter((i: any) => i.type === id).reduce((s: number, i: any) => s + i.count, 0);
}

export function hasItem(bot: any, name: string, count = 1): boolean {
  return countItem(bot, name) >= count;
}

export function hasAny(bot: any, names: string[]): boolean {
  return names.some(n => hasItem(bot, n));
}