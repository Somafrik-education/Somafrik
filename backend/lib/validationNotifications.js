/**
 * Alertes Super Admin : comptes / établissements créés par un Admin Pays
 * et en attente de validation.
 */
const SUPER_ADMIN_AUDIENCE = "Super Administrateur Somafrik";
const PENDING_VALIDATION_STATUS = "En attente de validation";
const SCHOOL_ADMIN_ROLE = "Admin School";

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function rowKey(row = {}) {
  return String(row.id ?? row.publicId ?? row.matricule ?? row.code ?? "").trim();
}

function formatNotificationDate(date = new Date()) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getFullYear()}`;
}

function isPendingValidationUser(user = {}) {
  return (
    user.validationStatus === PENDING_VALIDATION_STATUS ||
    user.status === PENDING_VALIDATION_STATUS
  );
}

function isPendingValidationSchool(school = {}) {
  return (
    school.validationStatus === PENDING_VALIDATION_STATUS ||
    school.status === "En attente" ||
    school.status === PENDING_VALIDATION_STATUS
  );
}

function resolveCountryCode(entity = {}) {
  const scope = String(entity.countryScope ?? entity.country ?? entity.countryCode ?? "").trim();
  if (!scope) return "*";
  const compact = scope.replace(/[^A-Za-z]/g, "").toUpperCase();
  return compact.slice(0, 2) || "*";
}

function buildUserValidationNotification(user = {}, requestedBy = "Admin Pays") {
  const userKey = rowKey(user);
  const label = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || "Admin École";
  const identifier = String(user.identifier ?? userKey).trim();
  return {
    id: `NOTIF-VAL-USER-${userKey}`,
    audience: SUPER_ADMIN_AUDIENCE,
    countryCode: resolveCountryCode(user),
    schoolCode: user.schoolCode && user.schoolCode !== "*" ? user.schoolCode : undefined,
    title: "Compte Admin École en attente de validation",
    message: `${label} (${identifier}) a été créé par ${requestedBy}. Validez le compte dans Utilisateurs.`,
    type: "Validation",
    priority: "Haute",
    channels: ["Web", "Tablette", "Mobile"],
    status: "Non lu",
    date: formatNotificationDate(),
    createdBy: "Système",
  };
}

function buildSchoolValidationNotification(school = {}, requestedBy = "Admin Pays") {
  const schoolCode = String(school.code ?? "").trim().toUpperCase();
  const schoolName = String(school.name ?? schoolCode).trim();
  return {
    id: `NOTIF-VAL-SCHOOL-${schoolCode}`,
    audience: SUPER_ADMIN_AUDIENCE,
    countryCode: resolveCountryCode(school),
    schoolCode,
    title: "Établissement en attente de validation",
    message: `${schoolName} (${schoolCode}) a été créé par ${requestedBy}. Validez l'établissement dans Établissements.`,
    type: "Validation",
    priority: "Haute",
    channels: ["Web", "Tablette", "Mobile"],
    status: "Non lu",
    date: formatNotificationDate(),
    createdBy: "Système",
  };
}

function listNewPendingUsers(currentUsers = [], nextUsers = []) {
  const currentKeys = new Set((currentUsers ?? []).map((user) => rowKey(user)).filter(Boolean));
  return (nextUsers ?? []).filter((user) => {
    const key = rowKey(user);
    if (!key || currentKeys.has(key)) return false;
    return user.role === SCHOOL_ADMIN_ROLE && isPendingValidationUser(user);
  });
}

function listNewPendingSchools(currentSchools = [], nextSchools = []) {
  const currentKeys = new Set(
    (currentSchools ?? []).map((school) => normalize(school.code)).filter(Boolean),
  );
  return (nextSchools ?? []).filter((school) => {
    const key = normalize(school.code);
    if (!key || currentKeys.has(key)) return false;
    return isPendingValidationSchool(school);
  });
}

function listResolvedUsers(currentUsers = [], nextUsers = []) {
  const currentByKey = new Map((currentUsers ?? []).map((user) => [rowKey(user), user]));
  const resolved = [];
  for (const user of nextUsers ?? []) {
    const key = rowKey(user);
    const prior = currentByKey.get(key);
    if (!prior || user.role !== SCHOOL_ADMIN_ROLE) continue;
    const wasPending = isPendingValidationUser(prior);
    const isValidated =
      user.validationStatus === "Validé" ||
      (user.status === "Actif" && !isPendingValidationUser(user));
    if (wasPending && isValidated) resolved.push(key);
  }
  return resolved;
}

function listResolvedSchools(currentSchools = [], nextSchools = []) {
  const currentByKey = new Map(
    (currentSchools ?? []).map((school) => [normalize(school.code), school]),
  );
  const resolved = [];
  for (const school of nextSchools ?? []) {
    const key = normalize(school.code);
    const prior = currentByKey.get(key);
    if (!prior) continue;
    const wasPending = isPendingValidationSchool(prior);
    const isValidated =
      school.validationStatus === "Validé" ||
      (school.status === "Actif" && !isPendingValidationSchool(school));
    if (wasPending && isValidated) resolved.push(String(school.code ?? "").trim().toUpperCase());
  }
  return resolved;
}

function appendUniqueNotifications(existing = [], additions = []) {
  const seen = new Set((existing ?? []).map((row) => String(row.id ?? "")));
  const merged = [...(existing ?? [])];
  for (const notification of additions) {
    const id = String(notification.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.unshift(notification);
  }
  return merged;
}

function markNotificationsResolved(notifications = [], resolvedUserKeys = [], resolvedSchoolCodes = []) {
  if (!resolvedUserKeys.length && !resolvedSchoolCodes.length) return notifications;
  const userIds = new Set(resolvedUserKeys.map((key) => `NOTIF-VAL-USER-${key}`));
  const schoolIds = new Set(resolvedSchoolCodes.map((code) => `NOTIF-VAL-SCHOOL-${code}`));
  return (notifications ?? []).map((notification) => {
    const id = String(notification.id ?? "");
    if (userIds.has(id) || schoolIds.has(id)) {
      return { ...notification, status: "Lu" };
    }
    return notification;
  });
}

/**
 * Ajoute les alertes Super Admin manquantes et marque celles résolues par validation.
 */
function enrichStateWithValidationAlerts(currentState = {}, nextState = {}, principal = null) {
  const fallbackActor = principal?.identifier ?? principal?.sub ?? "Admin Pays";
  const additions = [];

  for (const user of listNewPendingUsers(currentState.users, nextState.users)) {
    additions.push(
      buildUserValidationNotification(
        user,
        user.validationRequestedBy ?? user.createdBy ?? fallbackActor,
      ),
    );
  }

  for (const school of listNewPendingSchools(currentState.schools, nextState.schools)) {
    additions.push(
      buildSchoolValidationNotification(
        school,
        school.validationRequestedBy ?? fallbackActor,
      ),
    );
  }

  let notifications = appendUniqueNotifications(nextState.notifications ?? currentState.notifications, additions);
  notifications = markNotificationsResolved(
    notifications,
    listResolvedUsers(currentState.users, nextState.users),
    listResolvedSchools(currentState.schools, nextState.schools),
  );

  if (
    additions.length === 0 &&
    notifications === (nextState.notifications ?? currentState.notifications)
  ) {
    return nextState;
  }

  return {
    ...nextState,
    notifications,
  };
}

module.exports = {
  SUPER_ADMIN_AUDIENCE,
  buildUserValidationNotification,
  buildSchoolValidationNotification,
  enrichStateWithValidationAlerts,
  listNewPendingUsers,
  listNewPendingSchools,
};
