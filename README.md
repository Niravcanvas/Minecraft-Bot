# 🤖 Minecraft AI Bot

An autonomous Minecraft survival bot powered by a **local LLM via Ollama** — no API key, no token limits. Built with Mineflayer and TypeScript, it perceives the world, reasons through decisions, and acts — all running on your machine.

---

## ✨ Features

- **Zero API costs** — runs fully local using Ollama (no Groq, no OpenAI)
- **Apple Silicon optimised** — uses Metal GPU acceleration on M1/M2/M3
- **Perceive → Think → Act loop** — structured JSON decision-making every tick
- **Dual memory system** — rolling short-term context + persistent long-term facts the bot learns itself
- **Survival AI** — automatic priority system: eat → flee → sleep → gather → build
- **21 actions** — movement, mining, crafting, smelting, combat, eating, sleeping, chat
- **In-game chat commands** — inject instructions or query the bot mid-game
- **Auto-respawn** — bot respawns and goes to recover its items on death
- **Minecraft 1.21.4** compatible

---

## 📁 Project Structure

```
src/
├── index.ts          ← Entry point & boot sequence
├── bot.ts            ← Mineflayer bot setup & events
├── agent.ts          ← AI brain — perceive/think/act loop
├── llm.ts            ← Ollama client (no API key needed)
├── memory.ts         ← Short-term + long-term memory
├── skills/
│   ├── index.ts      ← Skill exports
│   ├── movement.ts   ← Navigation & pathfinding
│   ├── gather.ts     ← Mining, crafting, smelting, placing
│   ├── combat.ts     ← Attacking, fleeing, threat scanning
│   └── survival.ts   ← Eating, sleeping, status checks
└── utils/
    └── logger.ts     ← Coloured terminal logger
```

---

## 🛠 Prerequisites

- **Node.js** 18+
- **Ollama** installed locally
- A running **Minecraft Java Edition server** (version 1.21.4)

---

## 🚀 Setup

### 1. Install Ollama and pull a model

```bash
brew install ollama
ollama serve
```

In a new terminal, pull a model based on your RAM:

```bash
# 16 GB RAM — best balance of speed and intelligence
ollama pull llama3.1:8b

# 8 GB RAM — lighter, still capable
ollama pull llama3.2:3b
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure `.env`

```env
# Minecraft Server
MC_HOST=localhost
MC_PORT=25565
MC_USERNAME=AIBot
MC_VERSION=1.21.4

# Ollama (no API key needed!)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b

# Agent tuning
TICK_MS=4000
MEMORY_RESET_TICKS=100
```

### 4. Run the bot

```bash
# Terminal 1 — Ollama must be running
ollama serve

# Terminal 2 — Start the bot
npm run dev
```

---

## 🎮 In-Game Chat Commands

Type these in Minecraft chat while the bot is online:

| Command | Effect |
|---|---|
| `!memory` | Dump the bot's long-term memory to the console |
| `!stop` | Pause the AI decision loop |
| `!start` | Resume the AI decision loop |
| `!status` | Quick health check (model, tick status) |
| `!<anything else>` | Treated as a natural language instruction, e.g. `!go mine diamonds` or `!build a shelter` |

---

## 🧠 How It Works

### The Agent Loop

Every tick (default 4 seconds):

1. **Perceive** — gathers position, health, food, time, inventory, nearby entities and threats
2. **Think** — sends state to the local LLM, which reasons and returns a structured JSON decision
3. **Act** — executes the chosen action and feeds the result back as context

### Decision Format

The LLM always returns this JSON structure:

```json
{
  "thought": "My food is low. I should eat before mining.",
  "action": "eat",
  "params": {},
  "remember": { "key": "current_goal", "fact": "mine iron ore" }
}
```

### Survival Priorities

The bot follows this priority order every tick:

1. **Health ≤ 6** → flee or eat immediately
2. **Food < 14** → eat before doing anything else
3. **Night time + bed available** → sleep
4. **Hostile mobs nearby** → fight or flee based on gear
5. **Otherwise** → pursue current goal

### Early-Game Progression Goal

```
punch logs → craft planks → craft crafting_table → craft wooden_pickaxe
→ mine stone → craft stone_pickaxe → mine coal + iron
→ smelt iron → craft iron_pickaxe → build shelter → craft bed
```

---

## 🧠 Memory System

### Short-Term Memory
- Rolling window of the last **40 messages** (auto-trimmed)
- Resets every 100 ticks to prevent context drift

### Long-Term Memory
- Key-value facts the bot writes to itself
- Persists across every future tick in the session
- Examples of what the bot learns:

| Key | Example value |
|---|---|
| `base` | `My base is at x=50 z=100` |
| `current_goal` | `mine iron ore` |
| `shelter` | `Shelter built at x=42 z=88` |
| `death_spot` | `Died at x=10 y=64 z=-30` |

---

## ⚡ Available Actions

| Action | Description |
|---|---|
| `look_around` | Observe surroundings — status snapshot |
| `go_to` | Pathfind to exact x, y, z coordinates |
| `go_near` | Walk near coordinates (within range) |
| `go_to_block` | Find nearest block of a type and walk to it |
| `follow` | Follow a player or entity by name |
| `stop_moving` | Stop all movement immediately |
| `mine` | Mine N blocks of a given type |
| `collect_drops` | Pick up nearby dropped items |
| `craft` | Craft an item (auto-finds crafting table) |
| `smelt` | Smelt items in a nearby furnace |
| `equip_tool` | Equip best tool of a type |
| `place_block` | Place a block at coordinates |
| `attack` | Attack a specific mob by name |
| `attack_nearest` | Attack the nearest hostile mob |
| `flee` | Run away from nearby hostile mobs |
| `eat` | Eat best available food (or specify one) |
| `sleep` | Sleep in a nearby bed to skip the night |
| `chat` | Send a chat message in-game |
| `wait` | Wait and do nothing (max 10s) |

---

## 🛡 Hostile Mob Detection

The bot automatically detects and responds to these mobs:

`zombie`, `skeleton`, `creeper`, `spider`, `cave_spider`, `enderman`, `witch`, `phantom`, `drowned`, `husk`, `pillager`, `vindicator`, `ravager`, `blaze`, `ghast`, `zombie_piglin`, `wither_skeleton`, `slime`, `magma_cube`

---

## 📦 NPM Scripts

```bash
npm run dev     # Run with hot-reload (tsx watch)
npm run build   # Compile TypeScript → dist/
npm start       # Run compiled output
```

---

## 🔧 Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `MC_HOST` | `localhost` | Minecraft server IP |
| `MC_PORT` | `25565` | Minecraft server port |
| `MC_USERNAME` | `AIBot` | Bot's in-game username |
| `MC_VERSION` | `1.21.4` | Minecraft version |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3.1:8b` | Model to use |
| `TICK_MS` | `4000` | Milliseconds between agent ticks |
| `MEMORY_RESET_TICKS` | `100` | Ticks before short-term memory is cleared |

---

## 🧩 Adding New Actions

Open `src/agent.ts` and add an entry to the `ACTIONS` object — the LLM learns about it automatically on the next run:

```typescript
my_new_action: {
  description: 'What this does. params: paramName',
  run: async (bot, p) => {
    // your logic here
    return 'Result description';
  },
},
```

---

## 🪲 Troubleshooting

**Ollama not found**
```bash
ollama serve          # Must be running in a separate terminal
ollama pull llama3.1:8b  # Must pull the model first
```

**Bot can't connect**
- Make sure your Minecraft server is running in offline mode (`online-mode=false` in `server.properties`)
- Check `MC_HOST`, `MC_PORT`, and `MC_VERSION` match your server

**High severity vulnerabilities from npm install**
- These come from Next.js boilerplate — safe to fix with:
```bash
npm audit fix --force
```

**LLM parse errors in console**
- Normal occasionally — the bot falls back to `look_around` automatically and retries next tick
- If persistent, try a larger model or lower `TICK_MS` to give the model more breathing room

---

## 📚 Dependencies

| Package | Purpose |
|---|---|
| `mineflayer` | Minecraft bot framework |
| `mineflayer-pathfinder` | A* pathfinding |
| `minecraft-data` | Block/item registry |
| `vec3` | 3D vector math |
| `dotenv` | Environment variable loading |
| `chalk` | Coloured terminal output |
| `tsx` | TypeScript execution (dev) |

---

## 📄 License

MIT — do whatever you want with it.