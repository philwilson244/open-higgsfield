"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/supabase/server";
import { brandSchema, campaignSchema, validationMessage } from "./schema";
import type { Campaign, SavedBrand } from "./repository";
import type { BrandAsset } from "./brand-assets";

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
    const { id, revision, kit } = z.object({
      id: z.uuid().optional(),
      revision: z.number().int().positive().optional(),
      kit: brandSchema,
    }).refine((value) => !value.id || value.revision !== undefined, {
      message: "Brand revision is required for updates",
    }).parse(input);
    const { db, user } = await requireAccount();
    if (!id) {
      const { data: existing, error: lookupError } = await db.from("ad_brands")
        .select("kit").eq("owner_id", user.id).limit(100);
      if (lookupError) throw new Error("Could not check saved brand kits. Try again.");
      if (existing?.some((brand) =>
        String((brand.kit as { name?: unknown })?.name ?? "").trim().toLowerCase() === kit.name.toLowerCase()))
        throw new Error(`${kit.name} is already saved. Open it under Your saved kits to edit it, or choose a different name.`);
    }
    const query = id
      ? db.from("ad_brands").update({ kit }).eq("id", id).eq("owner_id", user.id).eq("revision", revision!)
      : db.from("ad_brands").insert({ owner_id: user.id, kit });
    const { data, error } = await query.select("id, kit, revision, updated_at").maybeSingle();
    if (error) throw new Error("Brand was not saved. Check your connection and database setup.");
    if (!data) throw new Error("This brand changed in another tab or is unavailable. Reload before saving.");
    revalidatePath("/ads");
    return { data: { id: data.id, kit: brandSchema.parse(data.kit), revision: data.revision, updated_at: data.updated_at } };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteBrand(id: string): Promise<Result<undefined>> {
  try {
    const brandId = z.uuid().parse(id);
    const { db, user } = await requireAccount();
    const { data: assets, error: assetError } = await db.from("ad_assets")
      .select("id, storage_bucket, storage_path").eq("brand_id", brandId).eq("owner_id", user.id);
    if (assetError) throw new Error("Could not check the brand assets. Try again.");
    if (assets?.length) {
      const paths = assets.map((asset) => asset.storage_path);
      const removed = await db.storage.from("ad-production").remove(paths);
      if (removed.error) throw new Error("Could not remove the brand files. Try again.");
      const deleted = await db.from("ad_assets").delete().eq("brand_id", brandId).eq("owner_id", user.id);
      if (deleted.error) throw new Error("Could not remove the brand file records. Try again.");
    }
    const { data, error } = await db.from("ad_brands").delete()
      .eq("id", brandId).eq("owner_id", user.id).select("id").maybeSingle();
    if (error) throw new Error("Could not delete the brand kit. Try again.");
    if (!data) throw new Error("Brand kit not found.");
    revalidatePath("/ads");
    return { data: undefined };
  } catch (error) {
    return failure(error);
  }
}

export async function getBrandAssets(id: string): Promise<Result<BrandAsset[]>> {
  try {
    const brandId = z.uuid().parse(id);
    const { db, user } = await requireAccount();
    const { data, error } = await db.from("ad_assets")
      .select("id, brand_id, kind, filename, mime_type, storage_bucket, storage_path")
      .eq("brand_id", brandId).eq("owner_id", user.id)
      .in("kind", ["logo", "reference", "screenshot"])
      .order("created_at", { ascending: false });
    if (error) throw new Error("Could not load brand files.");
    const assets = await Promise.all((data ?? []).map(async (asset) => {
      const { data: signed, error: signError } = await db.storage.from(asset.storage_bucket)
        .createSignedUrl(asset.storage_path, 3600);
      if (signError) throw new Error("Could not open a brand file.");
      return {
        id: asset.id,
        brand_id: asset.brand_id,
        kind: asset.kind,
        filename: asset.filename,
        mime_type: asset.mime_type,
        signedUrl: signed.signedUrl,
      } as BrandAsset;
    }));
    return { data: assets };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteBrandAsset(id: string): Promise<Result<undefined>> {
  try {
    const assetId = z.uuid().parse(id);
    const { db, user } = await requireAccount();
    const { data: asset, error } = await db.from("ad_assets")
      .select("id, storage_bucket, storage_path").eq("id", assetId).eq("owner_id", user.id)
      .in("kind", ["logo", "reference", "screenshot"]).maybeSingle();
    if (error || !asset) throw new Error("Brand file not found.");
    const removed = await db.storage.from(asset.storage_bucket).remove([asset.storage_path]);
    if (removed.error) throw new Error("Could not delete the file. Try again.");
    const deleted = await db.from("ad_assets").delete().eq("id", assetId).eq("owner_id", user.id);
    if (deleted.error) throw new Error("Could not remove the file record. Try again.");
    return { data: undefined };
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
