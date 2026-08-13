import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
} from "@/design-system";
import {
  buildEntityColumns,
  PARENT_CHILD_HIDDEN_FIELDS,
} from "./entity-page/entityColumns";
import {
  appendGenericDeleteAudit,
  appendGenericMutationAudit,
  applyEntitySchoolScope,
  deleteEntityFromState,
  ENTITY_DELETED_MESSAGE,
  ENTITY_OUT_OF_SCOPE_DELETE_MESSAGE,
  ENTITY_OUT_OF_SCOPE_SAVE_MESSAGE,
  entityMutationSuccessMessage,
  mergeEntityIntoState,
  newEntityId,
  persistEntityPatch,
  prepareEntityRowForSave,
} from "./entity-page/entityCrudCore";
import {
  resolveEntitySelectOptions,
  resolveTeacherAssignmentFieldOptions,
} from "./entity-page/entitySelectOptions";
import {
  buildContactDeleteAuditEntry,
  buildContactImportPlan,
  buildContactMutationAuditEntries,
  buildContactPasswordResetGate,
  buildContactPostMergePlan,
  buildContactPreSubmitPlan,
  buildCreateFicheFromSelectionPlan,
  defaultNewContactDraft,
} from "./entity-page/contactAccountWorkflow";
import {
  addParentChildStudentId,
  applyParentContactChange,
  buildParentChildBundleDeletePlan,
  buildParentChildBundleSubmitPlan,
  buildRelationDeleteAuditEntry,
  buildRelationPostMergePlan,
  buildRelationPreSubmitPlan,
  defaultNewRelationDraft,
  filterAvailableParentStudentOptions,
  removeParentChildStudentId,
  resolveSelectedParentStudentIds,
  resolveSelectedParentStudentLabels,
} from "./entity-page/parentChildRelationWorkflow";
import {
  buildPaymentCancelPlan,
  buildPaymentReceiptPrintPlan,
} from "./entity-page/paymentWorkflow";
import {
  buildTeacherAssignmentDeleteConfirmCopy,
  buildTeacherAssignmentDeletePlan,
  buildTeacherAssignmentSubmitPlan,
  emptyEditingAssignment,
  reapplyAssignmentPeriodRoom,
} from "./entity-page/teacherAssignmentWorkflow";
import { PrintButton } from "../components/ui/PrintButton";
import { Field, Input, Select } from "../components/ui/Field";
import { DatePicker } from "../components/ui/DatePicker";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { usePrompt } from "../components/ui/PromptDialog";
import { usePermissionContext } from "../lib/usePermissionContext";
import { getEntityFeaturePermissions, canResetTargetUserPassword } from "../lib/permissions";
import {
  getEntityModule,
  getScopedEntityRows,
  entityCreateViaContactsOnly,
  type SchoolEntityKey,
} from "../lib/entityModules";
import { applyActiveGridsToStudent } from "../lib/fees";
import { adaptLegacyStudents } from "../lib/studentDomain";
import {
  getTeacherProvisioningOptions,
  syncSingleUserToTeachers,
  syncTeacherProfileToUser,
} from "../lib/userTeacherSync";
import {
  getAssignmentSelectOptions,
  listTeacherAssignments,
  normalizeAssignmentForm,
  prepareAssignmentForSave,
  validateAssignmentConflict,
} from "../lib/assignments";
import { getLinkableContactOptions } from "../lib/contacts";
import {
  findUserAccountForContact,
  resetUserAccountPassword,
} from "../lib/userAccounts";
import { validatePasswordPolicy } from "../lib/userAccountRules";
import {
  getRelationParentUserOptions,
  getRelationStudentOptions,
  groupParentChildRelations,
  isParentChildBundleRow,
  parentChildBundleToForm,
} from "../lib/relations";
import { csvToObjects, downloadCsv, downloadExcel, rowsToCsv } from "../lib/csv";
import {
  validateTeacherDeletion,
  validateTeacherIdentityDuplicate,
  validateTeacherSchoolEntry,
} from "../lib/teacherRules";
import { markAllAnnouncementsRead } from "../lib/announcementsRead";
import { normalize, isSchoolAdminRole } from "../lib/format";
import { isSuperAdminRole } from "../lib/orgHierarchy";
import { inputToPeriodDate, normalizePeriodDate, periodDateToInput } from "../lib/dates";
import { subscriptionFeatureBlocked, type SubscriptionFeature } from "../lib/subscriptionAccessClient";
import { appendAuditLog } from "../lib/audit";
import { validateCourseTeacherRule } from "../lib/pedagogyGovernance";
import { QuickPaymentModal } from "../components/payments/QuickPaymentModal";
import { PaymentReceipt } from "../components/payments/PaymentReceipt";
import { type PaymentRecord } from "../lib/quickPayment";
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
import { getSchoolAcademicLists } from "../lib/academicConfig";
import {
  generateTeacherIdentifiers,
  getTeacherLoginIdentifier,
  resolveStudentMatricule,
  resolveTeacherIdentifiers,
} from "../lib/entityIdentifiers";

function normalizeTeacherFormProps(row: Record<string, unknown>): Record<string, unknown> {
  const next = { ...row };
  if (!String(next.identifier ?? "").trim() && String(next.publicId ?? "").trim()) {
    next.identifier = getTeacherLoginIdentifier(String(next.publicId));
  }
  return next;
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
  /** Limite la liste et la création à une classe (gestion depuis Classes). */
  classScope?: string;
  /** Masque le bouton d'ajout (ex. liste générale élèves en consultation). */
  disableCreate?: boolean;
}

/**
 * Clôture CRUD legacy Classes : redirection hors EntityPage, sans Hooks conditionnels.
 */
export function EntityPage(props: EntityPageProps) {
  if (props.entity === "classes") {
    return <Navigate to="/etablissement/classes" replace />;
  }
  return <EntityPageContent {...props} />;
}

function EntityPageContent({ entity, mode, classScope, disableCreate = false }: EntityPageProps) {
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
    module?.key !== "students" &&
    !disableCreate &&
    !module?.planningManaged &&
    module?.key !== "payments" &&
    !entityCreateViaContactsOnly(module?.key ?? "");
  const allowDelete =
    canDelete &&
    module?.key !== "students" &&
    !module?.planningManaged &&
    module?.key !== "payments";

  // ELEVE-001 / ENS-001 : créer une fiche à partir d'un contact existant.
  const linkableContactKind: "student" | "teacher" | null =
    module?.key === "teachers" ? "teacher" : null;
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
  const selectedParentStudentIds = useMemo(
    () => resolveSelectedParentStudentIds(editing),
    [editing],
  );
  const availableParentStudentOptions = useMemo(
    () => filterAvailableParentStudentOptions(parentStudentOptions, selectedParentStudentIds),
    [parentStudentOptions, selectedParentStudentIds],
  );
  const selectedParentStudentLabels = useMemo(
    () => resolveSelectedParentStudentLabels(selectedParentStudentIds, parentStudentOptions),
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
    return persistEntityPatch({ update, showToast, setBusy }, patch, message);
  }

  async function applyPlan(
    plan: { patch: Partial<BackOfficeState>; successMessage: string },
    onSuccess?: () => void,
  ) {
    try {
      await persistPatch(plan.patch, plan.successMessage);
      onSuccess?.();
    } catch {
      /* toast déjà affiché */
    }
  }

  function closeCancelModal() {
    setCancellingPayment(null);
    setCancelReason("");
  }

  async function handleResetContactPassword() {
    const gate = buildContactPasswordResetGate({
      editing,
      moduleKey: module?.key,
      users: state.users,
      canReset: (user) => canResetTargetUserPassword(ctx, user),
      showToast,
    });
    if (!gate.ok) return;
    const temporaryPassword = await prompt({
      title: "Mot de passe temporaire",
      description: `Définir un mot de passe temporaire pour ${gate.linkedUser.identifier}.`,
      defaultValue: "Soma1234",
      placeholder: "Mot de passe (min. 6 caractères)",
      inputType: "password",
      confirmLabel: "Réinitialiser",
      validate: (value) => validatePasswordPolicy(value),
    });
    if (!temporaryPassword) return;
    setBusy(true);
    try {
      const issued = await resetUserAccountPassword(gate.linkedUser, temporaryPassword);
      showToast(
        `Mot de passe réinitialisé · ${gate.linkedUser.identifier} · provisoire : ${issued}`,
        "success",
      );
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

    const plan = buildContactImportPlan(
      { state, scopeUser, showToast },
      {
        parsedRows: parsed,
        fallbackSchool: schoolCode && schoolCode !== "*" ? schoolCode : "",
      },
    );
    if (!plan.ok) return;
    await applyPlan(plan);
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
    if (module.key === "students") {
      showToast(
        "Utilisez Classes → Inscrire un élève ou la fiche élève PostgreSQL.",
        "error",
      );
      return;
    }

    if (module.key === "relations" && isParentChildMode) {
      const plan = buildParentChildBundleSubmitPlan(
        {
          scopeUser,
          state,
          showToast,
          createRelationId: () => newEntityId("RELATIONS"),
        },
        {
          editing,
          permissions: { canCreate, canUpdate },
        },
      );
      if (!plan.ok) return;
      await applyPlan(plan, () => setEditing(null));
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
      const identityError = validateTeacherIdentityDuplicate(
        workingItem,
        getScopedEntityRows("teachers", scopeUser, state),
        editing.id ? String(editing.id) : undefined,
      );
      if (identityError) {
        showToast(identityError, "error");
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
      const existingAssignmentRows = getScopedEntityRows("assignments", scopeUser, state);
      const conflict = validateAssignmentConflict(
        workingItem,
        existingAssignmentRows,
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

    if (module.key === "contacts") {
      const preSubmit = buildContactPreSubmitPlan(
        { state, showToast },
        {
          workingItem,
          editingId: editing.id ? String(editing.id) : undefined,
        },
      );
      if (!preSubmit.ok) return;
      workingItem = preSubmit.workingItem;
      if (preSubmit.duplicateWarn) {
        const proceed = await confirm({
          title: "Doublon potentiel",
          description: preSubmit.duplicateWarn,
          confirmLabel: "Créer quand même",
        });
        if (!proceed) return;
      }
    }

    if (module.key === "relations") {
      const preSubmit = buildRelationPreSubmitPlan(
        { state, scopeUser, showToast },
        {
          workingItem,
          editingId: editing.id ? String(editing.id) : undefined,
          forceParentChildType: isParentChildMode,
        },
      );
      if (!preSubmit.ok) return;
      workingItem = preSubmit.workingItem;
    }

    for (const field of module.fields) {
      if (field.inputType === "date" && !field.readOnly && workingItem[field.key]) {
        workingItem[field.key] = normalizePeriodDate(String(workingItem[field.key]));
      }
    }

    const scopedItem = applyEntitySchoolScope(module.key, workingItem, effectiveSchoolCode, state);
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

    const withId = prepareEntityRowForSave(
      preparedItem,
      module.key.toUpperCase(),
      exists,
    );
    const nextItem =
      !exists && module.key === "students"
        ? { ...withId, archived: preparedItem.archived ?? false }
        : withId;

    const mergeResult = mergeEntityIntoState(module.key, scopeUser, state, nextItem);
    if (!mergeResult.applied) {
      showToast(ENTITY_OUT_OF_SCOPE_SAVE_MESSAGE, "error");
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
      patch.assignments = reapplyAssignmentPeriodRoom(
        patch.assignments as Record<string, unknown>[],
        targetId,
        period,
        room,
      ) as BackOfficeState["assignments"];
    }

    let successMessage = entityMutationSuccessMessage(module.label, exists);

    // RB-003 / CONTACT-004 : aucun compte utilisateur n'est créé hors du
    // sous-module Contacts. Les fiches enseignant se provisionnent uniquement
    // depuis un contact (linkContactToOperationalRecord).

    if (module.key === "contacts") {
      const contactPlan = buildContactPostMergePlan(
        {
          scopeUser,
          state,
          showToast,
          syncSingleUserToTeachers,
        },
        {
          nextContact: nextItem as Record<string, unknown>,
          nextAllRows,
          basePatch: patch,
          linkSchoolCode: schoolCode,
          defaultSuccessMessage: successMessage,
        },
      );
      if (!contactPlan.ok) return;
      Object.assign(patch, contactPlan.patch);
      successMessage = contactPlan.successMessage;
      patch.auditLog = appendAuditLog(
        state.auditLog,
        ...buildContactMutationAuditEntries({
          scopeUser,
          nextContact: nextItem as Record<string, unknown>,
          exists,
          promotion: contactPlan.promotion,
          ficheLink: contactPlan.ficheLink,
        }),
      );
    }

    if (module.key === "relations") {
      const nextRelation = nextItem as Record<string, unknown>;
      const currentRelations =
        (patch.relations as unknown as Record<string, unknown>[] | undefined) ?? nextAllRows;
      const relationPlan = buildRelationPostMergePlan(
        { scopeUser },
        {
          nextRelation,
          nextAllRows,
          baseRelations: currentRelations,
          exists,
        },
      );
      patch.relations = relationPlan.relations as unknown as BackOfficeState["relations"];
      patch.auditLog = appendAuditLog(state.auditLog, relationPlan.auditEntry);
    }

    const genericAudit = appendGenericMutationAudit(
      state.auditLog,
      module.key,
      scopeUser,
      nextItem as Record<string, unknown>,
      exists,
    );
    if (genericAudit) {
      patch.auditLog = genericAudit;
    }

    if (module.key === "students" && !exists) {
      patch.studentFees = applyActiveGridsToStudent(
        { ...state, ...patch, students: adaptLegacyStudents(nextAllRows) },
        nextItem as Record<string, unknown>,
      );
    }

    await applyPlan({ patch, successMessage }, () => setEditing(null));
  }

  async function submitCancelPayment() {
    if (!cancellingPayment) return;
    const plan = buildPaymentCancelPlan(
      { scopeUser, state, showToast },
      { payment: cancellingPayment, reason: cancelReason },
    );
    if (!plan.ok) return;
    await applyPlan(plan, closeCancelModal);
  }

  async function handleDelete(row: Record<string, unknown>) {
    if (!module || !row.id) return;
    if (module.key === "students") {
      showToast("La suppression legacy des élèves est retirée.", "error");
      return;
    }
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
      const plan = buildParentChildBundleDeletePlan({ scopeUser, state }, { row });
      await applyPlan(plan);
      return;
    }

    const deleteResult = deleteEntityFromState(
      module.key,
      scopeUser,
      state,
      String(row.id),
    );
    if (!deleteResult.applied) {
      showToast(ENTITY_OUT_OF_SCOPE_DELETE_MESSAGE, "error");
      return;
    }
    const deletePatch: Partial<BackOfficeState> = { [module.key]: deleteResult.rows };
    if (module.key === "contacts") {
      deletePatch.auditLog = appendAuditLog(
        state.auditLog,
        buildContactDeleteAuditEntry(scopeUser, row),
      );
    } else if (module.key === "relations") {
      deletePatch.auditLog = appendAuditLog(
        state.auditLog,
        buildRelationDeleteAuditEntry(scopeUser, row),
      );
    } else {
      const genericDeleteAudit = appendGenericDeleteAudit(
        state.auditLog,
        module.key,
        scopeUser,
        row,
      );
      if (genericDeleteAudit) {
        deletePatch.auditLog = genericDeleteAudit;
      }
    }
    await applyPlan({ patch: deletePatch, successMessage: ENTITY_DELETED_MESSAGE });
  }

  async function handleCreateFicheFromContact() {
    if (!module || !linkContactId) return;
    const plan = buildCreateFicheFromSelectionPlan(
      {
        scopeUser,
        state,
        showToast,
        syncSingleUserToTeachers,
        effectiveSchoolCode,
      },
      {
        selectionValue: linkContactId,
        moduleLabel: module.label,
      },
    );
    if (!plan.ok) return;
    await applyPlan(plan, () => {
      setLinkContactOpen(false);
      setLinkContactId("");
    });
  }

  async function handleAssignmentSubmit(event: FormEvent) {
    event.preventDefault();
    if (!assignmentModule || !editingAssignment || !teacherAssignmentContext) return;

    const plan = buildTeacherAssignmentSubmitPlan(
      {
        scopeUser,
        state,
        effectiveSchoolCode,
        showToast,
        buildPedagogyPatch,
      },
      {
        editingAssignment,
        teacherAssignmentContext,
        assignmentFields: assignmentModule.fields,
        scopedAssignments: scopedAssignmentsList,
        permissions: {
          canCreate: assignmentPermissions.canCreate,
          canUpdate: assignmentPermissions.canUpdate,
        },
      },
    );
    if (!plan.ok) return;

    await applyPlan(plan, () => {
      setTeacherAssignmentContext(plan.refreshTeacherContext);
      setEditingAssignment(plan.resetEditingAssignment);
    });
  }

  async function handleDeleteAssignment(assignment: Record<string, unknown>) {
    const canRemove = assignmentPermissions.canUpdate || assignmentPermissions.canDelete;
    if (!assignment.id || !canRemove) {
      showToast("Retrait non autorisé pour votre rôle.", "error");
      return;
    }

    const confirmed = await confirm(buildTeacherAssignmentDeleteConfirmCopy(assignment));
    if (!confirmed) return;

    const plan = buildTeacherAssignmentDeletePlan(
      {
        scopeUser,
        state,
        effectiveSchoolCode,
        showToast,
        buildPedagogyPatch,
      },
      {
        assignment,
        teacherAssignmentContext,
        permissions: {
          canUpdate: assignmentPermissions.canUpdate,
          canDelete: assignmentPermissions.canDelete,
        },
      },
    );
    if (!plan.ok) return;

    await applyPlan(plan, () => {
      if (
        plan.clearEditingIfId &&
        String(editingAssignment?.id ?? "") === plan.clearEditingIfId
      ) {
        setEditingAssignment(
          emptyEditingAssignment(String(teacherAssignmentContext?.id ?? "")),
        );
      }
    });
  }

  const displayFields = isParentChildMode
    ? module.fields.filter((field) => !PARENT_CHILD_HIDDEN_FIELDS.has(field.key))
    : module.fields;

  const columns = buildEntityColumns({
    module,
    isParentChildMode,
    busy,
    canUpdate: module.key === "students" ? false : canUpdate,
    allowDelete,
    studentsCanRead: studentsPermissions.canRead,
    assignmentCanCreateOrUpdate:
      assignmentPermissions.canCreate || assignmentPermissions.canUpdate,
    users: ((state.users ?? []) as unknown as Record<string, unknown>[]),
    students: ((state.students ?? []) as Record<string, unknown>[]),
    scopedStudents: scopedStudentsList,
    scopedAssignments: scopedAssignmentsList,
    onEdit: (row) => {
      const next =
        module.key === "assignments"
          ? normalizeAssignmentForm({ ...row }, scopedTeachers(scopeUser, state))
          : module.key === "relations" && isParentChildMode
            ? parentChildBundleToForm(row)
            : module.key === "teachers"
              ? normalizeTeacherFormProps({ ...row })
              : { ...row };
      setEditing(next);
    },
    onDelete: (row) => {
      void handleDelete(row);
    },
    onAssignTeacher: (row) => {
      setTeacherAssignmentContext({ ...row });
      setEditingAssignment(emptyEditingAssignment(String(row.id ?? "")));
    },
    onShowPaymentReceipt: (row) => setReceiptPayment(row),
    onCancelPayment: (row) => {
      if (module.key !== "payments") return;
      setCancellingPayment(row);
      setCancelReason("");
    },
  });

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
              setEditing(defaultNewContactDraft(schoolCode));
              return;
            }
            if (module.key === "relations") {
              setEditing(defaultNewRelationDraft(isParentChildMode));
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
                        setEditing(
                          applyParentContactChange(
                            editing,
                            value,
                            (state.relations ?? []) as unknown as Record<string, unknown>[],
                          ),
                        );
                        setPendingParentStudentId("");
                        return;
                      }
                      setEditing({ ...editing, [field.key]: value });
                    }}
                    options={[
                      { value: "", label: field.placeholder ?? "Choisir…" },
                      ...resolveEntitySelectOptions({
                        module,
                        field,
                        academicLists,
                        assignmentOptions,
                        schoolCode,
                        effectiveSchoolCode,
                        editing,
                        state,
                        scopeUser,
                      }),
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
                          setEditing(addParentChildStudentId(editing, pendingParentStudentId));
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
                                setEditing(removeParentChildStudentId(editing, student.id));
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
                              ...resolveTeacherAssignmentFieldOptions({
                                field,
                                teacherAssignmentOptions,
                                state,
                                effectiveSchoolCode,
                              }),
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
                        setEditingAssignment(
                          emptyEditingAssignment(String(teacherAssignmentContext.id ?? "")),
                        )
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
                      const plan = buildPaymentReceiptPrintPlan(
                        { scopeUser, state },
                        { payment: receiptPayment },
                      );
                      void update(plan.patch);
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
            onClose={closeCancelModal}
            footer={
              <>
                <Button variant="secondary" onClick={closeCancelModal}>
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
