import "server-only";
import { getPrisma } from "@/lib/db/prisma";
import { requireCompanyAccess } from "@/lib/companies/members";
import { cancellationActor } from "./service";

export async function getMyBookings() {
  const userId = await cancellationActor();
  return getPrisma().booking.findMany({ where: { userId }, orderBy: [{ bookedAt: "desc" }, { id: "asc" }], select: {
    id: true, number: true, quantity: true, status: true,
    event: { select: { name: true, beginsAt: true, freeCancellationUntilMinutesBeforeStart: true, company: { select: { name: true } } } },
    payment: { select: { status: true } },
    cancellationRequests: { orderBy: { requestedAt: "desc" }, select: { id: true, status: true, requestedAt: true, decidedAt: true, customerReason: true, refundStatus: true } },
  } });
}

export async function getCompanyCancellations(slug: string) {
  const { company } = await requireCompanyAccess(slug);
  const requests = await getPrisma().cancellationRequest.findMany({ where: { booking: { event: { companyId: company.id } } }, orderBy: [{ status: "asc" }, { requestedAt: "desc" }], include: {
    decidedBy: { select: { name: true, email: true } },
    booking: { select: { number: true, quantity: true, customerName: true, customerEmail: true, status: true, event: { select: { name: true, beginsAt: true } }, payment: { select: { status: true, amount: true, currency: true } } } },
  } });
  return { company, requests };
}
