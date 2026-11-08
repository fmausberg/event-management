import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";

export const callbackPath = "/api/integrations/eventbrite/callback";
export const settingsPath = (slug: string) => `/company/${encodeURIComponent(slug)}/settings`;
export class EventbriteError extends Error {
  constructor(public readonly reason: "config" | "session" | "expired" | "denied" | "token" | "permission" | "provider" | "empty" | "conflict") {
    super("Eventbrite-Verbindung nicht verfügbar.");
  }
}
export function errorCode(error: unknown) { return error instanceof EventbriteError ? error.reason : "provider"; }
function key() {
  const value = process.env.EVENTBRITE_TOKEN_ENCRYPTION_KEY ?? "";
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) throw new EventbriteError("config");
  return decoded;
}
export function configuration() {
  try {
    const redirect = new URL(process.env.EVENTBRITE_REDIRECT_URI ?? "");
    const origin = new URL(process.env.AUTH_URL ?? "");
    const localHttp = process.env.NODE_ENV !== "production" && redirect.protocol === "http:" && redirect.hostname === "localhost";
    if ((redirect.protocol !== "https:" && !localHttp) || redirect.origin !== origin.origin || redirect.pathname !== callbackPath || redirect.search || redirect.hash || redirect.username || redirect.password) throw new Error();
    const clientId = process.env.EVENTBRITE_CLIENT_ID?.trim();
    const secret = process.env.EVENTBRITE_CLIENT_SECRET?.trim();
    if (!clientId || !secret) throw new Error();
    key();
    return { redirect: redirect.href, origin: redirect.origin, clientId, secret };
  } catch { throw new EventbriteError("config"); }
}
export function encrypt(token: string, companyId: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`eventbrite:v1:${companyId}`));
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}
export function decrypt(value: string, companyId: string) {
  try {
    const [version, iv, tag, body, extra] = value.split(".");
    if (version !== "v1" || extra || !iv || !tag || !body) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    cipher.setAAD(Buffer.from(`eventbrite:v1:${companyId}`));
    cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([cipher.update(Buffer.from(body, "base64url")), cipher.final()]).toString("utf8");
  } catch { throw new EventbriteError("config"); }
}
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export async function sessionBinding() {
  const session = await auth();
  const jar = await cookies();
  // Include chunked Auth.js JWT cookies. A different login/session cannot finish this attempt.
  const parts = jar.getAll().filter(({ name }) => /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/.test(name)).sort((a, b) => a.name.localeCompare(b.name));
  if (!session?.user?.id || !parts.length) throw new EventbriteError("session");
  return { userId: session.user.id, sessionHash: digest(parts.map(p => `${p.name}=${p.value}`).join(";")) };
}
async function request(url: string, init: RequestInit, oauth = false) {
  let response: Response;
  try { response = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) }); }
  catch { throw new EventbriteError("provider"); }
  if (!response.ok) throw new EventbriteError(response.status === 401 || (oauth && response.status === 400) ? "token" : response.status === 403 ? "permission" : "provider");
  try { return await response.json(); } catch { throw new EventbriteError("provider"); }
}
export async function exchange(code: string) {
  const config = configuration();
  const data = await request("https://www.eventbrite.com/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId, client_secret: config.secret, code, redirect_uri: config.redirect }),
  }, true);
  const parsed = z.object({ access_token: z.string().min(1).max(8192) }).safeParse(data);
  if (!parsed.success) throw new EventbriteError("token");
  return parsed.data.access_token;
}
const organizationSchema = z.object({ id: z.string().regex(/^\d+$/), name: z.string().max(1000).nullish() });
const listSchema = z.object({ organizations: z.array(organizationSchema), pagination: z.object({ has_more_items: z.boolean(), continuation: z.string().nullish() }) });
export async function organizations(token: string) {
  const result: z.infer<typeof organizationSchema>[] = [];
  let continuation: string | undefined;
  for (let page = 1; page <= 100; page++) {
    const query = continuation ? `?${new URLSearchParams({ continuation })}` : "";
    const raw = await request(`https://www.eventbriteapi.com/v3/users/me/organizations/${query}`, { headers: { Authorization: `Bearer ${token}` } });
    const parsed = listSchema.safeParse(raw);
    if (!parsed.success) throw new EventbriteError("provider");
    result.push(...parsed.data.organizations);
    if (!parsed.data.pagination.has_more_items) return result;
    const next = parsed.data.pagination.continuation;
    if (!next || next === continuation) throw new EventbriteError("provider");
    continuation = next;
  }
  throw new EventbriteError("provider");
}
export async function pending(companyId: string) {
  const binding = await sessionBinding();
  return getPrisma().eventbriteOAuth.findFirst({ where: { companyId, ...binding, expiresAt: { gt: new Date() } } });
}
