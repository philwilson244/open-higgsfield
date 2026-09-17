import test from "node:test";
import assert from "node:assert/strict";
import {
  briefSchema,
  planSchema,
  campaignSchema,
  brandSchema,
} from "../src/ads/schema";
import { createAdPlan } from "../src/ads/plan";
import { rankVideoModels } from "../src/ads/model-router";
import { AD_TARGETS } from "../src/ads/platforms";
import {
  retimeBeat,
  shotPrompt,
  storyboardWarnings,
} from "../src/ads/storyboard";
import { encryptSecret, decryptSecret } from "../src/lib/secrets";
import { createPlatformClient } from "../src/generation/platform";
import type { ModelEntry } from "../src/generation/catalog/types";

const brief = briefSchema.parse({
  brandName: "Fullcourt",
  productName: "Fullcourt",
  audience: "Basketball organizers",
  problem: "Scattered group chats",
  promise: "Organize a run in one place",
  callToAction: "Create your game",
  channels: ["youtube_shorts", "instagram_reels"],
  goal: "install",
});
test("three editable concepts per placement with continuous timing", () => {
  for (const offer of [undefined, "Book a demo"]) {
    const plan = createAdPlan({ ...brief, offer });
    assert.equal(plan.variants.length, 6);
    assert.ok(planSchema.safeParse(plan).success);
    for (const variant of plan.variants)
      assert.equal(
        variant.beats.at(-1)?.endSeconds,
        variant.target.durationSeconds,
      );
  }
});
test("rejects unsupported channels, oversized arrays, missing fields and malformed types", () => {
  for (const patch of [
    { channels: ["unknown"] },
    { channels: [] },
    { proof: [123] },
    { brandName: "" },
    { audience: "a".repeat(2001) },
    { tone: Array(21).fill("warm") },
  ]) {
    assert.equal(briefSchema.safeParse({ ...brief, ...patch }).success, false);
  }
  assert.equal(
    briefSchema.parse({
      ...brief,
      channels: ["tiktok", "tiktok"],
      proof: ["real", ""],
    }).channels.length,
    1,
  );
});
test("rejects invalid brand colors and empty brand names", () => {
  assert.equal(
    brandSchema.safeParse({ name: "", color: "red" }).success,
    false,
  );
});
test("rejects duplicate IDs and noncontinuous or negative timing", () => {
  const plan = createAdPlan(brief);
  plan.variants[0]!.beats[0]!.endSeconds = -1;
  assert.equal(planSchema.safeParse(plan).success, false);
  const duplicate = createAdPlan(brief);
  duplicate.variants[1]!.id = duplicate.variants[0]!.id;
  assert.equal(planSchema.safeParse(duplicate).success, false);
});
test("replaces tampered delivery settings with controlled presets", () => {
  const plan = createAdPlan(brief);
  plan.variants[0]!.target = { ...plan.variants[0]!.target, width: 12 };
  assert.equal(planSchema.parse(plan).variants[0]!.target.width, 1080);
});
test("campaign validation rejects invalid revisions and status", () => {
  assert.equal(
    campaignSchema.safeParse({
      name: "Test",
      status: "published",
      plan: createAdPlan(brief),
    }).success,
    false,
  );
  assert.equal(
    campaignSchema.safeParse({
      name: "Test",
      status: "draft",
      revision: 0,
      plan: createAdPlan(brief),
    }).success,
    false,
  );
});
test("short beats get trimmable source clips, never fractional unsupported durations", () => {
  const routes = rankVideoModels({
    target: AD_TARGETS.instagram_reels,
    shotDurationSeconds: 1.95,
  });
  assert.ok(routes.length > 0);
  for (const r of routes) {
    assert.ok(r.renderDurationSeconds >= 1.95);
    assert.ok(Number.isInteger(r.renderDurationSeconds));
    assert.ok(r.requiresTrim);
  }
  assert.ok(routes.some((r) => r.modelId === "seedance-2"));
  assert.equal(
    rankVideoModels({ target: AD_TARGETS.tiktok, shotDurationSeconds: NaN })
      .length,
    0,
  );
});
test("router excludes image-only, source-video-only, and unknown duration models", () => {
  const model: ModelEntry = {
    id: "test",
    label: "Test",
    surface: "video",
    roles: {},
    settings: {
      aspectRatio: { type: "enum", values: ["9:16"], default: "9:16" },
      duration: { type: "range", min: 3, max: 8, default: 5 },
    },
    paths: { image: "only-image" },
  };
  const req = { target: AD_TARGETS.tiktok, shotDurationSeconds: 4 };
  assert.equal(rankVideoModels(req, [model]).length, 0);
  assert.equal(
    rankVideoModels(req, [{ ...model, paths: { text: "text" } }]).length,
    1,
  );
  assert.equal(
    rankVideoModels({ ...req, requireNativeAudio: true }, [
      { ...model, paths: { text: "text" } },
    ]).length,
    0,
  );
});
test("feed crops are explicitly flagged", () => {
  const routes = rankVideoModels({
    target: AD_TARGETS.facebook_feed,
    shotDurationSeconds: 3,
  });
  assert.ok(
    routes.some((r) => r.requiresCrop && r.renderAspectRatio === "9:16"),
  );
});
test("retiming preserves total duration and rejects invalid neighbor timing", () => {
  const variant = createAdPlan(brief).variants[0]!;
  const changed = retimeBeat(variant, 0, 3);
  assert.equal(changed.beats[0]!.endSeconds, 3);
  assert.equal(changed.beats[1]!.startSeconds, 3);
  assert.equal(changed.beats.at(-1)!.endSeconds, 30);
  assert.throws(() => retimeBeat(variant, 0, 25));
  assert.throws(() => retimeBeat(variant, 0, Infinity));
});
test("review checks required copy, unsupported claims, and speaking time", () => {
  const restricted = {
    ...brief,
    prohibitedClaims: ["guaranteed"],
    requiredText: ["Terms apply"],
  };
  const variant = createAdPlan(restricted).variants[0]!;
  variant.beats[0]!.voiceover = "guaranteed ".repeat(40);
  const warnings = storyboardWarnings(restricted, variant);
  for (const term of [
    "Required copy",
    "Restricted phrase",
    "voiceover",
    "evidence",
  ])
    assert.ok(warnings.some((w) => w.includes(term)));
  assert.ok(
    shotPrompt(restricted, variant.beats[0]!).includes(
      "Do not claim or depict: guaranteed",
    ),
  );
});
test("encryption has unique nonces and rejects tampering or another account", () => {
  process.env.PROVIDER_ENCRYPTION_KEY = "ab".repeat(32);
  try {
    const value = encryptSecret("test:secret", "account-a:provider");
    assert.equal(decryptSecret(value, "account-a:provider"), "test:secret");
    assert.notEqual(value, encryptSecret("test:secret", "account-a:provider"));
    assert.ok(!value.includes("test:secret"));
    assert.throws(() => decryptSecret(value, "account-b:provider"));
    assert.throws(() =>
      decryptSecret(value.slice(0, -4), "account-a:provider"),
    );
  } finally {
    delete process.env.PROVIDER_ENCRYPTION_KEY;
  }
  assert.throws(() => encryptSecret("value", "context"));
});
test("provider requests keep upstream contract with timeout and no redirect forwarding", async () => {
  const client = createPlatformClient({
    apiKey: "test:secret",
    baseUrl: "https://provider.example",
    fetch: (async (url, init) => {
      assert.equal(url, "https://provider.example/model");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.cache, "no-store");
      assert.ok(init?.signal);
      return Response.json({ request_id: "job-123", status: "queued" });
    }) as typeof fetch,
  });
  assert.equal(
    (await client.submit("model", { prompt: "test" })).requestId,
    "job-123",
  );
});
