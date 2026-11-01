// Seeds a REAL GitHub sandbox repo and a Stripe TEST-mode account with the demo state.
// Usage: GITHUB_TOKEN=... GITHUB_REPO=owner/preflight-sandbox STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/seed-live.ts
// The repo must exist with at least one commit on its default branch (create it with a README).
import { Octokit } from "@octokit/rest";
import Stripe from "stripe";

async function main() {
  const { GITHUB_TOKEN, GITHUB_REPO, STRIPE_SECRET_KEY } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPO || !STRIPE_SECRET_KEY) throw new Error("Set GITHUB_TOKEN, GITHUB_REPO and STRIPE_SECRET_KEY");
  if (!STRIPE_SECRET_KEY.startsWith("sk_test_")) throw new Error("Refusing: STRIPE_SECRET_KEY must be a test-mode key");
  const [owner, repo] = GITHUB_REPO.split("/");
  const gh = new Octokit({ auth: GITHUB_TOKEN });
  const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

  const meta = await gh.repos.get({ owner, repo });
  const def = meta.data.default_branch;
  const head = (await gh.git.getRef({ owner, repo, ref: `heads/${def}` })).data.object.sha;
  const tree = (await gh.git.getCommit({ owner, repo, commit_sha: head })).data.tree.sha;

  async function commit(parent: string, msg: string, daysAgo: number, file?: [string, string]) {
    let t = tree;
    if (file) t = (await gh.git.createTree({ owner, repo, base_tree: tree, tree: [{ path: file[0], mode: "100644", type: "blob", content: file[1] }] })).data.sha;
    const who = { name: "Preflight Seed", email: "seed@preflight.dev", date: ago(daysAgo) };
    return (await gh.git.createCommit({ owner, repo, message: msg, tree: t, parents: [parent], author: who, committer: who })).data.sha;
  }
  async function branch(name: string, sha: string) {
    try { await gh.git.createRef({ owner, repo, ref: `refs/heads/${name}`, sha }); }
    catch { await gh.git.updateRef({ owner, repo, ref: `heads/${name}`, sha, force: true }); }
    console.log("branch", name, sha.slice(0, 7));
  }

  // An old commit that becomes part of the default branch → "merged" stale branches.
  const old = await commit(head, "Release 1.4 prep", 70);
  const tip = await commit(old, "Bump version", 1);
  await gh.git.updateRef({ owner, repo, ref: `heads/${def}`, sha: tip, force: true });
  await branch("chore/cleanup-ci", old);
  await branch("fix/typo-readme", old);
  await branch("release/1.x", old);
  try {
    await gh.repos.updateBranchProtection({ owner, repo, branch: "release/1.x", required_status_checks: null, enforce_admins: false, required_pull_request_reviews: null, restrictions: null });
    console.log("protected release/1.x");
  } catch { console.log("could not protect release/1.x (needs a public repo or a paid plan) — continuing"); }

  const spike = await commit(tip, "Spike: try a new tokenizer", 90, ["spike.md", "spike\n"]);
  await branch("experiment/old-spike", spike);
  const pay = await commit(tip, "Payments v2: ledger + idempotency", 45, ["payments-v2.md", "ledger\n"]);
  await branch("feature/payments-v2", pay);
  const ui = await commit(pay, "Payments v2 UI", 2, ["payments-v2-ui.md", "ui\n"]);
  await branch("feature/payments-v2-ui", ui);
  const dark = await commit(tip, "Dark mode", 5, ["dark.md", "dark\n"]);
  await branch("feature/dark-mode", dark);

  const pr = async (head: string, base: string, title: string) => {
    try { const p = await gh.pulls.create({ owner, repo, head, base, title }); console.log("PR", p.data.number, title); }
    catch (e) { console.log("PR exists or failed:", title, e instanceof Error ? e.message : e); }
  };
  await pr("feature/payments-v2", def, "Payments v2: ledger + idempotency");
  await pr("feature/payments-v2-ui", "feature/payments-v2", "Payments v2 UI (stacked)");
  await pr("feature/dark-mode", def, "Dark mode");

  // Stripe test mode: charges from the outage window, one disputed, one already refunded, one unrelated.
  const stripe = new Stripe(STRIPE_SECRET_KEY);
  const pay1 = (pm: string, email: string, amount: number, description: string) =>
    stripe.paymentIntents.create({ amount, currency: "usd", payment_method: pm, confirm: true, description, receipt_email: email, automatic_payment_methods: { enabled: true, allow_redirects: "never" } });
  const desc = "Pro plan – November (outage window)";
  for (const e of ["fatima@noor.example", "dan@ortiz.example", "aisha@corp.example", "kenji@post.example", "sara@mail.example"]) await pay1("pm_card_visa", e, 4900, desc);
  await pay1("pm_card_createDispute", "mike@dispute.example", 4900, desc);
  const refunded = await pay1("pm_card_visa", "nour@refunded.example", 4900, desc);
  await stripe.refunds.create({ payment_intent: refunded.id });
  await pay1("pm_card_visa", "ops@team.example", 19900, "Team plan – November");
  // Funds from test charges land as pending; this test card makes them available immediately.
  await pay1("pm_card_bypassPending", "seed@preflight.dev", 1000, "Seed: available balance");
  console.log("Stripe test charges created");
}
main().catch((e) => { console.error(e); process.exit(1); });
