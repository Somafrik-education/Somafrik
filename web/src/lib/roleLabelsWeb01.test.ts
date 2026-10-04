import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withPlatformAssignableRoles } from "./clientsApi";
import {
  CANONICAL_SYSTEM_ROLE_KEYS,
  canonicalAccessRoleKey,
  decorateAssignableRoles,
  defaultLabelForRoleKey,
  formatVisibleRoleLabels,
  grantIdentityForRoleKey,
  resolveCreatableRolesFromApi,
  uniqueRolesByRoleKey,
  userHasAccessRoleKey,
  visibleRoleLabel,
  visibleRoleLabels,
} from "./roleDisplayLabels";
import { formatAccessRolesDisplay, STUDENT_ACCESS_ROLE_LABEL } from "./userAccounts";
import {
  isStudentMessageTarget,
  isTeacherMessagingSession,
} from "./messagesRoleIdentity";

const ROOT = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = join(ROOT, "..");

function read(rel: string) {
  return readFileSync(join(WEB_SRC, rel), "utf8");
}

const schoolAdminDirecteur = {
  role: "Admin School",
  roleKey: "SCHOOL_ADMIN",
  roleKeys: ["SCHOOL_ADMIN"],
  effectiveRoleLabel: "Directeur",
};

const teacherProfesseur = {
  role: "Enseignant",
  roleKey: "TEACHER",
  roleKeys: ["TEACHER"],
  effectiveRoleLabel: "Professeur",
};

const studentEtudiant = {
  role: "Élève / Étudiant",
  roleKey: "STUDENT",
  roleKeys: ["STUDENT"],
  effectiveRoleLabel: "Étudiant",
};

const studentFallback = {
  role: "Élève / Étudiant",
  roleKey: "STUDENT",
  roleKeys: ["STUDENT"],
};

const multiRole = {
  role: "Enseignant",
  roleKey: "TEACHER",
  roleKeys: ["TEACHER", "SCHOOL_ADMIN"],
  effectiveRoleLabel: "Professeur",
  effectiveRoleLabels: [
    { roleKey: "TEACHER", defaultLabel: "Enseignant", displayLabel: "Professeur", effectiveLabel: "Professeur" },
    { roleKey: "SCHOOL_ADMIN", defaultLabel: "Admin School", displayLabel: "Directeur", effectiveLabel: "Directeur" },
  ],
};

describe("WEB-RL-01→28 ROLE-LABELS-WEB-01", () => {
  it("WEB-RL-01 Topbar SCHOOL_ADMIN → Directeur", () => {
    const topbar = read("components/layout/Topbar.tsx");
    expect(topbar).toContain("{visibleRoleLabel(user)}");
    expect(visibleRoleLabel(schoolAdminDirecteur)).toBe("Directeur");
  });

  it("WEB-RL-02 Topbar fallback → Admin School", () => {
    expect(visibleRoleLabel({ role: "Admin School", roleKey: "SCHOOL_ADMIN" })).toBe("Admin School");
  });

  it("WEB-RL-03 Topbar ne passe pas Directeur dans displayRoleName", () => {
    const topbar = read("components/layout/Topbar.tsx");
    expect(topbar).not.toMatch(/displayRoleName\s*\(\s*visibleRoleLabel/);
    expect(topbar).not.toContain("displayRoleName(");
  });

  it("WEB-RL-04 GlobalSearch → Professeur", () => {
    const search = read("components/layout/GlobalSearch.tsx");
    expect(search).toContain("visibleRoleLabel(u)");
    expect(search).not.toMatch(/displayRoleName\s*\(\s*visibleRoleLabel/);
    expect(visibleRoleLabel(teacherProfesseur)).toBe("Professeur");
  });

  it("WEB-RL-05 SecuritySettings → Professeur", () => {
    const page = read("pages/parametres/SecuritySettingsPage.tsx");
    expect(page).toContain("visibleRoleLabel");
    expect(page).not.toContain('label="Rôle" value={user?.role}');
    expect(visibleRoleLabel(teacherProfesseur)).toBe("Professeur");
  });

  it("WEB-RL-06 Users table STUDENT → Étudiant", () => {
    expect(formatAccessRolesDisplay(studentEtudiant)).toBe("Étudiant");
  });

  it("WEB-RL-07 Users fallback STUDENT → Élève / Étudiant", () => {
    expect(formatAccessRolesDisplay(studentFallback)).toBe("Élève / Étudiant");
    expect(STUDENT_ACCESS_ROLE_LABEL).toBe("Élève / Étudiant");
  });

  it("WEB-RL-08 Users TEACHER → Professeur", () => {
    expect(formatAccessRolesDisplay(teacherProfesseur)).toBe("Professeur");
  });

  it("WEB-RL-09 Users SCHOOL_ADMIN → Directeur", () => {
    expect(formatAccessRolesDisplay(schoolAdminDirecteur)).toBe("Directeur");
  });

  it("WEB-RL-10 multi-rôle → Professeur · Directeur", () => {
    expect(formatVisibleRoleLabels(multiRole)).toBe("Professeur · Directeur");
    expect(formatAccessRolesDisplay(multiRole)).toBe("Professeur · Directeur");
    expect(visibleRoleLabels(multiRole)).toEqual(["Professeur", "Directeur"]);
  });

  it("WEB-RL-11 CSV utilise les labels effectifs", () => {
    const page = read("pages/UsersPage.tsx");
    expect(page).toContain("formatAccessRolesDisplay(u)");
    expect(formatAccessRolesDisplay(multiRole)).toBe("Professeur · Directeur");
  });

  it("WEB-RL-12 filtre value = roleKey", () => {
    const page = read("pages/UsersPage.tsx");
    expect(page).toContain("value: r.roleKey");
    expect(page).toContain("userHasAccessRoleKey(u, roleFilter)");
    expect(page).not.toContain("formatAccessRolesDisplay(u) === roleFilter");
  });

  it("WEB-RL-13 filtre SCHOOL_ADMIN fonctionne avec label Directeur", () => {
    expect(userHasAccessRoleKey({ ...schoolAdminDirecteur, role: "Admin School" }, "SCHOOL_ADMIN")).toBe(true);
    expect(userHasAccessRoleKey(schoolAdminDirecteur, "PRINCIPAL")).toBe(false);
    expect(visibleRoleLabel(schoolAdminDirecteur)).toBe("Directeur");
  });

  it("WEB-RL-14 création rôle : label Professeur value TEACHER", () => {
    const page = read("pages/UsersPage.tsx");
    expect(page).toContain("value: role.roleKey");
    expect(page).toContain("label: role.optionLabel");
    const options = decorateAssignableRoles(
      [{ roleKey: "TEACHER", roleName: "Enseignant" }],
      new Map([
        [
          "TEACHER",
          { roleKey: "TEACHER", defaultLabel: "Enseignant", displayLabel: "Professeur", effectiveLabel: "Professeur" },
        ],
      ]),
    );
    expect(options[0]).toMatchObject({ roleKey: "TEACHER", optionLabel: "Professeur", roleName: "Enseignant" });
  });

  it("WEB-RL-15 attribution : label Directeur value SCHOOL_ADMIN", () => {
    const page = read("pages/UsersPage.tsx");
    expect(page).toContain("value={role.roleKey}");
    expect(page).toContain("{role.optionLabel}");
    const options = decorateAssignableRoles(
      [{ roleKey: "SCHOOL_ADMIN", roleName: "Admin School" }],
      new Map([
        [
          "SCHOOL_ADMIN",
          {
            roleKey: "SCHOOL_ADMIN",
            defaultLabel: "Admin School",
            displayLabel: "Directeur",
            effectiveLabel: "Directeur",
          },
        ],
      ]),
    );
    expect(options[0]).toMatchObject({ roleKey: "SCHOOL_ADMIN", optionLabel: "Directeur", roleName: "Admin School" });
  });

  it("WEB-RL-16 grant/revoke n'envoie jamais Directeur comme identité SCHOOL_ADMIN", () => {
    const page = read("pages/UsersPage.tsx");
    expect(page).toContain("grantIdentityForRoleKey");
    expect(page).toContain("grantUserRole(String(assigning.id), identity)");
    expect(grantIdentityForRoleKey("SCHOOL_ADMIN")).toBe("SCHOOL_ADMIN");
    expect(grantIdentityForRoleKey("Directeur")).toBe("");
    expect(grantIdentityForRoleKey("Professeur")).toBe("");
    expect(grantIdentityForRoleKey("Responsable académique")).toBe("");
  });

  it("WEB-RL-17 collision SCHOOL_ADMIN/PRINCIPAL ne fusionne pas les options", () => {
    const options = decorateAssignableRoles(
      [
        { roleKey: "SCHOOL_ADMIN", roleName: "Admin School" },
        { roleKey: "PRINCIPAL", roleName: "Directeur" },
      ],
      new Map([
        [
          "SCHOOL_ADMIN",
          {
            roleKey: "SCHOOL_ADMIN",
            defaultLabel: "Admin School",
            displayLabel: "Directeur",
            effectiveLabel: "Directeur",
          },
        ],
        [
          "PRINCIPAL",
          { roleKey: "PRINCIPAL", defaultLabel: "Directeur", displayLabel: "Directeur", effectiveLabel: "Directeur" },
        ],
      ]),
    );
    expect(options).toHaveLength(2);
    expect(options.map((row) => row.roleKey)).toEqual(["SCHOOL_ADMIN", "PRINCIPAL"]);
    expect(options[0].optionLabel).toBe("Directeur — Admin School");
    expect(options[1].optionLabel).toBe("Directeur — Directeur");
  });

  it("WEB-RL-18 dedupe par roleKey", () => {
    const merged = withPlatformAssignableRoles([
      { roleKey: "SCHOOL_ADMIN", roleName: "Admin School" },
      { roleKey: "SCHOOL_ADMIN", roleName: "Directeur" },
      { roleKey: "PRINCIPAL", roleName: "Directeur" },
    ]);
    expect(merged.filter((row) => row.roleKey === "SCHOOL_ADMIN")).toHaveLength(1);
    expect(merged.some((row) => row.roleKey === "PRINCIPAL")).toBe(true);
    expect(
      uniqueRolesByRoleKey([
        { roleKey: "SCHOOL_ADMIN", roleName: "Admin School" },
        { roleKey: "PRINCIPAL", roleName: "Directeur" },
      ]),
    ).toHaveLength(2);
  });

  it("WEB-RL-19 ConfigurationPage ne remap pas effectiveLabel", () => {
    const page = read("pages/ConfigurationPage.tsx");
    expect(page).toContain("role.effectiveLabel || role.roleName");
    expect(page).not.toContain("displayRoleName(role.effectiveLabel");
    expect(page).not.toContain("displayRoleName(selectedCatalogueRole.effectiveLabel");
  });

  it("WEB-RL-20 Messages recipient affiche Professeur", () => {
    const page = read("pages/MessagesConversationsPage.tsx");
    expect(page).toContain("formatMessageRoleLabel(user)");
    expect(page).not.toContain("displayRoleName");
  });

  it("WEB-RL-21 Messages participant affiche Étudiant si display STUDENT = Étudiant", () => {
    const page = read("pages/MessagesConversationsPage.tsx");
    expect(page).toContain("formatMessageRoleLabel(row)");
    expect(formatAccessRolesDisplay(studentEtudiant)).toBe("Étudiant");
  });

  it("WEB-RL-22 Messages logique STUDENT utilise roleKey/kind, pas roleLabel", () => {
    const page = read("pages/MessagesConversationsPage.tsx");
    expect(page).toContain("isStudentMessageTarget");
    expect(page).not.toContain("ELEVE");
    expect(isStudentMessageTarget({ roleKey: "STUDENT", roleLabel: "Apprenant" })).toBe(true);
    expect(isStudentMessageTarget({ kind: "student", roleLabel: "Directeur" })).toBe(true);
    expect(isStudentMessageTarget({ roleLabel: "Élève / Étudiant" })).toBe(false);
  });

  it("WEB-RL-23 STUDENT display Apprenant reste détecté STUDENT", () => {
    expect(isStudentMessageTarget({ roleKey: "STUDENT", roleLabel: "Apprenant" })).toBe(true);
    expect(isStudentMessageTarget({ roleLabel: "Apprenant" })).toBe(false);
  });

  it("WEB-RL-24 TEACHER session utilise roleKeys", () => {
    const identity = read("lib/messagesRoleIdentity.ts");
    expect(identity).toContain('roleKeys');
    expect(identity).toContain('"TEACHER"');
    expect(isTeacherMessagingSession({ roleKeys: ["TEACHER"] })).toBe(true);
    expect(isTeacherMessagingSession({ roleKeys: [] })).toBe(false);
    expect(isTeacherMessagingSession({ roleKeys: ["SCHOOL_ADMIN"] })).toBe(false);
  });

  it("WEB-RL-25 Compliance affiche Directeur", () => {
    const page = read("pages/SchoolComplianceDashboard.tsx");
    expect(page).toContain("row.roleLabel");
    expect(page).not.toContain("displayRoleName(row.roleLabel");
  });

  it("WEB-RL-26 PermissionsPage non-régression", () => {
    const page = read("pages/PermissionsPage.tsx");
    expect(page).toContain("Rôle technique");
    expect(page).toContain("Libellé par défaut");
    expect(page).toContain("Libellé affiché");
    expect(page).toContain("Libellé effectif");
    expect(page).toContain("Restaurer le défaut");
  });

  it("WEB-RL-27 aucun toRoleKey(display/effective label)", () => {
    expect(canonicalAccessRoleKey("Directeur")).toBe("PRINCIPAL");
    expect(canonicalAccessRoleKey("Professeur")).toBe("");
    expect(canonicalAccessRoleKey("Étudiant")).toBe("");
    expect(canonicalAccessRoleKey("Apprenant")).toBe("");
    const helpers = read("lib/roleDisplayLabels.ts");
    expect(helpers).toContain("Ne jamais appeler avec displayLabel");
    const usersPage = read("pages/UsersPage.tsx");
    expect(usersPage).not.toContain("toRoleKey(visibleRoleLabel");
    expect(usersPage).not.toContain("toRoleKey(effectiveRoleLabel");
    expect(usersPage).not.toContain("canonicalAccessRoleKey(user.effectiveRoleLabel");
  });

  it("WEB-RL-28 default labels conservés", () => {
    expect(defaultLabelForRoleKey("SCHOOL_ADMIN")).toBe("Admin School");
    expect(defaultLabelForRoleKey("TEACHER")).toBe("Enseignant");
    expect(defaultLabelForRoleKey("STUDENT")).toBe("Élève / Étudiant");
    expect(canonicalAccessRoleKey("Admin School")).toBe("SCHOOL_ADMIN");
    expect(canonicalAccessRoleKey("Enseignant")).toBe("TEACHER");
    expect(canonicalAccessRoleKey("Élève / Étudiant")).toBe("STUDENT");
  });

  it("WEB-RL-29 custom role RESP_PED value RESP_PED", () => {
    const page = read("pages/UsersPage.tsx");
    expect(page).toContain("resolveCreatableRolesFromApi");
    expect(page).not.toContain("canonicalAccessRoleKey(roleName) || roleName");
    const options = decorateAssignableRoles(
      resolveCreatableRolesFromApi({
        apiRoles: [{ roleKey: "RESP_PED", roleName: "Coordinateur pédagogique" }],
        allowlistLabels: ["Coordinateur pédagogique", "Enseignant"],
        apiAvailable: true,
      }),
      new Map(),
    );
    expect(options[0]?.roleKey).toBe("RESP_PED");
    expect(options.some((row) => row.roleKey === "COORDINATEUR PÉDAGOGIQUE")).toBe(false);
  });

  it("WEB-RL-30 display custom Responsable académique", () => {
    const options = decorateAssignableRoles(
      [{ roleKey: "RESP_PED", roleName: "Coordinateur pédagogique" }],
      new Map([
        [
          "RESP_PED",
          {
            roleKey: "RESP_PED",
            defaultLabel: "Coordinateur pédagogique",
            displayLabel: "Responsable académique",
            effectiveLabel: "Responsable académique",
          },
        ],
      ]),
    );
    expect(options[0]).toMatchObject({ roleKey: "RESP_PED", optionLabel: "Responsable académique" });
  });

  it("WEB-RL-31 display change ne change pas RESP_PED", () => {
    const before = grantIdentityForRoleKey("RESP_PED");
    const after = grantIdentityForRoleKey("RESP_PED");
    expect(before).toBe("RESP_PED");
    expect(after).toBe("RESP_PED");
    expect(canonicalAccessRoleKey("Responsable académique")).toBe("");
  });

  it("WEB-RL-32 grant custom envoie RESP_PED", () => {
    expect(grantIdentityForRoleKey("RESP_PED")).toBe("RESP_PED");
    expect(grantIdentityForRoleKey("Responsable académique")).toBe("");
  });

  it("WEB-RL-33 revoke custom envoie RESP_PED", () => {
    const page = read("pages/UsersPage.tsx");
    expect(page).toContain("revokeUserRole(String(assigning.id), identity)");
    expect(grantIdentityForRoleKey("RESP_PED")).toBe("RESP_PED");
  });

  it("WEB-RL-34 rôle custom dont roleCode diffère du roleName", () => {
    const options = resolveCreatableRolesFromApi({
      apiRoles: [
        { roleKey: "RESPONSABLE_VIE_SCOLAIRE", roleName: "Responsable vie scolaire" },
      ],
      allowlistLabels: ["Responsable vie scolaire"],
      apiAvailable: true,
    });
    expect(options).toEqual([
      { roleKey: "RESPONSABLE_VIE_SCOLAIRE", roleName: "Responsable vie scolaire" },
    ]);
    const decorated = decorateAssignableRoles(options, new Map([
      [
        "RESPONSABLE_VIE_SCOLAIRE",
        {
          roleKey: "RESPONSABLE_VIE_SCOLAIRE",
          defaultLabel: "Responsable vie scolaire",
          displayLabel: "Coordinateur",
          effectiveLabel: "Coordinateur",
        },
      ],
    ]));
    expect(decorated[0]).toMatchObject({
      roleKey: "RESPONSABLE_VIE_SCOLAIRE",
      optionLabel: "Coordinateur",
    });
  });

  it("WEB-RL-35 roleName avec espaces/accents ne fabrique jamais roleKey", () => {
    expect(canonicalAccessRoleKey("Coordinateur pédagogique")).toBe("");
    expect(canonicalAccessRoleKey("Responsable académique")).toBe("");
    expect(grantIdentityForRoleKey("Coordinateur pédagogique")).toBe("");
    expect(
      resolveCreatableRolesFromApi({
        apiRoles: [{ roleKey: "Coordinateur pédagogique", roleName: "Coordinateur pédagogique" }],
        allowlistLabels: ["Coordinateur pédagogique"],
        apiAvailable: true,
      }),
    ).toEqual([]);
  });

  it("WEB-RL-36 échec API : aucun faux roleKey custom créé", () => {
    const fallback = resolveCreatableRolesFromApi({
      apiRoles: [],
      allowlistLabels: ["Enseignant", "Coordinateur pédagogique", "Responsable académique"],
      apiAvailable: false,
    });
    expect(fallback.map((row) => row.roleKey)).toEqual(["TEACHER"]);
    expect(fallback.some((row) => /COORDINATEUR|RESPONSABLE/.test(row.roleKey))).toBe(false);
  });

  it("WEB-RL-37 catalogue local ne contient aucun rôle custom non canonique", () => {
    const helpers = read("lib/roleDisplayLabels.ts");
    expect(helpers).not.toContain("RESPONSABLE_PEDAGOGIQUE");
    expect([...CANONICAL_SYSTEM_ROLE_KEYS]).toEqual([
      "SUPER_ADMIN",
      "COUNTRY_ADMIN",
      "SCHOOL_ADMIN",
      "PROVISEUR",
      "PREFET_ETUDES",
      "PRINCIPAL",
      "SECRETARY",
      "TEACHER",
      "PARENT",
      "STUDENT",
      "ACCOUNTANT",
      "SUPERVISOR",
    ]);
    expect(defaultLabelForRoleKey("RESPONSABLE_PEDAGOGIQUE")).toBe("");
  });
});
