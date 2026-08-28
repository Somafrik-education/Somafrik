"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canManageFeeGrids,
  canManagePaymentMethods,
  canAdjustStudentFee,
  canManagePaymentStatuses,
  canForceReminder,
} = require("./financeManagement");

function principal(role, permissions) {
  return { role, permissions };
}

test("F6: le nom du rôle n'accorde jamais seul une capacité Finance", () => {
  const roles = [
    "Super Administrateur Somafrik",
    "Admin School",
    "Comptable",
    "Secrétaire",
    "Directeur",
  ];
  for (const role of roles) {
    const empty = principal(role, []);
    assert.equal(canManageFeeGrids(empty), false, `${role}: fee grids`);
    assert.equal(canManagePaymentMethods(empty), false, `${role}: payment methods`);
    assert.equal(canAdjustStudentFee(empty), false, `${role}: adjustment`);
    assert.equal(canManagePaymentStatuses(empty), false, `${role}: payment statuses`);
    assert.equal(canForceReminder(empty), false, `${role}: reminders`);
  }
});

test("F6: une permission live accorde la capacité indépendamment du libellé de rôle JWT", () => {
  assert.equal(canManageFeeGrids(principal("Ancien rôle JWT", ["Frais & tarifs:CREATE"])), true);
  assert.equal(canManageFeeGrids(principal("Ancien rôle JWT", ["Frais & tarifs:UPDATE"])), true);
  assert.equal(canManagePaymentMethods(principal("Ancien rôle JWT", ["Paramètres Établissement:UPDATE"])), true);
  assert.equal(canAdjustStudentFee(principal("Ancien rôle JWT", ["Paiements:UPDATE"])), true);
  assert.equal(canManagePaymentStatuses(principal("Ancien rôle JWT", ["Paiements:UPDATE"])), true);
  assert.equal(canForceReminder(principal("Ancien rôle JWT", ["Impayés:CREATE"])), true);
});

test("F6: permissions de lecture seules ne débloquent aucune mutation Finance", () => {
  const readOnly = principal("Admin School", [
    "Paiements:READ",
    "Frais & tarifs:READ",
    "Impayés:READ",
    "Paramètres Établissement:READ",
  ]);
  assert.equal(canManageFeeGrids(readOnly), false);
  assert.equal(canManagePaymentMethods(readOnly), false);
  assert.equal(canAdjustStudentFee(readOnly), false);
  assert.equal(canManagePaymentStatuses(readOnly), false);
  assert.equal(canForceReminder(readOnly), false);
});
