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
        externalOriginMatches: new URL(externalOrigin).origin === origin,
        hostMatches: requestHost?.toLowerCase() === configuredUrl.host.toLowerCase(),
        pathMatches: url.pathname === callbackPath,
      });

      throw new EventbriteError("config");
    }
    stage = "state-validation";
    const state = url.searchParams.get("state");
    if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || url.searchParams.getAll("state").length !== 1) {
      throw new EventbriteError("expired");
    }

    const db = getPrisma();

    stage = "flow-lookup";
    const flow = await db.eventbriteOAuth.findFirst({
      where: {
        stateHash: digest(state),
      },
      include: { company: { select: { slug: true } } },
    });

    if (!flow) {
      throw new EventbriteError("expired");
    }

    stage = "company-admin-check";
    const company = await requireCompanyAdmin(flow.company.slug);
    if (company.id !== flow.companyId) throw new EventbriteError("permission");
    path = settingsPath(company.slug);
    stage = "session-binding";
    const binding = await sessionBinding();
    if (flow.userId !== binding.userId || flow.sessionHash !== binding.sessionHash) throw new EventbriteError("session");
    if (flow.expiresAt <= new Date()) throw new EventbriteError("expired");
    stage = "state-consumption";
    // Atomic consumption before contacting Eventbrite prevents concurrent replay.
    const claimed = await db.eventbriteOAuth.updateMany({ where: { id: flow.id, companyId: company.id, stateHash: digest(state), ...binding, expiresAt: { gt: new Date() } }, data: { stateHash: null } });
    if (claimed.count !== 1) throw new EventbriteError("expired");
    try {
      stage = "authorization-response";
      if (url.searchParams.has("error")) throw new EventbriteError("denied");
      const code = url.searchParams.get("code");
      if (!code || code.length > 4096 || url.searchParams.getAll("code").length !== 1) throw new EventbriteError("token");
      stage = "token-exchange";
      const token = await exchange(code);
      stage = "organizations";
      const available = await organizations(token);
      if (!available.length) throw new EventbriteError("empty");
      stage = "company-admin-recheck";
      await requireCompanyAdmin(company.slug);
      stage = "pending-save";
      const saved = await db.eventbriteOAuth.updateMany({ where: { id: flow.id, companyId: company.id, ...binding, stateHash: null, expiresAt: { gt: new Date() } }, data: { encryptedAccessToken: encrypt(token, company.id) } });
      if (saved.count !== 1) throw new EventbriteError("expired");
      console.info("[eventbrite:callback] pending saved", { stage: "pending-save", organizationCount: available.length });
      path += "?eventbrite=pending";
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
  const response = NextResponse.redirect(new URL(path!, origin), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
