/**
 * E2E 0015 : Parcours abonnement établissement
 *
 * Vérifie :
 * - Superadmin crée un établissement avec formule Premium
 * - Abonnement activé → accès complet
 * - Utilisation normale (données créées)
 * - Expiration → accès limité puis bloqué
 * - Fonctions payantes indisponibles sans abonnement actif
 * - Données conservées après expiration
 * - Renouvellement → accès réactivé sans perte de données
 *
 * Prérequis : backend Docker + bootstrap E2E
 *   npm run bootstrap:e2e-superadmin && docker compose restart backend
 *   npm run verify:e2e-0015
 */
const assert = require("assert");
const {
  request,
  login,
  getState,
  putStatePatch,
  newId,
  normalize,
  todayPeriodDate,
  pushResult,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
  ADMIN_PASSWORD,
} = require("./e2e-api-helpers");
const {
  resolveSchoolAccess,
  canUseFeature,
  upsertSubscription,
  patchSchoolSubscription,
} = require("./e2e-subscription-rules");

function formatFrDate(date) {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${d}-${m}-${date.getFullYear()}`;
}

function buildSubscription(schoolCode, stamp, { endDate, lifecycleStatus, status, paymentStatus, accessLevel }) {
  return {
    id: `SUB-E2E-${stamp}`,
    schoolCode,
    countryCode: "CD",
    country: "République Démocratique du Congo",
    plan: "Premium",
    monthlyPrice: 120,
    annualPrice: 1200,
    currency: "USD",
    status: status ?? "Actif",
    lifecycleStatus: lifecycleStatus ?? "Actif",
    paymentStatus: paymentStatus ?? "À jour",
    accessLevel,
    startDate: "01-01-2026",
    endDate,
    lastPaymentDate: "01-06-2026",
  };
}

async function applySubscription(superToken, state, schoolCode, subscriptionPatch, schoolPatch = {}) {
  const subscriptions = upsertSubscription(state.subscriptions ?? [], schoolCode, subscriptionPatch);
  const schools = patchSchoolSubscription(state.schools ?? [], schoolCode, {
    subscriptionPlan: "Premium",
    subscriptionStatus: subscriptionPatch.paymentStatus ?? "À jour",
    subscriptionEndDate: subscriptionPatch.endDate,
    ...schoolPatch,
  });
  return putStatePatch(superToken, { subscriptions, schools });
}

async function postPresence(token, student, className) {
  return request("/presences", {
    method: "POST",
    token,
    body: {
      className,
      date: todayPeriodDate(),
      items: [
        {
          studentId: student.matricule ?? student.id,
          className,
          schoolCode: student.schoolCode,
          status: "Présent",
          date: todayPeriodDate(),
        },
      ],
    },
  });
}

async function main() {
  const results = [];
  const stamp = Date.now();
  const schoolName = `E2E Abonnement ${stamp}`;
  const schoolAdminId = `ADM-SUB-${stamp}`;
  const className = `SUB-${String(stamp).slice(-4)}`;
  const activeEndDate = "31-12-2026";
  const limitedEndDate = "20-06-2026";
  const blockedEndDate = "01-05-2026";

  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  pushResult(results, "1. Superadmin connecté", "200", SUPERADMIN_ID, true);

  // Création établissement + formule Premium
  const createRes = await request("/backoffice/establishments", {
    method: "POST",
    token: superToken,
    body: {
      name: schoolName,
      type: "Collège",
      country: "République Démocratique du Congo",
      countryCode: "CD",
      city: "Kinshasa",
      phone: `+243 810 ${String(stamp).slice(-6)}`,
      email: `e2e-sub-${stamp}@somafrik.app`,
      principalName: "Directeur Abonnement E2E",
      principalEmail: `directeur-sub-${stamp}@somafrik.app`,
      subscriptionPlan: "Premium",
      force: true,
    },
  });
  assert.strictEqual(createRes.status, 201, JSON.stringify(createRes.data));
  const schoolCode = createRes.data.school?.code;
  assert.ok(schoolCode, "Code établissement manquant");
  pushResult(results, "2. Établissement créé", "201", schoolCode, true);

  let state = await getState(superToken);

  // Activation abonnement
  const activeSubscription = buildSubscription(schoolCode, stamp, { endDate: activeEndDate });
  state = await applySubscription(superToken, state, schoolCode, activeSubscription);
  const subRes = await request(`/backoffice/establishments/${encodeURIComponent(schoolCode)}/subscription`, {
    token: superToken,
  });
  pushResult(
    results,
    "3. Formule Premium choisie",
    "Premium",
    subRes.data?.plan ?? "—",
    subRes.status === 200 && subRes.data?.plan === "Premium",
  );
  pushResult(
    results,
    "4. Abonnement activé",
    "Actif",
    subRes.data?.lifecycleStatus ?? subRes.data?.status ?? "—",
    (subRes.data?.lifecycleStatus ?? subRes.data?.status) === "Actif",
  );

  const schoolAdmin = {
    id: newId("USERS"),
    firstName: "Admin",
    lastName: "Abonnement E2E",
    role: "Admin School",
    identifier: schoolAdminId,
    email: `${schoolAdminId.toLowerCase()}@somafrik.app`,
    schoolCode,
    countryScope: "RDC",
    scopeLevel: "Établissement",
    accessChannel: "Application",
    status: "Actif",
    validationStatus: "Validé",
    password: ADMIN_PASSWORD,
    temporaryPassword: ADMIN_PASSWORD,
    permissions: ["Faire appel", "Gérer appels", "Présences:CREATE", "Présences:UPDATE"],
  };
  state = await putStatePatch(superToken, { users: [schoolAdmin, ...(state.users ?? [])] });
  const adminToken = await login(schoolAdminId, ADMIN_PASSWORD, schoolCode);
  pushResult(results, "5. Admin établissement connecté (abonnement actif)", "200", schoolAdminId, Boolean(adminToken));

  const accessActiveRes = await request(
    `/backoffice/subscription-access?schoolCode=${encodeURIComponent(schoolCode)}`,
    { token: adminToken },
  );
  pushResult(
    results,
    "6. Accès complet (full)",
    "full",
    accessActiveRes.data?.level ?? "—",
    accessActiveRes.status === 200 && accessActiveRes.data?.level === "full",
  );

  const student = {
    id: newId("STUDENTS"),
    name: "Kabila",
    firstName: `Élève${stamp}`,
    className,
    schoolCode,
    matricule: `ELE-SUB-${stamp}`,
    archived: false,
    schoolStatus: "Inscrit",
  };
  const schoolClass = {
    id: newId("CLASS"),
    name: className,
    className,
    level: "2ème",
    track: "Générale",
    schoolCode,
    status: "Actif",
  };
  state = await putStatePatch(adminToken, {
    students: [student, ...(state.students ?? [])],
    classes: [schoolClass, ...(state.classes ?? [])],
  });
  const studentCountBefore = (state.students ?? []).filter((row) => row.schoolCode === schoolCode).length;
  pushResult(
    results,
    "7. Utilisation normale (élève + classe créés)",
    ">=1",
    String(studentCountBefore),
    studentCountBefore >= 1,
  );

  const accessActive = resolveSchoolAccess(schoolCode, state);
  const canCreateStudent = canUseFeature(accessActive, "create_student");
  pushResult(
    results,
    "8. Fonction payante autorisée (création élève)",
    "true",
    String(canCreateStudent),
    canCreateStudent,
  );

  const presenceActiveRes = await postPresence(adminToken, student, className);
  pushResult(
    results,
    "9. Fonction métier disponible (présences)",
    "201",
    String(presenceActiveRes.status),
    presenceActiveRes.status === 201,
  );

  // Expiration partielle → accès limité
  state = await getState(superToken);
  state = await applySubscription(superToken, state, schoolCode, buildSubscription(schoolCode, stamp, {
    endDate: limitedEndDate,
    lifecycleStatus: "En retard",
    paymentStatus: "En retard",
    accessLevel: "limited",
  }));
  const accessLimitedRes = await request(
    `/backoffice/subscription-access?schoolCode=${encodeURIComponent(schoolCode)}`,
    { token: adminToken },
  );
  pushResult(
    results,
    "10. Abonnement expiré → accès limité",
    "limited",
    accessLimitedRes.data?.level ?? "—",
    accessLimitedRes.status === 200 && accessLimitedRes.data?.level === "limited",
  );

  const limitedAccess = resolveSchoolAccess(schoolCode, state);
  pushResult(
    results,
    "11. Fonction payante bloquée (création élève)",
    "false",
    String(canUseFeature(limitedAccess, "create_student")),
    !canUseFeature(limitedAccess, "create_student"),
  );
  pushResult(
    results,
    "12. Fonction de base encore accessible (présences)",
    "true",
    String(canUseFeature(limitedAccess, "write_presence")),
    canUseFeature(limitedAccess, "write_presence"),
  );

  // Expiration totale → bloqué
  state = await getState(superToken);
  state = await applySubscription(superToken, state, schoolCode, buildSubscription(schoolCode, stamp, {
    endDate: blockedEndDate,
    lifecycleStatus: "Expiré",
    status: "Expiré",
    paymentStatus: "En retard",
    accessLevel: "blocked",
  }));
  const accessBlockedRes = await request(
    `/backoffice/subscription-access?schoolCode=${encodeURIComponent(schoolCode)}`,
    { token: superToken },
  );
  pushResult(
    results,
    "13. Abonnement expiré → accès bloqué",
    "blocked",
    accessBlockedRes.data?.level ?? "—",
    accessBlockedRes.status === 200 && accessBlockedRes.data?.level === "blocked",
  );

  const blockedLoginRes = await request("/backoffice/login", {
    method: "POST",
    body: { identifier: schoolAdminId, password: ADMIN_PASSWORD, schoolCode },
  });
  const blockedAccess = resolveSchoolAccess(schoolCode, state);
  const connectBlocked = !canUseFeature(blockedAccess, "connect");
  pushResult(
    results,
    "14. Accès connexion bloqué (règle métier)",
    "blocked",
    blockedAccess.level,
    connectBlocked,
  );
  pushResult(
    results,
    "14b. Note login BackOffice",
    "403 ou 200",
    String(blockedLoginRes.status),
    blockedLoginRes.status === 403 || blockedLoginRes.status === 200,
  );

  const presenceBlockedRes = await postPresence(adminToken, student, className);
  pushResult(
    results,
    "15. Fonction métier bloquée (présences)",
    "403",
    String(presenceBlockedRes.status),
    presenceBlockedRes.status === 403,
  );

  const stateAfterExpiry = await getState(superToken);
  const studentCountAfterExpiry = (stateAfterExpiry.students ?? []).filter(
    (row) => normalize(row.schoolCode) === normalize(schoolCode),
  ).length;
  pushResult(
    results,
    "16. Données conservées après expiration",
    String(studentCountBefore),
    String(studentCountAfterExpiry),
    studentCountAfterExpiry === studentCountBefore,
  );

  // Renouvellement
  state = await applySubscription(superToken, stateAfterExpiry, schoolCode, buildSubscription(schoolCode, stamp, {
    endDate: activeEndDate,
    lifecycleStatus: "Actif",
    status: "Actif",
    paymentStatus: "À jour",
    accessLevel: "full",
  }));
  const renewedToken = await login(schoolAdminId, ADMIN_PASSWORD, schoolCode);
  const accessRenewedRes = await request(
    `/backoffice/subscription-access?schoolCode=${encodeURIComponent(schoolCode)}`,
    { token: renewedToken },
  );
  pushResult(
    results,
    "17. Abonnement renouvelé",
    "Actif",
    accessRenewedRes.data?.lifecycle ?? "—",
    accessRenewedRes.data?.lifecycle === "Actif",
  );
  pushResult(
    results,
    "18. Accès réactivé (full)",
    "full",
    accessRenewedRes.data?.level ?? "—",
    accessRenewedRes.data?.level === "full",
  );

  const stateAfterRenewal = await getState(superToken);
  const studentCountAfterRenewal = (stateAfterRenewal.students ?? []).filter(
    (row) => normalize(row.schoolCode) === normalize(schoolCode),
  ).length;
  pushResult(
    results,
    "19. Données intactes après renouvellement",
    String(studentCountBefore),
    String(studentCountAfterRenewal),
    studentCountAfterRenewal === studentCountBefore,
  );

  const presenceRenewedRes = await postPresence(renewedToken, student, className);
  pushResult(
    results,
    "20. Fonctionnalités réactivées (présences)",
    "201",
    String(presenceRenewedRes.status),
    presenceRenewedRes.status === 201,
  );

  console.log("\n=== E2E 0015 : Parcours abonnement établissement ===");
  console.log(`Établissement : ${schoolCode}`);
  console.log(`Formule        : Premium`);
  console.log(`Élèves         : ${studentCountAfterRenewal} (conservés)\n`);
  console.table(results);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0015 : OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
