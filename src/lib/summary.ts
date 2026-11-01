// Pure (browser-safe) totals and gate, recomputed live as the reviewer tweaks the selection.

import type { Gate, Simulation } from "./types";

export const money = (n: number, cur = "usd") => `${n < 0 ? "−" : ""}${cur === "usd" ? "$" : ""}${(Math.abs(n) / 100).toFixed(2)}${cur === "usd" ? "" : " " + cur.toUpperCase()}`;

/** Totals + gate for a given selection. Recomputed client-side when the user tweaks the selection. */
export function summarize(sim: Omit<Simulation, "totals" | "gate" | "signature"> & Partial<Pick<Simulation, "signature">>, selected: string[]): Simulation {
  const chosen = sim.items.filter((i) => selected.includes(i.id) && !i.blocked);
  const effects = chosen.flatMap((i) => i.effects);
  const moneyOut = effects.reduce((s, e) => (e.patch?.type === "charge" ? s + (e.patch.amountRefunded - (sim.before.charges.find((c) => c.id === (e.patch as { id: string }).id)?.amountRefunded ?? 0)) : s), 0);
  const feesLost = chosen.reduce((s, i) => s + (i.effects.some((e) => e.kind === "fee_lost") ? (sim.before.charges.find((c) => c.id === i.target)?.fee ?? 0) : 0), 0);
  const balanceAfter = sim.before.balance - moneyOut;
  const people = new Set(chosen.flatMap((i) => i.impacted)).size;

  const reasons: string[] = [];
  let status: Gate["status"] = "ready";
  if (chosen.length === 0) {
    status = "blocked";
    reasons.push("Nothing selected that can be executed");
  }
  if (balanceAfter < 0) {
    status = "blocked";
    reasons.push(`Available balance would go to ${money(balanceAfter, sim.before.currency)} — Stripe would debit the bank account and may pause payouts. Deselect items or lower the refund %.`);
  }
  const danger = effects.filter((e) => e.severity === "danger" && e.side);
  if (status !== "blocked" && danger.length > 0) {
    status = "needs_review";
    reasons.push(`${danger.length} high-severity side effect(s): ${danger.map((d) => d.entity).join(", ")}`);
  }
  if (status !== "blocked" && chosen.some((i) => i.reversibility === "irreversible")) {
    status = status === "ready" ? "needs_review" : status;
    reasons.push(`${chosen.filter((i) => i.reversibility === "irreversible").length} irreversible action(s), no rollback path`);
  }
  const blockedItems = sim.items.filter((i) => i.blocked);
  if (blockedItems.length) reasons.push(`${blockedItems.length} item(s) excluded automatically by the simulation`);

  return {
    ...sim,
    totals: { selected: chosen.length, blocked: blockedItems.length, moneyOut, feesLost, sideEffects: effects.filter((e) => e.side).length, people, balanceAfter, currency: sim.before.currency },
    gate: { status, reasons },
    signature: sim.signature ?? "",
  };
}
