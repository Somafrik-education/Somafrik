import assert from "node:assert/strict";
import { test } from "node:test";
import { parentLinkSuccessFeedback } from "./parentLinkingPresentation";

test("FICHE-RESP-01 : nouveau compte parent affiche identifiant et secret une fois", () => {
  const feedback = parentLinkSuccessFeedback({
    created: true,
    createdUser: true,
    temporaryPassword: "test-temp-only",
    user: { identifier: "parent-login" },
  });
  assert.equal(feedback.title, "Accès parent créés");
  assert.match(feedback.message, /parent-login/);
  assert.match(feedback.message, /test-temp-only/);
  assert.match(feedback.message, /pas réaffiché/);
});

test("FICHE-RESP-01 : compte existant réutilisé sans révéler d'ancien secret", () => {
  const feedback = parentLinkSuccessFeedback({
    created: true,
    createdUser: false,
    reusedUser: true,
    user: { identifier: "parent-login", temporaryPassword: "must-not-display" },
  });
  assert.equal(feedback.title, "Parent lié");
  assert.doesNotMatch(feedback.message, /must-not-display/);
  assert.match(feedback.message, /compte existant/);
});

test("FICHE-RESP-01 : absence du secret est explicitement signalée", () => {
  const feedback = parentLinkSuccessFeedback({
    createdUser: true,
    user: { identifier: "parent-login" },
  });
  assert.equal(feedback.title, "Parent lié — accès à vérifier");
  assert.doesNotMatch(feedback.message, /parent-login/);
});

test("FICHE-RESP-01 : liaison idempotente sans génération d'accès", () => {
  const feedback = parentLinkSuccessFeedback({ created: false, createdUser: false });
  assert.equal(feedback.title, "Parent déjà lié");
  assert.match(feedback.message, /Aucun nouveau mot de passe/);
});
