import { expect, it } from "vitest";
import { suggestedEndDate } from "@/lib/company-events/model";

it("adds duration in minutes", () => {
 expect(suggestedEndDate("2026-10-26T10:00", 90)).toBe("2026-10-26T11:30");
});
it("handles day and year boundaries", () => {
 expect(suggestedEndDate("2026-12-31T23:30", 90)).toBe("2027-01-01T01:00");
});
it.each([null, undefined, 0, -1, 1.5, NaN])("does not calculate without a valid duration: %s", (duration) => {
 expect(suggestedEndDate("2026-10-26T10:00", duration)).toBe("");
});
it.each(["", "invalid"])("does not calculate without a valid start: %s", (beginsAt) => {
 expect(suggestedEndDate(beginsAt, 90)).toBe("");
});
