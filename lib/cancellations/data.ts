import "server-only";
import { getPrisma } from "@/lib/db/prisma";
import { requireCompanyAccess } from "@/lib/companies/members";
import { cancellationActor } from "./service";

const voucherStatus = {
  voucherRedemption: { select: { status: true, limitReturnedAt: true } },
  voucherBalanceUses: { select: { id: true, status: true, restoredMinor: true, currency: true } },
} as const;

export async function getMyBookings() {
  const userId = await cancellationActor();
  return getPrisma().booking.findMany({ where: { userId }, orderBy: [{ bookedAt: "desc" }, { id: "asc" }], select: {
    ...voucherStatus, id: true, number: true, quantity: true, status: true,
    event: { select: { id: true, name: true, status: true, beginsAt: true, endsAt: true, freeCancellationUntilMinutesBeforeStart: true,
      company: { select: { name: true, slug: true } },
      venue: { select: { name: true, addressLine1: true, addressLine2: true, postalCode: true, city: true, countryCode: true } },
    } },
    tickets: { orderBy: { number: "asc" }, select: { id: true, number: true, status: true } },
    payment: { select: { status: true } },
    cancellationRequests: { orderBy: { requestedAt: "desc" }, select: { id: true, status: true, requestedAt: true, decidedAt: true, customerReason: true, refundStatus: true } },
  } });
}

export async function getCompanyCancellations(slug: string) {
  const { company } = await requireCompanyAccess(slug);
  const requests = await getPrisma().cancellationRequest.findMany({ where: { booking: { event: { companyId: company.id } } }, orderBy: [{ status: "asc" }, { requestedAt: "desc" }], include: {
    decidedBy: { select: { name: true, email: true } },
    booking: { select: { ...voucherStatus, number: true, quantity: true, customerName: true, customerEmail: true, status: true, event: { select: { name: true, beginsAt: true } }, payment: { select: { status: true, amount: true, currency: true } } } },
  } });
  return { company, requests };
}
