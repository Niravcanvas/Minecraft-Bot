import { log } from './utils/logger';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string; }

export class OllamaClient {
  constructor(private model: string, private baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async ping(): Promise<boolean> {
    try {
      const res  = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      const data = await res.json() as { models: { name: string }[] };
      const found = data.models.some(m => m.name.startsWith(this.model.split(':')[0]));
      if (found) { log.success(`Ollama ready — ${this.model}`); return true; }
      log.error(`Model "${this.model}" not found. Run: ollama pull ${this.model}`);
      return false;
    } catch { log.error('Ollama unreachable. Is it running?'); return false; }
  }

  async chat(messages: ChatMessage[], format?: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model, messages, stream: false,
        ...(format && { format }),
        options: { temperature: 0.15, num_predict: 80, repeat_penalty: 1.1 },
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json() as { message?: { content: string } };
    return data.message?.content ?? '';
  }

  getModel() { return this.model; }
}