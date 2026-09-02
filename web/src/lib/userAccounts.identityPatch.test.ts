import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { formatCaughtApiError } from "./apiErrors";
import {
  canReassignUserTenant,
  getUserFormFieldPolicy,
  toUpdateUserIdentityPayload,
} from "./userAccounts";
import type { UserAccount } from "../types";

describe("toUpdateUserIdentityPayload", () => {
  it("n'envoie jamais userCode, schoolCode, countryCode ni role", () => {
    const payload = toUpdateUserIdentityPayload({
      id: "usr-1",
      publicId: "BI-IN-26-0001",
      userCode: "USR-2026-0009",
      firstName: "Aline",
      lastName: "Ndayishimiye",
      email: "aline@test.local",
      phone: "+257000000",
      gender: "Féminin",
      status: "Actif",
      role: "Admin School",
      roles: ["Admin School"],
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "BI-2026-0001",
      countryScope: "Burundi",
      countryCode: "BI",
      identifier: "aline@test.local",
      permissions: ["ALL_PRIVILEGES"],
    } as UserAccount & { userCode?: string; countryCode?: string });

    expect(payload).toEqual({
      firstName: "Aline",
      lastName: "Ndayishimiye",
      email: "aline@test.local",
      phone: "+257000000",
      gender: "Féminin",
      status: "Actif",
    });
    expect(payload).not.toHaveProperty("userCode");
    expect(payload).not.toHaveProperty("schoolCode");
    expect(payload).not.toHaveProperty("countryCode");
    expect(payload).not.toHaveProperty("role");
  });
});

describe("getUserFormFieldPolicy — édition", () => {
  const superadmin = { role: "Super Administrateur Somafrik", schoolCode: "*" };

  it("rend Pays et Établissement readonly sur un utilisateur existant", () => {
    const policy = getUserFormFieldPolicy(superadmin, "Admin School", { mode: "edit" });
    expect(policy.countryScope).toBe("readonly");
    expect(policy.schoolCode).toBe("readonly");
  });

  it("conserve les selects à la création Superadmin / Admin School", () => {
    const policy = getUserFormFieldPolicy(superadmin, "Admin School", { mode: "create" });
    expect(policy.countryScope).toBe("select");
    expect(policy.schoolCode).toBe("select");
  });
});

describe("canReassignUserTenant", () => {
  it("autorise Superadmin sur un Admin School, refuse Admin Pays cible", () => {
    expect(
      canReassignUserTenant(
        { role: "Super Administrateur Somafrik", schoolCode: "*" },
        { id: "u1", role: "Admin School" },
      ),
    ).toBe(true);
    expect(
      canReassignUserTenant(
        { role: "Super Administrateur Somafrik", schoolCode: "*" },
        { id: "u2", role: "Admin Pays", roleKeys: ["COUNTRY_ADMIN"] },
      ),
    ).toBe(false);
    expect(
      canReassignUserTenant(
        { role: "Admin School", schoolCode: "CD-2026-0001" },
        { id: "u3", role: "Admin School" },
      ),
    ).toBe(false);
  });
});

describe("formatCaughtApiError", () => {
  it("expose le code backend, jamais un toast générique de sync", () => {
    expect(
      formatCaughtApiError(
        new ApiError("Champ interdit à la création/modification d'identité: userCode.", 400, "CLIENT_IDENTITY_FIELD_FORBIDDEN"),
        "fallback",
      ),
    ).toBe("CLIENT_IDENTITY_FIELD_FORBIDDEN · Champ interdit à la création/modification d'identité: userCode.");
    expect(formatCaughtApiError(new Error("x"), "fallback")).not.toMatch(/synchronisation/i);
  });
});
