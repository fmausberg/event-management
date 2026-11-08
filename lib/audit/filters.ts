import { z } from "zod";
import { auditModelLabels } from "./policy";
import { parseBerlinDateTime } from "@/lib/events/berlin-date-time";

export const auditActionLabels = { CREATE: "Erstellt", UPDATE: "Geändert", DELETE: "Gelöscht" } as const;
export type AuditFilters = { actors: string[]; actions: (keyof typeof auditActionLabels)[]; models: string[]; from: string; to: string };
export const emptyAuditFilters: AuditFilters = { actors: [], actions: [], models: [], from: "", to: "" };
export type AuditQuery = Record<string, string | string[] | undefined>;
const list = (value: string | string[] | undefined) => value === undefined ? [] : Array.isArray(value) ? value : [value];
const schema = z.object({
  actors: z.array(z.string().regex(/^(type:(USER|SYSTEM|ANONYMOUS|UNKNOWN)|user:[A-Za-z0-9_-]{1,191})$/)).max(500),
  actions: z.array(z.enum(["CREATE", "UPDATE", "DELETE"])).max(3),
  models: z.array(z.string().refine(value => Object.hasOwn(auditModelLabels, value))).max(20),
  from: z.string().max(16), to: z.string().max(16),
});

export function parseAuditFilters(query: AuditQuery): AuditFilters {
  const filters = schema.parse({ actors: list(query.actor), actions: list(query.action), models: list(query.model), from: query.from ?? "", to: query.to ?? "" });
  const from = filters.from ? parseBerlinDateTime(filters.from) : null;
  const to = filters.to ? parseBerlinDateTime(filters.to) : null;
  if (from && to && from > to) throw new Error("Der Beginn des Zeitraums muss vor dessen Ende liegen.");
  return filters;
}

export function auditFilterParams(filters: AuditFilters) {
  const params = new URLSearchParams();
  filters.actors.forEach(value => params.append("actor", value));
  filters.actions.forEach(value => params.append("action", value));
  filters.models.forEach(value => params.append("model", value));
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params;
}
