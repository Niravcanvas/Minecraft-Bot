"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Memory = void 0;
const logger_1 = require("./utils/logger");
class Memory {
    shortTerm = [];
    longTerm = new Map();
    maxMessages;
    constructor(maxMessages = 40) {
        this.maxMessages = maxMessages;
    }
    // ── Short-term ──────────────────────────────────────────────────────────────
    push(msg) {
        this.shortTerm.push(msg);
        // Trim oldest non-system messages when over limit
        while (this.shortTerm.length > this.maxMessages) {
            const idx = this.shortTerm.findIndex((m) => m.role !== 'system');
            if (idx !== -1)
                this.shortTerm.splice(idx, 1);
            else
                break;
        }
    }
    clearShortTerm() {
        this.shortTerm = [];
        logger_1.log.memory('Short-term memory cleared');
    }
    // ── Long-term ───────────────────────────────────────────────────────────────
    remember(key, value, tick) {
        const existing = this.longTerm.get(key);
        this.longTerm.set(key, { value, updatedAt: tick });
        if (existing) {
            logger_1.log.memory(`Updated [${key}]: "${existing.value}" → "${value}"`);
        }
        else {
            logger_1.log.memory(`Learned [${key}]: "${value}"`);
        }
    }
    forget(key) {
        if (this.longTerm.has(key)) {
            this.longTerm.delete(key);
            logger_1.log.memory(`Forgot [${key}]`);
        }
    }
    recall(key) {
        return this.longTerm.get(key)?.value ?? null;
    }
    // ── Build context for LLM ───────────────────────────────────────────────────
    buildMessages(systemPrompt) {
        const facts = [...this.longTerm.entries()];
        const fullSystem = facts.length > 0
            ? `${systemPrompt}\n\n== What I remember ==\n${facts
                .map(([k, f]) => `[${k}]: ${f.value}`)
                .join('\n')}`
            : systemPrompt;
        return [
            { role: 'system', content: fullSystem },
            ...this.shortTerm,
        ];
    }
    // ── Debug ───────────────────────────────────────────────────────────────────
    dump() {
        logger_1.log.memory(`Short-term: ${this.shortTerm.length} messages`);
        if (this.longTerm.size === 0) {
            logger_1.log.memory('Long-term: empty');
        }
        else {
            for (const [k, f] of this.longTerm.entries()) {
                logger_1.log.memory(`  [${k}] = "${f.value}" (tick ${f.updatedAt})`);
            }
        }
    }
    getLongTerm() {
        return Object.fromEntries([...this.longTerm.entries()].map(([k, f]) => [k, f.value]));
    }
    getShortTermLength() {
        return this.shortTerm.length;
    }
}
exports.Memory = Memory;
