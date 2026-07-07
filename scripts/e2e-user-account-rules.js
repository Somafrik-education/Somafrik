/**
 * Règles métier compte utilisateur depuis contact (alignées web/src/lib/contacts.ts + userAccounts.ts).
 */
const path = require("path");
const { normalize } = require("./e2e-api-helpers");
const { prepareContactForSave } = require("./e2e-contacts-rules");
const { rolePermissions } = require(path.join(__dirname, "..", "backend", "data.js"));
const { findDuplicateLoginIdentifier } = require(path.join(
  __dirname,
  "..",
  "backend",
  "lib",
  "userAccountRules.js",
));

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

function resolveEffectivePermissions(role, userPermissions = []) {
  const fromUser = userPermissions ?? [];
  const fromRole = rolePermissions[role] ?? [];
  const fromDefaults = INTERNAL_ROLE_DEFAULT_PERMISSIONS[role] ?? [];
  return [...new Set([...fromUser, ...fromRole, ...fromDefaults])];
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

function generateUserIdentifier(users, role) {
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
  return `SF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function generateContactUserId(users) {
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

/**
 * UTIL-001/002 — Crée ou met à jour le compte lié au contact (hasAccess = Oui).
 */
function promoteContactToUser(contact, state, creator = null) {
  const contactId = String(contact.id ?? "").trim();
  const schoolCode = String(contact.schoolCode ?? "").trim();
  const lastName = String(contact.lastName ?? "").trim();
  const firstName = String(contact.firstName ?? "").trim();
  if (!contactId || !lastName || !firstName || !schoolCode) {
    throw new Error("Un contact valide (nom, prénom, établissement) est obligatoire pour créer un compte.");
  }

  const role = String(contact.role ?? "").trim();
  const users = [...(state.users ?? [])];
  const existingIndex = users.findIndex(
    (user) =>
      (contactId && normalize(String(user.contactId ?? "")) === normalize(contactId)) ||
      (contact.userId && normalize(String(user.id ?? "")) === normalize(String(contact.userId))),
  );
  const existing = existingIndex >= 0 ? users[existingIndex] : undefined;
  const isNewUser = !existing;
  const temporaryPassword = isNewUser
    ? generateTemporaryPassword()
    : String(existing?.temporaryPassword ?? "").trim() || undefined;

  const defaults = getRoleDefaults(role, schoolCode);
  const identifier = existing?.identifier ?? generateUserIdentifier(users, role);
  const duplicate = findDuplicateLoginIdentifier(users, {
    id: existing?.id,
    identifier,
    email: String(contact.email ?? existing?.email ?? ""),
    phone: String(contact.phone ?? existing?.phone ?? ""),
    schoolCode,
  });
  if (duplicate && duplicate.id !== existing?.id) {
    throw new Error(`L'identifiant « ${identifier} » est déjà utilisé dans cet établissement.`);
  }

  const permissions = resolveEffectivePermissions(role);
  const nextUser = {
    ...(existing ?? {}),
    id: existing?.id ?? generateContactUserId(users),
    contactId,
    firstName,
    lastName,
    gender: String(contact.gender ?? existing?.gender ?? "Non renseigné"),
    phone: String(contact.phone ?? existing?.phone ?? ""),
    email: String(contact.email ?? existing?.email ?? ""),
    birthDate: String(contact.birthDate ?? existing?.birthDate ?? ""),
    role,
    secondaryRoles: [],
    schoolCode: defaults.schoolCode || schoolCode,
    scopeLevel: defaults.scopeLevel,
    accessChannel: defaults.accessChannel,
    countryScope: existing?.countryScope ?? creator?.countryScope ?? "RDC",
    identifier,
    status: existing?.status ?? "Actif",
    permissions,
    createdBy: existing?.createdBy ?? creator?.identifier ?? "Administrateur",
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
    users[existingIndex] = nextUser;
  } else {
    users.unshift(nextUser);
  }

  return {
    users,
    contact: {
      ...contact,
      userId: nextUser.id,
      userIdentifier: identifier,
      hasAccess: "Oui",
    },
    user: nextUser,
    created: isNewUser,
    temporaryPassword: isNewUser ? temporaryPassword : undefined,
  };
}

/** Simule EntityPage : enregistrement contact + création compte si hasAccess = Oui. */
function saveContactWithOptionalUserAccount(contactDraft, state, schoolCode, creator = null) {
  const prepared = prepareContactForSave({ ...contactDraft, schoolCode }, state);
  if (String(prepared.hasAccess ?? "") !== "Oui") {
    return {
      ok: true,
      contact: prepared,
      patch: { contacts: [prepared, ...(state.contacts ?? [])] },
    };
  }
  if (!prepared.role) {
    return { ok: false, error: "Le rôle est obligatoire pour créer un accès utilisateur." };
  }
  const promotion = promoteContactToUser(prepared, state, creator);
  const contacts = [promotion.contact, ...(state.contacts ?? []).filter((row) => row.id !== promotion.contact.id)];
  return {
    ok: true,
    contact: promotion.contact,
    user: promotion.user,
    created: promotion.created,
    temporaryPassword: promotion.temporaryPassword,
    patch: { contacts, users: promotion.users },
  };
}

function countActiveUsersForContact(users, contactId) {
  return (users ?? []).filter(
    (user) =>
      normalize(String(user.contactId ?? "")) === normalize(contactId) &&
      normalize(String(user.status ?? "")) === "actif",
  ).length;
}

function getDefaultAppPath(role) {
  const key = normalize(role);
  if (key.includes("super administrateur")) return "/tableau-de-bord";
  if (key === "admin pays") return "/tableau-de-bord";
  if (
    [
      "admin school",
      "secretaire",
      "prefet des etudes",
      "prefet",
      "proviseur",
      "directeur",
      "enseignant",
      "comptable",
    ].includes(key)
  ) {
    return "/etablissement";
  }
  return "/tableau-de-bord";
}

function roleHasPermission(permissions, feature, action = "READ") {
  const set = new Set(permissions ?? []);
  if (set.has("ALL_PRIVILEGES")) return true;
  if (set.has(`${feature}:${action}`)) return true;
  if (set.has(`${feature}:CRUD`)) return true;
  return false;
}

module.exports = {
  promoteContactToUser,
  saveContactWithOptionalUserAccount,
  countActiveUsersForContact,
  getDefaultAppPath,
  roleHasPermission,
  resolveEffectivePermissions,
  generateTemporaryPassword,
};
