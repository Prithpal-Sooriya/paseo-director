import { defineAgentTool, type AgentToolDefinition } from "@getpaseo/plugin/server";
import { z } from "zod";
import { factSchema, postFact, readFacts, renderFacts } from "./board";
import { logEvent } from "./data";
import { readMemory, recordBelief, remember } from "./memory";
import { closeMission, openMission, renameMission } from "./missions";
import { gate, preflightSchema } from "./preflight";
import { pollPr, routePrEvents } from "./pr-watch";
import { receiptSchema, renderBoard } from "./receipts";
import type { RoleDefinition } from "./roles";
import { remember as rememberApi, settings, tellAgent, tellDirector } from "./runtime";
import { acceptReceipt, dispatchWave } from "./swarm";
import { addTimer, cancelTimer } from "./timers";
import { findMission, readState, updateState, workerFor } from "./store";

const ok = (text: string, structuredContent?: unknown) => ({ text, structuredContent });
const fail = (error: unknown) => ({ text: error instanceof Error ? error.message : String(error), isError: true });

const taskSchema = z.object({
  role: z.string().describe("Role name, e.g. scout, builder, reviewer, or a custom role."),
  title: z.string().min(1).max(80).describe("Short task title; also the builder workspace and branch name."),
  brief: z.string().min(1).describe("Scope-first brief: goal, exact scope, out of scope, done-when."),
  workspace: z.string().optional().describe("Existing mission workspace label or id. Omit: builders get a new worktree workspace, read-only roles use the primary workspace."),
  provider: z.string().optional().describe("Override provider/model for this task. Omit to use the role profile."),
});

export function directorTools(getRoles: () => Promise<RoleDefinition[]>): AgentToolDefinition[] {
  return [
    defineAgentTool({
      name: "director_open_mission",
      description: "Open a mission: creates one Paseo project with the same readable name plus a primary workspace (on the repo if given). Requires an honest preflight.",
      input: z.object({
        name: z.string().min(1).max(80).describe("Readable name, e.g. 'ASSETS-4402 RWA perps Long/Short'. Project and workspace share it."),
        repo: z.string().optional().describe("Absolute path to the git repo builders will branch from."),
        preflight: preflightSchema,
      }),
      async execute(input, { paseo }) {
        rememberApi(paseo);
        try {
          const verdict = gate(input.preflight, 0, (await settings()).maxWave);
          if (!verdict.pass) return fail(`Preflight gate: ${verdict.reason}`);
          for (const known of input.preflight.knowns) await recordBelief(known, "observed", "director:preflight");
          for (const assumption of input.preflight.assumptions) await recordBelief(assumption, "inferred", "director:preflight");
          const mission = await openMission({ name: input.name, repo: input.repo, goal: input.preflight.goal });
          return ok(`Mission "${mission.name}" open: project ${mission.projectId}, primary workspace ${mission.workspaces[0]!.workspaceId}. Slug: ${mission.slug}.`, mission);
        } catch (error) {
          return fail(error);
        }
      },
    }),
    defineAgentTool({
      name: "director_dispatch",
      description: "Dispatch one rolling wave (1-4 tasks) of visible worker agents into a mission. Builders get their own worktree workspace (one per PR). You get one summary when the whole wave reports.",
      input: z.object({ mission: z.string().describe("Mission slug, name or id."), tasks: z.array(taskSchema).min(1), preflight: preflightSchema }),
      async execute(input, { paseo, agent }) {
        rememberApi(paseo);
        try {
          const roles = await getRoles();
          const readOnly = input.tasks.every((task) => roles.find((role) => role.name === task.role)?.writes === false);
          const verdict = gate(input.preflight, input.tasks.length, (await settings()).maxWave, readOnly);
          if (!verdict.pass) return fail(`Preflight gate: ${verdict.reason}`);
          const result = await dispatchWave(paseo, input.mission, input.tasks, roles, agent.id);
          const lines = result.workers.map((w) => `- ${w.role} \`${w.agentId}\` "${w.title}" (${w.provider})`);
          const errors = result.errors.map((e) => `- ⚠️ ${e}`);
          return ok([`Wave ${result.wave.id}: ${result.workers.length} worker(s) started.`, ...lines, ...errors].join("\n"), result);
        } catch (error) {
          return fail(error);
        }
      },
    }),
    defineAgentTool({
      name: "director_steer",
      description: "Send guidance to a worker. 'queue' waits for its turn to end, 'steer' joins the running turn, 'interrupt' replaces it.",
      input: z.object({ agentId: z.string(), message: z.string().min(1), behavior: z.enum(["queue", "steer", "interrupt"]).default("steer") }),
      async execute(input, { paseo }) {
        try {
          const worker = workerFor(await readState(), input.agentId) ?? (await readState()).workers.find((w) => w.agentId.startsWith(input.agentId));
          if (!worker) return fail(`No worker ${input.agentId}`);
          await tellAgent(worker.agentId, `[from Director] ${input.message}`, input.behavior, paseo);
          await updateState((draft) => {
            const target = draft.workers.find((w) => w.agentId === worker.agentId);
            if (target) target.lastReceipt = null;
          });
          return ok(`Sent to ${worker.title} (${input.behavior}).`);
        } catch (error) {
          return fail(error);
        }
      },
    }),
    defineAgentTool({
      name: "director_status",
      description: "Board of active missions, their workspaces/PRs and every worker's latest receipt. Cheap; call before reporting to the user.",
      input: z.object({}),
      async execute(_input, { paseo }) {
        rememberApi(paseo);
        const state = await readState();
        return ok(renderBoard(state.missions, state.workers));
      },
    }),
    defineAgentTool({
      name: "director_watch_pr",
      description: "Attach a PR to the builder workspace that owns it so CI and review events reach you. Not needed when the builder reported the PR via director_report (that already watches it).",
      input: z.object({ mission: z.string(), workspace: z.string().describe("Workspace label or id."), pr: z.number().int().positive() }),
      async execute(input, { paseo }) {
        rememberApi(paseo);
        try {
          const mission = await updateState((draft) => {
            const target = findMission(draft, input.mission);
            const ws = target?.workspaces.find((w) => w.workspaceId === input.workspace || w.label === input.workspace);
            if (!target || !ws) throw new Error("Unknown mission or workspace");
            const owner = target.workspaces.find((w) => w.pr === input.pr && w !== ws && !w.archived);
            if (owner) throw new Error(`PR #${input.pr} is already watched on workspace "${owner.label}". One PR per workspace; nothing to do.`);
            ws.pr = input.pr;
            return target;
          });
          const ws = mission.workspaces.find((w) => w.pr === input.pr)!;
          const events = await pollPr(mission, ws);
          await routePrEvents(paseo, mission, ws, events);
          return ok(`Watching PR #${input.pr} for ${mission.name} / ${ws.label}.`);
        } catch (error) {
          return fail(error);
        }
      },
    }),
    defineAgentTool({
      name: "director_timer",
      description: "Set or cancel a one-shot timer that wakes you with a note. Only when the user asked for a follow-up; CI/PR watching needs no timer.",
      input: z.object({ action: z.enum(["set", "cancel", "list"]), delay: z.string().optional().describe("e.g. 20m, 2h, 1d"), note: z.string().optional(), id: z.string().optional() }),
      async execute(input) {
        try {
          if (input.action === "list") return ok(JSON.stringify((await readState()).timers, null, 2));
          if (input.action === "cancel") return ok((await cancelTimer(input.id ?? "")) ? "Cancelled." : "No such timer.");
          const timer = await addTimer(input.delay ?? "", input.note ?? "Timer");
          return ok(`Timer ${timer.id} fires at ${timer.fireAt}.`);
        } catch (error) {
          return fail(error);
        }
      },
    }),
    defineAgentTool({
      name: "director_remember",
      description: "Append a short durable lesson, user preference, retro note or fact to your memory. It is injected into your instructions on every launch.",
      input: z.object({ kind: z.enum(["lesson", "preference", "retro", "fact"]), text: z.string().min(3).max(600) }),
      async execute(input) {
        return ok(`Remembered: ${await remember(input.kind, input.text)}`);
      },
    }),
    defineAgentTool({
      name: "director_memory",
      description: "Read your memory file.",
      input: z.object({}),
      async execute() {
        return ok((await readMemory()) || "_empty_");
      },
    }),
    defineAgentTool({
      name: "director_close_mission",
      description: "Tear a mission down: archive its workers and workspaces and remove its project. Irreversible for the ADE layout (branches stay). Only when the user asks or the work is merged.",
      input: z.object({ mission: z.string(), reason: z.string() }),
      async execute(input, { paseo }) {
        try {
          const mission = findMission(await readState(), input.mission);
          if (!mission) return fail(`No mission ${input.mission}`);
          await closeMission(paseo, mission.id, input.reason);
          return ok(`Closed "${mission.name}".`);
        } catch (error) {
          return fail(error);
        }
      },
    }),
    defineAgentTool({
      name: "director_rename_mission",
      description: "Rename a mission; the project and primary workspace follow.",
      input: z.object({ mission: z.string(), name: z.string().min(1).max(80) }),
      async execute(input, { paseo }) {
        try {
          const mission = findMission(await readState(), input.mission);
          if (!mission) return fail(`No mission ${input.mission}`);
          await renameMission(paseo, mission.id, input.name, "tool");
          return ok(`Renamed to "${input.name}".`);
        } catch (error) {
          return fail(error);
        }
      },
    }),
    defineAgentTool({
      name: "director_board_read",
      description: "Read the shared typed facts board of a mission.",
      input: z.object({ mission: z.string(), kinds: z.array(z.string()).optional(), query: z.string().optional() }),
      async execute(input) {
        const mission = findMission(await readState(), input.mission);
        if (!mission) return fail(`No mission ${input.mission}`);
        return ok(renderFacts(await readFacts(mission.slug), input) || "_board empty_");
      },
    }),
  ];
}

export function workerTools(): AgentToolDefinition[] {
  return [
    defineAgentTool({
      name: "director_report",
      description: "Report to the Director with a typed receipt. Call when done, blocked, failed, or at a meaningful partial step, then end your turn.",
      input: receiptSchema,
      async execute(input, { agent, paseo }) {
        rememberApi(paseo);
        try {
          const outcome = await acceptReceipt(agent.id, input);
          await logEvent("worker.report", { agent: agent.id, status: input.status });
          const message = outcome.waveSummary ?? `[director:progress] ${outcome.line}`;
          await tellDirector(message, paseo, agent.id);
          return ok("Reported. End your turn now unless your brief says otherwise.");
        } catch (error) {
          return fail(error);
        }
      },
    }),
    defineAgentTool({
      name: "director_board_read",
      description: "Read your mission's shared facts board (findings, decisions, interfaces, risks).",
      input: z.object({ kinds: z.array(z.string()).optional(), query: z.string().optional() }),
      async execute(input, { agent }) {
        const state = await readState();
        const mission = state.missions.find((m) => m.id === workerFor(state, agent.id)?.missionId);
        if (!mission) return fail("Not a Director worker");
        return ok(renderFacts(await readFacts(mission.slug), input) || "_board empty_");
      },
    }),
    defineAgentTool({
      name: "director_board_post",
      description: "Post a durable typed fact other workers in your mission need. Include evidence when you observed it.",
      input: factSchema,
      async execute(input, { agent }) {
        const state = await readState();
        const mission = state.missions.find((m) => m.id === workerFor(state, agent.id)?.missionId);
        if (!mission) return fail("Not a Director worker");
        const fact = await postFact(mission.slug, input, agent.id);
        return ok(`Posted [${fact.kind}/${fact.basis}] ${fact.key}.`);
      },
    }),
    defineAgentTool({
      name: "director_request",
      description: "Ask the Director for something only it owns: a new workspace, a timer, a decision from the user, or missing context. Then end your turn.",
      input: z.object({ kind: z.enum(["workspace", "timer", "decision", "context"]), detail: z.string().min(1) }),
      async execute(input, { agent, paseo }) {
        const worker = workerFor(await readState(), agent.id);
        if (!worker) return fail("Not a Director worker");
        await tellDirector(`[director:request] ${worker.title} (\`${agent.id.slice(0, 8)}\`) asks for a ${input.kind}: ${input.detail}`, paseo, agent.id);
        return ok("Request sent to the Director. End your turn; it will message you.");
      },
    }),
  ];
}
