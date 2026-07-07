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
  "Contacts",
  "Relations",
  "Utilisateurs",
  "Classes",
  "Élèves",
  "Enseignants",
  "Affectations",
  "Présences",
  "Notes",
  "Bulletins",
  "Paiements",
  "Frais & tarifs",
  "Impayés",
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
  mySubscription: "Mon abonnement",
  notifications: "Notifications",
  contacts: "Contacts",
  relations: "Relations",
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
  fees: "Frais & tarifs",
  unpaid: "Frais & tarifs",
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
  | "administration"
  | "parametres";

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
  { group: "administration", label: "Administration" },
  { group: "parametres", label: "Paramètres" },
];

export const NAV_ITEMS: NavItem[] = [
  // Tableau de bord (vue synthétique selon le rôle)
  { view: "overview", path: "/tableau-de-bord", label: "Tableau de bord", group: "dashboard" },

  // Paramétrage plateforme (Super Admin / Admin Pays)
  { view: "countries", path: "/pays", label: "Pays", group: "plateforme" },
  { view: "schools", path: "/etablissements", label: "Établissements", group: "plateforme" },
  { view: "subscriptions", path: "/abonnements", label: "Abonnements", group: "plateforme" },

  // Mon établissement (Classes, Matières, Élèves, Enseignants, Contacts, Parents & élèves)
  { view: "establishment", path: "/etablissement", label: "Mon établissement", group: "etablissement", schoolOnly: true },

  // Pédagogie : enseigner puis évaluer
  { view: "planning", path: "/planning", label: "Planning de cours", group: "pedagogie", schoolOnly: true },
  { view: "presences", path: "/presences", label: "Appels & présences", group: "pedagogie", schoolOnly: true },
  { view: "notes", path: "/notes", label: "Notes & évaluations", group: "pedagogie", schoolOnly: true },
  { view: "exams", path: "/examens", label: "Examens", group: "pedagogie", schoolOnly: true },
  { view: "bulletins", path: "/bulletins", label: "Bulletins", group: "pedagogie", schoolOnly: true },

  // Finances (module à onglets : Paiements, Frais, Impayés)
  { view: "payments", path: "/finances", label: "Finances", group: "finances", schoolOnly: true },

  // Communication : Messages, Annonces et Notifications sont accessibles via les icônes
  // en haut à droite (voir Topbar), pas dans le menu latéral.

  // Administration (module à onglets : Utilisateurs, Rôles & permissions, Documents, Conformité)
  { view: "users", path: "/administration", label: "Administration", group: "administration" },

  // Paramètres (module à onglets : Établissement, Graphiques, Conception bulletins)
  { view: "configuration", path: "/parametres", label: "Paramètres", group: "parametres" },
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
