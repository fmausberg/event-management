import { z } from "zod";
import { isCountryCode } from "@/lib/taxes/countries";

const optionalText = (max: number) => z.string().trim().max(max, `Bitte höchstens ${max} Zeichen eingeben.`);

export const companyBillingSchema = z.object({
  legalName: optionalText(200),
  isSmallBusiness: z.boolean(),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  postalCode: optionalText(20),
  city: optionalText(100),
  countryCode: z.string().trim().toUpperCase().refine(value => value === "" || isCountryCode(value), "Bitte ein gültiges Land auswählen."),
  taxNumber: optionalText(100),
  vatId: optionalText(50),
  billingEmail: optionalText(254).refine(value => value === "" || z.string().email().safeParse(value).success, "Bitte eine gültige E-Mail-Adresse eingeben."),
});

export type CompanyBillingValues = z.infer<typeof companyBillingSchema>;
export type CompanyBillingState = {
  success?: boolean;
  message?: string;
  values?: CompanyBillingValues;
  errors?: Partial<Record<keyof CompanyBillingValues, string[]>>;
};

export const companyBillingSelect = {
  legalName: true, isSmallBusiness: true, addressLine1: true, addressLine2: true, postalCode: true,
  city: true, countryCode: true, taxNumber: true, vatId: true, billingEmail: true,
} as const;
