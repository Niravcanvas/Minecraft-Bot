"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaClient = void 0;
const logger_1 = require("./utils/logger");
class OllamaClient {
    model;
    baseUrl;
    constructor(model, baseUrl = 'http://localhost:11434') {
        this.model = model;
        this.baseUrl = baseUrl;
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }
    async ping() {
        try {
            const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
            const data = await res.json();
            const found = data.models.some(m => m.name.startsWith(this.model.split(':')[0]));
            if (found) {
                logger_1.log.success(`Ollama ready — ${this.model}`);
                return true;
            }
            logger_1.log.error(`Model "${this.model}" not found. Run: ollama pull ${this.model}`);
            return false;
        }
        catch {
            logger_1.log.error('Ollama unreachable. Is it running?');
            return false;
        }
    }
    async chat(messages) {
        const res = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model, messages, stream: false, format: 'json',
                options: { temperature: 0.15, num_predict: 80, repeat_penalty: 1.1 },
            }),
        });
        if (!res.ok)
            throw new Error(`Ollama HTTP ${res.status}`);
        const data = await res.json();
        return data.message?.content ?? '';
    }
    getModel() { return this.model; }
}
exports.OllamaClient = OllamaClient;
