import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bookingManagementLink, createBookingManagementToken, managementTokenMatchesBooking, readBookingManagementToken } from "@/lib/bookings/management-token";
import { createBookingToken } from "@/lib/bookings/public-token";

vi.mock("server-only", () => ({}));
const booking = { id: "booking-1", customerEmail: "guest@example.com" };
beforeEach(() => { vi.stubEnv("AUTH_SECRET", "management-test-key"); vi.stubEnv("AUTH_URL", "https://events.example.com"); });
afterEach(() => vi.unstubAllEnvs());

it("issues a separate capability bound to the booking and its current recipient", () => {
  const token = createBookingManagementToken(booking);
  const payload = readBookingManagementToken(token)!;
  expect(payload.bookingId).toBe(booking.id);
  expect(managementTokenMatchesBooking(payload, booking)).toBe(true);
  expect(managementTokenMatchesBooking(payload, { ...booking, id: "another-booking" })).toBe(false);
  expect(managementTokenMatchesBooking(payload, { ...booking, customerEmail: "new@example.com" })).toBe(false);
  expect(managementTokenMatchesBooking(payload, { ...booking, customerEmail: null })).toBe(false);
  expect(Buffer.from(token.split(".")[0], "base64url").toString()).not.toContain(booking.customerEmail);
});

it("rejects ticket and checkout tokens, tampering, malformed values and a rotated secret", () => {
  const token = createBookingManagementToken(booking);
  const [value, signature] = token.split(".");
  const forgedValue = Buffer.from(JSON.stringify({ ...readBookingManagementToken(token), bookingId: "other" })).toString("base64url");
  for (const invalid of [null, "", "a".repeat(43), "x".repeat(1501), `${forgedValue}.${signature}`, `${value}.${signature.slice(0, -1)}!`, createBookingToken("event", "0.00", "EUR")]) {
    expect(readBookingManagementToken(invalid)).toBeNull();
  }
  vi.stubEnv("AUTH_SECRET", "rotated-key");
  expect(readBookingManagementToken(token)).toBeNull();
});

it("keeps the capability in a fragment and rejects insecure production origins", () => {
  const url = new URL(bookingManagementLink(booking));
  expect(url.pathname).toBe("/booking/manage");
  expect(url.search).toBe("");
  expect(readBookingManagementToken(url.hash.slice(1))?.bookingId).toBe(booking.id);
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AUTH_URL", "http://localhost:3000");
  expect(() => bookingManagementLink(booking)).toThrow("HTTPS");
});
