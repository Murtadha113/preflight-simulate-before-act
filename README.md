# Preflight: simulate before an agent acts

> "Undo" is too slow at agent speed. Preflight shows the blast radius **before** anything is written. Then it checks reality against its own prediction, and rolls back the moment they disagree.

Built for the DOO Builders League challenge **"Simulate Before You Act"**.

- **Live demo:** https://preflight-simulate.vercel.app (sandbox mode; live GitHub + Stripe test mode turns on when keys are set)
- **90-second walkthrough (video):** https://github.com/Murtadha113/preflight-simulate-before-act/releases/download/v1.0/preflight-demo.mp4

Preflight gates two high-stakes action types against **real APIs**:

| Action | Real system | What's at stake |
|---|---|---|
| Delete stale branches | GitHub REST API (a real sandbox repo) | unmerged commits, open PRs, stacked PRs |
| Bulk refund customers | Stripe API, **test mode** | money out, fees not returned, customer emails, account balance |

An offline **sandbox** that reproduces the same platform behaviour, including side effects the simulator doesn't model, means the demo also runs from a clean clone with no keys.

---

## The cycle

```
 intent ──▶ simulate ──▶ present ──▶ bind ──▶ execute ──▶ verify ──┬──▶ done
 (Claude     (reads REAL   (diff, gate,  (HMAC on    (one item,   (re-read     │
  → typed     state,        reviewer      exactly     drift check, reality,    └──▶ SAFETY NET
  intent)     predicts      narrows or    what was    idempotency) diff ALL         halt batch, recreate refs at
              patches)      rejects)      previewed)               watched state)   original sha, restore PR bases,
                                                                                    reopen PRs, contain refunds
```

### 1. Simulation changes the decision; it doesn't just narrate
The simulator reads the live state and turns every planned action into **patches on the watched state**: refs, PR states and bases, and refunded amounts per charge. It also lists side effects, impacted people and a rollback path. The result directly changes what runs:

- **Auto-excluded items.** A protected branch would be rejected by GitHub. A disputed charge can't be refunded. An already-refunded charge has nothing left to refund.
- **Blocked plans.** Refunding the whole outage batch would push the Stripe balance to **−$30.00**, which makes Stripe debit the bank and can pause payouts. The *Approve* button stays disabled until the reviewer narrows the plan.
- **Needs-review gate.** Irreversible actions, or high-severity side effects such as unmerged commits becoming unreachable or a stacked PR closing.

### 2. Approve, tweak or reject in one step
The reviewer can untick items, and totals and the gate recompute live. The approval is **HMAC-signed to exactly the previewed items and effects** and is valid for 15 minutes. The server rejects any edited plan, and the reviewer can only *narrow* a plan, never widen it.

### 3. Execute with verification after every item
- **Drift check** before each item. If the branch moved or the charge was refunded elsewhere since the simulation, the item is skipped.
- Stripe refunds use **idempotency keys** (`preflight:<simulation>:<charge>`), so retries can't double-refund.
- After each item, Preflight **re-reads reality** and diffs the expected post-state against the actual one across **all** watched entities, not only the predicted ones. That is how it catches effects the simulator never modelled.

### 4. Safety net
On any divergence, Preflight halts the batch, recreates every deleted branch at its original sha, restores PR bases and reopens PRs. Irreversible steps like refunds can't be undone, so they're contained by halting the rest of the batch.

---

## Failure test: the simulation under-predicts

The simulator ships as **model v1** with a known blind spot. It predicts that deleting a branch closes PRs whose *head* is that branch, but not PRs **stacked on** it (whose *base* is that branch).

1. Run **"Clean up stale branches"**. Four deletions are planned.
2. Steps 1–3 verify cleanly. Step 4 deletes `feature/payments-v2`, and the re-read shows **PR #44 closed**. Nobody predicted that.
3. **Safety net:** the batch halts, all 4 branches are recreated at their original shas, and PRs #41 and #44 are reopened. The repo is back exactly where it started.
4. **Teach the simulator** switches on **model v2**. Re-simulate, and #44 now appears *before* approval as a high-severity side effect.

Run it headless, together with the refund-gate checks:

```bash
npx tsx scripts/failure-test.ts
```

---

## Run it

```bash
git clone https://github.com/Murtadha113/preflight-simulate-before-act
cd preflight-simulate-before-act
npm install
npm run dev          # http://localhost:3000, sandbox mode works with no keys
```

### Live mode (real GitHub + Stripe test mode)

1. Create an **empty sandbox repo** with a README, for example `you/preflight-sandbox`, and a fine-grained token with *Contents* and *Pull requests* read/write on **that repo only**.
2. Get a Stripe **test-mode** secret key (`sk_test_…`). Preflight refuses to start with a live key.
3. `cp .env.example .env.local` and fill in the values.
4. Seed the demo state: `npx tsx --env-file=.env.local scripts/seed-live.ts`
5. `npm run dev` and switch the header toggle to **LIVE**.

## Project layout

```
src/lib/types.ts       snapshot, intent, effects, plan items, reports
src/lib/providers.ts   one interface → real GitHub (Octokit) + Stripe, or the offline sandbox
src/lib/simulate.ts    the simulator (model v1 / v2) + approval signing
src/lib/summary.ts     totals + gate (browser-safe, recomputed as the reviewer narrows)
src/lib/execute.ts     drift check → execute → verify → safety net
src/lib/intent.ts      plain English → typed intent (Claude structured output, heuristic fallback)
src/lib/sandbox.ts     offline replica of the demo state
scripts/failure-test.ts  end-to-end checks incl. the under-prediction failure
scripts/seed-live.ts     seeds a real sandbox repo + Stripe test account
```

See [THESIS.md](THESIS.md) and [NOTES.md](NOTES.md).
