// Domain contracts intentionally do not import generated Prisma types.
export const platforms = [
  "EVENTBRITE", "RAUSGEGANGEN", "EVERSPORTS", "URBAN_SPORTS_CLUB",
  "WELLPASS", "MYCLUBS", "EVENTIM",
] as const;
export type Platform = (typeof platforms)[number];

export interface ExternalBooking {
  externalBookingId: string;
  quantity: number;
  status: "CONFIRMED" | "CANCELLED";
  bookedAt: Date;
}

export interface GetBookingsOptions {
  since?: Date;
}
