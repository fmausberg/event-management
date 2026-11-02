import { GuestBookingManagement } from "./guest-booking-management";

export const metadata = { title: "Buchung verwalten", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default function BookingManagementPage() {
  return <GuestBookingManagement />;
}
