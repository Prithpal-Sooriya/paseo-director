import { randomUUID } from "node:crypto";
import { logEvent } from "./data";
import { tellDirector } from "./runtime";
import { readState, type Timer, updateState } from "./store";

const DURATION = /^(\d+)\s*(s|m|h|d)$/;

export function parseDelay(text: string): number {
  const match = DURATION.exec(text.trim().toLowerCase());
  if (!match) throw new Error(`Bad delay "${text}". Use e.g. 90s, 20m, 2h, 1d.`);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"];
  return Number(match[1]) * unit;
}

export async function addTimer(delay: string, note: string, now = Date.now()): Promise<Timer> {
  const timer: Timer = { id: `tmr_${randomUUID().slice(0, 8)}`, fireAt: new Date(now + parseDelay(delay)).toISOString(), note };
  await updateState((draft) => {
    draft.timers.push(timer);
  });
  return timer;
}

export async function cancelTimer(id: string): Promise<boolean> {
  return updateState((draft) => {
    const before = draft.timers.length;
    draft.timers = draft.timers.filter((timer) => timer.id !== id);
    return draft.timers.length !== before;
  });
}

export function dueTimers(timers: Timer[], now = Date.now()): Timer[] {
  return timers.filter((timer) => Date.parse(timer.fireAt) <= now);
}

export async function fireDue(now = Date.now()): Promise<number> {
  const due = dueTimers((await readState()).timers, now);
  for (const timer of due) {
    const delivered = await tellDirector(`[director:timer] ${timer.note}`);
    if (!delivered) return 0;
    await updateState((draft) => {
      draft.timers = draft.timers.filter((item) => item.id !== timer.id);
    });
    await logEvent("timer.fire", { id: timer.id });
  }
  return due.length;
}
