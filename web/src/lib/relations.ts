import type { BackOfficeState, SessionUser } from "../types";
import { normalize } from "./format";
import { scopedContacts, scopedStudents } from "./establishment";
import { scopedSchools } from "./scope";

type Row = Record<string, unknown>;

export const RELATION_PARENT_CHILD = "Parent → Élève";
export const RELATION_CONTACT_ACCOUNT = "Contact → Compte";

/** Types de relation gérés (REL-001, REL-004). */
export const RELATION_TYPES = [RELATION_PARENT_CHILD, RELATION_CONTACT_ACCOUNT] as const;

export const RELATION_TYPE_OPTIONS = RELATION_TYPES.map((value) => ({ value, label: value }));

export const RELATION_STATUS_OPTIONS = [
  { value: "Actif", label: "Actif" },
  { value: "Inactif", label: "Inactif" },
];

/** Affichage Prénom Nom pour un contact. */
export function formatContactPersonName(contact: Row): string {
  const first = String(contact.firstName ?? "").trim();
  const last = String(contact.lastName ?? "").trim();
  return `${first} ${last}`.trim() || String(contact.id ?? "");
}

/** Affichage Prénom Nom pour une fiche élève. */
export function formatStudentPersonName(student: Row): string {
  const first = String(student.firstName ?? "").trim();
  const last = String(student.name ?? student.lastName ?? "").trim();
  return `${first} ${last}`.trim() || String(student.id ?? "Élève");
}

function contactLabel(contact: Row): string {
  const name = formatContactPersonName(contact);
  const type = String(contact.contactType ?? "").trim();
  return type ? `${name} (${type})` : name || String(contact.id ?? "");
}

function studentLabel(student: Row): string {
  const name = formatStudentPersonName(student);
  const className = String(student.className ?? "").trim();
  return className ? `${name} — ${className}` : name;
}

export function getRelationContactOptions(
  user: SessionUser | null,
  state: BackOfficeState,
): { value: string; label: string }[] {
  return scopedContacts(user, state)
    .filter((contact) => contact.id)
    .map((contact) => ({ value: String(contact.id), label: contactLabel(contact) }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

/**
 * Contacts pouvant être « parent »/responsable d'un élève (liaison parent-enfant).
 * RB-002 : un contact peut cumuler plusieurs rôles métier — un enseignant peut
 * aussi être parent. On propose donc tout contact, à l'exception des contacts qui
 * sont eux-mêmes des élèves/étudiants (ce sont les enfants, pas les parents).
 */
const NON_PARENT_CONTACT_TYPES = new Set([normalize("Élève"), normalize("Étudiant")]);

export function getRelationParentContactOptions(
  user: SessionUser | null,
  state: BackOfficeState,
): { value: string; label: string }[] {
  return scopedContacts(user, state)
    .filter((contact) => {
      if (!contact.id) return false;
      const type = normalize(String(contact.contactType ?? ""));
      return !NON_PARENT_CONTACT_TYPES.has(type);
    })
    .map((contact) => ({ value: String(contact.id), label: contactLabel(contact) }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

export function getRelationStudentOptions(
  user: SessionUser | null,
  state: BackOfficeState,
): { value: string; label: string }[] {
  return scopedStudents(user, state)
    .filter((student) => student.id)
    .map((student) => ({ value: String(student.id), label: studentLabel(student) }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

export function getRelationAccountOptions(
  user: SessionUser | null,
  state: BackOfficeState,
): { value: string; label: string }[] {
  return scopedSchools(user, state)
    .filter((school) => school.code)
    .map((school) => ({ value: String(school.code), label: `${school.name ?? school.code} (${school.code})` }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

function lookupContact(state: BackOfficeState, id: string): Row | undefined {
  return (state.contacts as unknown as Row[]).find((row) => String(row.id) === id);
}

/** Complète une relation (libellés + portée) avant enregistrement. */
export function prepareRelationForSave(form: Row, state: BackOfficeState): Row {
  const relationType = String(form.relationType ?? "").trim();
  const fromContactId = String(form.fromContactId ?? "").trim();
  const fromContact = lookupContact(state, fromContactId);
  const schoolCode = String(fromContact?.schoolCode ?? form.schoolCode ?? "").trim();

  const base: Row = {
    ...form,
    relationType,
    fromContactId,
    fromContactName: fromContact
      ? formatContactPersonName(fromContact)
      : String(form.fromContactName ?? ""),
    schoolCode,
    status: String(form.status ?? "Actif").trim() || "Actif",
  };

  if (relationType === RELATION_PARENT_CHILD) {
    const toStudentId = String(form.toStudentId ?? "").trim();
    const student = (state.students as Row[]).find((row) => String(row.id) === toStudentId);
    return {
      ...base,
      toStudentId,
      toStudentName: student
        ? formatStudentPersonName(student)
        : String(form.toStudentName ?? ""),
      isPrincipal: String(form.isPrincipal ?? "").trim() === "Oui" ? "Oui" : "Non",
      accountCode: "",
      accountName: "",
    };
  }

  const accountCode = String(form.accountCode ?? "").trim();
  const account = state.schools.find((row) => normalize(row.code) === normalize(accountCode));
  return {
    ...base,
    accountCode,
    accountName: account ? String(account.name ?? account.code ?? accountCode) : accountCode,
    toStudentId: "",
    toStudentName: "",
  };
}

/**
 * PE-005 — Un seul parent principal par élève. Lorsqu'une relation parent-enfant
 * est marquée « principal », toutes les autres relations du même élève repassent
 * à « Non ». Retourne la liste complète mise à jour.
 */
export function enforceSinglePrincipalParent(relations: Row[], saved: Row): Row[] {
  const relationType = String(saved.relationType ?? "").trim();
  const isPrincipal = String(saved.isPrincipal ?? "").trim() === "Oui";
  const studentId = String(saved.toStudentId ?? "").trim();
  if (relationType !== RELATION_PARENT_CHILD || !isPrincipal || !studentId) {
    return relations;
  }
  const savedId = String(saved.id ?? "");
  return relations.map((row) => {
    if (String(row.id ?? "") === savedId) return row;
    if (normalize(String(row.relationType ?? "")) !== normalize(RELATION_PARENT_CHILD)) return row;
    if (String(row.toStudentId ?? "").trim() !== studentId) return row;
    if (String(row.isPrincipal ?? "").trim() !== "Oui") return row;
    return { ...row, isPrincipal: "Non" };
  });
}

/** Validation métier des relations (REL-001, REL-004). */
export function validateRelation(
  item: Row,
  relations: Row[],
  editingId?: string,
): string | null {
  const relationType = String(item.relationType ?? "").trim();
  const fromContactId = String(item.fromContactId ?? "").trim();

  if (!relationType) return "Choisissez un type de relation.";
  if (!fromContactId) return "Sélectionnez le contact concerné.";

  if (relationType === RELATION_PARENT_CHILD && !String(item.toStudentId ?? "").trim()) {
    return "Sélectionnez l'élève à associer au parent.";
  }
  if (relationType === RELATION_CONTACT_ACCOUNT && !String(item.accountCode ?? "").trim()) {
    return "Sélectionnez le compte à associer au contact.";
  }

  const others = relations.filter((row) => !editingId || String(row.id) !== editingId);
  const duplicate = others.some((row) => {
    if (normalize(String(row.relationType ?? "")) !== normalize(relationType)) return false;
    if (normalize(String(row.fromContactId ?? "")) !== normalize(fromContactId)) return false;
    if (relationType === RELATION_PARENT_CHILD) {
      return normalize(String(row.toStudentId ?? "")) === normalize(String(item.toStudentId ?? ""));
    }
    return normalize(String(row.accountCode ?? "")) === normalize(String(item.accountCode ?? ""));
  });
  if (duplicate) {
    return "Cette relation existe déjà.";
  }

  return null;
}

export const PARENT_CHILD_STUDENT_NAME_SEPARATOR = " · ";

/** Découpe les noms d'élèves regroupés sous un même parent. */
export function splitParentChildStudentNames(value: string): string[] {
  return String(value ?? "")
    .split(PARENT_CHILD_STUDENT_NAME_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Compte les parents distincts liés à au moins un élève (pas le nombre de liaisons). */
export function countUniqueParentsInRelations(relations: Row[]): number {
  const parentIds = new Set<string>();
  for (const row of relations) {
    if (normalize(String(row.relationType ?? "")) !== normalize(RELATION_PARENT_CHILD)) {
      continue;
    }
    const fromContactId = String(row.fromContactId ?? "").trim();
    if (fromContactId) {
      parentIds.add(fromContactId);
    }
  }
  return parentIds.size;
}

export const PARENT_CHILD_BUNDLE_ID_PREFIX = "parent-bundle:";

export function parentChildBundleId(fromContactId: string): string {
  return `${PARENT_CHILD_BUNDLE_ID_PREFIX}${fromContactId}`;
}

export function isParentChildBundleRow(row: Row): boolean {
  return String(row.id ?? "").startsWith(PARENT_CHILD_BUNDLE_ID_PREFIX);
}

/** IDs élèves déjà liés à un contact parent. */
export function getParentLinkedStudentIds(relations: Row[], fromContactId: string): string[] {
  const parentId = String(fromContactId ?? "").trim();
  if (!parentId) return [];
  return relations
    .filter(
      (row) =>
        normalize(String(row.relationType ?? "")) === normalize(RELATION_PARENT_CHILD) &&
        String(row.fromContactId ?? "").trim() === parentId,
    )
    .map((row) => String(row.toStudentId ?? "").trim())
    .filter(Boolean);
}

/** Une ligne par parent, avec tous ses élèves regroupés. */
export function groupParentChildRelations(relations: Row[]): Row[] {
  const byParent = new Map<string, Row[]>();
  for (const row of relations) {
    if (normalize(String(row.relationType ?? "")) !== normalize(RELATION_PARENT_CHILD)) {
      continue;
    }
    const fromContactId = String(row.fromContactId ?? "").trim();
    if (!fromContactId) continue;
    if (!byParent.has(fromContactId)) byParent.set(fromContactId, []);
    byParent.get(fromContactId)!.push(row);
  }

  const bundles: Row[] = [];
  for (const [fromContactId, items] of byParent) {
    const studentIds = items
      .map((row) => String(row.toStudentId ?? "").trim())
      .filter(Boolean);
    const studentNames = items
      .map((row) => String(row.toStudentName ?? "").trim())
      .filter(Boolean);
    bundles.push({
      id: parentChildBundleId(fromContactId),
      relationType: RELATION_PARENT_CHILD,
      fromContactId,
      fromContactName: String(items[0]?.fromContactName ?? ""),
      toStudentId: studentIds[0] ?? "",
      toStudentIds: studentIds,
      toStudentName: studentNames.join(PARENT_CHILD_STUDENT_NAME_SEPARATOR),
      relationIds: items.map((row) => String(row.id ?? "")).filter(Boolean),
      isPrincipal: items.some((row) => String(row.isPrincipal ?? "") === "Oui") ? "Oui" : "Non",
      status: items.every((row) => String(row.status ?? "") === "Inactif") ? "Inactif" : "Actif",
      schoolCode: String(items[0]?.schoolCode ?? ""),
    });
  }

  return bundles.sort((a, b) =>
    String(a.fromContactName ?? "").localeCompare(String(b.fromContactName ?? ""), "fr"),
  );
}

export function parentChildBundleToForm(bundle: Row): Row {
  const fromContactId = String(bundle.fromContactId ?? "").trim();
  const studentIds = Array.isArray(bundle.toStudentIds)
    ? (bundle.toStudentIds as string[]).map(String).filter(Boolean)
    : getParentLinkedStudentIds([], fromContactId);
  const resolvedIds =
    studentIds.length > 0
      ? studentIds
      : String(bundle.toStudentId ?? "").trim()
        ? [String(bundle.toStudentId)]
        : [];
  return {
    id: String(bundle.id ?? parentChildBundleId(fromContactId)),
    relationType: RELATION_PARENT_CHILD,
    fromContactId,
    fromContactName: String(bundle.fromContactName ?? ""),
    toStudentIds: resolvedIds,
    isPrincipal: String(bundle.isPrincipal ?? "Oui") === "Oui" ? "Oui" : "Non",
    status: String(bundle.status ?? "Actif"),
    schoolCode: String(bundle.schoolCode ?? ""),
  };
}

export function validateParentChildBundle(form: Row): string | null {
  const fromContactId = String(form.fromContactId ?? "").trim();
  if (!fromContactId) return "Sélectionnez le parent.";
  const studentIds = Array.isArray(form.toStudentIds)
    ? (form.toStudentIds as string[]).map(String).filter(Boolean)
    : String(form.toStudentId ?? "").trim()
      ? [String(form.toStudentId).trim()]
      : [];
  if (!studentIds.length) return "Sélectionnez au moins un élève.";
  return null;
}

/** Crée / met à jour / retire les liaisons d'un parent vers ses élèves sélectionnés. */
export function syncParentChildRelations(
  form: Row,
  relations: Row[],
  state: BackOfficeState,
  createId: () => string,
): Row[] {
  const fromContactId = String(form.fromContactId ?? "").trim();
  const studentIds = Array.isArray(form.toStudentIds)
    ? (form.toStudentIds as string[]).map(String).filter(Boolean)
    : String(form.toStudentId ?? "").trim()
      ? [String(form.toStudentId).trim()]
      : [];
  const status = String(form.status ?? "Actif").trim() || "Actif";
  const isPrincipal = String(form.isPrincipal ?? "").trim() === "Oui" ? "Oui" : "Non";

  const others = relations.filter((row) => {
    if (normalize(String(row.relationType ?? "")) !== normalize(RELATION_PARENT_CHILD)) {
      return true;
    }
    return String(row.fromContactId ?? "").trim() !== fromContactId;
  });

  let next = [...others];
  for (const studentId of studentIds) {
    const existing = relations.find(
      (row) =>
        normalize(String(row.relationType ?? "")) === normalize(RELATION_PARENT_CHILD) &&
        String(row.fromContactId ?? "").trim() === fromContactId &&
        String(row.toStudentId ?? "").trim() === studentId,
    );
    const prepared = prepareRelationForSave(
      {
        ...(existing ?? {}),
        id: existing?.id ?? createId(),
        relationType: RELATION_PARENT_CHILD,
        fromContactId,
        toStudentId: studentId,
        isPrincipal,
        status,
      },
      state,
    );
    next.push(prepared);
    next = enforceSinglePrincipalParent(next, prepared);
  }
  return next;
}

/** Retire toutes les liaisons parent-enfant d'un contact parent. */
export function removeParentChildBundle(relations: Row[], fromContactId: string): Row[] {
  const parentId = String(fromContactId ?? "").trim();
  if (!parentId) return relations;
  return relations.filter(
    (row) =>
      normalize(String(row.relationType ?? "")) !== normalize(RELATION_PARENT_CHILD) ||
      String(row.fromContactId ?? "").trim() !== parentId,
  );
}
