"use client";

import { useEffect, useMemo, useState } from "react";
import { PRESETS } from "@/lib/presets";
import { money, summarize } from "@/lib/summary";
import type { Effect, ExecutionReport, Mode, PlanItem, Simulation, World } from "@/lib/types";
import { Architecture } from "./architecture";

type Phase = "intent" | "review" | "done";
const SEV = { info: "var(--color-info)", warn: "var(--color-warn)", danger: "var(--color-danger)" } as const;
const GATE = {
  ready: { c: "var(--color-ok)", t: "READY", d: "Every predicted effect is reversible and expected." },
  needs_review: { c: "var(--color-warn)", t: "NEEDS YOUR REVIEW", d: "The simulation found effects you should look at before approving." },
  blocked: { c: "var(--color-danger)", t: "BLOCKED BY SIMULATION", d: "This plan can't run as-is. Narrow it or change it." },
};

function load<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(k: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

export default function Home() {
  const [status, setStatus] = useState<{ live: boolean; repo: string | null; model: boolean } | null>(null);
  const [mode, setMode] = useState<Mode>("sandbox");
  const [text, setText] = useState(PRESETS[0].text);
  const [world, setWorld] = useState<World | null>(null);
  const [modelVersion, setModelVersion] = useState<1 | 2>(1);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [report, setReport] = useState<ExecutionReport | null>(null);
  const [phase, setPhase] = useState<Phase>("intent");
  const [busy, setBusy] = useState<"" | "simulating" | "executing">("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWorld(load<World | null>("preflight.world", null));
    setModelVersion(load<1 | 2>("preflight.model", 1));
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus({ live: false, repo: null, model: false }));
  }, []);

  const live = useMemo(() => (sim ? summarize(sim, selected) : null), [sim, selected]);

  async function doSimulate(intentText = text) {
    setBusy("simulating");
    setError(null);
    setReport(null);
    try {
      const preset = PRESETS.find((p) => p.text === intentText);
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: intentText, intent: preset?.intent, mode, world: world ?? undefined, modelVersion }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSim(data.simulation);
      setSelected((data.simulation as Simulation).items.filter((i) => !i.blocked).map((i) => i.id));
      if (data.world) {
        setWorld(data.world);
        save("preflight.world", data.world);
      }
      setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setBusy("");
    }
  }

  async function doExecute() {
    if (!sim) return;
    setBusy("executing");
    setError(null);
    try {
      const res = await fetch("/api/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ simulation: sim, selected, world: world ?? undefined }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setReport(data.report);
      if (data.world) {
        setWorld(data.world);
        save("preflight.world", data.world);
      }
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Execution failed");
    } finally {
      setBusy("");
    }
  }

  function reject() {
    setSim(null);
    setPhase("intent");
  }

  function resetSandbox() {
    setWorld(null);
    save("preflight.world", null);
    setModelVersion(1);
    save("preflight.model", 1);
    setSim(null);
    setReport(null);
    setPhase("intent");
  }

  function learn() {
    setModelVersion(2);
    save("preflight.model", 2);
  }

  const learnable = report?.safetyNet.unmodeled.some((m) => m.entity.startsWith("pr:")) && modelVersion === 1;

  return (
    <main className="mx-auto max-w-[1300px] px-4 pb-24 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-line)] py-5">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--color-accent)] text-sm font-black text-black">P</div>
          <div>
            <div className="font-semibold tracking-tight">Preflight</div>
            <div className="label !normal-case !tracking-normal">simulate before an agent acts</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <div className="flex overflow-hidden rounded-lg border border-[var(--color-line)]">
            {(["sandbox", "live"] as Mode[]).map((m) => (
              <button
                key={m}
                disabled={m === "live" && !status?.live}
                onClick={() => {
                  setMode(m);
                  reject();
                }}
                title={m === "live" && !status?.live ? "Set GITHUB_TOKEN, GITHUB_REPO and STRIPE_SECRET_KEY (test mode) to enable" : ""}
                className={`px-3 py-1.5 font-mono ${mode === m ? "bg-[var(--color-accent)] text-black" : "text-[var(--color-mute)] disabled:opacity-40"}`}
              >
                {m === "live" ? `LIVE · ${status?.repo ?? "not configured"} + Stripe test` : "SANDBOX"}
              </button>
            ))}
          </div>
          <span className="rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 font-mono text-[var(--color-mute)]">simulator model v{modelVersion}</span>
          {mode === "sandbox" && (
            <button onClick={resetSandbox} className="rounded-lg px-2.5 py-1.5 text-[var(--color-mute)] hover:text-white">
              Reset sandbox
            </button>
          )}
        </div>
      </header>

      <section className="py-10">
        <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
          &ldquo;Undo&rdquo; is too slow at agent speed.
          <span className="text-[var(--color-accent)]"> See the blast radius before anything is written.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[var(--color-mute)]">
          Preflight reads the real state of GitHub and Stripe, predicts every change, side effect, the people affected and the rollback path. You approve, narrow
          or reject in one step. Then it executes item by item, re-reads reality after each one, and halts and rolls back the moment reality disagrees with the prediction.
        </p>
      </section>

      <Stepper phase={phase} busy={busy} />

      {/* 1 — intent */}
      <section className="card mt-5 p-4">
        <div className="label mb-2">1 · What should the agent do?</div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSimulate()}
            className="flex-1 rounded-lg border border-[var(--color-line)] bg-black/40 px-3 py-2.5 text-[14px] outline-none focus:border-[var(--color-accent)]"
          />
          <button onClick={() => doSimulate()} disabled={!!busy} className="rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-50">
            {busy === "simulating" ? "Simulating…" : "Simulate"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => {
                setText(p.text);
                doSimulate(p.text);
              }}
              className="rounded-full border border-[var(--color-line)] px-3 py-1 text-[12px] text-[var(--color-mute)] hover:border-[var(--color-accent)] hover:text-white"
            >
              {p.label}
            </button>
          ))}
          {!status?.model && <span className="self-center font-mono text-[10.5px] text-[var(--color-mute)]">free-text parsing: heuristic (no ANTHROPIC_API_KEY)</span>}
        </div>
        {error && <div className="mt-3 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-2.5 text-[13px] text-[#fecdd3]">{error}</div>}
      </section>

      {sim && live && (
        <>
          {/* 2 — simulation */}
          <section className="mt-5 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
            <div className="card overflow-hidden">
              <div className="border-b border-[var(--color-line)] p-4" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${GATE[live.gate.status].c} 14%, transparent), transparent 60%)` }}>
                <div className="label mb-1">2 · Simulation of: {sim.intent.summary}</div>
                <div className="text-2xl font-black tracking-tight" style={{ color: GATE[live.gate.status].c }}>
                  {GATE[live.gate.status].t}
                </div>
                <div className="text-[13px] text-[var(--color-mute)]">{GATE[live.gate.status].d}</div>
                <ul className="mt-2 space-y-1 text-[13px]">
                  {live.gate.reasons.map((r) => (
                    <li key={r}>• {r}</li>
                  ))}
                </ul>
              </div>
              <div className="grid grid-cols-2 gap-px bg-[var(--color-line)] sm:grid-cols-4">
                <Stat k="Selected actions" v={`${live.totals.selected}`} s={`${live.totals.blocked} auto-excluded`} />
                <Stat k="Side effects" v={`${live.totals.sideEffects}`} s={`${live.totals.people} people / authors`} />
                {sim.intent.kind === "stripe.refund" ? (
                  <>
                    <Stat k="Money out" v={money(live.totals.moneyOut, live.totals.currency)} s={`+ ${money(live.totals.feesLost, live.totals.currency)} fees not returned`} />
                    <Stat k="Balance after" v={money(live.totals.balanceAfter, live.totals.currency)} s={`now ${money(sim.before.balance, sim.before.currency)}`} danger={live.totals.balanceAfter < 0} />
                  </>
                ) : (
                  <>
                    <Stat k="Reversible" v={sim.items.every((i) => i.reversibility === "reversible") ? "yes" : "partly"} s="refs restorable by sha" />
                    <Stat k="Read from" v={sim.mode} s={sim.before.repo} />
                  </>
                )}
              </div>
              <div className="divide-y divide-[var(--color-line)]">
                {sim.items.length === 0 && <div className="p-6 text-center text-[13px] text-[var(--color-mute)]">Nothing matches this intent.</div>}
                {sim.items.map((i) => (
                  <Item
                    key={i.id}
                    item={i}
                    checked={selected.includes(i.id)}
                    disabled={phase !== "review"}
                    onToggle={() => setSelected((s) => (s.includes(i.id) ? s.filter((x) => x !== i.id) : [...s, i.id]))}
                  />
                ))}
              </div>
              {phase === "review" && (
                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] p-4">
                  <button onClick={doExecute} disabled={!!busy || live.gate.status === "blocked"} className="rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-40">
                    {busy === "executing" ? "Executing with verification…" : `Approve & execute ${live.totals.selected} action(s)`}
                  </button>
                  <button onClick={reject} disabled={!!busy} className="rounded-lg border border-[var(--color-line)] px-4 py-2.5 text-sm hover:border-[var(--color-danger)]">
                    Reject
                  </button>
                  <span className="text-[12px] text-[var(--color-mute)]">Untick items to narrow the plan. The approval is signed to exactly what you see.</span>
                </div>
              )}
            </div>

            <BeforeAfter sim={sim} selected={selected} report={report} />
          </section>

          {/* 3/4 — execution + verification */}
          {report && <Report report={report} learnable={!!learnable} onLearn={learn} onRerun={() => doSimulate()} modelVersion={modelVersion} />}
        </>
      )}

      <Architecture />
    </main>
  );
}

function Stepper({ phase, busy }: { phase: Phase; busy: string }) {
  const steps = ["Intent", "Simulate", "Present", "Execute + verify", "Rollback if reality diverges"];
  const at = phase === "intent" ? (busy === "simulating" ? 1 : 0) : phase === "review" ? (busy === "executing" ? 3 : 2) : 4;
  return (
    <div className="card flex flex-wrap items-center gap-2 p-4">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <span
            className={`rounded-md border px-2.5 py-1 font-mono text-[11px] ${busy && i === at ? "running" : ""}`}
            style={{ borderColor: i <= at ? "var(--color-accent)" : "var(--color-line)", color: i <= at ? "#ccfbf1" : "var(--color-mute)", background: i <= at ? "#0c1f1d" : "transparent" }}
          >
            {s}
          </span>
          {i < steps.length - 1 && <span className="text-[var(--color-mute)]">→</span>}
        </div>
      ))}
    </div>
  );
}

function Stat({ k, v, s, danger }: { k: string; v: string; s?: string; danger?: boolean }) {
  return (
    <div className="bg-[var(--color-panel)] p-3.5">
      <div className="label !text-[9.5px]">{k}</div>
      <div className="mt-1 font-mono text-[17px] font-semibold" style={{ color: danger ? "var(--color-danger)" : undefined }}>
        {v}
      </div>
      {s && <div className="truncate font-mono text-[10px] text-[var(--color-mute)]">{s}</div>}
    </div>
  );
}

function Item({ item, checked, disabled, onToggle }: { item: PlanItem; checked: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <div className={`p-4 ${item.blocked ? "opacity-55" : ""}`}>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--color-accent)]" checked={checked && !item.blocked} disabled={disabled || !!item.blocked} onChange={onToggle} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-medium">{item.label}</span>
            <span className="rounded border px-1.5 font-mono text-[9.5px]" style={{ borderColor: item.reversibility === "reversible" ? "var(--color-ok)" : "var(--color-danger)", color: item.reversibility === "reversible" ? "var(--color-ok)" : "var(--color-danger)" }}>
              {item.reversibility}
            </span>
          </div>
          {item.blocked && <div className="mt-1 text-[12.5px] text-[var(--color-warn)]">Excluded: {item.blocked}</div>}
          <ul className="mt-2 space-y-1">
            {item.effects.map((e) => (
              <EffectRow key={e.entity + e.kind} e={e} />
            ))}
          </ul>
          {!item.blocked && (
            <div className="mt-2 grid gap-1 text-[12px] text-[var(--color-mute)] sm:grid-cols-2">
              <div>
                <span className="label !text-[9px]">rollback </span>
                {item.rollback}
              </div>
              {item.impacted.length > 0 && (
                <div>
                  <span className="label !text-[9px]">impacts </span>
                  {item.impacted.join(", ")}
                </div>
              )}
            </div>
          )}
        </div>
      </label>
    </div>
  );
}

function EffectRow({ e }: { e: Effect }) {
  return (
    <li className="flex flex-wrap items-center gap-2 font-mono text-[11.5px]">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: SEV[e.severity] }} />
      <span className="text-[#d8d8e2]">{e.entity}</span>
      <span className="text-[var(--color-mute)] line-through decoration-[var(--color-danger)]/60">{e.before}</span>
      <span className="text-[var(--color-mute)]">→</span>
      <span style={{ color: SEV[e.severity] }}>{e.after}</span>
      {e.side && <span className="rounded bg-white/5 px-1 text-[9.5px] text-[var(--color-mute)]">side effect</span>}
    </li>
  );
}

/** Diff-style "before vs after" of the watched state. */
function BeforeAfter({ sim, selected, report }: { sim: Simulation; selected: string[]; report: ExecutionReport | null }) {
  const chosen = sim.items.filter((i) => selected.includes(i.id) && !i.blocked);
  const effects = new Map(chosen.flatMap((i) => i.effects).map((e) => [e.entity, e]));
  if (sim.intent.kind === "github.delete_branches") {
    return (
      <div className="card p-4">
        <div className="label mb-3">Before → after · {sim.before.repo}</div>
        <div className="space-y-0.5 font-mono text-[12px]">
          {sim.before.branches.map((b) => {
            const e = effects.get(`branch:${b.name}`);
            return (
              <div key={b.name} className={`flex justify-between rounded px-2 py-1 ${e ? "bg-[var(--color-danger)]/10" : ""}`}>
                <span className={e ? "text-[var(--color-danger)] line-through" : ""}>
                  {e ? "− " : "  "}
                  {b.name}
                  {b.protected && <span className="ml-2 text-[10px] text-[var(--color-mute)]">protected</span>}
                </span>
                <span className="text-[var(--color-mute)]">{b.sha.slice(0, 7)}</span>
              </div>
            );
          })}
        </div>
        <div className="label mb-2 mt-5">Pull requests</div>
        <div className="space-y-0.5 font-mono text-[12px]">
          {sim.before.prs
            .filter((p) => p.state === "open")
            .map((p) => {
              const e = effects.get(`pr:#${p.number}`);
              return (
                <div key={p.number} className={`rounded px-2 py-1 ${e ? "bg-[var(--color-warn)]/10" : ""}`}>
                  <span style={{ color: e ? "var(--color-warn)" : undefined }}>#{p.number}</span> {p.title}
                  <div className="text-[10.5px] text-[var(--color-mute)]">
                    {p.head} → {p.base} · {e ? <span className="text-[var(--color-warn)]">open → closed</span> : "stays open"}
                  </div>
                </div>
              );
            })}
        </div>
        {report && <ActualNote report={report} />}
      </div>
    );
  }
  return (
    <div className="card p-4">
      <div className="label mb-3">Before → after · charges</div>
      <table className="w-full font-mono text-[11.5px]">
        <thead className="label">
          <tr>
            <th className="pb-2 text-left font-normal">charge</th>
            <th className="pb-2 text-right font-normal">refunded before</th>
            <th className="pb-2 text-right font-normal">after</th>
          </tr>
        </thead>
        <tbody>
          {sim.before.charges
            .filter((c) => sim.items.some((i) => i.target === c.id))
            .map((c) => {
              const e = effects.get(`charge:${c.id}`);
              const after = e?.patch?.type === "charge" ? e.patch.amountRefunded : c.amountRefunded;
              return (
                <tr key={c.id} className={`border-t border-[var(--color-line)] ${e ? "bg-[var(--color-danger)]/5" : ""}`}>
                  <td className="py-1.5">
                    {c.email ?? c.id}
                    {c.disputed && <span className="ml-1 text-[var(--color-warn)]">disputed</span>}
                  </td>
                  <td className="py-1.5 text-right text-[var(--color-mute)]">{money(c.amountRefunded, c.currency)}</td>
                  <td className="py-1.5 text-right" style={{ color: e ? "var(--color-danger)" : "var(--color-mute)" }}>
                    {money(after, c.currency)}
                  </td>
                </tr>
              );
            })}
          <tr className="border-t border-[var(--color-line)]">
            <td className="py-2">available balance</td>
            <td className="py-2 text-right text-[var(--color-mute)]">{money(sim.before.balance, sim.before.currency)}</td>
            <td className="py-2 text-right">{money(summarize(sim, selected).totals.balanceAfter, sim.before.currency)}</td>
          </tr>
        </tbody>
      </table>
      {report && <ActualNote report={report} />}
    </div>
  );
}

function ActualNote({ report }: { report: ExecutionReport }) {
  return (
    <div className="mt-4 rounded-lg border border-[var(--color-line)] bg-black/30 p-3 text-[12px] text-[var(--color-mute)]">
      Re-read after execution at {new Date(report.after.takenAt).toLocaleTimeString()}: {report.after.branches.length} branches, {report.after.prs.filter((p) => p.state === "open").length} open PRs.
    </div>
  );
}

function Report({ report, learnable, onLearn, onRerun, modelVersion }: { report: ExecutionReport; learnable: boolean; onLearn: () => void; onRerun: () => void; modelVersion: 1 | 2 }) {
  const color = { done: "var(--color-ok)", skipped_drift: "var(--color-warn)", failed: "var(--color-danger)", not_run: "var(--color-mute)" } as const;
  return (
    <section className="mt-5 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
      <div className="card p-4">
        <div className="label mb-3">3 · Execution, verified step by step</div>
        <ol className="space-y-2">
          {report.steps.map((s, i) => (
            <li key={s.itemId} className="rounded-lg border border-[var(--color-line)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13.5px]">
                  <span className="mr-2 font-mono text-[var(--color-mute)]">{i + 1}</span>
                  {s.label}
                </span>
                <span className="font-mono text-[10.5px] uppercase" style={{ color: s.mismatches.length ? "var(--color-danger)" : color[s.status] }}>
                  {s.mismatches.length ? "done · diverged" : s.status.replace("_", " ")}
                </span>
              </div>
              {s.detail && <div className="mt-1 text-[12px] text-[var(--color-mute)]">{s.detail}</div>}
              {s.mismatches.map((m) => (
                <div key={m.entity} className="mt-1 font-mono text-[11.5px] text-[var(--color-danger)]">
                  {m.entity}: predicted {m.expected}, actually {m.actual}
                </div>
              ))}
            </li>
          ))}
        </ol>
      </div>

      <div className="card p-4" style={{ borderColor: report.safetyNet.triggered ? "var(--color-danger)" : "var(--color-ok)" }}>
        <div className="label mb-2">4 · Safety net</div>
        {report.safetyNet.triggered ? (
          <>
            <div className="text-xl font-black text-[var(--color-danger)]">TRIGGERED — HALTED & ROLLED BACK</div>
            <div className="mt-1 text-[13px]">{report.safetyNet.reason}</div>
            <ul className="mt-3 space-y-1 font-mono text-[12px]">
              {report.safetyNet.actions.map((a) => (
                <li key={a.action} style={{ color: a.ok ? "var(--color-ok)" : "var(--color-danger)" }}>
                  {a.ok ? "✓" : "✗"} {a.action}
                  {a.detail && <span className="text-[var(--color-mute)]"> — {a.detail}</span>}
                </li>
              ))}
            </ul>
            {learnable && (
              <div className="mt-4 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 p-3 text-[13px]">
                The simulator didn&apos;t model this effect: deleting a branch also closes PRs <b>stacked on</b> it.
                <div className="mt-2 flex gap-2">
                  <button onClick={onLearn} className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-semibold text-black">
                    Teach the simulator (model v2)
                  </button>
                </div>
              </div>
            )}
            {modelVersion === 2 && (
              <button onClick={onRerun} className="mt-3 rounded-md border border-[var(--color-line)] px-3 py-1.5 text-[12.5px] hover:border-[var(--color-accent)]">
                Re-simulate with model v2 →
              </button>
            )}
          </>
        ) : (
          <>
            <div className="text-xl font-black text-[var(--color-ok)]">NOT NEEDED</div>
            <div className="mt-1 text-[13px] text-[var(--color-mute)]">After every step, the real state matched the simulation exactly, across all watched branches, PRs and charges.</div>
          </>
        )}
      </div>
    </section>
  );
}
