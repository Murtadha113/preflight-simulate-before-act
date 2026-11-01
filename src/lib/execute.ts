// Execute an approved simulation one item at a time. After every item, re-read the real state and
// compare it with what the simulation predicted. Any difference — wrong prediction OR an effect the
// simulator never modelled — trips the safety net: stop, roll back what can be rolled back, report.

import type { Provider } from "./providers";
import type { ExecutionReport, Mismatch, PlanItem, Simulation, Snapshot, StepResult } from "./types";

function expectedState(before: Snapshot, done: PlanItem[]) {
  const refs = new Map(before.branches.map((b) => [b.name, b.sha as string | null]));
  const prs = new Map(before.prs.map((p) => [p.number, { state: p.state, base: p.base }]));
  const charges = new Map(before.charges.map((c) => [c.id, c.amountRefunded]));
  for (const e of done.flatMap((i) => i.effects)) {
    if (e.patch?.type === "ref") refs.set(e.patch.name, e.patch.sha);
    if (e.patch?.type === "pr") prs.set(e.patch.number, { ...prs.get(e.patch.number)!, state: e.patch.state });
    if (e.patch?.type === "charge") charges.set(e.patch.id, e.patch.amountRefunded);
  }
  return { refs, prs, charges };
}

/** Compare the expected post-state with reality across ALL watched entities, not just the predicted ones. */
export function diff(before: Snapshot, done: PlanItem[], actual: Snapshot): Mismatch[] {
  const exp = expectedState(before, done);
  const out: Mismatch[] = [];
  const actualRefs = new Map(actual.branches.map((b) => [b.name, b.sha]));
  for (const [name, sha] of exp.refs) {
    const a = actualRefs.get(name) ?? null;
    if (a !== sha) out.push({ entity: `branch:${name}`, expected: sha ? sha.slice(0, 7) : "deleted", actual: a ? a.slice(0, 7) : "deleted" });
  }
  const actualPrs = new Map(actual.prs.map((p) => [p.number, p]));
  for (const [n, e] of exp.prs) {
    const a = actualPrs.get(n);
    if (!a) continue; // fell out of the "recent PRs" window
    if (a.state !== e.state) out.push({ entity: `pr:#${n}`, expected: e.state, actual: a.state });
    else if (a.base !== e.base) out.push({ entity: `pr:#${n}`, expected: `base ${e.base}`, actual: `base ${a.base}` });
  }
  const actualCharges = new Map(actual.charges.map((c) => [c.id, c.amountRefunded]));
  for (const [id, amt] of exp.charges) {
    const a = actualCharges.get(id);
    if (a !== undefined && a !== amt) out.push({ entity: `charge:${id}`, expected: `${amt} refunded`, actual: `${a} refunded` });
  }
  return out;
}

function drifted(item: PlanItem, now: Snapshot): string | null {
  if ("sha" in item.precondition) {
    const b = now.branches.find((x) => x.name === item.target);
    if (!b) return "branch no longer exists";
    if (b.sha !== item.precondition.sha) return `branch moved since simulation (${String(item.precondition.sha).slice(0, 7)} → ${b.sha.slice(0, 7)})`;
  }
  if ("amountRefunded" in item.precondition) {
    const c = now.charges.find((x) => x.id === item.target);
    if (!c) return "charge not found";
    if (c.amountRefunded !== item.precondition.amountRefunded) return `charge was refunded elsewhere since simulation`;
  }
  return null;
}

async function run(p: Provider, item: PlanItem, simId: string) {
  if (item.id.startsWith("branch:")) return p.deleteBranch(item.target);
  const e = item.effects.find((x) => x.patch?.type === "charge");
  if (e?.patch?.type !== "charge") throw new Error("no refund effect");
  const amount = e.patch.amountRefunded - Number(item.precondition.amountRefunded);
  return p.refund(item.target, amount, `preflight:${simId}:${item.target}`);
}

export async function executeSimulation(p: Provider, sim: Simulation, selected: string[]): Promise<ExecutionReport> {
  const plan = sim.items.filter((i) => selected.includes(i.id) && !i.blocked);
  const steps: StepResult[] = plan.map((i) => ({ itemId: i.id, label: i.label, status: "not_run", detail: "", mismatches: [] }));
  const done: PlanItem[] = [];
  let now = await p.snapshot();
  const safetyNet: ExecutionReport["safetyNet"] = { triggered: false, reason: "", actions: [], unmodeled: [] };

  for (let k = 0; k < plan.length; k++) {
    const item = plan[k];
    const drift = drifted(item, now);
    if (drift) {
      steps[k] = { ...steps[k], status: "skipped_drift", detail: `State changed since simulation: ${drift}. Re-simulate to include it.` };
      continue;
    }
    try {
      await run(p, item, sim.id);
    } catch (err) {
      steps[k] = { ...steps[k], status: "failed", detail: err instanceof Error ? err.message : String(err) };
      safetyNet.triggered = true;
      safetyNet.reason = `Step ${k + 1} failed although the simulation expected it to succeed.`;
      break;
    }
    done.push(item);
    await p.settle();
    now = await p.snapshot();
    const mismatches = diff(sim.before, done, now);
    const predicted = new Set(done.flatMap((i) => i.effects.map((e) => e.entity)));
    steps[k] = { ...steps[k], status: "done", detail: mismatches.length ? "Reality diverged from the simulation" : "Verified: reality matches prediction", mismatches };
    if (mismatches.length) {
      safetyNet.triggered = true;
      safetyNet.unmodeled = mismatches.filter((m) => !predicted.has(m.entity));
      safetyNet.reason = safetyNet.unmodeled.length
        ? `Unpredicted side effect after step ${k + 1}: ${safetyNet.unmodeled.map((m) => `${m.entity} ${m.expected} → ${m.actual}`).join("; ")}`
        : `Prediction was wrong after step ${k + 1}: ${mismatches.map((m) => m.entity).join(", ")}`;
      break;
    }
  }

  if (safetyNet.triggered) {
    // 1) halt: remaining steps stay not_run. 2) roll back everything reversible, in dependency order.
    const deleted = done.filter((i) => i.id.startsWith("branch:"));
    for (const i of deleted) {
      try {
        await p.createRef(i.target, String(i.precondition.sha));
        safetyNet.actions.push({ action: `Recreate branch ${i.target} @ ${String(i.precondition.sha).slice(0, 7)}`, ok: true, detail: "" });
      } catch (err) {
        safetyNet.actions.push({ action: `Recreate branch ${i.target}`, ok: false, detail: err instanceof Error ? err.message : String(err) });
      }
    }
    if (deleted.length) {
      await p.settle();
      const mid = await p.snapshot();
      for (const before of sim.before.prs.filter((x) => x.state === "open")) {
        const cur = mid.prs.find((x) => x.number === before.number);
        if (!cur) continue;
        try {
          if (cur.base !== before.base) {
            await p.setPRBase(before.number, before.base);
            safetyNet.actions.push({ action: `Restore PR #${before.number} base → ${before.base}`, ok: true, detail: "" });
          }
          if (cur.state === "closed") {
            await p.reopenPR(before.number);
            safetyNet.actions.push({ action: `Reopen PR #${before.number} (${before.title})`, ok: true, detail: "" });
          }
        } catch (err) {
          safetyNet.actions.push({ action: `Restore PR #${before.number}`, ok: false, detail: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    const irreversible = done.filter((i) => i.reversibility === "irreversible");
    if (irreversible.length)
      safetyNet.actions.push({ action: `Halted batch after ${done.length} of ${plan.length} refunds`, ok: true, detail: "Refunds already issued cannot be reversed; the remaining ones were not sent." });
    await p.settle();
    now = await p.snapshot();
  }

  return { simulationId: sim.id, steps, safetyNet, after: now };
}
