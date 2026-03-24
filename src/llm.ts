import { log } from './utils/logger';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string; }

const LLM_TIMEOUT_MS   = 10_000;   // hard cap per request — prevents infinite hangs
const REPING_INTERVAL  = 60_000;   // background availability re-check

export class OllamaClient {
  private available = false;
  private repingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private model: string, private baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** Check if Ollama is reachable. Does NOT exit on failure — returns false. */
  async ping(): Promise<boolean> {
    try {
      const res  = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json() as { models: { name: string }[] };
      const found = data.models.some(m => m.name.startsWith(this.model.split(':')[0]));
      if (found) {
        log.success(`Ollama ready — ${this.model}`);
        this.available = true;
        return true;
      }
      log.warn(`Model "${this.model}" not found. Run: ollama pull ${this.model}`);
      this.available = false;
      return false;
    } catch {
      log.warn('⚠ Ollama unreachable — bot will run without LLM (deterministic-only mode).');
      log.warn('  Chat responses and LLM goal-picking disabled until Ollama is available.');
      this.available = false;
      return false;
    }
  }

  /** Start background re-ping so LLM becomes available if started later. */
  startBackgroundPing(): void {
    if (this.repingTimer) return;
    this.repingTimer = setInterval(async () => {
      if (this.available) return;
      try {
        const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
        const data = await res.json() as { models: { name: string }[] };
        if (data.models.some(m => m.name.startsWith(this.model.split(':')[0]))) {
          log.success(`Ollama came online — LLM features now active (${this.model})`);
          this.available = true;
        }
      } catch { /* still offline, silently continue */ }
    }, REPING_INTERVAL);
  }

  /** Stop background re-ping. */
  stopBackgroundPing(): void {
    if (this.repingTimer) { clearInterval(this.repingTimer); this.repingTimer = null; }
  }

  /** True if Ollama is reachable and model loaded. */
  isAvailable(): boolean { return this.available; }

  async chat(messages: ChatMessage[], format?: string): Promise<string> {
    // If LLM is offline, return empty — callers handle fallback
    if (!this.available) {
      throw new Error('Ollama unavailable');
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  AbortSignal.timeout(LLM_TIMEOUT_MS),
        body: JSON.stringify({
          model: this.model, messages, stream: false,
          ...(format && { format }),
          options: {
            temperature:    0.15,
            num_predict:    150,
            repeat_penalty: 1.1,
          },
        }),
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json() as { message?: { content: string } };
      return data.message?.content ?? '';
    } catch (e: any) {
      // Mark unavailable on connection errors (not HTTP errors)
      if (e.name === 'AbortError' || e.name === 'TimeoutError' || e.message?.includes('fetch')) {
        log.warn(`LLM request failed: ${e.message} — marking offline`);
        this.available = false;
      }
      throw e;
    }
  }

  getModel() { return this.model; }
}