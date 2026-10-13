import { expect, it } from "vitest";
import { bookingConfirmation } from "@/lib/mail/templates/booking-confirmation";

it("renders booking details with Berlin time and escapes user input in HTML", () => {
 const mail = bookingConfirmation({ customerName: '<img src=x onerror="bad()">', bookingNumber: 42, eventName: "Yoga & Klang", beginsAt: new Date("2026-10-16T15:30:00Z"), quantity: 2 });
 expect(mail.subject).toBe("Deine Buchungsbestätigung #42");
 expect(mail.text).toContain("Fr., 16.10.2026, 17:30");
 expect(mail.text).toContain("Anzahl Plätze: 2");
 expect(mail.html).toContain("Yoga &amp; Klang");
 expect(mail.html).not.toContain("<img");
 expect(mail.html).toContain("&lt;img");
});
