import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEffectiveRoleLabel, visibleRoleLabel } from "./roleDisplayLabels";

const ROOT = dirname(fileURLToPath(import.meta.url));

assert.equal(resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: "Directeur" }), "Directeur");
assert.equal(resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: null }), "Admin School");
assert.equal(visibleRoleLabel({ role: "Admin School", effectiveRoleLabel: "Directeur" }), "Directeur");

const drawer = readFileSync(join(ROOT, "../components/RoleNavigationDrawer.tsx"), "utf8");
assert.match(drawer, /visibleRoleLabel/);
const identity = readFileSync(join(ROOT, "canonicalRoleIdentity.ts"), "utf8");
assert.doesNotMatch(identity, /displayLabel|effectiveLabel/);
