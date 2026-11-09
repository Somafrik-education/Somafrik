import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveEffectiveRoleLabel, visibleRoleLabel } from "./roleDisplayLabels";

const ROOT = dirname(fileURLToPath(import.meta.url));

function read(rel: string) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("AUDIT-ROLE-LABELS-01 Mobile", () => {
  it("RL-21 drawer : visibleRoleLabel sans ROLE_LABELS autorité", () => {
    const drawer = read("../components/RoleNavigationDrawer.tsx");
    assert.match(drawer, /visibleRoleLabel/);
    assert.match(drawer, /identity\.roleLabel/);
    assert.doesNotMatch(drawer, /school_admin: "Admin établissement"/);
  });

  it("RL-22 profil : pas de rôle d'accès catalogue", () => {
    const profile = read("../screens/ParentProfileScreen.tsx");
    assert.match(profile, /Espace parent/);
    assert.doesNotMatch(profile, /visibleRoleLabel|effectiveRoleLabel/);
  });

  it("RL-23 multi-rôle session : pas de sélecteur de libellés", () => {
    const identity = read("./canonicalRoleIdentity.ts");
    assert.match(identity, /effectiveRoleLabel/);
    assert.match(identity, /SCHOOL_ADMIN: "Admin School"/);
    assert.match(identity, /TEACHER: "Enseignant"/);
    assert.doesNotMatch(identity, /sélecteur de session multi-rôle/);
  });

  it("RL-24 liste users : normalizeUser conserve effectiveRoleLabel", () => {
    const normalize = read("./canonicalResourceNormalize.ts");
    assert.match(normalize, /effectiveRoleLabel/);
    const users = read("../screens/UsersScreen.tsx");
    assert.match(users, /formatVisibleRoleLabels/);
    assert.doesNotMatch(users, /displayRoleName\(/);
  });

  it("RL-25 + preuves visuelles sans mutation", () => {
    assert.equal(resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: "Directeur" }), "Directeur");
    assert.equal(resolveEffectiveRoleLabel({ defaultLabel: "Élève / Étudiant", displayLabel: "Étudiant" }), "Étudiant");
    assert.equal(resolveEffectiveRoleLabel({ defaultLabel: "Enseignant", displayLabel: "Professeur" }), "Professeur");
    assert.equal(visibleRoleLabel({ role: "Admin School", effectiveRoleLabel: "Directeur" }), "Directeur");
    const format = read("./format.ts");
    assert.match(format, /displayRoleName/);
  });
});
