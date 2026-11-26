import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { createLocalWorkspace, createWorktreeWorkspace, projects } from "./cli";
import { logEvent, paths } from "./data";
import { branchName, slugify, uniqueSlug } from "./names";
import { findMission, type Mission, type MissionWorkspace, readState, updateState } from "./store";

const closing = new Set<string>();

export async function openMission(input: { name: string; repo?: string; goal: string }): Promise<Mission> {
  const state = await readState();
  const slug = uniqueSlug(slugify(input.name), state.missions.map((mission) => mission.slug));
  const dir = paths.mission(slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "MISSION.md"), `# ${input.name}\n\n${input.goal.trim()}\n\nRepo: ${input.repo ?? "none"}\n`);
  const project = await projects.create(dir);
  if (project.name !== input.name) await projects.rename(project.projectId, input.name);
  const primary = await createLocalWorkspace({ dir: input.repo ?? dir, projectId: project.projectId, title: input.name });
  const mission: Mission = {
    id: `msn_${slug}`,
    slug,
    name: input.name,
    projectId: project.projectId,
    dir,
    repo: input.repo ?? null,
    createdAt: new Date().toISOString(),
    status: "active",
    workspaces: [{ workspaceId: primary.workspaceId, label: input.name, branch: null, cwd: primary.cwd, primary: true, pr: null, archived: false }],
  };
  await updateState((draft) => {
    draft.missions.push(mission);
  });
  await logEvent("mission.open", { id: mission.id, projectId: mission.projectId, workspaceId: primary.workspaceId });
  return mission;
}

export async function addBuilderWorkspace(missionRef: string, label: string, base?: string): Promise<MissionWorkspace> {
  const mission = findMission(await readState(), missionRef);
  if (!mission) throw new Error(`No mission "${missionRef}"`);
  if (!mission.repo) throw new Error(`Mission "${mission.name}" has no repo, so it cannot have builder worktrees`);
  const branch = branchName(mission.slug, label);
  const created = await createWorktreeWorkspace({ repo: mission.repo, projectId: mission.projectId, title: label, branch, base });
  const workspace: MissionWorkspace = { workspaceId: created.workspaceId, label, branch, cwd: created.cwd, primary: false, pr: null, archived: false };
  await updateState((draft) => {
    draft.missions.find((item) => item.id === mission.id)?.workspaces.push(workspace);
  });
  await logEvent("mission.workspace", { mission: mission.id, workspaceId: workspace.workspaceId, branch });
  return workspace;
}

export async function closeMission(paseo: PaseoApi | null, missionId: string, reason: string): Promise<Mission | null> {
  if (closing.has(missionId)) return null;
  closing.add(missionId);
  try {
    const mission = (await readState()).missions.find((item) => item.id === missionId);
    if (!mission || mission.status === "closed") return null;
    const workers = (await readState()).workers.filter((worker) => worker.missionId === missionId);
    if (paseo) {
      for (const worker of workers) {
        await paseo.agents.ref(worker.agentId).archive().catch(() => undefined);
      }
      for (const ws of mission.workspaces.filter((item) => !item.archived)) {
        await paseo.workspaces.archive(ws.workspaceId).catch(() => undefined);
      }
    }
    await projects.remove(mission.projectId).catch((error) => logEvent("mission.project_delete_failed", { error: String(error) }));
    const closed = await updateState((draft) => {
      const target = draft.missions.find((item) => item.id === missionId)!;
      target.status = "closed";
      target.workspaces.forEach((ws) => (ws.archived = true));
      draft.waves = draft.waves.filter((wave) => wave.missionId !== missionId);
      delete draft.prSnapshots[missionId];
      return target;
    });
    await logEvent("mission.close", { id: missionId, reason });
    return closed;
  } finally {
    closing.delete(missionId);
  }
}

export async function renameMission(paseo: PaseoApi | null, missionId: string, name: string, origin: "project" | "workspace" | "tool"): Promise<boolean> {
  const mission = (await readState()).missions.find((item) => item.id === missionId);
  if (!mission || mission.status !== "active" || mission.name === name || !name.trim()) return false;
  await updateState((draft) => {
    const target = draft.missions.find((item) => item.id === missionId)!;
    target.name = name;
    const primary = target.workspaces.find((ws) => ws.primary);
    if (primary) primary.label = name;
  });
  if (origin !== "project") await projects.rename(mission.projectId, name);
  const primary = mission.workspaces.find((ws) => ws.primary);
  if (origin !== "workspace" && primary && paseo) await paseo.workspaces.ref(primary.workspaceId).setTitle(name);
  await logEvent("mission.rename", { id: missionId, name, origin });
  return true;
}

export type SyncAction =
  | { kind: "none" }
  | { kind: "rename"; missionId: string; name: string; origin: "project" | "workspace" }
  | { kind: "close"; missionId: string; reason: string }
  | { kind: "workspace_archived"; missionId: string; workspaceId: string };

export function onWorkspaceSeen(missions: Mission[], ws: { id: string; title?: string | null; name: string; projectCustomName?: string | null; projectDisplayName?: string }): SyncAction {
  const mission = missions.find((item) => item.status === "active" && item.workspaces.some((entry) => entry.workspaceId === ws.id));
  if (!mission) return { kind: "none" };
  const entry = mission.workspaces.find((item) => item.workspaceId === ws.id)!;
  if (!entry.primary) return { kind: "none" };
  const title = (ws.title ?? ws.name).trim();
  if (title && title !== mission.name) return { kind: "rename", missionId: mission.id, name: title, origin: "workspace" };
  const projectName = (ws.projectCustomName ?? ws.projectDisplayName ?? "").trim();
  if (projectName && projectName !== mission.name) return { kind: "rename", missionId: mission.id, name: projectName, origin: "project" };
  return { kind: "none" };
}

export function onWorkspaceArchived(missions: Mission[], workspaceId: string, teardownWhenEmpty: boolean): SyncAction {
  const mission = missions.find((item) => item.status === "active" && item.workspaces.some((entry) => entry.workspaceId === workspaceId));
  if (!mission) return { kind: "none" };
  const entry = mission.workspaces.find((item) => item.workspaceId === workspaceId)!;
  if (entry.primary) return { kind: "close", missionId: mission.id, reason: "primary workspace archived" };
  const remaining = mission.workspaces.filter((item) => !item.archived && item.workspaceId !== workspaceId && !item.primary);
  if (teardownWhenEmpty && remaining.length === 0 && mission.workspaces.some((item) => item.pr !== null)) {
    return { kind: "close", missionId: mission.id, reason: "last PR workspace archived" };
  }
  return { kind: "workspace_archived", missionId: mission.id, workspaceId };
}

export function onProjectRemoved(missions: Mission[], projectId: string): SyncAction {
  const mission = missions.find((item) => item.status === "active" && item.projectId === projectId);
  return mission ? { kind: "close", missionId: mission.id, reason: "project removed" } : { kind: "none" };
}

export function onProjectSeen(missions: Mission[], project: { projectId: string; projectCustomName?: string | null; projectDisplayName: string }): SyncAction {
  const mission = missions.find((item) => item.status === "active" && item.projectId === project.projectId);
  if (!mission) return { kind: "none" };
  const name = (project.projectCustomName ?? project.projectDisplayName).trim();
  return name && name !== mission.name ? { kind: "rename", missionId: mission.id, name, origin: "project" } : { kind: "none" };
}

export async function applySync(paseo: PaseoApi | null, action: SyncAction, onClosed?: (mission: Mission, reason: string) => Promise<void>): Promise<void> {
  if (action.kind === "rename") await renameMission(paseo, action.missionId, action.name, action.origin);
  if (action.kind === "workspace_archived") {
    await updateState((draft) => {
      const ws = draft.missions.find((item) => item.id === action.missionId)?.workspaces.find((item) => item.workspaceId === action.workspaceId);
      if (ws) ws.archived = true;
    });
  }
  if (action.kind === "close") {
    const mission = await closeMission(paseo, action.missionId, action.reason);
    if (mission && onClosed) await onClosed(mission, action.reason);
  }
}
