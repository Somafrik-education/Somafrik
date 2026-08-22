export function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function isPastDate(value?: string): boolean {
  if (!value) return false;
  const ddmmyyyy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  let date: Date;
  if (ddmmyyyy) {
    date = new Date(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]));
  } else {
    date = new Date(value);
  }
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < Date.now();
}

export function isActiveUserAccount(user: { status?: string }): boolean {
  return normalize(user.status) !== "suspendu";
}

const COUNTRY_CODES: Record<string, string> = {
  RDC: "CD",
  "REPUBLIQUE DEMOCRATIQUE DU CONGO": "CD",
  BURUNDI: "BI",
  BI: "BI",
  CONGO: "CG",
  CG: "CG",
  SENEGAL: "SN",
  SN: "SN",
};

export function getCountryCodeFromScope(countryScope?: string): string {
  const normalized = String(countryScope ?? "").trim().toUpperCase();
  return COUNTRY_CODES[normalized] ?? (/^[A-Z]{2}$/.test(normalized) ? normalized : "");
}

export function countryScopeMatches(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  if (normalize(left) === normalize(right)) return true;
  const leftCode = getCountryCodeFromScope(left);
  const rightCode = getCountryCodeFromScope(right);
  return Boolean(leftCode && rightCode && leftCode === rightCode);
}

export function schoolMatchesCountryScope(
  school: { country?: string; countryCode?: string; code?: string },
  countryScope?: string,
): boolean {
  if (!countryScope) return true;
  if (countryScopeMatches(school.country, countryScope)) return true;
  if (countryScopeMatches(school.countryCode, countryScope)) return true;
  const scopeCode = getCountryCodeFromScope(countryScope);
  if (scopeCode && normalize(school.countryCode) === normalize(scopeCode)) return true;
  if (scopeCode && String(school.code ?? "").toUpperCase().startsWith(scopeCode)) return true;
  return false;
}

export function isInternalSchoolRole(role?: string): boolean {
  const key = normalize(role);
  return [
    "admin school",
    "administrateur ecole",
    "administrateur etablissement",
    "secretaire",
    "prefet des etudes",
    "prefet des etude",
    "proviseur / directeur",
    "proviseur",
    "directeur",
    "directeur adjoint",
    "comptable",
    "accountant",
    "school_admin",
    "principal",
    "prefet",
    "secretary",
    "adjoint",
    "supervisor",
  ].includes(key);
}

export function isSchoolAdminRole(role?: string): boolean {
  const key = normalize(role);
  return ["admin school", "administrateur ecole", "administrateur etablissement", "school_admin"].includes(key);
}

const ROLE_LABELS: Record<string, string> = {
  "super_admin": "Super administrateur",
  "super admin": "Super administrateur",
  "super administrateur somafrik": "Super administrateur Somafrik",
  "country_admin": "Administrateur pays",
  "admin pays": "Administrateur pays",
  "school_admin": "Administrateur d’établissement",
  "admin school": "Administrateur d’établissement",
  "administrateur ecole": "Administrateur d’établissement",
  "administrateur etablissement": "Administrateur d’établissement",
  "teacher": "Enseignant",
  "student": "Élève / Étudiant",
  "parent_student": "Parent",
  "principal": "Directeur",
  "prefet": "Préfet des études",
  "secretary": "Secrétaire",
  "accountant": "Comptable",
  "adjoint": "Directeur adjoint",
  "supervisor": "Surveillant",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Actif",
  actif: "Actif",
  inactive: "Inactif",
  inactif: "Inactif",
  disabled: "Désactivé",
  desactive: "Désactivé",
  enabled: "Activé",
  archived: "Archivé",
  archive: "Archivé",
  pending: "En attente",
  approved: "Approuvé",
  validated: "Validé",
  rejected: "Refusé",
  suspended: "Suspendu",
  suspendu: "Suspendu",
  cancelled: "Annulé",
  canceled: "Annulé",
  paid: "Payé",
  unpaid: "Impayé",
  overdue: "En retard",
  draft: "Brouillon",
  read: "Lu",
  unread: "Non lu",
};

const SCOPE_LABELS: Record<string, string> = {
  global: "Global",
  country: "Pays",
  pays: "Pays",
  school: "Établissement",
  establishment: "Établissement",
  etablissement: "Établissement",
};

const PERMISSION_ACTION_LABELS: Record<string, string> = {
  read: "Lecture",
  create: "Création",
  update: "Modification",
  delete: "Suppression",
  suspend: "Suspension",
  grant: "Attribution",
  revoke: "Retrait",
};

/** Présentation uniquement : les codes/rôles canoniques restent inchangés dans les API. */
export function displayRoleName(role?: string): string {
  if (!role) return "Utilisateur";
  return ROLE_LABELS[normalize(role)] ?? role;
}

/** Présentation uniquement : traduit les statuts techniques connus sans modifier leur valeur canonique. */
export function displayStatusName(status?: string): string {
  if (!status) return "—";
  return STATUS_LABELS[normalize(status)] ?? status;
}

export function displayScopeName(scope?: string): string {
  if (!scope) return "—";
  return SCOPE_LABELS[normalize(scope)] ?? scope;
}

export function displayPermissionActionName(action?: string): string {
  if (!action) return "—";
  return PERMISSION_ACTION_LABELS[normalize(action)] ?? action;
}
