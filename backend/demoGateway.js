const path = require("path");
const http = require("http");
const { createHash } = require("crypto");
const { spawn } = require("child_process");
const express = require("express");
const cors = require("cors");
const { createRateLimiter } = require("./lib/rateLimit");
const {
  buildCorsOptions,
  resolveDemoFrontendOrigin,
} = require("./lib/corsConfig");
const {
  assertDemoRuntimeEnvironment,
  buildDemoRedirectUrl,
  createDemoTicketStore,
  isBlockedDemoGatewayPath,
  resolveDemoInternalSeedPin,
  validateDemoQualification,
} = require("./lib/demoGatewayPolicy");

class DemoHttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function normalizedOrigin(value) {
  return String(value ?? "").trim().replace(/\/$/, "");
}

function normalizeCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function accessTokenDigest(token) {
  const value = String(token ?? "").trim();
  if (!value) return "";
  return createHash("sha256").update(value).digest("hex");
}

function bearerToken(req) {
  const raw = String(req.get("authorization") ?? "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match ? match[1].trim() : "";
}

function enrichDemoAuthWithCanonicalSchool(auth) {
  if (!auth || typeof auth !== "object" || !auth.user || typeof auth.user !== "object") {
    throw new DemoHttpError(503, "Session Démo indisponible.");
  }
  const school = auth.school && typeof auth.school === "object" ? auth.school : {};
  const schoolId = String(auth.user.schoolId ?? school.id ?? school.schoolId ?? "").trim();
  const schoolPublicCode = String(
    auth.user.schoolPublicCode ?? school.loginCode ?? school.publicId ?? "",
  )
    .trim()
    .toUpperCase();

  // Le Web V2 scope les données établissement fail-closed sur schoolId.
  // Ne jamais fabriquer cette identité depuis schoolCode : elle doit provenir
  // du contexte établissement authentifié renvoyé par l'API interne.
  if (!schoolId || !schoolPublicCode) {
    throw new DemoHttpError(503, "Identité canonique de l’établissement Démo indisponible.");
  }

  return {
    ...auth,
    user: {
      ...auth.user,
      schoolId,
      schoolPublicCode,
    },
  };
}

function createInnerLogin(env = process.env) {
  const innerPort = Number(env.DEMO_INNER_PORT ?? 5001);
  const innerOrigin = `http://127.0.0.1:${innerPort}`;
  const internalSeedPin = resolveDemoInternalSeedPin(env);

  return async function loginToInner() {
    const response = await fetch(`${innerOrigin}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: String(env.DEMO_DEFAULT_ROLE ?? "school_admin"),
        schoolCode: String(env.DEMO_SCHOOL_CODE ?? "CD-IN-26-001"),
        identifier: String(env.DEMO_IDENTIFIER ?? "admin"),
        pin: internalSeedPin,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new DemoHttpError(503, "Session Démo indisponible.");
    }
    return enrichDemoAuthWithCanonicalSchool(payload);
  };
}

function createInnerProxy(env = process.env) {
  const innerPort = Number(env.DEMO_INNER_PORT ?? 5001);

  return function proxyRequest(req, res) {
    if (isBlockedDemoGatewayPath(req.originalUrl || req.url)) {
      res.status(404).json({ message: "Route indisponible dans l’environnement Démo." });
      return;
    }

    const headers = { ...req.headers };
    delete headers.host;
    delete headers.origin;
    delete headers.referer;
    delete headers["access-control-request-headers"];
    delete headers["access-control-request-method"];
    headers["x-somafrik-demo-gateway"] = "1";

    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: innerPort,
        method: req.method,
        path: req.originalUrl || req.url,
        headers,
      },
      (upstreamResponse) => {
        res.status(upstreamResponse.statusCode || 502);
        for (const [name, value] of Object.entries(upstreamResponse.headers)) {
          if (value == null) continue;
          if (name.toLowerCase().startsWith("access-control-")) continue;
          res.setHeader(name, value);
        }
        upstreamResponse.pipe(res);
      },
    );

    upstream.on("error", () => {
      if (!res.headersSent) {
        res.status(502).json({ message: "API Démo interne indisponible." });
      } else {
        res.end();
      }
    });

    req.pipe(upstream);
  };
}

function createDemoGatewayApp({
  env = process.env,
  ticketStore,
  loginToInner,
  proxyRequest,
} = {}) {
  assertDemoRuntimeEnvironment(env);

  const app = express();
  const trustProxyHops = Number(env.TRUST_PROXY_HOPS ?? 0);
  if (trustProxyHops > 0) app.set("trust proxy", trustProxyHops);
  app.disable("x-powered-by");

  const demoFrontendOrigin = resolveDemoFrontendOrigin(env);
  const tickets =
    ticketStore ||
    createDemoTicketStore({
      ttlMs: Number(env.DEMO_ENTRY_CODE_TTL_SECONDS ?? 120) * 1000,
    });
  const internalLogin = loginToInner || createInnerLogin(env);
  const proxy = proxyRequest || createInnerProxy(env);
  const sessionContexts = new Map();

  function rememberSessionContext(auth, expiresAt) {
    const digest = accessTokenDigest(auth?.accessToken);
    if (!digest || !auth?.school || !auth?.user) return;
    sessionContexts.set(digest, {
      school: auth.school,
      user: auth.user,
      expiresAt,
    });
  }

  function contextForRequest(req) {
    const digest = accessTokenDigest(bearerToken(req));
    if (!digest) return null;
    const context = sessionContexts.get(digest);
    if (!context) return null;
    if (Number(context.expiresAt ?? 0) <= Date.now()) {
      sessionContexts.delete(digest);
      return null;
    }
    return context;
  }

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(cors(buildCorsOptions({ BusinessError: DemoHttpError }, env)));

  const entryRateLimiter = createRateLimiter({
    windowMs: Number(env.DEMO_ENTRY_RATE_LIMIT_WINDOW_MS ?? 60_000),
    max: Number(env.DEMO_ENTRY_RATE_LIMIT_MAX ?? 10),
    keyFn: (req) => `demo-entry:${req.ip || "unknown"}`,
    message: "Trop de demandes de démonstration. Réessayez dans quelques minutes.",
  });

  app.post(
    "/api/public/demo-sessions",
    entryRateLimiter,
    express.json({ limit: "32kb" }),
    (req, res, next) => {
      try {
        const qualification = validateDemoQualification(req.body || {});
        if (qualification.botHoneypotTriggered) {
          return res.status(202).json({ accepted: true });
        }

        const issued = tickets.issue({
          profile: qualification.profile,
          discoveryRole: qualification.discoveryRole,
          countryIso: qualification.countryIso,
          organizationName: qualification.organizationName,
        });

        return res.status(201).json({
          redirectUrl: buildDemoRedirectUrl(demoFrontendOrigin, issued.code),
          expiresAt: new Date(issued.expiresAt).toISOString(),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.post(
    "/api/demo/exchange",
    entryRateLimiter,
    express.json({ limit: "8kb" }),
    async (req, res, next) => {
      try {
        const origin = normalizedOrigin(req.get("origin"));
        if (origin && origin !== demoFrontendOrigin) {
          throw new DemoHttpError(403, "Origine d’échange Démo non autorisée.");
        }

        const code = String(req.body?.code ?? "").trim();
        if (!code) {
          throw new DemoHttpError(400, "Code d’entrée Démo requis.");
        }

        const ticket = tickets.consume(code);
        if (!ticket) {
          throw new DemoHttpError(410, "Code d’entrée Démo invalide ou expiré.");
        }

        const auth = await internalLogin(ticket);
        const sessionTtlSeconds = Math.max(60, Math.min(Number(env.DEMO_SESSION_TTL_SECONDS ?? 900), 900));
        const sessionExpiresAt = Date.now() + sessionTtlSeconds * 1000;
        rememberSessionContext(auth, sessionExpiresAt);
        const publicAuth = { ...auth };
        delete publicAuth.refreshToken;
        return res.json({
          ...publicAuth,
          expiresIn: Math.min(Number(auth.expiresIn ?? sessionTtlSeconds), sessionTtlSeconds),
          demo: true,
          demoSession: {
            id: ticket.sessionId,
            mode: "demo",
            expiresAt: new Date(sessionExpiresAt).toISOString(),
          },
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  // Le login interne a déjà résolu l'école canonique. Le GET historique
  // reconstruit tout le snapshot BackOffice et dépasse 30 s sur le bulk seed.
  // Servir exactement le contexte authentifié évite cette reconstruction sans
  // élargir le tenant et sans exposer de credential.
  app.get("/api/backoffice/establishments/:code", (req, res, next) => {
    const context = contextForRequest(req);
    if (!context) return next();
    const requested = normalizeCode(req.params.code);
    const allowed = new Set(
      [
        context.user?.schoolCode,
        context.user?.schoolPublicCode,
        context.school?.code,
        context.school?.schoolCode,
        context.school?.loginCode,
        context.school?.publicId,
      ]
        .map(normalizeCode)
        .filter(Boolean),
    );
    if (!requested || !allowed.has(requested)) {
      return res.status(403).json({ message: "Accès refusé : établissement hors périmètre." });
    }
    return res.json(context.school);
  });

  app.use((req, res, next) => {
    if (isBlockedDemoGatewayPath(req.originalUrl || req.url)) {
      return res.status(404).json({ message: "Route indisponible dans l’environnement Démo." });
    }
    return next();
  });

  app.use((req, res) => {
    proxy(req, res);
  });

  app.use((error, _req, res, _next) => {
    const status = Number(error?.statusCode || error?.status || 500);
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    const message =
      safeStatus >= 500 && !(error instanceof DemoHttpError)
        ? "Erreur interne de la passerelle Démo."
        : String(error?.message || "Requête Démo refusée.");
    res.status(safeStatus).json({ message });
  });

  return app;
}

function spawnInnerApi(env = process.env) {
  const innerPort = Number(env.DEMO_INNER_PORT ?? 5001);
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    cwd: __dirname,
    env: {
      ...env,
      APP_ENV: "demo",
      SOMAFRIK_ENV: "demo",
      PORT: String(innerPort),
      SOMAFRIK_API_ONLY: "true",
      SOMAFRIK_SKIP_DEMO_SEED: "true",
    },
    stdio: "inherit",
  });
  return child;
}

function startDemoGateway(env = process.env) {
  const { publicPort } = assertDemoRuntimeEnvironment(env);
  const child = spawnInnerApi(env);
  const app = createDemoGatewayApp({ env });
  const server = app.listen(publicPort, "0.0.0.0", () => {
    console.log(`Somafrik Demo Gateway listening on port ${publicPort}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    if (!child.killed) child.kill("SIGTERM");
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  child.once("exit", (code, signal) => {
    if (code && code !== 0) {
      console.error(`Somafrik Demo inner API stopped unexpectedly (${code || signal}).`);
      server.close(() => process.exit(code || 1));
    }
  });

  return { app, server, child };
}

if (require.main === module) {
  try {
    startDemoGateway();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  DemoHttpError,
  enrichDemoAuthWithCanonicalSchool,
  createInnerLogin,
  createInnerProxy,
  createDemoGatewayApp,
  spawnInnerApi,
  startDemoGateway,
};
