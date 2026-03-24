import * as fs   from 'fs';
import * as path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────

export interface LearningEntry {
  goal:          string;
  target:        string;
  success:       boolean;
  duration:      number;               // ms
  gained:        Record<string, number>;
  timeOfDay:     'day' | 'night';
  nearbyThreats: string[];
  timestamp:     number;
}

interface GoalStats {
  attempts:    number;
  successes:   number;
  /** Exponentially-weighted success rate 0–1. Recent results count more. */
  ewma:        number;
  totalGained: number;
  totalMs:     number;
  lastSuccess: number;
  lastFailure: number;
  recentFails: number[];            // timestamps inside AVOID_WINDOW_MS
}

// Serialised shape written to disk — stats are rebuilt on load so we only
// need to persist the raw entries ring-buffer.
interface PersistedData {
  version: 2;
  entries: LearningEntry[];
}

// ─── Constants ────────────────────────────────────────────────────────────

const MAX_ENTRIES      = 500;
const EWMA_ALPHA       = 0.3;          // weight of newest sample
const AVOID_WINDOW_MS  = 5 * 60_000;   // 5 min failure window
const AVOID_FAILS      = 3;            // failures in window → suppress
const AVOID_COOLDOWN   = 3 * 60_000;   // suppression duration
const RECENT_N         = 5;            // entries shown in lastThree()
const SAVE_DEBOUNCE_MS = 2_000;        // don't hammer disk on every record()

// ─── Class ────────────────────────────────────────────────────────────────

export class LearningMemory {
  private entries: LearningEntry[]        = [];
  private stats:   Map<string, GoalStats> = new Map();
  private avoided: Map<string, number>    = new Map(); // key → suppress-until ts

  private readonly file: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir = './data') {
    this.file = path.join(dataDir, 'learning.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.load();
  }

  // ─── Persistence ────────────────────────────────────────────────────────

  private load(): void {
    try {
      if (!fs.existsSync(this.file)) return;
      const raw  = fs.readFileSync(this.file, 'utf-8');
      const data = JSON.parse(raw) as Partial<PersistedData>;

      // Support upgrading from v1 (plain array) or missing version field
      this.entries = Array.isArray(data)
        ? (data as unknown as LearningEntry[])
        : (data.entries ?? []);

      // Rebuild in-memory stats from loaded entries so nothing is lost
      for (const e of this.entries) this.applyToStats(e);
    } catch {
      this.entries = [];
    }
  }

  private flush(): void {
    try {
      const payload: PersistedData = {
        version: 2,
        entries: this.entries.slice(-MAX_ENTRIES),
      };
      fs.writeFileSync(this.file, JSON.stringify(payload, null, 2));
    } catch { /* non-fatal */ }
  }

  /** Debounced save — writes at most once per SAVE_DEBOUNCE_MS. */
  private save(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  // ─── Write path ─────────────────────────────────────────────────────────

  record(entry: LearningEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.applyToStats(entry);
    this.save();
  }

  private applyToStats(entry: LearningEntry): void {
    const key   = this.key(entry.goal, entry.target);
    const stats = this.getOrCreate(key);

    stats.attempts++;
    if (entry.success) {
      stats.successes++;
      stats.lastSuccess = entry.timestamp;
      for (const v of Object.values(entry.gained ?? {})) stats.totalGained += v;
      stats.totalMs += entry.duration;
    } else {
      stats.lastFailure = entry.timestamp;
      stats.recentFails.push(entry.timestamp);
    }

    // Prune old fails outside the window
    const cutoff = Date.now() - AVOID_WINDOW_MS;
    stats.recentFails = stats.recentFails.filter(t => t > cutoff);

    // Suppress if too many recent failures
    if (stats.recentFails.length >= AVOID_FAILS) {
      this.avoided.set(key, Date.now() + AVOID_COOLDOWN);
      stats.recentFails = [];
    }

    // Exponentially-weighted moving average
    const sample = entry.success ? 1 : 0;
    stats.ewma   = stats.attempts === 1
      ? sample
      : EWMA_ALPHA * sample + (1 - EWMA_ALPHA) * stats.ewma;

    this.stats.set(key, stats);
  }

  // ─── Read path ───────────────────────────────────────────────────────────

  /**
   * 0–1 score for a goal/target pair.
   * Returns 0.5 (neutral) when there's not enough data yet.
   */
  getScore(goal: string, target: string): number {
    const stats = this.stats.get(this.key(goal, target));
    if (!stats || stats.attempts < 2) return 0.5;
    return stats.ewma;
  }

  /**
   * True if this goal/target is currently suppressed due to repeated failures.
   * Brain.ts should check this before queuing a goal.
   */
  isSuppressed(goal: string, target: string): boolean {
    const key   = this.key(goal, target);
    const until = this.avoided.get(key);
    if (!until) return false;
    if (Date.now() > until) { this.avoided.delete(key); return false; }
    return true;
  }

  /**
   * Compact recent-history string for the LLM prompt.
   * "gather(wood)✓ craft(crafting_table)✓ gather(iron)✗"
   */
  lastThree(n = RECENT_N): string {
    return this.entries
      .slice(-n)
      .map(e => `${e.goal}(${e.target})${e.success ? '✓' : '✗'}`)
      .join(' ') || 'none';
  }

  /**
   * Overall success rate for a goal type — kept for backwards compat
   * with any code that still calls successRate().
   */
  successRate(goal: string): number {
    const relevant = this.entries.filter(e => e.goal === goal);
    if (!relevant.length) return 0.5;
    return relevant.filter(e => e.success).length / relevant.length;
  }

  /**
   * Returns 'day' or 'night' — whichever had more successful gathers
   * for the given target. Kept from original.
   */
  bestTimeToGather(target: string): string {
    const day   = this.entries.filter(e => e.target === target && e.timeOfDay === 'day'   && e.success).length;
    const night = this.entries.filter(e => e.target === target && e.timeOfDay === 'night' && e.success).length;
    return day >= night ? 'day' : 'night';
  }

  /**
   * Items-per-minute for gather/hunt goals.
   * Brain.ts can prefer faster resources when the bot has options.
   */
  efficiency(goal: string, target: string): number {
    const stats = this.stats.get(this.key(goal, target));
    if (!stats || stats.totalMs === 0) return 0;
    return (stats.totalGained / stats.totalMs) * 60_000;
  }

  /**
   * How many times the bot tried goal(target) in the last windowMs.
   * Use to detect if it's stuck looping on the same task.
   */
  recentAttempts(goal: string, target: string, windowMs = AVOID_WINDOW_MS): number {
    const cutoff = Date.now() - windowMs;
    return this.entries.filter(
      e => e.goal === goal && e.target === target && e.timestamp > cutoff,
    ).length;
  }

  /**
   * One-line summary for the LLM prompt.
   * "wins:gather:wood(0.9) craft:crafting_table(1.0) | avoid:gather:iron"
   */
  summary(): string {
    const wins: string[]       = [];
    const suppressed: string[] = [];

    for (const [key, stats] of this.stats.entries()) {
      if (stats.attempts < 2) continue;
      const until = this.avoided.get(key);
      if (until && Date.now() < until) {
        suppressed.push(key);
      } else if (stats.ewma >= 0.7) {
        wins.push(`${key}(${stats.ewma.toFixed(1)})`);
      }
    }

    const parts: string[] = [];
    if (wins.length)       parts.push(`wins:${wins.slice(0, 4).join(' ')}`);
    if (suppressed.length) parts.push(`avoid:${suppressed.slice(0, 3).join(' ')}`);
    return parts.join(' | ') || 'no data';
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private key(goal: string, target: string): string {
    return `${goal}:${target}`;
  }

  private getOrCreate(key: string): GoalStats {
    if (!this.stats.has(key)) {
      this.stats.set(key, {
        attempts: 0, successes: 0, ewma: 0.5,
        totalGained: 0, totalMs: 0,
        lastSuccess: 0, lastFailure: 0, recentFails: [],
      });
    }
    return this.stats.get(key)!;
  }
}