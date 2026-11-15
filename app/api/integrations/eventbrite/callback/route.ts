import { NextResponse } from "next/server";
import { requireCompanyAdmin } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { callbackPath, configuration, digest, encrypt, errorCode, EventbriteError, exchange, organizations, sessionBinding, settingsPath } from "@/lib/eventbrite/connection";

export const runtime = "nodejs";
export async function GET(request: Request) {
  let origin: string;
  let stage = "callback-url";
  try { origin = configuration().origin; }
  catch { return new Response("Eventbrite ist noch nicht eingerichtet.", { status: 503 }); }
  let path: string | undefined;
  try {
    const url = new URL(request.url);
    const configuredUrl = new URL(origin);

    const forwardedHost = request.headers.get("x-forwarded-host");
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const requestHost = request.headers.get("host");

    const externalOrigin =
      forwardedHost && forwardedProto
        ? `${forwardedProto}://${forwardedHost}`
        : url.origin;

    if (
      new URL(externalOrigin).origin !== origin ||
      requestHost?.toLowerCase() !== configuredUrl.host.toLowerCase() ||
      url.pathname !== callbackPath
    ) {
      console.error("[eventbrite:callback] URL mismatch", {
        requestOrigin: url.origin,
        externalOrigin,
        expectedOrigin: origin,
        requestHost,
        expectedHost: configuredUrl.host,
        requestPath: url.pathname,
        expectedPath: callbackPath,
      });

      throw new EventbriteError("config");
    }
    stage = "state-validation";
    const state = url.searchParams.get("state");
    if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || url.searchParams.getAll("state").length !== 1) {
      throw new EventbriteError("expired");
    }

    stage = "session-binding";
    const binding = await sessionBinding();
    const db = getPrisma();

    stage = "flow-lookup";
    const flow = await db.eventbriteOAuth.findFirst({
      where: {
        stateHash: digest(state),
        ...binding,
        expiresAt: { gt: new Date() },
      },
      include: { company: { select: { slug: true } } },
    });

    if (!flow) {
      const candidate = await db.eventbriteOAuth.findUnique({
        where: { stateHash: digest(state) },
        select: { userId: true, sessionHash: true, expiresAt: true },
      });

      console.error("[eventbrite:callback] flow not found", {
        rowExists: Boolean(candidate),
        sameUser: candidate?.userId === binding.userId,
        sameSession: candidate?.sessionHash === binding.sessionHash,
        stillValid: candidate ? candidate.expiresAt > new Date() : false,
      });

      throw new EventbriteError("expired");
    }

    stage = "company-admin-check";
    const company = await requireCompanyAdmin(flow.company.slug);
    if (company.id !== flow.companyId) throw new EventbriteError("permission");
    path = settingsPath(company.slug);
    // Atomic consumption before contacting Eventbrite prevents concurrent replay.
    const claimed = await db.eventbriteOAuth.updateMany({ where: { id: flow.id, stateHash: digest(state), ...binding, expiresAt: { gt: new Date() } }, data: { stateHash: null } });
    if (claimed.count !== 1) throw new EventbriteError("expired");
    try {
      if (url.searchParams.has("error")) throw new EventbriteError("denied");
      const code = url.searchParams.get("code");
      if (!code || code.length > 4096 || url.searchParams.getAll("code").length !== 1) throw new EventbriteError("token");
      const token = await exchange(code);
      if (!(await organizations(token)).length) throw new EventbriteError("empty");
      await requireCompanyAdmin(company.slug);
      const saved = await db.eventbriteOAuth.updateMany({ where: { id: flow.id, ...binding, stateHash: null, expiresAt: { gt: new Date() } }, data: { encryptedAccessToken: encrypt(token, company.id) } });
      if (saved.count !== 1) throw new EventbriteError("expired");
    } catch (error) {
      await db.eventbriteOAuth.deleteMany({ where: { id: flow.id } });
      throw error;
    }
  } catch (error) {
    console.error("[eventbrite:callback] rejected", {
      stage,
      reason: errorCode(error),
    });
    if (!path) return new Response("Die Eventbrite-Einrichtung ist ungültig, abgelaufen oder für diese Anmeldung nicht erlaubt. Bitte als Company-Admin in den Einstellungen neu starten.", {
      status: 400, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Type": "text/plain; charset=utf-8" },
    });
    path += `?error=${errorCode(error)}`;
  }
  const response = NextResponse.redirect(new URL(path, origin), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
