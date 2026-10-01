/**
 * AUDIT Administration — tests ROUGES de complétude Superadmin.
 * Exclus de la suite Vitest CI (`*.audit.red.test.ts`).
 * Affirment qu'un onglet Administration n'est opérationnel que si
 * UI → API → persistance → relecture est ouvert pour le Superadmin.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canReadView, type PermissionContext } from "./permissions";
import { SUPER_ADMIN_ROLE } from "./orgHierarchy";
import type { SessionUser } from "../types";

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

function superCtx(): PermissionContext {
  return {
    user: {
      id: "super-1",
      role: SUPER_ADMIN_ROLE,
      permissions: ["ALL_PRIVILEGES"],
      schoolCode: "*",
    } as SessionUser,
    rolePermissions: {},
    permissionsReady: true,
  };
}

describe("Administration — RED complétude Superadmin", () => {
  it("RED-ADM-REL : Superadmin a la vue Relations ET le GET n'est pas deny plateforme", () => {
    expect(canReadView(superCtx(), "relations")).toBe(true);
    const guard = readFileSync(join(ROOT, "../../../backend/lib/platformPersonalDataGuard.js"), "utf8");
    expect(guard).not.toMatch(/"GET \/api\/backoffice\/relations"/);
    expect(read("./routeDomainMap.ts")).toMatch(/prefix: "\/administration\/relations"/);
  });

  it("RED-ADM-DOC : Superadmin ouvre Documents Administration", () => {
    expect(canReadView(superCtx(), "documents")).toBe(true);
    const api = read("./schoolDocumentsApi.ts");
    expect(api).toMatch(/upload|download|FormData/);
  });

  it("RED-ADM-CONF : Superadmin ouvre Conformité branchée sur un journal persisté", () => {
    expect(canReadView(superCtx(), "reports")).toBe(true);
    const page = read("../pages/ReportsPage.tsx");
    expect(page).toMatch(/\/api\/audit|erasure-requests|reports\/advanced/);
  });

  it("RED-ADM-REL-DELETE : le client Relations expose une suppression persistée", () => {
    expect(read("./clientsApi.ts")).toMatch(/deleteRelation|archiveRelation/);
  });

  it("RED-ADM-DROITS-RESET : l'UI Rôles et droits expose effective + reset d'override", () => {
    const page = read("../pages/PermissionsPage.tsx");
    const api = read("./rbacApi.ts");
    expect(api).toMatch(/getEffective|permissions\/effective/);
    expect(page).toMatch(/getEffective|resetOverride|permissions\/effective/);
  });

  it("RED-ADM-TABS : le layout n'affiche que les onglets réellement autorisés", () => {
    const layout = read("../pages/administration/AdministrationLayout.tsx");
    expect(layout).toMatch(/canReadView|visibleTabs/);
  });
});
