import type { PaseoApi } from "@getpaseo/client";
import { logEvent } from "./data";
import { applySync, onProjectRemoved, onProjectSeen, onWorkspaceArchived, onWorkspaceSeen } from "./missions";
import { settings, tellDirector } from "./runtime";
import { readState } from "./store";

export async function reconcileNames(paseo: PaseoApi): Promise<void> {
  const state = await readState();
  const active = state.missions.filter((mission) => mission.status === "active");
  if (active.length === 0) return;
  const config = await settings();
  const projects = (await paseo.projects.list()).projects;
  const projectIds = new Set(projects.map((project) => project.projectId));
  for (const mission of active) {
    if (!projectIds.has(mission.projectId)) {
      await applySync(paseo, onProjectRemoved(active, mission.projectId), announceClosed);
      continue;
    }
    const project = projects.find((item) => item.projectId === mission.projectId)!;
    const fromProject = onProjectSeen(active, project);
    if (fromProject.kind !== "none") {
      await applySync(paseo, fromProject);
      continue;
    }
    const listed = await paseo.workspaces.list({ filter: { projectId: mission.projectId, includeBackground: true }, page: { limit: 100 } });
    const live = new Map(listed.entries.map((ws) => [ws.id, ws]));
    for (const entry of mission.workspaces.filter((ws) => !ws.archived)) {
      const ws = live.get(entry.workspaceId);
      if (!ws || ws.archivingAt) {
        const latest = (await readState()).missions.filter((m) => m.status === "active");
        await applySync(paseo, onWorkspaceArchived(latest, entry.workspaceId, config.teardownEmptyMissions), announceClosed);
        continue;
      }
      if (entry.primary) {
        await applySync(paseo, onWorkspaceSeen(active, { id: ws.id, title: ws.title, name: ws.name }));
      }
    }
  }
}

export async function announceClosed(mission: { name: string }, reason: string): Promise<void> {
  await logEvent("mission.announce_closed", { name: mission.name, reason });
  await tellDirector(`[director:event] Mission "${mission.name}" was torn down (${reason}). Its project, workspaces and workers are archived. Consider a short retro with director_remember.`);
}
