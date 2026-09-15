function assertDemoResetSafety(env = process.env) {
  const appEnv = String(env.APP_ENV ?? "").trim();
  if (appEnv !== "demo") {
    throw new Error(`Reset Démo refusé : APP_ENV=demo requis (reçu: ${appEnv || "vide"}).`);
  }

  if (String(env.SOMAFRIK_SKIP_DEMO_SEED ?? "").trim() !== "true") {
    throw new Error("Reset Démo refusé : SOMAFRIK_SKIP_DEMO_SEED=true est obligatoire.");
  }

  const confirmation = String(env.SOMAFRIK_DEMO_RESET_CONFIRM ?? "").trim();
  if (confirmation !== "RESET_DEMO_DATA") {
    throw new Error("Reset Démo refusé : SOMAFRIK_DEMO_RESET_CONFIRM=RESET_DEMO_DATA requis.");
  }

  const databaseUrl = String(env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    throw new Error("Reset Démo refusé : DATABASE_URL Démo explicite obligatoire.");
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Reset Démo refusé : DATABASE_URL invalide.");
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new Error("Reset Démo refusé : seule une URL PostgreSQL est acceptée.");
  }

  const marker = String(env.SOMAFRIK_DEMO_DATABASE_URL_MARKER ?? "").trim();
  if (marker.length < 8) {
    throw new Error("Reset Démo refusé : SOMAFRIK_DEMO_DATABASE_URL_MARKER doit contenir au moins 8 caractères.");
  }
  if (!databaseUrl.includes(marker)) {
    throw new Error("Reset Démo refusé : DATABASE_URL ne contient pas le marqueur de base Démo attendu.");
  }

  return { databaseUrl, marker };
}

function scrubCredentialFields(value) {
  if (Array.isArray(value)) return value.map(scrubCredentialFields);
  if (!value || typeof value !== "object") return value;

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (["password", "pin", "passwordHash", "pinHash", "temporaryPassword"].includes(key)) {
      continue;
    }
    result[key] = scrubCredentialFields(child);
  }
  return result;
}

function hardenBackOfficeCredentials(payload, secretHash) {
  const hash = String(secretHash ?? "").trim();
  if (!hash) {
    throw new Error("Durcissement Démo refusé : hash de credential obligatoire.");
  }

  const scrubbed = scrubCredentialFields(payload);
  if (!scrubbed || typeof scrubbed !== "object" || Array.isArray(scrubbed)) {
    throw new Error("Durcissement Démo refusé : snapshot BackOffice invalide.");
  }

  return {
    ...scrubbed,
    users: Array.isArray(scrubbed.users)
      ? scrubbed.users.map((user) => ({
          ...user,
          passwordHash: hash,
          pinHash: hash,
        }))
      : [],
  };
}

module.exports = {
  assertDemoResetSafety,
  scrubCredentialFields,
  hardenBackOfficeCredentials,
};
