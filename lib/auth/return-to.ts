/** Accept local paths only; never allow a login link to redirect off-site. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return "/account";
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || /[\\\r\n]/.test(decoded)) return "/account";
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid" || /^\/(login|register|verify-email|api)(\/|$)/.test(url.pathname)) return "/account";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/account"; }
}
