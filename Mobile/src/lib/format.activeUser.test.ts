/**
 * Règle unique isActiveUserAccount — vérité PostgreSQL/API.
 *   npx tsx Mobile/src/lib/format.activeUser.test.ts
 */
import assert from "node:assert/strict";
import {
  ACTIVE_USERS_KPI_LABEL,
  countActiveUserAccounts,
  isActiveUserAccount,
  type UserAccountActivityFields,
} from "./format";

const CASES: Array<{ name: string; user: UserAccountActivityFields; active: boolean }> = [
  { name: "Actif FR", user: { status: "Actif" }, active: true },
  { name: "active DB", user: { status: "active" }, active: true },
  { name: "statut vide = actif (COALESCE PG)", user: { status: "" }, active: true },
  { name: "statut absent = actif", user: {}, active: true },
  { name: "Archivé FR", user: { status: "Archivé" }, active: false },
  { name: "archived DB", user: { status: "archived" }, active: false },
  { name: "archive", user: { status: "archive" }, active: false },
  { name: "flag archived", user: { status: "Actif", archived: true }, active: false },
  { name: "archivedAt", user: { status: "Actif", archivedAt: "2026-01-01" }, active: false },
  { name: "archived_at", user: { status: "Actif", archived_at: "2026-01-01" }, active: false },
  { name: "Suspendu FR", user: { status: "Suspendu" }, active: false },
  { name: "suspended DB", user: { status: "suspended" }, active: false },
  { name: "Désactivé FR", user: { status: "Désactivé" }, active: false },
  { name: "disabled", user: { status: "disabled" }, active: false },
  { name: "inactive DB", user: { status: "inactive" }, active: false },
  { name: "Inactif FR", user: { status: "Inactif" }, active: false },
  { name: "flag disabled", user: { status: "Actif", disabled: true }, active: false },
  { name: "Supprimé FR", user: { status: "Supprimé" }, active: false },
  { name: "deleted DB", user: { status: "deleted" }, active: false },
  { name: "deletedAt", user: { status: "Actif", deletedAt: "2026-01-01" }, active: false },
];

function run() {
  assert.equal(ACTIVE_USERS_KPI_LABEL, "Utilisateurs actifs");

  for (const testCase of CASES) {
    assert.equal(
      isActiveUserAccount(testCase.user),
      testCase.active,
      `${testCase.name} → ${testCase.active ? "actif" : "inactif"}`,
    );
  }

  assert.equal(isActiveUserAccount({ status: "Archivé" }), false, "archivé jamais compté actif");

  const seventeenActive = Array.from({ length: 17 }, (_, index) => ({
    status: "Actif",
    id: `u-${index}`,
  }));
  assert.equal(countActiveUserAccounts(seventeenActive), 17);

  const oneArchived = seventeenActive.map((user, index) =>
    index === 0 ? { ...user, status: "Archivé" } : user,
  );
  assert.equal(countActiveUserAccounts(oneArchived), 16);

  const oneSuspended = seventeenActive.map((user, index) =>
    index === 0 ? { ...user, status: "Suspendu" } : user,
  );
  assert.equal(countActiveUserAccounts(oneSuspended), 16);

  const oneDisabled = seventeenActive.map((user, index) =>
    index === 0 ? { ...user, status: "Désactivé" } : user,
  );
  assert.equal(countActiveUserAccounts(oneDisabled), 16);

  const oneInactive = seventeenActive.map((user, index) =>
    index === 0 ? { ...user, status: "Inactif" } : user,
  );
  assert.equal(countActiveUserAccounts(oneInactive), 16);

  const mixed = seventeenActive.map((user, index) => {
    if (index === 0) return { ...user, status: "Archivé" };
    if (index === 1) return { ...user, status: "Suspendu" };
    return user;
  });
  assert.equal(countActiveUserAccounts(mixed), 15);

  console.log("OK: format.activeUser isActiveUserAccount / countActiveUserAccounts");
}

run();
