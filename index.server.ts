import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { auditItems, judgeCall, judgeCheckout, strikeMessage } from "./server/audit";
import { logEvent } from "./server/data";
import { launchDirector } from "./server/director";
import { readMemory } from "./server/memory";
import { applySync, onWorkspaceArchived } from "./server/missions";
import { pollAll } from "./server/pr-watch";
import { directorPrompt, ROLE_LABEL, workerPrompt } from "./server/prompts";
import { renderBoard } from "./server/receipts";
import { loadRoles } from "./server/roles";
import { paseoApi, remember, settings, tellAgent, tellDirector, useSettings } from "./server/runtime";
import { announceClosed, reconcileNames } from "./server/sync";
import { fireDue } from "./server/timers";
import { directorTools, workerTools } from "./server/tools";
import { type DirectorState, readState, updateState, type WorkerRecord, workerFor } from "./server/store";
import { boardRpc, launchDirectorRpc } from "./shared/rpc";
import { directorSettings } from "./shared/settings";

const TICK_MS = 15_000;
const RECONCILE_MS = 30_000;

function checkoutOf(state: DirectorState, worker: WorkerRecord): { own: string; main: string | null } | undefined {
  const mission = state.missions.find((m) => m.id === worker.missionId);
  const own = mission?.workspaces.find((ws) => ws.workspaceId === worker.workspaceId)?.cwd;
  return mission && own ? { own, main: mission.repo } : undefined;
}

export default function contribute(server: PluginServerContext) {
  useSettings(server.registerSettings(directorSettings));
  const roles = () => loadRoles();

  server.handle(launchDirectorRpc, async (_input, { paseo }) => {
    remember(paseo);
    return launchDirector(paseo);
  });

  server.handle(boardRpc, async (_input, { paseo }) => {
    remember(paseo);
    const state = await readState();
    return { markdown: renderBoard(state.missions, state.workers), directorAgentId: state.director.agentId };
  });

  server.addHook("agent.open.before", async ({ request }, { paseo }) => {
    remember(paseo);
    const role = request.labels[ROLE_LABEL];
    if (!role) return;
    if (role === "director") {
      const prompt = directorPrompt(await readMemory(), await roles());
      return { ...request, tools: [...request.tools, ...directorTools(roles)], appendSystemPrompt: [...(request.appendSystemPrompt ?? []), prompt] };
    }
    const state = await readState();
    const worker = workerFor(state, request.agentId);
    const mission = state.missions.find((m) => m.id === worker?.missionId) ?? state.missions.find((m) => m.slug === request.labels["director/mission"]);
    const definition = (await roles()).find((r) => r.name === role);
    const extra = definition ? [workerPrompt(definition, mission?.name ?? "unknown")] : [];
    return { ...request, tools: [...request.tools, ...workerTools()], appendSystemPrompt: [...(request.appendSystemPrompt ?? []), ...extra] };
  });

  server.addHook("agent.permission.before", async ({ agent, request }, { paseo }) => {
    remember(paseo);
    const state = await readState();
    const worker = workerFor(state, agent.id);
    if (!worker) return;
    let verdict = judgeCall(request.name, request.input as Record<string, unknown> | undefined, request.detail as { type?: string; command?: unknown });
    const checkout = checkoutOf(state, worker);
    if (verdict.allowed && checkout && verdict.what !== request.name) verdict = judgeCheckout(verdict.what, checkout.own, checkout.main);
    if (verdict.allowed) return;
    await paseo.agents
      .ref(agent.id)
      .respondToPermission({ requestId: request.id, response: { behavior: "deny", message: `Director leash: ${verdict.reason}` } })
      .catch((error) => logEvent("leash.deny_failed", { error: String(error) }));
    await logEvent("leash.deny", { agent: agent.id, what: verdict.what, rule: verdict.rule });
  });

  server.addHook("agent.turn.after", async ({ agent, turnId, outcome }, { paseo }) => {
    remember(paseo);
    const state = await readState();
    const worker = workerFor(state, agent.id);
    if (!worker) return;
    if (turnId) {
      const page = await paseo.agents.ref(agent.id).timeline.refetch({ direction: "tail", limit: 1, wholeTurns: true }).catch(() => null);
      const items = (page?.entries ?? []).filter((entry) => entry.turnId === turnId).map((entry) => entry.item);
      const violations = auditItems(items, checkoutOf(state, worker));
      if (violations.length > 0) {
        const strikes = await updateState((draft) => {
          const target = draft.workers.find((w) => w.agentId === agent.id)!;
          target.leashStrikes += 1;
          return target.leashStrikes;
        });
        await logEvent("leash.strike", { agent: agent.id, strikes, what: violations.map((v) => v.what) });
        await tellAgent(agent.id, strikeMessage(violations, strikes), "queue", paseo).catch(() => undefined);
        await tellDirector(`[director:leash] ${worker.title} (\`${agent.id.slice(0, 8)}\`) strike ${strikes}: ${violations.map((v) => v.verdict.rule).join(", ")}.`, paseo, agent.id);
      }
    }
    const fresh = workerFor(await readState(), agent.id)!;
    const reportedThisTurn = fresh.lastReceipt && Date.parse(fresh.lastReceipt.at) >= Date.now() - 5 * 60_000;
    if (outcome.kind === "failed") {
      await tellDirector(`[director:progress] ❌ ${worker.title} (\`${agent.id.slice(0, 8)}\`) turn failed: ${outcome.error.message}`, paseo, agent.id);
    } else if (outcome.kind === "completed" && !reportedThisTurn) {
      await tellAgent(agent.id, "[director] Your turn ended without director_report. Call director_report now (status partial/blocked/done with evidence).", "queue", paseo).catch(() => undefined);
    }
  });

  server.addHook("workspace.archive.after", async ({ workspace }, { paseo }) => {
    remember(paseo);
    const config = await settings();
    const state = await readState();
    await applySync(paseo, onWorkspaceArchived(state.missions, workspace.id, config.teardownEmptyMissions), announceClosed);
  });

  server.addHook("agent.create.after", async (_payload, { paseo }) => remember(paseo));
  server.addHook("workspace.create.after", async (_payload, { paseo }) => remember(paseo));

  server.addHook("agent.archive.after", async ({ agent }, { paseo }) => {
    remember(paseo);
    const state = await readState();
    if (state.director.agentId === agent.id) {
      await updateState((draft) => {
        draft.director.agentId = null;
      });
    }
  });

  let lastPoll = 0;
  let lastReconcile = 0;
  let ticking = false;
  const tick = async () => {
    const paseo: PaseoApi | null = paseoApi();
    if (ticking) return;
    ticking = true;
    try {
      const now = Date.now();
      await fireDue(now);
      if (now - lastReconcile >= RECONCILE_MS) {
        lastReconcile = now;
        if (paseo) await reconcileNames(paseo).catch((error) => logEvent("sync.failed", { error: String(error) }));
      }
      if (now - lastPoll >= (await settings()).prPollSeconds * 1000) {
        lastPoll = now;
        await pollAll(paseo);
      }
    } finally {
      ticking = false;
    }
  };
  const interval = setInterval(() => void tick(), TICK_MS);
  void logEvent("plugin.start");
  return () => clearInterval(interval);
}
