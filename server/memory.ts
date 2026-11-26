import { appendLine, paths, readText } from "./data";

export const MEMORY_CAP = 12_000;

export async function readMemory(): Promise<string> {
  const text = await readText(paths.memory());
  return text.length > MEMORY_CAP ? text.slice(text.length - MEMORY_CAP) : text;
}

export async function remember(kind: "lesson" | "preference" | "retro" | "fact", text: string): Promise<string> {
  const line = `- ${new Date().toISOString().slice(0, 10)} [${kind}] ${text.trim().replace(/\s*\n\s*/g, " ")}`;
  await appendLine(paths.memory(), line);
  return line;
}

export type Basis = "observed" | "reported" | "inferred";

export async function recordBelief(claim: string, basis: Basis, source: string, evidence: string[] = []): Promise<void> {
  await appendLine(paths.ledger(), JSON.stringify({ at: new Date().toISOString(), claim, basis, source, evidence }));
}
