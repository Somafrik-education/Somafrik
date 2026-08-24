import assert from "node:assert/strict";
import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import { canMutateEntity, canReadEntity, entityFeatureMap } from "../domain/security/permissions";
import {
  CANONICAL_CRUD_ENTITIES,
  canCancelSchoolPayment,
  canCreateTeacherIdentity,
  canGrantUserRole,
  resolveEntityCrudAccess,
} from "./mobileCrudParity";
import { MOBILE_GENERIC_ADMIN_CRUD_IN_RC1, MOBILE_ROLE_PERMISSION_MUTATION_ENABLED } from "./mobileMutationSafety";

function liveSession(input: {
  sessionRole?: string;
  roleLabel?: string;
  roleKeys?: string[];
  permissions: string[];
  schoolCode?: string;
}) {
  return attachCanonicalRoleIdentity({
    role: input.sessionRole,
    permissions: input.permissions,
    user: {
      id: "user-p0-crud",
      name: "P0 CRUD",
      schoolCode: input.schoolCode ?? "CD-IN-26-001",
      role: input.roleLabel,
      roleKeys: input.roleKeys,
      permissions: input.permissions,
    },
  });
}

const adminSchool = liveSession({
  sessionRole: "school_admin",
  roleLabel: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: [
    "Utilisateurs:CRUD",
    "Classes:CRUD",
    "Élèves:CRUD",
    "Enseignants:READ",
    "Enseignants:CREATE",
    "Affectations:CRUD",
    "Paiements:CREATE",
    "Gérer paiements",
    "Notifications:CREATE",
    "Notifications:UPDATE",
    "Gérer classes",
    "Gérer utilisateurs",
    "Gérer élèves",
  ],
});

assert.equal(canReadEntity(adminSchool, "classes"), true);
assert.equal(canMutateEntity(adminSchool, "classes", "CREATE"), true, "Admin School Classes:CREATE → CTA");
assert.equal(canMutateEntity(adminSchool, "classes", "UPDATE"), true);
assert.equal(canMutateEntity(adminSchool, "classes", "DELETE"), true);
assert.equal(canMutateEntity(adminSchool, "users", "CREATE"), true);
assert.equal(canMutateEntity(adminSchool, "users", "UPDATE"), true);
assert.equal(canMutateEntity(adminSchool, "students", "CREATE"), true);
assert.equal(canMutateEntity(adminSchool, "students", "UPDATE"), true);
assert.equal(canMutateEntity(adminSchool, "students", "DELETE"), true);
assert.equal(canMutateEntity(adminSchool, "teachers", "CREATE"), true, "Admin School peut CREATE enseignant");
assert.equal(canMutateEntity(adminSchool, "teachers", "UPDATE"), false, "Admin School n'UPDATE pas les enseignants");
assert.equal(canMutateEntity(adminSchool, "teachers", "DELETE"), false);
assert.equal(canGrantUserRole(adminSchool), true, "GRANT rôle utilisateur ≠ matrice RBAC");
assert.equal(
  canCreateTeacherIdentity(adminSchool),
  true,
  "Créer un enseignant Mobile = Utilisateurs CREATE + GRANT, pas POST /teachers",
);

const teachersCreateOnly = liveSession({
  sessionRole: "school_admin",
  roleLabel: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Enseignants:READ", "Enseignants:CREATE"],
});
assert.equal(canMutateEntity(teachersCreateOnly, "teachers", "CREATE"), true);
assert.equal(
  canCreateTeacherIdentity(teachersCreateOnly),
  false,
  "Enseignants:CREATE seul ne suffit pas : POST /teachers est 403",
);
assert.equal(canMutateEntity(adminSchool, "payments", "CREATE"), true);
assert.equal(canCancelSchoolPayment(adminSchool), true, "Gérer paiements / UPDATE → CTA annuler");
assert.equal(canMutateEntity(adminSchool, "assignments", "CREATE"), true);
assert.equal(canMutateEntity(adminSchool, "announcements", "CREATE"), true);

const gererClassesOnly = liveSession({
  sessionRole: "school_admin",
  roleLabel: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Gérer classes"],
});
assert.equal(canMutateEntity(gererClassesOnly, "classes", "CREATE"), true, "Gérer classes = CREATE backend");
assert.equal(canMutateEntity(gererClassesOnly, "classes", "UPDATE"), true);

const readOnlyClasses = liveSession({
  sessionRole: "teacher",
  roleLabel: "Enseignant",
  roleKeys: ["TEACHER"],
  permissions: ["Classes:READ", "Voir classes"],
});
assert.equal(canMutateEntity(readOnlyClasses, "classes", "CREATE"), false);
assert.deepEqual(resolveEntityCrudAccess(readOnlyClasses, "classes"), {
  canRead: true,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
});

const prefetTeachers = liveSession({
  sessionRole: "prefet",
  roleLabel: "Préfet des études",
  roleKeys: ["PREFET_ETUDES"],
  permissions: ["Enseignants:UPDATE", "Enseignants:DELETE", "Enseignants:READ", "Affectations:CREATE"],
});
assert.equal(canMutateEntity(prefetTeachers, "teachers", "UPDATE"), true);
assert.equal(canMutateEntity(prefetTeachers, "teachers", "DELETE"), true);
assert.equal(canMutateEntity(prefetTeachers, "teachers", "CREATE"), false);
assert.equal(canCreateTeacherIdentity(prefetTeachers), false);
assert.equal(canMutateEntity(prefetTeachers, "assignments", "CREATE"), true);

const paymentCreateOnly = liveSession({
  sessionRole: "secretary",
  roleLabel: "Secrétaire",
  roleKeys: ["SECRETARY"],
  permissions: ["Paiements:READ", "Paiements:CREATE"],
});
assert.equal(canMutateEntity(paymentCreateOnly, "payments", "CREATE"), true);
assert.equal(
  canCancelSchoolPayment(paymentCreateOnly),
  false,
  "CREATE seul n'ouvre pas l'annulation (Paiements:UPDATE requis)",
);

const accountantCancel = liveSession({
  sessionRole: "accountant",
  roleLabel: "Comptable",
  roleKeys: ["ACCOUNTANT"],
  permissions: ["Paiements:READ", "Paiements:CREATE", "Paiements:UPDATE"],
});
assert.equal(canCancelSchoolPayment(accountantCancel), true);
assert.equal(canMutateEntity(accountantCancel, "classes", "CREATE"), false);

assert.equal(MOBILE_GENERIC_ADMIN_CRUD_IN_RC1, false, "ne pas réactiver AdminCrud générique");
assert.equal(MOBILE_ROLE_PERMISSION_MUTATION_ENABLED, false, "GRANT/REVOKE Mobile reste interdit");

const webMobileFeatureParity: Record<(typeof CANONICAL_CRUD_ENTITIES)[number], string> = {
  classes: "Classes",
  users: "Utilisateurs",
  students: "Élèves",
  teachers: "Enseignants",
  payments: "Paiements",
  assignments: "Affectations",
  announcements: "Notifications",
};
for (const entity of CANONICAL_CRUD_ENTITIES) {
  assert.equal(
    entityFeatureMap[entity],
    webMobileFeatureParity[entity],
    `Web↔Mobile: ${entity} doit mapper la même feature RBAC`,
  );
}

const crudActions = ["CREATE", "UPDATE", "DELETE"] as const;
for (const entity of CANONICAL_CRUD_ENTITIES) {
  const access = resolveEntityCrudAccess(adminSchool, entity);
  if (entity === "teachers") {
    assert.equal(access.canCreate, true);
    assert.equal(access.canUpdate, false);
    assert.equal(access.canDelete, false);
    continue;
  }
  for (const action of crudActions) {
    if (entity === "users" && action === "DELETE") continue;
    if (entity === "payments" && action !== "CREATE") continue;
    if (entity === "announcements" && action === "DELETE") continue;
    if (action === "CREATE") assert.equal(access.canCreate, true, `Admin School ${entity}:${action}`);
    if (action === "UPDATE" && entity !== "payments") {
      assert.equal(access.canUpdate, true, `Admin School ${entity}:${action}`);
    }
  }
}

console.log("mobileCrudParity.test.ts OK");
