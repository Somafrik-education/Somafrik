import type { ReactNode } from "react";
import { Button, type Column } from "@/design-system";
import {
  formatTeacherAssignmentsSummary,
  listTeacherAssignments,
} from "../../lib/assignments";
import { getTeacherLoginIdentifier } from "../../lib/entityIdentifiers";
import type { EntityModuleConfig } from "../../lib/entityModules";
import { isPaymentCancelled, type PaymentRecord } from "../../lib/quickPayment";
import {
  formatContactPersonName,
  formatStudentPersonName,
  splitParentChildStudentNames,
} from "../../lib/relations";

/** Champs masqués en mode parent-enfant (formulaire + colonnes). */
export const PARENT_CHILD_HIDDEN_FIELDS = new Set([
  "relationType",
  "accountCode",
  "toStudentId",
]);

export const PARENT_CHILD_COLUMNS = [
  "fromContactName",
  "toStudentName",
  "isPrincipal",
  "status",
];

export const PARENT_CHILD_COLUMN_LABELS: Record<string, string> = {
  fromContactName: "Parent",
  toStudentName: "Élève(s)",
  isPrincipal: "Parent principal",
  status: "Statut",
};

export function relationColumnHeader(
  key: string,
  module: EntityModuleConfig,
  isParentChildMode: boolean,
): string {
  if (isParentChildMode && PARENT_CHILD_COLUMN_LABELS[key]) {
    return PARENT_CHILD_COLUMN_LABELS[key];
  }
  return (
    module.columnLabels?.[key] ?? module.fields.find((field) => field.key === key)?.label ?? key
  );
}

export function renderSeparatedStudentNames(labels: string[]): ReactNode {
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

export type EntityRow = Record<string, unknown>;

/**
 * Dépendances injectées pour construire les colonnes (D2.8a).
 * Aucun contexte React — callbacks et données fournis par EntityPage.
 */
export interface BuildEntityColumnsContext {
  module: EntityModuleConfig;
  isParentChildMode: boolean;
  busy: boolean;
  canUpdate: boolean;
  allowDelete: boolean;
  studentsCanRead: boolean;
  assignmentCanCreateOrUpdate: boolean;
  users: EntityRow[];
  students: EntityRow[];
  scopedStudents: EntityRow[];
  scopedAssignments: EntityRow[];
  onEdit: (row: EntityRow) => void;
  onDelete: (row: EntityRow) => void;
  onAssignTeacher: (row: EntityRow) => void;
  onShowPaymentReceipt: (row: PaymentRecord) => void;
  onCancelPayment: (row: PaymentRecord) => void;
}

function renderDataCell(
  key: string,
  row: EntityRow,
  ctx: BuildEntityColumnsContext,
): ReactNode {
  const { module, isParentChildMode, users, students, scopedAssignments } = ctx;

  if (module.key === "relations" && key === "fromContactName") {
    const contactKey = String(row.fromContactId ?? "").trim();
    const account = users.find(
      (item) =>
        String(item.contactId ?? "").trim() === contactKey ||
        String(item.id ?? "").trim() === contactKey,
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
          const student = students.find((item) => String(item.id ?? "") === studentId);
          return student ? formatStudentPersonName(student) : "";
        })
        .filter(Boolean);
      return renderSeparatedStudentNames(labels);
    }
    const student = students.find(
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
    const teacherAssignments = listTeacherAssignments(row, scopedAssignments);
    return formatTeacherAssignmentsSummary(teacherAssignments);
  }
  return String(row[key] ?? "—");
}

function renderActionsCell(row: EntityRow, ctx: BuildEntityColumnsContext): ReactNode {
  const {
    module,
    busy,
    canUpdate,
    allowDelete,
    assignmentCanCreateOrUpdate,
    onEdit,
    onDelete,
    onAssignTeacher,
    onShowPaymentReceipt,
    onCancelPayment,
  } = ctx;

  if (module.key === "payments") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onShowPaymentReceipt(row as PaymentRecord)}
        >
          Reçu
        </Button>
        {canUpdate && !isPaymentCancelled(row as PaymentRecord) ? (
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={() => void onCancelPayment(row as PaymentRecord)}
          >
            Annuler
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {module.key !== "students" && canUpdate ? (
        <Button variant="secondary" size="sm" onClick={() => onEdit(row)}>
          Modifier
        </Button>
      ) : null}
      {module.key === "teachers" && assignmentCanCreateOrUpdate ? (
        <Button variant="secondary" size="sm" onClick={() => onAssignTeacher(row)}>
          Affecter
        </Button>
      ) : null}
      {module.key !== "students" && allowDelete ? (
        <Button variant="danger" size="sm" disabled={busy} onClick={() => void onDelete(row)}>
          Supprimer
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Construction pure des colonnes de liste EntityPage (D2.8a).
 * Préserve l’ordre, les libellés et les actions existants.
 */
export function buildEntityColumns(
  ctx: BuildEntityColumnsContext,
): Column<EntityRow>[] {
  const { module, isParentChildMode } = ctx;
  const displayColumns = isParentChildMode ? PARENT_CHILD_COLUMNS : module.columns;

  const dataColumns: Column<EntityRow>[] = displayColumns.map((key) => ({
    key,
    header: relationColumnHeader(key, module, isParentChildMode),
    render: (row) => renderDataCell(key, row, ctx),
  }));

  return [
    ...dataColumns,
    {
      key: "actions",
      header: "Actions",
      className: "no-print",
      render: (row) => renderActionsCell(row, ctx),
    },
  ];
}
