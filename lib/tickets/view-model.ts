/** Serializable display data; never contains ownership data or token hashes. */
export type TicketViewModel = {
  number: number;
  status: "Storniert" | "Bereits eingelöst" | "Gültig" | "Nicht gültig";
  checkedInAt: string | null;
  eventName: string;
  beginsAt: string;
  venue: string | null;
};
