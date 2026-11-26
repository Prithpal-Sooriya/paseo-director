import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { paths, readText } from "./data";

export interface RoleDefinition {
  name: string;
  description: string;
  writes: boolean;
  provider?: string;
  prompt: string;
  source: "builtin" | string;
}

const BUILTIN: RoleDefinition[] = [
  {
    name: "scout",
    description: "Read-only investigation: find files, explain code, answer an unknown. Never edits.",
    writes: false,
    source: "builtin",
    prompt: [
      "You are a scout in a Director-run swarm. You are read-only: never edit, write, commit, or push.",
      "Answer the question in your brief with evidence (file:line, command output). Prefer facts you observed over guesses, and label guesses as such.",
      "Post durable facts other workers need with director_board_post. Finish with director_report.",
    ].join("\n"),
  },
  {
    name: "builder",
    description: "Implements a scoped change in its own worktree workspace (one per PR), runs tests, commits, pushes, opens the PR when asked.",
    writes: true,
    source: "builtin",
    prompt: [
      "You are a builder in a Director-run swarm. You are the only writer in this workspace's checkout.",
      "Implement exactly the brief. Run the relevant tests/lint locally before reporting done; include the commands and results as evidence.",
      "Commit with clear messages. Open or update a PR only if the brief says so, then report the PR number in director_report.",
      "When the Director forwards a CI failure: start on it immediately; pull the failing job's log, reproduce locally, and rerun once to rule out a flake before changing code. Report a flake with evidence instead of 'fixing' it.",
    ].join("\n"),
  },
  {
    name: "reviewer",
    description: "Read-only review of a diff or PR against the brief; returns findings, never edits.",
    writes: false,
    source: "builtin",
    prompt: [
      "You are a reviewer in a Director-run swarm. You are read-only.",
      "Review the change against its brief: correctness first, then risk, then scope creep. Cite file:line for each finding and rate it high/medium/low.",
      "Do not nitpick style unless it breaks lint. Finish with director_report (status done, findings in summary/evidence).",
    ].join("\n"),
  },
];

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const pair = /^([A-Za-z_]+):\s*(.*)$/.exec(line.trim());
    if (pair) meta[pair[1]!] = pair[2]!.replace(/^["']|["']$/g, "");
  }
  return { meta, body: match[2]!.trim() };
}

export function parseRoleFile(file: string, text: string): RoleDefinition | null {
  const { meta, body } = parseFrontmatter(text);
  const name = (meta.name ?? file.replace(/\.md$/, "")).trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(name) || name === "director" || !body) return null;
  return {
    name,
    description: meta.description ?? body.split("\n")[0]!.slice(0, 160),
    writes: meta.writes === "true",
    provider: meta.provider || undefined,
    prompt: body,
    source: file,
  };
}

export async function loadRoles(dir = paths.roles()): Promise<RoleDefinition[]> {
  const roles = new Map(BUILTIN.map((role) => [role.name, role]));
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((file) => file.endsWith(".md"));
  } catch {}
  for (const file of files.sort()) {
    const role = parseRoleFile(file, await readText(join(dir, file)));
    if (role) roles.set(role.name, role);
  }
  return [...roles.values()];
}
