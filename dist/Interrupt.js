"use strict";
// ─── Shared interrupt flag ────────────────────────────────────────────────────
// FIX Bug #3: allows the safety loop in index.ts to signal long-running goals
// (especially smelt) to abort early when an emergency arises.
//
// Usage in index.ts safety loop:
//   import { setInterrupt } from './interrupt';
//   setInterrupt(true);
//   await sleep(100);   // give current goal one tick to see the flag
//   await executor.run(emergency);
//   setInterrupt(false);
Object.defineProperty(exports, "__esModule", { value: true });
exports.interruptGoal = void 0;
exports.setInterrupt = setInterrupt;
exports.interruptGoal = false;
function setInterrupt(v) {
    exports.interruptGoal = v;
}
