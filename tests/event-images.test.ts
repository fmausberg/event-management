import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { uploadEventImage, deleteEventImage } from "@/lib/events/images";
const { config, upload, destroy } = vi.hoisted(() => ({ config: vi.fn(), upload: vi.fn(), destroy: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("cloudinary", () => ({ v2: { config, uploader: { upload_stream: upload, destroy } } }));
const file = () => new File([new Uint8Array([255, 216, 255, 0])], "photo.jpg", { type: "image/jpeg" });
beforeEach(() => {
 vi.resetAllMocks(); vi.stubEnv("CLOUDINARY_CLOUD_NAME", "test-cloud"); vi.stubEnv("CLOUDINARY_API_KEY", "test-key"); vi.stubEnv("CLOUDINARY_API_SECRET", "test-secret");
 destroy.mockResolvedValue({ result: "ok" });
 upload.mockImplementation((options, callback) => ({ end: () => callback(null, { public_id: options.public_id, secure_url: "https://res.cloudinary.com/test-cloud/image/upload/image.jpg", width: 1600, height: 900 }) }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("uploads into the requested folder with unique company-scoped IDs and a 16:9 crop", async () => {
 const first = await uploadEventImage("company-1", file()); const second = await uploadEventImage("company-1", file());
 expect(first.imagePublicId).toMatch(/^events_pictures\/company-1\//); expect(first.imagePublicId).not.toBe(second.imagePublicId);
 expect(upload).toHaveBeenCalledWith(expect.objectContaining({ asset_folder: "events_pictures", overwrite: false, resource_type: "image", transformation: [{ width: 1600, height: 900, crop: "fill", gravity: "center" }], format: "jpg" }), expect.any(Function));
});
it("rejects oversized files, unsupported types and forged content before upload", async () => {
 for (const invalid of [new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.jpg", { type: "image/jpeg" }), new File(["svg"], "image.svg", { type: "image/svg+xml" }), new File(["not an image"], "fake.jpg", { type: "image/jpeg" })]) {
  await expect(uploadEventImage("company-1", invalid)).rejects.toThrow();
 }
 expect(upload).not.toHaveBeenCalled();
});
it("reports missing credentials without making a request", async () => {
 vi.stubEnv("CLOUDINARY_API_SECRET", ""); await expect(uploadEventImage("company-1", file())).rejects.toThrow("nicht eingerichtet"); expect(upload).not.toHaveBeenCalled();
});
it("cleans up a potentially uploaded asset if the upload fails", async () => {
 vi.spyOn(console, "error").mockImplementation(() => {});
 upload.mockImplementation((_options, callback) => ({ end: () => callback(new Error("private server error")) }));
 await expect(uploadEventImage("company-1", file())).rejects.toThrow("nicht zu Cloudinary"); expect(destroy).toHaveBeenCalledWith(expect.stringMatching(/^events_pictures\/company-1\//), { resource_type: "image", invalidate: true });
});
it.each([403, 401])("reports Cloudinary authorization failure %s without exposing credentials", async (status) => {
 const log = vi.spyOn(console, "error").mockImplementation(() => {});
 upload.mockImplementation((_options, callback) => ({ end: () => callback({ http_code: status, message: "private test-secret test-key" }) }));
 await expect(uploadEventImage("company-1", file())).rejects.toThrow(String(status));
 expect(log).toHaveBeenCalledWith("Cloudinary image upload failed", { status });
 expect(JSON.stringify(log.mock.calls)).not.toContain("test-secret");
 expect(destroy).toHaveBeenCalled();
});
it("invalidates deleted assets and treats missing images as already deleted", async () => {
 destroy.mockResolvedValue({ result: "not found" }); expect(await deleteEventImage("old")).toBe(true);
 expect(destroy).toHaveBeenCalledWith("old", { resource_type: "image", invalidate: true });
});
it("returns a cleanup warning instead of pretending a failed deletion succeeded", async () => {
 vi.spyOn(console, "error").mockImplementation(() => {}); destroy.mockRejectedValue(new Error("offline"));
 expect(await deleteEventImage("old")).toBe(false);
});
