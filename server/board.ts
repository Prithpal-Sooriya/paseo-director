import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { appendLine, paths } from "./data";

export const factSchema = z.object({
  kind: z.enum(["finding", "decision", "interface", "risk", "question", "artifact"]),
  key: z.string().min(1).max(80).describe("Short stable key, e.g. 'api:/v2/tokens shape'. A newer fact with the same key supersedes the old one."),
  value: z.string().min(1).max(2000),
  evidence: z.array(z.string()).default([]),
});

export type FactInput = z.output<typeof factSchema>;

export interface Fact extends FactInput {
  at: string;
  by: string;
  basis: "observed" | "reported";
}

export function boardFile(missionSlug: string): string {
  return join(paths.mission(missionSlug), "board.jsonl");
}

export async function postFact(missionSlug: string, fact: FactInput, by: string): Promise<Fact> {
  const entry: Fact = { ...fact, at: new Date().toISOString(), by, basis: fact.evidence.length > 0 ? "observed" : "reported" };
  await appendLine(boardFile(missionSlug), JSON.stringify(entry));
  return entry;
}

export async function readFacts(missionSlug: string): Promise<Fact[]> {
  let text = "";
  try {
    text = await readFile(boardFile(missionSlug), "utf8");
  } catch {
    return [];
  }
  const latest = new Map<string, Fact>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const fact = JSON.parse(line) as Fact;
      latest.set(`${fact.kind}:${fact.key}`, fact);
    } catch {}
  }
  return [...latest.values()];
}

export function renderFacts(facts: Fact[], filter?: { kinds?: string[]; query?: string }): string {
  const query = filter?.query?.toLowerCase();
  return facts
    .filter((fact) => !filter?.kinds?.length || filter.kinds.includes(fact.kind))
    .filter((fact) => !query || `${fact.key} ${fact.value}`.toLowerCase().includes(query))
    .map((fact) => `- [${fact.kind}/${fact.basis}] **${fact.key}**: ${fact.value}${fact.evidence.length ? ` _(evidence: ${fact.evidence.join(", ")})_` : ""}`)
    .join("\n");
}
