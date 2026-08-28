import assert from "node:assert/strict";
import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import { canManagePresences, canMutateEntity, canReadEntity, entityFeatureMap, hasSecurityPermission } from "../domain/security/permissions";
import {
  CANONICAL_CRUD_ENTITIES,
  canCancelSchoolPayment,
  canCreateTeacherIdentity,
  canGrantUserRole,
  canRecordSchoolPayment,
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
    "Announcements:READ",
    "Announcements:CREATE",
    "Announcements:UPDATE",
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
assert.equal(
  canMutateEntity(adminSchool, "teachers", "UPDATE"),
  false,
  "sans Enseignants:UPDATE, Admin School n'UPDATE pas — pas de fallback Admin=tout",
);
assert.equal(canMutateEntity(adminSchool, "teachers", "DELETE"), false);

const adminSchoolTeachersUpdate = liveSession({
  sessionRole: "school_admin",
  roleLabel: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Enseignants:READ", "Enseignants:CREATE", "Enseignants:UPDATE"],
});
assert.equal(
  canMutateEntity(adminSchoolTeachersUpdate, "teachers", "UPDATE"),
  true,
  "jeton live Enseignants:UPDATE → CTA Modifier (plus de hard-deny school_admin)",
);
assert.equal(canMutateEntity(adminSchoolTeachersUpdate, "teachers", "DELETE"), false);
assert.equal(canMutateEntity(adminSchoolTeachersUpdate, "teachers", "CREATE"), true);
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
assert.equal(canGrantUserRole(adminSchool), true, "GRANT/REVOKE rôle utilisateur = Utilisateurs:UPDATE");
assert.equal(canGrantUserRole(prefetTeachers), false, "Préfet sans Utilisateurs:UPDATE ne révoque pas");

const paymentCreateOnly = liveSession({
  sessionRole: "secretary",
  roleLabel: "Secrétaire",
  roleKeys: ["SECRETARY"],
  permissions: ["Paiements:READ", "Paiements:CREATE"],
});
assert.equal(canMutateEntity(paymentCreateOnly, "payments", "CREATE"), true);
assert.equal(canRecordSchoolPayment(paymentCreateOnly), true, "CREATE seul ouvre l'encaissement");
assert.equal(
  canCancelSchoolPayment(paymentCreateOnly),
  false,
  "CREATE seul n'ouvre pas l'annulation (Paiements:UPDATE requis)",
);

const paymentUpdateOnly = liveSession({
  sessionRole: "accountant",
  roleLabel: "Comptable",
  roleKeys: ["ACCOUNTANT"],
  permissions: ["Paiements:READ", "Paiements:UPDATE"],
});
assert.equal(canRecordSchoolPayment(paymentUpdateOnly), true, "UPDATE seul ouvre l'encaissement F6");
assert.equal(canCancelSchoolPayment(paymentUpdateOnly), true);

const paymentReadOnly = liveSession({
  sessionRole: "parent",
  roleLabel: "Parent",
  roleKeys: ["PARENT"],
  permissions: ["Paiements:READ"],
});
assert.equal(canRecordSchoolPayment(paymentReadOnly), false, "READ seul n'ouvre pas l'encaissement");
assert.equal(canCancelSchoolPayment(paymentReadOnly), false);

const paymentNone = liveSession({
  sessionRole: "teacher",
  roleLabel: "Enseignant",
  roleKeys: ["TEACHER"],
  permissions: [],
});
assert.equal(canRecordSchoolPayment(paymentNone), false, "aucune permission → encaissement absent");

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
  announcements: "Announcements",
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

/** J3 — jetons live (forme PostgreSQL) → CTA. Aucun fallback Admin=tout. */
const teacherLive = liveSession({
  sessionRole: "teacher",
  roleLabel: "Enseignant",
  roleKeys: ["TEACHER"],
  permissions: [
    "Classes:READ",
    "Élèves:READ",
    "Présences:READ",
    "Présences:CREATE",
    "Présences:UPDATE",
    "Notes:READ",
    "Notes:CREATE",
    "Notes:UPDATE",
  ],
});
assert.equal(canMutateEntity(teacherLive, "classes", "CREATE"), false, "Teacher ne crée pas de classe");
assert.equal(canMutateEntity(teacherLive, "users", "UPDATE"), false, "Teacher n'a pas GRANT rôle");
assert.equal(hasSecurityPermission(teacherLive, "Notes", "UPDATE"), true);
assert.equal(canManagePresences(teacherLive), true);

const accountantLive = liveSession({
  sessionRole: "accountant",
  roleLabel: "Comptable",
  roleKeys: ["ACCOUNTANT"],
  permissions: ["Paiements:READ", "Paiements:CREATE", "Paiements:UPDATE", "Paiements:DELETE", "Rapports:READ"],
});
assert.equal(hasSecurityPermission(accountantLive, "Notes", "UPDATE"), false, "Accountant ne modifie pas les notes");
assert.equal(canMutateEntity(accountantLive, "classes", "CREATE"), false);
assert.equal(canMutateEntity(accountantLive, "payments", "CREATE"), true);
assert.equal(canMutateEntity(accountantLive, "payments", "UPDATE"), true, "annuler paiement = Paiements:UPDATE");

const secretaryLive = liveSession({
  sessionRole: "secretary",
  roleLabel: "Secrétaire",
  roleKeys: ["SECRETARY"],
  permissions: [
    "Élèves:READ",
    "Élèves:CREATE",
    "Élèves:UPDATE",
    "Paiements:READ",
    "Paiements:CREATE",
    "Paiements:UPDATE",
    "Présences:READ",
    "Présences:CREATE",
    "Présences:UPDATE",
  ],
});
assert.equal(canMutateEntity(secretaryLive, "students", "CREATE"), true);
assert.equal(canMutateEntity(secretaryLive, "payments", "CREATE"), true);
assert.equal(hasSecurityPermission(secretaryLive, "Notes", "UPDATE"), false);

const supervisorLive = liveSession({
  sessionRole: "supervisor",
  roleLabel: "Surveillant",
  roleKeys: ["SUPERVISOR"],
  permissions: ["Élèves:READ", "Présences:READ", "Présences:CREATE", "Présences:UPDATE", "Présences:DELETE"],
});
assert.equal(canManagePresences(supervisorLive), true);
assert.equal(canMutateEntity(supervisorLive, "classes", "CREATE"), false);
assert.equal(hasSecurityPermission(supervisorLive, "Notes", "CREATE"), false);

const parentLive = liveSession({
  sessionRole: "parent_student",
  roleLabel: "Parent",
  roleKeys: ["PARENT"],
  permissions: ["Élèves:READ", "Notes:READ", "Présences:READ", "Paiements:READ", "Classes:READ"],
});
assert.equal(canMutateEntity(parentLive, "classes", "CREATE"), false, "Parent ne crée pas de classe");
assert.equal(canMutateEntity(parentLive, "payments", "CREATE"), false);
assert.equal(hasSecurityPermission(parentLive, "Notes", "READ"), true);

const studentLive = liveSession({
  sessionRole: "student",
  roleLabel: "Élève / Étudiant",
  roleKeys: ["STUDENT"],
  permissions: ["Notes:READ", "Présences:READ", "Paiements:READ", "Classes:READ"],
});
assert.equal(canMutateEntity(studentLive, "classes", "CREATE"), false);
assert.equal(canMutateEntity(studentLive, "users", "UPDATE"), false);
assert.equal(canMutateEntity(studentLive, "students", "DELETE"), false);

const prefetLive = liveSession({
  sessionRole: "prefet",
  roleLabel: "Préfet des études",
  roleKeys: ["PREFET_ETUDES"],
  permissions: [
    "Classes:READ",
    "Classes:CREATE",
    "Classes:UPDATE",
    "Enseignants:READ",
    "Enseignants:UPDATE",
    "Enseignants:DELETE",
    "Notes:READ",
    "Notes:CREATE",
    "Notes:UPDATE",
  ],
});
assert.equal(canMutateEntity(prefetLive, "classes", "CREATE"), true);
assert.equal(canMutateEntity(prefetLive, "teachers", "UPDATE"), true);
assert.equal(canCreateTeacherIdentity(prefetLive), false, "Préfet sans Utilisateurs:CREATE");

console.log("mobileCrudParity.test.ts OK");
