import { randomUUID } from "node:crypto";
import express from "express";
import backend from "./backendBridge.cjs";
import { buildPocBulletinHtml } from "./bulletin.js";
import { renderBulletinPdf } from "./pdf.js";
import { enqueueNotification } from "./queueDelivery.js";
import {
  PocDatabaseError,
  readOutbox,
  runPocTransaction,
} from "./transaction.js";

const { TokenService, RbacService } = backend;

const REPRESENTATIVE_ROUTE = "GET /api/students";
const rbac = new RbacService();

function bearerToken(req) {
  const header = String(req.get("authorization") ?? "");
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : "";
}

function databaseStatus(error) {
  if (error instanceof PocDatabaseError) {
    if (
      error.code === "POC_DATABASE_HOST_REFUSED" ||
      error.code === "POC_DATABASE_NAME_REFUSED" ||
      error.code === "POC_DATABASE_TARGET_REFUSED"
    ) {
      return 403;
    }
    return 503;
  }
  return 503;
}

export function createPocApp({ getEnv }) {
  const app = express();
  app.disable("x-powered-by");

  function env() {
    return getEnv();
  }

  // Middleware représentatif simplifié. Il réutilise TokenService.verify et
  // RbacService.canAccess sur une seule route. Il ne rejoue pas le middleware
  // de production : pas de session PostgreSQL, pas de portée établissement,
  // pas de permissions lues en base, pas de rate limit, pas d'idempotence.
  function requireRepresentativeAccess(req, res, next) {
    const secret = String(env().POC_JWT_SECRET ?? "");
    if (secret.length < 32) {
      return res.status(503).json({ code: "POC_SECRET_MISSING" });
    }
    if (req.query?.token != null || req.query?.access_token != null) {
      return res.status(401).json({ code: "AUTH_QUERY_REJECTED" });
    }
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ code: "AUTH_REQUIRED" });
    try {
      const payload = new TokenService({ secret }).verify(token, "access");
      const principal = {
        sub: payload.sub,
        role: payload.role,
        schoolCode: payload.schoolCode,
        identifier: payload.identifier,
      };
      if (!rbac.canAccess(principal, REPRESENTATIVE_ROUTE)) {
        return res.status(403).json({ code: "PERMISSION_DENIED" });
      }
      req.pocPrincipal = principal;
      return next();
    } catch {
      return res.status(401).json({ code: "AUTH_INVALID" });
    }
  }

  app.get("/api/poc/health", (_req, res) => {
    res.json({ poc: "mig-workers-poc-01", express: true });
  });

  app.get("/api/poc/students-access", requireRepresentativeAccess, (req, res) => {
    res.json({
      allowed: true,
      route: REPRESENTATIVE_ROUTE,
      role: req.pocPrincipal.role,
      middleware: "representative-simplified",
    });
  });

  app.post("/api/poc/transaction", requireRepresentativeAccess, async (_req, res) => {
    try {
      const target = env().POC_DB_TARGET === "supabase-preprod-hyperdrive"
        ? "supabase-preprod-hyperdrive" : "local";
      const result = await runPocTransaction(env().HYPERDRIVE?.connectionString, target);
      res.json({ rolledBack: result.rolledBack === true });
    } catch (error) {
      res.status(databaseStatus(error)).json({
        code: error instanceof PocDatabaseError ? error.code : "POC_DATABASE_ERROR",
      });
    }
  });

  app.post("/api/poc/bulletin.pdf", requireRepresentativeAccess, async (_req, res) => {
    try {
      const html = buildPocBulletinHtml();
      const pdf = await renderBulletinPdf(env().BROWSER, html);
      res.setHeader("content-type", "application/pdf");
      res.setHeader("cache-control", "no-store");
      res.send(Buffer.from(pdf));
    } catch (error) {
      const code = error?.code || "POC_PDF_FAILED";
      res.status(code === "BROWSER_BINDING_REQUIRED" ? 503 : 500).json({ code });
    }
  });

  app.post("/api/poc/outbox", requireRepresentativeAccess, async (_req, res) => {
    const id = randomUUID();
    try {
      await enqueueNotification({
        connectionString: env().HYPERDRIVE?.connectionString,
        queue: env().NOTIFY_QUEUE,
        id,
      });
      res.status(202).json({ id, status: "queued" });
    } catch (error) {
      if (error instanceof PocDatabaseError) {
        return res.status(databaseStatus(error)).json({ code: error.code });
      }
      const code =
        error?.code === "POC_QUEUE_PUBLISH_FAILED" || error?.code === "POC_QUEUE_BINDING_REQUIRED"
          ? error.code
          : "POC_OUTBOX_ERROR";
      return res.status(503).json({ code });
    }
  });

  app.get("/api/poc/outbox/:id", requireRepresentativeAccess, async (req, res) => {
    try {
      const row = await readOutbox(env().HYPERDRIVE?.connectionString, req.params.id);
      if (!row) return res.status(404).json({ code: "POC_OUTBOX_NOT_FOUND" });
      res.json({ id: row.id, status: row.status });
    } catch (error) {
      res.status(databaseStatus(error)).json({
        code: error instanceof PocDatabaseError ? error.code : "POC_DATABASE_ERROR",
      });
    }
  });

  return app;
}

export function issuePocAccessToken(secret, role) {
  return new TokenService({ secret }).createAccessToken({
    sub: `poc-${role}`,
    role,
    schoolCode: "POC-WORKERS-01",
    identifier: `poc-${role}`,
    typ: "access",
  });
}
