"use server";

import { CredentialsSignin } from "next-auth";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { getPrisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { findUserByEmail } from "@/lib/auth/users";
import { consumeAuthAttempt } from "@/lib/auth/rate-limit";
import { getOAuthProviders } from "@/lib/auth/providers";
import { claimMemberships } from "@/lib/companies/claim-memberships";
import { loginSchema, registerSchema, type AuthFormState } from "@/lib/auth/validation";

export async function login(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const result = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!result.success) return { errors: result.error.flatten().fieldErrors };
  try {
    await signIn("credentials", { ...result.data, redirect: false, redirectTo: "/account" });
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      return { message: error.code === "rate_limited"
        ? "Zu viele Anmeldeversuche. Bitte versuche es in 15 Minuten erneut."
        : "E-Mail-Adresse oder Passwort ist falsch." };
    }
    return { message: "Die Anmeldung ist gerade nicht möglich. Bitte versuche es später erneut." };
  }
  redirect("/account");
}

export async function register(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const result = registerSchema.safeParse({
    name: formData.get("name"), email: formData.get("email"),
    password: formData.get("password"), confirmPassword: formData.get("confirmPassword"),
  });
  if (!result.success) return { errors: result.error.flatten().fieldErrors };
  const unavailable = "Für diese E-Mail-Adresse kann kein neues Konto erstellt werden. Versuche, dich mit deinem bisherigen Passwort oder OAuth-Anbieter anzumelden.";
  try {
    if (!await consumeAuthAttempt(result.data.email, "register")) {
      return { message: "Zu viele Registrierungsversuche. Bitte versuche es in 15 Minuten erneut." };
    }
    const passwordHash = await hashPassword(result.data.password);
    if (await findUserByEmail(result.data.email)) return { message: unavailable };
    const user = await getPrisma().user.create({
      data: { name: result.data.name, email: result.data.email, passwordHash },
      select: { id: true },
    });
    // A failed claim must not report an already-created account as a failed
    // registration. The JWT callback retries pending assignments on login.
    try { await claimMemberships({ id: user.id, email: result.data.email, emailVerified: null }); }
    catch { console.error("Pending account assignments could not be linked; retry on login."); }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { message: unavailable };
    }
    return { message: "Die Registrierung ist gerade nicht möglich. Bitte versuche es später erneut." };
  }
  redirect("/login?registered=1");
}

export async function oauthLogin(formData: FormData) {
  const provider = formData.get("provider");
  if (typeof provider !== "string" || !getOAuthProviders().some(({ id }) => id === provider)) {
    redirect("/login?error=Configuration");
  }
  let destination: string;
  try {
    destination = await signIn(provider, { redirect: false, redirectTo: "/account" });
  } catch {
    redirect("/login?error=OAuthSignin");
  }
  redirect(destination);
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
