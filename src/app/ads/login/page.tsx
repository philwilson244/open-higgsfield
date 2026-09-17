import Link from "next/link";
import { redirect } from "next/navigation";
import { databaseConfigured } from "@/lib/supabase/config";
import { database } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!databaseConfigured()) redirect("/ads");
  const db = await database();
  const { data } = await db.auth.getUser();
  if (data.user && !data.user.is_anonymous) redirect("/ads");
  const params = await searchParams;
  return (
    <main className="ads-shell ads-login">
      <Link href="/">← Generation studio</Link>
      <p className="ads-eyebrow">AD STUDIO / YOUR WORKSPACE</p>
      <h1>Your next ad starts here.</h1>
      <p>Save brands, develop concepts, and shape every shot.</p>
      <LoginForm confirmationError={Boolean(params.error)} />
    </main>
  );
}
