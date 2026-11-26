import { z } from "zod";
import type { Mission, Receipt, WorkerRecord } from "./store";
import { clip } from "./names";

export const receiptSchema = z.object({
  status: z.enum(["done", "blocked", "partial", "failed"]),
  summary: z.string().min(1).describe("What you did or found, in 1-4 sentences."),
  evidence: z.array(z.string()).default([]).describe("Verifiable pointers: commands run with results, file:line, commit shas, PR URLs."),
  next: z.string().optional().describe("Follow-up work you noticed but did not do, or what you need to continue."),
  pr: z.number().int().positive().optional().describe("PR number if you opened or updated one."),
});

export type ReceiptInput = z.output<typeof receiptSchema>;

export function toReceipt(input: ReceiptInput, at = new Date().toISOString()): Receipt {
  return { status: input.status, summary: input.summary, evidence: input.evidence, next: input.next, at };
}

export function evidenceStrength(receipt: Receipt): "observed" | "reported" {
  return receipt.evidence.some((item) => /\b(exit 0|passed|pass|✓|https?:\/\/|[0-9a-f]{7,40}|:\d+)\b/i.test(item)) ? "observed" : "reported";
}

const ICON: Record<Receipt["status"], string> = { done: "✅", blocked: "⛔", partial: "🟡", failed: "❌" };

export function receiptLine(worker: WorkerRecord, receipt: Receipt): string {
  const tail = receipt.next ? ` Next: ${clip(receipt.next, 160)}` : "";
  return `${ICON[receipt.status]} **${worker.title}** (${worker.role}, \`${worker.agentId.slice(0, 8)}\`): ${clip(receipt.summary, 400)}${tail}`;
}

export function renderBoard(missions: Mission[], workers: WorkerRecord[]): string {
  const active = missions.filter((mission) => mission.status === "active");
  if (active.length === 0) return "_No active missions._";
  const sections = active.map((mission) => {
    const lines = [`### ${mission.name}`, `project \`${mission.projectId}\`${mission.repo ? ` · repo \`${mission.repo}\`` : ""}`];
    for (const ws of mission.workspaces.filter((item) => !item.archived)) {
      const pr = ws.pr ? ` · PR #${ws.pr}` : "";
      lines.push(`- **${ws.label}**${ws.primary ? " (primary)" : ""}${ws.branch ? ` \`${ws.branch}\`` : ""}${pr}`);
      for (const worker of workers.filter((item) => item.workspaceId === ws.workspaceId)) {
        const receipt = worker.lastReceipt;
        const state = receipt ? `${ICON[receipt.status]} ${clip(receipt.summary, 120)}` : "⏳ working";
        lines.push(`  - ${worker.role} · ${worker.title} · \`${worker.agentId.slice(0, 8)}\` · ${state}`);
      }
    }
    return lines.join("\n");
  });
  return sections.join("\n\n");
}
