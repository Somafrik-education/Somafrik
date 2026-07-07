/**
 * E2E 0003 : Parcours création d'un compte utilisateur depuis un contact
 *
 * Vérifie :
 * - Contact → compte utilisateur rattaché (contactId / userId)
 * - Connexion avec mot de passe provisoire
 * - Menus / tableau de bord selon le rôle
 * - Un contact = un seul compte actif
 * - Compte désactivé = connexion refusée
 *
 * Prérequis : backend Docker + bootstrap E2E
 *   npm run bootstrap:e2e-superadmin && docker compose restart backend
 *   npm run verify:e2e-0003
 */
const assert = require("assert");
const {
  login,
  loginFull,
  loginExpect,
  getState,
  putStatePatch,
  newId,
  normalize,
  pushResult,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
  resolveSchoolContext,
} = require("./e2e-api-helpers");
const { prepareContactForSave } = require("./e2e-contacts-rules");
const {
  saveContactWithOptionalUserAccount,
  promoteContactToUser,
  countActiveUsersForContact,
  getDefaultAppPath,
  roleHasPermission,
} = require("./e2e-user-account-rules");

async function main() {
  const results = [];
  const stamp = Date.now();
  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const { schoolCode, schoolAdminIdentifier, adminToken } = await resolveSchoolContext(superToken);

  pushResult(results, "1. Admin établissement connecté", "200", schoolAdminIdentifier, true);

  let state = await getState(adminToken);
  const creator = (state.users ?? []).find(
    (user) => normalize(user.identifier) === normalize(schoolAdminIdentifier),
  );

  // ── 2) Contact enseignant → compte utilisateur ─────────────────────────────
  const teacherContactDraft = {
    id: newId("CONTACT"),
    lastName: "Mukendi",
    firstName: `ProfE2E${stamp}`,
    contactType: "Enseignant",
    schoolCode,
    phone: `+243 831 ${String(stamp).slice(-6)}`,
    email: `prof-e2e-${stamp}@somafrik.app`,
    hasAccess: "Oui",
    role: "Enseignant",
    status: "Actif",
  };

  const teacherFlow = saveContactWithOptionalUserAccount(teacherContactDraft, state, schoolCode, creator);
  assert.ok(teacherFlow.ok, teacherFlow.error);
  assert.ok(teacherFlow.created, "Compte enseignant doit être nouvellement créé");
  assert.ok(teacherFlow.temporaryPassword, "Mot de passe provisoire attendu");

  state = await putStatePatch(adminToken, teacherFlow.patch);
  const teacherUser = (state.users ?? []).find((user) => user.id === teacherFlow.user.id);
  const teacherContact = (state.contacts ?? []).find((row) => row.id === teacherContactDraft.id);

  pushResult(
    results,
    "2. Compte enseignant créé depuis contact",
    "lié",
    teacherContact?.userId === teacherUser?.id ? "lié" : "—",
    Boolean(
      teacherUser &&
        teacherContact &&
        normalize(teacherUser.contactId) === normalize(teacherContact.id) &&
        teacherContact.userId === teacherUser.id,
    ),
  );

  // ── 3) Connexion enseignant avec mot de passe provisoire ───────────────────
  const teacherLogin = await loginFull(
    teacherUser.identifier,
    teacherFlow.temporaryPassword,
    schoolCode,
  );
  pushResult(
    results,
    "3. Connexion enseignant (mot de passe provisoire)",
    "200",
    String(teacherLogin.user?.role ?? ""),
    teacherLogin.user?.role === "Enseignant",
  );

  pushResult(
    results,
    "4. Menu enseignant (pas Utilisateurs admin)",
    "sans Utilisateurs",
    (teacherLogin.menus ?? []).includes("Utilisateurs") ? "avec Utilisateurs" : "sans Utilisateurs",
    !(teacherLogin.menus ?? []).includes("Utilisateurs") && (teacherLogin.menus ?? []).includes("Classes"),
  );

  pushResult(
    results,
    "5. Redirection tableau de bord enseignant",
    "/etablissement",
    getDefaultAppPath(teacherLogin.user?.role),
    getDefaultAppPath(teacherLogin.user?.role) === "/etablissement",
  );

  pushResult(
    results,
    "6. Permissions enseignant (pas Établissements)",
    "refus",
    roleHasPermission(teacherLogin.permissions, "Établissements", "READ") ? "autorisé" : "refus",
    !roleHasPermission(teacherLogin.permissions, "Établissements", "READ"),
  );

  // ── 7) Contact parent → compte utilisateur ─────────────────────────────────
  const parentContactDraft = {
    id: newId("CONTACT"),
    lastName: "Kabeya",
    firstName: `ParentE2E${stamp}`,
    contactType: "Parent",
    schoolCode,
    phone: `+243 832 ${String(stamp).slice(-6)}`,
    email: `parent-e2e-${stamp}@somafrik.app`,
    hasAccess: "Oui",
    role: "Parent",
    status: "Actif",
  };

  const parentFlow = saveContactWithOptionalUserAccount(parentContactDraft, state, schoolCode, creator);
  assert.ok(parentFlow.ok, parentFlow.error);
  state = await putStatePatch(adminToken, parentFlow.patch);
  const parentUser = (state.users ?? []).find((user) => user.id === parentFlow.user.id);

  const parentLogin = await loginFull(parentUser.identifier, parentFlow.temporaryPassword, schoolCode);
  pushResult(
    results,
    "7. Connexion parent depuis contact",
    "Parent",
    parentLogin.user?.role ?? "—",
    parentLogin.user?.role === "Parent",
  );

  pushResult(
    results,
    "8. Menu parent (Messages, pas Utilisateurs)",
    "Messages sans Utilisateurs",
    JSON.stringify({
      messages: (parentLogin.menus ?? []).includes("Messages"),
      users: (parentLogin.menus ?? []).includes("Utilisateurs"),
    }),
    (parentLogin.menus ?? []).includes("Messages") && !(parentLogin.menus ?? []).includes("Utilisateurs"),
  );

  // ── 9) Contact comptable ───────────────────────────────────────────────────
  const accountantContactDraft = {
    id: newId("CONTACT"),
    lastName: "Ilunga",
    firstName: `ComptaE2E${stamp}`,
    contactType: "Comptable",
    schoolCode,
    phone: `+243 833 ${String(stamp).slice(-6)}`,
    email: `cpt-e2e-${stamp}@somafrik.app`,
    hasAccess: "Oui",
    role: "Comptable",
    status: "Actif",
  };

  const accountantFlow = saveContactWithOptionalUserAccount(accountantContactDraft, state, schoolCode, creator);
  assert.ok(accountantFlow.ok, accountantFlow.error);
  state = await putStatePatch(adminToken, accountantFlow.patch);

  const accountantLogin = await loginFull(
    accountantFlow.user.identifier,
    accountantFlow.temporaryPassword,
    schoolCode,
  );
  pushResult(
    results,
    "9. Connexion comptable depuis contact",
    "Comptable",
    accountantLogin.user?.role ?? "—",
    accountantLogin.user?.role === "Comptable",
  );

  pushResult(
    results,
    "10. Menu comptable orienté finances",
    "Paiements",
    (accountantLogin.menus ?? []).includes("Paiements") ? "Paiements" : "—",
    (accountantLogin.menus ?? []).includes("Paiements"),
  );

  // ── 11) Un contact = un seul compte actif (mise à jour rôle, pas doublon) ──
  const beforeCount = countActiveUsersForContact(state.users, teacherContact.id);
  const roleUpdate = promoteContactToUser(
    { ...teacherContact, role: "Enseignant", hasAccess: "Oui" },
    state,
    creator,
  );
  state = await putStatePatch(adminToken, {
    users: roleUpdate.users,
    contacts: (state.contacts ?? []).map((row) =>
      row.id === teacherContact.id ? roleUpdate.contact : row,
    ),
  });
  const afterCount = countActiveUsersForContact(state.users, teacherContact.id);
  pushResult(
    results,
    "11. Un contact = un seul compte actif",
    "1",
    String(afterCount),
    beforeCount === 1 && afterCount === 1,
  );

  // ── 12) Doublon identifiant (même téléphone qu'un compte actif) ───────────
  const duplicateContactDraft = prepareContactForSave(
    {
      id: newId("CONTACT"),
      lastName: "Doublon",
      firstName: "Login",
      contactType: "Parent",
      schoolCode,
      phone: parentUser.phone,
      email: `doublon-${stamp}@somafrik.app`,
      hasAccess: "Oui",
      role: "Parent",
    },
    state,
  );
  let duplicateBlocked = false;
  try {
    promoteContactToUser(duplicateContactDraft, state, creator);
  } catch (error) {
    duplicateBlocked = /déjà utilisé/i.test(String(error.message ?? ""));
  }
  pushResult(
    results,
    "12. Doublon identifiant/téléphone bloqué",
    "erreur",
    duplicateBlocked ? "erreur" : "créé",
    duplicateBlocked,
  );

  // ── 13) Compte désactivé → connexion refusée ─────────────────────────────
  const disabledUsers = (state.users ?? []).map((user) =>
    user.id === accountantFlow.user.id ? { ...user, status: "Inactif" } : user,
  );
  state = await putStatePatch(adminToken, { users: disabledUsers });
  let disabledBlocked = false;
  try {
    await loginExpect(accountantFlow.user.identifier, accountantFlow.temporaryPassword, schoolCode, 403);
    disabledBlocked = true;
  } catch {
    disabledBlocked = false;
  }
  pushResult(
    results,
    "13. Compte inactif : connexion refusée",
    "403",
    disabledBlocked ? "403" : "200",
    disabledBlocked,
  );

  // Réactiver pour ne pas polluer d'autres tests
  await putStatePatch(adminToken, {
    users: (state.users ?? []).map((user) =>
      user.id === accountantFlow.user.id ? { ...user, status: "Actif" } : user,
    ),
  });

  console.log("\n=== E2E 0003 : Compte utilisateur depuis contact ===");
  console.log(`Établissement : ${schoolCode}`);
  console.log(`Enseignant    : ${teacherUser?.identifier}`);
  console.log(`Parent        : ${parentUser?.identifier}`);
  console.log(`Comptable     : ${accountantFlow.user.identifier}\n`);
  console.table(results);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0003 : OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
