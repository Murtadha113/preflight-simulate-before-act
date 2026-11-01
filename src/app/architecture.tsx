// Architecture snapshot: intent → simulate → present → execute / rollback.

const STAGES = [
  { t: "Intent", d: "Plain English → typed intent (Claude structured output). The model only fills a schema; it never touches the APIs." },
  { t: "Simulate", d: "Reads the REAL current state (GitHub refs, PRs, compare; Stripe charges, fees, balance). Predicts every change as a patch on the watched state, plus side effects, impacted people and the rollback path." },
  { t: "Present", d: "Diff of before → after. A gate blocks plans that can't safely run (e.g. negative balance) and auto-excludes items that would fail (protected branch, disputed charge). Reviewer narrows or rejects in one step." },
  { t: "Bind", d: "The approval is HMAC-signed to exactly the previewed items and effects, valid for 15 minutes. The reviewer can only narrow it." },
  { t: "Execute", d: "One item at a time. Before each item: drift check against the precondition (branch sha, refunded amount). Refunds use idempotency keys." },
  { t: "Verify", d: "After each item: re-read reality and diff it against the expected state over ALL watched entities, not only the predicted ones. That is what catches what the simulator didn't model." },
  { t: "Rollback", d: "On any divergence: halt the batch, recreate deleted refs at their original sha, restore PR bases, reopen PRs. Irreversible steps (refunds) are contained by halting." },
];

export function Architecture() {
  return (
    <section className="mt-10 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
      <div className="card p-5">
        <div className="label mb-4">Architecture · intent → simulate → present → execute / rollback</div>
        <ol className="grid gap-2 sm:grid-cols-2">
          {STAGES.map((s, i) => (
            <li key={s.t} className="rounded-xl border border-[var(--color-line)] bg-black/30 p-3">
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--color-accent)] font-mono text-[10px] font-bold text-black">{i + 1}</span>
                <span className="text-[13px] font-semibold">{s.t}</span>
              </div>
              <div className="mt-1 text-[12px] leading-snug text-[var(--color-mute)]">{s.d}</div>
            </li>
          ))}
        </ol>
      </div>
      <div className="card p-5">
        <div className="label mb-3">Failure test · the simulation under-predicts</div>
        <ol className="space-y-3 text-[13px] leading-relaxed">
          <li>
            Simulator <b>v1</b> knows that deleting a branch closes the PRs whose <i>head</i> is that branch. It does <b>not</b> know that PRs <i>stacked on</i> it (whose base is that branch) close too.
          </li>
          <li>
            Run <b>&ldquo;Clean up stale branches&rdquo;</b>. Steps 1–3 verify cleanly. Step 4 deletes <code>feature/payments-v2</code>, and verification sees PR <b>#44</b> close. Nobody predicted that.
          </li>
          <li>
            <span className="text-[var(--color-danger)]">Safety net:</span> the batch halts, all four branches are recreated at their original sha, and PRs #41 and #44 are reopened. The repo ends up exactly as it started.
          </li>
          <li>
            &ldquo;Teach the simulator&rdquo; switches on <b>v2</b>. The next simulation shows #44 up front as a high-severity side effect, so a human sees it <i>before</i> approving.
          </li>
        </ol>
      </div>
    </section>
  );
}
