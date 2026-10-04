import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeUser } from "./canonicalResourceNormalize";
import {
  attachCanonicalRoleIdentity,
  canonicalizeRoleKey,
  resolveCanonicalRoleIdentity,
} from "./canonicalRoleIdentity";
import { applyLivePermissionsToSession } from "./livePermissionsRefresh";
import { formatMessageRoleLabel, isStudentMessageTarget, isTeacherMessagingSession } from "./messagesRoleIdentity";
import {
  CANONICAL_SYSTEM_ROLE_KEYS,
  decorateAssignableRoles,
  defaultLabelForRoleKey,
  formatVisibleRoleLabels,
  grantIdentityForRoleKey,
  indexRoleDisplayCatalog,
  visibleRoleLabel,
} from "./roleDisplayLabels";
import {
  alignRolesToCatalogue,
  applyUserRoleAssignment,
  visibleAssignableRoles,
} from "./userRoleAssignment";

const ROOT = dirname(fileURLToPath(import.meta.url));

function read(rel: string) {
  return readFileSync(join(ROOT, rel), "utf8");
}

const teacherDto = {
  id: "usr-teacher",
  firstName: "Awa",
  lastName: "Ndiaye",
  role: "Enseignant",
  roleKey: "TEACHER",
  roleKeys: ["TEACHER"],
  effectiveRoleLabel: "Professeur",
  effectiveRoleLabels: [
    { roleKey: "TEACHER", defaultLabel: "Enseignant", displayLabel: "Professeur", effectiveLabel: "Professeur" },
  ],
};

const schoolAdminDto = {
  id: "usr-admin",
  firstName: "Grace",
  lastName: "Mwamba",
  role: "Admin School",
  roleKey: "SCHOOL_ADMIN",
  roleKeys: ["SCHOOL_ADMIN"],
  effectiveRoleLabel: "Directeur",
  effectiveRoleLabels: [
    {
      roleKey: "SCHOOL_ADMIN",
      defaultLabel: "Admin School",
      displayLabel: "Directeur",
      effectiveLabel: "Directeur",
    },
  ],
};

const studentDto = {
  id: "usr-student",
  firstName: "Marc",
  lastName: "Rumba",
  role: "Élève / Étudiant",
  roleKey: "STUDENT",
  roleKeys: ["STUDENT"],
  effectiveRoleLabel: "Étudiant",
};

const customDto = {
  id: "usr-custom",
  firstName: "Lina",
  lastName: "Kabila",
  role: "Coordinateur pédagogique",
  roleKey: "RESP_PED",
  roleKeys: ["RESP_PED"],
  effectiveRoleLabel: "Responsable académique",
  effectiveRoleLabels: [
    {
      roleKey: "RESP_PED",
      defaultLabel: "Coordinateur pédagogique",
      displayLabel: "Responsable académique",
      effectiveLabel: "Responsable académique",
    },
  ],
};

const displayCatalog = indexRoleDisplayCatalog([
  { roleKey: "TEACHER", defaultLabel: "Enseignant", displayLabel: "Professeur", effectiveLabel: "Professeur" },
  { roleKey: "SCHOOL_ADMIN", defaultLabel: "Admin School", displayLabel: "Directeur", effectiveLabel: "Directeur" },
  { roleKey: "PRINCIPAL", defaultLabel: "Directeur", displayLabel: "Directeur", effectiveLabel: "Directeur" },
  {
    roleKey: "RESP_PED",
    defaultLabel: "Coordinateur pédagogique",
    displayLabel: "Responsable académique",
    effectiveLabel: "Responsable académique",
  },
  {
    roleKey: "RESPONSABLE_VIE_SCOLAIRE",
    defaultLabel: "Responsable vie scolaire",
    displayLabel: "Coordinateur",
    effectiveLabel: "Coordinateur",
  },
]);

describe("MOBILE-RL-01→38 ROLE-LABELS-MOBILE-01", () => {
  it("MOBILE-RL-01 normalizeUser conserve effectiveRoleLabel", () => {
    const user = normalizeUser(teacherDto);
    assert.equal(user?.effectiveRoleLabel, "Professeur");
  });

  it("MOBILE-RL-02 normalizeUser conserve effectiveRoleLabels[]", () => {
    const user = normalizeUser(teacherDto);
    assert.equal(user?.effectiveRoleLabels?.[0]?.effectiveLabel, "Professeur");
    assert.equal(user?.effectiveRoleLabels?.[0]?.roleKey, "TEACHER");
  });

  it("MOBILE-RL-03 TEACHER → Professeur", () => {
    assert.equal(visibleRoleLabel(normalizeUser(teacherDto)), "Professeur");
  });

  it("MOBILE-RL-04 SCHOOL_ADMIN → Directeur", () => {
    assert.equal(visibleRoleLabel(normalizeUser(schoolAdminDto)), "Directeur");
  });

  it("MOBILE-RL-05 STUDENT → Étudiant", () => {
    assert.equal(visibleRoleLabel(normalizeUser(studentDto)), "Étudiant");
  });

  it("MOBILE-RL-06 fallback TEACHER → Enseignant", () => {
    assert.equal(visibleRoleLabel({ role: "Enseignant", roleKey: "TEACHER" }), "Enseignant");
    assert.equal(defaultLabelForRoleKey("TEACHER"), "Enseignant");
  });

  it("MOBILE-RL-07 fallback SCHOOL_ADMIN → Admin School", () => {
    assert.equal(visibleRoleLabel({ role: "Admin School", roleKey: "SCHOOL_ADMIN" }), "Admin School");
  });

  it("MOBILE-RL-08 fallback STUDENT → Élève / Étudiant", () => {
    assert.equal(visibleRoleLabel({ role: "Élève / Étudiant", roleKey: "STUDENT" }), "Élève / Étudiant");
  });

  it("MOBILE-RL-09 Login identify affiche Directeur", () => {
    const login = read("../screens/LoginScreen.tsx");
    assert.match(login, /identity\?\.roleLabel/);
    const identity = resolveCanonicalRoleIdentity({
      role: "school_admin",
      roleLabel: "Directeur",
      roleKey: "SCHOOL_ADMIN",
      roleKeys: ["SCHOOL_ADMIN"],
      user: { role: "Admin School", roleKey: "SCHOOL_ADMIN", roleKeys: ["SCHOOL_ADMIN"], effectiveRoleLabel: "Directeur" },
    });
    assert.equal(identity.roleLabel, "Directeur");
  });

  it("MOBILE-RL-10 Login identify n'applique aucun remap", () => {
    const login = read("../screens/LoginScreen.tsx");
    assert.doesNotMatch(login, /displayRoleName\(/);
    assert.doesNotMatch(login, /Admin établissement/);
  });

  it("MOBILE-RL-11 session login conserve effectiveRoleLabel", () => {
    const session = attachCanonicalRoleIdentity({
      role: "teacher",
      roleLabel: "Professeur",
      roleKey: "TEACHER",
      roleKeys: ["TEACHER"],
      user: {
        id: "u1",
        name: "Awa",
        role: "Enseignant",
        roleKey: "TEACHER",
        roleKeys: ["TEACHER"],
        effectiveRoleLabel: "Professeur",
        effectiveRoleLabels: teacherDto.effectiveRoleLabels,
      },
    });
    assert.equal(session?.user?.effectiveRoleLabel, "Professeur");
    assert.equal(session?.user?.role, "Enseignant");
    assert.equal(session?.roleKey, "TEACHER");
  });

  it("MOBILE-RL-12 SecureStore/profile roundtrip conserve effectiveRoleLabel", () => {
    const profile = {
      role: "teacher",
      roleLabel: "Professeur",
      roleKey: "TEACHER",
      roleKeys: ["TEACHER"],
      effectiveRoleLabel: "Professeur",
      user: { ...teacherDto, name: "Awa Ndiaye" },
    };
    const restored = JSON.parse(JSON.stringify(profile));
    assert.equal(restored.effectiveRoleLabel, "Professeur");
    assert.equal(restored.user.effectiveRoleLabel, "Professeur");
  });

  it("MOBILE-RL-13 roundtrip conserve effectiveRoleLabels[]", () => {
    const profile = {
      user: teacherDto,
      effectiveRoleLabels: teacherDto.effectiveRoleLabels,
    };
    const restored = JSON.parse(JSON.stringify(profile));
    assert.equal(restored.user.effectiveRoleLabels[0].effectiveLabel, "Professeur");
  });

  it("MOBILE-RL-14 refresh permissions ne supprime pas effectiveRoleLabel", () => {
    const session = {
      role: "teacher",
      roleLabel: "Professeur",
      roleKey: "TEACHER",
      roleKeys: ["TEACHER"],
      effectiveRoleLabel: "Professeur",
      permissions: ["Notes:READ"],
      user: {
        id: "u1",
        role: "Enseignant",
        roleKey: "TEACHER",
        roleKeys: ["TEACHER"],
        effectiveRoleLabel: "Professeur",
        permissions: ["Notes:READ"],
      },
    };
    const next = applyLivePermissionsToSession(session, {
      permissions: ["Notes:READ", "Notes:CREATE"],
      roleKeys: ["TEACHER"],
    });
    assert.equal(next.user?.effectiveRoleLabel, "Professeur");
    assert.deepEqual(next.roleKeys, ["TEACHER"]);
  });

  it("MOBILE-RL-15 Drawer SCHOOL_ADMIN → Directeur", () => {
    const session = attachCanonicalRoleIdentity({
      role: "school_admin",
      roleKeys: ["SCHOOL_ADMIN"],
      user: { role: "Admin School", roleKey: "SCHOOL_ADMIN", roleKeys: ["SCHOOL_ADMIN"], effectiveRoleLabel: "Directeur" },
    });
    assert.equal(visibleRoleLabel(session?.user) || resolveCanonicalRoleIdentity(session).roleLabel, "Directeur");
  });

  it("MOBILE-RL-16 Drawer TEACHER → Professeur", () => {
    const session = attachCanonicalRoleIdentity({
      role: "teacher",
      roleKeys: ["TEACHER"],
      user: { role: "Enseignant", roleKey: "TEACHER", roleKeys: ["TEACHER"], effectiveRoleLabel: "Professeur" },
    });
    assert.equal(visibleRoleLabel(session?.user), "Professeur");
  });

  it("MOBILE-RL-17 Drawer n'utilise plus ROLE_LABELS comme autorité", () => {
    const drawer = read("../components/RoleNavigationDrawer.tsx");
    assert.match(drawer, /visibleRoleLabel\(session\?\.user\)/);
    assert.doesNotMatch(drawer, /ROLE_LABELS\[session/);
    assert.doesNotMatch(drawer, /school_admin: "Admin établissement"/);
  });

  it("MOBILE-RL-18 Users TEACHER → Professeur", () => {
    const user = normalizeUser(teacherDto);
    assert.equal(formatVisibleRoleLabels(user), "Professeur");
    assert.match(read("../screens/UsersScreen.tsx"), /formatVisibleRoleLabels\(user\)/);
  });

  it("MOBILE-RL-19 Users STUDENT → Étudiant", () => {
    assert.equal(formatVisibleRoleLabels(normalizeUser(studentDto)), "Étudiant");
  });

  it("MOBILE-RL-20 Users multi-rôle → Professeur · Directeur", () => {
    const user = normalizeUser({
      id: "usr-multi",
      firstName: "Awa",
      lastName: "Ndiaye",
      role: "Enseignant",
      roleKey: "TEACHER",
      roleKeys: ["TEACHER", "SCHOOL_ADMIN"],
      effectiveRoleLabel: "Professeur",
      effectiveRoleLabels: [
        { roleKey: "TEACHER", defaultLabel: "Enseignant", displayLabel: "Professeur", effectiveLabel: "Professeur" },
        { roleKey: "SCHOOL_ADMIN", defaultLabel: "Admin School", displayLabel: "Directeur", effectiveLabel: "Directeur" },
      ],
    });
    assert.equal(formatVisibleRoleLabels(user), "Professeur · Directeur");
  });

  it("MOBILE-RL-21 Users ne fait pas displayRoleName(effectiveLabel)", () => {
    const users = read("../screens/UsersScreen.tsx");
    assert.doesNotMatch(users, /displayRoleName\(/);
    assert.match(users, /formatVisibleRoleLabels\(user\)/);
  });

  it("MOBILE-RL-22 custom RESP_PED → Responsable académique", () => {
    assert.equal(visibleRoleLabel(normalizeUser(customDto)), "Responsable académique");
  });

  it("MOBILE-RL-23 choice custom value = RESP_PED", () => {
    const choices = visibleAssignableRoles(
      [{ roleCode: "RESP_PED", roleName: "Coordinateur pédagogique" }],
      displayCatalog,
    );
    assert.equal(choices[0]?.roleKey, "RESP_PED");
    assert.equal(choices[0]?.optionLabel, "Responsable académique");
  });

  it("MOBILE-RL-24 grant custom envoie RESP_PED", async () => {
    const grants: string[] = [];
    await applyUserRoleAssignment({
      user: { id: "u", roleKeys: [] },
      userId: "u",
      currentRoles: [],
      selectedRoles: ["RESP_PED"],
      grant: async (_id, role) => {
        grants.push(role);
      },
      revoke: async () => undefined,
    });
    assert.deepEqual(grants, ["RESP_PED"]);
    assert.equal(grantIdentityForRoleKey("Responsable académique"), "");
  });

  it("MOBILE-RL-25 revoke custom envoie RESP_PED", async () => {
    const revokes: string[] = [];
    await applyUserRoleAssignment({
      user: { id: "u", roleKeys: ["RESP_PED"] },
      userId: "u",
      currentRoles: ["RESP_PED"],
      selectedRoles: [],
      grant: async () => undefined,
      revoke: async (_id, role) => {
        revokes.push(role);
      },
    });
    assert.deepEqual(revokes, ["RESP_PED"]);
  });

  it("MOBILE-RL-26 display change ne change pas RESP_PED", () => {
    assert.equal(grantIdentityForRoleKey("RESP_PED"), "RESP_PED");
    assert.notEqual(canonicalizeRoleKey("Responsable académique"), "RESP_PED");
    assert.equal(grantIdentityForRoleKey("Responsable académique"), "");
  });

  it("MOBILE-RL-27 dedupe par roleKey", () => {
    const choices = visibleAssignableRoles(
      [
        { roleCode: "SCHOOL_ADMIN", roleName: "Admin School" },
        { roleKey: "SCHOOL_ADMIN", roleName: "Directeur" },
        { roleCode: "PRINCIPAL", roleName: "Directeur" },
      ],
      displayCatalog,
    );
    assert.equal(choices.filter((row) => row.roleKey === "SCHOOL_ADMIN").length, 1);
    assert.equal(choices.some((row) => row.roleKey === "PRINCIPAL"), true);
  });

  it("MOBILE-RL-28 collision SCHOOL_ADMIN / PRINCIPAL conserve deux options", () => {
    const choices = decorateAssignableRoles(
      [
        { roleKey: "SCHOOL_ADMIN", roleName: "Admin School" },
        { roleKey: "PRINCIPAL", roleName: "Directeur" },
      ],
      displayCatalog,
    );
    assert.equal(choices.length, 2);
    assert.deepEqual(choices.map((row) => row.roleKey), ["SCHOOL_ADMIN", "PRINCIPAL"]);
    assert.equal(choices[0].optionLabel.includes("Directeur"), true);
    assert.equal(choices[1].optionLabel.includes("Directeur"), true);
  });

  it("MOBILE-RL-29 API assignable 200 [] → aucune option", () => {
    assert.deepEqual(visibleAssignableRoles([]), []);
  });

  it("MOBILE-RL-30 API malformed → aucun faux roleKey", () => {
    assert.deepEqual(
      visibleAssignableRoles([
        { roleName: "Enseignant" },
        { roleCode: "Directeur", roleName: "Directeur" },
        { roleCode: "Coordinateur pédagogique", roleName: "Coordinateur pédagogique" },
      ]),
      [],
    );
  });

  it("MOBILE-RL-31 rôle actif absent catalogue n'est pas révoqué par omission", () => {
    const aligned = alignRolesToCatalogue(["RESP_PED", "TEACHER"], visibleAssignableRoles([{ roleCode: "TEACHER", roleName: "Enseignant" }]));
    assert.deepEqual(aligned, ["RESP_PED", "TEACHER"]);
  });

  it("MOBILE-RL-32 SchoolAssignableRoles affiche effectiveLabel", () => {
    const page = read("../screens/SchoolAssignableRolesScreen.tsx");
    assert.match(page, /effectiveLabel/);
    assert.match(page, /listRoleDisplayLabels/);
  });

  it("MOBILE-RL-33 Messages roleLabel affiché direct", () => {
    const page = read("../screens/MessagesScreen.tsx");
    assert.match(page, /formatMessageRoleLabel\(row\)/);
    assert.doesNotMatch(page, /displayRoleName\(/);
    assert.equal(formatMessageRoleLabel({ roleLabel: "Professeur" }), "Professeur");
  });

  it("MOBILE-RL-34 Messages STUDENT logique par roleKey/kind", () => {
    assert.equal(isStudentMessageTarget({ roleKey: "STUDENT", roleLabel: "Apprenant" }), true);
    assert.equal(isStudentMessageTarget({ kind: "student", roleLabel: "Directeur" }), true);
    assert.equal(isStudentMessageTarget({ roleLabel: "Élève / Étudiant" }), false);
    assert.equal(isTeacherMessagingSession({ roleKeys: ["TEACHER"] }), true);
  });

  it("MOBILE-RL-35 aucun canonicalizeRoleKey sur effectiveRoleLabel", () => {
    const identity = read("./canonicalRoleIdentity.ts");
    assert.doesNotMatch(identity, /canonicalizeRoleKey\(session\?\.roleLabel\)/);
    assert.doesNotMatch(identity, /canonicalizeRoleKey\([^)]*effectiveRoleLabel/);
    assert.doesNotMatch(read("../screens/UsersScreen.tsx"), /canonicalizeRoleKey\(/);
  });

  it("MOBILE-RL-36 Directeur display SCHOOL_ADMIN reste SCHOOL_ADMIN", () => {
    const identity = resolveCanonicalRoleIdentity({
      role: "school_admin",
      roleLabel: "Directeur",
      roleKey: "SCHOOL_ADMIN",
      roleKeys: ["SCHOOL_ADMIN"],
      user: {
        role: "Admin School",
        roleKey: "SCHOOL_ADMIN",
        roleKeys: ["SCHOOL_ADMIN"],
        effectiveRoleLabel: "Directeur",
      },
    });
    assert.equal(identity.roleKey, "SCHOOL_ADMIN");
    assert.equal(identity.roleLabel, "Directeur");
    assert.notEqual(identity.roleKey, "PRINCIPAL");
    assert.equal(canonicalizeRoleKey("Directeur"), "PRINCIPAL");
  });

  it("MOBILE-RL-37 multi-rôle roleKeys inchangés", () => {
    const session = attachCanonicalRoleIdentity({
      role: "teacher",
      roleKeys: ["TEACHER", "SCHOOL_ADMIN"],
      user: {
        role: "Enseignant",
        roleKey: "TEACHER",
        roleKeys: ["TEACHER", "SCHOOL_ADMIN"],
        effectiveRoleLabel: "Professeur",
        effectiveRoleLabels: [
          { roleKey: "TEACHER", defaultLabel: "Enseignant", displayLabel: "Professeur", effectiveLabel: "Professeur" },
          { roleKey: "SCHOOL_ADMIN", defaultLabel: "Admin School", displayLabel: "Directeur", effectiveLabel: "Directeur" },
        ],
      },
    });
    assert.deepEqual(session?.roleKeys, ["SCHOOL_ADMIN", "TEACHER"]);
    assert.deepEqual(session?.user?.roleKeys, ["SCHOOL_ADMIN", "TEACHER"]);
  });

  it("MOBILE-RL-38 ADJOINT reste legacy, pas catalogue ADMIN-02B", () => {
    assert.equal((CANONICAL_SYSTEM_ROLE_KEYS as readonly string[]).includes("ADJOINT"), false);
    assert.match(read("./canonicalRoleIdentity.ts"), /ADJOINT: "Directeur adjoint"/);
    assert.match(read("./canonicalRoleIdentity.ts"), /alias legacy/);
  });

  it("chemin DTO users → normalizeUser → UsersScreen", () => {
    const user = normalizeUser({
      ...teacherDto,
      publicId: "USR-1",
      schoolPublicCode: "CD-IN-26-001",
    });
    const rendered = `Rôle(s) d'accès : ${formatVisibleRoleLabels(user)}`;
    assert.equal(rendered, "Rôle(s) d'accès : Professeur");
    assert.match(read("../screens/UsersScreen.tsx"), /formatVisibleRoleLabels\(user\)/);
  });

  it("chemin LoginResponse → session → Drawer", () => {
    const session = attachCanonicalRoleIdentity({
      role: "school_admin",
      roleLabel: "Directeur",
      roleKey: "SCHOOL_ADMIN",
      roleKeys: ["SCHOOL_ADMIN"],
      user: {
        id: "admin-1",
        name: "Grace Mwamba",
        role: "Admin School",
        roleKey: "SCHOOL_ADMIN",
        roleKeys: ["SCHOOL_ADMIN"],
        effectiveRoleLabel: "Directeur",
      },
    });
    const drawerLabel = visibleRoleLabel(session?.user) || resolveCanonicalRoleIdentity(session).roleLabel;
    assert.equal(drawerLabel, "Directeur");
    assert.equal(session?.roleKey, "SCHOOL_ADMIN");
  });
});
