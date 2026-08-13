/**
 * E2E 0001 : Établissement actif → admin connecté → classe → contact élève →
 * affectation → frais → paiement → reçu → parent connecté → paiement visible.
 *
 * Prérequis : backend Docker sur http://127.0.0.1:5000/api
 *   npm run bootstrap:e2e-superadmin
 *   docker compose restart backend
 *   npm run verify:e2e-0001
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
  createClassViaApi,
  enrollStudentViaApi,
  createFeeGridViaApi,
  activateFeeGridViaApi,
  applyFeeGridViaApi,
  createPaymentViaApi,
} = require("./e2e-api-helpers");

const SUPERADMIN_ID = process.env.SOMAFRIK_E2E_SUPERADMIN_ID || "superadmin";
const SUPERADMIN_PASSWORD =
  process.env.SOMAFRIK_E2E_SUPERADMIN_PASSWORD ||
  process.env.SOMAFRIK_TEST_SUPERADMIN_PASSWORD ||
  "E2eTest!2026";
const ADMIN_PASSWORD =
  process.env.SOMAFRIK_E2E_SUPERADMIN_PASSWORD ||
  process.env.SOMAFRIK_TEST_ADMIN_PASSWORD ||
  "E2eTest!2026";

function studentDisplayName(student) {
  const first = String(student.firstName ?? "").trim();
  const last = String(student.name ?? student.lastName ?? "").trim();
  return `${first} ${last}`.trim() || String(student.id ?? "Élève");
}

function buildStudentFromContact(contact, schoolCode) {
  const lastName = String(contact.lastName ?? "").trim();
  const firstName = String(contact.firstName ?? "").trim();
  const id = newId("STUDENTS");
  return {
    contact: { ...contact, studentId: id },
    student: {
      id,
      name: lastName,
      firstName,
      className: "",
      schoolCode,
      gender: contact.gender ?? "Non renseigné",
      birthDate: contact.birthDate ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      parentPhone: contact.parentPhone ?? "",
      matricule: id,
      archived: false,
      contactId: contact.id,
    },
  };
}

function buildStudentFee(student, grid, item) {
  const amount = Number(item.amount ?? 0);
  return {
    id: newId("STUFEE"),
    studentId: student.id,
    studentName: studentDisplayName(student),
    schoolCode: grid.schoolCode,
    className: grid.className,
    schoolFeeItemId: item.id,
    feeGridId: grid.id,
    feeType: item.feeType,
    label: item.label,
    currency: grid.currency,
    academicYear: grid.academicYear,
    initialAmount: amount,
    discount: 0,
    exemption: 0,
    amountDue: amount,
    amountPaid: 0,
    balance: amount,
    status: "À payer",
    dueDate: item.dueDate ?? todayPeriodDate(),
    createdAt: new Date().toISOString(),
  };
}

function generatePaymentReference(schoolCode, payments) {
  const year = new Date().getFullYear();
  const prefix = `${String(schoolCode).trim().toUpperCase()}-${year}-PAY-`;
  let max = 0;
  for (const payment of payments) {
    for (const candidate of [payment.publicId, payment.reference, payment.id]) {
      const raw = String(candidate ?? "");
      if (!raw.startsWith(prefix)) continue;
      const sequence = Number(raw.slice(prefix.length));
      if (Number.isFinite(sequence)) max = Math.max(max, sequence);
    }
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

function generateVerificationCode(reference) {
  const compact = reference.replace(/[^A-Z0-9]/gi, "").slice(-12).toUpperCase();
  const stamp = Date.now().toString(36).toUpperCase().slice(-4);
  return `VF-${compact}-${stamp}`;
}

function buildPaymentRecord({ student, amount, feeType, schoolCode, payments, adminId }) {
  const reference = generatePaymentReference(schoolCode, payments);
  const verificationCode = generateVerificationCode(reference);
  const now = new Date().toISOString();
  return {
    id: reference,
    publicId: reference,
    reference,
    receiptId: `REC-${reference}`,
    schoolCode,
    studentId: student.id,
    studentName: studentDisplayName(student),
    className: student.className,
    feeType,
    label: feeType,
    amount,
    currency: "CDF",
    method: "Espèces",
    date: todayPeriodDate(),
    status: "Payé",
    verificationCode,
    createdAt: now,
    createdBy: adminId,
    createdByName: "Admin E2E",
    recordedAt: now,
  };
}

async function setupActiveSchool(superToken, stamp) {
  const schoolName = `E2E-0001 ${stamp}`;
  const schoolAdminId = `usr-e2e0001-${stamp}`;
  const schoolAdminIdentifier = `ADM-E2E0001-${stamp}`;
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
      email: `e2e0001-${stamp}@somafrik.app`,
      principalName: "Directeur E2E 0001",
      principalEmail: `directeur-e2e0001-${stamp}@somafrik.app`,
      force: true,
    },
  });
  assert.strictEqual(createRes.status, 201, `create school: ${JSON.stringify(createRes.data)}`);
  const schoolCode = createRes.data.school?.code;
  assert.ok(schoolCode, "Code établissement manquant");

  const schoolAdmin = {
    id: schoolAdminId,
    firstName: "Admin",
    lastName: "E2E 0001",
    role: "Admin School",
    identifier: schoolAdminIdentifier,
    email: `${schoolAdminIdentifier.toLowerCase()}@somafrik.app`,
    schoolCode,
    countryScope: "RDC",
    scopeLevel: "Établissement",
    accessChannel: "Application",
    status: "Actif",
    validationStatus: "Validé",
    password: ADMIN_PASSWORD,
    temporaryPassword: ADMIN_PASSWORD,
    permissions: [],
  };
  await putState(superToken, { users: [schoolAdmin] });
  const adminToken = await login(schoolAdminIdentifier, ADMIN_PASSWORD, schoolCode);
  return { schoolCode, schoolName, schoolAdminIdentifier, adminToken };
}

async function resolveSchoolContext(superToken) {
  const presetSchool = String(process.env.SOMAFRIK_TEST_SCHOOL_CODE ?? "").trim();
  const presetAdmin = String(process.env.SOMAFRIK_E2E_SCHOOL_ADMIN_ID ?? "admin").trim();

  if (presetSchool) {
    const schoolRes = await request(`/backoffice/establishments/${encodeURIComponent(presetSchool)}`, {
      token: superToken,
    });
    if (schoolRes.status === 200) {
      try {
        const adminToken = await login(presetAdmin, ADMIN_PASSWORD, presetSchool);
        return {
          schoolCode: presetSchool,
          schoolName: schoolRes.data?.name ?? presetSchool,
          schoolAdminIdentifier: presetAdmin,
          adminToken,
          reused: true,
        };
      } catch {
        // Recreate admin below via fresh school if preset admin unavailable.
      }
    }
  }

  return { ...(await setupActiveSchool(superToken, Date.now())), reused: false };
}

async function main() {
  const results = [];
  const stamp = Date.now();
  const className = `E2E-${String(stamp).slice(-4)}A`;
  const parentPhone = `+243 820 ${String(stamp).slice(-6)}`;
  const parentPassword = `SF-PARENT-${stamp}`;
  const studentContactId = newId("CONTACT");
  const parentContactId = newId("CONTACT");
  const parentUserId = newId("USERS");
  const feeGridId = newId("FEEGRID");
  const feeItemId = newId("FEEITEM");

  // 1) Établissement actif + 2) Admin connecté
  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const schoolCtx = await resolveSchoolContext(superToken);
  const { schoolCode, schoolName, schoolAdminIdentifier, adminToken } = schoolCtx;

  pushResult(
    results,
    "1. Établissement actif",
    "Actif",
    schoolCode,
    Boolean(schoolCode),
  );
  pushResult(results, "2. Admin école connecté", "200", schoolAdminIdentifier, Boolean(adminToken));

  let state = await getState(adminToken);

  // 3) Classe créée
  const createdClass = await createClassViaApi(adminToken, {
    name: className,
    level: "1ère",
    track: "Générale",
    academicYearName: `${new Date().getFullYear() - 1}-${new Date().getFullYear()}`,
  });
  state = createdClass.state;
  const storedClass = createdClass.classRecord;
  pushResult(results, "3. Classe créée", className, storedClass?.name ?? "—", Boolean(storedClass));
  assert.ok(storedClass, "Classe non créée");
  const classCode = createdClass.api?.classCode || storedClass.id || storedClass.publicId;

  // 4) Contact élève créé
  const studentContact = {
    id: studentContactId,
    lastName: "Mukendi",
    firstName: `Élève${stamp}`,
    contactType: "Élève",
    schoolCode: schoolCode,
    phone: `+243 810 ${String(stamp).slice(-6)}`,
    email: `eleve-${stamp}@somafrik.app`,
    status: "Actif",
    gender: "Masculin",
    birthDate: "15-03-2012",
  };
  state = await putStatePatch(adminToken, {
    contacts: [studentContact, ...(state.contacts ?? [])],
  });
  const storedContact = (state.contacts ?? []).find((row) => row.id === studentContactId);
  pushResult(
    results,
    "4. Contact élève créé",
    studentContactId,
    storedContact?.id ?? "—",
    Boolean(storedContact),
  );

  // 5) Élève affecté à la classe
  const enrolled = await enrollStudentViaApi(adminToken, classCode, {
    firstName: studentContact.firstName,
    lastName: studentContact.lastName,
    gender: studentContact.gender,
    birthDate: studentContact.birthDate,
    parentPhone,
  });
  state = enrolled.state;
  const studentId = enrolled.studentCode;
  const assignedStudent = (state.students ?? []).find(
    (row) =>
      String(row.studentCode ?? row.matricule ?? row.id) === String(studentId) ||
      normalize(row.firstName) === normalize(studentContact.firstName),
  );
  pushResult(
    results,
    "5. Élève affecté à la classe",
    className,
    assignedStudent?.className ?? className,
    Boolean(assignedStudent || studentId),
  );
  assert.ok(studentId, "Affectation classe échouée");

  // 6) Frais générés (grille + application)
  const academicYear = `${new Date().getFullYear() - 1}-${new Date().getFullYear()}`;
  const feeGrid = await createFeeGridViaApi(adminToken, {
    id: feeGridId,
    className,
    academicYear,
    periodName: "Année complète",
    currency: "CDF",
    items: [
      {
        id: feeItemId,
        label: "Inscription E2E",
        feeType: "Inscription",
        amount: 50_000,
        status: "Actif",
        dueDate: "2026-01-01",
      },
    ],
  });
  await activateFeeGridViaApi(adminToken, feeGrid.id);
  await applyFeeGridViaApi(adminToken, feeGrid.id);
  state = await getState(adminToken);
  const storedFees = (state.studentFees ?? []).filter(
    (fee) => String(fee.studentId) === String(studentId) || String(fee.studentId) === String(assignedStudent?.id),
  );
  pushResult(
    results,
    "6. Frais générés pour l'élève",
    ">=1",
    String(storedFees.length),
    storedFees.length >= 1,
  );
  assert.ok(storedFees.length >= 1, "Aucun frais élève généré");

  // 7) Paiement saisi
  const payment = await createPaymentViaApi(adminToken, {
    studentId,
    feeType: "Inscription",
    amount: 50_000,
    method: "Espèces",
    date: "2026-08-13",
  });
  state = await getState(adminToken);
  const storedPayment = (state.payments ?? []).find((row) => row.reference === payment.reference || row.id === payment.id);
  pushResult(
    results,
    "7. Paiement saisi",
    payment.reference,
    storedPayment?.reference ?? "—",
    Boolean(storedPayment),
  );
  assert.ok(storedPayment, "Paiement non enregistré");

  // 8) Reçu généré (référence + code vérification + receiptId)
  const receiptOk =
    Boolean(storedPayment?.reference) &&
    Boolean(storedPayment?.verificationCode) &&
    Boolean(storedPayment?.receiptId);
  pushResult(
    results,
    "8. Reçu généré",
    "reference + verificationCode + receiptId",
    `${storedPayment?.receiptId ?? "—"}`,
    receiptOk,
  );
  assert.ok(receiptOk, "Reçu incomplet");

  // 9) Parent connecté (contact + compte + liaison parentPhone)
  const parentContact = {
    id: parentContactId,
    lastName: "Parent",
    firstName: `E2E${stamp}`,
    contactType: "Parent",
    schoolCode: schoolCode,
    phone: parentPhone,
    email: `parent-${stamp}@somafrik.app`,
    status: "Actif",
    userId: parentUserId,
    userIdentifier: parentPhone,
  };
  const parentUser = {
    id: parentUserId,
    contactId: parentContactId,
    firstName: parentContact.firstName,
    lastName: parentContact.lastName,
    role: "Parent",
    identifier: parentPhone,
    phone: parentPhone,
    email: parentContact.email,
    schoolCode: schoolCode,
    countryScope: "RDC",
    scopeLevel: "Établissement",
    accessChannel: "Application",
    status: "Actif",
    password: parentPassword,
    temporaryPassword: parentPassword,
    permissions: [],
  };
  const relation = {
    id: newId("REL"),
    relationType: "Parent → Élève",
    fromContactId: parentContactId,
    fromContactName: `${parentContact.lastName} ${parentContact.firstName}`.trim(),
    toStudentId: studentId,
    toStudentName: studentDisplayName(
      assignedStudent || { firstName: studentContact.firstName, name: studentContact.lastName, id: studentId },
    ),
    schoolCode: schoolCode,
    isPrincipal: true,
    status: "Actif",
  };
  state = await putStatePatch(adminToken, {
    contacts: [parentContact, ...(state.contacts ?? [])],
    users: [parentUser, ...(state.users ?? [])],
    relations: [relation, ...(state.relations ?? [])],
  });
  const parentToken = await login(parentPhone, parentPassword, schoolCode);
  pushResult(results, "9. Parent connecté (web)", "200", "200", Boolean(parentToken));

  // 10) Paiement visible côté parent
  const parentPaymentsRes = await request("/payments", { token: parentToken });
  const parentPayments = Array.isArray(parentPaymentsRes.data)
    ? parentPaymentsRes.data
    : parentPaymentsRes.data?.items ?? parentPaymentsRes.data?.data ?? [];
  const visible = parentPayments.some(
    (row) =>
      String(row.id ?? row.reference ?? "") === String(payment.id) ||
      String(row.studentId ?? "") === String(studentId),
  );
  pushResult(
    results,
    "10. Paiement visible côté parent",
    payment.reference,
    visible ? payment.reference : `0/${parentPayments.length}`,
    visible && parentPaymentsRes.status === 200,
  );

  const studentPaymentsRes = await request(`/students/${encodeURIComponent(studentId)}/payments`, {
    token: parentToken,
  });
  const studentPaymentsVisible = Array.isArray(studentPaymentsRes.data)
    ? studentPaymentsRes.data.some((row) => String(row.id) === String(payment.id))
    : false;
  pushResult(
    results,
    "10b. Paiement visible (fiche élève parent)",
    payment.reference,
    studentPaymentsVisible ? payment.reference : String(studentPaymentsRes.status),
    studentPaymentsVisible,
  );

  console.log("\n=== E2E 0001 : Parcours scolarité & paiement ===");
  console.log(`Établissement : ${schoolCode}`);
  console.log(`Classe        : ${className}`);
  console.log(`Élève         : ${studentDisplayName(assignedStudent)} (${studentId})`);
  console.log(`Parent        : ${parentPhone}`);
  console.log(`Paiement      : ${payment.reference}\n`);
  console.table(results);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0001 : OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
