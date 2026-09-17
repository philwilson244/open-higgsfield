import { redirect } from "next/navigation";
import { databaseConfigured } from "@/lib/supabase/config";
import { database } from "@/lib/supabase/server";
import { loadWorkspace } from "@/ads/repository";
import { AdStudio } from "@/ads/studio";

export default async function AdsPage() {
  if (!databaseConfigured())
    return <AdStudio mode="preview" brands={[]} campaigns={[]} />;
  const db = await database();
  const { data } = await db.auth.getUser();
  if (!data.user || data.user.is_anonymous) redirect("/ads/login");
  const workspace = await loadWorkspace();
  return <AdStudio mode="cloud" email={data.user.email} {...workspace} />;
}
