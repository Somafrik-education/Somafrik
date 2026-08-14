import type { BackOfficeState } from "../types";
import { api } from "../api/client";
import { normalize } from "./format";

export async function syncResidualBackOfficePatch(
  patch: Partial<BackOfficeState>,
  schoolCode: string,
): Promise<void> {
  const scopedSchool = String(schoolCode ?? "").trim().toUpperCase();
  if (!scopedSchool || scopedSchool === "*") {
    throw new Error("Sélectionnez un établissement actif avant d'enregistrer la configuration.");
  }

  if (patch.academicConfigs && typeof patch.academicConfigs === "object") {
    const entries = Object.entries(patch.academicConfigs);
    const scopedEntries = entries.filter(([code]) => normalize(code) === normalize(scopedSchool));
    const foreignEntries = entries.filter(([code]) => normalize(code) !== normalize(scopedSchool));

    if (foreignEntries.length) {
      throw new Error(
        `Configuration hors périmètre : ${foreignEntries.map(([code]) => code).join(", ")}.`,
      );
    }

    if (scopedEntries.length > 1) {
      throw new Error("Une seule configuration établissement peut être synchronisée à la fois.");
    }

    if (scopedEntries.length === 1) {
      const [, config] = scopedEntries[0];
      const payload = { ...((config && typeof config === "object" ? config : {}) as Record<string, unknown>) };
      delete payload.evaluationTypes;
      delete payload.levels;
      delete payload.tracks;
      delete payload.userRoles;
      delete payload.schoolId;
      delete payload.schoolCode;
      delete payload.countryCode;
      await api.put(
        `/backoffice/establishments/${encodeURIComponent(scopedSchool)}/academic-config`,
        payload,
      );
    }
  }

  if (Array.isArray(patch.exams)) {
    await api.put("/backoffice/planning-exams", { exams: patch.exams });
  }

  if (Array.isArray(patch.bulletins)) {
    await api.put("/backoffice/report-cards", { bulletins: patch.bulletins });
  }

  if (Array.isArray(patch.documents)) {
    await api.put("/backoffice/establishment-documents", { documents: patch.documents });
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
