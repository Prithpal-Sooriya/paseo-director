export interface PrCheck {
  name: string;
  state: "pending" | "success" | "failure" | "skipped";
  url: string | null;
}

export interface PrSnapshot {
  number: number;
  state: string;
  headSha: string;
  checks: PrCheck[];
  commentIds: string[];
  reviewIds: string[];
  comments: { id: string; author: string; body: string; path?: string }[];
}

export type PrEvent =
  | { kind: "check_failed"; check: PrCheck; lintLike: boolean }
  | { kind: "checks_green" }
  | { kind: "new_feedback"; items: { author: string; body: string; path?: string }[] }
  | { kind: "state"; state: string };

const LINT = /lint|eslint|prettier|format|stylelint|tsc|typecheck|type-check|types|ruff|black|clippy|fmt/i;

export function checkState(raw: { status?: string; conclusion?: string; state?: string }): PrCheck["state"] {
  const value = (raw.conclusion || raw.state || raw.status || "").toUpperCase();
  if (["SUCCESS", "NEUTRAL"].includes(value)) return "success";
  if (["SKIPPED", "CANCELLED", "STALE"].includes(value)) return "skipped";
  if (["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(value)) return "failure";
  return "pending";
}

export function parseGhPr(json: string): PrSnapshot {
  const raw = JSON.parse(json) as {
    number: number;
    state: string;
    headRefOid: string;
    statusCheckRollup?: { name?: string; context?: string; status?: string; conclusion?: string; state?: string; detailsUrl?: string; targetUrl?: string }[];
    comments?: { id?: string; url?: string; author?: { login?: string }; body?: string }[];
    reviews?: { id?: string; author?: { login?: string }; body?: string; state?: string }[];
  };
  const checks = (raw.statusCheckRollup ?? []).map((check) => ({
    name: check.name ?? check.context ?? "check",
    state: checkState(check),
    url: check.detailsUrl ?? check.targetUrl ?? null,
  }));
  const comments = (raw.comments ?? []).map((comment, index) => ({
    id: comment.id ?? comment.url ?? `c${index}`,
    author: comment.author?.login ?? "unknown",
    body: comment.body ?? "",
  }));
  const reviews = (raw.reviews ?? []).filter((review) => (review.body ?? "").trim() !== "" || review.state === "CHANGES_REQUESTED").map((review, index) => ({
    id: review.id ?? `r${index}`,
    author: review.author?.login ?? "unknown",
    body: `[${review.state ?? "REVIEW"}] ${review.body ?? ""}`.trim(),
  }));
  return {
    number: raw.number,
    state: raw.state,
    headSha: raw.headRefOid,
    checks,
    commentIds: comments.map((item) => item.id),
    reviewIds: reviews.map((item) => item.id),
    comments: [...comments, ...reviews],
  };
}

export function diffPr(previous: PrSnapshot | null, next: PrSnapshot, selfLogins: string[] = []): PrEvent[] {
  const events: PrEvent[] = [];
  if (previous && previous.state !== next.state) events.push({ kind: "state", state: next.state });
  const sameHead = previous?.headSha === next.headSha;
  const prevFailed = new Set(sameHead ? previous!.checks.filter((c) => c.state === "failure").map((c) => c.name) : []);
  const newlyFailed = next.checks.filter((check) => check.state === "failure" && !prevFailed.has(check.name));
  if (newlyFailed.length > 0) {
    const first = newlyFailed.find((check) => LINT.test(check.name)) ?? newlyFailed[0]!;
    events.push({ kind: "check_failed", check: first, lintLike: LINT.test(first.name) });
  }
  const allGreen = next.checks.length > 0 && next.checks.every((check) => check.state === "success" || check.state === "skipped");
  const wasGreen = !!previous && sameHead && previous.checks.length > 0 && previous.checks.every((c) => c.state === "success" || c.state === "skipped");
  if (allGreen && !wasGreen) events.push({ kind: "checks_green" });
  const seen = new Set([...(previous?.commentIds ?? []), ...(previous?.reviewIds ?? [])]);
  const self = new Set(selfLogins.map((login) => login.toLowerCase()));
  const fresh = previous
    ? next.comments.filter((item) => !seen.has(item.id) && !self.has(item.author.toLowerCase()) && !/\[bot\]$/.test(item.author) )
    : [];
  if (fresh.length > 0) events.push({ kind: "new_feedback", items: fresh.map(({ author, body, path }) => ({ author, body, path })) });
  return events;
}
