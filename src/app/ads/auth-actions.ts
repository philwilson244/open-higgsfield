"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { database } from "@/lib/supabase/server";

export async function authenticate(
  input: unknown,
): Promise<{ error?: string; message?: string; signedIn?: boolean }> {
  const parsed = z
    .object({
      email: z.email().max(254),
      password: z.string().min(8).max(128),
      mode: z.enum(["login", "signup"]),
    })
    .safeParse(input);
  if (!parsed.success)
    return {
      error: "Enter a valid email and a password of at least eight characters.",
    };
  try {
    const db = await database();
    const { email, password, mode } = parsed.data;
    if (mode === "login") {
      const { error } = await db.auth.signInWithPassword({ email, password });
      return error
        ? {
            error:
              "Unable to sign in. Check your email, password, and email confirmation.",
          }
        : { signedIn: true };
    }
    const site = process.env.APP_URL;
    if (!site)
      return {
        error: "Account creation needs the app's public URL configured.",
      };
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: new URL("/auth/callback", site).toString() },
    });
    if (error)
      return {
        error:
          "Unable to create an account. Try signing in or wait before trying again.",
      };
    return data.session
      ? { signedIn: true }
      : { message: "Check your email to confirm your account, then sign in." };
  } catch {
    return { error: "Account service is unavailable. Try again shortly." };
  }
}
export async function signOut() {
  const db = await database();
  const { error } = await db.auth.signOut();
  if (error) throw new Error("Could not sign out. Please try again.");
  redirect("/ads/login");
}
