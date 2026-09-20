import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { createEvent, updateEvent, deleteEvent } from "@/app/events/actions";
import { removeEvent } from "@/lib/events/event-mutations";
import type { EventFormState } from "@/lib/events/validate-event";

const { db, revalidatePath, redirect } = vi.hoisted(() => ({
  db: { event: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn() } },
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

const initial: EventFormState = { values: { name: "", beginsAt: "", endsAt: "", maxSeats: "" } };
function form() {
  const data = new FormData();
  Object.entries({ name: "  Event  ", beginsAt: "2026-07-10T18:00", endsAt: "2026-07-10T20:00", maxSeats: "30", number: "999" })
    .forEach(([key, value]) => data.set(key, value));
  return data;
}
beforeEach(() => {
  db.event.create.mockResolvedValue({ id: "event-1" });
  db.event.update.mockResolvedValue({ id: "event-1" });
  db.event.deleteMany.mockResolvedValue({ count: 1 });
  db.event.findUnique.mockResolvedValue({ id: "event-1", beginsAt: new Date("2026-07-10T16:00Z"), endsAt: new Date("2026-07-10T18:00Z") });
});

describe("create and update actions", () => {
  it("creates only editable fields then revalidates and redirects", async () => {
    await expect(createEvent(initial, form())).rejects.toThrow("REDIRECT:/events");
    expect(db.event.create).toHaveBeenCalledWith({ data: {
      name: "Event", beginsAt: new Date("2026-07-10T16:00Z"), endsAt: new Date("2026-07-10T18:00Z"), maxSeats: 30,
    } });
    expect(revalidatePath).toHaveBeenCalledWith("/events");
  });

  it("returns readable validation errors and retains submitted values", async () => {
    const data = form(); data.set("name", " ");
    const result = await createEvent(initial, data);
    expect(result.errors?.name).toBeTruthy();
    expect(result.values.maxSeats).toBe("30");
    expect(db.event.create).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("updates only the requested event", async () => {
    await expect(updateEvent("event-1", initial, form())).rejects.toThrow("REDIRECT:/events");
    expect(db.event.update).toHaveBeenCalledWith({ where: { id: "event-1" }, data: expect.objectContaining({ name: "Event", maxSeats: 30 }) });
    expect(revalidatePath).toHaveBeenCalledWith("/events");
  });

  it("preserves the second autumn occurrence when editing the name", async () => {
    const beginsAt = new Date("2026-10-25T01:30:00Z");
    const endsAt = new Date("2026-10-25T02:30:00Z");
    db.event.findUnique.mockResolvedValueOnce({ id: "event-1", beginsAt, endsAt });
    const data = form(); data.set("beginsAt", "2026-10-25T02:30"); data.set("endsAt", "2026-10-25T03:30");
    await expect(updateEvent("event-1", initial, data)).rejects.toThrow("REDIRECT:/events");
    expect(db.event.update).toHaveBeenCalledWith({ where: { id: "event-1" }, data: expect.objectContaining({ beginsAt, endsAt }) });
  });

  it("does not save invalid updates", async () => {
    const data = form(); data.set("maxSeats", "0");
    expect((await updateEvent("event-1", initial, data)).errors?.maxSeats).toBeTruthy();
    expect(db.event.update).not.toHaveBeenCalled();
  });

  it("reports a missing event without creating a replacement", async () => {
    db.event.findUnique.mockResolvedValueOnce(null);
    expect((await updateEvent("missing", initial, form())).message).toContain("existiert nicht mehr");
    expect(db.event.update).not.toHaveBeenCalled();
    expect(db.event.create).not.toHaveBeenCalled();
  });

  it("does not expose database errors to the user", async () => {
    db.event.create.mockRejectedValueOnce(new Error("postgresql://secret-credentials"));
    const result = await createEvent(initial, form());
    expect(result.message).toContain("Bitte versuche es erneut");
    expect(JSON.stringify(result)).not.toContain("secret-credentials");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deletion safeguards", () => {
  it.each([undefined, null, "", " "])("rejects a missing or invalid ID %j without an unfiltered delete", async (id) => {
    const data = new FormData(); data.set("confirmed", "yes");
    expect((await deleteEvent(id as string, {}, data)).message).toContain("Event-ID");
    expect(db.event.deleteMany).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before touching the database", async () => {
    expect((await deleteEvent("event-1", {}, new FormData())).message).toContain("bestätige");
    expect(db.event.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes only without bookings AND platform mappings and revalidates", async () => {
    const data = new FormData(); data.set("confirmed", "yes");
    expect(await deleteEvent("event-1", {}, data)).toEqual({});
    expect(db.event.deleteMany).toHaveBeenCalledWith({ where: { id: "event-1", bookings: { none: {} }, platformEvents: { none: {} } } });
    expect(revalidatePath).toHaveBeenCalledWith("/events");
  });

  it("reports dependent records instead of deleting them", async () => {
    db.event.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(removeEvent("event-1")).rejects.toThrow("Buchungen oder Plattformzuordnungen");
  });

  it("reports an already deleted event", async () => {
    db.event.deleteMany.mockResolvedValueOnce({ count: 0 });
    db.event.findUnique.mockResolvedValueOnce(null);
    await expect(removeEvent("missing")).rejects.toThrow("existiert nicht mehr");
  });

  it("handles a concurrent relation insertion rejected by the foreign key", async () => {
    db.event.deleteMany.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Foreign key constraint", { code: "P2003", clientVersion: "7.10.0" }));
    const data = new FormData(); data.set("confirmed", "yes");
    expect((await deleteEvent("event-1", {}, data)).message).toContain("Buchungen oder Plattformzuordnungen");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
