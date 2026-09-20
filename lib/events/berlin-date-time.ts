const berlinFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  fractionalSecondDigits: 3, hourCycle: "h23",
});

/** Format an instant for datetime-local, retaining seconds and milliseconds. */
export function formatBerlinDateTime(date: Date): string {
  const parts = Object.fromEntries(berlinFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}`;
}

/** Parse a Berlin wall-clock time without using the machine's local timezone. */
export function parseBerlinDateTime(value: string, original?: Date): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) throw new Error("Bitte ein gültiges Datum mit Uhrzeit eingeben.");
  const [, year, month, day, hour, minute, second = "00", fraction = "000"] = match;
  const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.padEnd(3, "0")}`;
  const wallTime = new Date(`${normalized}Z`);
  if (+year === 0 || !Number.isFinite(wallTime.getTime()) || wallTime.toISOString() !== `${normalized}Z`) {
    throw new Error("Bitte ein gültiges Datum mit Uhrzeit eingeben.");
  }

  // Discover the offsets on either side of a potential DST transition using ICU.
  const offsets = new Set<number>();
  for (const hours of [-36, 0, 36]) {
    const sample = new Date(wallTime.getTime() + hours * 3_600_000);
    offsets.add(new Date(`${formatBerlinDateTime(sample)}Z`).getTime() - sample.getTime());
  }
  const candidates = [...offsets]
    .map((offset) => new Date(wallTime.getTime() - offset))
    .filter((candidate) => formatBerlinDateTime(candidate) === normalized)
    .sort((a, b) => a.getTime() - b.getTime());

  if (!candidates.length) {
    throw new Error("Diese Uhrzeit existiert wegen der Zeitumstellung in Europe/Berlin nicht.");
  }
  // Preserve either occurrence of an unchanged autumn time when editing.
  // New ambiguous times use the earlier occurrence (summer time).
  return candidates.find((candidate) => candidate.getTime() === original?.getTime()) ?? candidates[0];
}
