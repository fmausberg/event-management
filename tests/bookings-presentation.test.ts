import { expect, it } from "vitest";
import { eventDuration, groupBookings, shortCancellationPolicy } from "@/lib/bookings/presentation";

const now = new Date("2026-10-28T12:00:00Z");
const booking = (id: string, start: string | null, end: string | null, status = "PUBLISHED") => ({ id, event: { beginsAt: start ? new Date(start) : null, endsAt: end ? new Date(end) : null, status } });

it("groups all bookings by event end, includes ongoing events, and sorts by start", () => {
  const items = [
    booking("later", "2026-10-30T12:00Z", "2026-10-30T13:00Z"),
    booking("old", "2026-10-20T12:00Z", "2026-10-20T13:00Z"),
    booking("unknown", null, null),
    booking("running", "2026-10-28T11:00Z", "2026-10-28T13:00Z"),
    booking("ends-now", "2026-10-28T10:00Z", "2026-10-28T13:00+01:00"),
    booking("no-end", "2026-10-27T12:00Z", null),
    booking("completed", null, null, "COMPLETED"),
  ];
  const groups = groupBookings(items, now);
  expect(groups.upcoming.map((b) => b.id)).toEqual(["running", "later", "unknown"]);
  expect(groups.past.map((b) => b.id)).toEqual(["ends-now", "no-end", "old", "completed"]);
  expect(items[0].id).toBe("later");
});

it("calculates elapsed duration across the DST change in UTC", () => {
  expect(eventDuration(new Date("2026-10-25T02:00+02:00"), new Date("2026-10-25T02:30+01:00"))).toBe("1 Std. 30 Min.");
  expect(eventDuration(now, null)).toBe("Noch offen");
  expect(eventDuration(now, now)).toBe("Noch offen");
});

it("labels disabled, immediate, day, hour and minute cancellation policies", () => {
  expect(shortCancellationPolicy(null)).toBe("Stornierung nur auf Anfrage");
  expect(shortCancellationPolicy(0)).toBe("Kostenfrei bis Eventbeginn");
  expect(shortCancellationPolicy(1440)).toContain("1 Tag vor");
  expect(shortCancellationPolicy(120)).toContain("2 Std.");
  expect(shortCancellationPolicy(90)).toContain("90 Min.");
});
