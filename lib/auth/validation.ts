import { z } from "zod";

export const emailSchema = z.string({ error: "Bitte gib deine E-Mail-Adresse ein." }).trim().toLowerCase().max(254, "Die E-Mail-Adresse darf höchstens 254 Zeichen lang sein.").pipe(
  z.email("Bitte gib eine gültige E-Mail-Adresse ein."),
);

// Only require a value; passwords have no length or character-composition policy.
const passwordSchema = z.string({ error: "Bitte gib dein Passwort ein." }).min(1, "Bitte gib dein Passwort ein.");

export const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
export const registerSchema = loginSchema.extend({
  name: z.string({ error: "Bitte gib deinen Namen ein." }).trim().min(2, "Bitte gib einen Namen mit mindestens 2 Zeichen ein.").max(100, "Der Name darf höchstens 100 Zeichen lang sein."),
  confirmPassword: z.string({ error: "Bitte wiederhole dein Passwort." }),
}).refine((data) => data.password === data.confirmPassword, {
  path: ["confirmPassword"], message: "Die Passwörter stimmen nicht überein.",
});

export type AuthFormState = {
  message?: string;
  errors?: Partial<Record<"name" | "email" | "password" | "confirmPassword", string[]>>;
};
