export interface LeashVerdict {
  allowed: boolean;
  rule?: string;
  reason?: string;
}

interface Rule {
  id: string;
  pattern: RegExp;
  reason: string;
}

const COMMAND_RULES: Rule[] = [
  { id: "sleep", pattern: /(^|[;&|\s(])sleep\s+(\d{2,}|[3-9])(\.\d+)?[smh]?\b/, reason: "Do not sleep or wait. End your turn with director_report; the Director wakes you when something changes." },
  { id: "loop", pattern: /\b(while\s+(true|:|\[\s*1\s*\])|until\s+false)\b/, reason: "No polling loops. Report and end your turn; the Director owns waiting." },
  { id: "watch", pattern: /(^|[;&|\s])(watch\s+-n|watch\s+\S)|gh\s+(run|pr)\s+(watch|checks\s+.*--watch)/, reason: "No watching or tailing CI. The Director babysits PRs and CI and will message you." },
  { id: "schedule", pattern: /\bpaseo\s+(schedule|loop)\b|\bcrontab\b|\bat\s+now\b|\blaunchctl\b/, reason: "Schedules and timers belong to the Director. Ask with director_request kind=timer." },
  { id: "spawn", pattern: /\bpaseo\s+(run|agent\s+create|workspace\s+create|project\s+(create|delete|rename))\b/, reason: "Only the Director creates agents, workspaces and projects. Ask with director_request." },
  { id: "merge", pattern: /\bgh\s+pr\s+(merge|close)\b/, reason: "Merging and closing PRs is the user's call through the Director." },
  { id: "force-push", pattern: /\bgit\s+push\b[^\n]*(--force\b|-f\b|--force-with-lease\b)/, reason: "Force pushes need the Director's explicit go-ahead." },
];

const TOOL_RULES: Rule[] = [
  { id: "schedule", pattern: /schedule|heartbeat|loop/i, reason: "Schedules, heartbeats and loops belong to the Director." },
  { id: "spawn", pattern: /(create|run|launch)_?(agent|workspace|project)|spawn/i, reason: "Only the Director creates agents and workspaces." },
];

export function judgeCommand(command: string): LeashVerdict {
  for (const rule of COMMAND_RULES) {
    if (rule.pattern.test(command)) return { allowed: false, rule: rule.id, reason: rule.reason };
  }
  return { allowed: true };
}

export function judgeTool(name: string): LeashVerdict {
  if (/^director_/.test(name)) return { allowed: true };
  for (const rule of TOOL_RULES) {
    if (rule.pattern.test(name)) return { allowed: false, rule: rule.id, reason: rule.reason };
  }
  return { allowed: true };
}

export function commandOf(input: Record<string, unknown> | undefined, detail?: { type?: string; command?: unknown }): string | null {
  if (detail?.type === "shell" && typeof detail.command === "string") return detail.command;
  if (typeof input?.command === "string") return input.command;
  if (typeof input?.cmd === "string") return input.cmd;
  if (Array.isArray(input?.command)) return input.command.join(" ");
  return null;
}

export const LEASH_BRIEF = [
  "Leash (enforced by the Director plugin):",
  "- Do exactly the brief. No unasked refactors, docs, or extra features. If you spot more work, list it under `next` in your report.",
  "- Never sleep, poll, watch CI, or loop waiting. Never create schedules, timers, agents, workspaces or projects.",
  "- When done, blocked, or after a meaningful partial step, call director_report and end your turn.",
  "- Do not merge, close, or force-push PRs.",
].join("\n");
