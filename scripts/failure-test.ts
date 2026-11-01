// The deliberate failure test, end to end in the sandbox:
// v1 simulator under-predicts a side effect → per-step verification catches it → safety net rolls back.
// Then v2 (with the learned effect) predicts it, and the reviewer can see it before approving.
import { executeSimulation } from "../src/lib/execute";
import { PRESETS } from "../src/lib/intent";
import { SandboxProvider } from "../src/lib/providers";
import { seedWorld } from "../src/lib/sandbox";
import { sign, simulate, summarize } from "../src/lib/simulate";

async function main() {
  let ok = true;
  const check = (cond: boolean, msg: string) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); ok &&= cond; };

  // 1. Stale branch cleanup with the v1 model
  const p = new SandboxProvider(seedWorld());
  const sim = simulate(PRESETS[0].intent, await p.snapshot(), "sandbox", 1);
  sim.signature = sign(sim);
  const sel = sim.items.filter((i) => !i.blocked).map((i) => i.id);
  console.log("v1 plan:", sim.items.map((i) => `${i.target}${i.blocked ? " (blocked)" : ""} [${i.effects.map((e) => e.entity).join(", ")}]`).join(" | "));
  const r = await executeSimulation(p, sim, sel);
  for (const s of r.steps) console.log(`   ${s.status.padEnd(13)} ${s.label} — ${s.detail}`);
  console.log("   safety net:", r.safetyNet.reason);
  for (const a of r.safetyNet.actions) console.log(`     ${a.ok ? "✓" : "✗"} ${a.action} ${a.detail}`);
  check(r.safetyNet.triggered, "v1: verification catches the unpredicted stacked-PR closure");
  check(r.safetyNet.unmodeled.some((m) => m.entity === "pr:#44"), "v1: PR #44 flagged as unmodeled side effect");
  const after = r.after;
  check(after.prs.every((x) => x.state === "open"), "v1: rollback reopened every PR");
  check(seedWorld().branches.every((b) => after.branches.some((a) => a.name === b.name && a.sha === b.sha)), "v1: rollback restored every branch at its original sha");

  // 2. Same intent with the v2 model: the stacked PR is predicted up front
  const sim2 = simulate(PRESETS[0].intent, await new SandboxProvider(seedWorld()).snapshot(), "sandbox", 2);
  check(sim2.items.some((i) => i.effects.some((e) => e.entity === "pr:#44")), "v2: simulation predicts PR #44 closure before execution");
  check(summarize(sim2, sim2.items.map((i) => i.id)).gate.status === "needs_review", "v2: gate asks for review because of danger side effects");

  // 3. Refunds: simulation blocks a batch that would overdraw the balance; narrowing unblocks it
  const p3 = new SandboxProvider(seedWorld());
  const sim3 = simulate(PRESETS[2].intent, await p3.snapshot(), "sandbox", 1);
  check(sim3.items.filter((i) => i.blocked).length === 2, "refunds: disputed + already-refunded charges excluded automatically");
  check(sim3.gate.status === "blocked", `refunds: full batch blocked (${sim3.gate.reasons[0]})`);
  const narrowed = sim3.items.filter((i) => !i.blocked).slice(0, 4).map((i) => i.id);
  check(summarize(sim3, narrowed).gate.status === "needs_review", "refunds: deselecting one charge makes it executable (irreversible → review)");
  sim3.signature = sign(sim3);
  const r3 = await executeSimulation(p3, sim3, narrowed);
  check(r3.steps.every((s) => s.status === "done") && !r3.safetyNet.triggered, "refunds: 4 refunds executed and verified against prediction");

  console.log(ok ? "\nAll checks passed" : "\nSome checks FAILED");
  process.exit(ok ? 0 : 1);
}
main();
