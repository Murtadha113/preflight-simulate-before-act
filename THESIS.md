# Simulation-gated agents: a two-year thesis

**Within two years, "dry run" will stop being a flag and become the default protocol between agents and the systems they touch.**

Today, simulation is something each tool does differently: `terraform plan`, `--dry-run`, staging environments. An agent that acts across ten SaaS APIs has none of them. So it either asks "are you sure?", which is useless at agent speed, or it just acts. Both will look reckless soon.

What I expect:

**1. Platforms ship simulate endpoints.** Stripe, GitHub and every serious API will expose a way to say "what would happen if…" and get back a structured effect set: changed objects, triggered webhooks, emails that will be sent, fees. The first platforms to do this will become the default targets for agent traffic, because agents can use them safely.

**2. The simulation is a contract, and verification enforces it.** A prediction nobody checks is just a story. The pattern that wins is *predict → act → re-read → diff*, with the diff covering everything the agent can observe, not only what it predicted. Gaps get caught by the diff and fed back into the model of the platform. Over time, every agent gets better at predicting each API's side effects. That knowledge is valuable, and it will be shared.

**3. Humans approve effects, not actions.** "Delete 4 branches" is an action. "Close 2 PRs, one belonging to Lina, and make 5 commits unreachable" is an effect. Approvals will be bound cryptographically to an effect set and become invalid if the world changes before execution. Reviewers will narrow plans, not rubber-stamp them.

**4. Irreversibility becomes a priced, first-class property.** Refunds, emails and deletes will carry explicit reversibility. Agents will be allowed to run reversible work fast and will be forced to slow down, batch-halt or escalate on irreversible work.

The open problem: simulators are models, and models are wrong at the edges. The answer isn't a perfect simulator. It's a fast safety net and a simulator that learns from every mismatch.
