import { NextResponse } from "next/server";
import { executeSimulation } from "@/lib/execute";
import { LiveProvider, SandboxProvider, liveConfigured } from "@/lib/providers";
import { summarize, verifySignature } from "@/lib/simulate";
import type { Simulation, World } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { simulation?: Simulation; selected?: string[]; world?: World };
  const sim = body.simulation;
  if (!sim || !Array.isArray(body.selected)) return NextResponse.json({ error: "simulation and selected[] required" }, { status: 400 });

  // The approval is bound to the exact previewed effects; the reviewer may only narrow the selection.
  if (!verifySignature(sim)) return NextResponse.json({ error: "Simulation was modified after it was previewed — re-simulate." }, { status: 409 });
  if (Date.now() - new Date(sim.createdAt).getTime() > 15 * 60_000) return NextResponse.json({ error: "Simulation is older than 15 minutes — re-simulate against current state." }, { status: 409 });
  const selected = body.selected.filter((id) => sim.items.some((i) => i.id === id && !i.blocked));
  const gated = summarize(sim, selected);
  if (gated.gate.status === "blocked") return NextResponse.json({ error: `Blocked by simulation: ${gated.gate.reasons.join(" ")}` }, { status: 409 });

  try {
    if (sim.mode === "live" && !liveConfigured()) throw new Error("Live mode is not configured on this server");
    const world = body.world;
    if (sim.mode === "sandbox" && !world) throw new Error("Sandbox world missing");
    const provider = sim.mode === "live" ? new LiveProvider() : new SandboxProvider(world!);
    const report = await executeSimulation(provider, sim, selected);
    return NextResponse.json({ report, world: sim.mode === "sandbox" ? (provider as SandboxProvider).world : undefined });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Execution failed" }, { status: 502 });
  }
}
