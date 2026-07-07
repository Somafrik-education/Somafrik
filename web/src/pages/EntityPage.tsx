import { useMemo, useRef, useState, type FormEvent } from "react";
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
import { usePrompt } from "../components/ui/PromptDialog";
import { usePermissionContext } from "../lib/usePermissionContext";
import { getEntityFeaturePermissions, canResetTargetUserPassword } from "../lib/permissions";
import {
  applySchoolScopeToItem,
  deleteScopedEntityRow,
  getEntityModule,
  getScopedEntityRows,
  mergeScopedEntityRows,
  type SchoolEntityKey,
} from "../lib/entityModules";
import { applyActiveGridsToStudent } from "../lib/fees";
import { syncSingleUserToTeachers, promoteTeacherToUser } from "../lib/userTeacherSync";
import {
  getAssignmentSelectOptions,
  normalizeAssignmentForm,
  prepareAssignmentForSave,
  validateAssignmentConflict,
} from "../lib/assignments";
import {
  contactHasOperationalRecord,
  type ContactLinkResult,
  getContactAccountOptions,
  getContactRoleOptions,
  linkContactToOperationalRecord,
  prepareContactForSave,
  promoteContactToUser,
  validateContactDuplicate,
} from "../lib/contacts";
import {
  findUserAccountForContact,
  resetUserAccountPassword,
} from "../lib/userAccounts";
import {
  getRelationContactOptions,
  getRelationParentContactOptions,
  getRelationStudentOptions,
  prepareRelationForSave,
  RELATION_PARENT_CHILD,
  validateRelation,
} from "../lib/relations";
import { csvToObjects, downloadCsv, rowsToCsv } from "../lib/csv";
import { validateTeacherDeletion } from "../lib/teacherRules";
import { normalize, isSchoolAdminRole } from "../lib/format";
import { inputToPeriodDate, normalizePeriodDate, periodDateToInput } from "../lib/dates";
import { subscriptionFeatureBlocked, type SubscriptionFeature } from "../lib/subscriptionAccessClient";
import { appendAuditLog, auditActor, makeAuditEntry, type AuditEntry } from "../lib/audit";
import { validateCourseTeacherRule } from "../lib/pedagogyGovernance";
import { QuickPaymentModal } from "../components/payments/QuickPaymentModal";
import { PaymentReceipt } from "../components/payments/PaymentReceipt";
import {
  buildPaymentAuditEntry,
  cancelPaymentRecord,
  isPaymentCancelled,
  type PaymentRecord,
} from "../lib/quickPayment";
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
  /** Vue simplifiée : uniquement les liaisons parent → élève. */
  mode?: "parentChildRelations";
}

const PARENT_CHILD_HIDDEN_FIELDS = new Set(["relationType", "accountCode"]);
const PARENT_CHILD_COLUMNS = ["fromContactName", "toStudentName", "status"];

export function EntityPage({ entity, mode }: EntityPageProps) {
  const module = getEntityModule(entity);
  const { session } = useAuth();
  const { state, update } = useData();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const { prompt } = usePrompt();
  const { activeSchoolCode: schoolCode, scopedUser } = useActiveSchool();
  const scopeUser = scopedUser ?? session?.user ?? null;
  const effectiveSchoolCode = useMemo(() => {
    const fromContext = String(schoolCode ?? "").trim();
    if (fromContext && fromContext !== "*") return fromContext;
    return String(scopeUser?.schoolCode ?? "").trim();
  }, [schoolCode, scopeUser?.schoolCode]);

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [quickPaymentOpen, setQuickPaymentOpen] = useState(false);
  const [receiptPayment, setReceiptPayment] = useState<PaymentRecord | null>(null);
  const [cancellingPayment, setCancellingPayment] = useState<PaymentRecord | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  const ctx = usePermissionContext();
  const entityPermissions = useMemo(
    () =>
      getEntityFeaturePermissions(ctx, module?.key ?? "", module?.feature ?? "Élèves", {
        contactType: String(editing?.contactType ?? ""),
      }),
    [ctx, module?.key, module?.feature, editing?.contactType],
  );
  const { canRead, canCreate, canUpdate, canDelete } = entityPermissions;
  const allowCreate = canCreate && !module?.planningManaged && module?.key !== "payments";
  const allowDelete = canDelete && !module?.planningManaged && module?.key !== "payments";
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

  const isParentChildMode = mode === "parentChildRelations" && module?.key === "relations";

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
    if (field.optionsKey === "accounts") {
      return getContactAccountOptions(scopeUser, state);
    }
    if (field.optionsKey === "userRoles") {
      const accountCode = String(editing?.schoolCode ?? schoolCode ?? "");
      return getContactRoleOptions(state, accountCode);
    }
    if (field.optionsKey === "relationContacts") {
      return isParentChildMode
        ? getRelationParentContactOptions(scopeUser, state)
        : getRelationContactOptions(scopeUser, state);
    }
    if (field.optionsKey === "relationStudents") {
      return getRelationStudentOptions(scopeUser, state);
    }
    return [];
  }

  const school = getCurrentSchool(scopeUser, state);

  const rows = useMemo(() => {
    if (!module) return [];
    let scoped = getScopedEntityRows(module.key, scopeUser, state);
    if (isParentChildMode) {
      scoped = scoped.filter(
        (row) => normalize(String(row.relationType ?? "")) === normalize(RELATION_PARENT_CHILD),
      );
    }
    const q = search.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((row) =>
      Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(q)),
    );
  }, [module, search, scopeUser, state, isParentChildMode]);

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
      await update(patch, { partial: true });
      showToast(message, "success");
    } catch {
      showToast("Échec de la synchronisation", "error");
      throw new Error("sync failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetContactPassword() {
    if (!editing?.id || module?.key !== "contacts") return;
    const linkedUser = findUserAccountForContact(editing, state.users);
    if (!linkedUser) {
      showToast("Aucun compte d'accès lié à ce contact.", "error");
      return;
    }
    if (!canResetTargetUserPassword(ctx, linkedUser)) {
      showToast("Réinitialisation non autorisée pour ce compte.", "error");
      return;
    }
    const temporaryPassword = await prompt({
      title: "Mot de passe temporaire",
      description: `Définir un mot de passe temporaire pour ${linkedUser.identifier}.`,
      defaultValue: "Soma1234",
      placeholder: "Mot de passe (min. 6 caractères)",
      inputType: "password",
      confirmLabel: "Réinitialiser",
      validate: (value) => (value.length < 6 ? "Minimum 6 caractères." : null),
    });
    if (!temporaryPassword) return;
    setBusy(true);
    try {
      const issued = await resetUserAccountPassword(linkedUser, temporaryPassword);
      showToast(`Mot de passe réinitialisé · ${linkedUser.identifier} · provisoire : ${issued}`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Échec de la réinitialisation", "error");
    } finally {
      setBusy(false);
    }
  }

  const linkedContactUser =
    module?.key === "contacts" && editing?.id
      ? findUserAccountForContact(editing, state.users)
      : undefined;
  const canResetContactPassword = Boolean(
    linkedContactUser &&
      String(editing?.hasAccess ?? "") === "Oui" &&
      canResetTargetUserPassword(ctx, linkedContactUser),
  );

  function handleExportCsv() {
    if (!module) return;
    const exportColumns = module.columns.map((key) => ({
      key,
      header: module.columnLabels?.[key] ?? module.fields.find((f) => f.key === key)?.label ?? key,
    }));
    const csv = rowsToCsv(rows as Record<string, unknown>[], exportColumns);
    downloadCsv(`${module.key}-${new Date().toISOString().slice(0, 10)}`, csv);
  }

  async function handleImportContactsFile(file: File) {
    if (!module) return;
    const headerMap: Record<string, string> = {};
    module.fields.forEach((field) => {
      headerMap[field.label.toLowerCase()] = field.key;
      headerMap[field.key.toLowerCase()] = field.key;
    });
    headerMap["compte"] = "schoolCode";
    headerMap["compte lié"] = "schoolCode";
    headerMap["nom"] = "lastName";
    headerMap["prénom"] = "firstName";
    headerMap["prenom"] = "firstName";

    let text = "";
    try {
      text = await file.text();
    } catch {
      showToast("Impossible de lire le fichier.", "error");
      return;
    }
    const parsed = csvToObjects(text, headerMap);
    if (!parsed.length) {
      showToast("Fichier vide ou en-têtes non reconnues.", "error");
      return;
    }

    const existing = (state.contacts as unknown as Record<string, unknown>[]).slice();
    const toAdd: Record<string, unknown>[] = [];
    const errors: string[] = [];
    const fallbackSchool = schoolCode && schoolCode !== "*" ? schoolCode : "";

    parsed.forEach((raw, index) => {
      const line = index + 2;
      const prepared = prepareContactForSave(
        { ...raw, schoolCode: String(raw.schoolCode ?? "").trim() || fallbackSchool },
        state,
      );
      if (!prepared.lastName || !prepared.firstName || !prepared.contactType) {
        errors.push(`Ligne ${line} : nom, prénom ou type manquant.`);
        return;
      }
      if (!prepared.schoolCode) {
        errors.push(`Ligne ${line} : compte lié manquant.`);
        return;
      }
      const duplicate = validateContactDuplicate(prepared, [...existing, ...toAdd]);
      if (duplicate.block) {
        errors.push(`Ligne ${line} : ${duplicate.block}`);
        return;
      }
      toAdd.push({ ...prepared, id: newId("CONTACTS") });
    });

    if (!toAdd.length) {
      showToast(`Aucun contact importé (${errors.length} ligne(s) en erreur).`, "error");
      return;
    }

    try {
      await persistPatch(
        {
          contacts: [...toAdd, ...existing] as unknown as BackOfficeState["contacts"],
          auditLog: appendAuditLog(
            state.auditLog,
            makeAuditEntry({
              ...auditActor(scopeUser),
              action: "contact.import",
              entityType: "contact",
              schoolCode: fallbackSchool || undefined,
              details: `${toAdd.length} importé(s)${
                errors.length ? `, ${errors.length} ignoré(s)` : ""
              }`,
            }),
          ),
        },
        `${toAdd.length} contact(s) importé(s)${
          errors.length ? ` · ${errors.length} ignoré(s)` : ""
        }`,
      );
    } catch {
      /* toast déjà affiché */
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
      const synced = syncTeacherPedagogy(baseState, nextItem, effectiveSchoolCode);
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
        effectiveSchoolCode,
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
        effectiveSchoolCode,
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
      if (teacherName && !teacher && !String(workingItem.teacherId ?? "").trim()) {
        showToast(
          "Enseignant introuvable dans les fiches : créez d'abord la fiche enseignant pour relier la matière à sa classe.",
          "error",
        );
        return;
      }
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
      workingItem = prepareAssignmentForSave(workingItem, teachers, schoolCode, state, scopeUser);
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
        filterSchoolClassRecords((state.classes ?? []) as Record<string, unknown>[], effectiveSchoolCode),
        editing.id ? String(editing.id) : undefined,
      );
      if (classConflict) {
        showToast(classConflict, "error");
        return;
      }
    }

    if (module.key === "contacts") {
      workingItem = prepareContactForSave(workingItem, state);
      if (!String(workingItem.schoolCode ?? "").trim()) {
        showToast("Le compte lié est obligatoire : un contact ne peut pas être isolé.", "error");
        return;
      }
      const allContacts = (state.contacts ?? []) as unknown as Record<string, unknown>[];
      const duplicate = validateContactDuplicate(
        workingItem,
        allContacts,
        editing.id ? String(editing.id) : undefined,
      );
      if (duplicate.block) {
        showToast(duplicate.block, "error");
        return;
      }
      if (duplicate.warn) {
        const proceed = await confirm({
          title: "Doublon potentiel",
          description: duplicate.warn,
          confirmLabel: "Créer quand même",
        });
        if (!proceed) return;
      }
      if (
        String(workingItem.hasAccess ?? "") === "Oui" &&
        !String(workingItem.role ?? "").trim()
      ) {
        showToast("Choisissez un rôle pour créer l'accès utilisateur.", "error");
        return;
      }
    }

    if (module.key === "relations") {
      if (isParentChildMode) {
        workingItem = { ...workingItem, relationType: RELATION_PARENT_CHILD };
      }
      workingItem = prepareRelationForSave(workingItem, state);
      const relationError = validateRelation(
        workingItem,
        getScopedEntityRows("relations", scopeUser, state),
        editing.id ? String(editing.id) : undefined,
      );
      if (relationError) {
        showToast(relationError, "error");
        return;
      }
    }

    for (const field of module.fields) {
      if (field.inputType === "date" && !field.readOnly && workingItem[field.key]) {
        workingItem[field.key] = normalizePeriodDate(String(workingItem[field.key]));
      }
    }

    const scopedItem = applySchoolScopeToItem(module.key, workingItem, effectiveSchoolCode, state);
    const linkedItem = linkStudentFromName(module.key, scopedItem, scopeUser, state);
    const current = getScopedEntityRows(module.key, scopeUser, state);
    const exists =
      Boolean(linkedItem.id) &&
      current.some((row) => String(row.id) === String(linkedItem.id));

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

    if (!exists) {
      const featureByModule: Partial<Record<string, SubscriptionFeature>> = {
        students: "create_student",
        teachers: "create_teacher",
        announcements: "announcements",
      };
      const feature = featureByModule[module.key];
      if (feature) {
        const blocked = subscriptionFeatureBlocked(state, effectiveSchoolCode, feature);
        if (blocked) {
          showToast(blocked, "error");
          return;
        }
      }
    }

    let preparedItem = { ...linkedItem };

    if (module.key === "teachers") {
      const code = String(effectiveSchoolCode ?? preparedItem.schoolCode ?? "").trim();
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

    const mergeResult = mergeScopedEntityRows(module.key, scopeUser, state, nextItem);
    if (!mergeResult.applied) {
      showToast("Modification refusée : élément hors périmètre de l'établissement.", "error");
      return;
    }
    const nextAllRows = mergeResult.rows;
    const patch = buildPedagogyPatch(module.key, nextItem, nextAllRows);

    let successMessage = exists ? `${module.label} modifié` : `${module.label} créé`;

    if (module.key === "teachers" && !exists) {
      const teacherPromotion = promoteTeacherToUser(
        { ...(nextItem as Record<string, unknown>), schoolCode: effectiveSchoolCode ?? String((nextItem as Record<string, unknown>).schoolCode ?? "") },
        state,
        scopeUser,
      );
      if (teacherPromotion?.created && teacherPromotion.temporaryPassword) {
        patch.users = teacherPromotion.users;
        const teacherRows = ((patch.teachers as Record<string, unknown>[] | undefined) ??
          nextAllRows) as Record<string, unknown>[];
        patch.teachers = teacherRows.map((row) =>
          String(row.id) === String(nextItem.id) ? teacherPromotion.teacher : row,
        ) as BackOfficeState["teachers"];
        successMessage = `Enseignant créé · identifiant ${String(teacherPromotion.teacher.identifier ?? "")} · mot de passe provisoire : ${teacherPromotion.temporaryPassword}`;
      }
    }

    const nextContact = nextItem as Record<string, unknown>;
    let contactPromotion: ReturnType<typeof promoteContactToUser> | null = null;
    if (module.key === "contacts" && String(nextContact.hasAccess ?? "") === "Oui") {
      contactPromotion = promoteContactToUser(nextContact, state, scopeUser);
      patch.users = contactPromotion.users;
      const promotedUser = contactPromotion.users.find(
        (user) => normalize(String(user.contactId ?? "")) === normalize(String(nextContact.id ?? "")),
      );
      if (promotedUser) {
        const teacherPatch = syncSingleUserToTeachers(
          { ...state, users: contactPromotion.users },
          promotedUser,
        );
        if (teacherPatch.teachers !== state.teachers) {
          patch.teachers = teacherPatch.teachers;
        }
      }
      const mergedContacts = (
        (patch.contacts as unknown as Record<string, unknown>[] | undefined) ?? nextAllRows
      ).map((row) => (String(row.id) === String(nextContact.id) ? contactPromotion!.contact : row));
      patch.contacts = mergedContacts as unknown as BackOfficeState["contacts"];
      if (contactPromotion.created && contactPromotion.temporaryPassword) {
        successMessage = `Contact enregistré · accès ${contactPromotion.contact.userIdentifier} · mot de passe provisoire : ${contactPromotion.temporaryPassword}`;
      } else {
        successMessage = `Contact enregistré · accès ${contactPromotion.contact.userIdentifier}`;
      }
    }

    let ficheLink: ContactLinkResult | null = null;
    if (
      module.key === "contacts" &&
      contactHasOperationalRecord(String(nextContact.contactType ?? ""))
    ) {
      const currentContacts =
        (patch.contacts as unknown as Record<string, unknown>[] | undefined) ?? nextAllRows;
      const sourceContact =
        currentContacts.find((row) => String(row.id) === String(nextContact.id)) ?? nextContact;
      ficheLink = linkContactToOperationalRecord(sourceContact, state, schoolCode);
      if (ficheLink.students) {
        patch.students = ficheLink.students as unknown as BackOfficeState["students"];
      }
      if (ficheLink.teachers) {
        patch.teachers = ficheLink.teachers as unknown as BackOfficeState["teachers"];
      }
      patch.contacts = currentContacts.map((row) =>
        String(row.id) === String(nextContact.id) ? ficheLink!.contact : row,
      ) as unknown as BackOfficeState["contacts"];
      if (ficheLink.linkedType) {
        const ficheLabel = ficheLink.linkedType === "student" ? "fiche élève" : "fiche enseignant";
        const baseMessage = ficheLink.created
          ? `Contact enregistré · ${ficheLabel} créée et reliée`
          : `Contact enregistré · ${ficheLabel} reliée`;
        if (contactPromotion?.created && contactPromotion.temporaryPassword) {
          successMessage = `${baseMessage} · mot de passe provisoire : ${contactPromotion.temporaryPassword}`;
        } else {
          successMessage = baseMessage;
        }
      }
    }

    if (module.key === "contacts" || module.key === "relations") {
      const isContact = module.key === "contacts";
      const label = isContact
        ? `${String(nextContact.lastName ?? "")} ${String(nextContact.firstName ?? "")}`.trim()
        : `${String(nextContact.relationType ?? "")} · ${String(nextContact.fromContactName ?? "")}`.trim();
      const entries: AuditEntry[] = [
        makeAuditEntry({
          ...auditActor(scopeUser),
          action: `${isContact ? "contact" : "relation"}.${exists ? "update" : "create"}`,
          entityType: isContact ? "contact" : "relation",
          entityId: String(nextContact.id ?? ""),
          entityLabel: label || undefined,
          schoolCode: String(nextContact.schoolCode ?? "") || undefined,
        }),
      ];
      if (isContact && String(nextContact.hasAccess ?? "") === "Oui") {
        entries.push(
          makeAuditEntry({
            ...auditActor(scopeUser),
            action: "user.role.assign",
            entityType: "user",
            entityId: String(nextContact.id ?? ""),
            entityLabel: label || undefined,
            schoolCode: String(nextContact.schoolCode ?? "") || undefined,
            details:
              contactPromotion?.created && contactPromotion.temporaryPassword
                ? [
                    [String(nextContact.role ?? ""), String(nextContact.secondaryRole ?? "")]
                      .filter(Boolean)
                      .join(" + "),
                    "Mot de passe provisoire généré",
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : [String(nextContact.role ?? ""), String(nextContact.secondaryRole ?? "")]
                    .filter(Boolean)
                    .join(" + "),
          }),
        );
      }
      if (isContact && ficheLink?.linkedType) {
        entries.push(
          makeAuditEntry({
            ...auditActor(scopeUser),
            action: `${ficheLink.linkedType}.${ficheLink.created ? "create" : "link"}`,
            entityType: ficheLink.linkedType,
            entityId: ficheLink.linkedRecordId,
            entityLabel: label || undefined,
            schoolCode: String(nextContact.schoolCode ?? "") || undefined,
            details: ficheLink.created
              ? "Fiche créée et reliée au contact"
              : "Fiche existante reliée au contact",
          }),
        );
      }
      patch.auditLog = appendAuditLog(state.auditLog, ...entries);
    }

    if (module.key === "students" && !exists) {
      patch.studentFees = applyActiveGridsToStudent(
        { ...state, ...patch, students: nextAllRows },
        nextItem as Record<string, unknown>,
      );
    }

    try {
      await persistPatch(patch, successMessage);
      setEditing(null);
    } catch {
      /* toast déjà affiché */
    }
  }

  async function handleCancelPayment(row: PaymentRecord) {
    if (!module || module.key !== "payments") return;
    setCancellingPayment(row);
    setCancelReason("");
  }

  async function submitCancelPayment() {
    if (!cancellingPayment || !cancelReason.trim()) {
      showToast("Le motif d'annulation est obligatoire", "error");
      return;
    }
    const cancelled = cancelPaymentRecord(cancellingPayment, cancelReason, scopeUser);
    const mergeResult = mergeScopedEntityRows("payments", scopeUser, state, cancelled);
    if (!mergeResult.applied) {
      showToast("Annulation refusée : paiement hors périmètre de l'établissement.", "error");
      return;
    }
    try {
      await persistPatch(
        {
          payments: mergeResult.rows as BackOfficeState["payments"],
          auditLog: appendAuditLog(
            state.auditLog,
            buildPaymentAuditEntry(cancelled, scopeUser, "payment.cancel", cancelReason.trim()),
          ),
        },
        "Paiement annulé",
      );
      setCancellingPayment(null);
      setCancelReason("");
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

    if (module.key === "teachers") {
      if (!canDelete) {
        showToast(
          isSchoolAdminRole(scopeUser?.role)
            ? "Suppression réservée : accordez le droit « Enseignants — Supprimer » (Superadmin) ou confiez l'action au préfet des études."
            : "Suppression non autorisée pour votre rôle.",
          "error",
        );
        return;
      }
      const linkError = validateTeacherDeletion(state, row);
      if (linkError) {
        showToast(linkError, "error");
        return;
      }
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
    const deletePatch: Partial<BackOfficeState> = { [module.key]: nextAllRows };
    if (module.key === "contacts" || module.key === "relations") {
      deletePatch.auditLog = appendAuditLog(
        state.auditLog,
        makeAuditEntry({
          ...auditActor(scopeUser),
          action: `${module.key === "contacts" ? "contact" : "relation"}.delete`,
          entityType: module.key === "contacts" ? "contact" : "relation",
          entityId: String(row.id ?? ""),
          entityLabel:
            module.key === "contacts"
              ? `${String(row.lastName ?? "")} ${String(row.firstName ?? "")}`.trim() || undefined
              : String(row.relationType ?? "") || undefined,
          schoolCode: String(row.schoolCode ?? "") || undefined,
        }),
      );
    }
    try {
      await persistPatch(deletePatch, "Élément supprimé");
    } catch {
      /* toast déjà affiché */
    }
  }

  const displayColumns = isParentChildMode ? PARENT_CHILD_COLUMNS : module.columns;
  const displayFields = isParentChildMode
    ? module.fields.filter((field) => !PARENT_CHILD_HIDDEN_FIELDS.has(field.key))
    : module.fields;

  const columns: Column<Record<string, unknown>>[] = [
    ...displayColumns.map((key) => ({
      key,
      header:
        module.columnLabels?.[key] ??
        (isParentChildMode && key === "fromContactName"
          ? "Parent"
          : module.fields.find((field) => field.key === key)?.label ?? key),
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
        <div className="flex flex-wrap gap-2">
          {module.key === "payments" ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setReceiptPayment(row as PaymentRecord)}>
                Reçu
              </Button>
              {canUpdate && !isPaymentCancelled(row as PaymentRecord) ? (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleCancelPayment(row as PaymentRecord)}
                >
                  Annuler
                </Button>
              ) : null}
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Card className="p-6">
        <SectionHeader
          title={isParentChildMode ? "Relations parent-enfant" : module.label}
          description={
            isParentChildMode
              ? school
                ? `Associez un contact parent à un élève. Périmètre : ${school.name} (${school.code})`
                : "Associez un contact parent à un élève de l'établissement."
              : school
                ? `${module.description} · Périmètre : ${school.name} (${school.code})`
                : module.description
          }
          actions={
            <>
              <PrintButton
                documentTitle={school ? `${module.label} — ${school.name}` : module.label}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExportCsv}
                disabled={rows.length === 0}
              >
                Exporter CSV
              </Button>
              {module.key === "contacts" && allowCreate ? (
                <>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleImportContactsFile(file);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => importInputRef.current?.click()}
                  >
                    Importer CSV
                  </Button>
                </>
              ) : null}
              {module.key === "payments" && canCreate ? (
                <Button size="sm" onClick={() => setQuickPaymentOpen(true)}>
                  Saisie rapide
                </Button>
              ) : null}
              {allowCreate ? (
                <Button
                  size="sm"
                  onClick={() => {
                    if (module.key === "contacts") {
                      setEditing({
                        status: "Actif",
                        schoolCode: schoolCode && schoolCode !== "*" ? schoolCode : "",
                      });
                      return;
                    }
                    if (module.key === "relations") {
                      setEditing({
                        relationType: isParentChildMode ? RELATION_PARENT_CHILD : "Parent → Élève",
                        status: "Actif",
                      });
                      return;
                    }
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
                  {isParentChildMode ? "Lier parent et élève" : "Ajouter"}
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
            ? `Modifier — ${isParentChildMode ? "relation parent-enfant" : module.label}`
            : isParentChildMode
              ? "Lier un parent à un élève"
              : `Nouveau — ${module.label}`
        }
        footer={
          <>
            {canResetContactPassword ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void handleResetContactPassword()}
              >
                Réinitialiser le mot de passe
              </Button>
            ) : null}
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
            {displayFields.map((field) => {
              const fieldLabel =
                isParentChildMode && field.key === "fromContactId"
                  ? "Parent"
                  : isParentChildMode && field.key === "toStudentId"
                    ? "Élève"
                    : field.label;
              return (
              <Field key={field.key} label={fieldLabel} htmlFor={field.key} hint={field.hint}>
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
                ) : field.inputType === "date" ? (
                  <Input
                    id={field.key}
                    type="date"
                    value={periodDateToInput(String(editing[field.key] ?? ""))}
                    required={field.required}
                    readOnly={field.readOnly}
                    disabled={field.readOnly}
                    onChange={(e) =>
                      setEditing({ ...editing, [field.key]: inputToPeriodDate(e.target.value) })
                    }
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
              );
            })}
            {isParentChildMode && getRelationParentContactOptions(scopeUser, state).length === 0 ? (
              <p className="text-xs text-muted">
                Aucun contact de type Parent. Créez d&apos;abord un parent dans{" "}
                <Link to="/etablissement/contacts" className="font-semibold text-brand underline">
                  Mon établissement → Contacts
                </Link>
                .
              </p>
            ) : null}
            {(module.key === "assignments" || module.key === "courses") &&
            !String(editing.className ?? "") ? (
              <p className="text-xs text-muted">
                Sélectionnez d'abord une classe pour voir les matières disponibles.
              </p>
            ) : null}
          </form>
        ) : null}
      </Modal>

      {module.key === "payments" ? (
        <>
          <QuickPaymentModal open={quickPaymentOpen} onClose={() => setQuickPaymentOpen(false)} />
          <Modal
            open={Boolean(receiptPayment)}
            title="Reçu de paiement"
            onClose={() => setReceiptPayment(null)}
            size="lg"
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setReceiptPayment(null)}>
                  Fermer
                </Button>
                <Button
                  onClick={() => {
                    if (receiptPayment) {
                      void update({
                        auditLog: appendAuditLog(
                          state.auditLog,
                          buildPaymentAuditEntry(receiptPayment, scopeUser, "payment.receipt.print"),
                        ),
                      });
                    }
                    window.print();
                  }}
                >
                  Imprimer
                </Button>
              </div>
            }
          >
            {receiptPayment ? (
              <PaymentReceipt
                payment={receiptPayment}
                school={
                  state.schools.find(
                    (item) => item.code === String(receiptPayment.schoolCode ?? schoolCode ?? ""),
                  ) ?? getCurrentSchool(scopeUser, state)
                }
              />
            ) : null}
          </Modal>
          <Modal
            open={Boolean(cancellingPayment)}
            title="Annuler le paiement"
            description="L'annulation conserve l'historique comptable. Le motif est obligatoire."
            onClose={() => {
              setCancellingPayment(null);
              setCancelReason("");
            }}
            footer={
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCancellingPayment(null);
                    setCancelReason("");
                  }}
                >
                  Retour
                </Button>
                <Button variant="danger" disabled={busy || !cancelReason.trim()} onClick={() => void submitCancelPayment()}>
                  Confirmer l'annulation
                </Button>
              </>
            }
          >
            <Field label="Motif d'annulation">
              <textarea
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                rows={3}
                className="w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                placeholder="Ex. Erreur de saisie, double encaissement..."
              />
            </Field>
          </Modal>
        </>
      ) : null}
    </>
  );
}
