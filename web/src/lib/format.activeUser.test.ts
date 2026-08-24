import { describe, expect, it } from "vitest";
import {
  ACTIVE_USERS_KPI_LABEL,
  countActiveUserAccounts,
  isActiveUserAccount,
  type UserAccountActivityFields,
} from "./format";

const CASES: Array<{ name: string; user: UserAccountActivityFields; active: boolean }> = [
  { name: "Actif FR", user: { status: "Actif" }, active: true },
  { name: "active DB", user: { status: "active" }, active: true },
  { name: "statut vide = actif (COALESCE PG)", user: { status: "" }, active: true },
  { name: "statut absent = actif", user: {}, active: true },
  { name: "Archivé FR", user: { status: "Archivé" }, active: false },
  { name: "archived DB", user: { status: "archived" }, active: false },
  { name: "archive", user: { status: "archive" }, active: false },
  { name: "flag archived", user: { status: "Actif", archived: true }, active: false },
  { name: "archivedAt", user: { status: "Actif", archivedAt: "2026-01-01" }, active: false },
  { name: "archived_at", user: { status: "Actif", archived_at: "2026-01-01" }, active: false },
  { name: "Suspendu FR", user: { status: "Suspendu" }, active: false },
  { name: "suspended DB", user: { status: "suspended" }, active: false },
  { name: "Désactivé FR", user: { status: "Désactivé" }, active: false },
  { name: "disabled", user: { status: "disabled" }, active: false },
  { name: "inactive DB", user: { status: "inactive" }, active: false },
  { name: "Inactif FR", user: { status: "Inactif" }, active: false },
  { name: "flag disabled", user: { status: "Actif", disabled: true }, active: false },
  { name: "Supprimé FR", user: { status: "Supprimé" }, active: false },
  { name: "deleted DB", user: { status: "deleted" }, active: false },
  { name: "deletedAt", user: { status: "Actif", deletedAt: "2026-01-01" }, active: false },
];

describe("isActiveUserAccount (Web, équivalent Mobile)", () => {
  it("emploie le libellé KPI Utilisateurs actifs", () => {
    expect(ACTIVE_USERS_KPI_LABEL).toBe("Utilisateurs actifs");
  });

  it.each(CASES)("$name", ({ user, active }) => {
    expect(isActiveUserAccount(user)).toBe(active);
  });

  it("ne compte jamais un compte archivé comme actif", () => {
    expect(isActiveUserAccount({ status: "Archivé" })).toBe(false);
    expect(isActiveUserAccount({ status: "archived" })).toBe(false);
    expect(isActiveUserAccount({ archived: true })).toBe(false);
  });

  it("17 comptes tous actifs → 17", () => {
    const rows = Array.from({ length: 17 }, () => ({ status: "Actif" }));
    expect(countActiveUserAccounts(rows)).toBe(17);
  });

  it("17 dont 1 archivé → 16", () => {
    const rows = Array.from({ length: 17 }, (_, index) => ({
      status: index === 0 ? "Archivé" : "Actif",
    }));
    expect(countActiveUserAccounts(rows)).toBe(16);
  });

  it("17 dont 1 suspendu → 16", () => {
    const rows = Array.from({ length: 17 }, (_, index) => ({
      status: index === 0 ? "Suspendu" : "Actif",
    }));
    expect(countActiveUserAccounts(rows)).toBe(16);
  });

  it("17 dont 1 désactivé/inactif → 16", () => {
    expect(
      countActiveUserAccounts(
        Array.from({ length: 17 }, (_, index) => ({
          status: index === 0 ? "Désactivé" : "Actif",
        })),
      ),
    ).toBe(16);
    expect(
      countActiveUserAccounts(
        Array.from({ length: 17 }, (_, index) => ({
          status: index === 0 ? "Inactif" : "Actif",
        })),
      ),
    ).toBe(16);
  });
});
