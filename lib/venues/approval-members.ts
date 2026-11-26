import "server-only";
import type { Prisma } from "@prisma/client";

/** Only linked accounts with a verified email participate in venue approval. */
export const eligibleVenueApprovalMember = {
  userId: { not: null },
  user: { is: { emailVerified: { not: null } } },
} satisfies Prisma.VenueStaffWhereInput;
