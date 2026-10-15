import "server-only";

// Open profiles never grant access through an email match. Only verified claims
// persist userId; auth() also rejects sessions for unverified accounts.
export async function trainerIdentityForUser(user: { id: string; email: string }) {
  return { OR: [{ userId: user.id }] };
}
