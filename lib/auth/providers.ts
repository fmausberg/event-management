import "server-only";

export function getOAuthProviders() {
  return [
    ...(process.env.AUTH_GOOGLE_ID?.trim() && process.env.AUTH_GOOGLE_SECRET?.trim()
      ? [{ id: "google", name: "Google" }] : []),
    ...(process.env.AUTH_GITHUB_ID?.trim() && process.env.AUTH_GITHUB_SECRET?.trim()
      ? [{ id: "github", name: "GitHub" }] : []),
  ];
}
