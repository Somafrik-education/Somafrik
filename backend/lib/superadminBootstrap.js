const { hashSecret } = require("../services/credentialService");

const SUPER_ADMIN_ROLE = "Super Administrateur Somafrik";

/**
 * Construit le compte Superadmin pour backoffice_state (hash uniquement, jamais de mot de passe en clair).
 */
function buildSuperadminBackOfficeAccount({
  id,
  identifier,
  password,
  email,
  userCode,
}) {
  const secretHash = hashSecret(String(password ?? "").trim());

  return {
    id,
    publicId: userCode,
    firstName: "Super",
    lastName: "Admin",
    email,
    role: SUPER_ADMIN_ROLE,
    identifier: String(identifier ?? "superadmin").trim(),
    passwordHash: secretHash,
    pinHash: secretHash,
    schoolCode: "*",
    countryScope: "",
    scopeLevel: "Global",
    accessChannel: "Application",
    status: "Actif",
    permissions: ["ALL_PRIVILEGES"],
    mustChangePassword: true,
  };
}

/**
 * Met à jour users + backoffice_state avec des identifiants cohérents.
 */
async function syncSuperadminCredentials(pool, options = {}) {
  const identifier = String(options.identifier ?? process.env.BOOTSTRAP_SUPERADMIN_ID ?? "superadmin").trim();
  const password = String(options.password ?? process.env.BOOTSTRAP_SUPERADMIN_PASSWORD ?? "").trim();
  const email = String(options.email ?? process.env.BOOTSTRAP_SUPERADMIN_EMAIL ?? "superadmin@somafrik.app").trim();
  const userCode = String(options.userCode ?? process.env.BOOTSTRAP_SUPERADMIN_CODE ?? "USR-2026-000002").trim();

  if (!password || password.length < 12) {
    throw new Error("BOOTSTRAP_SUPERADMIN_PASSWORD doit contenir au moins 12 caractères.");
  }

  const secretHash = hashSecret(password);

  const existing = await pool.query(
    `SELECT id, user_code FROM users WHERE role = 'SUPER_ADMIN' ORDER BY created_at ASC LIMIT 1`,
  );

  let userId;
  if (existing.rows[0]) {
    userId = existing.rows[0].id;
    await pool.query(
      `UPDATE users
       SET user_code = $1,
           first_name = 'Super',
           last_name = 'Admin',
           email = $2,
           password_hash = $3,
           pin_hash = $3,
           status = 'active',
           must_change_password = TRUE,
           updated_at = NOW()
       WHERE id = $4`,
      [userCode, email, secretHash, userId],
    );
  } else {
    const inserted = await pool.query(
      `INSERT INTO users (
        school_id, user_code, first_name, last_name, email, phone,
        password_hash, pin_hash, role, status, must_change_password
      ) VALUES (
        NULL, $1, 'Super', 'Admin', $2, '', $3, $3, 'SUPER_ADMIN', 'active', TRUE
      )
      RETURNING id`,
      [userCode, email, secretHash],
    );
    userId = inserted.rows[0].id;
  }

  const stateRow = await pool.query(
    `SELECT state_payload FROM backoffice_state WHERE state_key = 'default' LIMIT 1`,
  );
  const state = stateRow.rows[0]?.state_payload ?? { users: [] };
  const users = Array.isArray(state.users) ? state.users.filter(Boolean) : [];
  const account = buildSuperadminBackOfficeAccount({
    id: userId,
    identifier,
    password,
    email,
    userCode,
  });

  const withoutSuperadmin = users.filter(
    (user) =>
      String(user?.role ?? "") !== SUPER_ADMIN_ROLE &&
      String(user?.identifier ?? "").toLowerCase() !== identifier.toLowerCase() &&
      String(user?.publicId ?? "").toUpperCase() !== userCode.toUpperCase(),
  );

  state.users = [...withoutSuperadmin, account];
  state.updatedAt = new Date().toISOString();

  await pool.query(
    `INSERT INTO backoffice_state (state_key, state_payload, updated_at)
     VALUES ('default', $1::jsonb, NOW())
     ON CONFLICT (state_key) DO UPDATE SET
       state_payload = EXCLUDED.state_payload,
       updated_at = NOW()`,
    [JSON.stringify(state)],
  );

  return { identifier, email, userCode, userId };
}

module.exports = {
  SUPER_ADMIN_ROLE,
  buildSuperadminBackOfficeAccount,
  syncSuperadminCredentials,
};
