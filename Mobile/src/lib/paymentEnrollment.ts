/**
 * Résolution canonique classe pour un paiement scolaire Mobile.
 * Source d'autorité : inscriptions PostgreSQL actives de l'élève (classId UUID).
 * Jamais un className libre, ni la première classe de l'établissement.
 */

export type PaymentClassOption = {
  classId: string;
  classCode: string;
  className: string;
};

export type PaymentStudent = {
  id: string;
  name?: string;
  classId?: string | null;
  classCode?: string;
  className?: string;
  schoolCode?: string;
  enrollments?: Array<{
    status?: string;
    classId?: string | null;
    classCode?: string;
    className?: string;
  }>;
};

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

function isActiveEnrollment(status?: string): boolean {
  const normalized = trim(status).toLowerCase();
  return !normalized || normalized === "active" || normalized === "actif";
}

function pushClass(acc: PaymentClassOption[], input: { classId?: string | null; classCode?: string; className?: string }) {
  const classId = trim(input.classId);
  if (!classId) return;
  if (acc.some((row) => row.classId === classId)) return;
  acc.push({
    classId,
    classCode: trim(input.classCode),
    className: trim(input.className) || trim(input.classCode) || classId,
  });
}

/** Classes actives de l'élève, y compris lignes dupliquées du listing GET /students. */
export function collectActivePaymentClasses(studentId: string, students: PaymentStudent[]): PaymentClassOption[] {
  const wanted = trim(studentId);
  if (!wanted) return [];
  const acc: PaymentClassOption[] = [];
  for (const student of students) {
    if (trim(student.id) !== wanted) continue;
    const enrollments = Array.isArray(student.enrollments) ? student.enrollments : [];
    for (const enrollment of enrollments) {
      if (!isActiveEnrollment(enrollment.status)) continue;
      pushClass(acc, enrollment);
    }
    pushClass(acc, student);
  }
  return acc;
}

export function preselectPaymentClassId(studentId: string, students: PaymentStudent[]): string {
  const options = collectActivePaymentClasses(studentId, students);
  return options.length === 1 ? options[0].classId : "";
}

export function paymentClassBelongsToStudent(
  studentId: string,
  classId: string,
  students: PaymentStudent[],
): boolean {
  const wanted = trim(classId);
  if (!wanted) return false;
  return collectActivePaymentClasses(studentId, students).some((row) => row.classId === wanted);
}

export function buildSchoolPaymentPayload(input: {
  studentId: string;
  classId: string;
  amount: number;
  feeType: string;
  method: string;
  date: string;
}): Record<string, unknown> {
  return {
    studentId: trim(input.studentId),
    classId: trim(input.classId),
    method: trim(input.method),
    date: trim(input.date),
    items: [{ feeType: trim(input.feeType), amount: input.amount }],
  };
}

export function paymentSubmitErrorMessage(outcome: "queued" | "failed" | string, error?: unknown): string {
  if (outcome === "queued" || outcome === "in_flight") return "Paiement conservé en file. Pas de succès local.";
  if (outcome === "blocked_sending") {
    if (error instanceof Error && error.message.trim()) return error.message;
    return "Cet envoi est déjà en cours de synchronisation. Attendez la confirmation avant un nouvel enregistrement.";
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Enregistrement refusé.";
}
