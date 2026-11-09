import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAuthorizedRollCallClasses } from "./authorizedRollCallClasses";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("classes d'appel : uniquement les métadonnées serveur sur liste blanche", () => {
  const result = parseAuthorizedRollCallClasses({ classes: [
    { classId: B, classCode: "B", className: "2e B", students: [{ secret: "private" }], schoolId: "other" },
    { classId: A.toUpperCase(), classCode: " A ", className: "2e A", permissions: ["admin"] },
    { classId: A, className: "Doublon" },
    { classId: "invalid", className: "Intrus" },
    { classId: "33333333-3333-4333-8333-333333333333", className: "" },
  ] });
  assert.deepEqual(result, [
    { classId: A, classCode: "A", className: "2e A" },
    { classId: B, classCode: "B", className: "2e B" },
  ]);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("other"), false);
});

test("classes d'appel : réponse manquante, invalide ou excessive = refus", () => {
  for (const raw of [null, undefined, {}, { classes: null }, { classes: {} }, { classes: "all" }]) {
    assert.throws(() => parseAuthorizedRollCallClasses(raw));
  }
  assert.throws(() => parseAuthorizedRollCallClasses({ classes: Array(5001).fill({ classId: A, className: "A" }) }));
});

test("classes d'appel : aucune classe serveur = aucune classe autorisée (aucun fallback local)", () => {
  assert.deepEqual(parseAuthorizedRollCallClasses({ classes: [] }), []);
});
