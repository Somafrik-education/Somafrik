import type { BackOfficeState } from "../types";
import { api } from "../api/client";

export async function syncResidualBackOfficePatch(
  patch: Partial<BackOfficeState>,
  schoolCode: string,
): Promise<void> {
  const scopedSchool = String(schoolCode ?? "").trim().toUpperCase();
  if (!scopedSchool || scopedSchool === "*") {
    throw new Error("schoolCode établissement requis pour la synchronisation.");
  }

  if (patch.academicConfigs && typeof patch.academicConfigs === "object") {
    for (const [code, config] of Object.entries(patch.academicConfigs)) {
      await api.put("/academic-config", {
        ...(config as Record<string, unknown>),
        schoolCode: code,
      });
    }
  }

  if (Array.isArray(patch.exams)) {
    await api.put("/backoffice/planning-exams", { schoolCode: scopedSchool, exams: patch.exams });
  }

  if (Array.isArray(patch.bulletins)) {
    await api.put("/backoffice/report-cards", { schoolCode: scopedSchool, bulletins: patch.bulletins });
  }

  if (Array.isArray(patch.documents)) {
    await api.put("/backoffice/establishment-documents", {
      schoolCode: scopedSchool,
      documents: patch.documents,
    });
  }
}

export function extractResidualPatch(patch: Partial<BackOfficeState>): Partial<BackOfficeState> {
  const residual: Partial<BackOfficeState> = {};
  if (patch.academicConfigs) residual.academicConfigs = patch.academicConfigs;
  if (patch.exams) residual.exams = patch.exams;
  if (patch.bulletins) residual.bulletins = patch.bulletins;
  if (patch.documents) residual.documents = patch.documents;
  return residual;
}

export function hasResidualPatch(patch: Partial<BackOfficeState>): boolean {
  return Object.keys(extractResidualPatch(patch)).length > 0;
}
