export const seriesLabels = {
  name: "Name", shortdescription: "Kurzbeschreibung", description: "Beschreibung",
  imageUrl: "Titelbild (16:9)", suggestedDuration: "Dauer in Minuten (Vorgabe)",
  suggestedMaxSeats: "Teilnehmerzahl (Vorgabe)", suggestedTicketPrice: "Ticketpreis (Vorgabe)",
  suggestedCurrency: "Währung", suggestedTrainerId: "Trainer (Vorgabe)", suggestedVenueId: "Venue (Vorgabe)",
  suggestedFreeCancellationUntilMinutesBeforeStart: "Kostenfreie Stornofrist (optional)",
} as const;
export type SeriesAttribute = keyof typeof seriesLabels;
export type SeriesPreview = { token: string; tabs: { key: SeriesAttribute; label: string; rows: { id: string; date: string; before: string; after: string }[] }[] };
