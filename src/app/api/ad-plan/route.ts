import { NextResponse } from "next/server";

import { rankVideoModels } from "@/ads/model-router";
import { createAdPlan } from "@/ads/plan";
import type { AdBrief, AdChannel, AdGoal } from "@/ads/types";

const CHANNELS = new Set<AdChannel>([
  "youtube_shorts",
  "youtube_instream",
  "instagram_reels",
  "tiktok",
  "facebook_feed",
]);

const GOALS = new Set<AdGoal>(["awareness", "traffic", "lead", "install", "purchase"]);

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const brief = parseBrief(await request.json());
    const plan = createAdPlan(brief);
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

    return NextResponse.json({ plan, modelRoutes });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Invalid ad brief";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function parseBrief(input: unknown): AdBrief {
  const value = asRecord(input);
  const channels = stringArray(value.channels, "channels").filter(
    (channel): channel is AdChannel => CHANNELS.has(channel as AdChannel),
  );
  if (channels.length === 0) throw new Error("Choose at least one supported channel");

  const goal = requiredString(value.goal, "goal") as AdGoal;
  if (!GOALS.has(goal)) throw new Error("Unsupported campaign goal");

  return {
    brandName: requiredString(value.brandName, "brandName"),
    productName: requiredString(value.productName, "productName"),
    audience: requiredString(value.audience, "audience"),
    problem: requiredString(value.problem, "problem"),
    promise: requiredString(value.promise, "promise"),
    callToAction: requiredString(value.callToAction, "callToAction"),
    goal,
    channels: [...new Set(channels)],
    ...optionalString(value.offer, "offer"),
    ...optionalArray(value.proof, "proof"),
    ...optionalArray(value.tone, "tone"),
    ...optionalArray(value.requiredText, "requiredText"),
    ...optionalArray(value.prohibitedClaims, "prohibitedClaims"),
  };
}

function asRecord(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Ad brief must be a JSON object");
  }
  return input as Record<string, unknown>;
}

function requiredString(input: unknown, field: string): string {
  if (typeof input !== "string" || !input.trim()) throw new Error(`Missing ${field}`);
  return input.trim().slice(0, 2_000);
}

function stringArray(input: unknown, field: string): string[] {
  if (!Array.isArray(input)) throw new Error(`${field} must be an array`);
  return input.map((item) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${field} must contain strings`);
    }
    return item.trim().slice(0, 500);
  });
}

function optionalString(input: unknown, field: "offer"): Pick<AdBrief, "offer"> | object {
  return input === undefined ? {} : { [field]: requiredString(input, field) };
}

function optionalArray(
  input: unknown,
  field: "proof" | "tone" | "requiredText" | "prohibitedClaims",
): Partial<AdBrief> {
  return input === undefined ? {} : { [field]: stringArray(input, field).slice(0, 20) };
}
