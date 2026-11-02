// Vocabulary for simulate → present → execute → verify.

export type Mode = "live" | "sandbox";

export interface Branch {
  name: string;
  sha: string;
  protected: boolean;
  isDefault: boolean;
  lastCommitAt: string;
  /** Commits on this branch that are not on the default branch. */
  aheadBy: number;
}

export interface PR {
  number: number;
  title: string;
  head: string;
  base: string;
  state: "open" | "closed";
  author: string;
}

export interface Charge {
  id: string;
  amount: number; // minor units (cents)
  amountRefunded: number;
  currency: string;
  email: string | null;
  description: string;
  disputed: boolean;
  created: string;
  fee: number; // processing fee in minor units, not returned on refund
}

/** The watched state. Verification compares expected vs actual on ALL of it, not just what we predicted. */
export interface Snapshot {
  takenAt: string;
  repo: string;
  defaultBranch: string;
  branches: Branch[];
  prs: PR[];
  charges: Charge[];
  balance: number; // available, minor units
  currency: string;
}

export type Intent =
  | { kind: "github.delete_branches"; olderThanDays: number; onlyMerged: boolean; namePattern?: string; summary: string }
  | { kind: "stripe.refund"; descriptionContains: string; percent: number; summary: string };

/** A single predicted change to one watched entity. */
export interface Effect {
  entity: string; // "branch:feature/x" | "pr:#12" | "charge:ch_1" | "email:a@b.c" | "balance" | "commits:feature/x"
  kind: "delete_ref" | "close_pr" | "refund" | "fee_lost" | "email" | "balance" | "unreachable_commits";
  before: string;
  after: string;
  severity: "info" | "warn" | "danger";
  side: boolean; // true = side effect (not the thing the user asked for)
  /** How this effect changes the watched snapshot, used to build the expected post-state. */
  patch?: { type: "ref"; name: string; sha: string | null } | { type: "pr"; number: number; state: "open" | "closed" } | { type: "charge"; id: string; amountRefunded: number };
}

export interface PlanItem {
  id: string;
  label: string;
  target: string;
  blocked: string | null;
  effects: Effect[];
  reversibility: "reversible" | "irreversible";
  rollback: string;
  /** State that must still hold at execute time; otherwise the item is skipped as drifted. */
  precondition: Record<string, string | number>;
  impacted: string[];
}

export interface Gate {
  status: "ready" | "needs_review" | "blocked";
  reasons: string[];
}

export interface Simulation {
  id: string;
  createdAt: string;
  mode: Mode;
  modelVersion: 1 | 2;
  intent: Intent;
  items: PlanItem[];
  totals: { selected: number; blocked: number; moneyOut: number; feesLost: number; sideEffects: number; people: number; balanceAfter: number; currency: string };
  gate: Gate;
  before: Snapshot;
  signature: string;
}

export interface Mismatch {
  entity: string;
  expected: string;
  actual: string;
}

export interface StepResult {
  itemId: string;
  label: string;
  status: "done" | "skipped_drift" | "failed" | "not_run";
  detail: string;
  mismatches: Mismatch[];
}

export interface ExecutionReport {
  simulationId: string;
  steps: StepResult[];
  safetyNet: { triggered: boolean; reason: string; actions: { action: string; ok: boolean; detail: string }[]; unmodeled: Mismatch[] };
  after: Snapshot;
}

export interface World {
  repo: string;
  defaultBranch: string;
  branches: Branch[];
  prs: PR[];
  charges: Charge[];
  balance: number;
  currency: string;
  /** Commit metadata of deleted refs, so a ref recreated at the same sha keeps its real commit date (as on GitHub). */
  graveyard?: Branch[];
}
