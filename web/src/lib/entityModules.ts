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
import { RELATION_PARENT_CHILD, RELATION_STATUS_OPTIONS } from "./relations";

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

/** @deprecated Les fiches se créent directement ; le modèle Contacts est retiré. */
export const CONTACT_PROVISIONED_ENTITY_KEYS = new Set<SchoolEntityKey>();

export function entityCreateViaContactsOnly(entityKey: string): boolean {
  void entityKey;
  return false;
}

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
      | "periods"
      | "accounts"
      | "userRoles"
      | "relationContacts"
      | "relationParents"
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

export const SCHOOL_ENTITY_MODULES = ([
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
      "Liens parent → élève entre comptes utilisateurs et fiches élèves.",
    fields: [
      {
        key: "relationType",
        label: "Type de relation",
        placeholder: "Choisir un type",
        inputType: "select",
        selectOptions: [{ value: RELATION_PARENT_CHILD, label: RELATION_PARENT_CHILD }],
        required: true,
      },
      {
        key: "fromContactId",
        label: "Parent (contact)",
        placeholder: "Choisir un parent",
        inputType: "select",
        optionsKey: "relationParents",
        required: true,
      },
      {
        key: "toStudentId",
        label: "Élève associé",
        placeholder: "Choisir un élève",
        inputType: "select",
        optionsKey: "relationStudents",
        required: true,
        hint: "Requis pour une relation Parent → Élève.",
      },
      {
        key: "isPrincipal",
        label: "Parent principal",
        inputType: "select",
        selectOptions: [
          { value: "Non", label: "Non" },
          { value: "Oui", label: "Oui" },
        ],
        hint: "Responsable principal contacté en priorité pour les notifications (PE-005).",
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
    columns: ["relationType", "fromContactName", "toStudentName", "isPrincipal", "accountName", "status"],
    columnLabels: {
      fromContactName: "Contact",
      toStudentName: "Élève",
      isPrincipal: "Principal",
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
    description: "Effectifs, classes et dossiers élèves. Matricule = identifiant de connexion (ex. CD-IN-EL-26-001).",
    fields: [
      { key: "name", label: "Nom complet", placeholder: "Nom de l'élève" },
      { key: "firstName", label: "Prénom", placeholder: "Prénom" },
      {
        key: "matricule",
        label: "Matricule",
        readOnly: true,
        hint: "Matricule = identifiant de connexion, attribué par PostgreSQL (ex. CD-IN-EL-26-001).",
      },
      {
        key: "className",
        label: "Classe",
        placeholder: "Choisir une classe",
        inputType: "select",
        optionsKey: "classNames",
      },
      { key: "schoolYear", label: "Année scolaire", placeholder: "2025-2026" },
      { key: "enrollmentDate", label: "Date d'inscription", inputType: "date" },
      {
        key: "schoolStatus",
        label: "Statut scolaire",
        inputType: "select",
        selectOptions: [
          { value: "Inscrit", label: "Inscrit" },
          { value: "En attente", label: "En attente" },
          { value: "Transféré", label: "Transféré" },
          { value: "Sorti", label: "Sorti" },
        ],
      },
      {
        key: "regime",
        label: "Régime",
        inputType: "select",
        selectOptions: [
          { value: "Externe", label: "Externe" },
          { value: "Demi-pensionnaire", label: "Demi-pensionnaire" },
          { value: "Interne", label: "Interne" },
        ],
      },
      { key: "previousSchool", label: "Ancien établissement", placeholder: "Établissement précédent" },
      { key: "observations", label: "Observations", placeholder: "Notes complémentaires" },
      { key: "parentName", label: "Parent", placeholder: "Nom du parent" },
      { key: "parentPhone", label: "Téléphone parent", placeholder: "+243 ..." },
    ],
    columns: ["name", "firstName", "matricule", "className", "schoolStatus", "parentPhone"],
    columnLabels: { matricule: "Matricule", schoolStatus: "Statut" },
  },
  {
    key: "teachers",
    view: "teachers",
    path: "/etablissement/enseignants",
    label: "Enseignants",
    feature: "Enseignants",
    group: "utilisateurs",
    description:
      "Équipe pédagogique et affectations classe ↔ cours. Fiche créée automatiquement depuis Comptes utilisateurs.",
    fields: [
      { key: "name", label: "Nom", placeholder: "Nom de famille", required: true },
      { key: "firstName", label: "Prénom", placeholder: "Prénom", required: true },
      {
        key: "publicId",
        label: "Identifiant unique",
        readOnly: true,
        hint: "Format : identifiant enseignant (ex. ENS-0001). Le code établissement public est du type CD-IN-26-001.",
      },
      {
        key: "identifier",
        label: "Identifiant de connexion",
        readOnly: true,
        hint: "Utilisé pour l'authentification (ex. ENS-0001).",
      },
      { key: "birthDate", label: "Date de naissance", inputType: "date", hint: "Obligatoire si une date d'entrée est renseignée." },
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
      { key: "specialty", label: "Spécialité", placeholder: "Ex. Mathématiques" },
      {
        key: "contractType",
        label: "Type de contrat",
        inputType: "select",
        selectOptions: [
          { value: "CDI", label: "CDI" },
          { value: "CDD", label: "CDD" },
          { value: "Vacataire", label: "Vacataire" },
          { value: "Stagiaire", label: "Stagiaire" },
        ],
      },
      { key: "entryDate", label: "Date d'entrée", inputType: "date", hint: "L'enseignant doit avoir au moins 18 ans à cette date." },
      {
        key: "availability",
        label: "Disponibilité",
        inputType: "select",
        selectOptions: [
          { value: "Disponible", label: "Disponible" },
          { value: "Partiel", label: "Temps partiel" },
          { value: "Indisponible", label: "Indisponible" },
        ],
      },
      {
        key: "status",
        label: "Statut",
        inputType: "select",
        selectOptions: [
          { value: "Actif", label: "Actif" },
          { value: "Suspendu", label: "Suspendu" },
          { value: "Inactif", label: "Inactif" },
        ],
      },
      { key: "observations", label: "Observations", placeholder: "Notes complémentaires" },
    ],
    columns: ["name", "firstName", "publicId", "specialty", "assignmentsSummary"],
    columnLabels: { specialty: "Spécialité", assignmentsSummary: "Affectations" },
  },
  {
    key: "classes",
    view: "classes",
    path: "/etablissement/classes",
    label: "Classes",
    feature: "Classes",
    group: "pedagogie",
    description: "Organisation des classes et niveaux (API /api/classes).",
    // Formulaire EntityPage retiré — CRUD métier via ClassesListPage.
    fields: [],
    columns: ["name", "level", "track", "status"],
    columnLabels: { status: "Statut" },
  },
  {
    key: "courses",
    view: "courses",
    path: "/parametres/configuration",
    label: "Cours",
    feature: "Matières",
    group: "pedagogie",
    description:
      "Catalogue des cours par classe (paramètres établissement). Les affectations enseignant se gèrent dans Mon établissement → Enseignants.",
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
        label: "Cours",
        placeholder: "Choisir un cours",
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
    path: "/etablissement/enseignants",
    label: "Affectations",
    feature: "Affectations",
    group: "pedagogie",
    description:
      "Affectation enseignant ↔ classe ↔ cours (gérée depuis Enseignants). Le catalogue des cours se configure dans Paramètres ; l'horaire se définit dans Emploi du temps.",
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
        label: "Cours",
        placeholder: "Choisir un cours",
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
      {
        key: "period",
        label: "Période",
        placeholder: "Choisir une période",
        inputType: "select",
        optionsKey: "periods",
        hint: "Période scolaire couverte par l'affectation (AFF-001).",
      },
      {
        key: "room",
        label: "Salle",
        placeholder: "Ex. Salle 12",
        hint: "Salle principale (optionnel).",
      },
    ],
    columns: ["className", "subject", "teacherName", "period"],
    columnLabels: { teacherName: "Enseignant", period: "Période" },
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
      { key: "subject", label: "Cours", placeholder: "Mathématiques" },
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
      { key: "subject", label: "Cours", placeholder: "Mathématiques", readOnly: true },
      { key: "examType", label: "Type", placeholder: "Contrôle / Devoir / Examen", readOnly: true },
      { key: "date", label: "Date", inputType: "date", readOnly: true },
      { key: "period", label: "Période", placeholder: "Trimestre 1", readOnly: true },
      {
        key: "status",
        label: "Statut",
        inputType: "select",
        selectOptions: [
          { value: "Brouillon", label: "Brouillon" },
          { value: "Programmé", label: "Programmé" },
          { value: "Validé", label: "Validé" },
          { value: "Publié", label: "Publié" },
          { value: "Annulé", label: "Annulé" },
          { value: "Archivé", label: "Archivé" },
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
      { key: "itemsDetail", label: "Détail", placeholder: "3 libellés" },
      { key: "amount", label: "Total", placeholder: "541" },
      { key: "method", label: "Mode de paiement", placeholder: "Espèces" },
      { key: "date", label: "Date", inputType: "date" },
      { key: "status", label: "Statut", placeholder: "Payé / Partiel / Annulé" },
      { key: "reference", label: "Référence", placeholder: "CD-2026-PAY-0001", readOnly: true },
      { key: "comment", label: "Commentaire", placeholder: "Facultatif" },
      { key: "cancellationReason", label: "Motif d'annulation", placeholder: "Obligatoire si annulé" },
    ],
    columns: ["reference", "studentName", "itemsDetail", "amount", "method", "date", "status"],
    columnLabels: {
      reference: "Référence",
      studentName: "Élève",
      itemsDetail: "Détail",
      amount: "Total",
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
] as EntityModuleConfig[]).filter((module) => module.key !== "contacts");

/** Vues sidebar / hub établissement (hors modules rattachés à Configuration). */
export const SCHOOL_ENTITY_SIDEBAR_VIEWS = new Set(
  SCHOOL_ENTITY_MODULES.filter((module) => module.group !== "utilisateurs").map((module) => module.view),
);

/** @deprecated Préférer SCHOOL_ENTITY_SIDEBAR_VIEWS pour le menu. */
export const SCHOOL_ENTITY_VIEWS = new Set(SCHOOL_ENTITY_MODULES.map((module) => module.view));

export const CONFIGURATION_USER_ACCOUNTS = {
  view: "users",
  path: "/etablissement/comptes-utilisateurs",
  label: "Comptes utilisateurs",
  feature: "Utilisateurs",
  description: "Comptes d'accès, identifiants et habilitations plateforme / mobile.",
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
