import type { AuditEntry } from "./audit";
import { makeAuditEntry, auditActor } from "./audit";
import type { BackOfficeState, FeeGrid, SchoolFeeItem, SessionUser } from "../types";
import {
  DEFAULT_MONTHLY_MONTHS,
  findDuplicateFeeGrid,
  newFeeId,
  resolveAcademicYear,
  resolveSchoolCurrency,
} from "./fees";
import { scopedStudents } from "./establishment";
import { normalize } from "./format";

export interface QuickFeeGridInput {
  schoolCode: string;
  academicYear: string;
  currency: string;
  classNames: string[];
  selectedClasses?: Array<{ classId: string; classCode: string; className: string }>;
  periodName?: string;
  activateImmediately: boolean;
  applyToStudents: boolean;
  inscriptionAmount?: number;
  monthlyAmount?: number;
  annexLabel?: string;
  annexAmount?: number;
}

export interface QuickFeeGridBuildResult {
  grids: FeeGrid[];
  items: SchoolFeeItem[];
  skippedClasses: Array<{ className: string; reason: string }>;
  auditEntries: AuditEntry[];
}

export function countStudentsInClass(
  state: BackOfficeState,
  schoolCode: string,
  className: string,
): number {
  return scopedStudents(null, state).filter(
    (student) =>
      normalize(String(student.schoolCode ?? "")) === normalize(schoolCode) &&
      normalize(String(student.className ?? "")) === normalize(className),
  ).length;
}

function buildItemsForGrid(
  grid: FeeGrid,
  input: QuickFeeGridInput,
): SchoolFeeItem[] {
  const items: SchoolFeeItem[] = [];
  const inscription = Number(input.inscriptionAmount ?? 0);
  const monthly = Number(input.monthlyAmount ?? 0);
  const annex = Number(input.annexAmount ?? 0);

  if (inscription > 0) {
    items.push({
      id: newFeeId("FEEITEM"),
      feeGridId: grid.id,
      schoolCode: grid.schoolCode,
      className: grid.className,
      feeType: "Inscription",
      label: "Frais d'inscription",
      amount: inscription,
      mandatory: true,
      status: "Actif",
    });
  }

  if (monthly > 0) {
    items.push({
      id: newFeeId("FEEITEM"),
      feeGridId: grid.id,
      schoolCode: grid.schoolCode,
      className: grid.className,
      feeType: "Scolarité",
      label: "Scolarité",
      amount: monthly,
      mandatory: true,
      monthlyMonths: [...DEFAULT_MONTHLY_MONTHS],
      status: "Actif",
    });
  }

  if (annex > 0) {
    items.push({
      id: newFeeId("FEEITEM"),
      feeGridId: grid.id,
      schoolCode: grid.schoolCode,
      className: grid.className,
      feeType: "Autre",
      label: String(input.annexLabel ?? "").trim() || "Autre",
      amount: annex,
      mandatory: false,
      status: "Actif",
    });
  }

  return items;
}

export function buildQuickFeeGrids(
  input: QuickFeeGridInput,
  state: BackOfficeState,
  user: SessionUser | null,
): QuickFeeGridBuildResult {
  const grids: FeeGrid[] = [];
  const items: SchoolFeeItem[] = [];
  const skippedClasses: Array<{ className: string; reason: string }> = [];
  const auditEntries: AuditEntry[] = [];
  const now = new Date().toISOString();
  const createdBy = user?.identifier ?? user?.firstName ?? "Système";
  const existingGrids = state.feeGrids ?? [];

  const hasAmount =
    Number(input.inscriptionAmount ?? 0) > 0 ||
    Number(input.monthlyAmount ?? 0) > 0 ||
    Number(input.annexAmount ?? 0) > 0;

  if (!hasAmount) {
    return { grids, items, skippedClasses, auditEntries };
  }

  for (const choice of input.selectedClasses?.length
    ? input.selectedClasses
    : input.classNames.map((className) => ({ classId: "", classCode: "", className }))) {
    const trimmedClass = choice.className.trim();
    if (!trimmedClass) continue;

    const candidate: FeeGrid = {
      id: newFeeId("FEEGRID"),
      schoolCode: input.schoolCode,
      academicYear: input.academicYear,
      classId: choice.classId || undefined,
      classCode: choice.classCode || undefined,
      className: trimmedClass,
      currency: input.currency,
      status: input.activateImmediately ? "Active" : "Brouillon",
      periodName: input.periodName?.trim() || undefined,
      createdBy,
      createdAt: now,
    };

    const duplicate = findDuplicateFeeGrid(existingGrids, candidate);
    if (duplicate) {
      skippedClasses.push({
        className: trimmedClass,
        reason: `Grille déjà existante (${duplicate.status})`,
      });
      continue;
    }

    const gridItems = buildItemsForGrid(candidate, input);
    if (!gridItems.length) {
      skippedClasses.push({ className: trimmedClass, reason: "Aucun montant valide" });
      continue;
    }

    grids.push(candidate);
    items.push(...gridItems);
    existingGrids.push(candidate);

    auditEntries.push(
      makeAuditEntry({
        ...auditActor(user),
        action: "fee.grid.quick_create",
        entityType: "fee_grid",
        entityId: candidate.id,
        entityLabel: `${trimmedClass} · ${input.academicYear}`,
        schoolCode: input.schoolCode,
        details: `${gridItems.length} ligne(s) de frais`,
      }),
    );
  }

  return { grids, items, skippedClasses, auditEntries };
}

export function validateQuickFeeGridInput(input: QuickFeeGridInput): string | null {
  if (!input.schoolCode?.trim()) return "Établissement requis";
  if (!input.classNames.length && !input.selectedClasses?.length) return "Sélectionnez au moins une classe";
  if (!input.academicYear?.trim()) return "Année scolaire requise";
  if (!input.currency?.trim()) return "Devise requise";

  const hasAmount =
    Number(input.inscriptionAmount ?? 0) > 0 ||
    Number(input.monthlyAmount ?? 0) > 0 ||
    Number(input.annexAmount ?? 0) > 0;
  if (!hasAmount) return "Saisissez au moins un montant (inscription, scolarité ou autre)";

  for (const key of ["inscriptionAmount", "monthlyAmount", "annexAmount"] as const) {
    const value = Number(input[key] ?? 0);
    if (input[key] != null && input[key] !== 0 && (!Number.isFinite(value) || value < 0)) {
      return "Les montants doivent être positifs";
    }
  }

  if (Number(input.annexAmount ?? 0) > 0 && !String(input.annexLabel ?? "").trim()) {
    return "Indiquez un libellé pour le frais annexe";
  }

  return null;
}

export function defaultQuickFeeGridInput(
  state: BackOfficeState,
  schoolCode: string,
): QuickFeeGridInput {
  return {
    schoolCode,
    academicYear: resolveAcademicYear(state, schoolCode),
    currency: resolveSchoolCurrency(state, schoolCode),
    classNames: [],
    selectedClasses: [],
    activateImmediately: true,
    applyToStudents: true,
    inscriptionAmount: 50_000,
    monthlyAmount: 10_000,
    annexLabel: "",
    annexAmount: 0,
  };
}

export const QUICK_FEE_AMOUNT_SHORTCUTS = [5_000, 10_000, 25_000, 50_000, 100_000] as const;
