import type { BackOfficeState, PlatformNotification, School, SessionUser, StudentFee } from "../types";
import { inputToPeriodDate, todayPeriodDate } from "./dates";
import { auditActor, makeAuditEntry, type AuditEntry } from "./audit";
import { normalize } from "./format";

export type PaymentRecord = Record<string, unknown>;

export const FEE_TYPES = [
  "Inscription",
  "Réinscription",
  "Minerval / scolarité",
  "Frais d'examen",
  "Frais de bulletin",
  "Frais de transport",
  "Frais de cantine",
  "Autre frais",
] as const;

export type FeeType = (typeof FEE_TYPES)[number];

export const PAYMENT_METHODS = [
  "Espèces",
  "Mobile money",
  "Virement bancaire",
  "Carte bancaire",
  "Chèque",
  "Autre",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const QUICK_AMOUNT_SHORTCUTS = [5000, 10000, 25000, 50000, 100000] as const;

export const OVERPAYMENT_ACTIONS = [
  "À confirmer",
  "Crédit élève",
  "Remboursement à prévoir",
  "Affecté à un autre frais",
] as const;

/** Montants dus par défaut (MVP — remplacés par Frais & tarifs ultérieurement). */
export const DEFAULT_FEE_AMOUNTS: Record<FeeType, number> = {
  Inscription: 50_000,
  "Réinscription": 40_000,
  "Minerval / scolarité": 100_000,
  "Frais d'examen": 15_000,
  "Frais de bulletin": 10_000,
  "Frais de transport": 30_000,
  "Frais de cantine": 25_000,
  "Autre frais": 20_000,
};

export interface StudentSearchResult {
  id: string;
  name: string;
  matricule: string;
  classId?: string;
  classCode?: string;
  className: string;
  schoolCode: string;
  schoolName: string;
  parentPhone: string;
  parentEmail: string;
}

export function collectStudentPaymentClasses(
  studentId: string,
  students: Array<Record<string, unknown> | StudentSearchResult>,
): Array<{ classId: string; className: string }> {
  const wanted = String(studentId ?? "").trim();
  if (!wanted) return [];
  const acc: Array<{ classId: string; className: string }> = [];
  for (const student of students) {
    if (String(student.id ?? "").trim() !== wanted) continue;
    const classId = String(student.classId ?? "").trim();
    if (!classId || acc.some((row) => row.classId === classId)) continue;
    acc.push({
      classId,
      className: String(student.className ?? student.classCode ?? classId),
    });
  }
  return acc;
}

export interface FeeBalance {
  feeType: FeeType;
  amountDue: number;
  amountPaid: number;
  remaining: number;
  currency: string;
}

export interface QuickPaymentLine {
  id: string;
  feeType: FeeType;
  amount: string;
}

export function createPaymentLine(feeType: FeeType = "Minerval / scolarité"): QuickPaymentLine {
  const rand = globalThis.crypto?.randomUUID?.() ?? `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { id: rand, feeType, amount: "" };
}

export function parseLineAmount(value: string | number | undefined): number {
  return Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
}

export function sumPaymentLines(lines: { amount?: string | number }[]): number {
  return lines.reduce((sum, line) => {
    const amount = parseLineAmount(line.amount ?? "");
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

export function paymentItemsDetailLabel(items: unknown): string {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return "";
  if (list.length === 1) {
    const first = list[0] as { feeLabel?: string; feeType?: string } | undefined;
    return String(first?.feeLabel || first?.feeType || "1 libellé");
  }
  return `${list.length} libellés`;
}

export interface QuickPaymentInput {
  student: StudentSearchResult;
  feeType: FeeType;
  amount: number;
  method: PaymentMethod;
  date: string;
  comment?: string;
  overpaymentAction?: string;
  schoolYear?: string;
}

export interface DuplicateCheckResult {
  duplicate: boolean;
  existing?: PaymentRecord;
}

export function defaultPaymentDate(): string {
  return todayPeriodDate();
}

export function resolveSchoolCurrency(school?: School | null): string {
  return String(school?.currency ?? "CDF").trim() || "CDF";
}

export function resolveSchoolYear(state: BackOfficeState, schoolCode: string): string {
  const config = state.academicConfigs?.[schoolCode] as { schoolYear?: string } | undefined;
  if (config?.schoolYear) return config.schoolYear;
  const year = new Date().getFullYear();
  return `${year - 1}-${year}`;
}

export function isPaymentCancelled(payment: PaymentRecord): boolean {
  const status = normalize(String(payment.status ?? ""));
  return status.includes("annul");
}

export function isPaymentCounted(payment: PaymentRecord): boolean {
  if (isPaymentCancelled(payment)) return false;
  const status = normalize(String(payment.status ?? ""));
  return !status.includes("echou") && !status.includes("brouillon");
}

export function searchStudentsForPayment(
  query: string,
  students: PaymentRecord[],
  schools: School[],
  schoolCode?: string,
): StudentSearchResult[] {
  const q = normalize(query);
  if (!q || q.length < 2) return [];

  const schoolByCode = new Map(schools.map((school) => [normalize(school.code), school]));

  return students
    .filter((student) => {
      const code = normalize(String(student.schoolCode ?? ""));
      if (schoolCode && schoolCode !== "*" && code !== normalize(schoolCode)) {
        return false;
      }
      const haystack = [
        student.name,
        student.firstName,
        student.lastName,
        student.matricule,
        student.publicId,
        student.id,
        student.parentPhone,
        student.parentEmail,
      ]
        .map((value) => normalize(value))
        .join(" ");
      return haystack.includes(q);
    })
    .slice(0, 8)
    .map((student) => {
      const code = String(student.schoolCode ?? "");
      const school = schoolByCode.get(normalize(code));
      return {
        id: String(student.id ?? ""),
        name: String(student.name ?? `${student.firstName ?? ""} ${student.lastName ?? ""}`.trim()),
        matricule: String(student.matricule ?? student.publicId ?? student.id ?? ""),
        classId: String(student.classId ?? "").trim() || undefined,
        classCode: String(student.classCode ?? "").trim() || undefined,
        className: String(student.className ?? ""),
        schoolCode: code,
        schoolName: String(school?.name ?? code),
        parentPhone: String(student.parentPhone ?? ""),
        parentEmail: String(student.parentEmail ?? ""),
      };
    });
}

function matchesPaymentFeeType(studentFee: StudentFee, feeType: FeeType): boolean {
  const label = normalize(String(studentFee.label ?? ""));
  const type = normalize(String(studentFee.feeType ?? ""));
  switch (feeType) {
    case "Inscription":
      return type === "inscription";
    case "Réinscription":
      return label.includes("reinscription") || type === "inscription";
    case "Minerval / scolarité":
      return type === "mensualite" || label.includes("minerval") || label.includes("scolarite");
    case "Frais d'examen":
      return label.includes("examen");
    case "Frais de bulletin":
      return label.includes("bulletin");
    case "Frais de transport":
      return label.includes("transport");
    case "Frais de cantine":
      return label.includes("cantine");
    case "Autre frais":
      return type === "annexe";
    default:
      return false;
  }
}

export function computeFeeBalance(
  studentId: string,
  feeType: FeeType,
  payments: PaymentRecord[],
  currency: string,
  studentFees: StudentFee[] = [],
): FeeBalance {
  const matchingFees = studentFees.filter(
    (fee) =>
      String(fee.studentId ?? "") === studentId &&
      fee.status !== "Annulé" &&
      matchesPaymentFeeType(fee, feeType),
  );

  const paymentTotal = payments
    .filter(
      (payment) =>
        String(payment.studentId ?? "") === studentId &&
        normalize(String(payment.feeType ?? payment.label ?? "")) === normalize(feeType) &&
        isPaymentCounted(payment),
    )
    .reduce((total, payment) => total + Number(payment.amount ?? 0), 0);

  if (matchingFees.length) {
    const amountDue = matchingFees.reduce((sum, fee) => sum + Number(fee.amountDue ?? 0), 0);
    const balanceFromFees = matchingFees.reduce((sum, fee) => sum + Number(fee.balance ?? 0), 0);
    const paidFromFees = amountDue - balanceFromFees;
    const amountPaid = Math.max(paidFromFees, paymentTotal);
    const remaining = Math.max(0, amountDue - amountPaid);
    return { feeType, amountDue, amountPaid, remaining, currency };
  }

  const amountDue = DEFAULT_FEE_AMOUNTS[feeType] ?? 0;
  const amountPaid = paymentTotal;
  return {
    feeType,
    amountDue,
    amountPaid,
    remaining: Math.max(0, amountDue - amountPaid),
    currency,
  };
}

export function generatePaymentReference(schoolCode: string, payments: PaymentRecord[]): string {
  const year = new Date().getFullYear();
  const prefix = `${String(schoolCode ?? "ETAB").trim().toUpperCase()}-${year}-PAY-`;
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

export function generateVerificationCode(reference: string): string {
  const compact = reference.replace(/[^A-Z0-9]/gi, "").slice(-12).toUpperCase();
  const stamp = Date.now().toString(36).toUpperCase().slice(-4);
  return `VF-${compact}-${stamp}`;
}

export function detectDuplicatePayment(
  input: QuickPaymentInput,
  payments: PaymentRecord[],
  actorId?: string,
): DuplicateCheckResult {
  const match = payments.find((payment) => {
    if (!isPaymentCounted(payment)) return false;
    return (
      String(payment.studentId ?? "") === input.student.id &&
      Number(payment.amount ?? 0) === input.amount &&
      normalize(String(payment.feeType ?? payment.label ?? "")) === normalize(input.feeType) &&
      String(payment.date ?? "") === input.date &&
      normalize(String(payment.method ?? "")) === normalize(input.method) &&
      (!actorId || String(payment.createdBy ?? "") === actorId)
    );
  });
  return { duplicate: Boolean(match), existing: match };
}

export function resolvePaymentStatus(
  amount: number,
  remainingBeforePayment: number,
  method: PaymentMethod,
  leftover = Math.max(0, amount - remainingBeforePayment),
): string {
  if (method === "Mobile money") {
    return "En attente de confirmation";
  }
  const allocated = Math.max(0, amount - leftover);
  if (amount > 0 && allocated === 0) {
    return "Non imputé";
  }
  if (allocated > 0 && leftover > 0) {
    return "Partiel";
  }
  if (remainingBeforePayment <= 0) {
    return "Non imputé";
  }
  if (amount >= remainingBeforePayment) {
    return "Payé";
  }
  return "Partiel";
}

export function buildQuickPaymentRecord(
  input: QuickPaymentInput,
  context: {
    payments: PaymentRecord[];
    studentFees?: StudentFee[];
    school?: School | null;
    user: SessionUser | null;
    schoolYear: string;
  },
): PaymentRecord {
  const balance = computeFeeBalance(
    input.student.id,
    input.feeType,
    context.payments,
    resolveSchoolCurrency(context.school),
    context.studentFees ?? [],
  );
  const reference = generatePaymentReference(input.student.schoolCode, context.payments);
  const verificationCode = generateVerificationCode(reference);
  const actor = auditActor(context.user);
  const now = new Date().toISOString();
  const remainingBefore = balance.remaining;
  const overpayment = Math.max(0, input.amount - remainingBefore);
  const status = resolvePaymentStatus(input.amount, remainingBefore, input.method, overpayment);

  return {
    id: reference,
    publicId: reference,
    reference,
    schoolCode: input.student.schoolCode,
    studentId: input.student.id,
    studentName: input.student.name,
    className: input.student.className,
    feeType: input.feeType,
    label: input.feeType,
    amount: input.amount,
    currency: resolveSchoolCurrency(context.school),
    method: input.method,
    date: input.date,
    status,
    comment: input.comment?.trim() ?? "",
    schoolYear: input.schoolYear ?? context.schoolYear,
    verificationCode,
    amountDue: balance.amountDue,
    amountPaidBefore: balance.amountPaid,
    remainingAfter: Math.max(0, remainingBefore - input.amount),
    overpaymentAmount: overpayment > 0 ? overpayment : 0,
    overpaymentAction: overpayment > 0 ? input.overpaymentAction ?? "À confirmer" : "",
    createdAt: now,
    createdBy: actor.actorId,
    createdByName: actor.actorName,
    recordedAt: now,
  };
}

export function buildPaymentAuditEntry(
  payment: PaymentRecord,
  user: SessionUser | null,
  action: "payment.create" | "payment.cancel" | "payment.receipt.print",
  details?: string,
): AuditEntry {
  return makeAuditEntry({
    ...auditActor(user),
    action,
    entityType: "payment",
    entityId: String(payment.id ?? payment.publicId ?? ""),
    entityLabel: String(payment.reference ?? payment.publicId ?? ""),
    schoolCode: String(payment.schoolCode ?? ""),
    details,
  });
}

export function buildParentPaymentNotification(
  payment: PaymentRecord,
  student: StudentSearchResult,
): PlatformNotification {
  const amount = Number(payment.amount ?? 0);
  const currency = String(payment.currency ?? "CDF");
  const formatted = new Intl.NumberFormat("fr-FR").format(amount);
  return {
    id: `NOTIF-PAY-${String(payment.id ?? Date.now())}`,
    audience: "Parents",
    schoolCode: student.schoolCode,
    title: "Paiement enregistré",
    message: `Paiement de ${formatted} ${currency} (${String(payment.feeType ?? payment.label ?? "frais")}) enregistré pour ${student.name}. Réf. ${String(payment.reference ?? payment.publicId ?? "")}.`,
    type: "Paiement",
    priority: "Normal",
    channels: ["Somafrik"],
    status: "Non lu",
    date: String(payment.date ?? defaultPaymentDate()),
    createdBy: String(payment.createdByName ?? "Système"),
  };
}

export function cancelPaymentRecord(
  payment: PaymentRecord,
  reason: string,
  user: SessionUser | null,
): PaymentRecord {
  const actor = auditActor(user);
  return {
    ...payment,
    status: "Annulé",
    cancelledAt: new Date().toISOString(),
    cancelledBy: actor.actorId,
    cancelledByName: actor.actorName,
    cancellationReason: reason.trim(),
  };
}

export function validateQuickPaymentInput(input: Partial<QuickPaymentInput>): string | null {
  if (!input.student?.id) return "Veuillez sélectionner un élève";
  if (!input.feeType) return "Veuillez sélectionner le type de frais";
  if (!input.method) return "Veuillez sélectionner le mode de paiement";
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return "Le montant doit être supérieur à zéro";
  if (!input.date?.trim()) return "La date du paiement est obligatoire";
  return null;
}

export function validateMultiItemPaymentInput(input: {
  student?: StudentSearchResult | null;
  classId?: string;
  classOptions?: Array<{ classId: string }>;
  method?: PaymentMethod | "";
  date?: string;
  lines?: QuickPaymentLine[];
}): string | null {
  if (!input.student?.id) return "Veuillez sélectionner un élève";
  const classOptions = input.classOptions ?? [];
  if (!classOptions.length) return "Cet élève n'a aucune inscription active.";
  if (!String(input.classId ?? "").trim()) return "Veuillez sélectionner une classe";
  if (!classOptions.some((row) => row.classId === String(input.classId ?? "").trim())) {
    return "Classe invalide pour cet élève.";
  }
  if (!input.method) return "Veuillez sélectionner le mode de paiement";
  if (!input.date?.trim()) return "La date du paiement est obligatoire";
  const lines = input.lines ?? [];
  if (!lines.length) return "Ajoutez au moins un libellé";
  for (const line of lines) {
    if (!line.feeType) return "Chaque ligne doit avoir un type de frais";
    const amount = parseLineAmount(line.amount);
    if (!Number.isFinite(amount) || amount <= 0) return "Chaque libellé doit avoir un montant strictement positif";
  }
  return null;
}

export function paymentDateFromInput(isoDate: string): string {
  return inputToPeriodDate(isoDate) || defaultPaymentDate();
}

export { periodDateToInput as paymentDateToInput } from "./dates";
