// The simulator: reads REAL current state and predicts, per item, every change to the watched state.
// It is deliberately a model of the platform, and models can be incomplete; verification exists for that.

import { createHmac, randomUUID } from "node:crypto";
import { money, summarize } from "./summary";
import type { Effect, Intent, Mode, PlanItem, Simulation, Snapshot } from "./types";

export { summarize };

const daysSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000;

/**
 * Model versions:
 * v1 — ships with a known blind spot: it predicts that deleting a branch closes PRs whose HEAD is that branch,
 *      but not PRs that are stacked on it (whose BASE is that branch).
 * v2 — learned from a verification mismatch; models base-branch PR closure too.
 */
function branchItems(intent: Extract<Intent, { kind: "github.delete_branches" }>, s: Snapshot, modelVersion: 1 | 2): PlanItem[] {
  const re = intent.namePattern ? new RegExp(intent.namePattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")) : null;
  return s.branches
    .filter((b) => !b.isDefault && daysSince(b.lastCommitAt) >= intent.olderThanDays && (!intent.onlyMerged || b.aheadBy === 0) && (!re || re.test(b.name)))
    .map((b) => {
      const effects: Effect[] = [
        { entity: `branch:${b.name}`, kind: "delete_ref", before: b.sha.slice(0, 7), after: "deleted", severity: "warn", side: false, patch: { type: "ref", name: b.name, sha: null } },
      ];
      const impacted = new Set<string>();
      for (const p of s.prs.filter((p) => p.state === "open" && p.head === b.name)) {
        effects.push({ entity: `pr:#${p.number}`, kind: "close_pr", before: `open — ${p.title}`, after: "closed (head branch deleted)", severity: "warn", side: true, patch: { type: "pr", number: p.number, state: "closed" } });
        impacted.add(`@${p.author}`);
      }
      if (modelVersion >= 2) {
        for (const p of s.prs.filter((p) => p.state === "open" && p.base === b.name)) {
          effects.push({ entity: `pr:#${p.number}`, kind: "close_pr", before: `open — ${p.title}`, after: "closed (base branch deleted)", severity: "danger", side: true, patch: { type: "pr", number: p.number, state: "closed" } });
          impacted.add(`@${p.author}`);
        }
      }
      if (b.aheadBy > 0)
        effects.push({ entity: `commits:${b.name}`, kind: "unreachable_commits", before: `${b.aheadBy} unmerged commit(s)`, after: "unreachable (recoverable by sha ~90 days)", severity: "danger", side: true });
      return {
        id: `branch:${b.name}`,
        label: `Delete ${b.name}`,
        target: b.name,
        blocked: b.protected ? "Branch is protected — GitHub will reject the delete" : null,
        effects,
        reversibility: "reversible" as const,
        rollback: `Recreate refs/heads/${b.name} at ${b.sha.slice(0, 7)}, then reopen affected PRs`,
        precondition: { sha: b.sha },
        impacted: [...impacted],
      };
    });
}

function refundItems(intent: Extract<Intent, { kind: "stripe.refund" }>, s: Snapshot): PlanItem[] {
  const needle = intent.descriptionContains.toLowerCase();
  return s.charges
    .filter((c) => c.description.toLowerCase().includes(needle))
    .map((c) => {
      const refundable = c.amount - c.amountRefunded;
      const amt = Math.min(refundable, Math.round((c.amount * intent.percent) / 100));
      const blocked = c.disputed ? "Charge is under dispute — Stripe rejects refunds until it's resolved" : refundable <= 0 ? "Already fully refunded" : null;
      const effects: Effect[] = blocked
        ? []
        : [
            { entity: `charge:${c.id}`, kind: "refund", before: `${money(c.amountRefunded, c.currency)} refunded`, after: `${money(c.amountRefunded + amt, c.currency)} refunded`, severity: "danger", side: false, patch: { type: "charge", id: c.id, amountRefunded: c.amountRefunded + amt } },
            { entity: `fee:${c.id}`, kind: "fee_lost", before: `fee ${money(c.fee, c.currency)}`, after: "not returned by Stripe", severity: "info", side: true },
            ...(c.email ? [{ entity: `email:${c.email}`, kind: "email" as const, before: "—", after: "refund receipt email sent", severity: "info" as const, side: true }] : []),
          ];
      return {
        id: `charge:${c.id}`,
        label: `Refund ${money(amt, c.currency)} to ${c.email ?? c.id}`,
        target: c.id,
        blocked,
        effects,
        reversibility: "irreversible" as const,
        rollback: "None. Money leaves the account; the only compensation is a new charge with the customer's consent.",
        precondition: { amountRefunded: c.amountRefunded },
        impacted: c.email ? [c.email] : [],
      };
    });
}

export function simulate(intent: Intent, before: Snapshot, mode: Mode, modelVersion: 1 | 2): Simulation {
  const items = intent.kind === "github.delete_branches" ? branchItems(intent, before, modelVersion) : refundItems(intent, before);
  return summarize({ id: randomUUID(), createdAt: new Date().toISOString(), mode, modelVersion, intent, items, before }, items.filter((i) => !i.blocked).map((i) => i.id));
}

// ------------------------------------------------------------------ approval binding

const secret = () => process.env.SIM_SECRET || "preflight-dev-secret-change-me";

/** Binds an approval to exactly the effects that were previewed. Any edit to items/effects invalidates it. */
export function sign(sim: Simulation): string {
  const body = JSON.stringify({ id: sim.id, mode: sim.mode, intent: sim.intent, items: sim.items.map((i) => [i.id, i.blocked, i.precondition, i.effects.map((e) => [e.entity, e.after])]) });
  return createHmac("sha256", secret()).update(body).digest("hex");
}

export function verifySignature(sim: Simulation): boolean {
  return sign(sim) === sim.signature;
}
