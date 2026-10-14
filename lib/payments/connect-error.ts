import "server-only";

export function reportConnectError(error: unknown): "connect_setup_required" | "error" {
  const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
  // Only log identifiers, never the raw response, request body or credentials.
  const safe = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_]{1,120}$/.test(value) ? value : undefined;
  console.error("Stripe onboarding failed", { type: safe(details.type), code: safe(details.code), requestId: safe(details.requestId) });
  return details.code === "non_connect_platform_accounts_v2_access_blocked" ? "connect_setup_required" : "error";
}
