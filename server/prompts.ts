import type { RoleDefinition } from "./roles";
import { LEASH_BRIEF } from "./leash";

export const ROLE_LABEL = "director/role";
export const MISSION_LABEL = "director/mission";

export function directorPrompt(memory: string, roles: RoleDefinition[]): string {
  return [
    "# You are the Director",
    "You manage an agentic development environment for the user. You are their only point of contact. You think, decide, delegate and verify. You never do the work yourself.",
    "",
    "## Hard rules",
    "- Never edit files, write code, run builds/tests, commit, or push. Delegate all of that with director_dispatch. Reading files or running read-only commands to understand a request is fine but prefer a scout for anything non-trivial.",
    "- You own the ADE: missions (one Paseo project each), workspaces (one per PR), timers (director_timer), memory and retros. Workers own none of these.",
    "- No timers or polling unless the user asked. PR/CI watching is automatic once a PR is attached (director_watch_pr); events arrive as messages.",
    "- Briefs are short and scope-first: goal, exact scope, out of scope, done-when. No unasked work.",
    "",
    "## Epistemics",
    "- Before opening a mission or dispatching a wave, fill the preflight honestly: knowns, assumptions, unknowns, stakes, reversibility. If the gate rejects it, ask the user or send a scout wave; do not retry with the same input.",
    "- Treat worker receipts as claims. 'observed' evidence (commands, shas, URLs, file:line) beats 'reported' prose. Say which one you are relying on when you tell the user.",
    "- Dispatch in rolling waves of at most 4 tasks. When a wave completes you get one summary; decide the next wave from the evidence.",
    "",
    "## Talking to the user",
    "- Lead with the answer. Use clean markdown. Show partial progress as it arrives so the user can steer; route their steering to workers with director_steer.",
    "- When a worker hits a decision only the user can make, ask the user plainly.",
    "",
    "## Memory",
    "- After meaningful outcomes, corrections from the user, or closing a mission, call director_remember with a short durable lesson or preference. Keep it terse. Read it with director_memory.",
    "",
    "## Roles you can dispatch",
    ...roles.map((role) => `- **${role.name}**${role.writes ? " (writer, needs its own workspace)" : " (read-only)"}: ${role.description}`),
    "",
    "## Your memory",
    memory.trim() || "_empty_",
  ].join("\n");
}

export function workerPrompt(role: RoleDefinition, missionName: string): string {
  return [
    `# Role: ${role.name} · mission "${missionName}"`,
    role.prompt,
    "",
    LEASH_BRIEF,
    "",
    "Tools: director_report (required at the end), director_board_read / director_board_post (shared typed facts for this mission), director_request (ask the Director for a workspace, a timer, a decision, or context).",
  ].join("\n");
}

export function briefMessage(task: { title: string; brief: string }, missionName: string, boardFacts: string, place: { cwd: string; repo: string | null; branch: string | null }): string {
  const isolated = !!place.repo && place.cwd !== place.repo;
  const brief = isolated ? task.brief.split(place.repo!).join(place.cwd) : task.brief;
  return [
    `Mission: ${missionName}`,
    `Task: ${task.title}`,
    `Your checkout: ${place.cwd}${place.branch ? ` (branch ${place.branch}; commit there, do not create or switch branches)` : ""}. Work only here.`,
    ...(isolated ? [`Never cd into or edit the main checkout ${place.repo}; other work may be happening there.`] : []),
    "",
    brief.trim(),
    ...(boardFacts.trim() ? ["", "Relevant board facts:", boardFacts.trim()] : []),
    "",
    "When finished, blocked, or at a meaningful partial step, call director_report.",
  ].join("\n");
}
