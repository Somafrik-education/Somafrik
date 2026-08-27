import { isPeriodDateBefore, parsePeriodDate } from "./dates";
import type {
  BackOfficeState,
  FeeGrid,
  FeeGridStatus,
  FeeTariffHistory,
  SchoolFeeItem,
  SchoolFeeType,
  SessionUser,
  StudentFee,
  StudentFeeStatus,
} from "../types";
import { getSchoolAcademicLists } from "./academicConfig";
import { scopedStudents } from "./establishment";
import { normalize } from "./format";
import { isSchoolAdminRole } from "./format";
import { COUNTRY_ADMIN_ROLE, isSuperAdminRole } from "./orgHierarchy";

export const FEE_GRID_STATUSES: FeeGridStatus[] = ["Brouillon", "Active", "Désactivée", "Clôturée"];
export const SCHOOL_FEE_TYPES: SchoolFeeType[] = ["Inscription", "Mensualité", "Annexe"];
export const STUDENT_FEE_STATUSES: StudentFeeStatus[] = [
  "À payer",
  "Partiellement payé",
  "Payé",
  "En retard",
  "Exonéré",
  "Annulé",
];

export const DEFAULT_MONTHLY_MONTHS = [
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
];

export function newFeeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function resolveAcademicYear(state: BackOfficeState, schoolCode: string): string {
  const config = (state.academicConfigs?.[schoolCode] ?? {}) as Record<string, unknown>;
  const explicit = String(config.academicYear ?? config.schoolYear ?? "").trim();
  if (explicit) return explicit;
  const now = new Date();
  const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
}

export function resolveSchoolCurrency(state: BackOfficeState, schoolCode: string): string {
  const school = state.schools.find((item) => normalize(item.code) === normalize(schoolCode));
  if (school?.currency) return String(school.currency).trim().toUpperCase();
  const countryCode = String(school?.countryCode ?? school?.code ?? "").slice(0, 2).toUpperCase();
  const country = state.countries.find((item) => normalize(item.code) === normalize(countryCode));
  return String(country?.currency ?? "USD").trim().toUpperCase() || "USD";
}

function scopedSchoolCode(user: SessionUser | null): string | null {
  const code = String(user?.schoolCode ?? "").trim();
  if (!code || code === "*") return null;
  return code;
}

export function scopedFeeGrids(user: SessionUser | null, state: BackOfficeState): FeeGrid[] {
  const rows = state.feeGrids ?? [];
  const code = scopedSchoolCode(user);
  if (!code) return rows;
  return rows.filter((row) => normalize(row.schoolCode) === normalize(code));
}

export function scopedSchoolFeeItems(user: SessionUser | null, state: BackOfficeState): SchoolFeeItem[] {
  const rows = state.schoolFeeItems ?? [];
  const code = scopedSchoolCode(user);
  if (!code) return rows;
  return rows.filter((row) => normalize(row.schoolCode) === normalize(code));
}

export function scopedStudentFees(user: SessionUser | null, state: BackOfficeState): StudentFee[] {
  const rows = state.studentFees ?? [];
  const code = scopedSchoolCode(user);
  if (!code) return rows;
  return rows.filter((row) => normalize(row.schoolCode) === normalize(code));
}

/** EXG-FRAIS-020 / EXG-FRAIS-021 — gestion des grilles tarifaires : Admin School uniquement (aligné backend). */
export function canManageFeeGrids(user: SessionUser | null): boolean {
  if (!user) return false;
  if (isSuperAdminRole(user.role)) return true;
  return isSchoolAdminRole(user.role);
}

export function canViewFeeGrids(user: SessionUser | null): boolean {
  if (!user) return false;
  if (isSuperAdminRole(user.role) || user.role === COUNTRY_ADMIN_ROLE) return true;
  const role = normalize(user.role);
  return canManageFeeGrids(user) || role === "secretaire" || role === "comptable";
}

export function canViewStudentFees(user: SessionUser | null): boolean {
  if (!user) return false;
  if (canViewFeeGrids(user)) return true;
  const role = normalize(user.role);
  return role === "parent" || role.includes("eleve") || role.includes("etudiant");
}

export function feeGridKey(grid: Pick<FeeGrid, "schoolCode" | "className" | "academicYear" | "periodName">): string {
  return [
    normalize(grid.schoolCode),
    normalize(grid.className),
    normalize(grid.academicYear),
    normalize(grid.periodName ?? ""),
  ].join("|");
}

export function findDuplicateFeeGrid(
  grids: FeeGrid[],
  candidate: Pick<FeeGrid, "schoolCode" | "className" | "academicYear" | "periodName" | "id">,
): FeeGrid | undefined {
  const key = feeGridKey(candidate);
  return grids.find((grid) => grid.id !== candidate.id && feeGridKey(grid) === key);
}

export interface FeeGridValidationResult {
  ok: boolean;
  error?: string;
}

/** EXG-FRAIS-001, EXG-FRAIS-024, EXG-FRAIS-025, EXG-FRAIS-026 */
export function validateFeeGridInput(
  grid: Partial<FeeGrid>,
  items: Partial<SchoolFeeItem>[],
  state: BackOfficeState,
): FeeGridValidationResult {
  const className = String(grid.className ?? "").trim();
  if (!className) {
    return { ok: false, error: "La classe est obligatoire pour créer une grille tarifaire." };
  }
  const schoolCode = String(grid.schoolCode ?? "").trim();
  if (!schoolCode) {
    return { ok: false, error: "Le compte établissement est obligatoire." };
  }
  const academicYear = String(grid.academicYear ?? "").trim();
  if (!academicYear) {
    return { ok: false, error: "L'année scolaire est obligatoire." };
  }
  const currency = String(grid.currency ?? "").trim();
  if (!currency) {
    return { ok: false, error: "La devise est obligatoire." };
  }
  const duplicate = findDuplicateFeeGrid(state.feeGrids ?? [], {
    id: grid.id ?? "",
    schoolCode,
    className,
    academicYear,
    periodName: grid.periodName,
  });
  if (duplicate) {
    return {
      ok: false,
      error: `Une grille existe déjà pour ${className}, ${academicYear}${grid.periodName ? ` (${grid.periodName})` : ""}.`,
    };
  }
  const activeItems = items.filter((item) => item.status !== "Désactivé");
  if (!activeItems.length) {
    return { ok: false, error: "Ajoutez au moins un frais (inscription, mensualité ou annexe)." };
  }
  for (const item of activeItems) {
    const amount = Number(item.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "Chaque montant doit être strictement positif." };
    }
    if (!String(item.label ?? "").trim()) {
      return { ok: false, error: "Chaque frais doit avoir un libellé." };
    }
    if (item.feeType === "Mensualité") {
      const months = item.monthlyMonths ?? [];
      if (!months.length) {
        return { ok: false, error: "Sélectionnez au moins un mois pour la mensualité." };
      }
    }
  }
  return { ok: true };
}

export function itemsForGrid(items: SchoolFeeItem[], feeGridId: string): SchoolFeeItem[] {
  return items.filter((item) => item.feeGridId === feeGridId && item.status === "Actif");
}

function studentDisplayName(student: Record<string, unknown>): string {
  const first = String(student.firstName ?? "").trim();
  const last = String(student.name ?? student.lastName ?? "").trim();
  return `${first} ${last}`.trim() || String(student.id ?? "Élève");
}

function studentFeeDedupeKey(
  studentId: string,
  schoolFeeItemId: string,
  periodLabel?: string,
): string {
  return `${studentId}|${schoolFeeItemId}|${normalize(periodLabel ?? "")}`;
}

function computeStudentFeeStatus(fee: Pick<StudentFee, "amountDue" | "amountPaid" | "dueDate" | "exemption">): StudentFeeStatus {
  if (fee.exemption >= fee.amountDue && fee.amountDue > 0) return "Exonéré";
  const balance = Math.max(0, Number(fee.amountDue) - Number(fee.amountPaid) - Number(fee.exemption));
  if (balance <= 0) return "Payé";
  if (fee.amountPaid > 0) return "Partiellement payé";
  if (fee.dueDate && isPeriodDateBefore(fee.dueDate)) return "En retard";
  return "À payer";
}

function buildStudentFeeFromItem(
  student: Record<string, unknown>,
  item: SchoolFeeItem,
  grid: FeeGrid,
  periodLabel?: string,
): StudentFee {
  const amount = Number(item.amount);
  const studentId = String(student.id ?? "");
  return {
    id: newFeeId("STUFEE"),
    studentId,
    studentName: studentDisplayName(student),
    schoolCode: grid.schoolCode,
    className: grid.className,
    schoolFeeItemId: item.id,
    feeGridId: grid.id,
    feeType: item.feeType,
    label: periodLabel ? `${item.label} — ${periodLabel}` : item.label,
    currency: grid.currency,
    academicYear: grid.academicYear,
    initialAmount: amount,
    discount: 0,
    exemption: 0,
    amountDue: amount,
    amountPaid: 0,
    balance: amount,
    status: computeStudentFeeStatus({ amountDue: amount, amountPaid: 0, exemption: 0, dueDate: item.dueDate }),
    dueDate: item.dueDate,
    periodLabel,
    createdAt: new Date().toISOString(),
  };
}

/** EXG-FRAIS-010, EXG-FRAIS-011 — génère les frais élève sans doublon. */
export function applyFeeGridToStudents(
  state: BackOfficeState,
  feeGridId: string,
  options: { studentIds?: string[]; schoolCode?: string } = {},
): { studentFees: StudentFee[]; created: number; skipped: number; message?: string } {
  const grid = (state.feeGrids ?? []).find((row) => row.id === feeGridId);
  if (!grid) {
    return { studentFees: state.studentFees ?? [], created: 0, skipped: 0, message: "Grille introuvable." };
  }
  if (grid.status !== "Active") {
    return {
      studentFees: state.studentFees ?? [],
      created: 0,
      skipped: 0,
      message: "Seule une grille active peut être appliquée aux élèves.",
    };
  }

  const items = itemsForGrid(state.schoolFeeItems ?? [], feeGridId);
  if (!items.length) {
    return {
      studentFees: state.studentFees ?? [],
      created: 0,
      skipped: 0,
      message: "Aucun frais actif dans cette grille.",
    };
  }

  const students = scopedStudents(null, state).filter((row) => {
    if (normalize(row.schoolCode) !== normalize(grid.schoolCode)) return false;
    if (normalize(String(row.className ?? "")) !== normalize(grid.className)) return false;
    if (options.studentIds?.length) {
      return options.studentIds.includes(String(row.id ?? ""));
    }
    return true;
  });

  const existing = state.studentFees ?? [];
  const existingKeys = new Set(
    existing.map((fee) => studentFeeDedupeKey(fee.studentId, fee.schoolFeeItemId, fee.periodLabel)),
  );
  const toAdd: StudentFee[] = [];
  let skipped = 0;

  for (const student of students) {
    for (const item of items) {
      if (item.feeType === "Mensualité") {
        const months = item.monthlyMonths?.length ? item.monthlyMonths : DEFAULT_MONTHLY_MONTHS;
        for (const month of months) {
          const key = studentFeeDedupeKey(String(student.id ?? ""), item.id, month);
          if (existingKeys.has(key)) {
            skipped += 1;
            continue;
          }
          const fee = buildStudentFeeFromItem(student, item, grid, month);
          toAdd.push(fee);
          existingKeys.add(key);
        }
        continue;
      }
      const key = studentFeeDedupeKey(String(student.id ?? ""), item.id);
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      const fee = buildStudentFeeFromItem(student, item, grid);
      toAdd.push(fee);
      existingKeys.add(key);
    }
  }

  return {
    studentFees: [...existing, ...toAdd],
    created: toAdd.length,
    skipped,
    message:
      toAdd.length === 0
        ? "Aucun nouveau frais généré : les dettes existent déjà pour ces élèves."
        : undefined,
  };
}

/** EXG-FRAIS-011 — à l'inscription d'un nouvel élève. */
export function applyActiveGridsToStudent(
  state: BackOfficeState,
  student: Record<string, unknown>,
): StudentFee[] {
  const schoolCode = String(student.schoolCode ?? "").trim();
  const className = String(student.className ?? "").trim();
  if (!schoolCode || !className || !student.id) return state.studentFees ?? [];

  const activeGrids = (state.feeGrids ?? []).filter(
    (grid) =>
      grid.status === "Active" &&
      normalize(grid.schoolCode) === normalize(schoolCode) &&
      normalize(grid.className) === normalize(className),
  );

  let nextFees = state.studentFees ?? [];
  for (const grid of activeGrids) {
    const result = applyFeeGridToStudents(
      { ...state, studentFees: nextFees },
      grid.id,
      { studentIds: [String(student.id)] },
    );
    nextFees = result.studentFees;
  }
  return nextFees;
}

export function refreshStudentFeeStatuses(fees: StudentFee[], now = new Date()): StudentFee[] {
  return fees.map((fee) => {
    const balance = Math.max(0, fee.amountDue - fee.amountPaid - fee.exemption);
    const status = computeStudentFeeStatus({
      amountDue: fee.amountDue,
      amountPaid: fee.amountPaid,
      exemption: fee.exemption,
      dueDate: fee.dueDate,
    });
    const isLate =
      status !== "Payé" &&
      status !== "Exonéré" &&
      fee.dueDate &&
      parsePeriodDate(fee.dueDate) &&
      isPeriodDateBefore(fee.dueDate, now) &&
      balance > 0;
    return {
      ...fee,
      balance,
      status: isLate && status === "À payer" ? "En retard" : status,
    };
  });
}

export function recordTariffHistory(
  history: FeeTariffHistory[],
  entry: Omit<FeeTariffHistory, "id" | "changedAt">,
): FeeTariffHistory[] {
  return [
    {
      ...entry,
      id: newFeeId("FEEHIST"),
      changedAt: new Date().toISOString(),
    },
    ...history,
  ].slice(0, 500);
}

export function studentFeeSummary(fees: StudentFee[]) {
  const active = fees.filter((fee) => fee.status !== "Annulé");
  const totalDue = active.reduce((sum, fee) => sum + fee.amountDue, 0);
  const totalPaid = active.reduce((sum, fee) => sum + fee.amountPaid, 0);
  const totalBalance = active.reduce((sum, fee) => sum + fee.balance, 0);
  const overdue = active.filter((fee) => fee.status === "En retard").length;
  return { totalDue, totalPaid, totalBalance, overdue, count: active.length };
}

export function classOptionsForSchool(state: BackOfficeState, schoolCode: string): string[] {
  const { classNames } = getSchoolAcademicLists(state, schoolCode);
  const fromStudents = new Set(
    scopedStudents(null, state)
      .filter((row) => normalize(row.schoolCode) === normalize(schoolCode))
      .map((row) => String(row.className ?? "").trim())
      .filter(Boolean),
  );
  return [...new Set([...classNames, ...fromStudents])].sort((a, b) => a.localeCompare(b, "fr"));
}

export type SchoolClassChoice = {
  classId: string;
  classCode: string;
  className: string;
};

/** Identité canonique de classe pour une grille tarifaire. className n'est qu'un libellé. */
export function classChoicesForSchool(state: BackOfficeState, schoolCode: string): SchoolClassChoice[] {
  const rows = ((state.classes ?? []) as Record<string, unknown>[]).filter((row) => {
    const code = String(row.schoolCode ?? "").trim();
    if (schoolCode && code && normalize(code) !== normalize(schoolCode)) return false;
    const status = normalize(String(row.status ?? ""));
    return status !== "archivee" && status !== "inactive" && status !== "inactivee";
  });
  const choices: SchoolClassChoice[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const classId = String(row.id ?? row.classId ?? "").trim();
    if (!classId || seen.has(classId)) continue;
    seen.add(classId);
    choices.push({
      classId,
      classCode: String(row.classCode ?? row.code ?? "").trim(),
      className: String(row.name ?? row.className ?? "").trim() || classId,
    });
  }
  return choices.sort((a, b) => a.className.localeCompare(b.className, "fr"));
}

export function isGridEditable(grid: FeeGrid): boolean {
  return grid.status === "Brouillon" || grid.status === "Active";
}

export function feeItemHasGeneratedDebts(itemId: string, studentFees: StudentFee[]): boolean {
  return studentFees.some((fee) => fee.schoolFeeItemId === itemId);
}
