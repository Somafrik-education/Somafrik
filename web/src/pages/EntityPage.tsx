import { useMemo, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PrintButton } from "../components/ui/PrintButton";
import { Table, type Column } from "../components/ui/Table";
import { Modal } from "../components/ui/Modal";
import { Field, Input, Select } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { useFeaturePermissions } from "../lib/usePermissionContext";
import {
  applySchoolScopeToItem,
  deleteScopedEntityRow,
  getEntityModule,
  getScopedEntityRows,
  mergeScopedEntityRows,
  type SchoolEntityKey,
} from "../lib/entityModules";
import {
  getAssignmentSelectOptions,
  normalizeAssignmentForm,
  prepareAssignmentForSave,
  validateAssignmentConflict,
} from "../lib/assignments";
import { validateCourseTeacherRule } from "../lib/pedagogyGovernance";
import {
  getCurrentSchool,
  scopedClasses,
  scopedCourses,
  scopedStudents,
  scopedTeachers,
} from "../lib/establishment";
import {
  syncAssignmentPedagogy,
  syncCoursePedagogy,
  syncTeacherPedagogy,
  getTeacherDisplayName,
  findTeacherByName,
} from "../lib/pedagogySync";
import type { BackOfficeState, SessionUser } from "../types";
import { getSchoolAcademicLists, getSubjectsForClass, mergeSelectOptions } from "../lib/academicConfig";
import {
  generateTeacherIdentifiers,
  getTeacherLoginIdentifier,
  resolveTeacherIdentifiers,
} from "../lib/entityIdentifiers";
import {
  filterSchoolClassRecords,
  getAvailableClassNameOptions,
  removeSchoolClassFromState,
  validateUniqueClassName,
} from "../lib/classRules";

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}`;
}

const STUDENT_LINKED_KEYS = new Set<SchoolEntityKey>([
  "payments",
  "presences",
  "notes",
  "messages",
  "bulletins",
  "documents",
]);

function linkStudentFromName(
  key: SchoolEntityKey,
  item: Record<string, unknown>,
  user: SessionUser | null,
  state: BackOfficeState,
): Record<string, unknown> {
  if (!STUDENT_LINKED_KEYS.has(key) || item.studentId) return item;
  const studentName = String(item.studentName ?? "").trim().toLowerCase();
  if (!studentName) return item;
  const student = scopedStudents(user, state).find(
    (row) => String(row.name ?? "").trim().toLowerCase() === studentName,
  );
  if (!student?.id) return item;
  return {
    ...item,
    studentId: student.id,
    className: item.className ?? student.className,
  };
}

interface EntityPageProps {
  entity: SchoolEntityKey;
}

export function EntityPage({ entity }: EntityPageProps) {
  const module = getEntityModule(entity);
  const { session } = useAuth();
  const { state, update } = useData();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const { activeSchoolCode: schoolCode, scopedUser } = useActiveSchool();
  const scopeUser = scopedUser ?? session?.user ?? null;

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const { canRead, canCreate, canUpdate, canDelete } = useFeaturePermissions(module?.feature ?? "Élèves");
  const allowCreate = canCreate && !module?.planningManaged;
  const allowDelete = canDelete && !module?.planningManaged;
  const academicLists = useMemo(
    () => getSchoolAcademicLists(state, schoolCode),
    [state, schoolCode],
  );
  const assignmentOptions = useMemo(
    () =>
      module?.key === "assignments"
        ? getAssignmentSelectOptions(scopeUser, state, String(editing?.className ?? ""), schoolCode)
        : null,
    [module?.key, scopeUser, state, editing?.className, schoolCode],
  );

  function getSelectOptionsForField(field: NonNullable<typeof module>["fields"][number]) {
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
      return mergeSelectOptions(academicLists.classNames, extra).map((option) => ({
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
    return [];
  }

  const school = getCurrentSchool(scopeUser, state);

  const rows = useMemo(() => {
    if (!module) return [];
    const scoped = getScopedEntityRows(module.key, scopeUser, state);
    const q = search.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((row) =>
      Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(q)),
    );
  }, [module, search, scopeUser, state]);

  if (!module) {
    return <Navigate to="/etablissement" replace />;
  }

  if (!canRead) {
    return (
      <Card className="p-6">
        <p className="text-sm font-semibold text-muted">
          Vous n'avez pas l'autorisation de consulter {module.label.toLowerCase()}.
        </p>
      </Card>
    );
  }

  async function persistPatch(patch: Partial<BackOfficeState>, message: string) {
    setBusy(true);
    try {
      await update(patch);
      showToast(message, "success");
    } catch {
      showToast("Échec de la synchronisation", "error");
      throw new Error("sync failed");
    } finally {
      setBusy(false);
    }
  }

  function buildPedagogyPatch(
    key: SchoolEntityKey,
    nextItem: Record<string, unknown>,
    nextEntityRows: Record<string, unknown>[],
  ): Partial<BackOfficeState> {
    const baseState: BackOfficeState = {
      ...state,
      [key]: nextEntityRows,
    };

    if (key === "teachers") {
      const synced = syncTeacherPedagogy(baseState, nextItem, schoolCode);
      return {
        teachers: nextEntityRows.map((row) =>
          String(row.id) === String(synced.teacher.id) ? synced.teacher : row,
        ),
        courses: synced.courses,
        assignments: synced.assignments,
      };
    }

    if (key === "courses") {
      const synced = syncCoursePedagogy(
        { ...baseState, courses: nextEntityRows },
        nextItem,
        schoolCode,
      );
      return {
        courses: synced.courses,
        assignments: synced.assignments,
        teachers: synced.teachers,
      };
    }

    if (key === "assignments") {
      const synced = syncAssignmentPedagogy(
        { ...baseState, assignments: nextEntityRows },
        nextItem,
        schoolCode,
      );
      return {
        assignments: synced.assignments,
        courses: synced.courses,
        teachers: synced.teachers,
      };
    }

    return { [key]: nextEntityRows };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editing || !module) return;

    if (module.planningManaged && !editing.id) {
      showToast("La planification se fait uniquement depuis Planning de cours.", "error");
      return;
    }

    let workingItem = { ...editing };

    if (module.planningManaged && editing.id) {
      const currentRows = getScopedEntityRows(module.key, scopeUser, state);
      const original = currentRows.find((row) => String(row.id) === String(editing.id));
      if (!original) {
        showToast("Élément introuvable.", "error");
        return;
      }
      workingItem = { ...original };
      for (const field of module.fields) {
        if (!field.readOnly) {
          workingItem[field.key] = editing[field.key];
        }
      }
    }

    const missingRequired = module.fields.find(
      (field) => field.required && !field.readOnly && !String(workingItem[field.key] ?? "").trim(),
    );
    if (missingRequired) {
      showToast(`${missingRequired.label} est obligatoire`, "error");
      return;
    }

    if (module.key === "courses") {
      const teachers = scopedTeachers(scopeUser, state);
      const teacherName = String(workingItem.teacherName ?? "").trim();
      const teacher = findTeacherByName(teachers, teacherName);
      workingItem = {
        ...workingItem,
        teacherName: teacher ? getTeacherDisplayName(teacher) : teacherName,
        teacherId: String(teacher?.id ?? workingItem.teacherId ?? ""),
      };
      const courseConflict = validateCourseTeacherRule(
        workingItem,
        getScopedEntityRows("courses", scopeUser, state),
        getScopedEntityRows("assignments", scopeUser, state),
        editing.id ? String(editing.id) : undefined,
      );
      if (courseConflict) {
        showToast(courseConflict, "error");
        return;
      }
    }

    if (module.key === "assignments") {
      const teachers = scopedTeachers(scopeUser, state);
      workingItem = prepareAssignmentForSave(workingItem, teachers, schoolCode);
      const scopedAssignments = getScopedEntityRows("assignments", scopeUser, state);
      const conflict = validateAssignmentConflict(
        workingItem,
        scopedAssignments,
        scopedCourses(scopeUser, state),
        scopedClasses(scopeUser, state),
        teachers,
        editing.id ? String(editing.id) : undefined,
        state,
        schoolCode,
      );
      if (conflict) {
        showToast(conflict, "error");
        return;
      }
    }

    if (module.key === "classes") {
      const classConflict = validateUniqueClassName(
        String(workingItem.name ?? ""),
        filterSchoolClassRecords((state.classes ?? []) as Record<string, unknown>[], schoolCode),
        editing.id ? String(editing.id) : undefined,
      );
      if (classConflict) {
        showToast(classConflict, "error");
        return;
      }
    }

    const scopedItem = applySchoolScopeToItem(module.key, workingItem, schoolCode, state);
    const linkedItem = linkStudentFromName(module.key, scopedItem, scopeUser, state);
    const current = getScopedEntityRows(module.key, scopeUser, state);
    const exists = Boolean(linkedItem.id) && current.some((row) => row.id === linkedItem.id);

    if (exists && !canUpdate) {
      showToast(
        module.key === "teachers"
          ? "Modification des enseignants réservée au préfet des études ou à un rôle habilité."
          : "Modification non autorisée pour votre rôle.",
        "error",
      );
      return;
    }

    if (!exists && !canCreate) {
      showToast("Création non autorisée pour votre rôle.", "error");
      return;
    }

    let preparedItem = { ...linkedItem };

    if (module.key === "teachers") {
      const code = String(schoolCode ?? preparedItem.schoolCode ?? "").trim();
      if (!code || code === "*") {
        showToast("Code établissement requis pour générer l'identifiant enseignant", "error");
        return;
      }
      preparedItem = {
        ...preparedItem,
        ...resolveTeacherIdentifiers(
          preparedItem,
          code,
          (state.teachers ?? []) as Record<string, unknown>[],
        ),
      };
    }

    const nextItem = exists
      ? preparedItem
      : (() => {
          const id = String(preparedItem.id ?? newId(module.key.toUpperCase()));
          return {
            ...preparedItem,
            id,
            ...(module.key === "students"
              ? {
                  matricule: preparedItem.matricule ?? preparedItem.publicId ?? id,
                  archived: preparedItem.archived ?? false,
                }
              : {}),
          };
        })();

    const nextAllRows = mergeScopedEntityRows(module.key, scopeUser, state, nextItem);
    const patch = buildPedagogyPatch(module.key, nextItem, nextAllRows);

    try {
      await persistPatch(patch, exists ? `${module.label} modifié` : `${module.label} créé`);
      setEditing(null);
    } catch {
      /* toast déjà affiché */
    }
  }

  async function handleDelete(row: Record<string, unknown>) {
    if (!module || !row.id) return;
    if (module.planningManaged) {
      showToast("Supprimez la session depuis Planning de cours.", "error");
      return;
    }
    const confirmed = await confirm({
      title: `Supprimer cet élément ?`,
      description: `Retirer définitivement cet enregistrement de ${module.label.toLowerCase()} ?`,
      confirmLabel: "Supprimer",
      tone: "danger",
    });
    if (!confirmed) return;

    if (module.key === "classes") {
      const result = removeSchoolClassFromState(state, row, schoolCode);
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      try {
        await persistPatch(result.patch, "Classe supprimée");
      } catch {
        /* toast déjà affiché */
      }
      return;
    }

    const nextAllRows = deleteScopedEntityRow(
      module.key,
      scopeUser,
      state,
      String(row.id),
    );
    if (nextAllRows.length === ((state[module.key] ?? []) as unknown[]).length) {
      showToast("Suppression refusée : élément hors périmètre ou introuvable.", "error");
      return;
    }
    try {
      await persistPatch({ [module.key]: nextAllRows }, "Élément supprimé");
    } catch {
      /* toast déjà affiché */
    }
  }

  const columns: Column<Record<string, unknown>>[] = [
    ...module.columns.map((key) => ({
      key,
      header: module.columnLabels?.[key] ?? module.fields.find((field) => field.key === key)?.label ?? key,
      render: (row: Record<string, unknown>) => {
        if (module.key === "teachers" && key === "publicId") {
          const publicId = String(row.publicId ?? "").trim();
          if (!publicId) return "—";
          return `${publicId} · connexion : ${getTeacherLoginIdentifier(publicId)}`;
        }
        return String(row[key] ?? "—");
      },
    })),
    {
      key: "actions",
      header: "Actions",
      className: "no-print",
      render: (row) => (
        <div className="flex gap-2">
          {canUpdate ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const next =
                  module.key === "assignments"
                    ? normalizeAssignmentForm(
                        { ...row },
                        scopedTeachers(scopeUser, state),
                      )
                    : { ...row };
                setEditing(next);
              }}
            >
              Modifier
            </Button>
          ) : null}
          {allowDelete ? (
            <Button variant="danger" size="sm" disabled={busy} onClick={() => void handleDelete(row)}>
              Supprimer
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <Card className="p-6">
        <SectionHeader
          title={module.label}
          description={
            school
              ? `${module.description} · Périmètre : ${school.name} (${school.code})`
              : module.description
          }
          actions={
            <>
              <PrintButton
                documentTitle={school ? `${module.label} — ${school.name}` : module.label}
              />
              {allowCreate ? (
                <Button
                  size="sm"
                  onClick={() => {
                    if (module.key === "assignments") {
                      setEditing({ className: "", subject: "", teacherId: "" });
                      return;
                    }
                    if (module.key === "courses") {
                      setEditing({ className: "", name: "", teacherName: "" });
                      return;
                    }
                    if (module.key === "teachers") {
                      const code = schoolCode;
                      if (!code || code === "*") {
                        showToast("Code établissement requis pour générer l'identifiant", "error");
                        return;
                      }
                      setEditing(
                        generateTeacherIdentifiers(code, (state.teachers ?? []) as Record<string, unknown>[]),
                      );
                      return;
                    }
                    setEditing({});
                  }}
                >
                  Ajouter
                </Button>
              ) : null}
            </>
          }
        />
        {module.planningManaged ? (
          <p className="mt-3 rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 text-sm text-ink">
            Les dates, horaires et classes se planifient dans{" "}
            <Link to="/planning" className="font-semibold text-brand underline">
              Planning de cours
            </Link>
            . Cet écran sert au suivi des statuts et à la publication des résultats.
          </p>
        ) : null}
        <div className="no-print mt-4">
          <Input
            placeholder={`Rechercher dans ${module.label.toLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="mt-4">
          <Table
            columns={columns}
            rows={rows}
            rowKey={(row, index) => String(row.id ?? index)}
          />
        </div>
      </Card>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={
          editing?.id
            ? `Modifier — ${module.label}`
            : `Nouveau — ${module.label}`
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Annuler
            </Button>
            <Button
              form={`entity-form-${entity}`}
              type="submit"
              disabled={busy || (editing?.id ? !canUpdate : !allowCreate)}
            >
              Enregistrer
            </Button>
          </>
        }
      >
        {editing ? (
          <form id={`entity-form-${entity}`} onSubmit={handleSubmit} className="grid gap-4">
            {module.fields.map((field) => (
              <Field key={field.key} label={field.label} htmlFor={field.key} hint={field.hint}>
                {field.inputType === "select" ? (
                  <Select
                    id={field.key}
                    value={String(editing[field.key] ?? "")}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (
                        (module.key === "assignments" || module.key === "courses") &&
                        field.key === "className"
                      ) {
                        setEditing({
                          ...editing,
                          className: value,
                          ...(module.key === "assignments" ? { subject: "" } : { name: "" }),
                        });
                        return;
                      }
                      setEditing({ ...editing, [field.key]: value });
                    }}
                    options={[
                      { value: "", label: field.placeholder ?? "Choisir…" },
                      ...getSelectOptionsForField(field),
                    ]}
                  />
                ) : (
                  <Input
                    id={field.key}
                    value={String(editing[field.key] ?? "")}
                    placeholder={field.placeholder}
                    required={field.required}
                    readOnly={field.readOnly}
                    onChange={(e) => setEditing({ ...editing, [field.key]: e.target.value })}
                  />
                )}
              </Field>
            ))}
            {(module.key === "assignments" || module.key === "courses") &&
            !String(editing.className ?? "") ? (
              <p className="text-xs text-muted">
                Sélectionnez d'abord une classe pour voir les matières disponibles.
              </p>
            ) : null}
          </form>
        ) : null}
      </Modal>
    </>
  );
}
