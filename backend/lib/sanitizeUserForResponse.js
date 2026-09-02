/**
 * Sanitization centralisée des comptes / profils renvoyés au client.
 * Ne modifie jamais le modèle persisté : opère uniquement sur des copies de réponse.
 */

const SENSITIVE_USER_FIELDS = Object.freeze([
  "password",
  "temporaryPassword",
  "temporarySecret",
  "passwordHash",
  "pin",
  "pinHash",
  "refreshToken",
  "refreshTokenHash",
]);

const SENSITIVE_USER_FIELD_SET = new Set(SENSITIVE_USER_FIELDS);

const CREDENTIAL_BEARING_STATE_KEYS = Object.freeze(["users", "teachers", "students"]);

/**
 * Retire les secrets d'un objet utilisateur / élève / enseignant (copie shallow + children).
 * Préserve le signal non secret `hasTemporaryPassword` lorsqu'un mot de passe temporaire existait.
 * @param {unknown} user
 * @returns {unknown}
 */
function sanitizeUserForResponse(user) {
  if (user == null || typeof user !== "object" || Array.isArray(user)) {
    return user;
  }

  const {
    password: _password,
    temporaryPassword,
    temporarySecret,
    passwordHash: _passwordHash,
    pin: _pin,
    pinHash: _pinHash,
    refreshToken: _refreshToken,
    refreshTokenHash: _refreshTokenHash,
    ...safeUser
  } = user;

  if (
    safeUser.hasTemporaryPassword == null &&
    ((temporaryPassword != null && String(temporaryPassword).trim()) ||
      (temporarySecret != null && String(temporarySecret).trim()))
  ) {
    safeUser.hasTemporaryPassword = true;
  }

  if (Array.isArray(safeUser.children)) {
    safeUser.children = safeUser.children.map((child) => sanitizeUserForResponse(child));
  }

  return safeUser;
}

/**
 * @param {unknown} users
 * @returns {unknown}
 */
function sanitizeUsersForResponse(users) {
  if (!Array.isArray(users)) {
    return users;
  }
  return users.map((user) => sanitizeUserForResponse(user));
}

/**
 * Sanitize les collections de comptes d'un état backoffice destiné au client.
 * @param {unknown} state
 * @returns {unknown}
 */
function sanitizeCredentialBearingStateForResponse(state) {
  if (state == null || typeof state !== "object" || Array.isArray(state)) {
    return state;
  }

  const next = { ...state };
  for (const key of CREDENTIAL_BEARING_STATE_KEYS) {
    if (Array.isArray(next[key])) {
      next[key] = sanitizeUsersForResponse(next[key]);
    }
  }
  return next;
}

/**
 * Sanitize le payload de login (user + users) sans toucher aux jetons top-level.
 * @param {unknown} payload
 * @returns {unknown}
 */
function sanitizeAuthPayloadForResponse(payload) {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const next = { ...payload };
  if (next.user != null) {
    next.user = sanitizeUserForResponse(next.user);
  }
  if (Array.isArray(next.users)) {
    next.users = sanitizeUsersForResponse(next.users);
  }
  return next;
}

/**
 * Parcourt récursivement une charge JSON et retire les champs secrets.
 * Utile pour snapshot / rapports qui embarquent des objets student/user.
 * Ne supprime pas les clés listées dans `preserveTopLevelKeys` au premier niveau.
 * @param {unknown} value
 * @param {{ preserveTopLevelKeys?: string[] }} [options]
 * @returns {unknown}
 */
function stripSensitiveFieldsDeep(value, options = {}) {
  const preserveTopLevel = new Set(options.preserveTopLevelKeys ?? []);
  return stripSensitiveFieldsDeepInternal(value, preserveTopLevel, true);
}

function stripSensitiveFieldsDeepInternal(value, preserveTopLevel, isRoot) {
  if (Array.isArray(value)) {
    return value.map((item) => stripSensitiveFieldsDeepInternal(item, preserveTopLevel, false));
  }

  if (value == null || typeof value !== "object") {
    return value;
  }

  const next = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_USER_FIELD_SET.has(key) && !(isRoot && preserveTopLevel.has(key))) {
      continue;
    }
    next[key] = stripSensitiveFieldsDeepInternal(nested, preserveTopLevel, false);
  }

  if (
    next.hasTemporaryPassword == null &&
    ((value.temporaryPassword != null && String(value.temporaryPassword).trim()) ||
      (value.temporarySecret != null && String(value.temporarySecret).trim())) &&
    !(isRoot && (preserveTopLevel.has("temporaryPassword") || preserveTopLevel.has("temporarySecret")))
  ) {
    next.hasTemporaryPassword = true;
  }

  return next;
}

/**
 * Collecte les chemins JSON contenant encore des champs secrets (pour tests).
 * @param {unknown} value
 * @param {string} [basePath]
 * @param {{ ignoreTopLevelKeys?: string[] }} [options]
 * @returns {string[]}
 */
function collectSensitiveUserFieldPaths(value, basePath = "", options = {}) {
  const ignoreTopLevel = new Set(options.ignoreTopLevelKeys ?? []);
  const found = [];

  const visit = (node, path, isRoot) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`, false));
      return;
    }
    if (node == null || typeof node !== "object") {
      return;
    }
    for (const [key, nested] of Object.entries(node)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (SENSITIVE_USER_FIELD_SET.has(key) && !(isRoot && ignoreTopLevel.has(key))) {
        found.push(nextPath);
      }
      visit(nested, nextPath, false);
    }
  };

  visit(value, basePath, true);
  return found;
}

module.exports = {
  SENSITIVE_USER_FIELDS,
  sanitizeUserForResponse,
  sanitizeUsersForResponse,
  sanitizeCredentialBearingStateForResponse,
  sanitizeAuthPayloadForResponse,
  stripSensitiveFieldsDeep,
  collectSensitiveUserFieldPaths,
};
