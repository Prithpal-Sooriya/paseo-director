import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { createLocalWorkspace, projects } from "./cli";
import { logEvent, paths, readText } from "./data";
import { ROLE_LABEL } from "./prompts";
import { settings } from "./runtime";
import { readState, updateState } from "./store";

export const DIRECTOR_NAME = "Director";

const KICKOFF = "You are now running. Call director_status, then greet the user in two lines: what you can do and what is in flight. Wait for instructions.";

async function ensureHome(paseo: PaseoApi): Promise<{ workspaceId: string; cwd: string }> {
  const state = await readState();
  if (state.director.workspaceId) {
    const listed = await paseo.workspaces.list({ filter: { idPrefix: state.director.workspaceId }, page: { limit: 5 } });
    const found = listed.entries.find((ws) => ws.id === state.director.workspaceId);
    if (found) return { workspaceId: found.id, cwd: found.workspaceDirectory };
  }
  const dir = paths.home();
  await mkdir(dir, { recursive: true });
  if (!(await readText(join(dir, "README.md")))) {
    await writeFile(join(dir, "README.md"), "# Director home\n\nThe Director agent runs here. Missions live in their own projects.\n");
  }
  const existing = (await paseo.projects.list()).projects.find((project) => project.projectRootPath === dir);
  const projectId = existing?.projectId ?? (await projects.create(dir)).projectId;
  if (!existing) await projects.rename(projectId, DIRECTOR_NAME).catch(() => undefined);
  const workspace = await createLocalWorkspace({ dir, projectId, title: DIRECTOR_NAME });
  await updateState((draft) => {
    draft.director.workspaceId = workspace.workspaceId;
  });
  return { workspaceId: workspace.workspaceId, cwd: workspace.cwd };
}

export async function launchDirector(paseo: PaseoApi): Promise<{ agentId: string; workspaceId: string | null; created: boolean }> {
  const state = await readState();
  if (state.director.agentId) {
    try {
      const result = await paseo.agents.ref(state.director.agentId).refresh();
      if (result && !result.agent.archivedAt) return { agentId: result.agent.id, workspaceId: state.director.workspaceId, created: false };
    } catch {}
  }
  const home = await ensureHome(paseo);
  const config = await settings();
  const agent = await paseo.workspaces.ref(home.workspaceId).agents.create({
    config: { provider: config.directorProvider },
    title: DIRECTOR_NAME,
    labels: { [ROLE_LABEL]: "director" },
    metadata: { "director.role": "director" },
    prompt: KICKOFF,
  });
  await updateState((draft) => {
    draft.director.agentId = agent.id;
  });
  await logEvent("director.launch", { agentId: agent.id, workspaceId: home.workspaceId });
  return { agentId: agent.id, workspaceId: home.workspaceId, created: true };
}
