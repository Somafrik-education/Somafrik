import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  canMutateC18Mobile,
  isC18ActionAvailable,
} from "./studentEnrollmentC18Access";

const ROOT = path.resolve(__dirname, "../..");

test("C18 Mobile RBAC : admin autorisé, parent/élève/teacher lecture refusés", () => {
  assert.equal(canMutateC18Mobile({ role: "Admin School", permissions: ["Élèves:UPDATE"] }), true);
  assert.equal(canMutateC18Mobile({ role: "Admin School", permissions: ["ALL_PRIVILEGES"] }), true);
  assert.equal(canMutateC18Mobile({ role: "Parent", permissions: ["Élèves:UPDATE", "Voir enfant"] }), false);
  assert.equal(canMutateC18Mobile({ role: "Élève / Étudiant", permissions: ["Élèves:UPDATE"] }), false);
  assert.equal(canMutateC18Mobile({ role: "Enseignant", permissions: ["Élèves:READ", "Voir élèves"] }), false);
});

test("C18 Mobile : boutons selon statut backend, pas de nextStatus local", () => {
  assert.equal(isC18ActionAvailable("validate", "PENDING_REVIEW"), true);
  assert.equal(isC18ActionAvailable("validate", "APPROVED"), false);
  assert.equal(isC18ActionAvailable("assign-class", "APPROVED"), true);
  assert.equal(isC18ActionAvailable("transfer", "ENROLLED"), true);
  assert.equal(isC18ActionAvailable("transfer", "APPROVED"), false);
  assert.equal(isC18ActionAvailable("close", "TRANSFERRED"), false);
  const accessSrc = fs.readFileSync(path.join(ROOT, "src/lib/studentEnrollmentC18Access.ts"), "utf8");
  const ficheSrc = fs.readFileSync(path.join(ROOT, "src/screens/StudentDetailScreen.tsx"), "utf8");
  assert.doesNotMatch(accessSrc, /nextStatusAfter/);
  assert.doesNotMatch(ficheSrc, /nextStatusAfter/);
});
