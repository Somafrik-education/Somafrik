import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatVisibleRoleLabels,
  resolveEffectiveRoleLabel,
  visibleRoleLabel,
  visibleRoleLabels,
} from "./roleDisplayLabels";

const ROOT = dirname(fileURLToPath(import.meta.url));

assert.equal(resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: "Directeur" }), "Directeur");
assert.equal(resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: null }), "Admin School");
assert.equal(visibleRoleLabel({ role: "Admin School", effectiveRoleLabel: "Directeur" }), "Directeur");
assert.deepEqual(
  visibleRoleLabels({
    roleKey: "TEACHER",
    roleKeys: ["TEACHER", "SCHOOL_ADMIN"],
    effectiveRoleLabels: [
      { roleKey: "TEACHER", defaultLabel: "Enseignant", displayLabel: "Professeur", effectiveLabel: "Professeur" },
      { roleKey: "SCHOOL_ADMIN", defaultLabel: "Admin School", displayLabel: "Directeur", effectiveLabel: "Directeur" },
    ],
  }),
  ["Professeur", "Directeur"],
);
assert.equal(
  formatVisibleRoleLabels({
    roleKey: "TEACHER",
    roleKeys: ["TEACHER", "SCHOOL_ADMIN"],
    effectiveRoleLabels: [
      { roleKey: "TEACHER", defaultLabel: "Enseignant", displayLabel: "Professeur", effectiveLabel: "Professeur" },
      { roleKey: "SCHOOL_ADMIN", defaultLabel: "Admin School", displayLabel: "Directeur", effectiveLabel: "Directeur" },
    ],
  }),
  "Professeur · Directeur",
);

const drawer = readFileSync(join(ROOT, "../components/RoleNavigationDrawer.tsx"), "utf8");
assert.match(drawer, /visibleRoleLabel/);
assert.doesNotMatch(drawer, /school_admin: "Admin établissement"/);
