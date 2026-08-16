import { describe, expect, it } from "vitest";
import type { BackOfficeState, Session, UserAccount } from "../types";
import {
  applyRoleChangeToUser,
  buildNewUserDraft,
  getDefaultSchoolCode,
  getUserFormFieldPolicy,
  toCreateUserApiPayload,
  toProvisionUserApiPayload,
  validateUserAccount,
} from "./userAccounts";

const state = {
  schools: [
    { code: "CD-2026-0001", name: "Unikin", country: "RDC", countryCode: "CD" },
    { code: "BI-2026-0001", name: "Lycée BI", country: "Burundi", countryCode: "BI" },
  ],
  users: [],
  countries: [
    { code: "CD", name: "République démocratique du Congo" },
    { code: "BI", name: "Burundi" },
  ],
  rolePermissions: {},
} as unknown as BackOfficeState;

const superadminSession = {
  user: {
    id: "super-1",
    role: "Super Administrateur Somafrik",
    schoolCode: "*",
    identifier: "superadmin",
  },
} as Session;

describe("Superadmin create-user tenant defaults", () => {
  it("ne choisit jamais schools[0] / CD pour un Superadmin", () => {
    expect(getDefaultSchoolCode(superadminSession)).toBe("");
    const draft = buildNewUserDraft("", superadminSession, state);
    expect(draft.schoolCode).toBe("");
    expect(draft.countryScope).toBe("");
    expect(draft.role).toBe("");
  });

  it("affiche pays + établissement vides dès l'ouverture, sans rôle", () => {
    const policy = getUserFormFieldPolicy(superadminSession.user, "");
    expect(policy.countryScope).toBe("select");
    expect(policy.schoolCode).toBe("select");
    const editPolicy = getUserFormFieldPolicy(superadminSession.user, "Admin School", { mode: "edit" });
    expect(editPolicy.countryScope).toBe("readonly");
    expect(editPolicy.schoolCode).toBe("readonly");
  });

  it("ne préremplit pas une école CD quand le rôle Admin School est choisi", () => {
    const draft = buildNewUserDraft("", superadminSession, state);
    const next = applyRoleChangeToUser(draft, "Admin School", superadminSession, state);
    expect(next.schoolCode).toBe("");
    expect(next.countryScope).toBe("");
    expect(next.role).toBe("Admin School");
  });

  it("envoie schoolCode vide explicitement pour bloquer le fallback sessionStorage", () => {
    const payload = toCreateUserApiPayload({
      firstName: "Amina",
      lastName: "Ndayishimiye",
      schoolCode: "",
      countryScope: "BI",
      role: "Admin School",
    } as UserAccount);
    expect(payload).toMatchObject({
      firstName: "Amina",
      lastName: "Ndayishimiye",
      schoolCode: "",
      countryCode: "BI",
      countryScope: "BI",
    });
  });

  it("refuse Admin School sans pays / sans école", () => {
    const creator = superadminSession.user;
    expect(
      validateUserAccount(
        { firstName: "A", lastName: "B", role: "Admin School", schoolCode: "", countryScope: "" } as UserAccount,
        [],
        ["Admin Pays", "Admin School"],
        { creator, schools: state.schools },
      ),
    ).toBe("Pays obligatoire pour un admin école.");
    expect(
      validateUserAccount(
        { firstName: "A", lastName: "B", role: "Admin School", schoolCode: "", countryScope: "BI" } as UserAccount,
        [],
        ["Admin Pays", "Admin School"],
        { creator, schools: state.schools },
      ),
    ).toBe("Sélectionnez l'établissement à administrer.");
  });

  it("refuse une école CD pour un pays BI", () => {
    expect(
      validateUserAccount(
        {
          firstName: "A",
          lastName: "B",
          role: "Admin School",
          schoolCode: "CD-2026-0001",
          countryScope: "BI",
        } as UserAccount,
        [],
        ["Admin Pays", "Admin School"],
        {
          creator: superadminSession.user,
          allowedSchoolCodes: ["cd-2026-0001", "bi-2026-0001"],
          schools: state.schools,
        },
      ),
    ).toBe("L'établissement n'appartient pas au pays sélectionné.");
  });

  it("construit un payload provision Admin School sans héritage session", () => {
    expect(
      toProvisionUserApiPayload({
        firstName: "Grace",
        lastName: "Kanyosha",
        schoolCode: "BI-2026-0001",
        countryScope: "BI",
        role: "Admin School",
        temporaryPassword: "Tmp-1",
      } as UserAccount),
    ).toMatchObject({
      firstName: "Grace",
      lastName: "Kanyosha",
      schoolCode: "BI-2026-0001",
      countryCode: "BI",
      roleKey: "SCHOOL_ADMIN",
    });
  });

  it("construit un payload provision Admin Pays sans schoolCode", () => {
    const payload = toProvisionUserApiPayload({
      firstName: "Amina",
      lastName: "Nshimirimana",
      schoolCode: "*",
      countryScope: "BI",
      role: "Admin Pays",
    } as UserAccount);
    expect(payload).toMatchObject({
      firstName: "Amina",
      lastName: "Nshimirimana",
      countryCode: "BI",
      roleKey: "COUNTRY_ADMIN",
    });
    expect(payload).not.toHaveProperty("schoolCode");
  });
});
