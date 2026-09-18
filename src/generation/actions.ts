"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { requireAccount } from "@/lib/supabase/server";
import { databaseConfigured } from "@/lib/supabase/config";
import { encryptSecret, decryptSecret } from "@/lib/secrets";
import { getModel, parseSettings } from "./catalog";
import type { GenerationPlane } from "./catalog/types";
import { MissingCredentialsError, parseCredentialInput } from "./credentials";
import type { StatusResult } from "./platform";
import { createLegacyPlatformProvider } from "./providers/legacy-platform";

const providerId = "higgsfield-platform";
export async function savePlatformCredentials(data: unknown) {
  const { apiKey } = parseCredentialInput(data);
  if (apiKey.length > 4096) throw new Error("API key is too long");
  const { db, user } = await requireAccount();
  const encrypted_key = encryptSecret(apiKey, `${user.id}:${providerId}`);
  const { error } = await db
    .from("ad_provider_accounts")
    .upsert(
      { owner_id: user.id, provider: providerId, encrypted_key },
      { onConflict: "owner_id,provider" },
    );
  if (error) throw new Error("Could not save provider credentials");
  (await cookies()).set("api_key", "", { path: "/", maxAge: 0 });
}
export async function clearPlatformCredentials() {
  const { db, user } = await requireAccount();
  const { error } = await db
    .from("ad_provider_accounts")
    .delete()
    .eq("owner_id", user.id)
    .eq("provider", providerId);
  if (error) throw new Error("Could not remove provider credentials");
  (await cookies()).set("api_key", "", { path: "/", maxAge: 0 });
}
export async function hasPlatformCredentials() {
  if (!databaseConfigured()) return false;
  try {
    const { db, user } = await requireAccount();
    const { data, error } = await db
      .from("ad_provider_accounts")
      .select("provider")
      .eq("owner_id", user.id)
      .eq("provider", providerId)
      .maybeSingle();
    return !error && Boolean(data);
  } catch {
    return false;
  }
}
const mediaItem = z.object({
  id: z.string().max(200),
  url: z
    .url()
    .max(4000)
    .refine((v) => v.startsWith("https://"), "Media must use HTTPS"),
  role: z.enum(["start", "end", "reference", "video", "audio"]),
});
const planeSchema = z.object({
  model: z.string().max(100),
  prompt: z.object({ text: z.string().trim().min(1).max(12000) }),
  media: z.object({
    start: z.array(mediaItem).max(20).optional(),
    end: z.array(mediaItem).max(20).optional(),
    reference: z.array(mediaItem).max(20).optional(),
    video: z.array(mediaItem).max(20).optional(),
    audio: z.array(mediaItem).max(20).optional(),
  }),
  settings: z.record(
    z.string().max(100),
    z.union([z.string().max(100), z.number().finite(), z.boolean()]),
  ),
});
export async function submitGeneration(input: GenerationPlane) {
  await consumeQuota("generation", 1, 0);
  const credentials = await readCredentials();
  const plane = planeSchema.parse(input);
  const model = getModel(plane.model);
  for (const [role, items] of Object.entries(plane.media)) {
    if (items.length > (model.roles[role as keyof typeof model.roles] ?? 0))
      throw new Error("Too many media inputs for this model");
  }
  const parsed: GenerationPlane = {
    ...plane,
    settings: parseSettings(model, plane.settings),
  };
  return createLegacyPlatformProvider(credentials).submit({
    model,
    plane: parsed,
  });
}
export async function getGenerationStatuses(
  data: unknown,
): Promise<StatusResult[]> {
  const { requestIds } = z
    .object({ requestIds: z.array(z.string().min(1).max(200)).min(1).max(60) })
    .parse(data);
  await consumeQuota("status", 1, 0);
  const provider = createLegacyPlatformProvider(await readCredentials());
  return Promise.all(
    [...new Set(requestIds)].map(async (requestId): Promise<StatusResult> => {
      try {
        return { requestId, status: await provider.status(requestId) };
      } catch {
        return {
          requestId,
          error: "Unable to read generation status. Please try again.",
        };
      }
    }),
  );
}
export async function cancelGeneration(data: unknown): Promise<void> {
  const { requestId, cancelUrl } = z.object({
    requestId: z.string().min(1).max(200),
    cancelUrl: z.string().url().max(4000).optional(),
  }).parse(data);
  await consumeQuota("status", 1, 0);
  const provider = createLegacyPlatformProvider(await readCredentials());
  await provider.cancel(requestId, cancelUrl);
}
async function consumeQuota(action: "generation" | "status", units: number, cost: number) {
  const { db } = await requireAccount();
  const { error } = await db.rpc("consume_ad_quota", {
    p_action: action, p_units: units, p_cost_cents: cost,
  });
  if (error) throw new Error(error.message);
}
async function readCredentials() {
  const { db, user } = await requireAccount();
  const { data, error } = await db
    .from("ad_provider_accounts")
    .select("encrypted_key")
    .eq("owner_id", user.id)
    .eq("provider", providerId)
    .maybeSingle();
  if (error) throw new Error("Provider account is unavailable");
  if (!data) throw new MissingCredentialsError();
  const baseUrl = process.env.HF_API_BASE_URL;
  if (!baseUrl || new URL(baseUrl).protocol !== "https:")
    throw new Error("A secure provider API URL must be configured");
  return {
    apiKey: decryptSecret(data.encrypted_key, `${user.id}:${providerId}`),
    baseUrl,
  };
}
