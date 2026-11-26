import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { companyRecipients, type CompanyMessage } from "./notifications";
import { accountOrigin } from "@/lib/auth/verification";
import { encryptPaymentMail } from "@/lib/payments/mail";
import { escapeHtml } from "@/lib/mail/templates/footer";

/** Called once per committed publication transition, inside its transaction. */
export async function queueEventPublication(tx: Prisma.TransactionClient, eventId: string) {
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, include: { company: { select: { slug: true } }, venue: true } });
  const recipients = await companyRecipients(tx, event.companyId, "notifyEventPublications");
  if (!recipients.length) return;
  const occurrence = randomUUID();
  const publicUrl = `${accountOrigin()}/events/${encodeURIComponent(event.company.slug)}/${encodeURIComponent(event.id)}`;
  const manageUrl = `${accountOrigin()}/company/${encodeURIComponent(event.company.slug)}/events/${encodeURIComponent(event.id)}`;
  const beginsAt = event.beginsAt ? new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Berlin" }).format(event.beginsAt) + " Uhr" : "Noch offen";
  const venue = event.venue;
  const location = venue ? [venue.name, venue.addressLine1, venue.addressLine2, [venue.postalCode, venue.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "Ort noch offen";
  const subject = `Event veröffentlicht: ${event.name}`;
  const facts = [event.name, beginsAt, location].join("\n");
  for (const to of recipients) {
    const message: CompanyMessage = {
      to, subject,
      text: `${facts}\n\nEvent öffentlich ansehen: ${publicUrl}\nEvent verwalten: ${manageUrl}`,
      html: `<div style="max-width:600px;margin:auto;font-family:Arial,sans-serif;line-height:1.6"><h1>${escapeHtml(subject)}</h1><p style="white-space:pre-wrap">${escapeHtml(facts)}</p><p><a href="${escapeHtml(publicUrl)}">Event öffentlich ansehen</a><br><a href="${escapeHtml(manageUrl)}">Event verwalten</a></p></div>`,
      companyNotification: { companyId: event.companyId, type: "notifyEventPublications" },
    };
    await tx.mailOutbox.create({ data: { requestKey: `event-publication:${event.id}:${occurrence}:${to}`, kind: "COMPANY_NOTIFICATION", encryptedMessage: encryptPaymentMail(message) } });
  }
}
