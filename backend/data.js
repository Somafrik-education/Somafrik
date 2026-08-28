const { buildSchoolBulletinBundle } = require("./lib/bulletinSeedData");
const { buildSchoolPlanningSlots, buildAcademicConfigForSchool } = require("./lib/planningSeedData");

// Seed mémoire : `code` = alias interne school_code (tests / lecture legacy).
// Code public canonique = `loginCode` / `publicId` = CD-IN-26-001.
// Aucune nouvelle création ne doit réutiliser CD-YYYY-NNNN.
const school = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  publicId: "CD-IN-26-001",
  code: "CD-2026-0001",
  loginCode: "CD-IN-26-001",
  name: "Universite de Kinshasa",
  type: "Universite",
  city: "Kinshasa",
  country: "RDC",
  countryCode: "CD",
  address: "Avenue de l'Universite, Kinshasa",
  phone: "+243 810 000 000",
  email: "contact@unikin.somafrik",
  website: "https://unikin.somafrik",
  currency: "CDF",
  slogan: "Excellence et Innovation",
  status: "Actif",
  logoUrl: "",
  schoolYear: "2025-2026",
  timezone: "GMT+1",
  language: "Français",
  dateFormat: "JJ-MM-AAAA",
  primaryColor: "#2563EB",
  subscriptionPlan: "Premium",
  subscriptionStartDate: "01-09-2025",
  subscriptionEndDate: "31-08-2026",
  validationStatus: "Validé",
  subscriptionStatus: "À jour",
  maxStudents: 1200,
  maxTeachers: 120,
  createdAt: "01-09-2025",
};

const rolePermissions = {
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
    "Gérer administrateurs écoles",
    "Voir rapports pays",
    "Suivre abonnements pays",
    "Relancer établissements en retard",
    "Auditer utilisateurs pays",
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
    "Enseignants:UPDATE",
    "Enseignants:DELETE",
    "Affectations:READ",
    "Affectations:CREATE",
    "Affectations:UPDATE",
    "Affectations:DELETE",
    "Voir classes",
    "Voir notes",
    "Voir présences",
    "Organiser examens",
    "Modifier présences",
    "Planning de cours:READ",
    "Planning de cours:CREATE",
    "Planning de cours:UPDATE",
    "Planning de cours:DELETE",
    "Salles:READ",
    "Salles:CREATE",
    "Salles:UPDATE",
    "Salles:DELETE",
    "Remplacements:READ",
    "Remplacements:CREATE",
    "Remplacements:UPDATE",
    "Remplacements:DELETE",
    "Gérer planning académique",
    "Créer rapports disciplinaires",
  ],
  Directeur: ["Voir élèves", "Modifier notes", "Gérer paiements", "Gérer utilisateurs", "Voir rapports"],
  Secrétaire: ["Voir élèves", "Gérer élèves", "Gérer paiements", "Gérer appels"],
  Enseignant: [
    "Voir élèves",
    "Modifier notes",
    "Faire appel",
    "Messages parents",
    "Voir examens",
    "Voir bulletins",
    "Voir documents",
    "Planning de cours:READ",
    "Salles:READ",
    "Remplacements:READ",
  ],
  Parent: ["Voir enfant", "Voir notes", "Voir présences", "Voir paiements", "Messages école"],
  "Élève / Étudiant": ["Voir notes", "Voir présences", "Voir paiements"],
  Comptable: ["Gérer paiements", "Voir rapports financiers"],
  Surveillant: ["Voir élèves", "Gérer appels", "Gérer discipline"],
};

const securityMatrix = {
  Pays: {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "R",
    "Admin School": "-",
    "Préfet des études": "-",
    Enseignant: "-",
    Secrétaire: "-",
    Parent: "-",
    "Élève / Étudiant": "-",
  },
  "Établissements": {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "CRUD",
    "Admin School": "-",
    "Préfet des études": "-",
    Enseignant: "-",
    Secrétaire: "-",
    Parent: "-",
    "Élève / Étudiant": "-",
  },
  Utilisateurs: {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "CRUD",
    "Admin School": "CRUD",
    "Préfet des études": "R",
    Enseignant: "-",
    Secrétaire: "-",
    Parent: "-",
    "Élève / Étudiant": "-",
  },
  Contacts: {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "R",
    "Admin School": "CRUD",
    "Préfet des études": "R",
    Enseignant: "-",
    Secrétaire: "R",
    Parent: "-",
    "Élève / Étudiant": "-",
  },
  Relations: {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "-",
    "Admin School": "CRUD",
    "Préfet des études": "R",
    Enseignant: "-",
    Secrétaire: "R",
    Parent: "-",
    "Élève / Étudiant": "-",
  },
  Classes: {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "-",
    "Admin School": "CRUD",
    "Préfet des études": "CRUD",
    Enseignant: "R",
    Secrétaire: "R",
    Parent: "R",
    "Élève / Étudiant": "R",
  },
  Élèves: {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "-",
    "Admin School": "CRUD",
    "Préfet des études": "CRUD",
    Enseignant: "R",
    Secrétaire: "CRUD",
    Parent: "R",
    "Élève / Étudiant": "R",
  },
  Enseignants: {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "-",
    "Admin School": "R",
    "Préfet des études": "R",
    Enseignant: "-",
    Secrétaire: "R",
    Parent: "-",
    "Élève / Étudiant": "-",
  },
  Affectations: {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "-",
    "Admin School": "CRUD",
    "Préfet des études": "CRUD",
    Enseignant: "R",
    Secrétaire: "R",
    Parent: "-",
    "Élève / Étudiant": "-",
  },
  Présences: {
    "Super Administrateur Somafrik": "R",
    "Admin Pays": "-",
    "Admin School": "R",
    "Préfet des études": "CRUD",
    Enseignant: "CRUD",
    Secrétaire: "CRUD",
    Parent: "R",
    "Élève / Étudiant": "R",
  },
  Notes: {
    "Super Administrateur Somafrik": "R",
    "Admin Pays": "-",
    "Admin School": "R",
    "Préfet des études": "CRUD",
    Enseignant: "CRUD",
    Secrétaire: "-",
    Parent: "R",
    "Élève / Étudiant": "R",
  },
  Bulletins: {
    "Super Administrateur Somafrik": "R",
    "Admin Pays": "-",
    "Admin School": "R",
    "Préfet des études": "CRUD",
    Enseignant: "R",
    Secrétaire: "R",
    Parent: "R",
    "Élève / Étudiant": "R",
  },
  Paiements: {
    "Super Administrateur Somafrik": "R",
    "Admin Pays": "-",
    "Admin School": "R",
    "Préfet des études": "R",
    Enseignant: "-",
    Secrétaire: "CRUD",
    Parent: "R",
    "Élève / Étudiant": "R",
  },
  "Frais & tarifs": {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "-",
    "Admin School": "CRUD",
    "Préfet des études": "R",
    Enseignant: "-",
    Secrétaire: "R",
    Parent: "R",
    "Élève / Étudiant": "R",
  },
  "Frais & tarifs": {
    "Super Administrateur Somafrik": "R",
    "Admin Pays": "-",
    "Admin School": "CRUD",
    "Préfet des études": "R",
    Enseignant: "-",
    Secrétaire: "R",
    Parent: "-",
    "Élève / Étudiant": "-",
  },
  Abonnements: {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "CRUD",
    "Admin School": "-",
    "Préfet des études": "-",
    Enseignant: "-",
    Secrétaire: "R",
    Parent: "-",
    "Élève / Étudiant": "-",
  },
  Notifications: {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "CRUD",
    "Admin School": "CRUD",
    "Préfet des études": "CRUD",
    Enseignant: "R",
    Secrétaire: "CRUD",
    Parent: "R",
    "Élève / Étudiant": "R",
  },
  Announcements: {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "CRUD",
    "Admin School": "CRUD",
    "Préfet des études": "CRUD",
    Enseignant: "R",
    Secrétaire: "CRUD",
    Parent: "R",
    "Élève / Étudiant": "R",
  },
  Messages: {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "CRUD",
    "Admin School": "CRUD",
    "Préfet des études": "CRUD",
    Enseignant: "CRUD",
    Secrétaire: "CRUD",
    Parent: "CRUD",
    "Élève / Étudiant": "CRUD",
  },
  Documents: {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "-",
    "Admin School": "CRUD",
    "Préfet des études": "CRUD",
    Enseignant: "R",
    Secrétaire: "CRUD",
    Parent: "R",
    "Élève / Étudiant": "R",
  },
  Rapports: {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "R",
    "Admin School": "CRUD",
    "Préfet des études": "CRUD",
    Enseignant: "R",
    Secrétaire: "R",
    Parent: "R",
    "Élève / Étudiant": "R",
  },
  "Paramètres Établissement": {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "-",
    "Admin School": "CRUD",
    "Préfet des études": "R",
    Enseignant: "-",
    Secrétaire: "-",
    Parent: "-",
    "Élève / Étudiant": "-",
  },
  "Années Académiques": {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "-",
    "Admin School": "CRUD",
    "Préfet des études": "R",
    Enseignant: "R",
    Secrétaire: "-",
    Parent: "-",
    "Élève / Étudiant": "-",
  },
  Matières: {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "-",
    "Admin School": "CRUD",
    "Préfet des études": "CRUD",
    Enseignant: "R",
    Secrétaire: "-",
    Parent: "-",
    "Élève / Étudiant": "-",
  },
  Examens: {
    "Super Administrateur Somafrik": "CRUD",
    "Admin Pays": "-",
    "Admin School": "CRUD",
    "Préfet des études": "CRUD",
    Enseignant: "R",
    Secrétaire: "-",
    Parent: "-",
    "Élève / Étudiant": "-",
  },
  "Planning de cours": {
    "Super Administrateur Somafrik": "-",
    "Admin Pays": "-",
    "Admin School": "CRUD",
    "Préfet des études": "CRUD",
    Enseignant: "R",
    Secrétaire: "-",
    Parent: "-",
    "Élève / Étudiant": "-",
  },
  Salles: {
    "Super Administrateur Somafrik": "-",
    "Admin Pays": "-",
    "Admin School": "CRUD",
    "Préfet des études": "CRUD",
    Enseignant: "R",
    Secrétaire: "-",
    Parent: "-",
    "Élève / Étudiant": "-",
  },
  Remplacements: {
    "Super Administrateur Somafrik": "-",
    "Admin Pays": "-",
    "Admin School": "CRUD",
    "Préfet des études": "CRUD",
    Enseignant: "R",
    Secrétaire: "-",
    Parent: "-",
    "Élève / Étudiant": "-",
  },
};

function permissionsFromSecurityMatrix(role) {
  const matrixRole = role === "Proviseur" || role === "Directeur" ? "Préfet des études" : role;
  return Object.entries(securityMatrix).flatMap(([feature, grants]) => {
    const access = grants[matrixRole] ?? "-";
    if (access === "-") return [];
    const actions = access === "CRUD" ? ["READ", "CREATE", "UPDATE", "DELETE", "SUSPEND"] : ["READ"];
    return actions.map((action) => `${feature}:${action}`);
  });
}

/** Listes métier déclarées, avant union avec la matrice dashboard (UI). */
const rolePermissionsDeclared = Object.fromEntries(
  Object.entries(rolePermissions).map(([role, permissions]) => [role, [...permissions]]),
);

const PLATFORM_LIVE_RBAC_ROLES = new Set([
  "Super Administrateur Somafrik",
  "Super Administrateur OKAFRIK",
  "Admin Pays",
  "Admin School",
]);

for (const role of Object.keys(rolePermissions)) {
  rolePermissions[role] = [...new Set([...(rolePermissions[role] ?? []), ...permissionsFromSecurityMatrix(role)])];
}

rolePermissions["Super Administrateur Somafrik"] = [
  ...new Set(Object.values(rolePermissions).flat()),
];

const { PedagogyGovernanceService } = require("./services/pedagogyGovernanceService");
const pedagogyGovernance = new PedagogyGovernanceService();
const sanitizedSchoolPermissions = pedagogyGovernance.sanitizeSchoolAdminRolePermissions(rolePermissions);
rolePermissions["Admin School"] = sanitizedSchoolPermissions["Admin School"];

/**
 * Carte utilisée par le backfill CRUD live uniquement (seed/bootstrap).
 * Après bootstrap, l'autorité est role_module_permissions PostgreSQL.
 * Ne pas servir cette carte comme source runtime des écrans métier.
 */
function rolePermissionsForLiveRbac() {
  const map = {};
  for (const [role, permissions] of Object.entries(rolePermissions)) {
    map[role] = PLATFORM_LIVE_RBAC_ROLES.has(role)
      ? [...permissions]
      : [...(rolePermissionsDeclared[role] ?? permissions)];
  }
  return map;
}

const countries = [
  {
    id: "COUNTRY-RDC",
    name: "République Démocratique du Congo",
    code: "CD",
    phonePrefix: "+243",
    currency: "CDF",
    timezone: "GMT+1",
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
    timezone: "GMT+1",
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
    timezone: "GMT+2",
    status: "Actif",
    administratorId: "USER-COUNTRY-BI",
    createdAt: "15-05-2026",
  },
];

const subscriptions = [
  {
    id: "SUB-CD-2026-0001",
    schoolCode: "CD-2026-0001",
    countryCode: "CD",
    country: "RDC",
    offerId: "OFFER-PREMIUM-CD",
    plan: "Premium",
    monthlyPrice: 120,
    annualPrice: 1200,
    currency: "USD",
    status: "Actif",
    lifecycleStatus: "Actif",
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
    offerId: "OFFER-STANDARD-CG",
    plan: "Standard",
    monthlyPrice: 80,
    annualPrice: 800,
    currency: "USD",
    status: "Suspendu",
    lifecycleStatus: "Suspendu",
    paymentStatus: "En retard",
    accessLevel: "blocked",
    startDate: "01-01-2026",
    endDate: "31-05-2026",
    lastPaymentDate: "01-04-2026",
  },
];

const GLOBAL_PLAN_PRICING = {
  Standard: { monthlyPrice: 90, annualPrice: 900 },
  Premium: { monthlyPrice: 120, annualPrice: 1200 },
};

function buildSubscriptionOffersForCountry(country) {
  const code = String(country.code ?? "").trim().toUpperCase();
  if (!code) return [];
  const currency = String(country.currency ?? "USD").trim().toUpperCase();
  const policy = country.subscriptionPolicy ?? {};
  const standardMonthly = policy.plans?.Standard?.monthlyPrice ?? GLOBAL_PLAN_PRICING.Standard.monthlyPrice;
  const standardAnnual = policy.plans?.Standard?.annualPrice ?? GLOBAL_PLAN_PRICING.Standard.annualPrice;
  const premiumMonthly = policy.plans?.Premium?.monthlyPrice ?? GLOBAL_PLAN_PRICING.Premium.monthlyPrice;
  const premiumAnnual = policy.plans?.Premium?.annualPrice ?? GLOBAL_PLAN_PRICING.Premium.annualPrice;

  return [
    {
      id: `OFFER-TRIAL-${code}`,
      name: "Essai gratuit",
      targetAudience: "Nouvel établissement",
      monthlyPrice: 0,
      annualPrice: 0,
      currency,
      countryCodes: [code],
      maxStudents: 200,
      maxTeachers: 20,
      maxUsers: 30,
      storageGb: 1,
      trialDays: 30,
      active: true,
      modules: {
        students: true,
        classes: true,
        presences: true,
        notes: "limited",
        bulletins: false,
        payments: false,
        communication: "limited",
        statistics: false,
        api: false,
        support: false,
      },
      notes: "Une seule période d'essai par établissement.",
    },
    {
      id: `OFFER-STANDARD-${code}`,
      name: "Standard",
      targetAudience: "École privée petite / moyenne",
      monthlyPrice: standardMonthly,
      quarterlyPrice: Math.round(standardMonthly * 2.85),
      annualPrice: standardAnnual,
      currency,
      countryCodes: [code],
      maxStudents: 500,
      maxTeachers: 50,
      maxUsers: 80,
      storageGb: 5,
      active: true,
      modules: {
        students: true,
        classes: true,
        presences: true,
        notes: true,
        bulletins: true,
        payments: true,
        communication: true,
        statistics: "limited",
        api: false,
        support: false,
      },
    },
    {
      id: `OFFER-PREMIUM-${code}`,
      name: "Premium",
      targetAudience: "Grande école / université",
      monthlyPrice: premiumMonthly,
      quarterlyPrice: Math.round(premiumMonthly * 2.85),
      annualPrice: premiumAnnual,
      currency,
      countryCodes: [code],
      maxStudents: null,
      maxTeachers: null,
      maxUsers: null,
      storageGb: 20,
      active: true,
      modules: {
        students: true,
        classes: true,
        presences: true,
        notes: true,
        bulletins: true,
        payments: true,
        communication: true,
        statistics: true,
        api: true,
        support: true,
      },
    },
    {
      id: `OFFER-CUSTOM-${code}`,
      name: "Sur mesure",
      targetAudience: "Groupe scolaire / université",
      monthlyPrice: 0,
      annualPrice: 0,
      currency,
      countryCodes: [code],
      maxStudents: null,
      maxTeachers: null,
      maxUsers: null,
      storageGb: 50,
      active: true,
      modules: {
        students: true,
        classes: true,
        presences: true,
        notes: true,
        bulletins: true,
        payments: true,
        communication: true,
        statistics: true,
        api: true,
        support: true,
      },
      notes: "Contrat personnalisé — tarif négocié.",
    },
  ];
}

const subscriptionOffers = countries.flatMap(buildSubscriptionOffersForCountry);

const platformNotifications = [
  {
    id: "NOTIF-001",
    audience: "Super Administrateur Somafrik",
    countryCode: "*",
    title: "Nouveau pays créé",
    message: "La République du Congo a été ajoutée au périmètre Somafrik.",
    type: "Pays",
    priority: "Moyenne",
    channels: ["Web", "Tablette", "Mobile"],
    status: "Non lu",
    date: "01-06-2026",
    createdBy: "Système",
  },
  {
    id: "NOTIF-002",
    audience: "Super Administrateur Somafrik",
    countryCode: "*",
    title: "Abonnement expiré",
    message: "Un abonnement pays est arrivé à échéance.",
    type: "Abonnement",
    priority: "Haute",
    channels: ["Web", "Tablette", "Mobile"],
    status: "Non lu",
    date: "01-06-2026",
    createdBy: "Système",
  },
  {
    id: "NOTIF-003",
    audience: "Admin Pays",
    countryCode: "CD",
    title: "Paiement reçu",
    message: "Université de Kinshasa a réglé son abonnement Premium.",
    type: "Paiement",
    priority: "Moyenne",
    channels: ["Web", "Tablette", "Mobile"],
    status: "Lu",
    date: "01-06-2026",
    createdBy: "Système",
  },
  {
    id: "NOTIF-004",
    audience: "Admin Pays",
    countryCode: "CD",
    title: "Nouvelle demande d'inscription",
    message: "Une nouvelle école attend validation dans votre pays.",
    type: "Inscription",
    priority: "Haute",
    channels: ["Web", "Tablette", "Mobile"],
    status: "Non lu",
    date: "02-06-2026",
    createdBy: "Système",
  },
];

const userAccounts = [
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
    password: "1234",
    status: "Actif",
    permissions: rolePermissions["Admin School"],
    temporaryPassword: "",
    photoUrl: "",
    createdAt: "01-09-2025",
    lastLoginAt: "01-06-2026",
    createdBy: "Super Administrateur Somafrik",
    history: ["Compte initial créé le 01-09-2025"],
  },
  {
    id: "USER-ADMIN-BI-SCHOOL",
    publicId: "USR-2026-000010",
    lastName: "Administrateur",
    firstName: "Bujumbura",
    gender: "Masculin",
    phone: "+257 710 000 010",
    email: "admin@bujumbura.somafrik",
    role: "Admin School",
    secondaryRoles: [],
    scopeLevel: "Établissement",
    countryScope: "BI",
    schoolCode: "BI-2026-0002",
    accessChannel: "Application",
    identifier: "admin",
    password: "1234",
    status: "Actif",
    permissions: rolePermissions["Admin School"],
    temporaryPassword: "",
    photoUrl: "",
    createdAt: "01-09-2025",
    lastLoginAt: "01-06-2026",
    createdBy: "Super Administrateur Somafrik",
    history: ["Compte admin établissement BI créé pour isolation multi-écoles"],
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
    password: "1234",
    status: "Actif",
    permissions: rolePermissions["Super Administrateur Somafrik"],
    temporaryPassword: "",
    photoUrl: "",
    createdAt: "01-09-2025",
    lastLoginAt: "01-06-2026",
    createdBy: "Système",
    history: ["Compte global créé le 01-09-2025"],
  },
  {
    id: "USER-COUNTRY-RDC",
    publicId: "ADM-CD-2026-0001",
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
    password: "1234",
    status: "Actif",
    permissions: rolePermissions["Admin Pays"],
    temporaryPassword: "",
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
    password: "1234",
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
    password: "1234",
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
    password: "1234",
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
    identifier: "ENS-0001",
    password: "1234",
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
    password: "1234",
    status: "Actif",
    permissions: rolePermissions.Parent,
    temporaryPassword: "",
    photoUrl: "",
    createdAt: "01-09-2025",
    lastLoginAt: "31-05-2026",
    createdBy: "Administrateur",
    history: ["Compte parent créé le 01-09-2025"],
  },
  {
    id: "USER-STUDENT-0001",
    publicId: "CD-IN-EL-26-001",
    identityCode: "CD-IN-EL-26-001",
    loginCode: "CD-IN-EL-26-001",
    lastName: "Dupont",
    firstName: "Jean",
    gender: "Masculin",
    phone: "",
    email: "jean.dupont@example.com",
    role: "Élève / Étudiant",
    secondaryRoles: [],
    scopeLevel: "Établissement",
    countryScope: "RDC",
    schoolCode: "CD-2026-0001",
    accessChannel: "Application",
    identifier: "CD-IN-EL-26-001",
    password: "1234",
    status: "Actif",
    permissions: rolePermissions["Élève / Étudiant"],
    temporaryPassword: "",
    photoUrl: "",
    createdAt: "01-09-2025",
    lastLoginAt: "",
    createdBy: "Administrateur",
    history: ["Compte élève créé le 01-09-2025"],
  },
];

const teachers = [
  {
    id: "T1",
    userId: "USER-T1",
    publicId: "CD-2026-0001-ENS-0001",
    identifier: "ENS-0001",
    schoolCode: "CD-2026-0001",
    name: "Jean Kabeya",
    firstName: "Jean",
    gender: "Masculin",
    phone: "+243 810 000 101",
    email: "jean.kabeya@somafrik.cd",
    mainSubject: "Mathematiques",
    password: "1234",
    assignments: [
      { className: "6ème A", course: "Mathématiques" , status: "active" },
      { className: "6ème B", course: "Mathématiques" , status: "active" },
      { className: "5ème A", course: "Physique" , status: "active" },
    ],
  },
  {
    id: "T2",
    publicId: "CD-2026-0001-ENS-0002",
    identifier: "ENS-0002",
    schoolCode: "CD-2026-0001",
    name: "Marie Mukendi",
    firstName: "Marie",
    gender: "Féminin",
    phone: "+243 810 000 102",
    email: "marie.mukendi@somafrik.cd",
    mainSubject: "Francais",
    password: "1234",
    assignments: [
      { className: "6ème A", course: "Français" , status: "active" },
      { className: "5ème B", course: "Français" , status: "active" },
    ],
  },
  {
    id: "T3",
    publicId: "CD-2026-0001-ENS-0003",
    identifier: "ENS-0003",
    schoolCode: "CD-2026-0001",
    name: "Patrick Ilunga",
    firstName: "Patrick",
    gender: "Masculin",
    phone: "+243 810 000 103",
    email: "patrick.ilunga@somafrik.cd",
    mainSubject: "Sciences",
    password: "1234",
    assignments: [
      { className: "6ème B", course: "Sciences" , status: "active" },
      { className: "5ème A", course: "Sciences" , status: "active" },
    ],
  },
  {
    id: "T4",
    publicId: "CD-2026-0001-ENS-0004",
    identifier: "ENS-0004",
    schoolCode: "CD-2026-0001",
    name: "Sarah Mbuyi",
    firstName: "Sarah",
    gender: "Féminin",
    phone: "+243 810 000 104",
    email: "sarah.mbuyi@somafrik.cd",
    mainSubject: "Histoire",
    password: "1234",
    assignments: [
      { className: "5ème A", course: "Histoire" , status: "active" },
      { className: "5ème B", course: "Histoire" , status: "active" },
    ],
  },
];

const classes = [
  { id: "C1", publicId: "CLS-2026-000001", name: "6ème A", level: "6ème", track: "Generale", teacherId: "T1" },
  { id: "C2", publicId: "CLS-2026-000002", name: "6ème B", level: "6ème", track: "Generale", teacherId: "T2" },
  { id: "C3", publicId: "CLS-2026-000003", name: "5ème A", level: "5ème", track: "Sciences", teacherId: "T3" },
  { id: "C4", publicId: "CLS-2026-000004", name: "5ème B", level: "5ème", track: "Lettres", teacherId: "T4" },
];

const courses = [
  { id: "COURSE1", publicId: "COU-2026-000001", schoolCode: "CD-2026-0001", className: "6ème A", name: "Mathématiques", coefficient: 3 },
  { id: "COURSE2", publicId: "COU-2026-000002", schoolCode: "CD-2026-0001", className: "6ème A", name: "Français", coefficient: 3 },
  { id: "COURSE3", publicId: "COU-2026-000003", schoolCode: "CD-2026-0001", className: "6ème A", name: "Sciences", coefficient: 2 },
  { id: "COURSE4", publicId: "COU-2026-000004", schoolCode: "CD-2026-0001", className: "6ème A", name: "Anglais", coefficient: 2 },
  { id: "COURSE5", publicId: "COU-2026-000005", schoolCode: "CD-2026-0001", className: "6ème A", name: "Histoire", coefficient: 1 },
  { id: "COURSE6", publicId: "COU-2026-000006", schoolCode: "CD-2026-0001", className: "6ème B", name: "Mathématiques", coefficient: 3 },
  { id: "COURSE7", publicId: "COU-2026-000007", schoolCode: "CD-2026-0001", className: "6ème B", name: "Français", coefficient: 3 },
  { id: "COURSE8", publicId: "COU-2026-000008", schoolCode: "CD-2026-0001", className: "6ème B", name: "Sciences", coefficient: 2 },
  { id: "COURSE9", publicId: "COU-2026-000009", schoolCode: "CD-2026-0001", className: "6ème B", name: "Anglais", coefficient: 2 },
  { id: "COURSE10", publicId: "COU-2026-000010", schoolCode: "CD-2026-0001", className: "5ème A", name: "Physique", coefficient: 2 },
  { id: "COURSE11", publicId: "COU-2026-000011", schoolCode: "CD-2026-0001", className: "5ème A", name: "Histoire", coefficient: 1 },
  { id: "COURSE12", publicId: "COU-2026-000012", schoolCode: "CD-2026-0001", className: "5ème A", name: "Mathématiques", coefficient: 3 },
  { id: "COURSE13", publicId: "COU-2026-000013", schoolCode: "CD-2026-0001", className: "5ème B", name: "Français", coefficient: 3 },
  { id: "COURSE14", publicId: "COU-2026-000014", schoolCode: "CD-2026-0001", className: "5ème B", name: "Histoire", coefficient: 1 },
  { id: "COURSE15", publicId: "COU-2026-000015", schoolCode: "CD-2026-0001", className: "5ème B", name: "Sciences", coefficient: 2 },
];

const students = [
  { id: "1", publicId: "CD-IN-EL-26-001", name: "Jean Dupont", firstName: "Jean", matricule: "CD-IN-EL-26-001", loginCode: "CD-IN-EL-26-001", identifier: "CD-IN-EL-26-001", gender: "Masculin", birthDate: "12-04-2012", className: "6ème A", schoolCode: "CD-2026-0001", pin: "1234", parentName: "Parent Dupont", parentPhone: "+243 820 000 001", parentEmail: "parent.dupont@example.com", archived: false },
  { id: "2", publicId: "CD-IN-EL-26-002", name: "Marie Martin", firstName: "Marie", matricule: "CD-IN-EL-26-002", loginCode: "CD-IN-EL-26-002", identifier: "CD-IN-EL-26-002", gender: "Féminin", birthDate: "18-09-2012", className: "6ème A", schoolCode: "CD-2026-0001", pin: "1234", parentName: "Parent Martin", parentPhone: "+243 820 000 001", parentEmail: "parent.martin@example.com", archived: false },
  { id: "3", publicId: "CD-IN-EL-26-003", name: "Paul Bernard", firstName: "Paul", matricule: "CD-IN-EL-26-003", loginCode: "CD-IN-EL-26-003", identifier: "CD-IN-EL-26-003", gender: "Masculin", birthDate: "03-02-2011", className: "6ème B", schoolCode: "CD-2026-0001", pin: "1234", parentName: "Parent Bernard", parentPhone: "+243 820 000 003", parentEmail: "parent.bernard@example.com", archived: false },
  { id: "4", publicId: "CD-IN-EL-26-004", name: "Sarah Mbala", firstName: "Sarah", matricule: "CD-IN-EL-26-004", loginCode: "CD-IN-EL-26-004", identifier: "CD-IN-EL-26-004", gender: "Féminin", birthDate: "21-07-2011", className: "5ème A", schoolCode: "CD-2026-0001", pin: "1234", parentName: "Parent Mbala", parentPhone: "+243 820 000 004", parentEmail: "parent.mbala@example.com", archived: false },
];

const presences = [
  { id: "P1", publicId: "PRE-2026-000001", studentId: "1", date: "2026-05-27", present: true, status: "Present" },
  { id: "P2", publicId: "PRE-2026-000002", studentId: "1", date: "2026-05-28", present: false, status: "Absent" },
  { id: "P3", publicId: "PRE-2026-000003", studentId: "2", date: "2026-05-27", present: true, status: "Present" },
  { id: "P4", publicId: "PRE-2026-000004", studentId: "3", date: "2026-05-27", present: true, status: "Retard" },
];

const payments = [
  { id: "PAY1", publicId: "PAY-2026-000001", studentId: "1", amount: 25000, date: "2026-05-10", status: "PAYE", method: "Mobile Money" },
  { id: "PAY2", publicId: "PAY-2026-000002", studentId: "1", amount: 15000, date: "2026-05-25", status: "EN_ATTENTE", method: "Especes" },
  { id: "PAY3", publicId: "PAY-2026-000003", studentId: "2", amount: 25000, date: "2026-05-10", status: "PAYE", method: "Virement bancaire" },
  { id: "PAY4", publicId: "PAY-2026-000004", studentId: "3", amount: 25000, date: "2026-05-12", status: "PAYE", method: "Carte bancaire" },
];

const announcements = [
  { id: "A1", schoolCode: "CD-2026-0001", title: "Reunion des parents", message: "Reunion generale samedi a 10h00.", date: "2026-05-30", audience: "Parents", status: "Publié" },
  { id: "A2", schoolCode: "CD-2026-0001", title: "Examens", message: "Les evaluations commencent le 10 juin.", date: "2026-05-29", audience: "Tous", status: "Publié" },
];

const exams = [
  { id: "EX1", schoolCode: "CD-2026-0001", name: "Contrôle T1 — Mathématiques", className: "6ème A", subject: "Mathématiques", examType: "Contrôle", date: "2026-06-10", period: "Trimestre 1", status: "Programmé" },
  { id: "EX2", schoolCode: "CD-2026-0001", name: "Devoir T1 — Français", className: "6ème A", subject: "Français", examType: "Devoir", date: "2026-06-12", period: "Trimestre 1", status: "Programmé" },
  { id: "EX3", schoolCode: "CD-2026-0001", name: "Examen T1 — Sciences", className: "6ème B", subject: "Sciences", examType: "Examen", date: "2026-06-15", period: "Trimestre 1", status: "En cours" },
  { id: "EX4", schoolCode: "CD-2026-0001", name: "Interrogation — Physique", className: "5ème A", subject: "Physique", examType: "Interrogation", date: "2026-05-28", period: "Trimestre 1", status: "Publié" },
];

const documents = [
  { id: "DOC1", schoolCode: "CD-2026-0001", studentId: "1", studentName: "Jean Dupont", documentType: "Attestation", title: "Attestation de scolarité 2025-2026", format: "PDF", status: "Disponible", generatedAt: "15-05-2026" },
  { id: "DOC2", schoolCode: "CD-2026-0001", studentId: "2", studentName: "Marie Martin", documentType: "Certificat", title: "Certificat de réussite", format: "PDF", status: "Disponible", generatedAt: "20-05-2026" },
  { id: "DOC3", schoolCode: "CD-2026-0001", studentId: "3", studentName: "Paul Bernard", documentType: "Attestation", title: "Attestation de présence", format: "PDF", status: "En génération", generatedAt: "" },
  { id: "DOC4", schoolCode: "CD-2026-0001", studentId: "4", studentName: "Sarah Mbala", documentType: "Relevé", title: "Relevé de notes provisoire", format: "PDF", status: "Disponible", generatedAt: "25-05-2026" },
];

const demoCountryTemplates = [
  ["Sénégal", "SN", "+221", "XOF", "GMT+0"],
  ["Côte d'Ivoire", "CI", "+225", "XOF", "GMT+0"],
  ["Cameroun", "CM", "+237", "XAF", "GMT+1"],
  ["Gabon", "GA", "+241", "XAF", "GMT+1"],
  ["Bénin", "BJ", "+229", "XOF", "GMT+0"],
  ["Togo", "TG", "+228", "XOF", "GMT+0"],
  ["Mali", "ML", "+223", "XOF", "GMT+0"],
  ["Burkina Faso", "BF", "+226", "XOF", "GMT+0"],
  ["Guinée", "GN", "+224", "GNF", "GMT+0"],
  ["Rwanda", "RW", "+250", "RWF", "GMT+2"],
];
const demoCities = ["Kinshasa", "Lubumbashi", "Goma", "Mbuji-Mayi", "Kisangani", "Matadi", "Bukavu", "Kolwezi"];
const demoFirstNames = ["Jean", "Marie", "Patrick", "Sarah", "Grace", "David", "Amina", "Joseph", "Chantal", "Moise"];
const demoLastNames = ["Kabeya", "Mukendi", "Ilunga", "Mbuyi", "Kabasele", "Tshibangu", "Mabiala", "Ndaye", "Kalala", "Mbala"];
const demoSubjects = ["Mathématiques", "Français", "Sciences", "Histoire", "Géographie", "Anglais", "Physique", "Chimie", "SVT", "Informatique"];
const demoLevels = ["1ère", "2ème", "3ème", "4ème", "5ème", "6ème"];
const demoTracks = ["Générale", "Sciences", "Lettres", "Technique", "Commerciale"];
const demoClassNames = demoLevels.flatMap((level) => [`${level} A`, `${level} B`]);
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

while (countries.length < 50) {
  const index = countries.length + 1;
  const template = demoCountryTemplates[index % demoCountryTemplates.length];
  const code = `${template[1]}${String(index).padStart(2, "0")}`;
  countries.push({
    id: `COUNTRY-${code}`,
    name: `${template[0]} Demo ${index}`,
    code,
    phonePrefix: template[2],
    currency: template[3],
    timezone: template[4],
    status: index % 9 === 0 ? "Suspendu" : "Actif",
    administratorId: `USER-COUNTRY-${code}`,
    createdAt: `${String((index % 27) + 1).padStart(2, "0")}-01-2026`,
  });
}

const burundiSchool = {
  ...school,
  id: "SCHOOL-BI-2026-0002",
  publicId: "BI-2026-0002",
  code: "BI-2026-0002",
  loginCode: "BI-ESB-26-001",
  name: "Établissement Somafrik Burundi",
  type: "Université",
  city: "Bujumbura",
  country: "Burundi",
  countryCode: "BI",
  address: "Avenue de l'Indépendance, Bujumbura",
  phone: "+257 710 000 000",
  email: "contact.bi@somafrik.demo",
  currency: "BIF",
  timezone: "Africa/Bujumbura",
  subscriptionPlan: "Premium",
  subscriptionStatus: "À jour",
  status: "Actif",
  validationStatus: "Validé",
  maxStudents: 900,
  maxTeachers: 90,
};

const platformSchools = [school, burundiSchool];

while (platformSchools.length < 50) {
  const index = platformSchools.length + 1;
  const country = countries[index % countries.length];
  const code = `SCH-DEMO-${String(index).padStart(4, "0")}`;
  platformSchools.push({
    ...school,
    id: `SCHOOL-${String(index).padStart(4, "0")}`,
    publicId: code,
    loginCode: "",
    code,
    name: `Établissement Somafrik ${index}`,
    type: ["École primaire", "Collège", "Lycée", "Université", "Institut"][index % 5],
    city: demoCities[index % demoCities.length],
    country: country.name.includes("République Démocratique") ? "RDC" : country.name,
    countryCode: country.code,
    phone: `${country.phonePrefix} 810 ${String(index).padStart(3, "0")} ${String(index + 100).padStart(3, "0")}`,
    email: `contact-${index}@somafrik.demo`,
    currency: country.currency,
    timezone: country.timezone,
    status: index % 11 === 0 ? "Suspendu" : "Actif",
    validationStatus: index % 7 === 0 ? "En attente" : "Validé",
    subscriptionPlan: ["Essentiel", "Standard", "Premium"][index % 3],
    subscriptionStatus: index % 8 === 0 ? "En retard" : "À jour",
  });
}

while (subscriptions.length < 50) {
  const index = subscriptions.length + 1;
  const schoolItem = platformSchools[index % platformSchools.length];
  const country = countries.find((item) => schoolItem.code.startsWith(item.code)) ?? countries[0];
  subscriptions.push({
    id: `SUB-${schoolItem.code}`,
    schoolCode: schoolItem.code,
    countryCode: country.code,
    country: schoolItem.country,
    plan: schoolItem.subscriptionPlan,
    monthlyPrice: [60, 90, 120][index % 3],
    annualPrice: [600, 900, 1200][index % 3],
    currency: "USD",
    status: schoolItem.status,
    paymentStatus: index % 8 === 0 ? "En retard" : "À jour",
    startDate: "01-09-2025",
    endDate: index % 8 === 0 ? "31-05-2026" : "31-08-2026",
    lastPaymentDate: `${String((index % 27) + 1).padStart(2, "0")}-05-2026`,
  });
}

while (teachers.length < 50) {
  const index = teachers.length + 1;
  const subject = demoSubjects[index % demoSubjects.length];
  const firstName = demoFirstNames[index % demoFirstNames.length];
  const lastName = demoLastNames[index % demoLastNames.length];
  teachers.push({
    id: `T${index}`,
    publicId: `${school.code}-ENS-${String(index).padStart(4, "0")}`,
    identifier: `ENS-${String(index).padStart(4, "0")}`,
    schoolCode: school.code,
    name: `${firstName} ${lastName}`,
    firstName,
    gender: index % 2 === 0 ? "Féminin" : "Masculin",
    phone: `+243 810 100 ${String(index).padStart(3, "0")}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@somafrik.cd`,
    mainSubject: subject,
    password: "1234",
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
  const subject = demoSubjects[index % demoSubjects.length];
  courses.push({
    id: `COURSE${index}`,
    publicId: `COU-2026-${String(index).padStart(6, "0")}`,
    className: classItem.name,
    name: subject,
    coefficient: (index % 3) + 1,
  });
}

courses.forEach((course, index) => {
  const teacher = teachers[index % teachers.length];
  const exists = teacher.assignments.some(
    (assignment) => assignment.className === course.className && assignment.course === course.name
  );
  if (!exists) {
    teacher.assignments.push({ className: course.className, course: course.name, status: "active" });
  }
});

while (students.length < 50) {
  const index = students.length + 1;
  const firstName = demoFirstNames[index % demoFirstNames.length];
  const lastName = demoLastNames[(index + 3) % demoLastNames.length];
  const classItem = classes[index % classes.length];
  students.push({
    id: String(index),
    publicId: `CD-IN-EL-26-${String(index).padStart(3, "0")}`,
    name: `${firstName} ${lastName}`,
    firstName,
    matricule: `CD-IN-EL-26-${String(index).padStart(3, "0")}`,
    gender: index % 2 === 0 ? "Féminin" : "Masculin",
    birthDate: `${String((index % 27) + 1).padStart(2, "0")}-${String((index % 12) + 1).padStart(2, "0")}-2012`,
    className: classItem.name,
    schoolCode: "CD-2026-0001",
    pin: "1234",
    parentName: `Parent ${lastName}`,
    parentPhone: `+243 820 100 ${String(Math.ceil(index / 2)).padStart(3, "0")}`,
    parentEmail: `parent-${index}@example.com`,
    archived: index % 17 === 0,
  });
}

while (presences.length < 50) {
  const index = presences.length + 1;
  const student = students[index % students.length];
  const status = ["Present", "Absent", "Retard", "Justifié"][index % 4];
  presences.push({
    id: `P${index}`,
    publicId: `PRE-2026-${String(index).padStart(6, "0")}`,
    studentId: student.id,
    date: `2026-05-${String((index % 27) + 1).padStart(2, "0")}`,
    present: status === "Present" || status === "Justifié",
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
    date: `2026-05-${String((index % 27) + 1).padStart(2, "0")}`,
    status: index % 4 === 0 ? "EN_ATTENTE" : "PAYE",
    method: ["Mobile Money", "Especes", "Virement bancaire", "Carte bancaire"][index % 4],
  });
}

while (announcements.length < 50) {
  const index = announcements.length + 1;
  announcements.push({
    id: `A${index}`,
    schoolCode: "CD-2026-0001",
    title: `Annonce Somafrik ${index}`,
    message: `Communication importante numéro ${index} pour les familles et le personnel.`,
    date: `${String((index % 27) + 1).padStart(2, "0")}-06-2026`,
    audience: "Tous",
    status: "Publié",
  });
}

const teacherAssignments = teachers.flatMap((teacher) =>
  (teacher.assignments ?? []).map((assignment, index) => ({
    id: `${teacher.id}-ASSIGNMENT-${index + 1}`,
    schoolCode: school.code,
    teacherId: teacher.id,
    teacherName: teacher.name,
    className: assignment.className,
    subject: assignment.course,
    course: assignment.course,
    status: assignment.status,
  })),
);

courses.forEach((course) => {
  if (course.teacherId || course.teacherName) return;
  const match = teacherAssignments.find(
    (assignment) =>
      assignment.className === course.className
      && assignment.course === course.name,
  );
  if (!match) return;
  course.teacherId = match.teacherId;
  course.teacherName = match.teacherName;
});

while (platformNotifications.length < 50) {
  const index = platformNotifications.length + 1;
  const country = countries[index % countries.length];
  platformNotifications.push({
    id: `NOTIF-${String(index).padStart(3, "0")}`,
    audience: index % 2 === 0 ? "Super Administrateur Somafrik" : "Admin Pays",
    countryCode: index % 2 === 0 ? "*" : country.code,
    title: `Notification plateforme ${index}`,
    message: `Événement Somafrik ${index} à traiter selon le niveau de priorité.`,
    type: ["Paiement", "Inscription", "Abonnement", "Maintenance", "Support"][index % 5],
    priority: ["Faible", "Moyenne", "Haute", "Critique"][index % 4],
    channels: ["Web", "Tablette", "Mobile"],
    status: index % 3 === 0 ? "Lu" : "Non lu",
    date: `${String((index % 27) + 1).padStart(2, "0")}-06-2026`,
    createdBy: "Système",
  });
}

while (userAccounts.length < 50) {
  const index = userAccounts.length + 1;
  const roleNames = Object.keys(rolePermissions);
  const role = roleNames[index % roleNames.length];
  const isBackOffice = index % 5 === 0;
  const country = countries[index % countries.length];
  const schoolItem = platformSchools[index % platformSchools.length];
  userAccounts.push({
    id: `USER-DEMO-${String(index).padStart(4, "0")}`,
    publicId: role === "Admin Pays" ? `ADM-${country.code}-2026-${String(index).padStart(4, "0")}` : `USR-2026-${String(index).padStart(6, "0")}`,
    lastName: demoLastNames[index % demoLastNames.length],
    firstName: demoFirstNames[index % demoFirstNames.length],
    gender: index % 2 === 0 ? "Féminin" : "Masculin",
    phone: `${country.phonePrefix} 830 000 ${String(index).padStart(3, "0")}`,
    email: `user-${index}@somafrik.demo`,
    role,
    secondaryRoles: index % 6 === 0 ? ["Auditeur"] : [],
    scopeLevel: role === "Super Administrateur Somafrik" ? "Global" : role === "Admin Pays" ? "Pays" : "Établissement",
    countryScope: country.name.includes("République Démocratique") ? "RDC" : country.code,
    schoolCode: role === "Super Administrateur Somafrik" || role === "Admin Pays" ? "*" : schoolItem.code,
    accessChannel: isBackOffice ? "BackOffice" : "Application",
    identifier: isBackOffice
      ? `demo-user-${index}`
      : role === "Enseignant"
        ? `ENS-${String(index).padStart(4, "0")}`
        : role === "Élève / Étudiant"
          ? `ETU-${String(index).padStart(4, "0")}`
          : role === "Parent"
            ? `${country.phonePrefix} 830 000 ${String(index).padStart(3, "0")}`
            : `USR-${String(index).padStart(5, "0")}`,
    password: isBackOffice ? "1234" : undefined,
    status: index % 13 === 0 ? "Suspendu" : "Actif",
    permissions: rolePermissions[role] ?? ["Voir tableau de bord"],
    temporaryPassword: "",
    photoUrl: "",
    createdAt: `${String((index % 27) + 1).padStart(2, "0")}-01-2026`,
    lastLoginAt: `${String((index % 27) + 1).padStart(2, "0")}-06-2026`,
    createdBy: "Super Administrateur Somafrik",
    history: [`Compte démo ${index} créé automatiquement`],
  });
}

const demoBulletinBundle = buildSchoolBulletinBundle({
  schoolCode: school.code,
  students,
  courses,
  teachers,
  periods: ["Trimestre 1", "Trimestre 2"],
});
const notes = demoBulletinBundle.notes;
const bulletins = demoBulletinBundle.bulletins;
const courseSchedules = buildSchoolPlanningSlots({
  schoolCode: school.code,
  courses,
  classes,
});
const academicConfigs = {
  [school.code]: buildAcademicConfigForSchool(school.code, courses, classes),
};

module.exports = {
  school,
  platformSchools,
  teachers,
  classes,
  courses,
  students,
  notes,
  presences,
  payments,
  announcements,
  exams,
  bulletins,
  courseSchedules,
  academicConfigs,
  documents,
  teacherAssignments,
  rolePermissions,
  rolePermissionsDeclared,
  rolePermissionsForLiveRbac,
  userAccounts,
  countries,
  subscriptions,
  subscriptionOffers,
  platformNotifications,
  demoLevels,
  demoTracks,
  demoSubjects,
  demoClassNames,
};
