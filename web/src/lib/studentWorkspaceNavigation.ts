import {
  STUDENT_WORKSPACE_MODULES,
  type StudentWorkspaceModule,
  type StudentWorkspaceModuleId,
} from "./studentWorkspace";

/**
 * Slugs d'URL du dossier élève (C1).
 * La présence d'une entrée définit les modules navigables ;
 * l'ordre d'affichage reste celui de STUDENT_WORKSPACE_MODULES.
 */
export const STUDENT_WORKSPACE_SECTION_SLUGS: Readonly<
  Partial<Record<StudentWorkspaceModuleId, string>>
> = {
  overview: "",
  identity: "identite",
  enrollments: "inscription",
  guardians: "responsables",
  health: "medical",
  documents: "documents",
  history: "historique",
};

const SLUG_TO_MODULE_ID = new Map<string, StudentWorkspaceModuleId>(
  Object.entries(STUDENT_WORKSPACE_SECTION_SLUGS).map(([moduleId, slug]) => [
    slug,
    moduleId as StudentWorkspaceModuleId,
  ]),
);

export function getStudentWorkspaceNavigationModules(): readonly StudentWorkspaceModule[] {
  return STUDENT_WORKSPACE_MODULES.filter(
    (module) => module.id in STUDENT_WORKSPACE_SECTION_SLUGS,
  );
}

export function getStudentWorkspaceSectionSlug(
  moduleId: StudentWorkspaceModuleId,
): string | null {
  if (!(moduleId in STUDENT_WORKSPACE_SECTION_SLUGS)) {
    return null;
  }
  return STUDENT_WORKSPACE_SECTION_SLUGS[moduleId] ?? "";
}

export function buildStudentWorkspacePath(
  studentId: string,
  moduleId: StudentWorkspaceModuleId = "overview",
): string {
  const normalizedStudentId = studentId.trim();
  const base = `/etablissement/eleves/${encodeURIComponent(normalizedStudentId)}`;
  const slug = getStudentWorkspaceSectionSlug(moduleId);

  if (slug === null) {
    return base;
  }

  return slug ? `${base}/${slug}` : base;
}

export function resolveStudentWorkspaceModuleIdFromSection(
  section: string | undefined | null,
): StudentWorkspaceModuleId | null {
  const normalizedSection = String(section ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();

  if (!normalizedSection) {
    return "overview";
  }

  return SLUG_TO_MODULE_ID.get(normalizedSection) ?? null;
}

export function isStudentWorkspaceModuleImplemented(
  moduleId: StudentWorkspaceModuleId,
): boolean {
  return (
    moduleId === "overview" ||
    moduleId === "identity" ||
    moduleId === "enrollments" ||
    moduleId === "guardians" ||
    moduleId === "health" ||
    moduleId === "documents"
  );
}
