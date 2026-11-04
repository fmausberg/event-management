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
  Event: {
    delegate: "event",
    fields: {
      number: "Nummer", name: "Name", shortdescription: "Kurzbeschreibung", description: "Beschreibung",
      companyId: "Company-ID", eventSeriesId: "Veranstaltungsreihe-ID", createdById: "Ersteller-ID", venueId: "Ort-ID",
      beginsAt: "Beginn", endsAt: "Ende", status: "Status", maxSeats: "Teilnehmerzahl",
      ticketPrice: "Ticketpreis", currency: "Währung", freeCancellationUntilMinutesBeforeStart: "Kostenfreie Stornofrist in Minuten",
      trainerIds: "Trainer-IDs",
    },
    privateFields: { trainerName: "Trainername (Altbestand)", imageUrl: "Titelbild", imagePublicId: "Bildreferenz" },
    affectedBy: [{ model: "EventTrainer", operations: ["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"] }],
  },
  Venue: {
    delegate: "venue",
    fields: { number: "Nummer", name: "Name", companyId: "Company-ID", city: "Stadt", countryCode: "Land" },
    privateFields: { addressLine1: "Adresszeile 1", addressLine2: "Adresszeile 2", postalCode: "Postleitzahl" },
    affectedBy: [],
  },
  Trainer: {
    delegate: "trainer",
    // Names are explicitly approved as target identification; contact data is not.
    fields: { number: "Nummer", firstName: "Vorname", lastName: "Nachname", companyId: "Company-ID", userId: "Nutzer-ID" },
    privateFields: { email: "E-Mail-Adresse" },
    affectedBy: [{ model: "User", operations: ["delete", "deleteMany"] }],
  },
  Company: {
    delegate: "company",
    fields: { number: "Nummer", name: "Name", slug: "URL-Kürzel", stripeChargesEnabled: "Zahlungen aktiviert", stripePayoutsEnabled: "Auszahlungen aktiviert" },
    privateFields: { stripeAccountId: "Stripe-Verknüpfung" },
    affectedBy: [],
  },
  CompanyMembership: {
    delegate: "companyMembership",
    fields: { number: "Nummer", companyId: "Company-ID", userId: "Nutzer-ID", role: "Rolle", status: "Status" },
    privateFields: { email: "Einladungsadresse" },
    affectedBy: [],
  },
} as const;

export const auditModelLabels: Readonly<Record<string, string>> = {
  EventSeries: "Veranstaltungsreihe", Event: "Veranstaltung", Venue: "Ort",
  Trainer: "Trainer", Company: "Company", CompanyMembership: "Mitgliedschaft",
};
