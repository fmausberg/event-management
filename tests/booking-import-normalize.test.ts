import { describe, expect, it } from "vitest";
import { dateValue, money, normalizeRow, suggestMapping, validateMapping } from "@/lib/bookings/import/normalize";
import type { Cell, Mapping } from "@/lib/bookings/import/types";

const mapping: Mapping = {
  eventTitle: "Eventtitel", eventDate: "Veranstaltungsdatum", firstName: "Käufer Vorname", lastName: "Käufer Nachname",
  email: "Email Adresse", quantity: "Anzahl Tickets", gross: "Summe in € (Brutto)", bookedAt: "Kaufdatum",
  refund: "Erstatteter Betrag Brutto", refundedAt: "Erstattungsdatum", externalId: "Externe ID", externalStatus: "Status",
};
const source: Record<string,Cell> = {
  Eventtitel: "Yoga", Veranstaltungsdatum: "05.12.2026 15:30", "Käufer Vorname": "Erika", "Käufer Nachname": "Muster",
  "Email Adresse": "erika@example.com", "Anzahl Tickets": 3, "Summe in € (Brutto)": "6.23", Kaufdatum: "01.11.2026 12:00",
  "Externe ID": "RG-001", "Ticket IDs": "external-ticket-1,external-ticket-2", "Nicht zugeordnet": "Originalwert",
};

describe("external booking import normalization", () => {
  it.each([["39 €",3900], ["3,7 €",370], ["6.23",623], [6.23,623], ["1.234,56 €",123456], ["3900",390000], ["0",0]])("reads %s in major units without cent inference", (value,expected) => {
    expect(money(value)).toBe(expected);
  });
  it.each(["-1", "1.234", "12 Cent", "1,234.56", "NaN", "21474836.48"])("rejects invalid or ambiguous money %s", value => {
    expect(() => money(value)).toThrow();
  });
  it("uses Berlin wall time, not the host timezone", () => {
    expect(dateValue("05.12.2026 15:30")).toBe("2026-12-05T14:30:00.000Z");
    expect(dateValue("05.07.2026 15:30")).toBe("2026-07-05T13:30:00.000Z");
    expect(dateValue("2026-12-05T15:30:00+02:00")).toBe("2026-12-05T13:30:00.000Z");
  });
  it("handles both Excel epochs and rejects the fictitious Excel leap day", () => {
    expect(dateValue(1)).toBe("1899-12-31T23:00:00.000Z");
    expect(dateValue(0,true)).toBe("1903-12-31T23:00:00.000Z");
    expect(() => dateValue(60)).toThrow();
  });
  it.each(["31.02.2026 12:00", "29.03.2026 02:30", "2026-02-30T12:00:00Z", "2026-12-05T24:00:00Z"])("rejects invalid dates or nonexistent wall times: %s", value => {
    expect(() => dateValue(value)).toThrow();
  });
  it("recognizes unique buyer-list headers while leaving ambiguous choices unset", () => {
    expect(suggestMapping(Object.keys(source))).toMatchObject({ gross: "Summe in € (Brutto)", firstName: "Käufer Vorname", externalId: "Externe ID" });
    expect(suggestMapping(["E-Mail", "Email Adresse"]).email).toBeUndefined();
  });
  it("retains an indivisible gross total and does not interpret external ticket IDs as bookings", () => {
    const result = normalizeRow(source,mapping);
    expect(result.errors).toEqual([]);
    expect(result.normalized).toMatchObject({ quantity: 3, gross: 623, currency: "EUR", externalId: "RG-001", customerName: "Erika Muster", status: "CONFIRMED" });
    expect(source["Ticket IDs"]).toBe("external-ticket-1,external-ticket-2");
    expect(source["Nicht zugeordnet"]).toBe("Originalwert");
  });
  it("keeps refund facts separate and capacity active instead of silently cancelling", () => {
    const result = normalizeRow({ ...source, Status: "partially_refunded", "Erstatteter Betrag Brutto": "3,70 €", Erstattungsdatum: "02.11.2026 12:00" },mapping);
    expect(result.errors).toEqual([]);
    expect(result.normalized).toMatchObject({ status: "CONFIRMED", refund: 370, refundedAt: "2026-11-02T11:00:00.000Z" });
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("does not accept arbitrary status text containing the word refund", () => {
    const result = normalizeRow({ ...source, Status: "not_refunded" },mapping);
    expect(result.errors.some(s => s.includes("Status"))).toBe(true);
  });
  it("blocks refunds above gross and noninteger quantities", () => {
    const result = normalizeRow({ ...source, "Anzahl Tickets": 1.5, "Erstatteter Betrag Brutto": "7" },mapping);
    expect(result.errors).toContain("Ticketanzahl muss eine positive ganze Zahl sein.");
    expect(result.errors).toContain("Erstattung übersteigt den Bruttogesamtbetrag.");
  });
  it("blocks contradictory currency information", () => {
    const result = normalizeRow({ ...source, "Summe in € (Brutto)": "39 €", Currency: "USD" }, { ...mapping, currency: "Currency" });
    expect(result.errors).toContain("Euro-Betrag widerspricht der angegebenen Währung.");
  });
  it("requires price, quantity and booking-date mappings but permits unused columns", () => {
    const sheet = { name: "Käuferliste", headers: Object.keys(source), rows: [] };
    expect(() => validateMapping({ quantity: mapping.quantity, bookedAt: mapping.bookedAt, gross: mapping.gross }, sheet)).not.toThrow();
    expect(() => validateMapping({ quantity: mapping.quantity }, sheet)).toThrow();
  });
});
