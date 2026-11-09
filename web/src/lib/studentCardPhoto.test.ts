import { beforeEach, describe, expect, it, vi } from "vitest";

const requestBlob = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, requestBlob };
});
vi.mock("./apiUrl", () => ({ API_URL: "https://api.somafrik.app" }));

import { act, renderHook, waitFor } from "@testing-library/react";
import { ApiError } from "../api/client";
import {
  fetchStudentCardPhoto,
  loadStudentCardPhoto,
  resolveStudentCardPhotoUrl,
  studentCardBatchPhotoIssueSummary,
  studentCardPhotoApiPath,
  studentCardPhotoNotice,
  studentCardPhotoPath,
  useStudentCardPhoto,
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

const PNG = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

describe("CARTE-PHOTO-02 — photo canonique (pièce PHOTO)", () => {
  beforeEach(() => requestBlob.mockReset());

  it("lit la photo de l'élève sur la route canonique, avec le client JWT", async () => {
    requestBlob.mockResolvedValue(PNG());
    const result = await fetchStudentCardPhoto({ studentRef: "CD-IN-KO-26-00009", legacyPhotoUrl: "" });
    expect(result.state).toBe("photo");
    expect(requestBlob).toHaveBeenCalledWith("/students/CD-IN-KO-26-00009/photo");
  });

  it("refuse un identifiant d'élève qui sortirait du chemin prévu", () => {
    expect(studentCardPhotoPath("../schools/CD-1/logo")).toBeNull();
    expect(studentCardPhotoPath("a/b")).toBeNull();
    expect(studentCardPhotoPath("")).toBeNull();
    expect(studentCardPhotoPath("eeeeeeee-eeee-4eee-8eee-eeeeeeeeee11")).toBe("/students/eeeeeeee-eeee-4eee-8eee-eeeeeeeeee11/photo");
  });

  it("distingue absence, droits, fichier disparu, contenu invalide et indisponibilité", async () => {
    const cases: [unknown, string][] = [
      [new ApiError("Aucune photo", 404, "STUDENT_PHOTO_ABSENT"), "absent"],
      [new ApiError("Non authentifié", 401), "forbidden"],
      [new ApiError("Refusé", 403, "STUDENT_DOC_DENIED"), "forbidden"],
      [new ApiError("Fichier", 404, "STUDENT_PHOTO_FILE_MISSING"), "file_missing"],
      [new ApiError("Eleve introuvable", 404), "unavailable"],
      [new ApiError("Type", 422, "STUDENT_PHOTO_INVALID"), "invalid"],
      [new ApiError("Erreur", 500), "unavailable"],
      [new TypeError("Failed to fetch"), "unavailable"],
    ];
    for (const [failure, state] of cases) {
      requestBlob.mockReset();
      requestBlob.mockRejectedValue(failure);
      expect((await fetchStudentCardPhoto({ studentRef: "CD-1" })).state).toBe(state);
    }
    requestBlob.mockReset();
    requestBlob.mockResolvedValue(new Blob(["<html>"], { type: "text/html" }));
    expect((await fetchStudentCardPhoto({ studentRef: "CD-1" })).state).toBe("invalid");
  });

  it("n'utilise l'ancien photo_url que si le dossier n'a aucune pièce PHOTO", async () => {
    requestBlob.mockRejectedValueOnce(new ApiError("Aucune photo", 404, "STUDENT_PHOTO_ABSENT"));
    const legacy = await fetchStudentCardPhoto({ studentRef: "CD-1", legacyPhotoUrl: "https://cdn.example.net/p.jpg" });
    expect(legacy).toEqual({ state: "photo_url", src: "https://cdn.example.net/p.jpg" });
    expect(requestBlob).toHaveBeenCalledTimes(1);

    requestBlob.mockReset();
    requestBlob.mockRejectedValueOnce(new ApiError("Refusé", 403));
    const denied = await fetchStudentCardPhoto({ studentRef: "CD-1", legacyPhotoUrl: "https://cdn.example.net/p.jpg" });
    expect(denied.state).toBe("forbidden");
  });

  it("donne un diagnostic non sensible, sans nom, identifiant ni chemin", () => {
    expect(studentCardPhotoNotice("photo")).toBeNull();
    expect(studentCardPhotoNotice("absent")).toBeNull();
    for (const state of ["forbidden", "file_missing", "invalid", "unavailable"] as const) {
      const notice = studentCardPhotoNotice(state)!;
      expect(notice).toContain("initiales");
      expect(notice).not.toMatch(/\/api\/|storage|Bearer|CD-/);
    }
    expect(studentCardBatchPhotoIssueSummary([null, "forbidden", "forbidden", "file_missing"])).toBe(
      "Causes : 2 non lisibles avec vos droits (pièces de l’élève) ; 1 fichier photo introuvable sur le serveur.",
    );
    expect(studentCardBatchPhotoIssueSummary([null, "absent"])).toBeNull();
  });

  it("efface la photo dès que l'élève ou l'établissement change, et révoque l'URL locale", async () => {
    let created = 0;
    const createObjectUrl = vi.fn(() => `blob:photo-${(created += 1)}`);
    const revokeObjectUrl = vi.fn();
    const pending: Record<string, (blob: Blob) => void> = {};
    const read = vi.fn((path: string) => new Promise<Blob>((resolve) => { pending[path] = resolve; }));
    const { result, rerender, unmount } = renderHook(
      (props: { studentRef: string; scope: string }) =>
        useStudentCardPhoto({ ...props, legacyPhotoUrl: null }, { read, createObjectUrl, revokeObjectUrl }),
      { initialProps: { studentRef: "STU-A", scope: "CD-LAC-26-001" } },
    );
    expect(result.current).toEqual({ src: null, state: "loading" });
    await act(async () => pending["/students/STU-A/photo"](PNG()));
    expect(result.current).toEqual({ src: "blob:photo-1", state: "photo" });

    // Changement d'établissement : l'ancienne photo disparaît dans le même rendu.
    rerender({ studentRef: "STU-A", scope: "BI-BUJ-26-001" });
    expect(result.current).toEqual({ src: null, state: "loading" });
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:photo-1");

    // Changement d'élève pendant le chargement : la réponse périmée est ignorée.
    const stale = pending["/students/STU-A/photo"];
    rerender({ studentRef: "STU-B", scope: "BI-BUJ-26-001" });
    await act(async () => stale(PNG()));
    expect(result.current.src).toBeNull();
    await act(async () => pending["/students/STU-B/photo"](PNG()));
    await waitFor(() => expect(result.current.state).toBe("photo"));
    const last = result.current.src;
    unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith(last);
  });
});
