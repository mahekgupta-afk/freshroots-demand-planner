"use server";

import { redirect } from "next/navigation";
import { neonQuery } from "@/lib/db/server";
import { authenticate } from "@/lib/auth/login";
import { createSession, deleteSession } from "@/lib/auth/session";

export async function login(_prev: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const result = await authenticate(neonQuery(), email, password);
  if (!result.ok) return { error: result.error };

  await createSession(result.session);
  redirect("/");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
