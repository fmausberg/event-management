/** Serializable display data; never contains internal ownership identifiers or token hashes. */
export type TicketViewModel = {
  number: number;
  status: "Storniert" | "Bereits eingelöst" | "Gültig" | "Nicht gültig";
  checkedInAt: string | null;
  eventName: string;
  bookedByName: string | null;
  beginsAt: string;
  venue: string | null;
};
