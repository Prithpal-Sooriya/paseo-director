import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PLUGIN_ID = "paseo-director";

export function paseoHome(): string {
  const configured = process.env.PASEO_HOME?.trim();
  return configured ? configured : join(homedir(), ".paseo");
}

export function dataDir(): string {
  return process.env.DIRECTOR_DATA_DIR?.trim() || join(paseoHome(), "plugin-data", PLUGIN_ID);
}

export const paths = {
  state: () => join(dataDir(), "state.json"),
  memory: () => join(dataDir(), "memory.md"),
  ledger: () => join(dataDir(), "ledger.jsonl"),
  log: () => join(dataDir(), "events.log"),
  roles: () => join(dataDir(), "roles"),
  home: () => join(dataDir(), "home"),
  missions: () => join(dataDir(), "missions"),
  mission: (slug: string) => join(dataDir(), "missions", slug),
};

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n");
  await rename(temp, file);
}

export async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

export async function appendLine(file: string, line: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, line.endsWith("\n") ? line : line + "\n");
}

export async function logEvent(kind: string, detail: Record<string, unknown> = {}): Promise<void> {
  await appendLine(paths.log(), JSON.stringify({ at: new Date().toISOString(), ...detail, kind }));
}
