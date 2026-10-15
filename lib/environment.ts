import "server-only";

export function getBrandIconColor() {
  const environment = process.env.APP_ENV?.trim().toLowerCase() || process.env.NODE_ENV;
  return environment === "production" ? "#007c80" : "#f97316";
}
