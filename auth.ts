import "server-only";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { getPrisma } from "@/lib/db/prisma";
import { emailSchema, loginSchema } from "@/lib/auth/validation";
import { verifyPassword } from "@/lib/auth/password";
import { findUserByEmail } from "@/lib/auth/users";
import { consumeAuthAttempt } from "@/lib/auth/rate-limit";
import { getOAuthProviders } from "@/lib/auth/providers";
import { claimMemberships } from "@/lib/companies/claim-memberships";

class RateLimited extends CredentialsSignin { code = "rate_limited"; }

// Lazy configuration preserves builds without a database connection.
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const adapter = PrismaAdapter(getPrisma());
  const oauth = getOAuthProviders();
  return {
    adapter: {
      ...adapter,
      getUserByEmail: findUserByEmail,
      createUser: (data) => adapter.createUser!({ ...data, email: emailSchema.parse(data.email) }),
      updateUser: (data) => adapter.updateUser!({
        ...data, ...(data.email ? { email: emailSchema.parse(data.email) } : {}),
      }),
    },
    // Auth.js Credentials requires JWT sessions, even when using an adapter.
    session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
    useSecureCookies: process.env.NODE_ENV === "production" || process.env.AUTH_URL?.startsWith("https://"),
    pages: { signIn: "/login", error: "/login" },
    providers: [
      ...oauth.map(({ id }) => id === "google" ? Google({}) : GitHub({})),
      Credentials({
        credentials: { email: { type: "email" }, password: { type: "password" } },
        async authorize(credentials) {
          const parsed = loginSchema.safeParse(credentials);
          if (!parsed.success) return null;
          const { email, password } = parsed.data;
          if (!await consumeAuthAttempt(email, "login")) throw new RateLimited();
          const user = await findUserByEmail(email);
          if (!await verifyPassword(password, user?.passwordHash ?? null) || !user) return null;
          return { id: user.id, name: user.name, email: user.email, image: user.image };
        },
      }),
    ],
    callbacks: {
      async signIn({ user, account }) {
        if (account?.provider === "credentials") return true;
        const parsed = emailSchema.safeParse(user.email);
        if (!parsed.success) return false;
        user.email = parsed.data;
        // Keep Auth.js' default protection against automatic email account linking.
        return true;
      },
      async jwt({ token, user }) {
        if (user) token.sub = user.id;
        if (!token.sub) return null;
        const existing = await getPrisma().user.findUnique({
          where: { id: token.sub }, select: { id: true, email: true, emailVerified: true },
        });
        if (existing) await claimMemberships(existing);
        return existing ? token : null;
      },
      session({ session, token }) {
        if (session.user && token.sub) session.user.id = token.sub;
        return session;
      },
    },
  };
});
