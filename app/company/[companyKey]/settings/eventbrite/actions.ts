"use server";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireCompanyAdmin } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { configuration, decrypt, digest, errorCode, EventbriteError, organizations, pending, sessionBinding, settingsPath } from "@/lib/eventbrite/connection";

export async function startEventbrite(slug: string) {
  const company = await requireCompanyAdmin(slug);
  let destination: string;
  try {
    const config = configuration(), binding = await sessionBinding();
    const state = randomBytes(32).toString("base64url");
    const data = { ...binding, stateHash: digest(state), encryptedAccessToken: null, expiresAt: new Date(Date.now() + 15 * 60_000) };
    await getPrisma().eventbriteOAuth.upsert({ where: { companyId: company.id }, create: { companyId: company.id, ...data }, update: { ...data, id: randomBytes(24).toString("hex") } });
    const url = new URL("https://www.eventbrite.com/oauth/authorize");
    url.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: config.redirect, state }).toString();
    destination = url.href;
  } catch (error) { redirect(`${settingsPath(slug)}?error=${errorCode(error)}`); }
  redirect(destination);
}

export async function selectEventbriteOrganization(slug: string, form: FormData) {
  const company = await requireCompanyAdmin(slug);
  try {
    const id = z.string().regex(/^\d+$/).parse(form.get("organizationId"));
    const flow = await pending(company.id);
    if (!flow?.encryptedAccessToken || flow.stateHash !== null) throw new EventbriteError("expired");
    const token = decrypt(flow.encryptedAccessToken, company.id);
    const organization = (await organizations(token)).find(org => org.id === id);
    if (!organization) throw new EventbriteError("permission");
    // Re-check access after the external request, before committing the selection.
    await requireCompanyAdmin(slug);
    const binding = await sessionBinding();
    await getPrisma().$transaction(async tx => {
      const claimed = await tx.eventbriteOAuth.deleteMany({ where: { id: flow.id, companyId: company.id, ...binding, encryptedAccessToken: flow.encryptedAccessToken, expiresAt: { gt: new Date() } } });
      if (claimed.count !== 1) throw new EventbriteError("expired");
      const data = { organizationId: organization.id, organizationName: organization.name ?? null, encryptedAccessToken: flow.encryptedAccessToken!, status: "CONNECTED" as const };
      await tx.eventbriteConnection.upsert({ where: { companyId: company.id }, create: { companyId: company.id, ...data }, update: data });
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && error.code === "P2002" ? "conflict" : errorCode(error);
    redirect(`${settingsPath(slug)}?error=${code}`);
  }
  redirect(settingsPath(slug));
}

export async function disconnectEventbrite(slug: string) {
  const company = await requireCompanyAdmin(slug);
  await getPrisma().$transaction(async tx => {
    // Also invalidates any in-flight callback or organization selection.
    await tx.eventbriteOAuth.deleteMany({ where: { companyId: company.id } });
    await tx.eventbriteConnection.deleteMany({ where: { companyId: company.id } });
  });
  redirect(settingsPath(slug));
}

export async function checkEventbrite(slug: string) {
  const company = await requireCompanyAdmin(slug);
  let failure: string | undefined;
  const connection = await getPrisma().eventbriteConnection.findUnique({ where: { companyId: company.id } });
  if (connection) {
    try {
      const available = await organizations(decrypt(connection.encryptedAccessToken, company.id));
      if (!available.some(org => org.id === connection.organizationId)) throw new EventbriteError("permission");
      await requireCompanyAdmin(slug);
      await getPrisma().eventbriteConnection.updateMany({ where: { companyId: company.id, updatedAt: connection.updatedAt }, data: { status: "CONNECTED" } });
    } catch (error) {
      await requireCompanyAdmin(slug);
      failure = errorCode(error);
      if (failure === "token" || failure === "permission") await getPrisma().eventbriteConnection.updateMany({ where: { companyId: company.id, updatedAt: connection.updatedAt }, data: { status: "ERROR" } });
    }
  }
  redirect(`${settingsPath(slug)}${failure ? `?error=${failure}` : ""}`);
}
