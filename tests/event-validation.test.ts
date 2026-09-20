import { describe, expect, it } from "vitest";
import { formatBerlinDateTime, parseBerlinDateTime } from "@/lib/events/berlin-date-time";
import { readEventFormData, validateEvent, type EventFormValues } from "@/lib/events/validate-event";

const valid: EventFormValues = {
  name: "  Sommerfest  ", beginsAt: "2026-07-10T18:00", endsAt: "2026-07-10T23:30", maxSeats: "30",
};

describe("event validation", () => {
  it("accepts a valid event, trims its name and converts Berlin to UTC", () => {
    expect(validateEvent(valid)).toEqual({ success: true, data: {
      name: "Sommerfest", beginsAt: new Date("2026-07-10T16:00:00Z"),
      endsAt: new Date("2026-07-10T21:30:00Z"), maxSeats: 30,
    } });
  });

  it.each(["", "  "])("rejects an empty name %j", (name) => {
    expect(validateEvent({ ...valid, name })).toMatchObject({ success: false, errors: { name: expect.any(String) } });
  });

  it.each(["0", "-1", "1.5", "", "NaN", "Infinity", "2147483648", "1e2", "0x20"])("rejects capacity %j", (maxSeats) => {
    expect(validateEvent({ ...valid, maxSeats })).toMatchObject({ success: false, errors: { maxSeats: expect.any(String) } });
  });

  it.each(["2026-07-10T17:00", "2026-07-10T18:00"])("rejects an end before or equal to the start: %s", (endsAt) => {
    expect(validateEvent({ ...valid, endsAt })).toMatchObject({ success: false, errors: { endsAt: expect.any(String) } });
  });

  it.each(["", "invalid", "2026-02-30T12:00", "2026-07-10T25:00", "2026-07-10T18:00Z"])("rejects invalid start %j", (beginsAt) => {
    expect(validateEvent({ ...valid, beginsAt })).toMatchObject({ success: false, errors: { beginsAt: expect.any(String) } });
  });

  it("rejects invalid end dates", () => {
    expect(validateEvent({ ...valid, endsAt: "invalid" })).toMatchObject({ success: false, errors: { endsAt: expect.any(String) } });
  });

  it("whitelists form fields and ignores submitted event numbers", () => {
    const form = new FormData();
    for (const [key, value] of Object.entries(valid)) form.set(key, value);
    form.set("number", "999");
    form.set("id", "other-event");
    expect(readEventFormData(form)).toEqual(valid);
  });
});

describe("Berlin time conversion", () => {
  it.each([
    ["2026-01-10T18:00", "2026-01-10T17:00:00.000Z"],
    ["2026-07-10T18:00", "2026-07-10T16:00:00.000Z"],
    ["2026-01-01T00:00", "2025-12-31T23:00:00.000Z"],
    ["2028-02-29T12:00", "2028-02-29T11:00:00.000Z"],
  ])("converts %s independently of the server's timezone", (local, utc) => {
    expect(parseBerlinDateTime(local).toISOString()).toBe(utc);
    expect(formatBerlinDateTime(new Date(utc))).toBe(`${local}:00.000`);
  });

  it("rejects the missing spring hour instead of silently shifting it", () => {
    expect(() => parseBerlinDateTime("2026-03-29T02:30")).toThrow("Zeitumstellung");
  });

  it("compares actual instants across the spring time change", () => {
    const result = validateEvent({ ...valid, beginsAt: "2026-03-29T01:30", endsAt: "2026-03-29T03:30" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.endsAt.getTime() - result.data.beginsAt.getTime()).toBe(3_600_000);
  });

  it("chooses the first autumn occurrence for a new ambiguous time", () => {
    expect(parseBerlinDateTime("2026-10-25T02:30").toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it.each(["2026-10-25T00:30:15.123Z", "2026-10-25T01:30:15.123Z"])("preserves the existing autumn instant %s including milliseconds", (iso) => {
    const original = new Date(iso);
    expect(parseBerlinDateTime(formatBerlinDateTime(original), original).toISOString()).toBe(iso);
  });

  it("does not apply an old autumn offset when the user changes the date", () => {
    expect(parseBerlinDateTime("2026-07-10T18:00", new Date("2026-10-25T01:30:00Z")).toISOString())
      .toBe("2026-07-10T16:00:00.000Z");
  });
});
