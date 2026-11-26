import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { postFact, readFacts } from "../server/board";
import { readState, resetStateCache, updateState } from "../server/store";
import { acceptReceipt, activeWriter } from "../server/swarm";

beforeEach(() => {
  process.env.DIRECTOR_DATA_DIR = mkdtempSync(join(tmpdir(), "director-"));
  resetStateCache();
});

const worker = (agentId: string, role = "scout") => ({
  agentId,
  missionId: "msn_a",
  workspaceId: "w0",
  role,
  title: agentId,
  waveId: "wave_1",
  provider: "claude",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastReceipt: null,
  leashStrikes: 0,
});

describe("state", () => {
  it("serializes concurrent updates", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => updateState((s) => void s.timers.push({ id: String(i), fireAt: "", note: "" }))));
    resetStateCache();
    expect((await readState()).timers).toHaveLength(20);
  });

  it("summarizes a wave once every worker reported", async () => {
    await updateState((s) => {
      s.workers.push(worker("a1"), worker("a2"));
      s.waves.push({ id: "wave_1", missionId: "msn_a", agentIds: ["a1", "a2"], createdAt: "2026-01-01T00:00:00.000Z", reported: false });
    });
    const first = await acceptReceipt("a1", { status: "done", summary: "found it", evidence: ["src/x.ts:12"] });
    expect(first.waveSummary).toBeNull();
    const second = await acceptReceipt("a2", { status: "blocked", summary: "need creds", evidence: [] });
    expect(second.waveSummary).toContain("Wave wave_1 complete");
    expect(second.waveSummary).toContain("found it");
    await expect(acceptReceipt("stranger", { status: "done", summary: "x", evidence: [] })).rejects.toThrow();
  });

  it("knows when a checkout already has a writer", () => {
    const writers = new Set(["builder"]);
    expect(activeWriter([worker("b1", "builder")], "w0", writers)?.agentId).toBe("b1");
    expect(activeWriter([{ ...worker("b1", "builder"), lastReceipt: { status: "done", summary: "", evidence: [], at: "" } }], "w0", writers)).toBeUndefined();
    expect(activeWriter([worker("s1")], "w0", writers)).toBeUndefined();
  });

  it("keeps the latest fact per key", async () => {
    await postFact("a", { kind: "decision", key: "db", value: "postgres", evidence: [] }, "x");
    await postFact("a", { kind: "decision", key: "db", value: "sqlite", evidence: ["ADR-3"] }, "y");
    const facts = await readFacts("a");
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ value: "sqlite", basis: "observed" });
  });
});
