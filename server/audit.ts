import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { commandOf, judgeCommand, judgeTool, type LeashVerdict } from "./leash";

export interface Violation {
  callId: string;
  what: string;
  verdict: LeashVerdict;
}

export function judgeCall(name: string, input: Record<string, unknown> | undefined, detail?: { type?: string; command?: unknown }): LeashVerdict & { what: string } {
  if (/(^|__)director_/.test(name)) return { allowed: true, what: name };
  const command = commandOf(input, detail);
  if (command && /^\s*director_/.test(command)) return { allowed: true, what: command };
  if (command) return { ...judgeCommand(command), what: command };
  return { ...judgeTool(name), what: name };
}

export function escapesCheckout(command: string, own: string, main: string | null): boolean {
  if (!main || own === main) return false;
  const stripped = command.split(own).join("");
  return new RegExp(`${main.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-])`).test(stripped);
}

export function judgeCheckout(command: string, own: string, main: string | null): LeashVerdict & { what: string } {
  if (escapesCheckout(command, own, main)) {
    return { allowed: false, rule: "foreign-checkout", reason: `Work only in your checkout ${own}, not the main checkout ${main}.`, what: command };
  }
  return { allowed: true, what: command };
}

export function auditItems(items: AgentTimelineItem[], checkout?: { own: string; main: string | null }): Violation[] {
  const seen = new Set<string>();
  const violations: Violation[] = [];
  for (const item of items) {
    if (item.type !== "tool_call" || seen.has(item.callId)) continue;
    seen.add(item.callId);
    let verdict = judgeCall(item.name, undefined, item.detail as { type?: string; command?: unknown });
    if (verdict.allowed && checkout && verdict.what !== item.name) verdict = judgeCheckout(verdict.what, checkout.own, checkout.main);
    if (!verdict.allowed) violations.push({ callId: item.callId, what: verdict.what, verdict });
  }
  return violations;
}

export function strikeMessage(violations: Violation[], strikes: number): string {
  const lines = violations.map((v) => `- \`${v.what.slice(0, 120)}\` → ${v.verdict.reason}`);
  return [`[director:leash] Strike ${strikes}. You broke the leash:`, ...lines, "Undo anything you started (kill loops/schedules), then continue within your brief or call director_report."].join("\n");
}
