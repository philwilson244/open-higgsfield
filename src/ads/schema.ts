import { z } from "zod";
import { AD_TARGETS } from "./platforms";

const text = z.string().trim().min(1).max(2000);
const list = z.preprocess(
  (v) =>
    Array.isArray(v) ? v.filter((x) => typeof x !== "string" || x.trim()) : v,
  z.array(z.string().trim().min(1).max(500)).max(20).default([]),
);
export const channelSchema = z.enum([
  "youtube_shorts",
  "youtube_instream",
  "instagram_reels",
  "tiktok",
  "facebook_feed",
]);
export const briefSchema = z.object({
  brandName: text,
  productName: text,
  audience: text,
  problem: text,
  promise: text,
  callToAction: text,
  goal: z.enum(["awareness", "traffic", "lead", "install", "purchase"]),
  channels: z
    .array(channelSchema)
    .min(1)
    .max(5)
    .transform((v) => [...new Set(v)]),
  offer: z.string().trim().max(2000).optional(),
  proof: list,
  tone: list,
  requiredText: list,
  prohibitedClaims: list,
});
export const brandSchema = z.object({
  name: z.string().trim().min(1).max(100),
  product: text,
  audience: text,
  tone: list,
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  requiredText: list,
  prohibitedClaims: list,
  fonts: list,
  ctaLibrary: list,
  voiceDirection: z.string().trim().max(2000).optional(),
  musicDirection: z.string().trim().max(2000).optional(),
  referenceNotes: z.string().trim().max(4000).optional(),
});
export type BrandKit = z.infer<typeof brandSchema>;

const beatSchema = z.object({
  id: z.string().min(1).max(150),
  kind: z.enum(["hook", "problem", "product", "proof", "offer", "cta"]),
  startSeconds: z.number().finite().min(0).max(120),
  endSeconds: z.number().finite().positive().max(120),
  objective: text,
  visualDirection: text,
  voiceover: z.string().max(2000),
  onScreenText: z.string().max(500).optional(),
});
const variantSchema = z
  .object({
    id: z.string().min(1).max(150),
    name: text,
    hookAngle: text,
    // Delivery settings are controlled by the application, never trusted from the browser.
    target: z
      .object({ channel: channelSchema })
      .transform((v) => ({ ...AD_TARGETS[v.channel] })),
    beats: z.array(beatSchema).min(1).max(20),
  })
  .superRefine((v, ctx) => {
    let cursor = 0;
    const ids = new Set<string>();
    for (const b of v.beats) {
      if (
        Math.abs(b.startSeconds - cursor) > 0.01 ||
        b.endSeconds <= b.startSeconds ||
        ids.has(b.id)
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "Shot times must be positive, continuous, and uniquely identified",
        });
      }
      cursor = b.endSeconds;
      ids.add(b.id);
    }
    if (Math.abs(cursor - v.target.durationSeconds) > 0.01)
      ctx.addIssue({
        code: "custom",
        message: "Shots must fill the placement duration",
      });
  });
export const planSchema = z
  .object({
    brief: briefSchema,
    createdAt: z.iso.datetime(),
    variants: z.array(variantSchema).min(1).max(15),
  })
  .superRefine((p, ctx) => {
    if (
      new Set(p.variants.map((v) => v.id)).size !== p.variants.length ||
      p.variants.some((v) => !p.brief.channels.includes(v.target.channel))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Variants must have unique IDs and match selected placements",
      });
    }
  });
export const campaignSchema = z.object({
  id: z.uuid().optional(),
  revision: z.number().int().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  status: z.enum(["draft", "approved", "archived"]),
  budgetCents: z.number().int().min(0).max(10_000_000).default(0),
  approveProduction: z.boolean().default(false),
  plan: planSchema,
});
export function validationMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return `${issue?.path.join(".") || "Input"}: ${issue?.message || "Invalid value"}`;
}
