import { z } from "zod";

export const preflightSchema = z.object({
  goal: z.string().min(1).describe("One sentence: the outcome the user wants."),
  knowns: z.array(z.string()).describe("Facts you have observed or the user stated."),
  assumptions: z.array(z.string()).describe("Things you are taking as true without evidence."),
  unknowns: z.array(z.string()).describe("Open questions that could change the plan."),
  stakes: z.enum(["low", "medium", "high"]).describe("Cost of getting it wrong."),
  reversible: z.boolean().describe("Can the work be thrown away cheaply (branch, worktree)?"),
  userConfirmed: z.boolean().default(false).describe("True only if the user explicitly approved this plan in the conversation."),
});

export type Preflight = z.output<typeof preflightSchema>;

export interface PreflightVerdict {
  pass: boolean;
  reason: string;
}

export function gate(preflight: Preflight, taskCount: number, maxWave = 4, readOnly = false): PreflightVerdict {
  if (taskCount > maxWave) return { pass: false, reason: `Waves are capped at ${maxWave} tasks. Split the work into rolling waves.` };
  if (preflight.userConfirmed) return { pass: true, reason: "user confirmed" };
  if (readOnly && taskCount > 0) return { pass: true, reason: "read-only wave" };
  if (preflight.stakes === "high" && !preflight.reversible) {
    return { pass: false, reason: "High stakes and irreversible: confirm the plan with the user first, then retry with userConfirmed=true." };
  }
  if (preflight.stakes !== "low" && preflight.unknowns.length > 0) {
    return {
      pass: false,
      reason: `Resolve or explicitly accept these unknowns with the user first: ${preflight.unknowns.join("; ")}. Or dispatch a read-only scout wave to answer them first.`,
    };
  }
  if (preflight.assumptions.length > 3 && preflight.stakes === "high") {
    return { pass: false, reason: "Too many untested assumptions for high stakes. Verify some with a scout first." };
  }
  return { pass: true, reason: "ok" };
}
