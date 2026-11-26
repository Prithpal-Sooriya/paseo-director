import { randomUUID } from "node:crypto";
import type { PaseoApi } from "@getpaseo/client";
import { readFacts, renderFacts } from "./board";
import { logEvent } from "./data";
import { recordBelief } from "./memory";
import { addBuilderWorkspace } from "./missions";
import { clip } from "./names";
import { briefMessage, MISSION_LABEL, ROLE_LABEL } from "./prompts";
import { evidenceStrength, receiptLine, type ReceiptInput, toReceipt } from "./receipts";
import type { RoleDefinition } from "./roles";
import { settings } from "./runtime";
import { findMission, type Mission, readState, updateState, type Wave, type WorkerRecord } from "./store";

export interface TaskInput {
  role: string;
  title: string;
  brief: string;
  workspace?: string;
  provider?: string;
}

export async function pickProvider(role: RoleDefinition, explicit?: string): Promise<string> {
  const config = await settings();
  return explicit?.trim() || config.roleProviders[role.name]?.trim() || role.provider?.trim() || config.directorProvider;
}

export function activeWriter(workers: WorkerRecord[], workspaceId: string, writerRoles: Set<string>): WorkerRecord | undefined {
  return workers.find(
    (w) => w.workspaceId === workspaceId && writerRoles.has(w.role) && (w.lastReceipt === null || w.lastReceipt.status === "partial"),
  );
}

async function resolveWorkspace(mission: Mission, task: TaskInput, role: RoleDefinition, writerRoles: Set<string>): Promise<{ workspaceId: string; cwd: string; branch: string | null }> {
  if (task.workspace) {
    const named = mission.workspaces.find((ws) => !ws.archived && (ws.workspaceId === task.workspace || ws.label === task.workspace));
    if (!named) throw new Error(`Workspace "${task.workspace}" is not part of mission "${mission.name}"`);
    if (role.writes) {
      const writer = activeWriter((await readState()).workers, named.workspaceId, writerRoles);
      if (writer) throw new Error(`Workspace "${named.label}" already has an active writer (${writer.agentId.slice(0, 8)}). One writer per checkout.`);
    }
    return { workspaceId: named.workspaceId, cwd: named.cwd, branch: named.branch };
  }
  if (role.writes) {
    const created = await addBuilderWorkspace(mission.id, task.title);
    return { workspaceId: created.workspaceId, cwd: created.cwd, branch: created.branch };
  }
  const primary = mission.workspaces.find((ws) => ws.primary)!;
  return { workspaceId: primary.workspaceId, cwd: primary.cwd, branch: primary.branch };
}

export async function dispatchWave(
  paseo: PaseoApi,
  missionRef: string,
  tasks: TaskInput[],
  roles: RoleDefinition[],
  parentAgentId: string | null,
): Promise<{ wave: Wave; workers: WorkerRecord[]; errors: string[] }> {
  const writerRoles = new Set(roles.filter((role) => role.writes).map((role) => role.name));
  const mission = findMission(await readState(), missionRef);
  if (!mission || mission.status !== "active") throw new Error(`No active mission "${missionRef}"`);
  const config = await settings();
  const facts = renderFacts(await readFacts(mission.slug));
  const wave: Wave = { id: `wave_${randomUUID().slice(0, 8)}`, missionId: mission.id, agentIds: [], createdAt: new Date().toISOString(), reported: false };
  const workers: WorkerRecord[] = [];
  const errors: string[] = [];
  for (const task of tasks) {
    const role = roles.find((item) => item.name === task.role);
    if (!role) {
      errors.push(`${task.title}: unknown role "${task.role}"`);
      continue;
    }
    try {
      const current = findMission(await readState(), mission.id)!;
      const place = await resolveWorkspace(current, task, role, writerRoles);
      const provider = await pickProvider(role, task.provider);
      const agent = await paseo.workspaces.ref(place.workspaceId).agents.create({
        config: {
          provider,
          ...(config.workerMode ? { modeId: config.workerMode } : {}),
        },
        title: `${role.name}: ${clip(task.title, 50)}`,
        prompt: briefMessage(task, current.name, facts, { cwd: place.cwd, repo: current.repo, branch: place.branch }),
        labels: { [ROLE_LABEL]: role.name, [MISSION_LABEL]: current.slug },
        metadata: { "director.mission": current.id, "director.wave": wave.id, "director.role": role.name },
        ...(parentAgentId ? { parent: parentAgentId } : {}),
      });
      const record: WorkerRecord = {
        agentId: agent.id,
        missionId: current.id,
        workspaceId: place.workspaceId,
        role: role.name,
        title: task.title,
        waveId: wave.id,
        provider,
        createdAt: new Date().toISOString(),
        lastReceipt: null,
        leashStrikes: 0,
      };
      workers.push(record);
      wave.agentIds.push(agent.id);
    } catch (error) {
      errors.push(`${task.title}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await updateState((draft) => {
    draft.workers.push(...workers);
    if (wave.agentIds.length > 0) draft.waves.push(wave);
  });
  await logEvent("wave.dispatch", { wave: wave.id, mission: mission.id, agents: wave.agentIds, errors });
  return { wave, workers, errors };
}

export interface ReceiptOutcome {
  worker: WorkerRecord;
  line: string;
  waveSummary: string | null;
}

export async function acceptReceipt(agentId: string, input: ReceiptInput): Promise<ReceiptOutcome> {
  const receipt = toReceipt(input);
  return updateState(async (draft) => {
    const worker = draft.workers.find((item) => item.agentId === agentId);
    if (!worker) throw new Error("This agent is not a Director worker");
    worker.lastReceipt = receipt;
    if (input.pr) {
      const workspaces = draft.missions.find((m) => m.id === worker.missionId)?.workspaces ?? [];
      const ws = workspaces.find((w) => w.workspaceId === worker.workspaceId);
      if (ws && !workspaces.some((w) => w !== ws && w.pr === input.pr && !w.archived)) ws.pr = input.pr;
    }
    await recordBelief(receipt.summary, evidenceStrength(receipt), `worker:${agentId}`, receipt.evidence);
    const line = receiptLine(worker, receipt);
    let waveSummary: string | null = null;
    const wave = draft.waves.find((item) => item.id === worker.waveId);
    if (wave && !wave.reported) {
      const members = draft.workers.filter((item) => wave.agentIds.includes(item.agentId));
      if (members.every((member) => member.lastReceipt && member.lastReceipt.at >= wave.createdAt)) {
        wave.reported = true;
        waveSummary = [`**Wave ${wave.id} complete** (${members.length} task${members.length === 1 ? "" : "s"}):`, ...members.map((m) => receiptLine(m, m.lastReceipt!))].join("\n");
      }
    }
    return { worker: { ...worker }, line, waveSummary };
  });
}
