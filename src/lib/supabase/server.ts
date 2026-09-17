import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { databaseConfigured } from "./config";

export async function database() {
  if (!databaseConfigured())
    throw new Error("Cloud saving is not configured yet");
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll(values) {
          try {
            values.forEach(({ name, value, options }) =>
              jar.set(name, value, options),
            );
          } catch {
            /* Server Components are read-only. Proxy performs session refresh. */
          }
        },
      },
    },
  );
}

export async function requireAccount() {
  const db = await database();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user || data.user.is_anonymous)
    throw new Error("Sign in at /ads/login to continue");
  return { db, user: data.user };
}
