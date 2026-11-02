import { expect, it } from "vitest";
import { batchOccurrence, calendarRange, parseBatchSchedule, type BatchSelection } from "@/lib/company-events/batch-schedule";

const clock: BatchSelection = { dates: [], startTime: "10:00", endTime: "11:30", endDayOffset: "0", timeMode: "clock", duration: "90" };
it("composes each local date in Berlin across DST, independently of the machine timezone", () => {
  expect(batchOccurrence("2027-03-27", clock).beginsAt).toBe("2027-03-27T09:00:00.000Z");
  expect(batchOccurrence("2027-03-28", clock).beginsAt).toBe("2027-03-28T08:00:00.000Z");
  expect(batchOccurrence("2027-10-31", { ...clock, startTime: "02:30" }).beginsAt).toBe("2027-10-31T00:30:00.000Z");
});
it("rejects nonexistent spring times and an end before the beginning", () => {
  expect(() => batchOccurrence("2027-03-28", { ...clock, startTime: "02:30" })).toThrow("Zeitumstellung");
  expect(() => batchOccurrence("2027-03-28", { ...clock, endTime: "09:30" })).toThrow("nach dem Beginn");
});
it("handles midnight, durations and draft dates without an end", () => {
  expect(batchOccurrence("2027-12-31", { ...clock, startTime: "23:30", endTime: "01:00", endDayOffset: "1" }).endsAt).toBe("2028-01-01T00:00:00.000Z");
  expect(batchOccurrence("2027-03-28", { ...clock, startTime: "01:30", timeMode: "duration", duration: "60" })).toMatchObject({ beginsAt: "2027-03-28T00:30:00.000Z", endsAt: "2027-03-28T01:30:00.000Z" });
  expect(batchOccurrence("2027-03-28", { ...clock, endTime: "" }).endsAt).toBe("");
});
it("validates real dates, range bounds, duplicate selections and the batch limit", () => {
  expect(calendarRange("2027-02-28", "2027-03-02")).toEqual(["2027-02-28", "2027-03-01", "2027-03-02"]);
  expect(calendarRange("2027-02-30", "2027-03-02")).toEqual([]);
  expect(calendarRange("2027-01-01", "2029-01-01")).toEqual([]);
  for (const dates of [[], ["2027-02-30"], ["2027-03-28", "2027-03-28"], Array(101).fill("2027-03-28")]) {
    const form = new FormData(); dates.forEach(day => form.append("batchDate", day));
    expect(parseBatchSchedule(form).message).toBeTruthy();
  }
});
it("returns per-date errors and no usable partial schedule", () => {
  const form = new FormData();
  form.set("batchStartTime", "02:30"); form.set("batchEndTime", "04:00");
  form.append("batchDate", "2027-03-27"); form.append("batchDate", "2027-03-28");
  expect(parseBatchSchedule(form)).toMatchObject({ occurrences: [], dateErrors: { "2027-03-28": expect.stringContaining("Zeitumstellung") } });
});
