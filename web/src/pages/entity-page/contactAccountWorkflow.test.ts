import { describe, expect, it, vi } from "vitest";
import type { BackOfficeState, SessionUser, UserAccount } from "../../types";
import {
  buildContactDeleteAuditEntry,
  buildContactImportPlan,
  buildContactMutationAuditEntries,
  buildContactPasswordResetGate,
  buildContactPostMergePlan,
  buildContactPreSubmitPlan,
  buildCreateFicheFromSelectionPlan,
  contactDisplayLabel,
  defaultNewContactDraft,
} from "./contactAccountWorkflow";

const admin: SessionUser = {
  id: "u-admin",
  role: "Admin School",
  schoolCode: "SCH-001",
  identifier: "admin",
} as unknown as SessionUser;

function baseState(overrides: Partial<BackOfficeState> = {}): BackOfficeState {
  return {
    schools: [{ code: "SCH-001", name: "École Test" }],
    contacts: [
      {
        id: "c1",
        lastName: "Diallo",
        firstName: "Awa",
        contactType: "Parent",
        schoolCode: "SCH-001",
        phone: "770000001",
        email: "awa@test.sn",
        hasAccess: "Non",
        status: "Actif",
      },
    ],
    users: [],
    teachers: [],
    students: [],
    classes: [],
    auditLog: [],
    ...overrides,
  } as unknown as BackOfficeState;
}

describe("contactAccountWorkflow (D2.8d2)", () => {
  it("helpers label / draft", () => {
    expect(contactDisplayLabel({ lastName: "Sow", firstName: "Ibra" })).toBe("Sow Ibra");
    expect(defaultNewContactDraft("SCH-001")).toEqual({
      status: "Actif",
      schoolCode: "SCH-001",
    });
    expect(defaultNewContactDraft("*")).toEqual({ status: "Actif", schoolCode: "" });
  });

  it("pré-submit bloque schoolCode manquant", () => {
    const showToast = vi.fn();
    const plan = buildContactPreSubmitPlan(
      { state: baseState(), showToast },
      {
        workingItem: {
          lastName: "X",
          firstName: "Y",
          contactType: "Parent",
          schoolCode: "",
        },
      },
    );
    expect(plan.ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith(
      "Le compte lié est obligatoire : un contact ne peut pas être isolé.",
      "error",
    );
  });

  it("pré-submit bloque doublon téléphone même compte", () => {
    const showToast = vi.fn();
    const plan = buildContactPreSubmitPlan(
      { state: baseState(), showToast },
      {
        workingItem: {
          lastName: "Autre",
          firstName: "Pers",
          contactType: "Parent",
          schoolCode: "SCH-001",
          phone: "770000001",
        },
      },
    );
    expect(plan.ok).toBe(false);
    expect(showToast.mock.calls[0]?.[0]).toContain("téléphone");
  });

  it("pré-submit exige un rôle si hasAccess Oui", () => {
    const showToast = vi.fn();
    const plan = buildContactPreSubmitPlan(
      { state: baseState(), showToast },
      {
        workingItem: {
          lastName: "Ndiaye",
          firstName: "Moussa",
          contactType: "Enseignant",
          schoolCode: "SCH-001",
          hasAccess: "Oui",
          role: "",
        },
      },
    );
    expect(plan.ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith(
      "Choisissez un rôle pour créer l'accès utilisateur.",
      "error",
    );
  });

  it("post-merge promote crée un compte + audit user.role.assign", () => {
    const state = baseState({
      rolePermissions: {},
      academicConfigs: {},
    });
    const snapshotUsers = structuredClone(state.users);
    const showToast = vi.fn();
    const nextContact = {
      id: "c-new",
      lastName: "Ba",
      firstName: "Fatou",
      contactType: "Enseignant",
      schoolCode: "SCH-001",
      hasAccess: "Oui",
      role: "Enseignant",
      status: "Actif",
      email: "fatou.ba@test.sn",
      phone: "770000099",
    };
    const plan = buildContactPostMergePlan(
      {
        scopeUser: admin,
        state,
        showToast,
        syncSingleUserToTeachers: (s) => ({ teachers: s.teachers }),
      },
      {
        nextContact,
        nextAllRows: [nextContact, ...(state.contacts as unknown as Record<string, unknown>[])],
        basePatch: {
          contacts: [nextContact, ...(state.contacts as unknown as Record<string, unknown>[])],
        } as Partial<BackOfficeState>,
        linkSchoolCode: "SCH-001",
        defaultSuccessMessage: "Contacts créé",
      },
    );
    if (!plan.ok) {
      expect(showToast.mock.calls, `promote failed: ${JSON.stringify(showToast.mock.calls)}`).toEqual(
        [],
      );
    }
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.promotion?.created).toBe(true);
    expect(plan.promotion?.temporaryPassword).toBeTruthy();
    // Priorité message : liaison fiche opérationnelle + mot de passe provisoire
    expect(plan.successMessage).toContain("fiche enseignant");
    expect(plan.successMessage).toContain("mot de passe provisoire");
    expect(plan.patch.users?.length).toBeGreaterThan(0);
    expect(plan.ficheLink?.linkedType).toBe("teacher");
    expect(state.users).toEqual(snapshotUsers);

    const audit = buildContactMutationAuditEntries({
      scopeUser: admin,
      nextContact,
      exists: false,
      promotion: plan.promotion,
      ficheLink: plan.ficheLink,
    });
    expect(audit.map((e) => e.action)).toEqual(
      expect.arrayContaining(["contact.create", "user.role.assign", "teacher.create"]),
    );
  });

  it("post-merge revoke hasAccess Non met à jour users/contacts", () => {
    const linkedUser = {
      id: "u1",
      identifier: "parent1",
      contactId: "c1",
      role: "Parent",
      schoolCode: "SCH-001",
      status: "Actif",
      firstName: "Awa",
      lastName: "Diallo",
    } as unknown as UserAccount;
    const state = baseState({
      users: [linkedUser],
      contacts: [
        {
          id: "c1",
          lastName: "Diallo",
          firstName: "Awa",
          contactType: "Parent",
          schoolCode: "SCH-001",
          hasAccess: "Non",
          userId: "u1",
          userIdentifier: "parent1",
          status: "Actif",
        },
      ],
    });
    const nextContact = {
      ...(state.contacts as unknown as Record<string, unknown>[])[0],
      hasAccess: "Non",
    };
    const plan = buildContactPostMergePlan(
      {
        scopeUser: admin,
        state,
        showToast: vi.fn(),
        syncSingleUserToTeachers: (s) => ({ teachers: s.teachers }),
      },
      {
        nextContact,
        nextAllRows: [nextContact],
        basePatch: { contacts: [nextContact] } as Partial<BackOfficeState>,
        linkSchoolCode: "SCH-001",
        defaultSuccessMessage: "ok",
      },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.promotion).toBeNull();
    expect(plan.patch.users).toBeDefined();
  });

  it("audit delete contact est singulier", () => {
    const entry = buildContactDeleteAuditEntry(admin, {
      id: "c1",
      lastName: "Diallo",
      firstName: "Awa",
      schoolCode: "SCH-001",
    });
    expect(entry.action).toBe("contact.delete");
    expect(entry.entityType).toBe("contact");
    expect(entry.entityLabel).toBe("Diallo Awa");
  });

  it("import : lignes invalides seules → ok false ; mixte → patch", () => {
    const state = baseState();
    const showToast = vi.fn();
    const fail = buildContactImportPlan(
      { state, scopeUser: admin, showToast },
      {
        parsedRows: [{ lastName: "", firstName: "", contactType: "" }],
        fallbackSchool: "SCH-001",
      },
    );
    expect(fail.ok).toBe(false);
    expect(showToast.mock.calls[0]?.[0]).toContain("Aucun contact importé");

    const ok = buildContactImportPlan(
      { state, scopeUser: admin, showToast: vi.fn() },
      {
        parsedRows: [
          {
            lastName: "Fall",
            firstName: "Omar",
            contactType: "Parent",
            schoolCode: "SCH-001",
          },
        ],
        fallbackSchool: "SCH-001",
      },
    );
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect((ok.patch.contacts as unknown[]).length).toBe(2);
    expect((ok.patch.auditLog as Array<{ action: string }>)[0]?.action).toBe("contact.import");
    expect(ok.successMessage).toContain("1 contact(s) importé(s)");
  });

  it("password reset gate refuse sans compte lié", () => {
    const showToast = vi.fn();
    const gate = buildContactPasswordResetGate({
      editing: { id: "c1", hasAccess: "Oui" },
      moduleKey: "contacts",
      users: [],
      canReset: () => true,
      showToast,
    });
    expect(gate.ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith("Aucun compte d'accès lié à ce contact.", "error");
  });

  it("password reset gate ok quand autorisé", () => {
    const linkedUser = {
      id: "u1",
      identifier: "parent1",
      contactId: "c1",
      role: "Parent",
      schoolCode: "SCH-001",
    } as unknown as UserAccount;
    const gate = buildContactPasswordResetGate({
      editing: { id: "c1", hasAccess: "Oui", userId: "u1" },
      moduleKey: "contacts",
      users: [linkedUser],
      canReset: () => true,
      showToast: vi.fn(),
    });
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    expect(gate.linkedUser.identifier).toBe("parent1");
  });

  it("création fiche depuis sélection invalide", () => {
    const showToast = vi.fn();
    const plan = buildCreateFicheFromSelectionPlan(
      {
        scopeUser: admin,
        state: baseState(),
        showToast,
        syncSingleUserToTeachers: (s) => ({ teachers: s.teachers }),
        effectiveSchoolCode: "SCH-001",
      },
      { selectionValue: "", moduleLabel: "Enseignants" },
    );
    expect(plan.ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith("Sélection invalide.", "error");
  });

  it("création fiche depuis contact non opérationnel refuse", () => {
    const showToast = vi.fn();
    const plan = buildCreateFicheFromSelectionPlan(
      {
        scopeUser: admin,
        state: baseState(),
        showToast,
        syncSingleUserToTeachers: (s) => ({ teachers: s.teachers }),
        effectiveSchoolCode: "SCH-001",
      },
      { selectionValue: "contact:c1", moduleLabel: "Enseignants" },
    );
    expect(plan.ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith(
      "Ce contact ne peut pas être relié à une fiche.",
      "error",
    );
  });
});
