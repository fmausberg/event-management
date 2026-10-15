import "server-only";
import { randomUUID } from "node:crypto";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

export class EventImageError extends Error {}
export type UploadedEventImage = { imageUrl: string; imagePublicId: string };
export const MAX_EVENT_IMAGE_BYTES = 8 * 1024 * 1024;

function client() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) throw new EventImageError("Cloudinary ist noch nicht eingerichtet. Bitte kontaktiere den Administrator.");
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  return cloudinary;
}

export async function uploadEventImage(companyId: string, file: File): Promise<UploadedEventImage> {
  if (file.size > MAX_EVENT_IMAGE_BYTES) throw new EventImageError("Das Titelbild darf höchstens 8 MB groß sein.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new EventImageError("Bitte wähle ein JPEG-, PNG- oder WebP-Bild.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!jpeg && !png && !webp) throw new EventImageError("Die Datei ist kein unterstütztes Bild.");
  const api = client();
  const imagePublicId = `events_pictures/${companyId}/${randomUUID()}`;
  try {
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = api.uploader.upload_stream({
        resource_type: "image", public_id: imagePublicId, asset_folder: "events_pictures",
        overwrite: false, allowed_formats: ["jpg", "jpeg", "png", "webp"],
        transformation: [{ width: 1600, height: 900, crop: "fill", gravity: "center" }],
        format: "jpg", timeout: 60_000,
      }, (error, result) => error || !result ? reject(error ?? new Error("Missing upload result")) : resolve(result));
      stream.end(bytes);
    });
    if (result.public_id !== imagePublicId || !result.secure_url?.startsWith("https://") || result.width !== 1600 || result.height !== 900) throw new Error("Unexpected upload result");
    return { imagePublicId, imageUrl: result.secure_url };
  } catch (error) {
    const status = error && typeof error === "object" && "http_code" in error && typeof error.http_code === "number" ? error.http_code : undefined;
    // SDK errors can contain credentials or request details; only log the status.
    console.error("Cloudinary image upload failed", { status: status ?? "unknown" });
    await deleteEventImage(imagePublicId);
    if (status === 403) throw new EventImageError("Cloudinary verweigert den Upload (403). Bitte den Administrator bitten, die Upload-Berechtigung des verwendeten API-Keys zu prüfen (create).");
    if (status === 401) throw new EventImageError("Cloudinary akzeptiert die Zugangsdaten nicht (401). Bitte den Administrator um Prüfung der Cloudinary-Konfiguration bitten.");
    throw new EventImageError("Das Bild konnte nicht zu Cloudinary hochgeladen werden. Bitte versuche es erneut.");
  }
}

// Never accept this identifier from the browser: use only DB values or a fresh upload.
export async function deleteEventImage(publicId: string | null | undefined): Promise<boolean> {
  if (!publicId) return true;
  try {
    const result = await client().uploader.destroy(publicId, { resource_type: "image", invalidate: true });
    if (result.result !== "ok" && result.result !== "not found") throw new Error("Destroy failed");
    return true;
  } catch {
    console.error("Cloudinary image cleanup failed; delete this asset manually:", publicId);
    return false;
  }
}
