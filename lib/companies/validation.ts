import { z } from "zod";

export const companySchema = z.object({
  name: z.string().trim().min(1, "Bitte gib den Companynamen ein.").max(160, "Der Name darf höchstens 160 Zeichen lang sein."),
  slug: z.string().trim().toLowerCase().min(1, "Bitte gib ein URL-Kürzel ein.").max(100, "Das URL-Kürzel darf höchstens 100 Zeichen lang sein.")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Verwende Kleinbuchstaben, Zahlen und einzelne Bindestriche zwischen den Wörtern."),
});
export const companyIdSchema = z.string().trim().min(1).max(191);
export type CompanyValues = z.infer<typeof companySchema>;
export type CompanyFormState = {
  success?: boolean;
  message?: string;
  values?: CompanyValues;
  errors?: Partial<Record<keyof CompanyValues, string[]>>;
};
export type CompanyRow = {
  id: string;
  number: number;
  name: string;
  slug: string;
  _count: { memberships: number; venues: number; eventSeries: number; events: number };
};

export function readCompanyForm(formData: FormData): CompanyValues {
  const name = formData.get("name");
  const slug = formData.get("slug");
  return { name: typeof name === "string" ? name : "", slug: typeof slug === "string" ? slug : "" };
}

export function suggestCompanySlug(name: string) {
  return name.trim().toLowerCase().replaceAll("ä", "ae").replaceAll("ö", "oe")
    .replaceAll("ü", "ue").replaceAll("ß", "ss").normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100).replace(/-$/, "");
}
