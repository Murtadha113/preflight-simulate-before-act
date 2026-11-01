import { NextResponse } from "next/server";
import { liveConfigured } from "@/lib/providers";

export async function GET() {
  return NextResponse.json({ live: liveConfigured(), repo: process.env.GITHUB_REPO ?? null, model: Boolean(process.env.ANTHROPIC_API_KEY) });
}
