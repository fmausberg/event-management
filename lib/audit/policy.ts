// Explicit lists: additions to the Prisma schema never become audit payloads automatically.
export const eventSeriesAuditFields = {
  number: "Nummer",
  name: "Name",
  shortdescription: "Kurzbeschreibung",
  description: "Beschreibung",
  companyId: "Company-ID",
  createdById: "Ersteller-ID",
  suggestedVenueId: "Ort-ID (Vorgabe)",
  suggestedTrainerId: "Trainer-ID (Vorgabe)",
  suggestedFreeCancellationUntilMinutesBeforeStart: "Kostenfreie Stornofrist in Minuten",
  suggestedDuration: "Dauer in Minuten (Vorgabe)",
  suggestedMaxSeats: "Teilnehmerzahl (Vorgabe)",
  suggestedTicketPrice: "Ticketpreis (Vorgabe)",
  suggestedCurrency: "Währung",
} as const;

// Only change markers; values are compared transiently and never persisted.
export const eventSeriesPrivateFields = {
  imageUrl: "Titelbild",
  suggestedTrainerName: "Trainername (Altbestand)",
} as const;

export const auditPolicies = {
  EventSeries: {
    delegate: "eventSeries",
    fields: eventSeriesAuditFields,
    privateFields: eventSeriesPrivateFields,
    affectedBy: [{ model: "Trainer", operations: ["delete", "deleteMany"] }],
  },
} as const;
