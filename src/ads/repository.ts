import "server-only";
import { requireAccount } from "@/lib/supabase/server";
import { brandSchema, planSchema, type BrandKit } from "./schema";
import type { AdPlan } from "./types";

export type SavedBrand = { id: string; kit: BrandKit };
export type Campaign = {
  id: string;
  name: string;
  status: "draft" | "approved" | "archived";
  revision: number;
  updated_at: string;
  plan: AdPlan;
};
export async function loadWorkspace() {
  const { db, user } = await requireAccount();
  const [brands, campaigns] = await Promise.all([
    db
      .from("ad_brands")
      .select("id, kit")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(100),
    db
      .from("ad_campaigns")
      .select("id, name, status, revision, updated_at, plan")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(100),
  ]);
  if (brands.error || campaigns.error)
    throw new Error(
      "Cannot load your workspace. Check the Ad Studio database migration and connection.",
    );
  return {
    brands: (brands.data ?? []).map((b) => ({
      id: b.id as string,
      kit: brandSchema.parse(b.kit),
    })),
    campaigns: (campaigns.data ?? []).map((c) => ({
      ...c,
      plan: planSchema.parse(c.plan),
    })) as Campaign[],
  };
}
