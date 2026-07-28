/**
 * Provisionnement compte utilisateur depuis un contact (aligné web/src/lib/contacts.ts).
 */
const { rolePermissions } = require("../data");
const { randomBytes } = require("crypto");
const { findDuplicateLoginIdentifier } = require("./userAccountRules");

const INTERNAL_ROLE_DEFAULT_PERMISSIONS = {
  Enseignant: [
    "Messages:READ",
    "Messages:CREATE",
    "Notifications:READ",
    "Présences:READ",
    "Notes:READ",
    "Classes:READ",
    "Élèves:READ",
  ],
  Parent: [
    "Messages:READ",
    "Notifications:READ",
    "Notes:READ",
    "Paiements:READ",
    "Élèves:READ",
  ],
  Comptable: ["Paiements:READ", "Messages:READ", "Notifications:READ", "Élèves:READ"],
  Secrétaire: [
    "Utilisateurs:READ",
    "Messages:READ",
    "Notifications:READ",
    "Élèves:READ",
    "Paiements:READ",
  ],
};

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function getUserIdentifierPrefix(role) {
  const key = normalize(role);
  if (key.includes("enseignant") || key.includes("prof")) return "ENS";
  if (key.includes("eleve") || key.includes("etudiant")) return "ELE";
  if (key.includes("parent")) return "PAR";
  if (key.includes("admin school") || key === "admin") return "ADM";
  if (key.includes("prefet")) return "PRF";
  if (key.includes("secretaire")) return "SEC";
  if (key.includes("comptable")) return "CPT";
  return "USR";
}

function generateUserIdentifier(users = [], role) {
  const prefix = getUserIdentifierPrefix(role);
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let max = 0;
  for (const user of users) {
    const value = String(user.identifier ?? user.publicId ?? "");
    const match = pattern.exec(value);
    if (match?.[1]) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

function generateTemporaryPassword() {
  const bytes = randomBytes(16);
  return `SF-${bytes.toString("hex").toUpperCase()}-${String(bytes[0]).padStart(3, "0")}`;
}

function generateContactUserId(users = []) {
  let attempt = `USERS-${Math.random().toString(36).slice(2, 10)}`;
  const existing = new Set(users.map((user) => String(user.id ?? "")));
  while (existing.has(attempt)) {
    attempt = `USERS-${Math.random().toString(36).slice(2, 10)}`;
  }
  return attempt;
}

function getRoleDefaults(role, schoolCode) {
  if (role === "Super Administrateur Somafrik" || role === "Admin Pays") {
    return { scopeLevel: role === "Admin Pays" ? "Pays" : "Global", schoolCode: "*", accessChannel: "Application" };
  }
  if (role === "Admin School") {
    return { scopeLevel: "Établissement", schoolCode, accessChannel: "Application" };
  }
  return { scopeLevel: "Établissement", schoolCode, accessChannel: "Application" };
}

function resolveEffectivePermissions(role) {
  const fromRole = rolePermissions[role] ?? [];
  const fromDefaults = INTERNAL_ROLE_DEFAULT_PERMISSIONS[role] ?? [];
  return [...new Set([...fromRole, ...fromDefaults])];
}

/**
 * Crée ou met à jour le compte lié à un contact (hasAccess = Oui).
 */
function provisionUserFromContact(contact, users = [], options = {}) {
  const contactId = String(contact.id ?? "").trim();
  const schoolCode = String(contact.schoolCode ?? "").trim();
  const lastName = String(contact.lastName ?? "").trim();
  const firstName = String(contact.firstName ?? "").trim();
  const role = String(contact.role ?? "").trim();
  if (!contactId || !lastName || !firstName || !schoolCode || !role) {
    return { contact, users, created: false };
  }

  const nextUsers = [...users];
  const existingIndex = nextUsers.findIndex(
    (user) =>
      (contactId && normalize(String(user.contactId ?? "")) === normalize(contactId)) ||
      (contact.userId && normalize(String(user.id ?? "")) === normalize(String(contact.userId))) ||
      (contact.userIdentifier &&
        normalize(String(user.identifier ?? "")) === normalize(String(contact.userIdentifier))),
  );
  const existing = existingIndex >= 0 ? nextUsers[existingIndex] : undefined;
  const isNewUser = !existing;
  const temporaryPassword = isNewUser
    ? generateTemporaryPassword()
    : String(existing?.temporaryPassword ?? "").trim() || undefined;

  const defaults = getRoleDefaults(role, schoolCode);
  const contactIdentifier = String(contact.userIdentifier ?? "").trim();
  const identifier =
    existing?.identifier ?? (contactIdentifier || generateUserIdentifier(nextUsers, role));
  const duplicate = findDuplicateLoginIdentifier(nextUsers, {
    id: existing?.id,
    identifier,
    email: String(contact.email ?? existing?.email ?? ""),
    phone: String(contact.phone ?? existing?.phone ?? ""),
    schoolCode,
  });
  if (duplicate && duplicate.id !== existing?.id) {
    return { contact, users: nextUsers, created: false, error: `Identifiant « ${identifier} » déjà utilisé.` };
  }

  const nextUser = {
    ...(existing ?? {}),
    id: existing?.id ?? generateContactUserId(nextUsers),
    contactId,
    firstName,
    lastName,
    gender: String(contact.gender ?? existing?.gender ?? "Non renseigné"),
    phone: String(contact.phone ?? existing?.phone ?? ""),
    email: String(contact.email ?? existing?.email ?? ""),
    birthDate: String(contact.birthDate ?? existing?.birthDate ?? ""),
    role,
    secondaryRoles: existing?.secondaryRoles ?? [],
    schoolCode: defaults.schoolCode || schoolCode,
    scopeLevel: defaults.scopeLevel,
    accessChannel: defaults.accessChannel,
    countryScope: existing?.countryScope ?? options.countryScope ?? "RDC",
    identifier,
    status: existing?.status ?? "Actif",
    permissions: resolveEffectivePermissions(role),
    createdBy: existing?.createdBy ?? options.createdBy ?? "Administrateur",
    ...(isNewUser
      ? {
          temporaryPassword,
          hasTemporaryPassword: true,
          mustChangePassword: true,
          createdAt: new Date().toISOString(),
        }
      : {}),
  };

  if (existingIndex >= 0) {
    nextUsers[existingIndex] = nextUser;
  } else {
    nextUsers.unshift(nextUser);
  }

  return {
    users: nextUsers,
    contact: {
      ...contact,
      userId: nextUser.id,
      userIdentifier: identifier,
      hasAccess: "Oui",
    },
    user: nextUser,
    created: isNewUser,
  };
}

module.exports = {
  provisionUserFromContact,
  generateUserIdentifier,
  generateContactUserId,
};
