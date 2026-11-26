import { describe, expect, it } from "vitest";
import { auditItems, judgeCall } from "../server/audit";
import { judgeCommand, judgeTool } from "../server/leash";
import { applySync, onProjectRemoved, onProjectSeen, onWorkspaceArchived, onWorkspaceSeen } from "../server/missions";
import { branchName, clip, slugify, uniqueSlug } from "../server/names";
import { diffPr, parseGhPr, type PrSnapshot } from "../server/pr-diff";
import { gate, type Preflight } from "../server/preflight";
import { evidenceStrength, toReceipt } from "../server/receipts";
import { parseRoleFile } from "../server/roles";
import { dueTimers, parseDelay } from "../server/timers";
import type { Mission } from "../server/store";

describe("names", () => {
  it("slugifies readable names", () => {
    expect(slugify("ASSETS-4402 RWA perps: Long/Short!")).toBe("assets-4402-rwa-perps-long-short");
    expect(slugify("***")).toBe("mission");
    expect(uniqueSlug("a", ["a", "a-2"])).toBe("a-3");
    expect(branchName("m", "Fix the Thing")).toBe("director/m/fix-the-thing");
    expect(clip("abcdef", 4)).toBe("abc…");
  });
});

describe("leash", () => {
  it.each([
    ["sleep 30 && gh pr checks", "sleep"],
    ["while true; do gh pr view; done", "loop"],
    ["gh run watch 123", "watch"],
    ["gh pr checks 5 --watch", "watch"],
    ["paseo schedule create 'x' --every 5m", "schedule"],
    ["paseo run --provider claude 'do it'", "spawn"],
    ["gh pr merge 12 --squash", "merge"],
    ["git push --force origin HEAD", "force-push"],
  ])("blocks %s", (command, rule) => {
    expect(judgeCommand(command)).toMatchObject({ allowed: false, rule });
  });

  it.each(["npm test", "sleep 1", "git push origin HEAD", "gh run view 1 --log-failed", "gh pr view 5 --json state"])("allows %s", (command) => {
    expect(judgeCommand(command).allowed).toBe(true);
  });

  it("judges tool names", () => {
    expect(judgeTool("create_schedule").allowed).toBe(false);
    expect(judgeTool("mcp__paseo__create_agent").allowed).toBe(false);
    expect(judgeTool("director_report").allowed).toBe(true);
    expect(judgeTool("Read").allowed).toBe(true);
  });

  it("audits timeline tool calls once per callId", () => {
    const call = (callId: string, command: string) => ({ type: "tool_call", callId, name: "Bash", status: "completed", detail: { type: "shell", command } }) as never;
    const violations = auditItems([call("1", "npm test"), call("2", "sleep 60"), call("2", "sleep 60")]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.verdict.rule).toBe("sleep");
    expect(judgeCall("Bash", { command: "watch -n 5 ls" }).allowed).toBe(false);
  });
});

describe("preflight gate", () => {
  const base: Preflight = { goal: "g", knowns: [], assumptions: [], unknowns: [], stakes: "low", reversible: true, userConfirmed: false };
  it("caps wave size even when confirmed", () => {
    expect(gate({ ...base, userConfirmed: true }, 5).pass).toBe(false);
  });
  it("blocks high-stakes irreversible work until confirmed", () => {
    expect(gate({ ...base, stakes: "high", reversible: false }, 1).pass).toBe(false);
    expect(gate({ ...base, stakes: "high", reversible: false, userConfirmed: true }, 1).pass).toBe(true);
  });
  it("blocks unknowns for writers but lets scouts resolve them", () => {
    const unsure = { ...base, stakes: "medium" as const, unknowns: ["which API?"] };
    expect(gate(unsure, 2).pass).toBe(false);
    expect(gate(unsure, 2, 4, true).pass).toBe(true);
  });
});

describe("receipts", () => {
  it("grades evidence", () => {
    expect(evidenceStrength(toReceipt({ status: "done", summary: "s", evidence: ["npm test: 12 passed"] }))).toBe("observed");
    expect(evidenceStrength(toReceipt({ status: "done", summary: "s", evidence: ["I think it works"] }))).toBe("reported");
  });
});

describe("pr diff", () => {
  const snap = (over: Partial<PrSnapshot>): PrSnapshot => ({ number: 1, state: "OPEN", headSha: "a", checks: [], commentIds: [], reviewIds: [], comments: [], ...over });
  it("parses gh json", () => {
    const parsed = parseGhPr(
      JSON.stringify({
        number: 7,
        state: "OPEN",
        headRefOid: "abc",
        statusCheckRollup: [
          { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "u" },
          { __typename: "StatusContext", context: "ci/x", state: "PENDING" },
        ],
        comments: [{ id: "c1", author: { login: "bob" }, body: "nit" }],
        reviews: [],
      }),
    );
    expect(parsed.checks.map((c) => [c.name, c.state])).toEqual([["lint", "failure"], ["ci/x", "pending"]]);
    expect(parsed.commentIds).toEqual(["c1"]);
  });
  it("routes the first failure, lint first, without waiting for pending checks", () => {
    const next = snap({ checks: [{ name: "unit", state: "failure", url: null }, { name: "eslint", state: "failure", url: null }, { name: "e2e", state: "pending", url: null }] });
    expect(diffPr(snap({}), next)[0]).toMatchObject({ kind: "check_failed", lintLike: true, check: { name: "eslint" } });
  });
  it("does not repeat a failure on the same head but does after a new push", () => {
    const failing = snap({ checks: [{ name: "unit", state: "failure", url: null }] });
    expect(diffPr(failing, failing)).toEqual([]);
    expect(diffPr(failing, { ...failing, headSha: "b" })[0]).toMatchObject({ kind: "check_failed" });
  });
  it("reports new human feedback, not bots or self", () => {
    const next = snap({ comments: [{ id: "1", author: "alice", body: "please rename" }, { id: "2", author: "codecov[bot]", body: "cov" }, { id: "3", author: "me", body: "done" }] });
    const events = diffPr(snap({}), next, ["me"]);
    expect(events).toEqual([{ kind: "new_feedback", items: [{ author: "alice", body: "please rename", path: undefined }] }]);
  });
  it("announces green once", () => {
    const green = snap({ checks: [{ name: "unit", state: "success", url: null }] });
    expect(diffPr(snap({ checks: [{ name: "unit", state: "pending", url: null }] }), green)).toEqual([{ kind: "checks_green" }]);
    expect(diffPr(green, green)).toEqual([]);
  });
});

describe("mission sync", () => {
  const mission: Mission = {
    id: "msn_a",
    slug: "a",
    name: "Alpha",
    projectId: "prj_1",
    dir: "/tmp/a",
    repo: "/repo",
    createdAt: "",
    status: "active",
    workspaces: [
      { workspaceId: "w0", label: "Alpha", branch: null, cwd: "/repo", primary: true, pr: null, archived: false },
      { workspaceId: "w1", label: "fix", branch: "director/a/fix", cwd: "/wt", primary: false, pr: 12, archived: false },
    ],
  };
  it("renames from the workspace title or the project name", () => {
    expect(onWorkspaceSeen([mission], { id: "w0", title: "Beta", name: "x" })).toMatchObject({ kind: "rename", name: "Beta", origin: "workspace" });
    expect(onWorkspaceSeen([mission], { id: "w1", title: "Other", name: "x" })).toEqual({ kind: "none" });
    expect(onProjectSeen([mission], { projectId: "prj_1", projectCustomName: "Gamma", projectDisplayName: "a" })).toMatchObject({ kind: "rename", name: "Gamma" });
    expect(onProjectSeen([mission], { projectId: "prj_1", projectCustomName: null, projectDisplayName: "Alpha" })).toEqual({ kind: "none" });
  });
  it("tears down on primary archive, project removal, or last PR workspace", () => {
    expect(onWorkspaceArchived([mission], "w0", true)).toMatchObject({ kind: "close" });
    expect(onProjectRemoved([mission], "prj_1")).toMatchObject({ kind: "close" });
    expect(onWorkspaceArchived([mission], "w1", true)).toMatchObject({ kind: "close", reason: "last PR workspace archived" });
    expect(onWorkspaceArchived([mission], "w1", false)).toMatchObject({ kind: "workspace_archived" });
  });
  it("ignores unrelated ids", async () => {
    expect(onWorkspaceArchived([mission], "nope", true)).toEqual({ kind: "none" });
    await applySync(null, { kind: "none" });
  });
});

describe("roles and timers", () => {
  it("parses custom role files", () => {
    const role = parseRoleFile("qa.md", "---\nname: qa\ndescription: Runs the app\nwrites: false\nprovider: claude/sonnet\n---\nYou are QA.");
    expect(role).toMatchObject({ name: "qa", writes: false, provider: "claude/sonnet", prompt: "You are QA." });
    expect(parseRoleFile("director.md", "x")).toBeNull();
  });
  it("parses delays and finds due timers", () => {
    expect(parseDelay("20m")).toBe(1_200_000);
    expect(() => parseDelay("soon")).toThrow();
    expect(dueTimers([{ id: "a", fireAt: new Date(0).toISOString(), note: "" }, { id: "b", fireAt: new Date(10_000).toISOString(), note: "" }], 5_000).map((t) => t.id)).toEqual(["a"]);
  });
});

describe("checkout isolation", async () => {
  const { escapesCheckout } = await import("../server/audit");
  it("flags commands aimed at the main checkout", () => {
    const own = "/home/.paseo/worktrees/x/m-fix";
    expect(escapesCheckout("cd /repo && git commit -m x", own, "/repo")).toBe(true);
    expect(escapesCheckout("git -C /repo/sub status", own, "/repo")).toBe(true);
    expect(escapesCheckout("cd /repo-other && ls", own, "/repo")).toBe(false);
    expect(escapesCheckout(`cd ${own} && npm test`, own, "/repo")).toBe(false);
    expect(escapesCheckout("cd /repo && ls", "/repo", "/repo")).toBe(false);
  });
});

describe("audit false positives", () => {
  it("never flags the plugin's own tools", () => {
    expect(judgeCall("director_report", { command: "sleep 30" }).allowed).toBe(true);
    expect(judgeCall("Codemode", undefined, { type: "shell", command: 'director_report --summary "refused sleep 8"' }).allowed).toBe(true);
  });
});
