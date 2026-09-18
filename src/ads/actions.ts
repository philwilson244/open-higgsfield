"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/supabase/server";
import { brandSchema, campaignSchema, validationMessage } from "./schema";
import type { Campaign, SavedBrand } from "./repository";

type Result<T> = { data: T; error?: never } | { error: string; data?: never };
function failure(error: unknown) {
  return {
    error:
      error instanceof z.ZodError
        ? validationMessage(error)
        : error instanceof Error
          ? error.message
          : "Could not save. Please try again.",
  };
}
export async function saveBrand(input: unknown): Promise<Result<SavedBrand>> {
  try {
    const kit = brandSchema.parse(input);
    const { db, user } = await requireAccount();
    const { data, error } = await db
      .from("ad_brands")
      .insert({ owner_id: user.id, kit })
      .select("id")
      .single();
    if (error)
      throw new Error(
        "Brand was not saved. Check your connection and database setup.",
      );
    revalidatePath("/ads");
    return { data: { id: data.id, kit } };
  } catch (error) {
    return failure(error);
  }
}
export async function saveCampaign(input: unknown): Promise<Result<Campaign>> {
  try {
    const value = campaignSchema.parse(input);
    const { db, user } = await requireAccount();
    const fields = {
      name: value.name,
      plan: value.plan,
      status: value.status,
      budget_cents: value.budgetCents,
      production_approved_at:
        value.status === "approved" && value.approveProduction
          ? new Date().toISOString()
          : null,
    };
    const query = value.id
      ? db
          .from("ad_campaigns")
          .update(fields)
          .eq("id", value.id)
          .eq("owner_id", user.id)
          .eq("revision", value.revision ?? 0)
      : db.from("ad_campaigns").insert({ ...fields, owner_id: user.id });
    const { data, error } = await query
      .select("id, name, status, revision, updated_at, plan, budget_cents, reserved_cents, spent_cents, production_approved_at")
      .maybeSingle();
    if (error)
      throw new Error(
        "Campaign was not saved. Check your connection and database setup.",
      );
    if (!data)
      throw new Error(
        "This campaign changed in another tab or is unavailable. Reload before saving; your edits have not been overwritten.",
      );
    revalidatePath("/ads");
    return { data: data as Campaign };
  } catch (error) {
    return failure(error);
  }
}
