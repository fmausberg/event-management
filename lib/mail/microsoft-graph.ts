import "server-only";
import { z } from "zod";

const credentialsSchema = z.object({
  tenantId: z.string().trim().min(1),
  clientId: z.string().trim().min(1),
  clientSecret: z.string().min(1),
});

export type MicrosoftGraphCredentials = z.input<typeof credentialsSchema>;

type TokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
};

let cachedToken: { value: string; expiresAt: number } | undefined;
let pendingTokenRequest: Promise<string> | undefined;

function safeProviderError(statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error("Microsoft Graph request failed"), { statusCode });
}

async function requestToken(credentials: MicrosoftGraphCredentials, timeoutMs: number): Promise<string> {
  const parsed = credentialsSchema.safeParse(credentials);
  if (!parsed.success) throw new Error("Microsoft Graph OAuth-Konfiguration ist unvollständig.");

  const url = "https://login.microsoftonline.com/" +
    encodeURIComponent(parsed.data.tenantId) +
    "/oauth2/v2.0/token";
  const body = new URLSearchParams({
    client_id: parsed.data.clientId,
    client_secret: parsed.data.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error("Microsoft OAuth-Token konnte nicht abgerufen werden.");
  }

  if (!response.ok) throw safeProviderError(response.status);

  let result: TokenResponse;
  try {
    result = await response.json() as TokenResponse;
  } catch {
    throw new Error("Microsoft OAuth hat eine ungültige Antwort geliefert.");
  }

  if (typeof result.access_token !== "string" || typeof result.expires_in !== "number") {
    throw new Error("Microsoft OAuth hat kein gültiges Zugriffstoken geliefert.");
  }

  cachedToken = {
    value: result.access_token,
    expiresAt: Date.now() + Math.max(0, result.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

async function getAccessToken(credentials: MicrosoftGraphCredentials, timeoutMs: number): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  if (!pendingTokenRequest) {
    pendingTokenRequest = requestToken(credentials, timeoutMs).finally(() => {
      pendingTokenRequest = undefined;
    });
  }
  return pendingTokenRequest;
}

/**
 * Gets an app-only Graph token. This checks the app credentials, not mailbox-level
 * Exchange authorization or successful recipient delivery.
 */
export async function verifyMicrosoftGraphConnection(
  credentials: MicrosoftGraphCredentials,
  timeoutMs = 7_000,
): Promise<void> {
  await getAccessToken(credentials, timeoutMs);
}

/**
 * Sends the already composed RFC-822 message so attachments, HTML, text, and
 * headers stay identical to the SMTP transport.
 */
export async function sendMicrosoftGraphMail(input: {
  credentials: MicrosoftGraphCredentials;
  sender: string;
  raw: Buffer;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = input.timeoutMs ?? 15_000;
  const token = await getAccessToken(input.credentials, timeoutMs);
  const endpoint = "https://graph.microsoft.com/v1.0/users/" +
    encodeURIComponent(input.sender) +
    "/sendMail";

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "text/plain",
      },
      body: input.raw.toString("base64"),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error("Microsoft Graph hat die E-Mail nicht angenommen.");
  }

  if (!response.ok) throw safeProviderError(response.status);
  // Graph returns 202 Accepted without a message ID. This means queued for
  // processing by Exchange Online, not confirmed delivery to the recipient.
}
