import type { SessionUser } from "../../types";
import type { BackOfficeState } from "../../types";
import {
  getSchoolAcademicLists,
  getSubjectsForClass,
  mergeSelectOptions,
} from "../../lib/academicConfig";
import type { AssignmentSelectOptions } from "../../lib/assignments";
import {
  filterSchoolClassRecords,
  getAvailableClassNameOptions,
} from "../../lib/classRules";
import { getContactAccountOptions, getContactRoleOptions } from "../../lib/contacts";
import type { EntityField, EntityModuleConfig } from "../../lib/entityModules";
import { getSchoolPeriodNames } from "../../lib/evaluations";
import { scopedTeachers } from "../../lib/establishment";
import { normalize } from "../../lib/format";
import { getTeacherDisplayName } from "../../lib/pedagogySync";
import {
  getRelationParentUserOptions,
  getRelationStudentOptions,
} from "../../lib/relations";

export type EntitySelectOption = { value: string; label: string };

export type AcademicLists = ReturnType<typeof getSchoolAcademicLists>;

/**
 * Dépendances injectées pour résoudre les options de select EntityPage (D2.8b).
 * Aucun hook / contexte React.
 */
export interface ResolveEntitySelectOptionsContext {
  module: EntityModuleConfig | null | undefined;
  field: EntityField;
  academicLists: AcademicLists;
  assignmentOptions: AssignmentSelectOptions | null;
  schoolCode: string | undefined;
  effectiveSchoolCode: string;
  editing: Record<string, unknown> | null;
  state: BackOfficeState;
  scopeUser: SessionUser | null;
}

/**
 * Résolution des options d’un champ select du formulaire EntityPage.
 * Parité comportementale avec l’ancienne `getSelectOptionsForField` inline.
 */
export function resolveEntitySelectOptions(
  ctx: ResolveEntitySelectOptionsContext,
): EntitySelectOption[] {
  const {
    module,
    field,
    academicLists,
    assignmentOptions,
    schoolCode,
    effectiveSchoolCode,
    editing,
    state,
    scopeUser,
  } = ctx;

  if (field.selectOptions?.length) {
    return field.selectOptions;
  }
  if (field.optionsKey === "levels") {
    return academicLists.levels.map((option) => ({ value: option, label: option }));
  }
  if (field.optionsKey === "tracks") {
    return academicLists.tracks.map((option) => ({ value: option, label: option }));
  }
  if (field.optionsKey === "classNames") {
    if (module?.key === "classes") {
      const existing = filterSchoolClassRecords(
        (state.classes ?? []) as Record<string, unknown>[],
        schoolCode,
      );
      return getAvailableClassNameOptions(
        academicLists.classNames,
        existing,
        String(editing?.name ?? ""),
      ).map((option) => ({ value: option, label: option }));
    }
    const extra =
      module?.key === "assignments"
        ? (assignmentOptions?.classes ?? []).map((option) => option.value)
        : [];
    // CLASSE-003 : une classe archivée n'est plus proposée aux nouvelles inscriptions.
    const archivedClassNames = new Set(
      ((state.classes ?? []) as Record<string, unknown>[])
        .filter((cls) => normalize(String(cls.status ?? "")) === normalize("Archivée"))
        .map((cls) => normalize(String(cls.name ?? cls.className ?? ""))),
    );
    const currentValue = normalize(String(editing?.className ?? ""));
    return mergeSelectOptions(academicLists.classNames, extra)
      .filter(
        (option) =>
          !archivedClassNames.has(normalize(option)) || normalize(option) === currentValue,
      )
      .map((option) => ({
        value: option,
        label: option,
      }));
  }
  if (field.optionsKey === "subjects") {
    const className = String(editing?.className ?? "");
    const classScopedModules = module?.key === "courses" || module?.key === "assignments";
    if (classScopedModules) {
      if (!className) return [];
      const configured = getSubjectsForClass(state, schoolCode, className);
      const extra =
        module?.key === "assignments"
          ? (assignmentOptions?.subjects ?? []).map((option) => option.value)
          : [];
      return mergeSelectOptions(configured, extra).map((option) => ({
        value: option,
        label: option,
      }));
    }
    return academicLists.subjects.map((option) => ({ value: option, label: option }));
  }
  if (field.optionsKey === "teachers") {
    const teacherOptions =
      module?.key === "courses"
        ? scopedTeachers(scopeUser, state).map((teacher) => ({
            value: getTeacherDisplayName(teacher),
            label: getTeacherDisplayName(teacher),
          }))
        : (assignmentOptions?.teachers ?? []);
    return teacherOptions;
  }
  if (field.optionsKey === "classes") {
    return assignmentOptions?.classes ?? [];
  }
  if (field.optionsKey === "assignmentSubjects") {
    return assignmentOptions?.subjects ?? [];
  }
  if (field.optionsKey === "periods") {
    return getSchoolPeriodNames(state, effectiveSchoolCode).map((name) => ({
      value: name,
      label: name,
    }));
  }
  if (field.optionsKey === "accounts") {
    return getContactAccountOptions(scopeUser, state);
  }
  if (field.optionsKey === "userRoles") {
    const accountCode = String(editing?.schoolCode ?? schoolCode ?? "");
    return getContactRoleOptions(state, accountCode);
  }
  if (field.optionsKey === "relationParents" || field.optionsKey === "relationContacts") {
    return getRelationParentUserOptions(scopeUser, state);
  }
  if (field.optionsKey === "relationStudents") {
    return getRelationStudentOptions(scopeUser, state);
  }
  return [];
}

export interface ResolveTeacherAssignmentFieldOptionsContext {
  field: EntityField;
  teacherAssignmentOptions: AssignmentSelectOptions | null;
  state: BackOfficeState;
  effectiveSchoolCode: string;
}

/**
 * Options des champs de la modale d’affectation enseignant.
 * Parité avec l’ancienne `getTeacherAssignmentFieldOptions` inline.
 */
export function resolveTeacherAssignmentFieldOptions(
  ctx: ResolveTeacherAssignmentFieldOptionsContext,
): EntitySelectOption[] {
  const { field, teacherAssignmentOptions, state, effectiveSchoolCode } = ctx;
  if (field.optionsKey === "classes") {
    return teacherAssignmentOptions?.classes ?? [];
  }
  if (field.optionsKey === "assignmentSubjects") {
    return teacherAssignmentOptions?.subjects ?? [];
  }
  if (field.optionsKey === "periods") {
    return getSchoolPeriodNames(state, effectiveSchoolCode).map((name) => ({
      value: name,
      label: name,
    }));
  }
  return field.selectOptions ?? [];
}
