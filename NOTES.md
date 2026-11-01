# Submission notes

## AI tools used
- **Claude Opus 5.5** (via the Anthropic TypeScript SDK) turns a plain-English request into a typed intent, using structured outputs at `effort: low` with server-side refusal fallbacks. It never calls GitHub or Stripe and never decides what runs.
- **Claude Code** was used as a pair programmer to build the codebase.

## Key decisions
- **Predictions are patches on a watched state**, not prose. That makes it possible to diff reality against the prediction mechanically after every step.
- **Verify everything watched, not just what was predicted.** That is what catches unmodelled side effects (the stacked-PR failure test).
- **Per-item execution with halt-on-divergence** instead of an all-or-nothing batch. It limits the blast radius of irreversible steps.
- **Signed approvals** bind a human's yes to the exact previewed effects. They expire after 15 minutes, and the reviewer can only narrow them.
- **Drift checks plus idempotency keys** protect against state changing between preview and execution, and against retries.
- **A test-key guard:** live mode refuses to start unless the Stripe key is a test-mode key.

## Intentionally out of scope
- **Webhooks and downstream systems.** The watched state covers refs, PRs and charges. A Stripe webhook that triggers your own systems isn't observed.
- **Persistence of simulations.** The signed simulation round-trips through the client. Production would store it server-side with the approver's identity.
- **Sandbox state** lives in the browser (localStorage). Live mode reads the real APIs every time.
- **Learning is a model-version switch** (v1 → v2) in this demo, not an automatic rule synthesiser.
