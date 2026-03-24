"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrustMemory = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class TrustMemory {
    players = {};
    file;
    constructor(dataDir = './data') {
        this.file = path.join(dataDir, 'trust.json');
        fs.mkdirSync(dataDir, { recursive: true });
        this.load();
    }
    load() {
        try {
            if (fs.existsSync(this.file))
                this.players = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
        }
        catch {
            this.players = {};
        }
    }
    save() {
        try {
            fs.writeFileSync(this.file, JSON.stringify(this.players, null, 2));
        }
        catch { }
    }
    get(username) {
        if (!this.players[username])
            this.players[username] = { username, trustScore: 0.5, interactions: [], lastSeen: Date.now(), gaveMeItems: [], attackedMe: false, chatCount: 0 };
        return this.players[username];
    }
    log(username, event) {
        const p = this.get(username);
        p.interactions.push(`${new Date().toISOString().slice(11, 19)}: ${event}`);
        if (p.interactions.length > 30)
            p.interactions = p.interactions.slice(-30);
        p.lastSeen = Date.now();
        this.save();
    }
    onAttacked(u) { const p = this.get(u); p.trustScore = Math.max(0, p.trustScore - 0.4); p.attackedMe = true; this.log(u, 'attacked me'); }
    onGaveItem(u, item) { const p = this.get(u); p.trustScore = Math.min(1, p.trustScore + 0.2); p.gaveMeItems.push(item); this.log(u, `gave ${item}`); }
    onChat(u, msg) { const p = this.get(u); p.trustScore = Math.min(1, p.trustScore + 0.01); p.chatCount++; this.log(u, `said: ${msg.slice(0, 30)}`); }
    isTrusted(u) { return this.get(u).trustScore > 0.65; }
    isThreat(u) { return this.get(u).trustScore < 0.25; }
    threats() { return Object.values(this.players).filter(p => p.trustScore < 0.25).map(p => p.username).join(',') || 'none'; }
}
exports.TrustMemory = TrustMemory;
