"use strict";

/**
 * AUDIT RBAC Administration — tests ROUGES volontaires.
 *
 * Ils affirment le comportement métier attendu :
 * SUPER_ADMIN paramètre Création / Lecture / Modification / Suppression
 * d'un rôle métier dans le chemin pays → établissement → rôle → module.
 *
 * Sur develop actuel ces tests DOIVENT échouer : ils sont la preuve de l'écart.
 * Ne pas les verdir en relâchant les assertions. Aucun correctif dans cette PR.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  SUPER_ADMIN,
  GLOBAL_STUDENTS_GRANT,
  createAuditRepo,
  seedGlobalStudentsGrants,
  moduleFlags,
  uiDraftFromConfigured,
  loadSchoolPath,
  patchConfiguredPermissions,
} = require("./rbacAdminAudit.fixtures");

function failWithGaps(id, gaps) {
  assert.equal(
    gaps.length,
    0,
    `${id} ÉCART MÉTIER (${gaps.length}) — ${gaps.join(" | ")}`,
  );
}

test("RED-01 SUPER_ADMIN exprime puis enregistre un droit modifiable sans partir d'une matrice vide", async () => {
  const { repo, rbac } = createAuditRepo();
  await seedGlobalStudentsGrants(rbac, ["PRINCIPAL"]);
  const { configured, effective, query } = await loadSchoolPath(repo, "PRINCIPAL");
  const seen = moduleFlags(configured, "students");
  const live = moduleFlags(effective, "students");
  const gaps = [];

  if (!live.canRead || !live.canUpdate || !live.canDelete) {
    gaps.push("précondition effective Directeur/Élèves R+U+D absente");
  }
  if (seen.canRead !== live.canRead || seen.canUpdate !== live.canUpdate || seen.canDelete !== live.canDelete) {
    gaps.push(
      `GET /rbac/permissions (scope école) n'hydrate pas les droits effectifs : configured=${JSON.stringify(seen)} effective=${JSON.stringify(live)}`,
    );
  }

  const draft = uiDraftFromConfigured(configured, "students");
  draft.canCreate = true;
  draft.canRead = true;
  const saved = await patchConfiguredPermissions(
    repo,
    {
      ...query,
      expectedUpdatedAt: configured.updatedAt ?? null,
      grants: [{ moduleKey: "students", ...draft }],
    },
    SUPER_ADMIN,
    {},
  );
  assert.ok(saved.updatedAt, "PATCH a bien une réponse (l'API d'écriture existe)");

  const after = await loadSchoolPath(repo, "PRINCIPAL");
  const afterLive = moduleFlags(after.effective, "students");
  if (afterLive.canCreate !== true) {
    gaps.push("CREATE n'est pas effectif après enregistrement");
  }
  if (afterLive.canUpdate !== true || afterLive.canDelete !== true) {
    gaps.push(
      `l'enregistrement depuis le draft UI (hydraté scope école) écrase UPDATE/DELETE effectifs : ${JSON.stringify(afterLive)}`,
    );
  }

  failWithGaps("RED-01", gaps);
});

test("RED-02 SUPER_ADMIN modifie Lecture : UI → API → persistance → relecture effective", async () => {
  const { repo, rbac } = createAuditRepo();
  await seedGlobalStudentsGrants(rbac, ["SECRETARY"]);
  const { configured, effective, query } = await loadSchoolPath(repo, "SECRETARY");
  const seen = moduleFlags(configured, "students");
  const live = moduleFlags(effective, "students");
  const gaps = [];
  const blockingStep = [];

  if (seen.canRead !== true) {
    blockingStep.push(
      "GET configured (PermissionsPage.getConfigured) : Lecture invisible alors que le moteur effectif la résout depuis le grant global",
    );
  }
  if (live.canRead !== true) {
    blockingStep.push("résolution effective : Lecture absente (précondition)");
  }

  const draft = uiDraftFromConfigured(configured, "students");
  draft.canRead = true;
  await patchConfiguredPermissions(
    repo,
    {
      ...query,
      expectedUpdatedAt: configured.updatedAt ?? null,
      grants: [{ moduleKey: "students", ...draft }],
    },
    SUPER_ADMIN,
    {},
  );

  const reread = await loadSchoolPath(repo, "SECRETARY");
  const persisted = moduleFlags(reread.configured, "students");
  const rereadLive = moduleFlags(reread.effective, "students");

  if (persisted.canRead !== true) {
    blockingStep.push("PostgreSQL / upsertGrant : Lecture non persistée au scope école");
  }
  if (rereadLive.canUpdate !== live.canUpdate || rereadLive.canDelete !== live.canDelete) {
    blockingStep.push(
      `résolution RBAC après PATCH UI : first-match school remplace le grant global (U/D perdus) live=${JSON.stringify(rereadLive)}`,
    );
  }

  if (blockingStep.length) {
    gaps.push(`étape bloquante : ${blockingStep.join(" → ")}`);
  }
  failWithGaps("RED-02", gaps);
});

test("RED-03 SUPER_ADMIN : diagnostic Création / Lecture / Modification / Suppression", async () => {
  const { repo, rbac } = createAuditRepo();
  await seedGlobalStudentsGrants(rbac, ["TEACHER"]);
  const { configured, effective } = await loadSchoolPath(repo, "TEACHER");
  const seen = moduleFlags(configured, "students");
  const live = moduleFlags(effective, "students");
  const gaps = [];

  const actions = [
    { key: "canCreate", label: "Création" },
    { key: "canRead", label: "Lecture" },
    { key: "canUpdate", label: "Modification" },
    { key: "canDelete", label: "Suppression" },
  ];

  for (const action of actions) {
    if (seen[action.key] !== live[action.key]) {
      gaps.push(
        `${action.label} : UI/GET configured=${seen[action.key]} ≠ effective=${live[action.key]} (hydratation scope école vide)`,
      );
    }
  }

  const draft = uiDraftFromConfigured(configured, "students");
  const payload = {
    moduleKey: "students",
    canCreate: !draft.canCreate,
    canRead: true,
    canUpdate: draft.canUpdate,
    canDelete: draft.canDelete,
  };
  if (payload.canCreate === draft.canCreate && payload.canUpdate === live.canUpdate) {
    gaps.push("le draft UI ne porte pas les flags effectifs : payload C/U/D incorrects par construction");
  }
  if (payload.canUpdate !== live.canUpdate || payload.canDelete !== live.canDelete) {
    gaps.push(
      `payload PATCH UI pour Enseignant/Élèves = ${JSON.stringify(payload)} alors que l'effectif est ${JSON.stringify(live)}`,
    );
  }

  failWithGaps("RED-03", gaps);
});

test("RED-04 SUPER_ADMIN recharge après modification : les droits non touchés restent", async () => {
  const { repo, rbac } = createAuditRepo();
  await seedGlobalStudentsGrants(rbac, ["ACCOUNTANT"]);
  const { configured, query } = await loadSchoolPath(repo, "ACCOUNTANT");
  const draft = uiDraftFromConfigured(configured, "students");
  draft.canRead = true;

  await patchConfiguredPermissions(
    repo,
    {
      ...query,
      expectedUpdatedAt: configured.updatedAt ?? null,
      grants: [{ moduleKey: "students", ...draft }],
    },
    SUPER_ADMIN,
    {},
  );

  const reload = await loadSchoolPath(repo, "ACCOUNTANT");
  const configuredReload = moduleFlags(reload.configured, "students");
  const effectiveReload = moduleFlags(reload.effective, "students");
  const gaps = [];

  if (configuredReload.canRead !== true) {
    gaps.push("relecture configured : Lecture persistée absente");
  }
  if (effectiveReload.canUpdate !== true || effectiveReload.canDelete !== true) {
    gaps.push(
      `relecture effective : UPDATE/DELETE hérités ont disparu après un PATCH Lecture-only UI ${JSON.stringify(effectiveReload)}`,
    );
  }
  if (
    configuredReload.canUpdate !== GLOBAL_STUDENTS_GRANT.canUpdate ||
    configuredReload.canDelete !== GLOBAL_STUDENTS_GRANT.canDelete
  ) {
    gaps.push(
      `relecture configured école : la matrice affichée n'est plus R+U+D (${JSON.stringify(configuredReload)})`,
    );
  }

  failWithGaps("RED-04", gaps);
});

test("RED-01b Enregistrer sans changement depuis le chemin Superadmin n'écrit pas un DENY école", async () => {
  const { repo, rbac } = createAuditRepo();
  await seedGlobalStudentsGrants(rbac, ["PREFET_ETUDES"]);
  const { configured, query } = await loadSchoolPath(repo, "PREFET_ETUDES");
  const draft = uiDraftFromConfigured(configured, "students");

  await patchConfiguredPermissions(
    repo,
    {
      ...query,
      expectedUpdatedAt: configured.updatedAt ?? null,
      grants: [{ moduleKey: "students", canCreate: draft.canCreate, canRead: draft.canRead, canUpdate: draft.canUpdate, canDelete: draft.canDelete }],
    },
    SUPER_ADMIN,
    {},
  );

  const after = await loadSchoolPath(repo, "PREFET_ETUDES");
  const live = moduleFlags(after.effective, "students");
  const gaps = [];
  if (live.canRead !== true || live.canUpdate !== true || live.canDelete !== true) {
    gaps.push(
      `Enregistrer sans toggle (draft vide) persiste un DENY école et annule le grant global : ${JSON.stringify(live)}`,
    );
  }
  failWithGaps("RED-01b", gaps);
});
