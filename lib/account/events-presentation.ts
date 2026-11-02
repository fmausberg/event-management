type AssignedEvent = { id: string; beginsAt: Date | null; endsAt: Date | null; status: string };

export function groupAssignedEvents<T extends AssignedEvent>(events: T[], now = new Date()) {
  const upcoming: T[] = [], past: T[] = [];
  for (const event of events) {
    (event.endsAt && event.endsAt <= now ? past : upcoming).push(event);
  }
  upcoming.sort((a, b) => (a.beginsAt?.getTime() ?? Infinity) - (b.beginsAt?.getTime() ?? Infinity) || a.id.localeCompare(b.id));
  past.sort((a, b) => (b.beginsAt?.getTime() ?? -Infinity) - (a.beginsAt?.getTime() ?? -Infinity) || a.id.localeCompare(b.id));
  return { upcoming, past };
}
