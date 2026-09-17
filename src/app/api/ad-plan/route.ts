import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/supabase/server";
import { briefSchema, validationMessage } from "@/ads/schema";
import { rankVideoModels } from "@/ads/model-router";
import { createAdPlan } from "@/ads/plan";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireAccount();
  } catch {
    return NextResponse.json(
      { error: "Sign in to create an ad plan" },
      { status: 401 },
    );
  }
  try {
    const raw = await request.text();
    if (raw.length > 32000)
      return NextResponse.json(
        { error: "Brief is too large" },
        { status: 413 },
      );
    const parsed = briefSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return NextResponse.json(
        { error: validationMessage(parsed.error) },
        { status: 400 },
      );
    const plan = createAdPlan(parsed.data);
    const modelRoutes = plan.variants.map((variant) => ({
      variantId: variant.id,
      shots: variant.beats.map((beat) => ({
        beatId: beat.id,
        models: rankVideoModels({
          target: variant.target,
          shotDurationSeconds: beat.endSeconds - beat.startSeconds,
        }).slice(0, 5),
      })),
    }));
    return NextResponse.json(
      { plan, modelRoutes },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Invalid JSON brief" }, { status: 400 });
  }
}
