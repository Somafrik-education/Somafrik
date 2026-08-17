import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { isArchivedSubjectStatus, subjectsApi } from "./subjectsApi";

vi.mock("../api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/client")>();
  return {
    ...original,
    api: {
      ...original.api,
      get: vi.fn(),
      post: vi.fn(),
    },
  };
});

describe("subjectsApi", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it("liste GET /v2/subjects et mappe code/name sans liste locale", async () => {
    vi.mocked(api.get).mockResolvedValue([
      { code: "SUB-MATH", name: "Mathématiques", status: "Active" },
    ]);
    const rows = await subjectsApi.list();
    expect(api.get).toHaveBeenCalledWith("/v2/subjects");
    expect(rows).toEqual([
      expect.objectContaining({
        code: "SUB-MATH",
        subjectCode: "SUB-MATH",
        name: "Mathématiques",
        status: "Active",
      }),
    ]);
  });

  it("propage une erreur API au lieu de renvoyer []", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("catalogue down"));
    await expect(subjectsApi.list()).rejects.toThrow("catalogue down");
  });

  it("détecte les statuts archivés FR/EN", () => {
    expect(isArchivedSubjectStatus("Archivée")).toBe(true);
    expect(isArchivedSubjectStatus("archived")).toBe(true);
    expect(isArchivedSubjectStatus("Active")).toBe(false);
    expect(isArchivedSubjectStatus("active")).toBe(false);
  });
});
