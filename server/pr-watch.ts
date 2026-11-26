import type { PaseoApi } from "@getpaseo/client";
import { gh } from "./cli";
import { logEvent } from "./data";
import { clip } from "./names";
import { diffPr, parseGhPr, type PrEvent, type PrSnapshot } from "./pr-diff";
import { settings, tellAgent, tellDirector } from "./runtime";
import { type Mission, type MissionWorkspace, readState, updateState } from "./store";

const FIELDS = "number,state,headRefOid,statusCheckRollup,comments,reviews";

export function snapshotKey(missionId: string, workspaceId: string): string {
  return `${missionId}:${workspaceId}`;
}

export async function pollPr(mission: Mission, ws: MissionWorkspace): Promise<PrEvent[]> {
  if (!ws.pr) return [];
  const next = parseGhPr(await gh(["pr", "view", String(ws.pr), "--json", FIELDS], ws.cwd));
  const key = snapshotKey(mission.id, ws.workspaceId);
  const previous = ((await readState()).prSnapshots[key] as PrSnapshot | undefined) ?? null;
  await updateState((draft) => {
    draft.prSnapshots[key] = next;
  });
  return diffPr(previous, next);
}

export function eventText(mission: Mission, ws: MissionWorkspace, event: PrEvent): string {
  const where = `PR #${ws.pr} (${mission.name} / ${ws.label})`;
  switch (event.kind) {
    case "check_failed":
      return event.lintLike
        ? `[director:ci] ${where}: lint/type check "${event.check.name}" failed${event.check.url ? ` (${event.check.url})` : ""}. Fix it now: run the linter locally, fix, commit, push, then director_report.`
        : `[director:ci] ${where}: check "${event.check.name}" failed${event.check.url ? ` (${event.check.url})` : ""}. Start now, do not wait for the rest of CI: fetch the failing log (gh run view --log-failed), reproduce locally, rerun once to rule out a flake. Report a flake with evidence instead of changing code. Then director_report.`;
    case "checks_green":
      return `[director:ci] ${where}: all checks green.`;
    case "new_feedback":
      return `[director:review] ${where}: new feedback:\n${event.items.map((item) => `- @${item.author}${item.path ? ` on ${item.path}` : ""}: ${clip(item.body, 500)}`).join("\n")}`;
    case "state":
      return `[director:pr] ${where} is now ${event.state}.`;
  }
}

export async function routePrEvents(paseo: PaseoApi | null, mission: Mission, ws: MissionWorkspace, events: PrEvent[]): Promise<void> {
  const config = await settings();
  const state = await readState();
  const builder = [...state.workers].reverse().find((w) => w.workspaceId === ws.workspaceId && w.role === "builder");
  for (const event of events) {
    const text = eventText(mission, ws, event);
    await logEvent("pr.event", { mission: mission.id, pr: ws.pr, event: event.kind, check: event.kind === "check_failed" ? event.check.name : undefined });
    if (event.kind === "check_failed" && config.autoRouteCi && builder) {
      await tellAgent(builder.agentId, text, "queue", paseo).catch(() => undefined);
      await tellDirector(`${text}\n(Already forwarded to builder \`${builder.agentId.slice(0, 8)}\`.)`, paseo);
      continue;
    }
    if (event.kind === "new_feedback") {
      await tellDirector(`${text}\nJudge whether this needs work. If yes, steer the builder${builder ? ` \`${builder.agentId.slice(0, 8)}\`` : ""} with director_steer; if not, say why to the user.`, paseo);
      continue;
    }
    await tellDirector(text, paseo);
  }
}

export async function pollAll(paseo: PaseoApi | null): Promise<void> {
  const state = await readState();
  for (const mission of state.missions.filter((item) => item.status === "active")) {
    for (const ws of mission.workspaces.filter((item) => item.pr && !item.archived)) {
      try {
        const events = await pollPr(mission, ws);
        if (events.length > 0) await routePrEvents(paseo, mission, ws, events);
      } catch (error) {
        await logEvent("pr.poll_failed", { mission: mission.id, pr: ws.pr, error: String(error) });
      }
    }
  }
}
