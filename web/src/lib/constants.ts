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

/** Domaines métier du menu, dans l'ordre du cycle de vie d'un établissement. */
export type NavGroup =
  | "dashboard"
  | "plateforme"
  | "etablissement"
  | "pedagogie"
  | "finances"
  | "communication"
  | "administration";

export interface NavItem {
  view: string;
  path: string;
  label: string;
  group: NavGroup;
  /** Si true, visible uniquement pour les rôles internes établissement */
  schoolOnly?: boolean;
}

/** Ordre d'affichage des sections + intitulé du bandeau (le dashboard n'a pas d'en-tête). */
export const NAV_GROUP_ORDER: { group: NavGroup; label: string }[] = [
  { group: "plateforme", label: "Paramétrage plateforme" },
  { group: "etablissement", label: "Établissement" },
  { group: "pedagogie", label: "Pédagogie" },
  { group: "finances", label: "Finances" },
  { group: "communication", label: "Communication" },
  { group: "administration", label: "Administration" },
];

export const NAV_ITEMS: NavItem[] = [
  // Tableau de bord (vue synthétique selon le rôle)
  { view: "overview", path: "/tableau-de-bord", label: "Tableau de bord", group: "dashboard" },

  // Paramétrage plateforme (Super Admin / Admin Pays)
  { view: "countries", path: "/pays", label: "Pays", group: "plateforme" },
  { view: "schools", path: "/etablissements", label: "Établissements", group: "plateforme" },
  { view: "subscriptions", path: "/abonnements", label: "Abonnements", group: "plateforme" },

  // Établissement : configurer puis organiser
  { view: "establishment", path: "/etablissement", label: "Pilotage", group: "etablissement", schoolOnly: true },
  { view: "configuration", path: "/configuration", label: "Paramètres", group: "etablissement" },
  { view: "classes", path: "/classes", label: "Classes", group: "etablissement", schoolOnly: true },
  { view: "courses", path: "/matieres", label: "Matières", group: "etablissement", schoolOnly: true },
  { view: "students", path: "/configuration/eleves", label: "Élèves / Étudiants", group: "etablissement", schoolOnly: true },
  { view: "teachers", path: "/configuration/enseignants", label: "Enseignants", group: "etablissement", schoolOnly: true },

  // Pédagogie : enseigner puis évaluer
  { view: "planning", path: "/planning", label: "Planning de cours", group: "pedagogie", schoolOnly: true },
  { view: "presences", path: "/presences", label: "Appels & présences", group: "pedagogie", schoolOnly: true },
  { view: "notes", path: "/notes", label: "Notes & évaluations", group: "pedagogie", schoolOnly: true },
  { view: "exams", path: "/examens", label: "Examens", group: "pedagogie", schoolOnly: true },
  { view: "bulletins", path: "/bulletins", label: "Bulletins", group: "pedagogie", schoolOnly: true },

  // Finances
  { view: "payments", path: "/paiements", label: "Paiements", group: "finances", schoolOnly: true },

  // Communication
  { view: "messages", path: "/messages", label: "Messages", group: "communication", schoolOnly: true },
  { view: "announcements", path: "/annonces", label: "Annonces", group: "communication", schoolOnly: true },
  // Notifications : accessibles via la cloche en haut à droite (voir Topbar), pas dans le menu latéral.

  // Administration : gouvernance, sécurité, conformité
  { view: "users", path: "/utilisateurs", label: "Utilisateurs", group: "administration" },
  { view: "permissions", path: "/permissions", label: "Rôles & permissions", group: "administration" },
  { view: "documents", path: "/documents", label: "Documents", group: "administration", schoolOnly: true },
  { view: "chartSettings", path: "/parametres-graphiques", label: "Graphiques", group: "administration" },
  { view: "bulletinDesign", path: "/conception-bulletins", label: "Conception bulletins", group: "administration" },
  { view: "reports", path: "/rapports", label: "Conformité", group: "administration" },
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
