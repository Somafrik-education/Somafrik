const crypto = require("crypto");

const DEMO_PROFILES = new Set([
  "direction",
  "administration",
  "enseignant",
  "personnel",
  "parent",
  "partenaire",
  "investisseur",
  "etudiant",
  "autre",
]);

const DEMO_DISCOVERY_ROLES = new Set([
  "decider",
  "choix",
  "utilisateur",
  "recommande",
  "decouverte",
]);

const BLOCKED_GATEWAY_PATHS = new Set([
  "/api/login",
  "/api/backoffice/login",
  "/api/identify",
]);

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function validateDemoQualification(payload = {}) {
  const profile = cleanText(payload.profile, 32);
  const discoveryRole = cleanText(payload.discoveryRole, 32);
  const countryIso = cleanText(payload.countryIso, 2).toUpperCase();
  const organizationName = cleanText(payload.organizationName, 120);
  const website = cleanText(payload.website, 200);

  if (!DEMO_PROFILES.has(profile)) {
    const error = new Error("Profil de démonstration invalide.");
    error.statusCode = 400;
    throw error;
  }
  if (!DEMO_DISCOVERY_ROLES.has(discoveryRole)) {
    const error = new Error("Rôle de découverte invalide.");
    error.statusCode = 400;
    throw error;
  }
  if (!/^[A-Z]{2}$/.test(countryIso)) {
    const error = new Error("Pays de démonstration invalide.");
    error.statusCode = 400;
    throw error;
  }

  return {
    profile,
    discoveryRole,
    countryIso,
    organizationName,
    botHoneypotTriggered: Boolean(website),
  };
}

function assertDemoRuntimeEnvironment(env = process.env) {
  const appEnv = String(env.APP_ENV ?? "").trim();
  if (appEnv !== "demo") {
    throw new Error(`Passerelle Démo refusée : APP_ENV=demo requis (reçu: ${appEnv || "vide"}).`);
  }
  if (String(env.SOMAFRIK_SKIP_DEMO_SEED ?? "").trim() !== "true") {
    throw new Error("Passerelle Démo refusée : SOMAFRIK_SKIP_DEMO_SEED=true est obligatoire.");
  }

  const publicPort = Number(env.PORT ?? 5000);
  const innerPort = Number(env.DEMO_INNER_PORT ?? 5001);
  if (!Number.isInteger(publicPort) || !Number.isInteger(innerPort) || publicPort <= 0 || innerPort <= 0) {
    throw new Error("Passerelle Démo refusée : ports invalides.");
  }
  if (publicPort === innerPort) {
    throw new Error("Passerelle Démo refusée : PORT et DEMO_INNER_PORT doivent être distincts.");
  }

  return { publicPort, innerPort };
}

function buildDemoRedirectUrl(webOrigin, code) {
  const origin = String(webOrigin ?? "").trim().replace(/\/$/, "");
  const url = new URL("/entry", origin);
  url.searchParams.set("code", String(code));
  return url.toString();
}

function ticketDigest(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function createDemoTicketStore({
  ttlMs = 120_000,
  now = () => Date.now(),
  randomBytes = (size) => crypto.randomBytes(size),
} = {}) {
  const tickets = new Map();

  function cleanup() {
    const current = now();
    for (const [key, value] of tickets.entries()) {
      if (value.expiresAt <= current) tickets.delete(key);
    }
  }

  return {
    issue(metadata = {}) {
      cleanup();
      const code = randomBytes(24).toString("base64url");
      const issuedAt = now();
      const sessionId = `DEMO-${randomBytes(6).toString("hex").toUpperCase()}`;
      tickets.set(ticketDigest(code), {
        metadata,
        sessionId,
        issuedAt,
        expiresAt: issuedAt + ttlMs,
      });
      return { code, sessionId, issuedAt, expiresAt: issuedAt + ttlMs };
    },

    consume(code) {
      cleanup();
      const key = ticketDigest(code);
      const ticket = tickets.get(key);
      if (!ticket) return null;
      tickets.delete(key);
      if (ticket.expiresAt <= now()) return null;
      return ticket;
    },

    size() {
      cleanup();
      return tickets.size;
    },
  };
}

function isBlockedDemoGatewayPath(pathname) {
  const path = String(pathname ?? "").split("?")[0];
  return (
    BLOCKED_GATEWAY_PATHS.has(path) ||
    path.startsWith("/api/backoffice/e2e/") ||
    path.startsWith("/api/debug/")
  );
}

module.exports = {
  DEMO_PROFILES,
  DEMO_DISCOVERY_ROLES,
  validateDemoQualification,
  assertDemoRuntimeEnvironment,
  buildDemoRedirectUrl,
  createDemoTicketStore,
  isBlockedDemoGatewayPath,
};
