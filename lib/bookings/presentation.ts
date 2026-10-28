type DatedBooking = { event: { beginsAt: Date | null; endsAt: Date | null; status: string } };

export function groupBookings<T extends DatedBooking>(bookings: T[], now = new Date()) {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const booking of bookings) {
    const end = booking.event.endsAt ?? booking.event.beginsAt;
    (booking.event.status === "COMPLETED" || (end && end <= now) ? past : upcoming).push(booking);
  }
  upcoming.sort((a, b) => (a.event.beginsAt?.getTime() ?? Infinity) - (b.event.beginsAt?.getTime() ?? Infinity));
  past.sort((a, b) => (b.event.beginsAt?.getTime() ?? -Infinity) - (a.event.beginsAt?.getTime() ?? -Infinity));
  return { upcoming, past };
}

export function eventDuration(beginsAt: Date | null, endsAt: Date | null) {
  if (!beginsAt || !endsAt || endsAt <= beginsAt) return "Noch offen";
  const minutes = Math.round((endsAt.getTime() - beginsAt.getTime()) / 60_000);
  return [minutes >= 60 ? `${Math.floor(minutes / 60)} Std.` : "", minutes % 60 ? `${minutes % 60} Min.` : ""].filter(Boolean).join(" ") || "Unter 1 Min.";
}

export function shortCancellationPolicy(minutes: number | null) {
  if (minutes == null) return "Stornierung nur auf Anfrage";
  if (minutes === 0) return "Kostenfrei bis Eventbeginn";
  const duration = minutes % 1440 === 0 ? `${minutes / 1440} ${minutes === 1440 ? "Tag" : "Tage"}` : minutes % 60 === 0 ? `${minutes / 60} Std.` : `${minutes} Min.`;
  return `Kostenfrei bis ${duration} vor Beginn`;
}
