import { expect, it } from "vitest";
import { bookingConfirmation } from "@/lib/mail/templates/booking-confirmation";

it("separates individual ticket links from whole-booking management in HTML and text", () => {
 const managementLink = "https://events.example.com/booking/manage#management-token";
 const mail = bookingConfirmation({ customerName: "Ada", bookingNumber: 42, eventName: "Yoga", beginsAt: null, quantity: 3,
  ticketLinks: ["https://events.example.com/tickets#one"], managementLink });
 for (const body of [mail.text, mail.html]) {
  expect(body).toContain(managementLink);
  expect(body).toContain("Buchung verwalten / stornieren");
  expect(body).toContain("gesamte Buchung");
  expect(body).toContain("nicht diesen Verwaltungslink");
 }
});

it("renders booking details with Berlin time and escapes user input in HTML", () => {
 const mail = bookingConfirmation({ customerName: '<img src=x onerror="bad()">', bookingNumber: 42, eventName: "Yoga & Klang", beginsAt: new Date("2026-10-16T15:30:00Z"), quantity: 2 });
 expect(mail.subject).toBe("Deine Buchungsbestätigung #42");
 expect(mail.text).toContain("Fr., 16.10.2026, 17:30");
 expect(mail.text).toContain("Anzahl Plätze: 2");
 expect(mail.html).toContain("Yoga &amp; Klang");
 expect(mail.html).not.toContain("<img");
 expect(mail.html).toContain("&lt;img");
});
