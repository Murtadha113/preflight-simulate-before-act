// Offline replica of the GitHub + Stripe behaviour Preflight touches, for running without keys.
// It reproduces the real platforms' side effects, including ones the simulator does not model.

import type { World } from "./types";

const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const sha = (s: string) => (s + "0123456789abcdef".repeat(3)).replace(/[^0-9a-f]/g, "a").slice(0, 40);

export function seedWorld(): World {
  return {
    repo: "sandbox/acme-checkout",
    defaultBranch: "main",
    branches: [
      { name: "main", sha: sha("c2main"), protected: true, isDefault: true, lastCommitAt: ago(1), aheadBy: 0 },
      { name: "release/1.x", sha: sha("e1rel"), protected: true, isDefault: false, lastCommitAt: ago(80), aheadBy: 0 },
      { name: "chore/cleanup-ci", sha: sha("a0old"), protected: false, isDefault: false, lastCommitAt: ago(70), aheadBy: 0 },
      { name: "fix/typo-readme", sha: sha("a0old"), protected: false, isDefault: false, lastCommitAt: ago(70), aheadBy: 0 },
      { name: "experiment/old-spike", sha: sha("b9spike"), protected: false, isDefault: false, lastCommitAt: ago(90), aheadBy: 3 },
      { name: "feature/payments-v2", sha: sha("d4pay"), protected: false, isDefault: false, lastCommitAt: ago(45), aheadBy: 2 },
      { name: "feature/payments-v2-ui", sha: sha("d5ui"), protected: false, isDefault: false, lastCommitAt: ago(2), aheadBy: 4 },
      { name: "feature/dark-mode", sha: sha("f7dark"), protected: false, isDefault: false, lastCommitAt: ago(5), aheadBy: 6 },
    ],
    prs: [
      { number: 41, title: "Payments v2: ledger + idempotency", head: "feature/payments-v2", base: "main", state: "open", author: "omar" },
      { number: 44, title: "Payments v2 UI (stacked on #41)", head: "feature/payments-v2-ui", base: "feature/payments-v2", state: "open", author: "lina" },
      { number: 47, title: "Dark mode", head: "feature/dark-mode", base: "main", state: "open", author: "kenji" },
    ],
    charges: [
      ...["fatima@noor.example", "dan@ortiz.example", "aisha@corp.example", "kenji@post.example", "sara@mail.example"].map((email, i) => ({
        id: `ch_sbx_${1001 + i}`,
        amount: 4900,
        amountRefunded: 0,
        currency: "usd",
        email,
        description: "Pro plan – November (outage window)",
        disputed: false,
        created: ago(3),
        fee: 172,
      })),
      { id: "ch_sbx_1006", amount: 4900, amountRefunded: 0, currency: "usd", email: "mike@dispute.example", description: "Pro plan – November (outage window)", disputed: true, created: ago(3), fee: 172 },
      { id: "ch_sbx_1007", amount: 4900, amountRefunded: 4900, currency: "usd", email: "nour@refunded.example", description: "Pro plan – November (outage window)", disputed: false, created: ago(3), fee: 172 },
      { id: "ch_sbx_1008", amount: 19900, amountRefunded: 0, currency: "usd", email: "ops@team.example", description: "Team plan – November", disputed: false, created: ago(3), fee: 607 },
    ],
    balance: 21500,
    currency: "usd",
  };
}
