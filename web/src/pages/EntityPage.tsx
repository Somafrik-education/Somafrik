import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import {
  Button,
  EmptyState,
  EntityListForbidden,
  EntityListSearch,
  EntityListShell,
  EntityListTable,
  InlineAlert,
  Modal,
  type Column,
} from "@/design-system";
import { PrintButton } from "../components/ui/PrintButton";
import { Field, Input, Select } from "../components/ui/Field";
import { DatePicker } from "../components/ui/DatePicker";
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
  entityCreateViaContactsOnly,
  type SchoolEntityKey,
} from "../lib/entityModules";
import { applyActiveGridsToStudent } from "../lib/fees";
import { adaptLegacyStudents } from "../lib/studentDomain";
import {
  getTeacherProvisioningOptions,
  parseTeacherProvisioningSelection,
  syncSingleUserToTeachers,
  syncTeacherProfileToUser,
} from "../lib/userTeacherSync";
import {
  getAssignmentSelectOptions,
  formatTeacherAssignmentsSummary,
  listTeacherAssignments,
  normalizeAssignmentForm,
  prepareAssignmentForSave,
  validateAssignmentConflict,
} from "../lib/assignments";
import {
  contactHasOperationalRecord,
  type ContactLinkResult,
  getContactAccountOptions,
  getContactRoleOptions,
  getLinkableContactOptions,
  linkContactToOperationalRecord,
  prepareContactForSave,
  promoteContactToUser,
  revokeContactUserAccess,
  validateContactDuplicate,
} from "../lib/contacts";
import {
  findUserAccountForContact,
  resetUserAccountPassword,
} from "../lib/userAccounts";
import { validatePasswordPolicy } from "../lib/userAccountRules";
import {
  enforceSinglePrincipalParent,
  formatContactPersonName,
  formatStudentPersonName,
  getParentLinkedStudentIds,
  getRelationParentUserOptions,
  getRelationStudentOptions,
  groupParentChildRelations,
  isParentChildBundleRow,
  parentChildBundleToForm,
  prepareRelationForSave,
  removeParentChildBundle,
  RELATION_PARENT_CHILD,
  syncParentChildRelations,
  splitParentChildStudentNames,
  validateParentChildBundle,
  validateRelation,
} from "../lib/relations";
import { csvToObjects, downloadCsv, downloadExcel, rowsToCsv } from "../lib/csv";
import { validateTeacherDeletion, validateTeacherSchoolEntry } from "../lib/teacherRules";
import { markAllAnnouncementsRead } from "../lib/announcementsRead";
import { normalize, isSchoolAdminRole } from "../lib/format";
import { isSuperAdminRole } from "../lib/orgHierarchy";
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
  scopedAssignments,
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
import { getSchoolPeriodNames } from "../lib/evaluations";
import {
  generateTeacherIdentifiers,
  getTeacherLoginIdentifier,
  resolveStudentMatricule,
  resolveTeacherIdentifiers,
} from "../lib/entityIdentifiers";
import {
  filterSchoolClassRecords,
  getAvailableClassNameOptions,
  removeSchoolClassFromState,
  validateUniqueClassName,
} from "../lib/classRules";

function normalizeTeacherFormRow(row: Record<string, unknown>): Record<string, unknown> {
  const next = { ...row };
  if (!String(next.identifier ?? "").trim() && String(next.publicId ?? "").trim()) {
    next.identifier = getTeacherLoginIdentifier(String(next.publicId));
  }
  return next;
}

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

function renderSeparatedStudentNames(labels: string[]): ReactNode {
  if (!labels.length) return "—";
  return (
    <div className="divide-y divide-line">
      {labels.map((label, index) => (
        <div key={`${label}-${index}`} className="py-1.5 first:pt-0 last:pb-0">
          {label}
        </div>
      ))}
    </div>
  );
}

interface EntityPageProps {
  entity: SchoolEntityKey;
  /** Vue simplifiée : uniquement les liaisons parent → élève. */
  mode?: "parentChildRelations";
  /** Limite la liste et la création à une classe (gestion depuis Classes). */
  classScope?: string;
}

const PARENT_CHILD_HIDDEN_FIELDS = new Set(["relationType", "accountCode", "toStudentId"]);
const PARENT_CHILD_COLUMNS = ["fromContactName", "toStudentName", "isPrincipal", "status"];
const PARENT_CHILD_COLUMN_LABELS: Record<string, string> = {
  fromContactName: "Parent",
  toStudentName: "Élève(s)",
  isPrincipal: "Parent principal",
  status: "Statut",
};

function relationColumnHeader(
  key: string,
  module: NonNullable<ReturnType<typeof getEntityModule>>,
  isParentChildMode: boolean,
): string {
  if (isParentChildMode && PARENT_CHILD_COLUMN_LABELS[key]) {
    return PARENT_CHILD_COLUMN_LABELS[key];
  }
  return (
    module.columnLabels?.[key] ?? module.fields.find((field) => field.key === key)?.label ?? key
  );
}

/** Entités « données sensibles » tracées au journal d'audit (WEB-ME-006 / SEC-ME-003). */
const AUDITED_ENTITY_KEYS = new Set<SchoolEntityKey>([
  "classes",
  "students",
  "teachers",
  "assignments",
]);

/** Libellé lisible d'une ligne pour le journal d'audit. */
function auditEntityLabel(key: SchoolEntityKey, row: Record<string, unknown>): string {
  const str = (value: unknown) => String(value ?? "").trim();
  switch (key) {
    case "classes":
      return str(row.name) || str(row.className);
    case "students":
    case "teachers":
      return `${str(row.name)} ${str(row.firstName)}`.trim();
    case "assignments":
      return [str(row.teacherName), str(row.subject), str(row.className)]
        .filter(Boolean)
        .join(" · ");
    default:
      return str(row.name);
  }
}

export function EntityPage({ entity, mode, classScope }: EntityPageProps) {
  const module = getEntityModule(entity);
  const { session } = useAuth();
  const { state, update } = useData();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const { prompt } = usePrompt();
  const { activeSchoolCode: schoolCode, scopedUser } = useActiveSchool();
  // Le Super Admin diffuse annonces/messages au niveau système : aucun périmètre
  // d'établissement ne doit lui être imposé (ni pour créer, ni pour consulter).
  const isSuperadminSystemComm =
    isSuperAdminRole(session?.user?.role) &&
    (module?.key === "announcements" || module?.key === "messages");
  const scopeUser = isSuperadminSystemComm
    ? session?.user ?? null
    : scopedUser ?? session?.user ?? null;
  const effectiveSchoolCode = useMemo(() => {
    if (isSuperadminSystemComm) return "*";
    const fromContext = String(schoolCode ?? "").trim();
    if (fromContext && fromContext !== "*") return fromContext;
    return String(scopeUser?.schoolCode ?? "").trim();
  }, [isSuperadminSystemComm, schoolCode, scopeUser?.schoolCode]);

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [quickPaymentOpen, setQuickPaymentOpen] = useState(false);
  const [receiptPayment, setReceiptPayment] = useState<PaymentRecord | null>(null);
  const [cancellingPayment, setCancellingPayment] = useState<PaymentRecord | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [linkContactOpen, setLinkContactOpen] = useState(false);
  const [linkContactId, setLinkContactId] = useState("");
  const [teacherAssignmentContext, setTeacherAssignmentContext] = useState<Record<string, unknown> | null>(
    null,
  );
  const [editingAssignment, setEditingAssignment] = useState<Record<string, unknown> | null>(null);
  const [pendingParentStudentId, setPendingParentStudentId] = useState("");
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
  const studentsPermissions = useMemo(
    () => getEntityFeaturePermissions(ctx, "students", "Élèves"),
    [ctx],
  );
  const assignmentPermissions = useMemo(
    () => getEntityFeaturePermissions(ctx, "assignments", "Affectations"),
    [ctx],
  );
  const assignmentModule = useMemo(() => getEntityModule("assignments"), []);
  const allowCreate =
    canCreate &&
    !module?.planningManaged &&
    module?.key !== "payments" &&
    !entityCreateViaContactsOnly(module?.key ?? "");
  const allowDelete = canDelete && !module?.planningManaged && module?.key !== "payments";

  // ELEVE-001 / ENS-001 : créer une fiche à partir d'un contact existant.
  const linkableContactKind: "student" | "teacher" | null =
    module?.key === "students" ? "student" : module?.key === "teachers" ? "teacher" : null;
  const linkableContactOptions = useMemo(
    () =>
      linkableContactKind
        ? getLinkableContactOptions(state, effectiveSchoolCode, linkableContactKind)
        : [],
    [linkableContactKind, state, effectiveSchoolCode],
  );
  const linkableTeacherProvisioningOptions = useMemo(
    () =>
      linkableContactKind === "teacher"
        ? getTeacherProvisioningOptions(state, effectiveSchoolCode, linkableContactOptions)
        : [],
    [linkableContactKind, state, effectiveSchoolCode, linkableContactOptions],
  );
  const linkableProvisioningOptions =
    linkableContactKind === "teacher" ? linkableTeacherProvisioningOptions : linkableContactOptions;
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
  const teacherAssignmentOptions = useMemo(
    () =>
      editingAssignment
        ? getAssignmentSelectOptions(
            scopeUser,
            state,
            String(editingAssignment.className ?? ""),
            schoolCode,
          )
        : null,
    [editingAssignment, scopeUser, state, schoolCode],
  );
  const scopedAssignmentsList = useMemo(
    () => scopedAssignments(scopeUser, state),
    [scopeUser, state],
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

  function getTeacherAssignmentFieldOptions(
    field: NonNullable<typeof assignmentModule>["fields"][number],
  ) {
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

  const school = getCurrentSchool(scopeUser, state);

  const rows = useMemo(() => {
    if (!module) return [];
    let scoped = getScopedEntityRows(module.key, scopeUser, state);
    if (classScope && module.key === "students") {
      scoped = scoped.filter(
        (row) => normalize(String(row.className ?? "")) === normalize(classScope),
      );
    }
    if (isParentChildMode) {
      scoped = groupParentChildRelations(scoped);
    }
    const q = search.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((row) =>
      Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(q)),
    );
  }, [module, search, scopeUser, state, isParentChildMode, classScope]);

  const scopedStudentsList = useMemo(
    () => scopedStudents(scopeUser, state),
    [scopeUser, state],
  );
  const parentStudentOptions = useMemo(
    () => (isParentChildMode ? getRelationStudentOptions(scopeUser, state) : []),
    [isParentChildMode, scopeUser, state],
  );
  const selectedParentStudentIds = useMemo(() => {
    if (!editing || !Array.isArray(editing.toStudentIds)) return [] as string[];
    return (editing.toStudentIds as string[]).map(String).filter(Boolean);
  }, [editing]);
  const availableParentStudentOptions = useMemo(
    () => parentStudentOptions.filter((option) => !selectedParentStudentIds.includes(option.value)),
    [parentStudentOptions, selectedParentStudentIds],
  );
  const selectedParentStudentLabels = useMemo(
    () =>
      selectedParentStudentIds.map((studentId) => {
        const option = parentStudentOptions.find((item) => item.value === studentId);
        return { id: studentId, label: option?.label ?? studentId };
      }),
    [selectedParentStudentIds, parentStudentOptions],
  );

  useEffect(() => {
    if (!editing) {
      setPendingParentStudentId("");
    }
  }, [editing]);

  useEffect(() => {
    if (module?.key === "announcements") {
      markAllAnnouncementsRead(scopeUser, state);
    }
  }, [module?.key, scopeUser, state]);

  if (!module) {
    return <Navigate to="/etablissement" replace />;
  }

  if (!canRead) {
    return <EntityListForbidden moduleLabel={module.label} />;
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
      validate: (value) => validatePasswordPolicy(value),
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

  function getExportColumns() {
    if (!module) return [];
    return module.columns.map((key) => ({
      key,
      header: module.columnLabels?.[key] ?? module.fields.find((f) => f.key === key)?.label ?? key,
    }));
  }

  function handleExportCsv() {
    if (!module) return;
    const csv = rowsToCsv(rows as Record<string, unknown>[], getExportColumns());
    downloadCsv(`${module.key}-${new Date().toISOString().slice(0, 10)}`, csv);
  }

  function handleExportExcel() {
    if (!module) return;
    downloadExcel(
      `${module.key}-${new Date().toISOString().slice(0, 10)}`,
      rows as Record<string, unknown>[],
      getExportColumns(),
    );
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

  async function handleParentChildBundleSubmit() {
    if (!editing || !module) return;

    const bundleError = validateParentChildBundle(editing);
    if (bundleError) {
      showToast(bundleError, "error");
      return;
    }

    const fromContactId = String(editing.fromContactId ?? "").trim();
    const currentScoped = getScopedEntityRows("relations", scopeUser, state);
    const existedBefore = currentScoped.some(
      (row) =>
        normalize(String(row.relationType ?? "")) === normalize(RELATION_PARENT_CHILD) &&
        String(row.fromContactId ?? "").trim() === fromContactId,
    );

    if (existedBefore && !canUpdate) {
      showToast("Modification non autorisée pour votre rôle.", "error");
      return;
    }
    if (!existedBefore && !canCreate) {
      showToast("Création non autorisée pour votre rôle.", "error");
      return;
    }

    const allRelations = (state.relations ?? []) as unknown as Record<string, unknown>[];
    const nextRelations = syncParentChildRelations(editing, allRelations, state, () =>
      newId("RELATIONS"),
    );

    const parentAccount = ((state.users ?? []) as unknown as Record<string, unknown>[]).find(
      (row) => String(row.id ?? "") === fromContactId,
    );
    const label = parentAccount
      ? formatContactPersonName(parentAccount)
      : String(editing.fromContactName ?? fromContactId);

    try {
      await persistPatch(
        {
          relations: nextRelations as unknown as BackOfficeState["relations"],
          auditLog: appendAuditLog(
            state.auditLog,
            makeAuditEntry({
              ...auditActor(scopeUser),
              action: `relation.${existedBefore ? "update" : "create"}`,
              entityType: "relation",
              entityId: fromContactId,
              entityLabel: label || undefined,
              schoolCode: String(editing.schoolCode ?? parentAccount?.schoolCode ?? "") || undefined,
              details: `${(editing.toStudentIds as string[] | undefined)?.length ?? 0} élève(s) lié(s)`,
            }),
          ),
        },
        existedBefore ? "Parent et élèves mis à jour" : "Parent lié à ses élèves",
      );
      setEditing(null);
    } catch {
      /* toast déjà affiché */
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editing || !module) return;

    if (module.key === "relations" && isParentChildMode) {
      await handleParentChildBundleSubmit();
      return;
    }

    if (!editing.id && entityCreateViaContactsOnly(module.key)) {
      showToast(
        "Créez d'abord un compte utilisateur (type Élève ou Enseignant) dans Comptes utilisateurs pour éviter les doublons.",
        "error",
      );
      return;
    }

    if (module.planningManaged && !editing.id) {
      showToast("La planification se fait uniquement depuis Planning de cours.", "error");
      return;
    }

    let workingItem = { ...editing };

    if (classScope && module.key === "students") {
      workingItem = { ...workingItem, className: classScope };
    }

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

    const missingRequired = module.fields.find((field) => {
      if (isParentChildMode && PARENT_CHILD_HIDDEN_FIELDS.has(field.key)) return false;
      return field.required && !field.readOnly && !String(workingItem[field.key] ?? "").trim();
    });
    if (missingRequired) {
      showToast(`${missingRequired.label} est obligatoire`, "error");
      return;
    }

    if (module.key === "teachers") {
      const entryError = validateTeacherSchoolEntry(workingItem);
      if (entryError) {
        showToast(entryError, "error");
        return;
      }
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

    // Annonce/message créé par le Super Admin : diffusion système (aucun périmètre).
    if (isSuperadminSystemComm) {
      preparedItem.systemBroadcast = true;
    }

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

    if (module.key === "students") {
      const code = String(effectiveSchoolCode ?? preparedItem.schoolCode ?? "").trim();
      if (!code || code === "*") {
        showToast("Code établissement requis pour générer le matricule élève", "error");
        return;
      }
      const matriculeInfo = resolveStudentMatricule(
        preparedItem,
        code,
        (state.students ?? []) as Record<string, unknown>[],
      );
      preparedItem = {
        ...preparedItem,
        matricule: matriculeInfo.matricule,
        publicId: matriculeInfo.publicId,
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
    const patch: Partial<BackOfficeState> = buildPedagogyPatch(module.key, nextItem, nextAllRows);

    if (module.key === "teachers" && patch.teachers) {
      const savedTeacher = (patch.teachers as Record<string, unknown>[]).find(
        (row) => String(row.id ?? "") === String(nextItem.id ?? ""),
      );
      if (savedTeacher) {
        patch.users = syncTeacherProfileToUser(state.users, savedTeacher);
      }
    }

    // La synchro pédagogique reconstruit certaines affectations : on réapplique
    // les champs métier (période, salle) sur la ligne enregistrée (AFF-001).
    if (module.key === "assignments" && patch.assignments) {
      const targetId = String(nextItem.id ?? "");
      const period = String((nextItem as Record<string, unknown>).period ?? "");
      const room = String((nextItem as Record<string, unknown>).room ?? "");
      patch.assignments = (patch.assignments as Record<string, unknown>[]).map((row) =>
        String(row.id) === targetId ? { ...row, period, room } : row,
      ) as BackOfficeState["assignments"];
    }

    let successMessage = exists ? `${module.label} modifié` : `${module.label} créé`;

    // RB-003 / CONTACT-004 : aucun compte utilisateur n'est créé hors du
    // sous-module Contacts. Les fiches enseignant se provisionnent uniquement
    // depuis un contact (linkContactToOperationalRecord).

    const nextContact = nextItem as Record<string, unknown>;
    let contactPromotion: ReturnType<typeof promoteContactToUser> | null = null;
    if (module.key === "contacts" && String(nextContact.hasAccess ?? "") === "Non") {
      const revoked = revokeContactUserAccess(
        nextContact,
        { ...state, ...patch, [module.key]: nextAllRows } as unknown as BackOfficeState,
      );
      patch.users = revoked.users;
      patch.contacts = (
        (patch.contacts as unknown as Record<string, unknown>[] | undefined) ?? nextAllRows
      ).map((row) => (String(row.id) === String(nextContact.id) ? revoked.contact : row)) as unknown as BackOfficeState["contacts"];
    }
    if (module.key === "contacts" && String(nextContact.hasAccess ?? "") === "Oui") {
      try {
        contactPromotion = promoteContactToUser(nextContact, state, scopeUser);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Création du compte impossible.", "error");
        return;
      }
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

    if (module.key === "relations") {
      const currentRelations =
        (patch.relations as unknown as Record<string, unknown>[] | undefined) ?? nextAllRows;
      patch.relations = enforceSinglePrincipalParent(
        currentRelations,
        nextItem as Record<string, unknown>,
      ) as unknown as BackOfficeState["relations"];
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

    if (AUDITED_ENTITY_KEYS.has(module.key)) {
      patch.auditLog = appendAuditLog(
        state.auditLog,
        makeAuditEntry({
          ...auditActor(scopeUser),
          action: `${module.key}.${exists ? "update" : "create"}`,
          entityType: module.key,
          entityId: String(nextItem.id ?? ""),
          entityLabel: auditEntityLabel(module.key, nextItem as Record<string, unknown>) || undefined,
          schoolCode: String((nextItem as Record<string, unknown>).schoolCode ?? "") || undefined,
        }),
      );
    }

    if (module.key === "students" && !exists) {
      patch.studentFees = applyActiveGridsToStudent(
        { ...state, ...patch, students: adaptLegacyStudents(nextAllRows) },
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

    if (module.key === "relations" && isParentChildMode && isParentChildBundleRow(row)) {
      const fromContactId = String(row.fromContactId ?? "").trim();
      const nextRelations = removeParentChildBundle(
        (state.relations ?? []) as unknown as Record<string, unknown>[],
        fromContactId,
      );
      try {
        await persistPatch(
          {
            relations: nextRelations as unknown as BackOfficeState["relations"],
            auditLog: appendAuditLog(
              state.auditLog,
              makeAuditEntry({
                ...auditActor(scopeUser),
                action: "relation.delete",
                entityType: "relation",
                entityId: fromContactId,
                entityLabel: String(row.fromContactName ?? "") || undefined,
                schoolCode: String(row.schoolCode ?? "") || undefined,
              }),
            ),
          },
          "Liaisons parent-enfant supprimées",
        );
      } catch {
        /* toast déjà affiché */
      }
      return;
    }

    if (module.key === "classes") {
      const result = removeSchoolClassFromState(state, row, schoolCode);
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      const classPatch: Partial<BackOfficeState> = {
        ...result.patch,
        auditLog: appendAuditLog(
          state.auditLog,
          makeAuditEntry({
            ...auditActor(scopeUser),
            action: "classes.delete",
            entityType: "classes",
            entityId: String(row.id ?? ""),
            entityLabel: auditEntityLabel("classes", row) || undefined,
            schoolCode: String(row.schoolCode ?? "") || undefined,
          }),
        ),
      };
      try {
        await persistPatch(classPatch, "Classe supprimée");
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
    } else if (AUDITED_ENTITY_KEYS.has(module.key)) {
      deletePatch.auditLog = appendAuditLog(
        state.auditLog,
        makeAuditEntry({
          ...auditActor(scopeUser),
          action: `${module.key}.delete`,
          entityType: module.key,
          entityId: String(row.id ?? ""),
          entityLabel: auditEntityLabel(module.key, row) || undefined,
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

  async function handleCreateFicheFromContact() {
    if (!module || !linkContactId) return;
    const selection = parseTeacherProvisioningSelection(linkContactId);
    if (!selection) {
      showToast("Sélection invalide.", "error");
      return;
    }

    if (selection.kind === "user") {
      const user = state.users.find((row) => String(row.id ?? "") === selection.id);
      if (!user) {
        showToast("Compte utilisateur introuvable.", "error");
        return;
      }
      const teacherPatch = syncSingleUserToTeachers(state, user);
      const linkedTeacher = (teacherPatch.teachers as Record<string, unknown>[]).find(
        (row) => String(row.userId ?? "") === String(user.id ?? ""),
      );
      const patch: Partial<BackOfficeState> = {
        teachers: teacherPatch.teachers as unknown as BackOfficeState["teachers"],
      };
      patch.auditLog = appendAuditLog(
        state.auditLog,
        makeAuditEntry({
          ...auditActor(scopeUser),
          action: "teacher.create",
          entityType: "teacher",
          entityId: String(linkedTeacher?.id ?? ""),
          entityLabel: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || undefined,
          schoolCode: String(user.schoolCode ?? "") || undefined,
          details: "Fiche créée depuis un compte utilisateur",
        }),
      );
      try {
        await persistPatch(patch, `${module.label} créé depuis le compte utilisateur`);
        setLinkContactOpen(false);
        setLinkContactId("");
      } catch {
        /* toast déjà affiché */
      }
      return;
    }

    const contact = ((state.contacts ?? []) as unknown as Record<string, unknown>[]).find(
      (row) => String(row.id) === selection.id,
    );
    if (!contact) {
      showToast("Contact introuvable.", "error");
      return;
    }
    const link = linkContactToOperationalRecord(contact, state, effectiveSchoolCode);
    if (!link.linkedType) {
      showToast("Ce contact ne peut pas être relié à une fiche.", "error");
      return;
    }
    const patch: Partial<BackOfficeState> = {};
    if (link.students) patch.students = link.students as unknown as BackOfficeState["students"];
    if (link.teachers) patch.teachers = link.teachers as unknown as BackOfficeState["teachers"];
    patch.contacts = ((state.contacts ?? []) as unknown as Record<string, unknown>[]).map((row) =>
      String(row.id) === selection.id ? link.contact : row,
    ) as unknown as BackOfficeState["contacts"];
    const label = `${String(contact.lastName ?? "")} ${String(contact.firstName ?? "")}`.trim();
    patch.auditLog = appendAuditLog(
      state.auditLog,
      makeAuditEntry({
        ...auditActor(scopeUser),
        action: `${link.linkedType}.${link.created ? "create" : "link"}`,
        entityType: link.linkedType,
        entityId: link.linkedRecordId,
        entityLabel: label || undefined,
        schoolCode: String(contact.schoolCode ?? "") || undefined,
        details: link.created
          ? "Fiche créée depuis un contact existant"
          : "Fiche existante reliée au contact",
      }),
    );
    try {
      await persistPatch(
        patch,
        link.created ? `${module.label} créé depuis le contact` : "Fiche reliée au contact",
      );
      setLinkContactOpen(false);
      setLinkContactId("");
    } catch {
      /* toast déjà affiché */
    }
  }

  async function handleAssignmentSubmit(event: FormEvent) {
    event.preventDefault();
    if (!assignmentModule || !editingAssignment || !teacherAssignmentContext) return;

    const teachers = scopedTeachers(scopeUser, state);
    const linkedTeacher =
      teachers.find((row) => String(row.id) === String(teacherAssignmentContext.id ?? "")) ??
      teachers.find((row) =>
        [row.publicId, row.identifier, row.userId, row.contactId].some(
          (value) => String(value ?? "") === String(teacherAssignmentContext.id ?? ""),
        ),
      ) ??
      teacherAssignmentContext;

    const workingItem = prepareAssignmentForSave(
      {
        ...editingAssignment,
        teacherId: String(linkedTeacher.id ?? teacherAssignmentContext.id ?? ""),
      },
      teachers,
      effectiveSchoolCode,
      state,
      scopeUser,
    );

    const missingRequired = assignmentModule.fields.find(
      (field) => field.required && !String(workingItem[field.key] ?? "").trim(),
    );
    if (missingRequired) {
      showToast(`${missingRequired.label} est obligatoire`, "error");
      return;
    }

    const conflict = validateAssignmentConflict(
      workingItem,
      scopedAssignmentsList,
      scopedCourses(scopeUser, state),
      scopedClasses(scopeUser, state),
      teachers,
      editingAssignment.id ? String(editingAssignment.id) : undefined,
      state,
      effectiveSchoolCode,
    );
    if (conflict) {
      showToast(conflict, "error");
      return;
    }

    const scopedItem = applySchoolScopeToItem(
      "assignments",
      workingItem,
      effectiveSchoolCode,
      state,
    );
    const current = getScopedEntityRows("assignments", scopeUser, state);
    const exists =
      Boolean(scopedItem.id) && current.some((row) => String(row.id) === String(scopedItem.id));

    if (exists && !assignmentPermissions.canUpdate) {
      showToast("Modification des affectations non autorisée pour votre rôle.", "error");
      return;
    }
    if (!exists && !assignmentPermissions.canCreate) {
      showToast("Création d'affectation non autorisée pour votre rôle.", "error");
      return;
    }

    const nextItem = exists
      ? scopedItem
      : {
          ...scopedItem,
          id: String(scopedItem.id ?? newId("ASSIGNMENT")),
        };

    const mergeResult = mergeScopedEntityRows("assignments", scopeUser, state, nextItem);
    if (!mergeResult.applied) {
      showToast("Modification refusée : affectation hors périmètre de l'établissement.", "error");
      return;
    }

    const pedagogyPatch = buildPedagogyPatch("assignments", nextItem, mergeResult.rows);
    const targetId = String(nextItem.id ?? "");
    const period = String(nextItem.period ?? "");
    const room = String(nextItem.room ?? "");
    const patch: Partial<BackOfficeState> = {
      assignments: pedagogyPatch.assignments,
      courses: pedagogyPatch.courses,
      teachers: pedagogyPatch.teachers,
    };
    if (patch.assignments) {
      patch.assignments = (patch.assignments as Record<string, unknown>[]).map((row) =>
        String(row.id) === targetId ? { ...row, period, room } : row,
      ) as BackOfficeState["assignments"];
    }
    patch.auditLog = appendAuditLog(
      state.auditLog,
      makeAuditEntry({
        ...auditActor(scopeUser),
        action: exists ? "assignments.update" : "assignments.create",
        entityType: "assignments",
        entityId: targetId,
        entityLabel: auditEntityLabel("assignments", nextItem) || undefined,
        schoolCode: String(nextItem.schoolCode ?? "") || undefined,
      }),
    );

    try {
      await persistPatch(patch, exists ? "Affectation modifiée" : "Affectation créée");
      setTeacherAssignmentContext({ ...linkedTeacher });
      setEditingAssignment({
        teacherId: String(linkedTeacher.id ?? ""),
        className: "",
        subject: "",
      });
    } catch {
      /* toast déjà affiché */
    }
  }

  async function handleDeleteAssignment(assignment: Record<string, unknown>) {
    const canRemove = assignmentPermissions.canUpdate || assignmentPermissions.canDelete;
    if (!assignment.id || !canRemove) {
      showToast("Retrait non autorisé pour votre rôle.", "error");
      return;
    }
    const className = String(assignment.className ?? "").trim();
    const subject = String(assignment.subject ?? assignment.course ?? "").trim();
    const confirmed = await confirm({
      title: "Retirer cette affectation ?",
      description:
        className && subject
          ? `Retirer la matière « ${subject} » pour la classe ${className} ?`
          : "Retirer cette affectation enseignant ↔ classe ↔ matière ?",
      confirmLabel: "Retirer",
      tone: "danger",
    });
    if (!confirmed) return;

    const nextAllRows = deleteScopedEntityRow(
      "assignments",
      scopeUser,
      state,
      String(assignment.id),
    );
    if (nextAllRows.length === ((state.assignments ?? []) as unknown[]).length) {
      showToast("Suppression refusée : affectation hors périmètre ou introuvable.", "error");
      return;
    }

    const pedagogyPatch = buildPedagogyPatch("assignments", assignment, nextAllRows);
    const patch: Partial<BackOfficeState> = {
      assignments: nextAllRows as BackOfficeState["assignments"],
      courses: pedagogyPatch.courses,
    };
    if (teacherAssignmentContext) {
      const remaining = listTeacherAssignments(teacherAssignmentContext, nextAllRows);
      const embedded = remaining.map((row) => ({
        className: row.className,
        course: row.subject ?? row.course,
      }));
      patch.teachers = ((state.teachers ?? []) as Record<string, unknown>[]).map((teacher) =>
        String(teacher.id) === String(teacherAssignmentContext.id ?? "")
          ? { ...teacher, assignments: embedded }
          : teacher,
      ) as BackOfficeState["teachers"];
    }
    patch.auditLog = appendAuditLog(
      state.auditLog,
      makeAuditEntry({
        ...auditActor(scopeUser),
        action: "assignments.delete",
        entityType: "assignments",
        entityId: String(assignment.id ?? ""),
        entityLabel: auditEntityLabel("assignments", assignment) || undefined,
        schoolCode: String(assignment.schoolCode ?? "") || undefined,
      }),
    );

    try {
      await persistPatch(patch, "Affectation retirée");
      if (String(editingAssignment?.id ?? "") === String(assignment.id)) {
        setEditingAssignment({
          teacherId: String(teacherAssignmentContext?.id ?? ""),
          className: "",
          subject: "",
        });
      }
    } catch {
      /* toast déjà affiché */
    }
  }

  const displayColumns = isParentChildMode ? PARENT_CHILD_COLUMNS : module.columns;
  const displayFields = isParentChildMode
    ? module.fields.filter((field) => !PARENT_CHILD_HIDDEN_FIELDS.has(field.key))
    : module.fields;

  const dataColumns: Column<Record<string, unknown>>[] = displayColumns.map((key) => ({
    key,
    header: relationColumnHeader(key, module, isParentChildMode),
    render: (row: Record<string, unknown>) => {
      if (module.key === "relations" && key === "fromContactName") {
        const account = ((state.users ?? []) as unknown as Record<string, unknown>[]).find(
          (item) => String(item.id ?? "") === String(row.fromContactId ?? ""),
        );
        if (account) return formatContactPersonName(account);
      }
      if (module.key === "relations" && key === "toStudentName") {
        if (isParentChildMode) {
          const storedNames = splitParentChildStudentNames(String(row.toStudentName ?? ""));
          if (storedNames.length) return renderSeparatedStudentNames(storedNames);
          const studentIds = Array.isArray(row.toStudentIds)
            ? (row.toStudentIds as string[]).map(String).filter(Boolean)
            : String(row.toStudentId ?? "").trim()
              ? [String(row.toStudentId)]
              : [];
          const labels = studentIds
            .map((studentId) => {
              const student = ((state.students ?? []) as Record<string, unknown>[]).find(
                (item) => String(item.id ?? "") === studentId,
              );
              return student ? formatStudentPersonName(student) : "";
            })
            .filter(Boolean);
          return renderSeparatedStudentNames(labels);
        }
        const student = ((state.students ?? []) as Record<string, unknown>[]).find(
          (item) => String(item.id ?? "") === String(row.toStudentId ?? ""),
        );
        if (student) return formatStudentPersonName(student);
      }
      if (module.key === "teachers" && key === "publicId") {
        const publicId = String(row.publicId ?? "").trim();
        if (!publicId) return "—";
        return `${publicId} · connexion : ${getTeacherLoginIdentifier(publicId)}`;
      }
      if (module.key === "teachers" && key === "assignmentsSummary") {
        const teacherAssignments = listTeacherAssignments(row, scopedAssignmentsList);
        return formatTeacherAssignmentsSummary(teacherAssignments);
      }
      return String(row[key] ?? "—");
    },
  }));

  if (module.key === "classes") {
    dataColumns.push({
      key: "studentCount",
      header: "Effectif",
      render: (row) => {
        const count = scopedStudentsList.filter(
          (student) => normalize(String(student.className ?? "")) === normalize(String(row.name ?? "")),
        ).length;
        return String(count);
      },
    });
  }

  const columns: Column<Record<string, unknown>>[] = [
    ...dataColumns,
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
              {module.key === "classes" && studentsPermissions.canRead ? (
                <Link
                  to={`/etablissement/classes/${encodeURIComponent(String(row.name ?? ""))}/eleves`}
                  className="inline-flex"
                >
                  <Button variant="secondary" size="sm" type="button">
                    Élèves
                  </Button>
                </Link>
              ) : null}{module.key === "students" && row.id ? (
  <Link
    to={`/etablissement/eleves/${encodeURIComponent(String(row.id))}`}
    className="inline-flex"
  >
    <Button variant="secondary" size="sm" type="button">
      Dossier
    </Button>
  </Link>
) : null}
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
                        : module.key === "relations" && isParentChildMode
                          ? parentChildBundleToForm(row)
                          : module.key === "teachers"
                            ? normalizeTeacherFormRow({ ...row })
                            : { ...row };
                    setEditing(next);
                  }}
                >
                  Modifier
                </Button>
              ) : null}
              {module.key === "teachers" &&
              (assignmentPermissions.canCreate || assignmentPermissions.canUpdate) ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setTeacherAssignmentContext({ ...row });
                    setEditingAssignment({
                      teacherId: String(row.id ?? ""),
                      className: "",
                      subject: "",
                    });
                  }}
                >
                  Affecter
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

  const listTitle = classScope
    ? `Élèves — ${classScope}`
    : isParentChildMode
      ? "Relations parent-enfant"
      : module.label;

  const listDescription = classScope
    ? `Inscription et dossiers des élèves de la classe ${classScope}.`
    : isParentChildMode
      ? school
        ? `Liez un parent à un ou plusieurs élèves. Périmètre : ${school.name} (${school.code})`
        : "Liez un parent à un ou plusieurs élèves de l'établissement."
      : school
        ? `${module.description} · Périmètre : ${school.name} (${school.code})`
        : module.description;

  const secondaryActions = (
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
      <Button
        variant="secondary"
        size="sm"
        onClick={handleExportExcel}
        disabled={rows.length === 0}
      >
        Exporter Excel
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
    </>
  );

  const primaryActions = (
    <>
      {module.key === "payments" && canCreate ? (
        <Button size="sm" onClick={() => setQuickPaymentOpen(true)}>
          Saisie rapide
        </Button>
      ) : null}
      {linkableContactKind && canUpdate ? (
        <Button
          size="sm"
          disabled={busy || linkableProvisioningOptions.length === 0}
          onClick={() => {
            setLinkContactId("");
            setLinkContactOpen(true);
          }}
        >
          {linkableContactKind === "teacher"
            ? "Créer la fiche depuis un compte"
            : "Ajouter depuis un contact"}
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
                isPrincipal: "Oui",
                toStudentIds: [],
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
            if (module.key === "students" && classScope) {
              setEditing({ className: classScope });
              return;
            }
            setEditing({});
          }}
        >
          {isParentChildMode ? "Lier un parent" : "Ajouter"}
        </Button>
      ) : null}
    </>
  );

  const listAlerts = (
    <>
      {module.planningManaged ? (
        <InlineAlert tone="info">
          Les dates, horaires et classes se planifient dans{" "}
          <Link to="/planning" className="font-semibold text-brand underline">
            Planning de cours
          </Link>
          . Cet écran sert au suivi des statuts et à la publication des résultats.
        </InlineAlert>
      ) : null}
      {entityCreateViaContactsOnly(module.key) ? (
        <InlineAlert tone="warning">
          Pour créer un compte ou une fiche, utilisez{" "}
          <Link
            to="/etablissement/comptes-utilisateurs"
            className="font-semibold text-brand underline"
          >
            Comptes utilisateurs
          </Link>{" "}
          (type Élève, Enseignant, etc.). Cet écran sert à consulter et mettre à jour les dossiers
          existants.
        </InlineAlert>
      ) : null}
    </>
  );

  return (
    <>
      <EntityListShell
        title={listTitle}
        description={listDescription}
        orientation={
          classScope ? (
            <Link
              to="/etablissement/classes"
              className="inline-flex font-semibold text-brand hover:underline"
            >
              ← Retour aux classes
            </Link>
          ) : null
        }
        secondaryActions={secondaryActions}
        primaryActions={primaryActions}
        alerts={listAlerts}
        filters={
          <EntityListSearch
            placeholder={`Rechercher dans ${module.label.toLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
      >
        {/* EmptyState DS générique (D3.2b / D3.3) — aucune branche par entité. */}
        {rows.length === 0 ? (
          <EmptyState
            title={search.trim() ? "Aucun résultat" : "Liste vide"}
            description={
              search.trim()
                ? "Aucun élément ne correspond à votre recherche."
                : `Aucun élément à afficher dans ${module.label.toLowerCase()}.`
            }
          />
        ) : (
          <EntityListTable
            columns={columns}
            rows={rows}
            rowKey={(row, index) => String(row.id ?? index)}
          />
        )}
      </EntityListShell>

      <Modal
        open={linkContactOpen}
        onClose={() => setLinkContactOpen(false)}
        title={
          linkableContactKind === "teacher"
            ? "Créer une fiche enseignant"
            : "Créer une fiche depuis un contact"
        }
        description={
          linkableContactKind === "teacher"
            ? "Sélectionnez un compte utilisateur (rôle Enseignant) sans fiche, ou un contact existant."
            : "Sélectionnez un compte utilisateur existant pour générer sa fiche."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setLinkContactOpen(false)}>
              Annuler
            </Button>
            <Button
              disabled={busy || !linkContactId}
              onClick={() => void handleCreateFicheFromContact()}
            >
              Créer la fiche
            </Button>
          </>
        }
      >
        {linkableProvisioningOptions.length === 0 ? (
          <p className="text-sm text-muted">
            Aucun compte éligible sans fiche. Créez d'abord un compte dans{" "}
            <Link to="/etablissement/comptes-utilisateurs" className="font-semibold text-brand underline">
              Comptes utilisateurs
            </Link>
            .
          </p>
        ) : (
          <Field
            label={linkableContactKind === "teacher" ? "Compte ou contact" : "Contact"}
            htmlFor="link-contact-select"
          >
            <Select
              id="link-contact-select"
              value={linkContactId}
              onChange={(event) => setLinkContactId(event.target.value)}
              options={[
                { value: "", label: "Choisir…" },
                ...linkableProvisioningOptions,
              ]}
            />
          </Field>
        )}
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={
          editing?.id
            ? `Modifier — ${isParentChildMode ? "liaison parent-enfant" : module.label}`
            : isParentChildMode
              ? "Lier un parent à ses élèves"
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
              const fieldLocked =
                Boolean(field.readOnly) ||
                (Boolean(classScope) && module.key === "students" && field.key === "className");
              return (
              <Field key={field.key} label={fieldLabel} htmlFor={field.key} hint={field.hint} required={field.required}>
                {field.inputType === "select" ? (
                  <Select
                    id={field.key}
                    value={String(editing[field.key] ?? "")}
                    disabled={fieldLocked}
                    required={field.required}
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
                      if (
                        isParentChildMode &&
                        module.key === "relations" &&
                        field.key === "fromContactId"
                      ) {
                        const linked = getParentLinkedStudentIds(
                          (state.relations ?? []) as unknown as Record<string, unknown>[],
                          value,
                        );
                        setEditing({
                          ...editing,
                          fromContactId: value,
                          toStudentIds:
                            linked.length > 0
                              ? linked
                              : Array.isArray(editing.toStudentIds)
                                ? editing.toStudentIds
                                : [],
                        });
                        setPendingParentStudentId("");
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
                  <DatePicker
                    id={field.key}
                    value={periodDateToInput(String(editing[field.key] ?? ""))}
                    required={field.required}
                    readOnly={fieldLocked}
                    disabled={fieldLocked}
                    onChange={(v) =>
                      setEditing({ ...editing, [field.key]: inputToPeriodDate(v) })
                    }
                  />
                ) : (
                  <Input
                    id={field.key}
                    value={String(editing[field.key] ?? "")}
                    placeholder={field.placeholder}
                    required={field.required}
                    readOnly={fieldLocked}
                    onChange={(e) => setEditing({ ...editing, [field.key]: e.target.value })}
                  />
                )}
              </Field>
              );
            })}
            {isParentChildMode ? (
              <Field
                label="Élève(s)"
                htmlFor="parent-child-student-picker"
                hint="Choisissez un élève dans la liste, puis cliquez sur Ajouter. Répétez pour lier plusieurs enfants au même parent."
                required
              >
                {!String(editing.fromContactId ?? "").trim() ? (
                  <p className="text-sm text-muted">Sélectionnez d&apos;abord un parent.</p>
                ) : parentStudentOptions.length === 0 ? (
                  <p className="text-sm text-muted">Aucun élève disponible dans cet établissement.</p>
                ) : (
                  <div id="parent-child-students" className="space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Select
                        id="parent-child-student-picker"
                        className="min-w-0 flex-1"
                        value={pendingParentStudentId}
                        disabled={availableParentStudentOptions.length === 0}
                        onChange={(event) => setPendingParentStudentId(event.target.value)}
                        options={[
                          {
                            value: "",
                            label:
                              availableParentStudentOptions.length === 0
                                ? "Tous les élèves sont déjà liés"
                                : "Choisir un élève…",
                          },
                          ...availableParentStudentOptions,
                        ]}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!pendingParentStudentId}
                        onClick={() => {
                          if (!pendingParentStudentId) return;
                          setEditing({
                            ...editing,
                            toStudentIds: [...selectedParentStudentIds, pendingParentStudentId],
                          });
                          setPendingParentStudentId("");
                        }}
                      >
                        Ajouter
                      </Button>
                    </div>
                    {selectedParentStudentLabels.length > 0 ? (
                      <ul className="max-h-40 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-slate-50/60">
                        {selectedParentStudentLabels.map((student) => (
                          <li
                            key={student.id}
                            className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-ink"
                          >
                            <span>{student.label}</span>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setEditing({
                                  ...editing,
                                  toStudentIds: selectedParentStudentIds.filter(
                                    (id) => id !== student.id,
                                  ),
                                });
                              }}
                            >
                              Retirer
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted">Aucun élève lié pour le moment.</p>
                    )}
                  </div>
                )}
              </Field>
            ) : null}
            {isParentChildMode && getRelationParentUserOptions(scopeUser, state).length === 0 ? (
              <p className="text-xs text-muted">
                Aucun compte parent. Créez d&apos;abord un compte Parent dans{" "}
                <Link to="/etablissement/comptes-utilisateurs" className="font-semibold text-brand underline">
                  Mon établissement → Comptes utilisateurs
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

      {module.key === "teachers" && assignmentModule ? (
        <Modal
          open={Boolean(teacherAssignmentContext)}
          onClose={() => {
            setTeacherAssignmentContext(null);
            setEditingAssignment(null);
          }}
          title={
            teacherAssignmentContext
              ? `Affectations — ${getTeacherDisplayName(teacherAssignmentContext)}`
              : "Affectations"
          }
          description="Associez cet enseignant à une ou plusieurs classes et matières."
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setTeacherAssignmentContext(null);
                  setEditingAssignment(null);
                }}
              >
                Fermer
              </Button>
              {editingAssignment &&
              (editingAssignment.id
                ? assignmentPermissions.canUpdate
                : assignmentPermissions.canCreate) ? (
                <Button form="teacher-assignment-form" type="submit" disabled={busy}>
                  Enregistrer
                </Button>
              ) : null}
            </>
          }
        >
          {teacherAssignmentContext ? (
            <div className="space-y-4">
              {(() => {
                const teacherAssignments = listTeacherAssignments(
                  teacherAssignmentContext,
                  scopedAssignmentsList,
                );
                if (!teacherAssignments.length) {
                  return (
                    <p className="text-sm text-muted">Aucune affectation pour cet enseignant.</p>
                  );
                }
                return (
                  <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">
                      Affectations actuelles
                    </p>
                    {teacherAssignments.map((assignment) => (
                      <div
                        key={String(assignment.id ?? "")}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2"
                      >
                        <span className="text-sm font-semibold text-ink">
                          {[assignment.className, assignment.subject ?? assignment.course]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {assignmentPermissions.canUpdate ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                setEditingAssignment(
                                  normalizeAssignmentForm(
                                    { ...assignment },
                                    scopedTeachers(scopeUser, state),
                                  ),
                                )
                              }
                            >
                              Modifier
                            </Button>
                          ) : null}
                          {assignmentPermissions.canUpdate || assignmentPermissions.canDelete ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={busy}
                              onClick={() => void handleDeleteAssignment(assignment)}
                            >
                              Retirer
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {assignmentPermissions.canCreate || assignmentPermissions.canUpdate ? (
                <form
                  id="teacher-assignment-form"
                  onSubmit={(event) => void handleAssignmentSubmit(event)}
                  className="grid gap-4 border-t border-line pt-4"
                >
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">
                    {editingAssignment?.id ? "Modifier l'affectation" : "Nouvelle affectation"}
                  </p>
                  {assignmentModule.fields
                    .filter((field) => field.key !== "teacherId")
                    .map((field) => (
                      <Field key={field.key} label={field.label} htmlFor={`ta-${field.key}`} hint={field.hint} required={field.required}>
                        {field.inputType === "select" ? (
                          <Select
                            id={`ta-${field.key}`}
                            value={String(editingAssignment?.[field.key] ?? "")}
                            required={field.required}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (field.key === "className") {
                                setEditingAssignment((current) => ({
                                  ...(current ?? {
                                    teacherId: String(teacherAssignmentContext.id ?? ""),
                                  }),
                                  className: value,
                                  subject: "",
                                }));
                                return;
                              }
                              setEditingAssignment((current) => ({
                                ...(current ?? {
                                  teacherId: String(teacherAssignmentContext.id ?? ""),
                                }),
                                [field.key]: value,
                              }));
                            }}
                            options={[
                              { value: "", label: field.placeholder ?? "Choisir…" },
                              ...getTeacherAssignmentFieldOptions(field),
                            ]}
                          />
                        ) : (
                          <Input
                            id={`ta-${field.key}`}
                            value={String(editingAssignment?.[field.key] ?? "")}
                            placeholder={field.placeholder}
                            required={field.required}
                            onChange={(event) =>
                              setEditingAssignment((current) => ({
                                ...(current ?? {
                                  teacherId: String(teacherAssignmentContext.id ?? ""),
                                }),
                                [field.key]: event.target.value,
                              }))
                            }
                          />
                        )}
                      </Field>
                    ))}
                  {!String(editingAssignment?.className ?? "") ? (
                    <p className="text-xs text-muted">
                      Sélectionnez d'abord une classe pour voir les matières disponibles.
                    </p>
                  ) : null}
                  {editingAssignment?.id && assignmentPermissions.canCreate ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setEditingAssignment({
                          teacherId: String(teacherAssignmentContext.id ?? ""),
                          className: "",
                          subject: "",
                        })
                      }
                    >
                      Nouvelle affectation
                    </Button>
                  ) : null}
                </form>
              ) : null}
            </div>
          ) : null}
        </Modal>
      ) : null}

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
            <Field label="Motif d'annulation" required>
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
