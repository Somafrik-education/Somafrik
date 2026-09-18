import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { clientsApi } from "./clientsApi";

vi.mock("../api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const STORAGE_KEY = "somafrik.activeSchoolCode";

describe("clientsApi.createTeacherIdentity — contrat Users canonique", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.post).mockResolvedValue({
      user: { id: "usr-1", roleKeys: ["TEACHER"] },
      credentials: { login: "USR-2026-00099", temporarySecret: "TempPass12" },
    });
  });

  it("POST /backoffice/users/create-teacher et injecte l'établissement actif", async () => {
    sessionStorage.setItem(STORAGE_KEY, "CD-2026-0001");
    await clientsApi.createTeacherIdentity({
      firstName: "Awa",
      lastName: "Ndiaye",
      temporaryPassword: "TempPass12",
    });
    expect(api.post).toHaveBeenCalledWith("/backoffice/users/create-teacher", {
      firstName: "Awa",
      lastName: "Ndiaye",
      temporaryPassword: "TempPass12",
      schoolCode: "CD-2026-0001",
    });
  });

  it("n'envoie jamais schoolCode * et ne retombe pas sur POST /teachers", async () => {
    sessionStorage.setItem(STORAGE_KEY, "*");
    await clientsApi.createTeacherIdentity({
      firstName: "Fatou",
      lastName: "Sow",
      schoolCode: "*",
      temporaryPassword: "TempPass12",
    });
    const [, payload] = vi.mocked(api.post).mock.calls[0];
    expect(api.post).toHaveBeenCalledWith("/backoffice/users/create-teacher", payload);
    expect(payload).not.toHaveProperty("schoolCode");
    expect(vi.mocked(api.post).mock.calls.some((call) => String(call[0]).includes("/teachers"))).toBe(
      false,
    );
  });
});
