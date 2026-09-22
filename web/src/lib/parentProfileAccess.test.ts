import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canReadView } from "./permissions";
import { isParentRole } from "./format";
import { PARENT_NAV_ITEMS } from "./constants";

function ctx(role: string) {
  return {
    user: { id: `${role}-1`, role, permissions: [] } as any,
    rolePermissions: {},
    permissionsReady: true,
    permissionsBootstrap: "ready" as const,
  };
}

describe("Parent profile access", () => {
  it("reconnaît les alias Parent canoniques", () => {
    expect(isParentRole("Parent")).toBe(true);
    expect(isParentRole("parent_student")).toBe(true);
    expect(isParentRole("Enseignant")).toBe(false);
  });

  it("réserve /mon-profil au rôle Parent", () => {
    expect(canReadView(ctx("Parent"), "parentProfile")).toBe(true);
    expect(canReadView(ctx("parent_student"), "parentProfile")).toBe(true);
    expect(canReadView(ctx("Élève / Étudiant"), "parentProfile")).toBe(false);
    expect(canReadView(ctx("Enseignant"), "parentProfile")).toBe(false);
  });

  it("enregistre une page profil Parent dédiée et une entrée de navigation", () => {
    const app = readFileSync(path.resolve(process.cwd(), "src/App.tsx"), "utf8");
    const page = readFileSync(path.resolve(process.cwd(), "src/pages/ParentProfilePage.tsx"), "utf8");

    expect(app).toContain('path="/mon-profil"');
    expect(app).toContain("<ParentProfilePage />");
    expect(PARENT_NAV_ITEMS).toContainEqual(
      expect.objectContaining({
        view: "parentProfile",
        path: "/mon-profil",
        label: "Mon profil",
      }),
    );
    expect(page).toContain('data-testid="parent-profile-page"');
    expect(page).toContain("Mes enfants liés");
  });
});
