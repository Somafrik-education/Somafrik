import assert from "node:assert/strict";
import {
  MAX_HOME_KPIS,
  getRoleHomeShell,
  resolveRoleHomeKey,
  selectHomeKpis,
} from "./roleHomeConfig";

assert.equal(MAX_HOME_KPIS, 4);

const admin = getRoleHomeShell({ role: "school_admin" });
assert.equal(admin.spaceLabel, "Espace administrateur");
assert.equal(admin.kpiKeys.length, 4);
assert.deepEqual(admin.kpiKeys, ["users", "classes", "students", "payments"]);
assert.ok(admin.actionKeys.includes("users"));
assert.ok(admin.actionKeys.includes("classes"));
assert.ok(admin.actionKeys.includes("teachers"));
assert.ok(admin.actionKeys.includes("payments"));

const prefet = getRoleHomeShell({ role: "prefet" });
assert.equal(prefet.spaceLabel, "Espace préfet des études");
assert.deepEqual(prefet.kpiKeys, ["classes", "students", "presence", "payments"]);

const teacher = getRoleHomeShell({ role: "teacher" });
assert.equal(teacher.spaceLabel, "Espace enseignant");
assert.equal(teacher.showSecurityMatrix, false);

const parent = getRoleHomeShell({ role: "parent_student" });
assert.equal(parent.spaceLabel, "Espace parent");

assert.equal(resolveRoleHomeKey({ role: "secretary" }), "secretary");
assert.equal(resolveRoleHomeKey({ user: { role: "Comptable" } }), "accountant");

const trimmed = selectHomeKpis(
  [
    { key: "users" as const },
    { key: "classes" as const },
    { key: "students" as const },
    { key: "payments" as const },
    { key: "presence" as const },
  ],
);
assert.equal(trimmed.length, 4);
assert.equal(trimmed.at(-1)?.key, "payments");

console.log("roleHomeConfig.test.ts OK");
