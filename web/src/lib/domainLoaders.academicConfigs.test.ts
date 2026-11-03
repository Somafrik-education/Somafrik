import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  api: { get: vi.fn() },
  getAccessToken: () => "test-access-token",
}));

import { api } from "../api/client";
import { loadDomains } from "./domainLoaders";
import { COUNTRY_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";

/**
 * BULLETIN-PREPROD-01 — « academicConfigs: schoolCode établissement requis »
 * affiché au Superadmin sur les pages Paramètres : appel non ciblé refusé (400)
 * par le serveur. Aucun appel sans établissement ; aucun établissement attribué.
 */
describe("loadDomains — academicConfigs sans établissement", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  for (const [label, role, schoolCode] of [
    ["Superadmin sans établissement", SUPER_ADMIN_ROLE, ""],
    ["Superadmin portée globale *", SUPER_ADMIN_ROLE, "*"],
    ["Admin Pays sans établissement", COUNTRY_ADMIN_ROLE, undefined],
  ] as const) {
    it(`${label} : aucun appel serveur, aucune erreur, configuration vide`, async () => {
      const result = await loadDomains(["academicConfigs"], { schoolCode, role });
      expect(api.get).not.toHaveBeenCalled();
      expect(result.serverErrors).toEqual([]);
      expect(result.loaded).toEqual(["academicConfigs"]);
      expect(result.data.academicConfigs).toEqual({});
    });
  }

  it("Superadmin avec établissement sélectionné : configuration de CET établissement", async () => {
    vi.mocked(api.get).mockResolvedValue({ schoolCode: "CD-2026-0001", grading: {} } as never);
    const result = await loadDomains(["academicConfigs"], { schoolCode: "CD-2026-0001", role: SUPER_ADMIN_ROLE });
    expect(api.get).toHaveBeenCalledWith("/backoffice/establishments/CD-2026-0001/academic-config");
    expect(Object.keys(result.data.academicConfigs ?? {})).toEqual(["CD-2026-0001"]);
  });

  it("Admin établissement : comportement inchangé (appel ciblé sur son établissement)", async () => {
    vi.mocked(api.get).mockResolvedValue({ schoolCode: "CD-2026-0001" } as never);
    await loadDomains(["academicConfigs"], { schoolCode: "CD-2026-0001", role: "Admin School" });
    expect(api.get).toHaveBeenCalledWith("/backoffice/establishments/CD-2026-0001/academic-config");
  });

  it("rôle établissement sans code (cas anormal) : l'appel reste fait, le serveur reste juge", async () => {
    vi.mocked(api.get).mockResolvedValue({ schoolCode: "CD-2026-0001" } as never);
    await loadDomains(["academicConfigs"], { schoolCode: "", role: "Admin School" });
    expect(api.get).toHaveBeenCalledWith("/academic-config");
  });
});
