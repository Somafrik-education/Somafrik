/**
 * Audit tableau de bord web : page d'entrée et modules lisibles par rôle.
 * Usage: node backend/scripts/verify-dashboard-roles.js
 */
const { rolePermissions } = require("../data");

const INTERNAL_SCHOOL_ROLES = [
  "Admin School",
  "Secrétaire",
  "Préfet des études",
  "Proviseur",
  "Directeur",
  "Comptable",
  "Enseignant",
  "Surveillant",
];

const PLATFORM_ROLES = ["Super Administrateur Somafrik", "Admin Pays"];

const ESTABLISHMENT_PROFILE = {
  "Admin School": "default",
  Secrétaire: "operations",
  "Préfet des études": "academic",
  Proviseur: "academic",
  Directeur: "academic",
  Comptable: "finance",
  Enseignant: "academic",
  Surveillant: "operations",
};

const PLATFORM_CHARTS = [
  "structure",
  "kpis",
  "school-status",
  "schools-country",
  "subscription-payment",
  "subscription-plans",
  "subscription-gauge",
];

const ESTABLISHMENT_CHARTS_BY_PROFILE = {
  default: ["scolarite", "academic", "operations-default", "payments", "presence-donut", "classes"],
  academic: ["academic-bar", "scolarite", "notes-course", "presence-rate", "presence-donut"],
  finance: ["payments-status", "payments-amount", "scolarite-finance"],
  operations: ["operations", "scolarite-ops", "class-sizes"],
};

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function hasRead(permissions, feature) {
  const featureKey = normalize(feature);
  return permissions.some((permission) => {
    const p = normalize(permission);
    if (p === "all-privileges" || p === "country-privileges") return true;
    if (p === `${featureKey}:read` || p === `${featureKey}:r` || p.includes(`${featureKey}:crud`)) {
      return true;
    }
    return p.includes(featureKey) && (p.includes("read") || p.includes("voir") || p.includes("lire") || p.includes("gerer"));
  });
}

function dashboardEntry(role) {
  if (INTERNAL_SCHOOL_ROLES.includes(role)) return "/etablissement";
  return "/tableau-de-bord";
}

function filterPlatformCharts(role, permissions) {
  const rules = {
    structure: ["Pays", "Établissements", "Utilisateurs"],
    kpis: ["Pays", "Établissements", "Utilisateurs", "Abonnements"],
    "school-status": ["Établissements"],
    "schools-country": ["Établissements"],
    "subscription-payment": ["Abonnements"],
    "subscription-plans": ["Abonnements"],
    "subscription-gauge": ["Abonnements"],
  };

  return PLATFORM_CHARTS.filter((chartId) => {
    const features = rules[chartId] ?? [];
    if (chartId === "structure" || chartId === "kpis") {
      return features.some((feature) => hasRead(permissions, feature));
    }
    return features.length ? hasRead(permissions, features[0]) : true;
  });
}

function filterEstablishmentCharts(role, permissions) {
  const profile = ESTABLISHMENT_PROFILE[role] ?? "default";
  const chartRules = {
    scolarite: ["Élèves", "Enseignants", "Classes"],
    "academic-bar": ["Notes", "Examens", "Bulletins"],
    academic: ["Notes", "Examens", "Bulletins"],
    "notes-course": ["Notes"],
    "presence-rate": ["Présences"],
    "presence-donut": ["Présences"],
    "payments-status": ["Paiements"],
    payments: ["Paiements"],
    operations: ["Utilisateurs", "Documents", "Présences", "Messages"],
    "operations-default": ["Utilisateurs", "Documents", "Présences"],
    "class-sizes": ["Élèves"],
    classes: ["Élèves"],
  };

  return (ESTABLISHMENT_CHARTS_BY_PROFILE[profile] ?? []).filter((chartId) => {
    const features = chartRules[chartId] ?? [];
    return features.some((feature) => hasRead(permissions, feature));
  });
}

function auditRole(role) {
  const permissions = rolePermissions[role] ?? [];
  const entry = dashboardEntry(role);
  const charts =
    entry === "/etablissement"
      ? filterEstablishmentCharts(role, permissions)
      : filterPlatformCharts(role, permissions);

  return { role, entry, charts, permissions: permissions.length };
}

function main() {
  const roles = [...PLATFORM_ROLES, ...INTERNAL_SCHOOL_ROLES];
  console.log("Audit tableau de bord Somafrik (web)\n");
  for (const role of roles) {
    const result = auditRole(role);
    console.log(`• ${result.role}`);
    console.log(`  Page : ${result.entry}`);
    console.log(`  Graphiques visibles : ${result.charts.length ? result.charts.join(", ") : "(aucun — droits ou données)"}`);
    console.log("");
  }
}

main();
