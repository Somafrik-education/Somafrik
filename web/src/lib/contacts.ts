import type { BackOfficeState, SessionUser, UserAccount } from "../types";
import { normalize } from "./format";
import { scopedSchools } from "./scope";
import { getSchoolAcademicLists } from "./academicConfig";
import {
  generateTemporaryPassword,
  generateUserIdentifier,
  getRoleDefaults,
} from "./userAccounts";
import { resolveCountryScopeFromSchool } from "./format";
import { resolveEffectivePermissions } from "./permissions";
import { generateTeacherIdentifiers, resolveStudentMatricule } from "./entityIdentifiers";
import { findDuplicateLoginIdentifier } from "./userAccountRules";

type Row = Record<string, unknown>;

function newRecordId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Types de contact (CONTACT-001). */
export const CONTACT_TYPES = [
  "Directeur",
  "Secrétaire",
  "Enseignant",
  "Parent",
  "Élève",
  "Étudiant",
  "Comptable",
  "Agent pays",
  "Superadmin",
] as const;

/** Statuts du cycle de vie d'un contact (CONTACT-004). */
export const CONTACT_STATUSES = ["Actif", "Inactif", "Archivé", "Suspendu"] as const;

export const CONTACT_TYPE_OPTIONS = CONTACT_TYPES.map((value) => ({ value, label: value }));
export const CONTACT_STATUS_OPTIONS = CONTACT_STATUSES.map((value) => ({ value, label: value }));

export const CONTACT_GENDER_OPTIONS = [
  { value: "Masculin", label: "Masculin" },
  { value: "Féminin", label: "Féminin" },
  { value: "Non renseigné", label: "Non renseigné" },
];

/** Options « Compte lié » : établissements visibles par l'utilisateur courant. */
export function getContactAccountOptions(
  user: SessionUser | null,
  state: BackOfficeState,
): { value: string; label: string }[] {
  return scopedSchools(user, state)
    .filter((school) => school.code)
    .map((school) => ({
      value: String(school.code),
      label: `${school.name ?? school.code} (${school.code})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

function resolveAccountName(schoolCode: string, state: BackOfficeState): string {
  const school = state.schools.find((row) => normalize(row.code) === normalize(schoolCode));
  return school ? String(school.name ?? school.code ?? schoolCode) : schoolCode;
}

/** Normalise et complète un contact avant enregistrement. */
export function prepareContactForSave(form: Row, state: BackOfficeState): Row {
  const schoolCode = String(form.schoolCode ?? "").trim();
  return {
    ...form,
    lastName: String(form.lastName ?? "").trim(),
    firstName: String(form.firstName ?? "").trim(),
    contactType: String(form.contactType ?? "").trim(),
    schoolCode,
    accountName: schoolCode ? resolveAccountName(schoolCode, state) : "",
    phone: String(form.phone ?? "").trim(),
    email: String(form.email ?? "").trim(),
    status: String(form.status ?? "Actif").trim() || "Actif",
  };
}

export interface ContactValidationResult {
  /** Erreur bloquante (doublon strict). */
  block?: string;
  /** Avertissement non bloquant (à confirmer par l'utilisateur). */
  warn?: string;
}

/**
 * Détection des doublons de contacts (CONTACT-003) :
 * - même téléphone / même email dans le même compte → bloqué
 * - même téléphone dans un autre compte → autorisé avec alerte
 * - même nom + prénom + date de naissance → alerte
 */
export function validateContactDuplicate(
  item: Row,
  contacts: Row[],
  editingId?: string,
): ContactValidationResult {
  const schoolCode = normalize(String(item.schoolCode ?? ""));
  const phone = normalize(String(item.phone ?? ""));
  const email = normalize(String(item.email ?? ""));
  const lastName = normalize(String(item.lastName ?? ""));
  const firstName = normalize(String(item.firstName ?? ""));
  const birthDate = normalize(String(item.birthDate ?? ""));

  const others = contacts.filter((row) => !editingId || String(row.id) !== editingId);

  for (const row of others) {
    const sameAccount = normalize(String(row.schoolCode ?? "")) === schoolCode;
    const rowPhone = normalize(String(row.phone ?? ""));
    const rowEmail = normalize(String(row.email ?? ""));

    if (phone && rowPhone === phone && sameAccount) {
      return { block: "Un contact avec ce téléphone existe déjà dans ce compte (doublon)." };
    }
    if (email && rowEmail === email && sameAccount) {
      return { block: "Un contact avec cet email existe déjà dans ce compte (doublon)." };
    }
  }

  for (const row of others) {
    const rowPhone = normalize(String(row.phone ?? ""));
    const sameAccount = normalize(String(row.schoolCode ?? "")) === schoolCode;
    if (phone && rowPhone === phone && !sameAccount) {
      return {
        warn: "Ce téléphone est déjà utilisé dans un autre compte. Créer quand même ce contact ?",
      };
    }
  }

  for (const row of others) {
    const sameIdentity =
      lastName &&
      firstName &&
      birthDate &&
      normalize(String(row.lastName ?? "")) === lastName &&
      normalize(String(row.firstName ?? "")) === firstName &&
      normalize(String(row.birthDate ?? "")) === birthDate;
    if (sameIdentity) {
      return {
        warn: "Un contact avec les mêmes nom, prénom et date de naissance existe déjà. Continuer ?",
      };
    }
  }

  return {};
}

export const CONTACT_ACCESS_OPTIONS = [
  { value: "Non", label: "Non — simple contact" },
  { value: "Oui", label: "Oui — créer un accès utilisateur" },
];

/** Rôles proposés lors de la transformation d'un contact en utilisateur (UTIL-002). */
export function getContactRoleOptions(
  state: BackOfficeState,
  schoolCode?: string,
): { value: string; label: string }[] {
  const { userRoles } = getSchoolAcademicLists(state, schoolCode);
  return userRoles.map((role) => ({ value: role, label: role }));
}

function generateContactUserId(users: UserAccount[]): string {
  const base = "USERS";
  let attempt = `${base}-${Math.random().toString(36).slice(2, 10)}`;
  const existing = new Set(users.map((user) => String(user.id ?? "")));
  while (existing.has(attempt)) {
    attempt = `${base}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return attempt;
}

export interface ContactPromotionResult {
  users: UserAccount[];
  contact: Row;
  /** Compte nouvellement créé (pas une mise à jour). */
  created?: boolean;
  /** Mot de passe provisoire communiqué une seule fois à la création. */
  temporaryPassword?: string;
}

/**
 * UTIL-001/002/003 — Crée ou met à jour le compte utilisateur lié à un contact.
 * Tous les utilisateurs sont des contacts, mais tous les contacts ne sont pas utilisateurs.
 */
export function promoteContactToUser(
  contact: Row,
  state: BackOfficeState,
  creator: SessionUser | null,
): ContactPromotionResult {
  const contactId = String(contact.id ?? "").trim();
  const schoolCode = String(contact.schoolCode ?? "").trim();
  const lastName = String(contact.lastName ?? "").trim();
  const firstName = String(contact.firstName ?? "").trim();
  if (!contactId || !lastName || !firstName || !schoolCode) {
    throw new Error("Un contact valide (nom, prénom, établissement) est obligatoire pour créer un compte.");
  }

  const role = String(contact.role ?? "").trim();
  const secondaryRole = String(contact.secondaryRole ?? "").trim();
  if (/élève|eleve|étudiant|etudiant/i.test(role)) {
    throw new Error("Le compte élève est créé à l'inscription (Classes). Matricule = identifiant de connexion.");
  }

  const users = [...state.users];
  const existingIndex = users.findIndex(
    (user) =>
      (contactId && normalize(String(user.contactId ?? "")) === normalize(contactId)) ||
      (contact.userId && normalize(String(user.id ?? "")) === normalize(String(contact.userId))),
  );
  const existing = existingIndex >= 0 ? users[existingIndex] : undefined;
  const isNewUser = !existing;
  const temporaryPassword = isNewUser
    ? generateTemporaryPassword()
    : String(existing?.temporaryPassword ?? "").trim() || undefined;

  const defaults = getRoleDefaults(role, schoolCode);
  const identifier = existing?.identifier ?? generateUserIdentifier(state.users, role);
  const duplicate = findDuplicateLoginIdentifier(state.users, {
    id: existing?.id,
    identifier,
    email: String(contact.email ?? existing?.email ?? ""),
    phone: String(contact.phone ?? existing?.phone ?? ""),
    schoolCode,
  });
  if (duplicate && duplicate.id !== existing?.id) {
    throw new Error(`L'identifiant « ${identifier} » est déjà utilisé dans cet établissement.`);
  }
  const school = state.schools.find((item) => normalize(item.code) === normalize(schoolCode));
  const secondaryRoles = secondaryRole ? [secondaryRole] : [];
  const permissions = [
    ...new Set([
      ...resolveEffectivePermissions(role, undefined, state.rolePermissions),
      ...secondaryRoles.flatMap((extra) =>
        resolveEffectivePermissions(extra, undefined, state.rolePermissions),
      ),
    ]),
  ];

  const nextUser: UserAccount = {
    ...(existing ?? {}),
    id: existing?.id ?? generateContactUserId(state.users),
    contactId,
    firstName: String(contact.firstName ?? ""),
    lastName: String(contact.lastName ?? ""),
    gender: String(contact.gender ?? existing?.gender ?? "Non renseigné"),
    phone: String(contact.phone ?? existing?.phone ?? ""),
    email: String(contact.email ?? existing?.email ?? ""),
    birthDate: String(contact.birthDate ?? existing?.birthDate ?? ""),
    role,
    secondaryRoles,
    schoolCode: defaults.schoolCode || schoolCode,
    scopeLevel: defaults.scopeLevel,
    accessChannel: defaults.accessChannel,
    countryScope:
      existing?.countryScope ??
      (creator?.countryScope || resolveCountryScopeFromSchool(school ?? {}, "")),
    identifier,
    status: existing?.status ?? "Actif",
    permissions,
    createdBy:
      existing?.createdBy ??
      creator?.identifier ??
      creator?.firstName ??
      "Administrateur",
    ...(isNewUser
      ? {
          temporaryPassword,
          hasTemporaryPassword: true,
          mustChangePassword: true,
          createdAt: new Date().toISOString(),
        }
      : {}),
  };

  if (existingIndex >= 0) {
    users[existingIndex] = nextUser;
  } else {
    users.unshift(nextUser);
  }

  return {
    users,
    contact: {
      ...contact,
      userId: nextUser.id,
      userIdentifier: identifier,
    },
    created: isNewUser,
    temporaryPassword: isNewUser ? temporaryPassword : undefined,
  };
}

/** Types de contact adossés à une fiche opérationnelle Élève. */
const STUDENT_CONTACT_TYPES = new Set(["Élève", "Étudiant"]);
/** Types de contact adossés à une fiche opérationnelle Enseignant. */
const TEACHER_CONTACT_TYPES = new Set(["Enseignant"]);

/** Un contact possède-t-il une fiche opérationnelle Élève/Enseignant à relier ? */
export function contactHasOperationalRecord(contactType: string): boolean {
  const value = String(contactType ?? "").trim();
  return STUDENT_CONTACT_TYPES.has(value) || TEACHER_CONTACT_TYPES.has(value);
}

/**
 * ELEVE-001 / ENS-001 — Contacts (type Élève/Étudiant ou Enseignant) rattachés à
 * l'établissement mais pas encore reliés à une fiche opérationnelle. Sert au
 * sélecteur « créer une fiche depuis un contact existant ».
 */
export function getLinkableContactOptions(
  state: BackOfficeState,
  schoolCode: string,
  kind: "student" | "teacher",
): { value: string; label: string }[] {
  const types = kind === "student" ? STUDENT_CONTACT_TYPES : TEACHER_CONTACT_TYPES;
  const linkKey = kind === "student" ? "studentId" : "teacherId";
  const ficheRows = ((kind === "student" ? state.students : state.teachers) ?? []) as Row[];
  const linkedContactIds = new Set(
    ficheRows.map((row) => normalize(String(row.contactId ?? ""))).filter(Boolean),
  );
  const school = normalize(schoolCode);
  return ((state.contacts ?? []) as unknown as Row[])
    .filter((contact) => {
      if (!contact.id) return false;
      if (!types.has(String(contact.contactType ?? "").trim())) return false;
      const contactSchool = normalize(String(contact.schoolCode ?? ""));
      if (school && school !== "*" && contactSchool && contactSchool !== school) return false;
      if (String(contact[linkKey] ?? "").trim()) return false;
      if (linkedContactIds.has(normalize(String(contact.id ?? "")))) return false;
      return true;
    })
    .map((contact) => ({
      value: String(contact.id),
      label: `${String(contact.lastName ?? "")} ${String(contact.firstName ?? "")}`.trim() || String(contact.id),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

/** Retrouve une fiche existante par contactId, sinon par nom + prénom (dans le même établissement). */
function findFicheIndex(
  rows: Row[],
  contact: Row,
  contactId: string,
  schoolCode: string,
  allowNameFallback = true,
): number {
  if (contactId) {
    const byContact = rows
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row }) =>
          normalize(String(row.contactId ?? "")) === normalize(contactId) &&
          (allowNameFallback || normalize(String(row.schoolCode ?? "")) === normalize(schoolCode)),
      );
    if (byContact.length > 1) {
      const error = new Error(
        "Plusieurs fiches enseignant correspondent au même contact dans l'établissement",
      ) as Error & { code?: string; statusCode?: number };
      error.code = "TEACHER_CANON_AMBIGUOUS";
      error.statusCode = 409;
      throw error;
    }
    const match = byContact[0];
    if (match) return match.index;
  }
  if (!allowNameFallback) return -1;
  const lastName = normalize(String(contact.lastName ?? ""));
  const firstName = normalize(String(contact.firstName ?? ""));
  const school = normalize(schoolCode);
  if (!lastName) return -1;
  return rows.findIndex((row) => {
    const rowSchool = normalize(String(row.schoolCode ?? ""));
    const sameSchool = !school || !rowSchool || rowSchool === school;
    return (
      sameSchool &&
      normalize(String(row.name ?? "")) === lastName &&
      normalize(String(row.firstName ?? "")) === firstName
    );
  });
}

export interface ContactLinkResult {
  contact: Row;
  students?: Row[];
  teachers?: Row[];
  linkedType?: "student" | "teacher";
  linkedRecordId?: string;
  created?: boolean;
}

/**
 * A. Contact ↔ fiche opérationnelle.
 * À l'enregistrement d'un contact « Élève »/« Étudiant » ou « Enseignant », crée ou relie
 * la fiche opérationnelle correspondante et pose `contactId` des deux côtés
 * (la fiche porte `contactId`, le contact porte `studentId`/`teacherId`).
 */
export function linkContactToOperationalRecord(
  contact: Row,
  state: BackOfficeState,
  activeSchoolCode?: string,
): ContactLinkResult {
  const contactType = String(contact.contactType ?? "").trim();
  const contactId = String(contact.id ?? "");
  const schoolCode =
    String(contact.schoolCode ?? "").trim() ||
    (activeSchoolCode && activeSchoolCode !== "*" ? activeSchoolCode : "");
  if (!contactId || !schoolCode) return { contact };

  const lastName = String(contact.lastName ?? "").trim();
  const firstName = String(contact.firstName ?? "").trim();

  if (STUDENT_CONTACT_TYPES.has(contactType)) {
    const students = [...((state.students ?? []) as Row[])];
    const idx = findFicheIndex(students, contact, contactId, schoolCode);
    if (idx >= 0) {
      const existing = students[idx];
      const matriculeInfo = resolveStudentMatricule(existing, schoolCode, students);
      students[idx] = {
        ...existing,
        name: existing.name || lastName,
        firstName: existing.firstName || firstName,
        schoolCode: existing.schoolCode ?? schoolCode,
        gender: existing.gender ?? contact.gender,
        birthDate: existing.birthDate ?? contact.birthDate,
        phone: existing.phone ?? contact.phone,
        email: existing.email ?? contact.email,
        matricule: matriculeInfo.matricule || existing.matricule,
        publicId: matriculeInfo.publicId || existing.publicId,
        contactId,
      };
      return {
        contact: { ...contact, studentId: String(existing.id ?? "") },
        students,
        linkedType: "student",
        linkedRecordId: String(existing.id ?? ""),
        created: false,
      };
    }
    // Pas de création locale : matricule = login, attribué par PostgreSQL à l'inscription.
    return { contact };
  }

  if (TEACHER_CONTACT_TYPES.has(contactType)) {
    const teachers = [...((state.teachers ?? []) as Row[])];
    // Un nom/prénom n'est jamais une clé canonique enseignant suffisante.
    const idx = findFicheIndex(teachers, contact, contactId, schoolCode, false);
    if (idx >= 0) {
      const existing = teachers[idx];
      teachers[idx] = {
        ...existing,
        name: existing.name || lastName,
        firstName: existing.firstName || firstName,
        schoolCode: existing.schoolCode ?? schoolCode,
        gender: existing.gender ?? contact.gender,
        birthDate: existing.birthDate ?? contact.birthDate,
        phone: existing.phone ?? contact.phone,
        email: existing.email ?? contact.email,
        contactId,
      };
      return {
        contact: { ...contact, teacherId: String(existing.id ?? "") },
        teachers,
        linkedType: "teacher",
        linkedRecordId: String(existing.id ?? ""),
        created: false,
      };
    }
    const id = newRecordId("TEACHERS");
    const identifiers = generateTeacherIdentifiers(schoolCode, teachers);
    const record: Row = {
      id,
      name: lastName,
      firstName,
      schoolCode,
      publicId: identifiers.publicId,
      identifier: identifiers.identifier,
      gender: contact.gender ?? "Non renseigné",
      birthDate: contact.birthDate ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      assignments: [],
      assignedClasses: [],
      contactId,
    };
    return {
      contact: { ...contact, teacherId: id },
      teachers: [record, ...teachers],
      linkedType: "teacher",
      linkedRecordId: id,
      created: true,
    };
  }

  return { contact };
}

/** USR-010/012 — Retire l'accès applicatif d'un contact sans supprimer l'historique. */
export function revokeContactUserAccess(
  contact: Row,
  state: BackOfficeState,
): { users: UserAccount[]; contact: Row } {
  const contactId = String(contact.id ?? "").trim();
  const userId = String(contact.userId ?? "").trim();
  const users = state.users.map((user) => {
    const linked =
      (contactId && normalize(String(user.contactId ?? "")) === normalize(contactId)) ||
      (userId && normalize(String(user.id ?? "")) === normalize(userId));
    if (!linked) return user;
    return {
      ...user,
      status: "Inactif",
      mustChangePassword: true,
      temporaryPassword: "",
    };
  });
  return {
    users,
    contact: {
      ...contact,
      hasAccess: "Non",
    },
  };
}
