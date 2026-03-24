"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = void 0;
const chalk_1 = __importDefault(require("chalk"));
const ts = () => new Date().toLocaleTimeString();
exports.log = {
    info: (msg) => console.log(`${chalk_1.default.gray(ts())} ${chalk_1.default.cyan('ℹ')}  ${msg}`),
    success: (msg) => console.log(`${chalk_1.default.gray(ts())} ${chalk_1.default.green('✔')}  ${msg}`),
    warn: (msg) => console.log(`${chalk_1.default.gray(ts())} ${chalk_1.default.yellow('⚠')}  ${msg}`),
    error: (msg) => console.log(`${chalk_1.default.gray(ts())} ${chalk_1.default.red('✖')}  ${msg}`),
    chat: (u, m) => console.log(`${chalk_1.default.gray(ts())} ${chalk_1.default.magenta('💬')} ${chalk_1.default.bold(u)}: ${m}`),
    goal: (msg) => console.log(`${chalk_1.default.gray(ts())} ${chalk_1.default.blue('🎯')} ${msg}`),
    brain: (msg) => console.log(`${chalk_1.default.gray(ts())} ${chalk_1.default.magenta('🧠')} ${msg}`),
    divider: () => console.log(chalk_1.default.gray('─'.repeat(60))),
};
