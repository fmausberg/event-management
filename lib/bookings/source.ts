export function bookingSource(booking: { platform: string | null; origin?: "PLATFORM" | "MANUAL" | null }) {
  if (booking.platform) return booking.platform;
  if (booking.origin === "PLATFORM") return "Intern (Plattform)";
  if (booking.origin === "MANUAL") return "Intern (Manuell)";
  return "Intern";
}
