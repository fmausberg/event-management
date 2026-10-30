import "server-only";
import { createHash } from "node:crypto";
export const hashReviewToken = (token: string) => createHash("sha256").update(token).digest("hex");
