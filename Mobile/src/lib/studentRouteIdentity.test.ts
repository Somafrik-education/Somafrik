/**
 * npx tsx Mobile/src/lib/studentRouteIdentity.test.ts — #1113 / #1141 (implémentation canonique).
 * Test complémentaire repris de PARITE-WEB-MOBILE-RECOVERY-01 / LOT 6 (#1195, f5d034795),
 * décision CTO PARITÉ-SAFE-02 : une route (deep link, notification, paramètre de navigation)
 * ne remplace jamais l'identité de l'élève authentifié ; les écrans appelants transmettent `user`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  filterRowsByStudentScope,
  resolveMobileStudentScope,
  resolveParentSafeStudentId,
  sessionStudentAliasKeys,
} from "./canonicalStudentIdentity";

const OWN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const STALE = "33333333-3333-4333-8333-333333333333";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const user = { id: USER_ID, linkedStudent: { studentId: OWN, studentCode: "CD-IN-EL-26-001" } };

// 1. Route forgée vers un autre élève : ignorée.
assert.equal(resolveParentSafeStudentId({ role: "student", routeStudentId: OTHER, selectedStudentId: OWN, user }), OWN);
// 2. Sélection obsolète (ex. session précédente sur le même téléphone) : ignorée.
assert.equal(resolveParentSafeStudentId({ role: "student", selectedStudentId: STALE, user }), OWN);
// 3. Parcours normal (actions rapides : route = sa propre identité) : inchangé.
assert.equal(resolveParentSafeStudentId({ role: "student", routeStudentId: OWN, selectedStudentId: OWN, user }), OWN);
// 4. Sans liaison serveur : fail-closed, jamais l'identifiant de route.
assert.equal(resolveParentSafeStudentId({ role: "student", routeStudentId: OTHER, user: { id: USER_ID } }), null);

// 5. Périmètre de données : seules les lignes de l'élève authentifié.
const keys = sessionStudentAliasKeys({ role: "student", selectedStudentId: OTHER, user });
assert.ok(keys.includes(OWN) && keys.includes("CD-IN-EL-26-001"));
assert.ok(!keys.includes(OTHER) && !keys.includes(USER_ID));
const rows = [{ studentId: OWN, id: "n1" }, { studentId: OTHER, id: "n2" }];
const scope = resolveMobileStudentScope({ role: "student", selectedStudentId: OTHER, user });
assert.deepEqual(filterRowsByStudentScope(rows, scope).map((row) => row.id), ["n1"]);
assert.deepEqual(sessionStudentAliasKeys({ role: "student", selectedStudentId: OTHER, user: { id: USER_ID } }), []);

// 6. Parent : comportement inchangé (enfant lié uniquement).
const parentUser = { id: USER_ID, children: [{ id: OWN }, { id: OTHER }] };
assert.equal(resolveParentSafeStudentId({ role: "parent_student", selectedStudentId: OTHER, user: parentUser }), OTHER);
assert.equal(resolveParentSafeStudentId({ role: "parent_student", routeStudentId: STALE, user: parentUser }), null);

// 7. Tous les écrans appelants transmettent `user` (sinon le périmètre Élève serait vide).
const SRC = path.join(__dirname, "..");
for (const screen of ["HomeScreen", "StudentDetailScreen", "StudentNotesScreen", "StudentPresencesScreen", "StudentPaymentsScreen"]) {
  const source = fs.readFileSync(path.join(SRC, "screens", `${screen}.tsx`), "utf8");
  for (const call of source.matchAll(/(resolveParentSafeStudentId|sessionStudentAliasKeys)\(\{([\s\S]*?)\}\)/g)) {
    assert.match(call[2], /user/, `${screen} : ${call[1]} sans user`);
  }
}

console.log("OK studentRouteIdentity: route et sélection ne remplacent jamais l'élève authentifié");
