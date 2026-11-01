// Natural language → a typed intent. The model only fills a schema; the simulator does the rest.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { PRESETS } from "./presets";
import type { Intent } from "./types";

export { PRESETS };

const IntentSchema = z.object({
  kind: z.enum(["github.delete_branches", "stripe.refund", "unsupported"]),
  olderThanDays: z.number().describe("branches: only branches whose last commit is at least this many days old; 0 if not stated"),
  onlyMerged: z.boolean().describe("branches: true if the user only wants branches already merged into the default branch"),
  namePattern: z.string().describe("branches: glob like 'feature/*', or empty string"),
  descriptionContains: z.string().describe("refunds: text the charge description must contain"),
  percent: z.number().describe("refunds: percent of each charge to refund, 100 if full"),
  summary: z.string().describe("One-line restatement of what will happen, in plain English"),
});

export async function parseIntent(text: string): Promise<Intent | { error: string }> {
  const preset = PRESETS.find((p) => p.text.toLowerCase() === text.trim().toLowerCase());
  if (preset) return preset.intent;
  if (!process.env.ANTHROPIC_API_KEY) return heuristicIntent(text);

  const client = new Anthropic();
  try {
    const res = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(IntentSchema) },
      system:
        "Translate an operator's request into a structured intent for a simulation-gated agent. Supported: deleting GitHub branches, refunding Stripe charges. Anything else is 'unsupported'. Never widen scope beyond what was asked.",
      messages: [{ role: "user", content: text }],
    });
    const p = res.parsed_output;
    if (!p || res.stop_reason === "refusal") return heuristicIntent(text);
    if (p.kind === "unsupported") return { error: `Not supported yet: ${p.summary}` };
    if (p.kind === "github.delete_branches")
      return { kind: p.kind, olderThanDays: Math.max(0, p.olderThanDays), onlyMerged: p.onlyMerged, namePattern: p.namePattern || undefined, summary: p.summary };
    return { kind: p.kind, descriptionContains: p.descriptionContains, percent: Math.min(100, Math.max(1, p.percent || 100)), summary: p.summary };
  } catch {
    return heuristicIntent(text);
  }
}

function heuristicIntent(text: string): Intent | { error: string } {
  const t = text.toLowerCase();
  if (/branch/.test(t) && /(delete|remove|clean)/.test(t)) {
    const days = Number(t.match(/(\d+)\s*day/)?.[1] ?? 30);
    return { kind: "github.delete_branches", olderThanDays: days, onlyMerged: /merged/.test(t), summary: `Delete branches inactive for ${days}+ days${/merged/.test(t) ? " (merged only)" : ""}` };
  }
  if (/refund/.test(t)) {
    const pct = Number(t.match(/(\d+)\s*%/)?.[1] ?? 100);
    const about = t.match(/(?:for|mention(?:s|ing)?|containing)\s+(?:the\s+)?["']?([a-z0-9 \-–]+?)["']?(?:\s+(?:during|in|on)\b|$)/)?.[1]?.trim() ?? "outage window";
    return { kind: "stripe.refund", descriptionContains: /outage/.test(t) ? "outage window" : about, percent: pct, summary: `Refund ${pct}% of charges mentioning "${/outage/.test(t) ? "outage window" : about}"` };
  }
  return { error: "Without an ANTHROPIC_API_KEY only the presets and simple 'delete branches…' / 'refund…' requests are understood." };
}
