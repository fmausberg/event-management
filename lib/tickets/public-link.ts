import "server-only";

export function ticketLink(token: string) {
  const base = new URL(process.env.AUTH_URL ?? "http://localhost:3000");
  if (base.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && base.protocol === "http:" && base.hostname === "localhost")) {
    throw new Error("AUTH_URL must use HTTPS for public tickets");
  }
  // Fragments never reach web-server access logs or Referer headers.
  return new URL(`/tickets#${token}`, base.origin).toString();
}
