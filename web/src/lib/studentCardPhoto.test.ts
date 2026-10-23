import { beforeEach, describe, expect, it, vi } from "vitest";

const requestBlob = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ requestBlob }));
vi.mock("./apiUrl", () => ({ API_URL: "https://api.somafrik.app" }));

import {
  loadStudentCardPhoto,
  resolveStudentCardPhotoUrl,
  studentCardPhotoApiPath,
} from "./studentCardPhoto";

describe("CARTE-PHOTO-01 — photo élève", () => {
  beforeEach(() => requestBlob.mockReset());

  it("résout une photo relative sur l'API et non sur le domaine Web", () => {
    expect(resolveStudentCardPhotoUrl("/uploads/students/photo.jpg")).toBe("https://api.somafrik.app/uploads/students/photo.jpg");
    expect(resolveStudentCardPhotoUrl("uploads/students/photo.jpg")).toBe("https://api.somafrik.app/uploads/students/photo.jpg");
    expect(resolveStudentCardPhotoUrl("")).toBeNull();
  });

  it("ne transmet jamais d'authentification à un domaine tiers", async () => {
    const source = "https://storage.example.net/photo.jpg";
    expect((await loadStudentCardPhoto(source)).src).toBe(source);
    expect(requestBlob).not.toHaveBeenCalled();
  });

  it("récupère une image protégée avec le client JWT, sans paramètre token", async () => {
    requestBlob.mockResolvedValue(new Blob(["img"], { type: "image/png" }));
    const result = await loadStudentCardPhoto("https://api.somafrik.app/api/students/photo", () => "blob:local-photo");
    expect(requestBlob).toHaveBeenCalledWith("/students/photo");
    expect(result).toEqual({ src: "blob:local-photo", revoke: true });
  });

  it("refuse les schémas dangereux, le type non image et l'accès JWT extérieur", async () => {
    expect(resolveStudentCardPhotoUrl("javascript:alert(1)")).toBeNull();
    expect(resolveStudentCardPhotoUrl("file:///secret")).toBeNull();
    expect(studentCardPhotoApiPath("https://example.net/api/private")).toBeNull();
    requestBlob.mockResolvedValue(new Blob(["wrong"], { type: "text/html" }));
    expect(await loadStudentCardPhoto("/api/students/photo")).toEqual({ src: null, revoke: false });
  });
});
