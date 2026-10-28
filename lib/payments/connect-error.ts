import "server-only";

export function reportConnectError(error: unknown): "connect_setup_required" | "account_access_denied" | "authentication_error" | "error" {
  const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
  // Only log identifiers, never the raw response, request body or credentials.
  const safe = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_]{1,120}$/.test(value) ? value : undefined;
  console.error("Stripe onboarding failed", {
    type: safe(details.type), code: safe(details.code), requestId: safe(details.requestId),
    ...(safe(details.name) ? { name: safe(details.name) } : {}),
    ...(typeof details.statusCode === "number" ? { statusCode: details.statusCode } : {}),
  });
  if (details.code === "non_connect_platform_accounts_v2_access_blocked") return "connect_setup_required";
  if (details.type === "StripeAuthenticationError" || details.statusCode === 401) return "authentication_error";
  if (details.type === "StripePermissionError" || ["account_invalid", "not_found", "forbidden"].includes(String(details.code))) return "account_access_denied";
  return "error";
}
