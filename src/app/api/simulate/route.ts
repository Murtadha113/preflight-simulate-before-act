import { NextResponse } from "next/server";
import { parseIntent } from "@/lib/intent";
import { LiveProvider, SandboxProvider, liveConfigured } from "@/lib/providers";
import { seedWorld } from "@/lib/sandbox";
import { sign, simulate } from "@/lib/simulate";
import type { Intent, Mode, World } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string; intent?: Intent; mode?: Mode; world?: World; modelVersion?: 1 | 2 };
  const mode: Mode = body.mode === "live" && liveConfigured() ? "live" : "sandbox";
  const intent = body.intent ?? (body.text ? await parseIntent(body.text.slice(0, 500)) : { error: "Describe what you want to do." });
  if ("error" in intent) return NextResponse.json({ error: intent.error }, { status: 422 });

  try {
    const world = body.world ?? seedWorld();
    const provider = mode === "live" ? new LiveProvider() : new SandboxProvider(world);
    const before = await provider.snapshot(); // simulation always starts from real, current state
    const sim = simulate(intent, before, mode, body.modelVersion === 2 ? 2 : 1);
    sim.signature = sign(sim);
    return NextResponse.json({ simulation: sim, world: mode === "sandbox" ? world : undefined });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Simulation failed" }, { status: 502 });
  }
}
