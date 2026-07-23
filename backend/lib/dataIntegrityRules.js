/**
 * Règles d'intégrité des données Somafrik (référentiel, établissements, doublons, formats).
 * Utilisé par l'API, les audits et les tests E2E d'intégrité.
 */

const LOCKED_EVALUATION_STATUSES = new Set(["Validée", "Publiée", "Annulée"]);
const ARCHIVED_STUDENT_STATUSES = new Set(["archivé", "archive", "inactif", "suspendu"]);

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeSchoolCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function classNamesMatch(left, right) {
  return normalize(left) === normalize(right);
}

function rowKey(row = {}) {
  return String(row.id ?? row.publicId ?? row.matricule ?? row.code ?? "").trim();
}

function assignmentSignature(assignment = {}) {
  return [
    String(assignment.teacherId ?? ""),
    String(assignment.className ?? ""),
    String(assignment.subject ?? assignment.course ?? ""),
    normalizeSchoolCode(assignment.schoolCode),
  ].join("|");
}

function teacherSignature(teacher = {}) {
  return [
    String(teacher.firstName ?? ""),
    String(teacher.name ?? ""),
    String(teacher.birthDate ?? ""),
    String(teacher.entryDate ?? ""),
    String(teacher.status ?? ""),
    normalizeSchoolCode(teacher.schoolCode),
  ].join("|");
}

function listChangedRows(stateRows = [], payloadRows = [], signatureFn) {
  const currentById = new Map((stateRows ?? []).map((row) => [rowKey(row), row]));
  const changed = [];
  for (const row of payloadRows ?? []) {
    const key = rowKey(row);
    const previous = currentById.get(key);
    if (!previous) {
      changed.push(row);
      continue;
    }
    if (signatureFn(previous) !== signatureFn(row)) {
      changed.push(row);
    }
  }
  return changed;
}

function noteSignature(note = {}) {
  return [
    String(note.studentId ?? ""),
    String(note.evaluationId ?? ""),
    String(note.value ?? ""),
    String(note.scale ?? ""),
    String(note.version ?? ""),
    String(note.className ?? ""),
    String(note.subject ?? ""),
    normalizeSchoolCode(note.schoolCode),
  ].join("|");
}

function presenceSignature(presence = {}) {
  return [
    String(presence.studentId ?? ""),
    String(presence.date ?? ""),
    String(presence.status ?? presence.value ?? ""),
    String(presence.className ?? ""),
    normalizeSchoolCode(presence.schoolCode),
  ].join("|");
}

function paymentSignature(payment = {}) {
  return [
    String(payment.studentId ?? ""),
    String(payment.amount ?? ""),
    String(payment.reference ?? ""),
    String(payment.status ?? ""),
    String(payment.date ?? payment.paidAt ?? ""),
    normalizeSchoolCode(payment.schoolCode),
  ].join("|");
}

function listChangedAssignments(state = {}, payload = {}) {
  return listChangedRows(state.assignments, payload.assignments, assignmentSignature);
}

function listChangedTeachers(state = {}, payload = {}) {
  return listChangedRows(state.teachers, payload.teachers, teacherSignature);
}

function listChangedNotes(state = {}, payload = {}) {
  return listChangedRows(state.notes, payload.notes, noteSignature);
}

function listChangedPresences(state = {}, payload = {}) {
  return listChangedRows(state.presences, payload.presences, presenceSignature);
}

function listChangedPayments(state = {}, payload = {}) {
  return listChangedRows(state.payments, payload.payments, paymentSignature);
}

function findStudent(state, studentId) {
  const key = String(studentId ?? "").trim();
  if (!key) return null;
  return (state.students ?? []).find((item) =>
    [item.id, item.publicId, item.matricule].some((value) => String(value ?? "").trim() === key),
  ) ?? null;
}

function findEvaluation(state, evaluationId) {
  const key = String(evaluationId ?? "").trim();
  if (!key) return null;
  return (state.evaluations ?? []).find((item) => String(item.id ?? "") === key) ?? null;
}

function findSchool(state, schoolCode) {
  const key = normalizeSchoolCode(schoolCode);
  if (!key) return null;
  return (state.schools ?? []).find((item) =>
    [item.code, item.publicId].some((value) => normalizeSchoolCode(value) === key),
  ) ?? null;
}

function findClass(state, className, schoolCode) {
  const target = normalize(className);
  if (!target) return null;
  return (state.classes ?? []).find((item) => {
    const name = normalize(item.name ?? item.className);
    if (name !== target) return false;
    const itemSchool = normalizeSchoolCode(item.schoolCode);
    const scope = normalizeSchoolCode(schoolCode);
    return !scope || !itemSchool || itemSchool === scope;
  }) ?? null;
}

function findTeacher(state, teacherId) {
  const key = String(teacherId ?? "").trim();
  if (!key) return null;
  return (state.teachers ?? []).find((item) =>
    [item.id, item.publicId, item.userId, item.contactId, item.identifier].some(
      (value) => String(value ?? "").trim() === key,
    ),
  ) ?? null;
}

function findTeacherForAssignment(state = {}, assignment = {}) {
  const teacherId = String(assignment.teacherId ?? "").trim();
  const direct = findTeacher(state, teacherId);
  if (direct) return direct;

  const teacherName = String(assignment.teacherName ?? "").trim();
  const schoolCode = normalizeSchoolCode(assignment.schoolCode);
  if (!teacherName) return null;

  return (
    (state.teachers ?? []).find((item) => {
      const fullName = `${item.firstName ?? ""} ${item.lastName ?? item.name ?? ""}`.trim();
      const sameName = normalize(fullName) === normalize(teacherName);
      const itemSchool = normalizeSchoolCode(item.schoolCode);
      return sameName && (!schoolCode || !itemSchool || itemSchool === schoolCode);
    }) ?? null
  );
}

function isStudentArchived(student = {}) {
  if (student.archived === true) return true;
  const status = normalize(student.status);
  return ARCHIVED_STUDENT_STATUSES.has(status);
}

function isPaymentCancelled(payment = {}) {
  return normalize(payment.status).includes("annul");
}

function isPaymentCounted(payment = {}) {
  if (isPaymentCancelled(payment)) return false;
  const status = normalize(payment.status);
  return !status.includes("echou") && !status.includes("brouillon");
}

function validateGradeValue(value, scale) {
  if (!Number.isFinite(value)) return "La note doit être un nombre.";
  if (value < 0) return "La note ne peut pas être négative.";
  if (value > scale) return `La note ne peut pas dépasser le barème (${scale}).`;
  return null;
}

function validateEmail(value) {
  const email = String(value ?? "").trim();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Email invalide.";
  return null;
}

function validatePositiveAmount(amount, label = "montant") {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return `Le ${label} doit être strictement positif.`;
  return null;
}

/** Écriture note — intégrité référentielle + barème + établissement. */
function validateNoteWrite(state = {}, note = {}, options = {}) {
  const studentId = String(note.studentId ?? "").trim();
  if (!studentId) return "L'élève est obligatoire pour une note.";

  const student = findStudent(state, studentId);
  if (!student) return "Élève introuvable : aucune note orpheline autorisée.";

  if (isStudentArchived(student) && !options.allowArchived) {
    return "Un élève archivé ne peut plus recevoir de nouvelles notes.";
  }

  const scale = Number(note.scale ?? 20);
  const value = note.value == null || note.value === "" ? null : Number(note.value);
  if (value != null) {
    const scaleError = validateGradeValue(value, scale);
    if (scaleError) return scaleError;
  }

  const evaluationId = String(note.evaluationId ?? "").trim();
  if (evaluationId) {
    const evaluation = findEvaluation(state, evaluationId);
    if (!evaluation) return "Évaluation introuvable : note orpheline refusée.";
    if (evaluation.active === false) return "Évaluation inactive : saisie refusée.";
    if (LOCKED_EVALUATION_STATUSES.has(evaluation.status) && options.enforceLockedEvaluation !== false) {
      return `Évaluation ${evaluation.status} : modification de note refusée.`;
    }
    const evalSchool = normalizeSchoolCode(evaluation.schoolCode);
    const studentSchool = normalizeSchoolCode(student.schoolCode);
    if (evalSchool && studentSchool && evalSchool !== studentSchool) {
      return "L'élève et l'évaluation doivent appartenir au même établissement.";
    }
    if (note.className && evaluation.className && !classNamesMatch(note.className, evaluation.className)) {
      return "La note ne correspond pas à la classe de l'évaluation.";
    }
    if (note.subject && evaluation.subject && normalize(note.subject) !== normalize(evaluation.subject)) {
      return "La note ne correspond pas à la matière de l'évaluation.";
    }
  }

  const noteSchool = normalizeSchoolCode(note.schoolCode ?? student.schoolCode);
  const studentSchool = normalizeSchoolCode(student.schoolCode);
  if (noteSchool && studentSchool && noteSchool !== studentSchool) {
    return "La note ne peut pas appartenir à un autre établissement que l'élève.";
  }

  if (note.className && student.className && !classNamesMatch(note.className, student.className)) {
    const cls = findClass(state, student.className, student.schoolCode);
    const noteClass = findClass(state, note.className, student.schoolCode);
    if (cls && noteClass && normalizeSchoolCode(cls.schoolCode) !== normalizeSchoolCode(noteClass.schoolCode)) {
      return "La classe de la note ne correspond pas à l'établissement de l'élève.";
    }
  }

  return null;
}

/** Écriture présence — élève existant, classe cohérente, pas de doublon jour. */
function validatePresenceWrite(state = {}, presence = {}, options = {}) {
  const studentId = String(presence.studentId ?? "").trim();
  if (!studentId) return "L'élève est obligatoire pour une présence.";
  if (!String(presence.date ?? "").trim()) return "La date de présence est obligatoire.";

  const student = findStudent(state, studentId);
  if (!student) return "Élève introuvable : présence orpheline refusée.";

  if (isStudentArchived(student)) return "Un élève archivé ne peut plus recevoir de présences.";

  const presenceSchool = normalizeSchoolCode(presence.schoolCode ?? student.schoolCode);
  const studentSchool = normalizeSchoolCode(student.schoolCode);
  if (presenceSchool && studentSchool && presenceSchool !== studentSchool) {
    return "La présence doit appartenir au même établissement que l'élève.";
  }

  const className = String(presence.className ?? student.className ?? "").trim();
  if (className && student.className && !classNamesMatch(className, student.className)) {
    return "La présence doit correspondre à la classe de l'élève inscrit.";
  }

  if (!options.skipDuplicateCheck) {
    // D3.5b : unicité = établissement + élève + jour (pas la classe)
    const presenceSchoolKey = presenceSchool || studentSchool;
    const studentKeys = new Set(
      [student.id, student.matricule, student.publicId, studentId]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    );
    const duplicate = (state.presences ?? []).find((row) => {
      if (String(row.id ?? "") === String(presence.id ?? "")) return false;
      const rowSchool = normalizeSchoolCode(row.schoolCode ?? "");
      if (presenceSchoolKey && rowSchool && presenceSchoolKey !== rowSchool) return false;
      if (!studentKeys.has(String(row.studentId ?? "").trim())) return false;
      return normalizePresenceDay(row.date) === normalizePresenceDay(presence.date);
    });
    if (duplicate) return "Une présence existe déjà pour cet élève à cette date.";
  }

  return null;
}

function normalizePresenceDay(value) {
  const text = String(value ?? "").trim();
  const localMatch = text.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (localMatch) return `${localMatch[3]}-${localMatch[2]}-${localMatch[1]}`;
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  return normalize(text);
}

/** Écriture paiement — élève, montant, établissement, référence unique. */
function validatePaymentWrite(state = {}, payment = {}, options = {}) {
  const studentId = String(payment.studentId ?? "").trim();
  if (!studentId) return "L'élève est obligatoire pour un paiement.";

  const student = findStudent(state, studentId);
  if (!student) return "Élève introuvable : paiement orphelin refusé.";

  const amountError = validatePositiveAmount(payment.amount, "montant du paiement");
  if (amountError) return amountError;

  if (!String(payment.date ?? "").trim()) return "La date du paiement est obligatoire.";
  if (!String(payment.method ?? payment.paymentMethod ?? "").trim()) {
    return "Le moyen de paiement est obligatoire.";
  }

  const paymentSchool = normalizeSchoolCode(payment.schoolCode ?? student.schoolCode);
  const studentSchool = normalizeSchoolCode(student.schoolCode);
  if (paymentSchool && studentSchool && paymentSchool !== studentSchool) {
    return "Le paiement doit appartenir au même établissement que l'élève.";
  }

  const reference = String(payment.reference ?? payment.publicId ?? "").trim();
  if (reference && !options.skipDuplicateCheck) {
    const duplicate = (state.payments ?? []).find(
      (row) =>
        String(row.id ?? "") !== String(payment.id ?? "") &&
        [row.reference, row.publicId].some((value) => String(value ?? "").trim() === reference),
    );
    if (duplicate) return `Référence de paiement déjà utilisée : ${reference}.`;
  }

  if (isPaymentCancelled(payment) && options.checkBalance) {
    return null;
  }

  return null;
}

/** Affectation enseignant — enseignant actif, même établissement. */
function validateAssignmentWrite(state = {}, assignment = {}) {
  const teacherId = String(assignment.teacherId ?? "").trim();
  if (!teacherId) return "L'enseignant est obligatoire pour une affectation.";

  const teacher = findTeacherForAssignment(state, assignment);
  if (!teacher) return "Enseignant introuvable pour cette affectation.";

  if (normalize(teacher.status) === "inactif" || teacher.archived === true) {
    return "Un enseignant désactivé ne peut plus être affecté.";
  }

  const assignmentSchool = normalizeSchoolCode(assignment.schoolCode ?? teacher.schoolCode);
  const teacherSchool = normalizeSchoolCode(teacher.schoolCode);
  if (assignmentSchool && teacherSchool && assignmentSchool !== teacherSchool) {
    return "L'affectation doit appartenir au même établissement que l'enseignant.";
  }

  if (!String(assignment.className ?? "").trim()) return "La classe est obligatoire pour une affectation.";
  if (!String(assignment.subject ?? assignment.course ?? "").trim()) {
    return "La matière est obligatoire pour une affectation.";
  }

  return null;
}

/** Fiche enseignant — date d'entrée cohérente avec la date de naissance (18 ans minimum). */
function validateTeacherWrite(_state = {}, teacher = {}) {
  const { validateTeacherSchoolEntry } = require("./teacherEntryRules");
  return validateTeacherSchoolEntry(teacher);
}

function detectDuplicateNoteKeys(notes = []) {
  const seen = new Map();
  const duplicates = [];
  for (const note of notes) {
    const key = `${String(note.studentId ?? "")}|${String(note.evaluationId ?? "")}`;
    if (!key || key === "|") continue;
    if (seen.has(key)) duplicates.push({ key, rows: [seen.get(key), note] });
    else seen.set(key, note);
  }
  return duplicates;
}

function detectDuplicatePresenceKeys(presences = []) {
  const seen = new Map();
  const duplicates = [];
  for (const presence of presences) {
    // D3.5b : clé canonique établissement + élève + jour
    const key = `${normalizeSchoolCode(presence.schoolCode)}|${String(presence.studentId ?? "").trim()}|${normalizePresenceDay(presence.date)}`;
    if (!String(presence.studentId ?? "").trim() || !normalizePresenceDay(presence.date)) continue;
    if (seen.has(key)) duplicates.push({ key, rows: [seen.get(key), presence] });
    else seen.set(key, presence);
  }
  return duplicates;
}

function detectDuplicatePaymentReferences(payments = []) {
  const seen = new Map();
  const duplicates = [];
  for (const payment of payments) {
    for (const candidate of [payment.reference, payment.publicId]) {
      const key = String(candidate ?? "").trim();
      if (!key) continue;
      if (seen.has(key)) duplicates.push({ key, rows: [seen.get(key), payment] });
      else seen.set(key, payment);
    }
  }
  return duplicates;
}

function detectDuplicateLoginIdentifiers(users = []) {
  const seen = new Map();
  const duplicates = [];
  for (const user of users) {
    for (const candidate of [user.email, user.phone, user.identifier]) {
      const key = normalize(candidate);
      if (!key) continue;
      const scoped = `${normalizeSchoolCode(user.schoolCode)}|${key}`;
      if (seen.has(scoped)) duplicates.push({ key: scoped, rows: [seen.get(scoped), user] });
      else seen.set(scoped, user);
    }
  }
  return duplicates;
}

function auditOrphanNotes(state = {}) {
  const issues = [];
  for (const note of state.notes ?? []) {
    if (!findStudent(state, note.studentId)) {
      issues.push({
        severity: "critical",
        category: "referential",
        code: "orphan_note",
        message: `Note orpheline (élève ${note.studentId})`,
        entity: "notes",
        id: rowKey(note),
      });
    }
    const evaluationId = String(note.evaluationId ?? "").trim();
    if (evaluationId && !findEvaluation(state, evaluationId)) {
      issues.push({
        severity: "critical",
        category: "referential",
        code: "orphan_note_evaluation",
        message: `Note sans évaluation valide (${evaluationId})`,
        entity: "notes",
        id: rowKey(note),
      });
    }
  }
  return issues;
}

function auditCrossSchoolStudents(state = {}) {
  const issues = [];
  for (const student of state.students ?? []) {
    const studentSchool = normalizeSchoolCode(student.schoolCode);
    if (!studentSchool) {
      issues.push({
        severity: "critical",
        category: "cross_school",
        code: "student_without_school",
        message: `Élève sans établissement (${rowKey(student)})`,
        entity: "students",
        id: rowKey(student),
      });
      continue;
    }
    if (!findSchool(state, studentSchool)) {
      issues.push({
        severity: "high",
        category: "cross_school",
        code: "student_unknown_school",
        message: `Élève rattaché à un établissement inconnu (${studentSchool})`,
        entity: "students",
        id: rowKey(student),
      });
    }
    const className = String(student.className ?? "").trim();
    if (!className) continue;
    const cls = findClass(state, className, studentSchool);
    if (cls) {
      const classSchool = normalizeSchoolCode(cls.schoolCode);
      if (classSchool && classSchool !== studentSchool) {
        issues.push({
          severity: "critical",
          category: "cross_school",
          code: "student_class_school_mismatch",
          message: `Élève ${rowKey(student)} : établissement ${studentSchool} ≠ classe ${classSchool}`,
          entity: "students",
          id: rowKey(student),
        });
      }
    }
  }
  return issues;
}

function auditPaymentBalances(state = {}) {
  const issues = [];
  const paymentsByStudent = new Map();
  for (const payment of state.payments ?? []) {
    if (!isPaymentCounted(payment)) continue;
    const studentId = String(payment.studentId ?? "");
    if (!paymentsByStudent.has(studentId)) paymentsByStudent.set(studentId, []);
    paymentsByStudent.get(studentId).push(payment);
  }

  for (const fee of state.studentFees ?? []) {
    if (normalize(fee.status).includes("annul")) continue;
    const studentId = String(fee.studentId ?? "");
    const amountDue = Number(fee.amountDue ?? 0);
    const recordedBalance = Number(fee.balance ?? NaN);
    if (!Number.isFinite(amountDue) || !Number.isFinite(recordedBalance)) continue;

    const paidFromPayments = (paymentsByStudent.get(studentId) ?? [])
      .filter((payment) => normalize(String(payment.feeType ?? payment.label ?? "")) === normalize(fee.feeType ?? fee.label ?? ""))
      .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);

    const expectedBalance = Math.max(0, amountDue - paidFromPayments);
    if (Math.abs(recordedBalance - expectedBalance) > 0.01) {
      issues.push({
        severity: "high",
        category: "calculation",
        code: "fee_balance_mismatch",
        message: `Solde incohérent élève ${studentId} : enregistré ${recordedBalance}, attendu ${expectedBalance}`,
        entity: "studentFees",
        id: rowKey(fee),
      });
    }
  }
  return issues;
}

function auditDuplicates(state = {}) {
  const issues = [];
  for (const dup of detectDuplicateNoteKeys(state.notes ?? [])) {
    issues.push({
      severity: "critical",
      category: "duplicate",
      code: "duplicate_note",
      message: `Doublon note élève/évaluation : ${dup.key}`,
      entity: "notes",
    });
  }
  for (const dup of detectDuplicatePresenceKeys(state.presences ?? [])) {
    issues.push({
      severity: "high",
      category: "duplicate",
      code: "duplicate_presence",
      message: `Doublon présence : ${dup.key}`,
      entity: "presences",
    });
  }
  for (const dup of detectDuplicatePaymentReferences(state.payments ?? [])) {
    issues.push({
      severity: "critical",
      category: "duplicate",
      code: "duplicate_payment_reference",
      message: `Référence paiement dupliquée : ${dup.key}`,
      entity: "payments",
    });
  }
  for (const dup of detectDuplicateLoginIdentifiers(state.users ?? [])) {
    issues.push({
      severity: "high",
      category: "duplicate",
      code: "duplicate_user_identifier",
      message: `Identifiant utilisateur dupliqué : ${dup.key}`,
      entity: "users",
    });
  }
  return issues;
}

function auditRequiredFields(state = {}) {
  const issues = [];
  for (const student of state.students ?? []) {
    if (!String(student.name ?? student.lastName ?? "").trim() || !String(student.firstName ?? "").trim()) {
      issues.push({
        severity: "high",
        category: "required",
        code: "student_missing_name",
        message: `Élève sans nom/prénom (${rowKey(student)})`,
        entity: "students",
        id: rowKey(student),
      });
    }
    if (!String(student.matricule ?? student.publicId ?? student.id ?? "").trim()) {
      issues.push({
        severity: "high",
        category: "required",
        code: "student_missing_matricule",
        message: `Élève sans matricule (${rowKey(student)})`,
        entity: "students",
        id: rowKey(student),
      });
    }
  }
  for (const user of state.users ?? []) {
    const emailError = validateEmail(user.email);
    if (emailError) {
      issues.push({
        severity: "medium",
        category: "format",
        code: "invalid_user_email",
        message: `${emailError} (${rowKey(user)})`,
        entity: "users",
        id: rowKey(user),
      });
    }
  }
  return issues;
}

function auditFullState(state = {}) {
  return [
    ...auditOrphanNotes(state),
    ...auditCrossSchoolStudents(state),
    ...auditDuplicates(state),
    ...auditRequiredFields(state),
    ...auditPaymentBalances(state),
  ];
}

function validateTouchedPayload(state = {}, payload = {}, touchedKeys = []) {
  const errors = [];
  const effectiveState = (() => {
    const merged = { ...state };
    for (const key of ["teachers", "students", "classes", "schools", "evaluations"]) {
      if (touchedKeys.includes(key) && Array.isArray(payload[key])) {
        merged[key] = payload[key];
      }
    }
    return merged;
  })();
  if (touchedKeys.includes("notes")) {
    const payloadNotes = payload.notes ?? [];
    const payloadDupes = detectDuplicateNoteKeys(payloadNotes);
    if (payloadDupes.length) {
      errors.push({
        entity: "notes",
        message: `Doublon note élève/évaluation dans la requête : ${payloadDupes[0].key}`,
      });
    }
    for (const note of listChangedNotes(state, payload)) {
      const message = validateNoteWrite(effectiveState, note, { enforceLockedEvaluation: false });
      if (message) errors.push({ entity: "notes", id: rowKey(note), message });
    }
  }
  if (touchedKeys.includes("presences")) {
    for (const presence of listChangedPresences(state, payload)) {
      const message = validatePresenceWrite(effectiveState, presence, { skipDuplicateCheck: true });
      if (message) errors.push({ entity: "presences", id: rowKey(presence), message });
    }
  }
  if (touchedKeys.includes("payments")) {
    for (const payment of listChangedPayments(state, payload)) {
      const message = validatePaymentWrite(effectiveState, payment, { skipDuplicateCheck: true });
      if (message) errors.push({ entity: "payments", id: rowKey(payment), message });
    }
  }
  if (touchedKeys.includes("assignments")) {
    const assignmentsToValidate = listChangedAssignments(state, payload);
    for (const assignment of assignmentsToValidate) {
      const message = validateAssignmentWrite(effectiveState, assignment);
      if (message) errors.push({ entity: "assignments", id: rowKey(assignment), message });
    }
  }
  if (touchedKeys.includes("teachers")) {
    for (const teacher of listChangedTeachers(state, payload)) {
      const message = validateTeacherWrite(effectiveState, teacher);
      if (message) errors.push({ entity: "teachers", id: rowKey(teacher), message });
    }
  }

  const { validateContactProvision } = require("./contactProvisionRules");
  errors.push(...validateContactProvision(state, payload, touchedKeys));

  return errors;
}

module.exports = {
  normalize,
  normalizeSchoolCode,
  classNamesMatch,
  findStudent,
  findEvaluation,
  validateGradeValue,
  validateEmail,
  validateNoteWrite,
  validatePresenceWrite,
  validatePaymentWrite,
  validateAssignmentWrite,
  validateTeacherWrite,
  detectDuplicateNoteKeys,
  detectDuplicatePresenceKeys,
  detectDuplicatePaymentReferences,
  auditOrphanNotes,
  auditCrossSchoolStudents,
  auditDuplicates,
  auditRequiredFields,
  auditPaymentBalances,
  auditFullState,
  validateTouchedPayload,
  isPaymentCounted,
  isStudentArchived,
  normalizePresenceDay,
};
