import type { BackOfficeState } from "../types";
import {
  scopedAnnouncements,
  scopedAssignments,
  scopedBulletins,
  scopedClasses,
  scopedCourses,
  scopedDocuments,
  scopedExams,
  scopedMessages,
  scopedNotes,
  scopedPayments,
  scopedContacts,
  scopedPresences,
  scopedRelations,
  scopedStudents,
  scopedTeachers,
} from "./establishment";
import type { SessionUser } from "../types";
import {
  CONTACT_ACCESS_OPTIONS,
  CONTACT_GENDER_OPTIONS,
  CONTACT_STATUS_OPTIONS,
  CONTACT_TYPE_OPTIONS,
} from "./contacts";
import { RELATION_STATUS_OPTIONS, RELATION_TYPE_OPTIONS } from "./relations";

export type SchoolEntityKey =
  | "contacts"
  | "relations"
  | "students"
  | "teachers"
  | "classes"
  | "courses"
  | "assignments"
  | "payments"
  | "announcements"
  | "messages"
  | "presences"
  | "notes"
  | "exams"
  | "bulletins"
  | "documents";

/** Regroupement métier des écrans établissement. */
export type EntityModuleGroup = "utilisateurs" | "pedagogie" | "finance" | "communication" | "administratif";

export const ENTITY_MODULE_GROUP_LABELS: Record<EntityModuleGroup, string> = {
  utilisateurs: "Gestion des utilisateurs",
  pedagogie: "Pédagogie & scolarité",
  finance: "Finance scolaire",
  communication: "Communication",
  administratif: "Documents administratifs",
};

export interface EntityField {
  key: string;
  label: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  readOnly?: boolean;
  inputType?: "text" | "select" | "date";
  optionsKey?:
    | "levels"
    | "tracks"
    | "classNames"
    | "subjects"
    | "teachers"
      | "classes"
      | "assignmentSubjects"
      | "accounts"
      | "userRoles"
      | "relationContacts"
      | "relationStudents";
  selectOptions?: { value: string; label: string }[];
}

export interface EntityModuleConfig {
  key: SchoolEntityKey;
  view: string;
  path: string;
  label: string;
  feature: string;
  group: EntityModuleGroup;
  description: string;
  fields: EntityField[];
  columns: string[];
  /** Libellés de colonnes hors formulaire (ex. classes calculées). */
  columnLabels?: Record<string, string>;
  /** Calendrier / créneaux gérés uniquement depuis Planning de cours. */
  planningManaged?: boolean;
}

export const SCHOOL_ENTITY_MODULES: EntityModuleConfig[] = [
  {
    key: "contacts",
    view: "contacts",
    path: "/etablissement/contacts",
    label: "Contacts",
    feature: "Contacts",
    group: "utilisateurs",
    description:
      "Répertoire des personnes (socle CRM). Un contact est rattaché à un compte ; il peut ensuite devenir utilisateur.",
    fields: [
      { key: "lastName", label: "Nom", placeholder: "Nom", required: true },
      { key: "firstName", label: "Prénom", placeholder: "Prénom", required: true },
      {
        key: "contactType",
        label: "Type de contact",
        placeholder: "Choisir un type",
        inputType: "select",
        selectOptions: CONTACT_TYPE_OPTIONS,
        required: true,
      },
      {
        key: "schoolCode",
        label: "Compte lié",
        placeholder: "Choisir un compte",
        inputType: "select",
        optionsKey: "accounts",
        required: true,
        hint: "Établissement ou organisation auquel ce contact appartient.",
      },
      { key: "phone", label: "Téléphone", placeholder: "+243 ..." },
      { key: "email", label: "Email", placeholder: "nom@exemple.com" },
      {
        key: "gender",
        label: "Sexe",
        inputType: "select",
        selectOptions: CONTACT_GENDER_OPTIONS,
      },
      { key: "birthDate", label: "Date de naissance", inputType: "date" },
      { key: "address", label: "Adresse", placeholder: "Adresse" },
      {
        key: "status",
        label: "Statut",
        inputType: "select",
        selectOptions: CONTACT_STATUS_OPTIONS,
        required: true,
      },
      {
        key: "hasAccess",
        label: "Accès application",
        inputType: "select",
        selectOptions: CONTACT_ACCESS_OPTIONS,
        hint: "Transforme le contact en utilisateur pouvant se connecter (UTIL-001).",
      },
      {
        key: "role",
        label: "Rôle (accès)",
        placeholder: "Choisir un rôle",
        inputType: "select",
        optionsKey: "userRoles",
        hint: "Requis si un accès est créé.",
      },
      {
        key: "secondaryRole",
        label: "Rôle secondaire (optionnel)",
        placeholder: "Aucun",
        inputType: "select",
        optionsKey: "userRoles",
        hint: "Un contact peut cumuler plusieurs rôles (UTIL-003).",
      },
      {
        key: "userIdentifier",
        label: "Identifiant de connexion",
        readOnly: true,
        hint: "Généré automatiquement à la création de l'accès.",
      },
    ],
    columns: ["lastName", "firstName", "contactType", "accountName", "phone", "status", "userIdentifier"],
    columnLabels: { accountName: "Compte lié", userIdentifier: "Accès" },
  },
  {
    key: "relations",
    view: "relations",
    path: "/administration/relations",
    label: "Relations",
    feature: "Relations",
    group: "utilisateurs",
    description:
      "Liens entre personnes et structures : parent → élève et rattachement d'un contact à plusieurs comptes.",
    fields: [
      {
        key: "relationType",
        label: "Type de relation",
        placeholder: "Choisir un type",
        inputType: "select",
        selectOptions: RELATION_TYPE_OPTIONS,
        required: true,
      },
      {
        key: "fromContactId",
        label: "Contact",
        placeholder: "Choisir un contact",
        inputType: "select",
        optionsKey: "relationContacts",
        required: true,
      },
      {
        key: "toStudentId",
        label: "Élève associé",
        placeholder: "Choisir un élève",
        inputType: "select",
        optionsKey: "relationStudents",
        hint: "Requis pour une relation Parent → Élève.",
      },
      {
        key: "accountCode",
        label: "Compte associé",
        placeholder: "Choisir un compte",
        inputType: "select",
        optionsKey: "accounts",
        hint: "Requis pour rattacher un contact à un compte supplémentaire.",
      },
      {
        key: "status",
        label: "Statut",
        inputType: "select",
        selectOptions: RELATION_STATUS_OPTIONS,
      },
    ],
    columns: ["relationType", "fromContactName", "toStudentName", "accountName", "status"],
    columnLabels: {
      fromContactName: "Contact",
      toStudentName: "Élève",
      accountName: "Compte",
    },
  },
  {
    key: "students",
    view: "students",
    path: "/etablissement/eleves",
    label: "Élèves",
    feature: "Élèves",
    group: "utilisateurs",
    description: "Effectifs, classes et dossiers élèves de l'établissement.",
    fields: [
      { key: "name", label: "Nom complet", placeholder: "Nom de l'élève" },
      { key: "firstName", label: "Prénom", placeholder: "Prénom" },
      {
        key: "className",
        label: "Classe",
        placeholder: "Choisir une classe",
        inputType: "select",
        optionsKey: "classNames",
      },
      { key: "parentName", label: "Parent", placeholder: "Nom du parent" },
      { key: "parentPhone", label: "Téléphone parent", placeholder: "+243 ..." },
    ],
    columns: ["name", "firstName", "className", "parentPhone"],
  },
  {
    key: "teachers",
    view: "teachers",
    path: "/etablissement/enseignants",
    label: "Enseignants",
    feature: "Enseignants",
    group: "utilisateurs",
    description:
      "Équipe pédagogique. L'admin établissement peut uniquement ajouter un enseignant (pas de modification ni suppression).",
    fields: [
      { key: "name", label: "Nom complet", placeholder: "Nom de l'enseignant", required: true },
      { key: "firstName", label: "Prénom", placeholder: "Prénom", required: true },
      {
        key: "publicId",
        label: "Identifiant unique",
        readOnly: true,
        hint: "Format : code pays-année-n° établissement-ENS-n° (ex. CD-2026-0001-ENS-0001).",
      },
      {
        key: "identifier",
        label: "Identifiant de connexion",
        readOnly: true,
        hint: "Utilisé pour l'authentification (ex. ENS-0001).",
      },
      { key: "birthDate", label: "Date de naissance", inputType: "date", required: true },
      {
        key: "gender",
        label: "Sexe",
        inputType: "select",
        selectOptions: [
          { value: "Masculin", label: "Masculin" },
          { value: "Féminin", label: "Féminin" },
          { value: "Non renseigné", label: "Non renseigné" },
        ],
      },
      {
        key: "identityNumber",
        label: "N° d'identité",
        placeholder: "Ex. 1234567890",
        hint: "Optionnel",
      },
      { key: "phone", label: "Téléphone", placeholder: "+243 ..." },
      { key: "email", label: "Email", placeholder: "prof@ecole.cd" },
    ],
    columns: ["name", "firstName", "publicId", "birthDate", "gender", "phone"],
  },
  {
    key: "classes",
    view: "classes",
    path: "/etablissement/classes",
    label: "Classes",
    feature: "Classes",
    group: "pedagogie",
    description: "Organisation des classes et niveaux.",
    fields: [
      {
        key: "name",
        label: "Nom de classe",
        placeholder: "Choisir une classe",
        inputType: "select",
        optionsKey: "classNames",
      },
      {
        key: "level",
        label: "Niveau",
        placeholder: "Choisir un niveau",
        inputType: "select",
        optionsKey: "levels",
      },
      {
        key: "track",
        label: "Filière",
        placeholder: "Choisir une filière",
        inputType: "select",
        optionsKey: "tracks",
      },
    ],
    columns: ["name", "level", "track"],
  },
  {
    key: "courses",
    view: "courses",
    path: "/etablissement/matieres",
    label: "Matières",
    feature: "Matières",
    group: "pedagogie",
    description:
      "Catalogue des matières par classe. L'enseignant et l'horaire se définissent dans Planning de cours.",
    fields: [
      {
        key: "className",
        label: "Classe",
        placeholder: "Choisir une classe",
        inputType: "select",
        optionsKey: "classNames",
      },
      {
        key: "name",
        label: "Matière",
        placeholder: "Choisir une matière",
        inputType: "select",
        optionsKey: "subjects",
        required: true,
      },
      {
        key: "teacherName",
        label: "Enseignant",
        placeholder: "Choisir un enseignant",
        inputType: "select",
        optionsKey: "teachers",
        required: true,
      },
    ],
    columns: ["name", "className", "teacherName"],
  },
  {
    key: "assignments",
    view: "assignments",
    path: "/planning/affectations",
    label: "Affectations",
    feature: "Affectations",
    group: "pedagogie",
    description:
      "Affectation enseignant ↔ classe ↔ matière. La classe et la matière proviennent de la configuration ; l'horaire se définit dans Emploi du temps.",
    fields: [
      {
        key: "className",
        label: "Classe",
        placeholder: "Choisir une classe",
        inputType: "select",
        optionsKey: "classes",
        required: true,
      },
      {
        key: "subject",
        label: "Matière",
        placeholder: "Choisir une matière",
        inputType: "select",
        optionsKey: "assignmentSubjects",
        required: true,
      },
      {
        key: "teacherId",
        label: "Enseignant",
        placeholder: "Choisir un enseignant",
        inputType: "select",
        optionsKey: "teachers",
        required: true,
      },
    ],
    columns: ["className", "subject", "teacherName"],
    columnLabels: { teacherName: "Enseignant" },
  },
  {
    key: "presences",
    view: "presences",
    path: "/presences",
    label: "Présences",
    feature: "Présences",
    group: "pedagogie",
    description: "Appels et suivi de présence.",
    fields: [
      { key: "studentName", label: "Élève", placeholder: "Nom élève" },
      { key: "date", label: "Date", inputType: "date" },
      { key: "status", label: "Statut", placeholder: "Présent / Absent" },
    ],
    columns: ["studentName", "date", "status"],
  },
  {
    key: "notes",
    view: "notes",
    path: "/notes",
    label: "Notes",
    feature: "Notes",
    group: "pedagogie",
    description: "Évaluations et résultats scolaires.",
    fields: [
      { key: "studentName", label: "Élève", placeholder: "Nom élève" },
      { key: "subject", label: "Matière", placeholder: "Mathématiques" },
      { key: "value", label: "Note", placeholder: "15" },
      { key: "period", label: "Période", placeholder: "Trimestre 1" },
    ],
    columns: ["studentName", "subject", "value", "period"],
  },
  {
    key: "exams",
    view: "exams",
    path: "/examens",
    label: "Examens",
    feature: "Examens",
    group: "pedagogie",
    planningManaged: true,
    description:
      "Suivi des sessions d'évaluation. La planification (date, horaire, classe) se fait dans Planning de cours.",
    fields: [
      { key: "name", label: "Intitulé", placeholder: "Contrôle T1 — Mathématiques", readOnly: true },
      { key: "className", label: "Classe", placeholder: "6ème A", readOnly: true },
      { key: "subject", label: "Matière", placeholder: "Mathématiques", readOnly: true },
      { key: "examType", label: "Type", placeholder: "Contrôle / Devoir / Examen", readOnly: true },
      { key: "date", label: "Date", inputType: "date", readOnly: true },
      { key: "period", label: "Période", placeholder: "Trimestre 1", readOnly: true },
      {
        key: "status",
        label: "Statut",
        inputType: "select",
        selectOptions: [
          { value: "Programmé", label: "Programmé" },
          { value: "En cours", label: "En cours" },
          { value: "Publié", label: "Publié" },
          { value: "Validé", label: "Validé" },
        ],
      },
    ],
    columns: ["name", "className", "subject", "date", "status"],
  },
  {
    key: "bulletins",
    view: "bulletins",
    path: "/bulletins",
    label: "Bulletins",
    feature: "Bulletins",
    group: "pedagogie",
    description: "Bulletins scolaires par élève et période, validation et publication.",
    fields: [
      { key: "studentName", label: "Élève", placeholder: "Nom élève" },
      { key: "className", label: "Classe", placeholder: "6ème A" },
      { key: "period", label: "Période", placeholder: "Trimestre 1" },
      { key: "average", label: "Moyenne", placeholder: "14.5" },
      { key: "rank", label: "Rang", placeholder: "2/28" },
      { key: "status", label: "Statut", placeholder: "Brouillon / En validation / Publié" },
      { key: "publishedAt", label: "Publié le", inputType: "date" },
    ],
    columns: ["studentName", "className", "period", "average", "status"],
  },
  {
    key: "documents",
    view: "documents",
    path: "/administration/documents",
    label: "Documents",
    feature: "Documents",
    group: "administratif",
    description: "Attestations, certificats et pièces administratives générées pour les élèves.",
    fields: [
      { key: "studentName", label: "Élève", placeholder: "Nom élève" },
      { key: "documentType", label: "Type", placeholder: "Attestation / Certificat / Relevé" },
      { key: "title", label: "Titre", placeholder: "Attestation de scolarité" },
      { key: "format", label: "Format", placeholder: "PDF" },
      { key: "status", label: "Statut", placeholder: "Disponible / En génération" },
      { key: "generatedAt", label: "Généré le", inputType: "date" },
    ],
    columns: ["studentName", "documentType", "title", "status", "generatedAt"],
  },
  {
    key: "payments",
    view: "payments",
    path: "/finances/paiements",
    label: "Paiements",
    feature: "Paiements",
    group: "finance",
    description: "Frais scolaires et encaissements.",
    fields: [
      { key: "studentName", label: "Élève", placeholder: "Nom élève" },
      { key: "feeType", label: "Type de frais", placeholder: "Scolarité" },
      { key: "amount", label: "Montant", placeholder: "25000" },
      { key: "method", label: "Mode de paiement", placeholder: "Espèces" },
      { key: "date", label: "Date", inputType: "date" },
      { key: "status", label: "Statut", placeholder: "Payé / Partiel / Annulé" },
      { key: "reference", label: "Référence", placeholder: "CD-2026-PAY-0001", readOnly: true },
      { key: "comment", label: "Commentaire", placeholder: "Facultatif" },
      { key: "cancellationReason", label: "Motif d'annulation", placeholder: "Obligatoire si annulé" },
    ],
    columns: ["reference", "studentName", "feeType", "amount", "method", "date", "status"],
    columnLabels: {
      reference: "Référence",
      studentName: "Élève",
      feeType: "Type de frais",
      amount: "Montant",
      method: "Mode",
      date: "Date",
      status: "Statut",
    },
  },
  {
    key: "announcements",
    view: "announcements",
    path: "/annonces",
    label: "Annonces",
    feature: "Notifications",
    group: "communication",
    description: "Communications publiées à l'établissement.",
    fields: [
      { key: "title", label: "Titre", placeholder: "Réunion parents" },
      { key: "message", label: "Message", placeholder: "Contenu de l'annonce" },
      { key: "audience", label: "Audience", placeholder: "Parents, Enseignants..." },
    ],
    columns: ["title", "audience", "status"],
  },
  {
    key: "messages",
    view: "messages",
    path: "/messages",
    label: "Messages",
    feature: "Messages",
    group: "communication",
    description: "Échanges avec les parents.",
    fields: [
      { key: "studentName", label: "Élève", placeholder: "Nom élève" },
      { key: "subject", label: "Objet", placeholder: "Absence" },
      { key: "body", label: "Message", placeholder: "Contenu" },
      { key: "status", label: "Statut", placeholder: "Lu / Non lu" },
    ],
    columns: ["studentName", "subject", "status"],
  },
];

/** Vues sidebar / hub établissement (hors modules rattachés à Configuration). */
export const SCHOOL_ENTITY_SIDEBAR_VIEWS = new Set(
  SCHOOL_ENTITY_MODULES.filter((module) => module.group !== "utilisateurs").map((module) => module.view),
);

/** @deprecated Préférer SCHOOL_ENTITY_SIDEBAR_VIEWS pour le menu. */
export const SCHOOL_ENTITY_VIEWS = new Set(SCHOOL_ENTITY_MODULES.map((module) => module.view));

export const CONFIGURATION_USER_ACCOUNTS = {
  view: "users",
  path: "/configuration/utilisateurs",
  label: "Comptes utilisateurs",
  feature: "Utilisateurs",
  description: "Comptes d'accès, rôles et habilitations plateforme / mobile.",
} as const;

export const CONFIGURATION_USER_MODULES = SCHOOL_ENTITY_MODULES.filter(
  (module) =>
    module.group === "utilisateurs" && module.key !== "contacts" && module.key !== "relations",
);

export const ENTITY_MODULE_GROUP_ORDER: EntityModuleGroup[] = [
  "utilisateurs",
  "pedagogie",
  "finance",
  "communication",
  "administratif",
];

export function getModulesByGroup(
  modules: EntityModuleConfig[],
): Record<EntityModuleGroup, EntityModuleConfig[]> {
  return modules.reduce(
    (groups, module) => {
      groups[module.group].push(module);
      return groups;
    },
    {
      pedagogie: [] as EntityModuleConfig[],
      utilisateurs: [] as EntityModuleConfig[],
      finance: [] as EntityModuleConfig[],
      communication: [] as EntityModuleConfig[],
      administratif: [] as EntityModuleConfig[],
    },
  );
}

export function getEntityModule(viewOrKey: string): EntityModuleConfig | undefined {
  return SCHOOL_ENTITY_MODULES.find((module) => module.view === viewOrKey || module.key === viewOrKey);
}

export function getScopedEntityRows(
  key: SchoolEntityKey,
  user: SessionUser | null,
  state: BackOfficeState,
): Record<string, unknown>[] {
  switch (key) {
    case "contacts":
      return scopedContacts(user, state);
    case "relations":
      return scopedRelations(user, state);
    case "students":
      return scopedStudents(user, state);
    case "teachers":
      return scopedTeachers(user, state);
    case "classes":
      return scopedClasses(user, state);
    case "courses":
      return scopedCourses(user, state);
    case "assignments":
      return scopedAssignments(user, state);
    case "payments":
      return scopedPayments(user, state);
    case "announcements":
      return scopedAnnouncements(user, state);
    case "messages":
      return scopedMessages(user, state);
    case "presences":
      return scopedPresences(user, state);
    case "notes":
      return scopedNotes(user, state);
    case "exams":
      return scopedExams(user, state);
    case "bulletins":
      return scopedBulletins(user, state);
    case "documents":
      return scopedDocuments(user, state);
    default:
      return [];
  }
}

const DIRECT_SCOPE_KEYS = new Set<SchoolEntityKey>([
  "contacts",
  "relations",
  "students",
  "teachers",
  "classes",
  "courses",
  "assignments",
  "announcements",
  "exams",
]);

export function applySchoolScopeToItem(
  key: SchoolEntityKey,
  item: Record<string, unknown>,
  schoolCode?: string,
  state?: BackOfficeState,
): Record<string, unknown> {
  if (!schoolCode || schoolCode === "*") return item;

  if (DIRECT_SCOPE_KEYS.has(key)) {
    return { ...item, schoolCode };
  }

  const studentId = item.studentId ? String(item.studentId) : "";
  if (studentId && state) {
    const students = state.students as Record<string, unknown>[];
    const student = students.find((row) => String(row.id) === studentId);
    if (student?.schoolCode) {
      return { ...item, schoolCode: String(student.schoolCode) };
    }
  }

  return { ...item, schoolCode };
}

export interface MergeScopedEntityRowsResult {
  rows: Record<string, unknown>[];
  applied: boolean;
}

/** Fusionne une création/modification dans le tableau global, limitée au périmètre établissement. */
export function mergeScopedEntityRows(
  key: SchoolEntityKey,
  user: SessionUser | null,
  state: BackOfficeState,
  nextItem: Record<string, unknown>,
): MergeScopedEntityRowsResult {
  const allRows = (state[key] ?? []) as Record<string, unknown>[];
  const scopedRows = getScopedEntityRows(key, user, state);
  const scopedIds = new Set(scopedRows.map((row) => String(row.id ?? "")).filter(Boolean));
  const targetId = nextItem.id ? String(nextItem.id) : "";

  if (targetId && !scopedIds.has(targetId)) {
    const existsGlobally = allRows.some((row) => String(row.id) === targetId);
    if (existsGlobally) {
      // Modification refusée : la ligne existe mais hors périmètre établissement.
      return { rows: allRows, applied: false };
    }
    // Création : nouvel identifiant encore absent du périmètre courant.
    return { rows: [nextItem, ...allRows], applied: true };
  }

  if (!targetId) {
    return { rows: [nextItem, ...allRows], applied: true };
  }

  const exists = allRows.some((row) => String(row.id) === targetId);
  return {
    rows: exists
      ? allRows.map((row) => (String(row.id) === targetId ? nextItem : row))
      : [nextItem, ...allRows],
    applied: true,
  };
}

/** Supprime une ligne uniquement si elle appartient au périmètre établissement courant. */
export function deleteScopedEntityRow(
  key: SchoolEntityKey,
  user: SessionUser | null,
  state: BackOfficeState,
  rowId: string,
): Record<string, unknown>[] {
  const scopedIds = new Set(
    getScopedEntityRows(key, user, state)
      .map((row) => String(row.id ?? ""))
      .filter(Boolean),
  );
  if (!scopedIds.has(rowId)) {
    return (state[key] ?? []) as Record<string, unknown>[];
  }
  return ((state[key] ?? []) as Record<string, unknown>[]).filter((row) => String(row.id) !== rowId);
}
