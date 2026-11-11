import { expect, it } from "vitest";
import { bookingSource } from "@/lib/bookings/source";

it("distinguishes website, manual and historic internal bookings", () => {
  expect(bookingSource({ platform: null, origin: "PLATFORM" })).toBe("Intern (Plattform)");
  expect(bookingSource({ platform: null, origin: "MANUAL" })).toBe("Intern (Manuell)");
  expect(bookingSource({ platform: null, origin: null })).toBe("Intern");
});

it.each(["EVENTBRITE", "RAUSGEGANGEN"])("retains the external platform %s", platform => {
  expect(bookingSource({ platform, origin: null })).toBe(platform);
});
