const SUPER_ADMIN_ROLES = ["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"];

const ESTABLISHMENT_BACKOFFICE_ROLES = [
  "Admin School",
  "Secrétaire",
  "Sécretaire",
  "Préfet des études",
  "Proviseur",
  "Directeur",
  "Directeur adjoint",
  "Comptable",
];

const PLATFORM_BACKOFFICE_ROLES = [...SUPER_ADMIN_ROLES, "Admin Pays", ...ESTABLISHMENT_BACKOFFICE_ROLES];

const WEB_PLATFORM_DEMO_ROLES = ["Enseignant", "Parent", "Élève / Étudiant", "Élève", "Étudiant"];

function canAccessBackOfficeRole(role) {
  return PLATFORM_BACKOFFICE_ROLES.includes(role);
}

function canAccessWebPlatformRole(role) {
  return canAccessBackOfficeRole(role) || WEB_PLATFORM_DEMO_ROLES.includes(role);
}

function isEstablishmentBackOfficeRole(role) {
  return ESTABLISHMENT_BACKOFFICE_ROLES.includes(role);
}

module.exports = {
  SUPER_ADMIN_ROLES,
  ESTABLISHMENT_BACKOFFICE_ROLES,
  PLATFORM_BACKOFFICE_ROLES,
  canAccessBackOfficeRole,
  canAccessWebPlatformRole,
  isEstablishmentBackOfficeRole,
};
