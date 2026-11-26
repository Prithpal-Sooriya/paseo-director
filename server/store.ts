import { paths, readJson, writeJson } from "./data";

export type Role = string;

export interface MissionWorkspace {
  workspaceId: string;
  label: string;
  branch: string | null;
  cwd: string;
  primary: boolean;
  pr: number | null;
  archived: boolean;
}

export interface WorkerRecord {
  agentId: string;
  missionId: string;
  workspaceId: string;
  role: Role;
  title: string;
  waveId: string | null;
  provider: string;
  createdAt: string;
  lastReceipt: Receipt | null;
  leashStrikes: number;
}

export interface Receipt {
  status: "done" | "blocked" | "partial" | "failed";
  summary: string;
  evidence: string[];
  next?: string;
  at: string;
}

export interface Wave {
  id: string;
  missionId: string;
  agentIds: string[];
  createdAt: string;
  reported: boolean;
}

export interface Mission {
  id: string;
  slug: string;
  name: string;
  projectId: string;
  dir: string;
  repo: string | null;
  createdAt: string;
  status: "active" | "closed";
  workspaces: MissionWorkspace[];
}

export interface Timer {
  id: string;
  fireAt: string;
  note: string;
}

export interface DirectorState {
  director: { agentId: string | null; workspaceId: string | null };
  missions: Mission[];
  workers: WorkerRecord[];
  waves: Wave[];
  timers: Timer[];
  prSnapshots: Record<string, unknown>;
}

export function emptyState(): DirectorState {
  return { director: { agentId: null, workspaceId: null }, missions: [], workers: [], waves: [], timers: [], prSnapshots: {} };
}

let cache: DirectorState | null = null;
let chain: Promise<unknown> = Promise.resolve();

export async function readState(): Promise<DirectorState> {
  cache ??= { ...emptyState(), ...(await readJson<Partial<DirectorState>>(paths.state(), {})) };
  return cache;
}

export function updateState<T>(change: (state: DirectorState) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const state = await readState();
    const result = await change(state);
    await writeJson(paths.state(), state);
    return result;
  });
  chain = run.catch(() => undefined);
  return run;
}

export function resetStateCache(): void {
  cache = null;
  chain = Promise.resolve();
}

export function missionForProject(state: DirectorState, projectId: string): Mission | undefined {
  return state.missions.find((mission) => mission.projectId === projectId && mission.status === "active");
}

export function missionForWorkspace(state: DirectorState, workspaceId: string): Mission | undefined {
  return state.missions.find((mission) => mission.workspaces.some((ws) => ws.workspaceId === workspaceId));
}

export function findMission(state: DirectorState, ref: string): Mission | undefined {
  const key = ref.trim().toLowerCase();
  return state.missions.find(
    (mission) => mission.id === ref || mission.slug === key || mission.name.toLowerCase() === key || mission.projectId === ref,
  );
}

export function workerFor(state: DirectorState, agentId: string): WorkerRecord | undefined {
  return state.workers.find((worker) => worker.agentId === agentId);
}
