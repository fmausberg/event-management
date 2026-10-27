import { expect, it } from "vitest";
import { cancellationMinutes, cancellationPolicy } from "@/lib/cancellations/policy";

const start = new Date("2026-10-29T10:00:00Z");
it("includes the exact 24-hour cutoff but not a millisecond later", () => {
  expect(cancellationPolicy(start, 1440, new Date("2026-10-28T10:00:00Z")).free).toBe(true);
  expect(cancellationPolicy(start, 1440, new Date("2026-10-28T10:00:00.001Z")).free).toBe(false);
});
it("compares absolute instants across timezone offsets and DST", () => {
  expect(cancellationPolicy(new Date("2026-10-25T12:00:00+01:00"), 1440, new Date("2026-10-24T13:00:00+02:00")).free).toBe(true);
  expect(cancellationPolicy(start, 60, new Date("2026-10-29T10:00:00+01:00")).free).toBe(true);
});
it("disables automatic cancellation without a start or configured duration", () => {
  expect(cancellationPolicy(null, 1440).free).toBe(false);
  expect(cancellationPolicy(start, null, new Date("2026-10-01"))).toMatchObject({ free: false, started: false, deadline: null });
});
it("zero allows cancellation until but never at event start", () => {
  expect(cancellationPolicy(start, 0, new Date(start.getTime() - 1)).free).toBe(true);
  expect(cancellationPolicy(start, 0, start)).toMatchObject({ free: false, started: true });
});
it.each(["-1", "1.5", "NaN", "2147483648"])("rejects invalid minutes %s", (value) => expect(cancellationMinutes.safeParse(value).success).toBe(false));
it("preserves disabled and zero distinctly", () => {
  expect(cancellationMinutes.parse("")).toBeNull();
  expect(cancellationMinutes.parse("0")).toBe(0);
});
