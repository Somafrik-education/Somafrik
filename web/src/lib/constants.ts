/** Intervalle de synchronisation automatique avec le backend (5 minutes). */
export const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export const CRUD_ACTIONS = [
  { key: "READ", label: "Lire" },
  { key: "CREATE", label: "Créer" },
  { key: "UPDATE", label: "Modifier" },
  { key: "DELETE", label: "Supprimer" },
  { key: "SUSPEND", label: "Suspendre" },
] as const;

export const CRUD_PERMISSION_MODULES = [
  "Pays",
  "Établissements",
  "Abonnements",
  "Utilisateurs",
  "Classes",
  "Élèves",
  "Enseignants",
  "Affectations",
  "Présences",
  "Notes",
  "Bulletins",
  "Paiements",
  "Notifications",
  "Messages",
  "Documents",
  "Rapports",
  "Paramètres Établissement",
  "Années Académiques",
  "Matières",
  "Examens",
  "Planning de cours",
] as const;

// view -> fonctionnalité requise (null = toujours accessible)
export const VIEW_PERMISSION_FEATURES: Record<string, string | null> = {
  overview: null,
  establishment: null,
  configuration: "Paramètres Établissement",
  countries: "Pays",
  schools: "Établissements",
  subscriptions: "Abonnements",
  notifications: "Notifications",
  users: "Utilisateurs",
  reports: "Rapports",
  permissions: "Droits par rôle",
  chartSettings: "Paramètres graphiques",
  academicSettings: "Paramètres Établissement",
  bulletinDesign: "Conception bulletins",
  students: "Élèves",
  teachers: "Enseignants",
  classes: "Classes",
  courses: "Matières",
  assignments: "Affectations",
  planning: "Planning de cours",
  payments: "Paiements",
  announcements: "Notifications",
  messages: "Messages",
  presences: "Présences",
  notes: "Notes",
  exams: "Examens",
  bulletins: "Bulletins",
  documents: "Documents",
};

export interface NavItem {
  view: string;
  path: string;
  label: string;
  /** Si true, visible uniquement pour les rôles internes établissement */
  schoolOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { view: "overview", path: "/tableau-de-bord", label: "Tableau de bord" },
  { view: "establishment", path: "/etablissement", label: "Pilotage établissement", schoolOnly: true },
  { view: "configuration", path: "/configuration", label: "Configuration" },
  { view: "classes", path: "/classes", label: "Classes", schoolOnly: true },
  { view: "courses", path: "/matieres", label: "Matières", schoolOnly: true },
  { view: "assignments", path: "/affectations", label: "Affectations", schoolOnly: true },
  { view: "planning", path: "/planning", label: "Planning de cours", schoolOnly: true },
  { view: "payments", path: "/paiements", label: "Paiements", schoolOnly: true },
  { view: "messages", path: "/messages", label: "Messages", schoolOnly: true },
  { view: "presences", path: "/presences", label: "Présences", schoolOnly: true },
  { view: "notes", path: "/notes", label: "Notes", schoolOnly: true },
  { view: "exams", path: "/examens", label: "Examens", schoolOnly: true },
  { view: "bulletins", path: "/bulletins", label: "Bulletins", schoolOnly: true },
  { view: "documents", path: "/documents", label: "Documents", schoolOnly: true },
  { view: "announcements", path: "/annonces", label: "Annonces", schoolOnly: true },
  { view: "countries", path: "/pays", label: "Pays" },
  { view: "schools", path: "/etablissements", label: "Établissements" },
  { view: "subscriptions", path: "/abonnements", label: "Abonnements" },
  { view: "notifications", path: "/notifications", label: "Notifications" },
  { view: "users", path: "/utilisateurs", label: "Utilisateurs" },
  { view: "permissions", path: "/permissions", label: "Droits par rôle" },
  { view: "chartSettings", path: "/parametres-graphiques", label: "Graphiques" },
  { view: "bulletinDesign", path: "/conception-bulletins", label: "Conception bulletins" },
  { view: "reports", path: "/rapports", label: "Conformité MVP" },
];

export const MVP_COVERAGE = [
  ["Authentification par établissement", "Web / Mobile", "Couvert", "P0"],
  ["Établissements SaaS", "Plateforme", "Couvert", "P0"],
  ["Utilisateurs et permissions", "Plateforme / Mobile", "Couvert", "P0"],
  ["Élèves", "Web / Mobile", "Couvert", "P0"],
  ["Classes et enseignants", "Web / Mobile", "Couvert", "P0"],
  ["Présences et appels", "Web / Mobile", "Couvert", "P0"],
  ["Notes simples", "Web / Mobile", "Couvert", "P0"],
  ["Paiements scolaires", "Web / Mobile", "Couvert", "P0"],
  ["Notifications", "Web / Mobile", "Couvert", "P1"],
  ["Dashboards", "Web / Mobile", "Couvert", "P1"],
  ["Super Admin / Admin Pays", "Plateforme", "Couvert", "P1"],
  ["Séparation de données", "SaaS", "Couvert", "P0"],
].map(([module, scope, status, priority]) => ({ module, scope, status, priority }));
