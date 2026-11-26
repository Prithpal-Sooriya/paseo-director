import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { paseoHome } from "./data";

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

let lookup: Promise<string> | null = null;

async function findBinary(name: string, extra: string[]): Promise<string> {
  const dirs = [...(process.env.PATH ?? "").split(delimiter), join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  for (const candidate of [...extra, ...dirs.filter(Boolean).map((dir) => join(dir, name))]) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(`\`${name}\` is not on the daemon's PATH`);
}

export function run(command: string, args: string[], options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"], env: options.env ? { ...process.env, ...options.env } : process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} ${args[0] ?? ""} timed out`));
    }, options.timeoutMs ?? 60_000);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function errorText(result: CliResult): string {
  for (const stream of [result.stderr, result.stdout]) {
    const text = stream.trim();
    if (!text) continue;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) return parsed.error.message;
    } catch {}
    return text.split("\n")[0] ?? text;
  }
  return `exit ${result.code}`;
}

export async function paseoJson<T>(args: string[], timeoutMs = 60_000): Promise<T> {
  const shipped = process.env.PASEO_CLI?.trim();
  lookup ??= findBinary("paseo", shipped ? [shipped] : []);
  const result = await run(await lookup, [...args, "--home", paseoHome(), "--json"], { timeoutMs });
  if (result.code !== 0) throw new Error(`paseo ${args.slice(0, 2).join(" ")} failed: ${errorText(result)}`);
  return JSON.parse(result.stdout) as T;
}

export async function sendViaCli(agentId: string, text: string, from: string): Promise<void> {
  const shipped = process.env.PASEO_CLI?.trim();
  lookup ??= findBinary("paseo", shipped ? [shipped] : []);
  const result = await run(await lookup, ["send", agentId, "--prompt", text, "--behavior", "queue", "--no-wait", "--home", paseoHome()], { env: { PASEO_AGENT_ID: from } });
  if (result.code !== 0) throw new Error(`paseo send failed: ${errorText(result)}`);
}

export const projects = {
  create: (dir: string) => paseoJson<{ projectId: string; name: string }>(["project", "create", dir]),
  rename: (projectId: string, name: string) => paseoJson<{ projectId: string; name: string }>(["project", "rename", projectId, name]),
  remove: (projectId: string) => paseoJson<unknown>(["project", "delete", projectId]),
};

export interface CreatedWorkspace {
  workspaceId: string;
  cwd: string;
  name: string;
}

export function createWorktreeWorkspace(options: {
  repo: string;
  projectId: string;
  title: string;
  branch: string;
  base?: string;
}): Promise<CreatedWorkspace> {
  return paseoJson<CreatedWorkspace>([
    "workspace",
    "create",
    "--isolation",
    "worktree",
    "--path",
    options.repo,
    "--project",
    options.projectId,
    "--title",
    options.title,
    "--new-branch",
    options.branch,
    ...(options.base ? ["--base", options.base] : []),
  ], 180_000);
}

export function createLocalWorkspace(options: { dir: string; projectId: string; title: string }): Promise<CreatedWorkspace> {
  return paseoJson<CreatedWorkspace>([
    "workspace", "create", "--isolation", "local", "--path", options.dir, "--project", options.projectId, "--title", options.title,
  ]);
}

let ghLookup: Promise<string> | null = null;

export async function gh(args: string[], cwd: string): Promise<string> {
  ghLookup ??= findBinary("gh", []);
  const result = await run(await ghLookup, args, { cwd, timeoutMs: 45_000 });
  if (result.code !== 0) throw new Error(`gh ${args[0]} failed: ${errorText(result)}`);
  return result.stdout;
}
