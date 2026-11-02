// One interface, two backends: the real GitHub + Stripe (test mode) APIs, or the offline sandbox.

import { Octokit } from "@octokit/rest";
import Stripe from "stripe";
import type { Branch, Charge, PR, Snapshot, World } from "./types";

export interface Provider {
  snapshot(): Promise<Snapshot>;
  deleteBranch(name: string): Promise<void>;
  createRef(name: string, sha: string): Promise<void>;
  reopenPR(n: number): Promise<void>;
  setPRBase(n: number, base: string): Promise<void>;
  refund(chargeId: string, amount: number, idempotencyKey: string): Promise<void>;
  /** Live APIs settle asynchronously (e.g. GitHub closing a PR after its branch is deleted). */
  settle(): Promise<void>;
}

export function liveConfigured() {
  return Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO && process.env.STRIPE_SECRET_KEY);
}

// ------------------------------------------------------------------ sandbox

export class SandboxProvider implements Provider {
  constructor(public world: World) {}

  async snapshot(): Promise<Snapshot> {
    const w = structuredClone(this.world);
    return { takenAt: new Date().toISOString(), repo: w.repo, defaultBranch: w.defaultBranch, branches: w.branches, prs: w.prs, charges: w.charges, balance: w.balance, currency: w.currency };
  }
  async deleteBranch(name: string) {
    const b = this.world.branches.find((x) => x.name === name);
    if (!b) throw new Error(`Reference does not exist: heads/${name}`);
    if (b.protected) throw new Error(`Cannot delete protected branch ${name}`);
    this.world.branches = this.world.branches.filter((x) => x.name !== name);
    (this.world.graveyard ??= []).push(b);
    // Same as GitHub: open PRs whose head OR base was this branch are closed.
    for (const p of this.world.prs) if (p.state === "open" && (p.head === name || p.base === name)) p.state = "closed";
  }
  async createRef(name: string, sha: string) {
    if (this.world.branches.some((b) => b.name === name)) throw new Error(`Reference already exists: ${name}`);
    const known = this.world.graveyard?.find((g) => g.sha === sha);
    this.world.branches.push(known ? { ...known, name, protected: false, isDefault: false } : { name, sha, protected: false, isDefault: false, lastCommitAt: new Date().toISOString(), aheadBy: 0 });
  }
  async reopenPR(n: number) {
    const p = this.world.prs.find((x) => x.number === n);
    if (!p) throw new Error(`PR #${n} not found`);
    if (!this.world.branches.some((b) => b.name === p.head)) throw new Error(`Cannot reopen #${n}: head branch is missing`);
    if (!this.world.branches.some((b) => b.name === p.base)) throw new Error(`Cannot reopen #${n}: base branch is missing`);
    p.state = "open";
  }
  async setPRBase(n: number, base: string) {
    const p = this.world.prs.find((x) => x.number === n);
    if (p) p.base = base;
  }
  async refund(chargeId: string, amount: number) {
    const c = this.world.charges.find((x) => x.id === chargeId);
    if (!c) throw new Error(`No such charge ${chargeId}`);
    if (c.disputed) throw new Error("Charge is disputed and cannot be refunded");
    if (c.amountRefunded + amount > c.amount) throw new Error("Refund exceeds charge amount");
    c.amountRefunded += amount;
    this.world.balance -= amount;
  }
  async settle() {}
}

// ------------------------------------------------------------------ live

export class LiveProvider implements Provider {
  private gh = new Octokit({ auth: process.env.GITHUB_TOKEN });
  private stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  private owner: string;
  private repo: string;

  constructor() {
    if (!process.env.STRIPE_SECRET_KEY!.startsWith("sk_test_") && !process.env.STRIPE_SECRET_KEY!.startsWith("rk_test_"))
      throw new Error("Refusing to run: STRIPE_SECRET_KEY must be a TEST-mode key");
    [this.owner, this.repo] = process.env.GITHUB_REPO!.split("/");
  }

  async snapshot(): Promise<Snapshot> {
    const { owner, repo } = this;
    const meta = await this.gh.repos.get({ owner, repo });
    const def = meta.data.default_branch;
    const list = await this.gh.paginate(this.gh.repos.listBranches, { owner, repo, per_page: 100 });
    const branches: Branch[] = await Promise.all(
      list.map(async (b) => {
        const [c, cmp] = await Promise.all([
          this.gh.repos.getCommit({ owner, repo, ref: b.commit.sha }),
          b.name === def ? Promise.resolve(null) : this.gh.repos.compareCommits({ owner, repo, base: def, head: b.name }),
        ]);
        return {
          name: b.name,
          sha: b.commit.sha,
          protected: b.protected,
          isDefault: b.name === def,
          lastCommitAt: c.data.commit.committer?.date ?? c.data.commit.author?.date ?? new Date().toISOString(),
          aheadBy: cmp?.data.ahead_by ?? 0,
        };
      }),
    );
    const pulls = await this.gh.pulls.list({ owner, repo, state: "all", per_page: 50, sort: "updated", direction: "desc" });
    const prs: PR[] = pulls.data.map((p) => ({ number: p.number, title: p.title, head: p.head.ref, base: p.base.ref, state: p.state as "open" | "closed", author: p.user?.login ?? "?" }));

    const charges: Charge[] = [];
    for await (const c of this.stripe.charges.list({ limit: 100, expand: ["data.balance_transaction"] })) {
      if (c.status !== "succeeded") continue;
      const bt = c.balance_transaction as Stripe.BalanceTransaction | null;
      charges.push({
        id: c.id,
        amount: c.amount,
        amountRefunded: c.amount_refunded,
        currency: c.currency,
        email: c.billing_details?.email ?? c.receipt_email ?? null,
        description: c.description ?? "",
        disputed: c.disputed,
        created: new Date(c.created * 1000).toISOString(),
        fee: bt?.fee ?? 0,
      });
      if (charges.length >= 100) break;
    }
    const bal = await this.stripe.balance.retrieve();
    const usd = bal.available.find((b) => b.currency === "usd") ?? bal.available[0];
    return { takenAt: new Date().toISOString(), repo: `${owner}/${repo}`, defaultBranch: def, branches, prs, charges, balance: usd?.amount ?? 0, currency: usd?.currency ?? "usd" };
  }

  async deleteBranch(name: string) {
    await this.gh.git.deleteRef({ owner: this.owner, repo: this.repo, ref: `heads/${name}` });
  }
  async createRef(name: string, sha: string) {
    await this.gh.git.createRef({ owner: this.owner, repo: this.repo, ref: `refs/heads/${name}`, sha });
  }
  async reopenPR(n: number) {
    await this.gh.pulls.update({ owner: this.owner, repo: this.repo, pull_number: n, state: "open" });
  }
  async setPRBase(n: number, base: string) {
    await this.gh.pulls.update({ owner: this.owner, repo: this.repo, pull_number: n, base });
  }
  async refund(chargeId: string, amount: number, idempotencyKey: string) {
    await this.stripe.refunds.create({ charge: chargeId, amount }, { idempotencyKey });
  }
  async settle() {
    await new Promise((r) => setTimeout(r, 2500));
  }
}
