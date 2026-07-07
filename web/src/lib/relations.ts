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

function contactLabel(contact: Row): string {
  const name = `${String(contact.lastName ?? "")} ${String(contact.firstName ?? "")}`.trim();
  const type = String(contact.contactType ?? "").trim();
  return type ? `${name} (${type})` : name || String(contact.id ?? "");
}

function studentLabel(student: Row): string {
  const name = `${String(student.name ?? "")} ${String(student.firstName ?? "")}`.trim();
  const className = String(student.className ?? "").trim();
  return className ? `${name} — ${className}` : name || String(student.id ?? "");
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
      ? `${String(fromContact.lastName ?? "")} ${String(fromContact.firstName ?? "")}`.trim()
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
        ? `${String(student.name ?? "")} ${String(student.firstName ?? "")}`.trim()
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
