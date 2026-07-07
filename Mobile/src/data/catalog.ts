export type Student = {
  id: string;
  publicId: string;
  name: string;
  firstName: string;
  matricule: string;
  gender: "Masculin" | "Féminin" | string;
  birthDate: string;
  className: string;
  schoolCode: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  archived?: boolean;
};

export type Teacher = {
  id: string;
  publicId: string;
  name: string;
  firstName: string;
  gender: "Masculin" | "Féminin" | string;
  phone: string;
  email: string;
  mainSubject: string;
  assignments?: TeacherAssignment[];
  assignedClasses?: string[];
  courses?: string[];
};

export type TeacherAssignment = {
  id?: string;
  teacherId?: string;
  className: string;
  course: string;
};

export type Course = {
  id: string;
  publicId: string;
  className: string;
  name: string;
  coefficient: number;
};

export type SchoolClass = {
  id: string;
  publicId: string;
  name: string;
  level: string;
  track: string;
  teacherId: string;
};

export type NoteItem = {
  id: string;
  studentId: string;
  subject: string;
  value: number;
  coefficient: number;
  date: string;
  period?: string;
  evaluationId?: string;
  evaluationTitle?: string;
  evaluationType?: string;
  scale?: number;
  evaluationCoefficient?: number;
  authorId?: string;
  enteredAt?: string;
  audit?: {
    authorId: string;
    oldValue?: number;
    newValue: number;
    date: string;
  }[];
};

export type PresenceItem = {
  id: string;
  publicId: string;
  studentId: string;
  className?: string;
  date: string;
  savedAt?: string;
  present: boolean;
  status?: "Présent" | "Absent" | "Retard" | "Justifié" | "Present" | string;
};

export type AcademicPeriodConfig = {
  name: string;
  type: "Trimestre" | "Semestre" | "Période" | string;
  startDate: string;
  endDate: string;
  active?: boolean;
};

export type AcademicManagementConfig = {
  schoolCode: string;
  periodMode: "trimestre" | "semestre" | "custom" | string;
  periods: AcademicPeriodConfig[];
  evaluationTypes: string[];
  defaultScale: number;
  reportCardMode: "period" | "semester" | "annual" | string;
  levels?: string[];
  tracks?: string[];
  classNames?: string[];
  subjects?: string[];
};

export const DEFAULT_LEVELS = ["1ère", "2ème", "3ème", "4ème", "5ème", "6ème"];
export const DEFAULT_TRACKS = ["Générale", "Sciences", "Lettres", "Technique", "Commerciale"];
export const DEFAULT_CLASS_NAMES = DEFAULT_LEVELS.flatMap((level) => [`${level} A`, `${level} B`]);
export const DEFAULT_SUBJECTS = [
  "Mathématiques",
  "Français",
  "Sciences",
  "Histoire",
  "Géographie",
  "Anglais",
  "Physique",
  "Chimie",
  "SVT",
  "Informatique",
];

export type PaymentItem = {
  id: string;
  publicId: string;
  studentId: string;
  amount: number;
  date: string;
  status: string;
  method: string;
};

export type PaymentStatus = {
  id: string;
  label: string;
  value: "PAYE" | "EN_ATTENTE" | string;
};

export type Announcement = {
  id: string;
  title: string;
  message: string;
  date: string;
  scope?: string;
  systemBroadcast?: boolean;
};

export type TimetableItem = {
  id: string;
  day: string;
  startTime: string;
  endTime: string;
  className: string;
  course: string;
  teacherId: string;
  room: string;
};

export type ReportCard = {
  id: string;
  studentId: string;
  term: string;
  average: number;
  rank: number;
  status: "Publié" | "Brouillon" | string;
  publishedAt?: string;
  pdfUrl?: string;
  teacherComment: string;
  principalComment: string;
};

export type SchoolMessage = {
  id: string;
  parentPhone: string;
  studentId?: string;
  teacherId?: string;
  theme: string;
  direction:
    | "École vers parent"
    | "Parent vers école"
    | "Enseignant vers parent"
    | "Parent vers enseignant"
    | string;
  message: string;
  status: "Envoyé" | "Distribué" | "Lu" | "Archivé" | "Nouveau" | "En cours" | "Traité" | string;
  date: string;
  attachmentUrl?: string;
  priority?: "Faible" | "Moyenne" | "Haute" | "Critique" | string;
  sentAt?: string;
  readAt?: string;
  archivedAt?: string;
  audit?: {
    action: string;
    actorId: string;
    date: string;
  }[];
};

export type UserAccount = {
  id: string;
  publicId: string;
  lastName: string;
  firstName: string;
  gender: "Masculin" | "Féminin" | string;
  phone: string;
  email?: string;
  role: string;
  secondaryRoles?: string[];
  scopeLevel: "Global" | "Pays" | "Établissement" | string;
  countryScope?: string;
  schoolCode: string;
  accessChannel: "BackOffice" | "Application" | string;
  identifier: string;
  status: "Actif" | "Suspendu" | "Désactivé" | string;
  permissions: string[];
  temporaryPassword?: string;
  photoUrl?: string;
  createdAt: string;
  lastLoginAt?: string;
  createdBy: string;
  history: string[];
};

export type SchoolProfile = {
  id: string;
  publicId: string;
  code: string;
  name: string;
  type: string;
  city: string;
  country: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  currency: string;
  slogan: string;
  status: "Actif" | "Suspendu" | string;
  logoUrl?: string;
  schoolYear: string;
  timezone: string;
  language: string;
  dateFormat: string;
  primaryColor: string;
  subscriptionPlan: string;
  subscriptionStartDate: string;
  subscriptionEndDate: string;
  maxStudents: number;
  maxTeachers: number;
  createdAt: string;
};

export type CountryProfile = {
  id: string;
  name: string;
  code: string;
  phonePrefix: string;
  currency: string;
  timezone: string;
  status: "Actif" | "Suspendu" | string;
  administratorId?: string;
  createdAt: string;
};

export type SubscriptionItem = {
  id: string;
  schoolCode: string;
  countryCode: string;
  country: string;
  plan: string;
  monthlyPrice: number;
  annualPrice: number;
  currency: string;
  status: "Actif" | "Suspendu" | string;
  paymentStatus: "À jour" | "En retard" | string;
  startDate: string;
  endDate: string;
  lastPaymentDate: string;
};

export const school: SchoolProfile = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  publicId: "CD-2026-0001",
  code: "CD-2026-0001",
  name: "Université de Kinshasa",
  type: "Université",
  city: "Kinshasa",
  country: "RDC",
  address: "Avenue de l'Université, Kinshasa",
  phone: "+243 810 000 000",
  email: "contact@unikin.somafrik",
  website: "https://unikin.somafrik",
  currency: "CDF",
  slogan: "Excellence et Innovation",
  status: "Actif",
  logoUrl: "",
  schoolYear: "2025-2026",
  timezone: "Africa/Kinshasa",
  language: "Français",
  dateFormat: "JJ-MM-AAAA",
  primaryColor: "#2563EB",
  subscriptionPlan: "Premium",
  subscriptionStartDate: "01-09-2025",
  subscriptionEndDate: "31-08-2026",
  maxStudents: 1200,
  maxTeachers: 120,
  createdAt: "01-09-2025",
};

export const schools: SchoolProfile[] = [
  school,
  {
    ...school,
    id: "SCHOOL-BI-2026-0002",
    publicId: "BI-2026-0002",
    code: "BI-2026-0002",
    name: "Établissement Somafrik Burundi",
    type: "Université",
    city: "Bujumbura",
    country: "Burundi",
    address: "Avenue de l'Indépendance, Bujumbura",
    phone: "+257 710 000 000",
    email: "contact.bi@somafrik.demo",
    currency: "BIF",
    timezone: "Africa/Bujumbura",
    subscriptionPlan: "Premium",
    status: "Actif",
    maxStudents: 900,
    maxTeachers: 90,
  },
];

export const countries: CountryProfile[] = [
  {
    id: "COUNTRY-RDC",
    name: "République Démocratique du Congo",
    code: "CD",
    phonePrefix: "+243",
    currency: "CDF",
    timezone: "Africa/Kinshasa",
    status: "Actif",
    administratorId: "USER-COUNTRY-RDC",
    createdAt: "01-09-2025",
  },
  {
    id: "COUNTRY-CG",
    name: "République du Congo",
    code: "CG",
    phonePrefix: "+242",
    currency: "XAF",
    timezone: "Africa/Brazzaville",
    status: "Suspendu",
    administratorId: "",
    createdAt: "15-05-2026",
  },
  {
    id: "COUNTRY-BI",
    name: "Burundi",
    code: "BI",
    phonePrefix: "+257",
    currency: "BIF",
    timezone: "Africa/Bujumbura",
    status: "Actif",
    administratorId: "USER-COUNTRY-BI",
    createdAt: "15-05-2026",
  },
];

export const subscriptions: SubscriptionItem[] = [
  {
    id: "SUB-CD-2026-0001",
    schoolCode: "CD-2026-0001",
    countryCode: "CD",
    country: "RDC",
    plan: "Premium",
    monthlyPrice: 120,
    annualPrice: 1200,
    currency: "USD",
    status: "Actif",
    paymentStatus: "À jour",
    startDate: "01-09-2025",
    endDate: "31-08-2026",
    lastPaymentDate: "01-06-2026",
  },
  {
    id: "SUB-CG-2026-0001",
    schoolCode: "CG-2026-0001",
    countryCode: "CG",
    country: "République du Congo",
    plan: "Standard",
    monthlyPrice: 80,
    annualPrice: 800,
    currency: "USD",
    status: "Suspendu",
    paymentStatus: "En retard",
    startDate: "01-01-2026",
    endDate: "31-05-2026",
    lastPaymentDate: "01-04-2026",
  },
];

export const rolePermissions: Record<string, string[]> = {
  "Super Administrateur Somafrik": [
    "ALL_PRIVILEGES",
    "Contrôler tous les pays",
    "Créer un pays",
    "Modifier un pays",
    "Suspendre un pays",
    "Réactiver un pays",
    "Supprimer un pays",
    "Affecter un administrateur pays",
    "Contrôler tous les établissements",
    "Gérer administrateurs pays",
    "Gérer administrateurs écoles",
    "Gérer abonnements",
    "Modifier tarifs par pays",
    "Gérer utilisateurs",
    "Voir rapports globaux",
    "Auditer connexions",
  ],
  "Admin Pays": [
    "COUNTRY_PRIVILEGES",
    "Gérer établissements du pays",
    "Créer un établissement",
    "Modifier un établissement",
    "Suspendre un établissement",
    "Réactiver un établissement",
    "Valider une inscription",
    "Refuser une inscription",
    "Demander pièces complémentaires",
    "Gérer admins écoles du pays",
    "Voir rapports pays",
    "Suivre abonnements pays",
    "Relancer établissements en retard",
    "Auditer utilisateurs pays",
    "Voir élèves",
    "Gérer élèves",
    "Voir enseignants",
    "Gérer enseignants",
    "Voir classes",
    "Gérer classes",
  "Gérer cours",
    "Gérer affectations",
    "Voir notes",
    "Modifier notes",
    "Voir présences",
    "Modifier présences",
    "Gérer paiements",
    "Gérer utilisateurs",
    "Gérer annonces",
    "Publier communications",
    "Valider bulletins",
    "Voir rapports",
    "Voir rapports financiers",
  ],
  "Admin School": [
    "Voir élèves",
    "Gérer élèves",
    "Voir enseignants",
    "Ajouter enseignants",
    "Voir classes",
    "Gérer classes",
    "Gérer cours",
    "Voir notes",
    "Modifier notes",
    "Voir présences",
    "Modifier présences",
    "Faire appel",
    "Gérer paiements",
    "Gérer utilisateurs",
    "Gérer annonces",
    "Messages parents",
    "Publier communications",
    "Valider bulletins",
    "Valider examens",
    "Valider années académiques",
    "Voir rapports",
    "Voir rapports financiers",
    "Gérer planning académique",
    "Créer rapports disciplinaires",
  ],
  Proviseur: [
    "Voir élèves",
    "Voir enseignants",
    "Voir classes",
    "Valider bulletins",
    "Valider examens",
    "Valider années académiques",
    "Voir rapports",
    "Voir rapports financiers",
    "Publier communications",
  ],
  "Préfet des études": [
    "Voir élèves",
    "Voir enseignants",
    "Voir classes",
    "Voir notes",
    "Voir présences",
    "Organiser examens",
    "Modifier présences",
    "Gérer planning académique",
    "Créer rapports disciplinaires",
  ],
  Directeur: [
    "Voir élèves",
    "Modifier notes",
    "Gérer paiements",
    "Gérer utilisateurs",
    "Voir rapports",
  ],
  Secrétaire: ["Voir élèves", "Gérer élèves", "Gérer paiements", "Gérer appels"],
  Enseignant: ["Voir élèves", "Modifier notes", "Faire appel", "Messages parents"],
  Parent: ["Voir enfant", "Voir paiements", "Messages école"],
  "Élève / Étudiant": ["Voir notes", "Voir présences", "Voir paiements"],
  Comptable: ["Gérer paiements", "Voir rapports financiers"],
  Surveillant: ["Voir élèves", "Gérer appels", "Gérer discipline"],
};

export const defaultAcademicConfig: AcademicManagementConfig = {
  schoolCode: "CD-2026-0001",
  periodMode: "trimestre",
  periods: [
    { name: "Trimestre 1", type: "Trimestre", startDate: "01-09-2025", endDate: "31-12-2025", active: true },
    { name: "Trimestre 2", type: "Trimestre", startDate: "01-01-2026", endDate: "31-03-2026" },
    { name: "Trimestre 3", type: "Trimestre", startDate: "01-04-2026", endDate: "30-06-2026" },
  ],
  evaluationTypes: ["Interrogation", "Devoir", "Examen", "Travail pratique", "Projet"],
  defaultScale: 20,
  reportCardMode: "period",
  levels: DEFAULT_LEVELS,
  tracks: DEFAULT_TRACKS,
  classNames: DEFAULT_CLASS_NAMES,
  subjects: DEFAULT_SUBJECTS,
};

const securityMatrix: Record<string, Record<string, "R" | "CRUD" | "-">> = {
  Pays: { "Super Administrateur Somafrik": "CRUD", "Admin Pays": "R", "Admin School": "-", "Préfet des études": "-", Enseignant: "-", Secrétaire: "-", Parent: "-", "Élève / Étudiant": "-" },
  "Établissements": { "Super Administrateur Somafrik": "CRUD", "Admin Pays": "CRUD", "Admin School": "-", "Préfet des études": "-", Enseignant: "-", Secrétaire: "-", Parent: "-", "Élève / Étudiant": "-" },
  Utilisateurs: { "Super Administrateur Somafrik": "CRUD", "Admin Pays": "CRUD", "Admin School": "CRUD", "Préfet des études": "R", Enseignant: "-", Secrétaire: "-", Parent: "-", "Élève / Étudiant": "-" },
  Classes: { "Super Administrateur Somafrik": "CRUD", "Admin Pays": "CRUD", "Admin School": "CRUD", "Préfet des études": "CRUD", Enseignant: "R", Secrétaire: "R", Parent: "R", "Élève / Étudiant": "R" },
  Élèves: { "Super Administrateur Somafrik": "CRUD", "Admin Pays": "CRUD", "Admin School": "CRUD", "Préfet des études": "CRUD", Enseignant: "R", Secrétaire: "CRUD", Parent: "R", "Élève / Étudiant": "R" },
  Enseignants: { "Super Administrateur Somafrik": "CRUD", "Admin Pays": "CRUD", "Admin School": "R", "Préfet des études": "R", Enseignant: "-", Secrétaire: "R", Parent: "-", "Élève / Étudiant": "-" },
  Présences: { "Super Administrateur Somafrik": "R", "Admin Pays": "R", "Admin School": "R", "Préfet des études": "CRUD", Enseignant: "CRUD", Secrétaire: "CRUD", Parent: "R", "Élève / Étudiant": "R" },
  Notes: { "Super Administrateur Somafrik": "R", "Admin Pays": "R", "Admin School": "R", "Préfet des études": "CRUD", Enseignant: "CRUD", Secrétaire: "-", Parent: "R", "Élève / Étudiant": "R" },
  Bulletins: { "Super Administrateur Somafrik": "R", "Admin Pays": "R", "Admin School": "R", "Préfet des études": "CRUD", Enseignant: "R", Secrétaire: "R", Parent: "R", "Élève / Étudiant": "R" },
  Paiements: { "Super Administrateur Somafrik": "R", "Admin Pays": "R", "Admin School": "R", "Préfet des études": "R", Enseignant: "-", Secrétaire: "CRUD", Parent: "R", "Élève / Étudiant": "R" },
  Abonnements: { "Super Administrateur Somafrik": "CRUD", "Admin Pays": "CRUD", "Admin School": "-", "Préfet des études": "-", Enseignant: "-", Secrétaire: "R", Parent: "-", "Élève / Étudiant": "-" },
  Notifications: { "Super Administrateur Somafrik": "CRUD", "Admin Pays": "CRUD", "Admin School": "CRUD", "Préfet des études": "CRUD", Enseignant: "R", Secrétaire: "CRUD", Parent: "R", "Élève / Étudiant": "R" },
  Messages: { "Super Administrateur Somafrik": "CRUD", "Admin Pays": "CRUD", "Admin School": "CRUD", "Préfet des études": "CRUD", Enseignant: "CRUD", Secrétaire: "CRUD", Parent: "CRUD", "Élève / Étudiant": "CRUD" },
  Documents: { "Super Administrateur Somafrik": "CRUD", "Admin Pays": "CRUD", "Admin School": "CRUD", "Préfet des études": "CRUD", Enseignant: "R", Secrétaire: "CRUD", Parent: "R", "Élève / Étudiant": "R" },
  Rapports: { "Super Administrateur Somafrik": "CRUD", "Admin Pays": "CRUD", "Admin School": "CRUD", "Préfet des études": "CRUD", Enseignant: "R", Secrétaire: "R", Parent: "R", "Élève / Étudiant": "R" },
  "Paramètres Établissement": { "Super Administrateur Somafrik": "CRUD", "Admin Pays": "CRUD", "Admin School": "CRUD", "Préfet des études": "R", Enseignant: "-", Secrétaire: "-", Parent: "-", "Élève / Étudiant": "-" },
  "Années Académiques": { "Super Administrateur Somafrik": "CRUD", "Admin Pays": "CRUD", "Admin School": "CRUD", "Préfet des études": "R", Enseignant: "R", Secrétaire: "-", Parent: "-", "Élève / Étudiant": "-" },
  Matières: { "Super Administrateur Somafrik": "CRUD", "Admin Pays": "CRUD", "Admin School": "CRUD", "Préfet des études": "CRUD", Enseignant: "R", Secrétaire: "-", Parent: "-", "Élève / Étudiant": "-" },
  Affectations: { "Super Administrateur Somafrik": "CRUD", "Admin Pays": "R", "Admin School": "CRUD", "Préfet des études": "CRUD", Enseignant: "R", Secrétaire: "R", Parent: "-", "Élève / Étudiant": "-" },
  Examens: { "Super Administrateur Somafrik": "CRUD", "Admin Pays": "CRUD", "Admin School": "CRUD", "Préfet des études": "CRUD", Enseignant: "R", Secrétaire: "-", Parent: "-", "Élève / Étudiant": "-" },
};

function permissionsFromSecurityMatrix(role: string) {
  const matrixRole = role === "Proviseur" || role === "Directeur" ? "Préfet des études" : role;
  return Object.entries(securityMatrix).flatMap(([feature, grants]) => {
    const access = grants[matrixRole] ?? "-";
    if (access === "-") return [];
    const actions = access === "CRUD" ? ["READ", "CREATE", "UPDATE", "DELETE", "SUSPEND"] : ["READ"];
    return actions.map((action) => `${feature}:${action}`);
  });
}

for (const role of Object.keys(rolePermissions)) {
  rolePermissions[role] = [...new Set([...(rolePermissions[role] ?? []), ...permissionsFromSecurityMatrix(role)])];
}

rolePermissions["Super Administrateur Somafrik"] = [
  ...new Set(Object.values(rolePermissions).flat()),
];

{
  const schoolPerms = new Set(rolePermissions["Admin School"] ?? []);
  ["Enseignants:UPDATE", "Enseignants:DELETE", "Enseignants:SUSPEND", "Gérer enseignants"].forEach((token) =>
    schoolPerms.delete(token),
  );
  schoolPerms.add("Enseignants:READ");
  schoolPerms.add("Enseignants:CREATE");
  schoolPerms.add("Ajouter enseignants");
  schoolPerms.add("Voir enseignants");
  rolePermissions["Admin School"] = [...schoolPerms].sort((a, b) => a.localeCompare(b, "fr"));
}

export const userAccounts: UserAccount[] = [
  {
    id: "USER-ADMIN1",
    publicId: "USR-2026-000001",
    lastName: "Administrateur",
    firstName: "Somafrik",
    gender: "Masculin",
    phone: "+243 810 000 000",
    email: "admin@unikin.somafrik",
    role: "Admin School",
    secondaryRoles: [],
    scopeLevel: "Établissement",
    countryScope: "RDC",
    schoolCode: "CD-2026-0001",
    accessChannel: "Application",
    identifier: "admin",
    status: "Actif",
    permissions: rolePermissions["Admin School"],
    temporaryPassword: "1234",
    photoUrl: "",
    createdAt: "01-09-2025",
    lastLoginAt: "01-06-2026",
    createdBy: "Super Administrateur Somafrik",
    history: ["Compte initial créé le 01-09-2025"],
  },
  {
    id: "USER-SUPERADMIN",
    publicId: "USR-2026-000002",
    lastName: "Somafrik",
    firstName: "Super Admin",
    gender: "Masculin",
    phone: "+243 810 000 900",
    email: "superadmin@somafrik.app",
    role: "Super Administrateur Somafrik",
    secondaryRoles: [],
    scopeLevel: "Global",
    countryScope: "",
    schoolCode: "*",
    accessChannel: "Application",
    identifier: "superadmin",
    status: "Actif",
    permissions: rolePermissions["Super Administrateur Somafrik"],
    temporaryPassword: "1234",
    photoUrl: "",
    createdAt: "01-09-2025",
    lastLoginAt: "01-06-2026",
    createdBy: "Système",
    history: ["Compte global créé le 01-09-2025"],
  },
  {
    id: "USER-COUNTRY-RDC",
    publicId: "USR-2026-000003",
    lastName: "Admin",
    firstName: "RDC",
    gender: "Masculin",
    phone: "+243 810 000 901",
    email: "admin.rdc@somafrik.app",
    role: "Admin Pays",
    secondaryRoles: [],
    scopeLevel: "Pays",
    countryScope: "RDC",
    schoolCode: "*",
    accessChannel: "Application",
    identifier: "admin-rdc",
    status: "Actif",
    permissions: rolePermissions["Admin Pays"],
    temporaryPassword: "1234",
    photoUrl: "",
    createdAt: "01-09-2025",
    lastLoginAt: "01-06-2026",
    createdBy: "Super Administrateur Somafrik",
    history: ["Compte admin pays RDC créé le 01-09-2025"],
  },
  {
    id: "USER-COUNTRY-BI",
    publicId: "ADM-BI-2026-0001",
    lastName: "Admin",
    firstName: "Burundi",
    gender: "Masculin",
    phone: "+257 710 000 901",
    email: "admin.bi@somafrik.app",
    role: "Admin Pays",
    secondaryRoles: [],
    scopeLevel: "Pays",
    countryScope: "BI",
    schoolCode: "*",
    accessChannel: "Application",
    identifier: "admin-bi",
    status: "Actif",
    permissions: rolePermissions["Admin Pays"],
    temporaryPassword: "1234",
    photoUrl: "",
    createdAt: "15-05-2026",
    lastLoginAt: "",
    createdBy: "Super Administrateur Somafrik",
    history: ["Compte admin pays Burundi créé le 15-05-2026"],
  },
  {
    id: "USER-PREFET-0001",
    publicId: "USR-PREFET-0001",
    lastName: "Préfet",
    firstName: "Samuel",
    gender: "Masculin",
    phone: "+243 810 000 902",
    email: "prefet@somafrik.app",
    role: "Préfet des études",
    secondaryRoles: [],
    scopeLevel: "Établissement",
    countryScope: "RDC",
    schoolCode: "CD-2026-0001",
    accessChannel: "Application",
    identifier: "prefet",
    status: "Actif",
    permissions: rolePermissions["Préfet des études"],
    temporaryPassword: "1234",
    photoUrl: "",
    createdAt: "01-09-2025",
    lastLoginAt: "",
    createdBy: "Admin School",
    history: ["Compte préfet créé le 01-09-2025"],
  },
  {
    id: "USER-SECRETARY-0001",
    publicId: "USR-SECRETARY-0001",
    lastName: "Secrétaire",
    firstName: "Amina",
    gender: "Féminin",
    phone: "+243 810 000 903",
    email: "secretaire@somafrik.app",
    role: "Secrétaire",
    secondaryRoles: [],
    scopeLevel: "Établissement",
    countryScope: "RDC",
    schoolCode: "CD-2026-0001",
    accessChannel: "Application",
    identifier: "secretaire",
    status: "Actif",
    permissions: rolePermissions.Secrétaire,
    temporaryPassword: "1234",
    photoUrl: "",
    createdAt: "01-09-2025",
    lastLoginAt: "",
    createdBy: "Admin School",
    history: ["Compte secrétaire créé le 01-09-2025"],
  },
  {
    id: "USER-T1",
    publicId: "USR-2026-000004",
    lastName: "Kabeya",
    firstName: "Jean",
    gender: "Masculin",
    phone: "+243 810 000 101",
    email: "jean.kabeya@somafrik.cd",
    role: "Enseignant",
    secondaryRoles: [],
    scopeLevel: "Établissement",
    countryScope: "RDC",
    schoolCode: "CD-2026-0001",
    accessChannel: "Application",
    identifier: "T1",
    status: "Actif",
    permissions: rolePermissions.Enseignant,
    temporaryPassword: "",
    photoUrl: "",
    createdAt: "01-09-2025",
    lastLoginAt: "31-05-2026",
    createdBy: "Administrateur",
    history: ["Compte enseignant créé le 01-09-2025"],
  },
  {
    id: "USER-PARENT1",
    publicId: "USR-2026-000005",
    lastName: "Dupont",
    firstName: "Parent",
    gender: "Masculin",
    phone: "+243 820 000 001",
    email: "parent.dupont@example.com",
    role: "Parent",
    secondaryRoles: [],
    scopeLevel: "Établissement",
    countryScope: "RDC",
    schoolCode: "CD-2026-0001",
    accessChannel: "Application",
    identifier: "+243 820 000 001",
    status: "Actif",
    permissions: rolePermissions.Parent,
    temporaryPassword: "",
    photoUrl: "",
    createdAt: "01-09-2025",
    lastLoginAt: "31-05-2026",
    createdBy: "Administrateur",
    history: ["Compte parent créé le 01-09-2025"],
  },
];

export const teachers: Teacher[] = [
  {
    id: "T1",
    publicId: "ENS-0001",
    name: "Jean Kabeya",
    firstName: "Jean",
    gender: "Masculin",
    phone: "+243 810 000 101",
    email: "jean.kabeya@somafrik.cd",
    mainSubject: "Mathématiques",
    assignments: [
      { className: "6ème A", course: "Mathématiques" },
      { className: "6ème B", course: "Mathématiques" },
      { className: "5ème A", course: "Physique" },
    ],
  },
  {
    id: "T2",
    publicId: "ENS-0002",
    name: "Marie Mukendi",
    firstName: "Marie",
    gender: "Féminin",
    phone: "+243 810 000 102",
    email: "marie.mukendi@somafrik.cd",
    mainSubject: "Français",
    assignments: [
      { className: "6ème A", course: "Français" },
      { className: "5ème B", course: "Français" },
    ],
  },
  {
    id: "T3",
    publicId: "ENS-0003",
    name: "Patrick Ilunga",
    firstName: "Patrick",
    gender: "Masculin",
    phone: "+243 810 000 103",
    email: "patrick.ilunga@somafrik.cd",
    mainSubject: "Sciences",
    assignments: [
      { className: "6ème B", course: "Sciences" },
      { className: "5ème A", course: "Sciences" },
    ],
  },
  {
    id: "T4",
    publicId: "ENS-0004",
    name: "Sarah Mbuyi",
    firstName: "Sarah",
    gender: "Féminin",
    phone: "+243 810 000 104",
    email: "sarah.mbuyi@somafrik.cd",
    mainSubject: "Histoire",
    assignments: [
      { className: "5ème A", course: "Histoire" },
      { className: "5ème B", course: "Histoire" },
    ],
  },
];

export const courses: Course[] = [
  { id: "COURSE1", publicId: "COU-2026-000001", className: "6ème A", name: "Mathématiques", coefficient: 2 },
  { id: "COURSE2", publicId: "COU-2026-000002", className: "6ème A", name: "Français", coefficient: 1 },
  { id: "COURSE3", publicId: "COU-2026-000003", className: "6ème B", name: "Mathématiques", coefficient: 2 },
  { id: "COURSE4", publicId: "COU-2026-000004", className: "6ème B", name: "Sciences", coefficient: 2 },
  { id: "COURSE5", publicId: "COU-2026-000005", className: "5ème A", name: "Physique", coefficient: 2 },
  { id: "COURSE6", publicId: "COU-2026-000006", className: "5ème A", name: "Histoire", coefficient: 1 },
  { id: "COURSE7", publicId: "COU-2026-000007", className: "5ème B", name: "Français", coefficient: 1 },
  { id: "COURSE8", publicId: "COU-2026-000008", className: "5ème B", name: "Histoire", coefficient: 1 },
];

export const teacherAssignments: TeacherAssignment[] = teachers.flatMap((teacher) =>
  (teacher.assignments ?? []).map((assignment, index) => ({
    id: `${teacher.id}-ASSIGNMENT-${index + 1}`,
    teacherId: teacher.id,
    ...assignment,
  }))
);

export const classes: SchoolClass[] = [
  { id: "C1", publicId: "CLS-2026-000001", name: "6ème A", level: "6ème", track: "Générale", teacherId: "T1" },
  { id: "C2", publicId: "CLS-2026-000002", name: "6ème B", level: "6ème", track: "Générale", teacherId: "T2" },
  { id: "C3", publicId: "CLS-2026-000003", name: "5ème A", level: "5ème", track: "Sciences", teacherId: "T3" },
  { id: "C4", publicId: "CLS-2026-000004", name: "5ème B", level: "5ème", track: "Lettres", teacherId: "T4" },
];

export const students: Student[] = [
  { id: "1", publicId: "ELE-0001", name: "Jean Dupont", firstName: "Jean", matricule: "ELE-0001", gender: "Masculin", birthDate: "12-04-2012", className: "6ème A", schoolCode: "CD-2026-0001", parentName: "Parent Dupont", parentPhone: "+243 820 000 001", parentEmail: "parent.dupont@example.com", archived: false },
  { id: "2", publicId: "ELE-0002", name: "Marie Martin", firstName: "Marie", matricule: "ELE-0002", gender: "Féminin", birthDate: "18-09-2012", className: "6ème A", schoolCode: "CD-2026-0001", parentName: "Parent Martin", parentPhone: "+243 820 000 001", parentEmail: "parent.martin@example.com", archived: false },
  { id: "3", publicId: "ELE-0003", name: "Paul Bernard", firstName: "Paul", matricule: "ELE-0003", gender: "Masculin", birthDate: "03-02-2011", className: "6ème B", schoolCode: "CD-2026-0001", parentName: "Parent Bernard", parentPhone: "+243 820 000 003", parentEmail: "parent.bernard@example.com", archived: false },
  { id: "4", publicId: "ELE-0004", name: "Sarah Mbala", firstName: "Sarah", matricule: "ELE-0004", gender: "Féminin", birthDate: "21-07-2011", className: "5ème A", schoolCode: "CD-2026-0001", parentName: "Parent Mbala", parentPhone: "+243 820 000 004", parentEmail: "parent.mbala@example.com", archived: false },
];

export const notes: NoteItem[] = [
  { id: "N1", studentId: "1", subject: "Mathématiques", value: 15, coefficient: 2, date: "2026-05-20", evaluationId: "EVAL1", scale: 20, evaluationCoefficient: 1, authorId: "T1", enteredAt: "20-05-2026 09:00", audit: [{ authorId: "T1", newValue: 15, date: "20-05-2026 09:00" }] },
  { id: "N2", studentId: "1", subject: "Français", value: 13, coefficient: 1, date: "2026-05-22", evaluationId: "EVAL2", scale: 20, evaluationCoefficient: 1, authorId: "T2", enteredAt: "22-05-2026 10:00", audit: [{ authorId: "T2", newValue: 13, date: "22-05-2026 10:00" }] },
  { id: "N3", studentId: "2", subject: "Mathématiques", value: 16, coefficient: 2, date: "2026-05-21", evaluationId: "EVAL1", scale: 20, evaluationCoefficient: 1, authorId: "T1", enteredAt: "21-05-2026 09:00", audit: [{ authorId: "T1", newValue: 16, date: "21-05-2026 09:00" }] },
  { id: "N4", studentId: "3", subject: "Sciences", value: 12, coefficient: 2, date: "2026-05-23", evaluationId: "EVAL3", scale: 20, evaluationCoefficient: 1, authorId: "T3", enteredAt: "23-05-2026 11:00", audit: [{ authorId: "T3", newValue: 12, date: "23-05-2026 11:00" }] },
];

export const presences: PresenceItem[] = [
  { id: "P1", publicId: "PRE-2026-000001", studentId: "1", date: "2026-05-27", present: true, status: "Présent" },
  { id: "P2", publicId: "PRE-2026-000002", studentId: "1", date: "2026-05-28", present: false, status: "Absent" },
  { id: "P3", publicId: "PRE-2026-000003", studentId: "2", date: "2026-05-27", present: true, status: "Présent" },
  { id: "P4", publicId: "PRE-2026-000004", studentId: "3", date: "2026-05-27", present: true, status: "Retard" },
];

export const payments: PaymentItem[] = [
  { id: "PAY1", publicId: "PAY-2026-000001", studentId: "1", amount: 25000, date: "10-05-2026", status: "PAYE", method: "Mobile Money" },
  { id: "PAY2", publicId: "PAY-2026-000002", studentId: "1", amount: 15000, date: "25-05-2026", status: "EN_ATTENTE", method: "Espèces" },
  { id: "PAY3", publicId: "PAY-2026-000003", studentId: "2", amount: 25000, date: "10-05-2026", status: "PAYE", method: "Virement bancaire" },
  { id: "PAY4", publicId: "PAY-2026-000004", studentId: "3", amount: 25000, date: "12-05-2026", status: "PAYE", method: "Carte bancaire" },
];

export const paymentStatuses: PaymentStatus[] = [
  { id: "STATUS1", label: "Payé", value: "PAYE" },
  { id: "STATUS2", label: "En attente", value: "EN_ATTENTE" },
];

export const announcements: Announcement[] = [
  { id: "A1", title: "Réunion des parents", message: "Réunion générale samedi à 10h00.", date: "30-05-2026" },
  { id: "A2", title: "Examens", message: "Les évaluations commencent le 10 juin.", date: "29-05-2026" },
];

export const timetable: TimetableItem[] = [
  { id: "TT1", day: "Lundi", startTime: "08:00", endTime: "10:00", className: "6ème A", course: "Mathématiques", teacherId: "T1", room: "A101" },
  { id: "TT2", day: "Lundi", startTime: "10:15", endTime: "12:15", className: "6ème A", course: "Français", teacherId: "T2", room: "A102" },
  { id: "TT3", day: "Mardi", startTime: "08:00", endTime: "10:00", className: "6ème B", course: "Sciences", teacherId: "T3", room: "Labo 1" },
  { id: "TT4", day: "Mercredi", startTime: "09:00", endTime: "11:00", className: "5ème A", course: "Histoire", teacherId: "T4", room: "B201" },
];

export const reportCards: ReportCard[] = [
  {
    id: "BUL-1-T1",
    studentId: "1",
    term: "Trimestre 1",
    average: 14.2,
    rank: 4,
    status: "Publié",
    publishedAt: "31-12-2025",
    pdfUrl: "",
    teacherComment: "Bon trimestre, poursuivre les efforts en français.",
    principalComment: "Résultats satisfaisants.",
  },
  {
    id: "BUL-2-T1",
    studentId: "2",
    term: "Trimestre 1",
    average: 15.6,
    rank: 2,
    status: "Publié",
    publishedAt: "31-12-2025",
    pdfUrl: "",
    teacherComment: "Très bon niveau et participation régulière.",
    principalComment: "Encouragements du conseil.",
  },
];

export const messageThemes = [
  "Dérogation paiement",
  "Absence",
  "Discipline",
  "Résultats scolaires",
  "Santé",
  "Transport",
  "Autre",
];

export const schoolMessages: SchoolMessage[] = [
  {
    id: "MSG1",
    parentPhone: "+243 820 000 001",
    studentId: "1",
    theme: "Dérogation paiement",
    direction: "Parent vers école",
    message: "Demande de dérogation pour régler la deuxième tranche le 10 du mois prochain.",
    status: "Nouveau",
    priority: "Haute",
    date: "31-05-2026",
    sentAt: "31-05-2026 08:15",
    audit: [{ action: "Création", actorId: "PARENT-+243 820 000 001", date: "31-05-2026 08:15" }],
  },
  {
    id: "MSG2",
    parentPhone: "+243 820 000 001",
    studentId: "2",
    theme: "Résultats scolaires",
    direction: "École vers parent",
    message: "Merci de passer à l'école cette semaine pour échanger avec le titulaire.",
    status: "Distribué",
    priority: "Moyenne",
    date: "31-05-2026",
    sentAt: "31-05-2026 10:20",
    audit: [{ action: "Création", actorId: "ADMIN1", date: "31-05-2026 10:20" }],
  },
  {
    id: "MSG3",
    parentPhone: "+243 820 000 001",
    studentId: "1",
    teacherId: "T1",
    theme: "Résultats scolaires",
    direction: "Enseignant vers parent",
    message: "Jean doit renforcer les exercices de mathématiques cette semaine.",
    status: "Nouveau",
    priority: "Moyenne",
    date: "31-05-2026",
    sentAt: "31-05-2026 11:05",
    audit: [{ action: "Création", actorId: "T1", date: "31-05-2026 11:05" }],
  },
  {
    id: "MSG4",
    parentPhone: "+243 820 000 001",
    studentId: "2",
    teacherId: "T2",
    theme: "Absence",
    direction: "Parent vers enseignant",
    message: "Marie sera absente demain matin pour un rendez-vous médical.",
    status: "Nouveau",
    priority: "Haute",
    date: "31-05-2026",
    attachmentUrl: "",
    sentAt: "31-05-2026 12:30",
    audit: [{ action: "Création", actorId: "PARENT-+243 820 000 001", date: "31-05-2026 12:30" }],
  },
];

const demoCountryTemplates = [
  ["Sénégal", "SN", "+221", "XOF", "Africa/Dakar"],
  ["Côte d'Ivoire", "CI", "+225", "XOF", "Africa/Abidjan"],
  ["Cameroun", "CM", "+237", "XAF", "Africa/Douala"],
  ["Gabon", "GA", "+241", "XAF", "Africa/Libreville"],
  ["Bénin", "BJ", "+229", "XOF", "Africa/Porto-Novo"],
  ["Togo", "TG", "+228", "XOF", "Africa/Lome"],
  ["Mali", "ML", "+223", "XOF", "Africa/Bamako"],
  ["Burkina Faso", "BF", "+226", "XOF", "Africa/Ouagadougou"],
  ["Guinée", "GN", "+224", "GNF", "Africa/Conakry"],
  ["Rwanda", "RW", "+250", "RWF", "Africa/Kigali"],
];
const demoCities = ["Kinshasa", "Lubumbashi", "Goma", "Mbuji-Mayi", "Kisangani", "Matadi", "Bukavu", "Kolwezi"];
const demoFirstNames = ["Jean", "Marie", "Patrick", "Sarah", "Grace", "David", "Amina", "Joseph", "Chantal", "Moise"];
const demoLastNames = ["Kabeya", "Mukendi", "Ilunga", "Mbuyi", "Kabasele", "Tshibangu", "Mabiala", "Ndaye", "Kalala", "Mbala"];
const demoSubjects = ["Mathématiques", "Français", "Sciences", "Histoire", "Géographie", "Anglais", "Physique", "Chimie", "SVT", "Informatique"];
const demoLevels = ["1ère", "2ème", "3ème", "4ème", "5ème", "6ème"];
const demoTracks = ["Générale", "Sciences", "Lettres", "Technique", "Commerciale"];
const demoRoles = [
  "Directeur adjoint",
  "Préfet des études",
  "Conseiller pédagogique",
  "Responsable discipline",
  "Bibliothécaire",
  "Responsable transport",
  "Responsable internat",
  "Caissier",
  "Agent support",
  "Auditeur",
  "Inspecteur académique",
  "Coordinateur examens",
  "Responsable documents",
  "Gestionnaire bourses",
  "Responsable sécurité",
];

demoRoles.forEach((role) => {
  if (!rolePermissions[role]) {
    rolePermissions[role] = ["Voir tableau de bord", "Consulter rapports", "Créer demande", "Voir historique"];
  }
});

while (Object.keys(rolePermissions).length < 50) {
  const index = Object.keys(rolePermissions).length + 1;
  rolePermissions[`Rôle métier démo ${String(index).padStart(2, "0")}`] = [
    "Voir tableau de bord",
    "Consulter données",
    "Créer demande",
    "Modifier selon périmètre",
    "Voir historique",
  ];
}

while (schools.length < 50) {
  const index = schools.length + 1;
  const country = demoCountryTemplates[index % demoCountryTemplates.length];
  const code = `${country[1]}-2026-${String(index).padStart(4, "0")}`;

  schools.push({
    ...school,
    id: `SCHOOL-${String(index).padStart(4, "0")}`,
    publicId: code,
    code,
    name: `Établissement Somafrik ${index}`,
    type: ["École primaire", "Collège", "Lycée", "Université", "Institut"][index % 5],
    city: demoCities[index % demoCities.length],
    country: country[0],
    phone: `${country[2]} 810 ${String(index).padStart(3, "0")} ${String(index + 100).padStart(3, "0")}`,
    email: `contact-${index}@somafrik.demo`,
    currency: country[3],
    timezone: country[4],
    status: index % 11 === 0 ? "Suspendu" : "Actif",
    subscriptionPlan: ["Essentiel", "Standard", "Premium"][index % 3],
    subscriptionEndDate: index % 8 === 0 ? "31-05-2026" : "31-08-2026",
    maxStudents: 500 + index * 10,
    maxTeachers: 40 + index,
    createdAt: `${String((index % 27) + 1).padStart(2, "0")}-01-2026`,
  });
}

while (teachers.length < 50) {
  const index = teachers.length + 1;
  const firstName = demoFirstNames[index % demoFirstNames.length];
  const lastName = demoLastNames[index % demoLastNames.length];
  const subject = demoSubjects[index % demoSubjects.length];

  teachers.push({
    id: `T${index}`,
    publicId: `ENS-${String(index).padStart(4, "0")}`,
    name: `${firstName} ${lastName}`,
    firstName,
    gender: index % 2 === 0 ? "Féminin" : "Masculin",
    phone: `+243 810 100 ${String(index).padStart(3, "0")}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@somafrik.cd`,
    mainSubject: subject,
    assignments: [],
  });
}

while (classes.length < 50) {
  const index = classes.length + 1;
  const level = demoLevels[index % demoLevels.length];
  const suffix = String.fromCharCode(65 + (index % 5));

  classes.push({
    id: `C${index}`,
    publicId: `CLS-2026-${String(index).padStart(6, "0")}`,
    name: `${level} ${suffix}`,
    level,
    track: demoTracks[index % demoTracks.length],
    teacherId: teachers[index % teachers.length].id,
  });
}

while (courses.length < 50) {
  const index = courses.length + 1;
  const classItem = classes[index % classes.length];

  courses.push({
    id: `COURSE${index}`,
    publicId: `COU-2026-${String(index).padStart(6, "0")}`,
    className: classItem.name,
    name: demoSubjects[index % demoSubjects.length],
    coefficient: (index % 3) + 1,
  });
}

courses.forEach((course, index) => {
  const teacher = teachers[index % teachers.length];
  const exists = (teacher.assignments ?? []).some(
    (assignment) => assignment.className === course.className && assignment.course === course.name
  );

  if (!exists) {
    const assignment = {
      id: `${teacher.id}-ASSIGNMENT-${teacherAssignments.length + 1}`,
      teacherId: teacher.id,
      className: course.className,
      course: course.name,
    };
    teacher.assignments = [...(teacher.assignments ?? []), assignment];
    teacherAssignments.push(assignment);
  }
});

while (students.length < 50) {
  const index = students.length + 1;
  const firstName = demoFirstNames[index % demoFirstNames.length];
  const lastName = demoLastNames[(index + 3) % demoLastNames.length];
  const classItem = classes[index % classes.length];

  students.push({
    id: String(index),
    publicId: `ELE-${String(index).padStart(4, "0")}`,
    name: `${firstName} ${lastName}`,
    firstName,
    matricule: `ELE-${String(index).padStart(4, "0")}`,
    gender: index % 2 === 0 ? "Féminin" : "Masculin",
    birthDate: `${String((index % 27) + 1).padStart(2, "0")}-${String((index % 12) + 1).padStart(2, "0")}-2012`,
    className: classItem.name,
    schoolCode: "CD-2026-0001",
    parentName: `Parent ${lastName}`,
    parentPhone: `+243 820 100 ${String(Math.ceil(index / 2)).padStart(3, "0")}`,
    parentEmail: `parent-${index}@example.com`,
    archived: index % 17 === 0,
  });
}

while (notes.length < 50) {
  const index = notes.length + 1;
  const student = students[index % students.length];
  const value = 8 + (index % 13);

  notes.push({
    id: `N${index}`,
    studentId: student.id,
    subject: demoSubjects[index % demoSubjects.length],
    value,
    coefficient: (index % 3) + 1,
    date: `2026-05-${String((index % 27) + 1).padStart(2, "0")}`,
    evaluationId: `EVAL${index}`,
    scale: 20,
    evaluationCoefficient: (index % 2) + 1,
    authorId: teachers[index % teachers.length].id,
    enteredAt: `${String((index % 27) + 1).padStart(2, "0")}-05-2026 09:00`,
    audit: [{ authorId: teachers[index % teachers.length].id, newValue: value, date: `${String((index % 27) + 1).padStart(2, "0")}-05-2026 09:00` }],
  });
}

while (presences.length < 50) {
  const index = presences.length + 1;
  const student = students[index % students.length];
  const status = ["Présent", "Absent", "Retard", "Justifié"][index % 4];

  presences.push({
    id: `P${index}`,
    publicId: `PRE-2026-${String(index).padStart(6, "0")}`,
    studentId: student.id,
    date: `2026-05-${String((index % 27) + 1).padStart(2, "0")}`,
    present: status === "Présent" || status === "Justifié",
    status,
  });
}

while (payments.length < 50) {
  const index = payments.length + 1;
  const student = students[index % students.length];

  payments.push({
    id: `PAY${index}`,
    publicId: `PAY-2026-${String(index).padStart(6, "0")}`,
    studentId: student.id,
    amount: 10000 + (index % 5) * 5000,
    date: `${String((index % 27) + 1).padStart(2, "0")}-05-2026`,
    status: index % 4 === 0 ? "EN_ATTENTE" : "PAYE",
    method: ["Mobile Money", "Espèces", "Virement bancaire", "Carte bancaire"][index % 4],
  });
}

while (announcements.length < 50) {
  const index = announcements.length + 1;
  announcements.push({
    id: `A${index}`,
    title: `Annonce Somafrik ${index}`,
    message: `Communication importante numéro ${index} pour les familles et le personnel.`,
    date: `${String((index % 27) + 1).padStart(2, "0")}-06-2026`,
  });
}

while (timetable.length < 50) {
  const index = timetable.length + 1;
  const classItem = classes[index % classes.length];
  const teacher = teachers[index % teachers.length];
  timetable.push({
    id: `TT${index}`,
    day: ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"][index % 5],
    startTime: `${String(8 + (index % 5)).padStart(2, "0")}:00`,
    endTime: `${String(10 + (index % 5)).padStart(2, "0")}:00`,
    className: classItem.name,
    course: demoSubjects[index % demoSubjects.length],
    teacherId: teacher.id,
    room: `Salle ${100 + index}`,
  });
}

while (reportCards.length < 50) {
  const index = reportCards.length + 1;
  const student = students[index % students.length];
  reportCards.push({
    id: `BUL-${student.id}-${index}`,
    studentId: student.id,
    term: ["Trimestre 1", "Trimestre 2", "Trimestre 3"][index % 3],
    average: Number((9 + (index % 10) + (index % 3) / 10).toFixed(1)),
    rank: (index % 24) + 1,
    status: index % 5 === 0 ? "Brouillon" : "Publié",
    publishedAt: index % 5 === 0 ? "" : `${String((index % 27) + 1).padStart(2, "0")}-06-2026`,
    pdfUrl: "",
    teacherComment: "Bulletin généré pour les tests Somafrik.",
    principalComment: index % 5 === 0 ? "En attente de validation." : "Bulletin validé par la direction.",
  });
}

while (schoolMessages.length < 50) {
  const index = schoolMessages.length + 1;
  const student = students[index % students.length];
  schoolMessages.push({
    id: `MSG${index}`,
    parentPhone: student.parentPhone,
    studentId: student.id,
    teacherId: teachers[index % teachers.length].id,
    theme: messageThemes[index % messageThemes.length],
    direction: index % 2 === 0 ? "École vers parent" : "Parent vers école",
    message: `Message de test ${index} pour vérifier le flux communication.`,
    status: ["Nouveau", "En cours", "Traité", "Lu"][index % 4],
    priority: ["Faible", "Moyenne", "Haute", "Critique"][index % 4],
    date: `${String((index % 27) + 1).padStart(2, "0")}-06-2026`,
    sentAt: `${String((index % 27) + 1).padStart(2, "0")}-06-2026 09:00`,
    audit: [{ action: "Création", actorId: "SYSTEM-DEMO", date: `${String((index % 27) + 1).padStart(2, "0")}-06-2026 09:00` }],
  });
}

while (userAccounts.length < 50) {
  const index = userAccounts.length + 1;
  const roleNames = Object.keys(rolePermissions);
  const role = roleNames[index % roleNames.length];
  const schoolItem = schools[index % schools.length];
  const isBackOffice = index % 5 === 0;

  userAccounts.push({
    id: `USER-DEMO-${String(index).padStart(4, "0")}`,
    publicId: role === "Admin Pays" ? `ADM-DEMO-2026-${String(index).padStart(4, "0")}` : `USR-2026-${String(index).padStart(6, "0")}`,
    lastName: demoLastNames[index % demoLastNames.length],
    firstName: demoFirstNames[index % demoFirstNames.length],
    gender: index % 2 === 0 ? "Féminin" : "Masculin",
    phone: `+243 830 000 ${String(index).padStart(3, "0")}`,
    email: `user-${index}@somafrik.demo`,
    role,
    secondaryRoles: index % 6 === 0 ? ["Auditeur"] : [],
    scopeLevel: role === "Super Administrateur Somafrik" ? "Global" : role === "Admin Pays" ? "Pays" : "Établissement",
    countryScope: schoolItem.country,
    schoolCode: isBackOffice ? "*" : schoolItem.code,
    accessChannel: isBackOffice ? "BackOffice" : "Application",
    identifier: isBackOffice
      ? `demo-user-${index}`
      : role === "Enseignant"
        ? `ENS-${String(index).padStart(4, "0")}`
        : role === "Élève / Étudiant"
          ? `ETU-${String(index).padStart(4, "0")}`
          : role === "Parent"
            ? `+243 830 000 ${String(index).padStart(3, "0")}`
            : `USR-${String(index).padStart(5, "0")}`,
    status: index % 13 === 0 ? "Suspendu" : "Actif",
    permissions: rolePermissions[role] ?? ["Voir tableau de bord"],
    temporaryPassword: "1234",
    photoUrl: "",
    createdAt: `${String((index % 27) + 1).padStart(2, "0")}-01-2026`,
    lastLoginAt: `${String((index % 27) + 1).padStart(2, "0")}-06-2026`,
    createdBy: "Super Administrateur Somafrik",
    history: [`Compte démo ${index} créé automatiquement`],
  });
}

export function getStudentById(studentId: string) {
  return students.find((student) => student.id === studentId);
}

export function getTeacherById(teacherId: string) {
  return teachers.find((teacher) => teacher.id === teacherId);
}

export function getTeacherClasses(teacher: Teacher | undefined) {
  return [...new Set((teacher?.assignments ?? []).map((assignment) => assignment.className))];
}

export function getTeacherCourses(teacher: Teacher | undefined) {
  return [...new Set((teacher?.assignments ?? []).map((assignment) => assignment.course))];
}

export function getPresenceRate(studentIds: string[]) {
  const rows = presences.filter((presence) => studentIds.includes(presence.studentId));

  if (rows.length === 0) {
    return 0;
  }

  const attended = rows.filter((presence) => {
    const status = presence.status === "Present" ? "Présent" : presence.status;
    return status ? status === "Présent" || status === "Retard" : presence.present;
  }).length;

  return Math.round((attended / rows.length) * 100);
}

export function getPaymentRate(studentIds: string[]) {
  const rows = payments.filter((payment) => studentIds.includes(payment.studentId));

  if (rows.length === 0) {
    return 0;
  }

  return Math.round((rows.filter((payment) => payment.status === "PAYE").length / rows.length) * 100);
}
