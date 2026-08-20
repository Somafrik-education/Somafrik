"use strict";

const http = require("node:http");
const { URL } = require("node:url");
const { CANONICAL_API_URLS } = require("../config/releaseEnvironments");

function normalizePath(value) {
  const text = String(value ?? "").trim();
  if (!text) return "/api/backoffice/users";
  return text.startsWith("/") ? text : `/${text}`;
}

function shouldFaultRequest({ method, url }, options = {}) {
  const failMethod = String(options.failMethod || "GET").trim().toUpperCase();
  const failPath = normalizePath(options.failPath);
  const requestPath = new URL(String(url || "/"), "http://e2e.local").pathname;
  return String(method || "GET").toUpperCase() === failMethod && requestPath === failPath;
}

function safeForwardHeaders(headers) {
  const next = { ...headers };
  for (const key of ["host", "content-length", "connection", "accept-encoding"]) {
    delete next[key];
  }
  return next;
}

async function readRequestBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function createFaultProxy(options = {}) {
  const target = String(options.target || CANONICAL_API_URLS.preview).replace(/\/$/, "");
  const failPath = normalizePath(options.failPath);
  const failMethod = String(options.failMethod || "GET").toUpperCase();
  const failStatus = Number(options.failStatus || 503);

  return http.createServer(async (req, res) => {
    try {
      if (shouldFaultRequest(req, { failPath, failMethod })) {
        res.statusCode = failStatus;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(
          JSON.stringify({
            code: "E2E_INJECTED_DOMAIN_FAILURE",
            message: "Erreur de domaine injectée par le proxy QA LOT 8.",
          }),
        );
        return;
      }

      const upstreamUrl = `${target}${req.url || "/"}`;
      const body = await readRequestBody(req);
      const upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers: safeForwardHeaders(req.headers),
        body,
        redirect: "manual",
      });

      res.statusCode = upstream.status;
      const contentType = upstream.headers.get("content-type");
      if (contentType) res.setHeader("Content-Type", contentType);
      const cacheControl = upstream.headers.get("cache-control");
      if (cacheControl) res.setHeader("Cache-Control", cacheControl);
      const location = upstream.headers.get("location");
      if (location) res.setHeader("Location", location);
      const payload = Buffer.from(await upstream.arrayBuffer());
      res.end(payload);
    } catch (error) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(
        JSON.stringify({
          code: "E2E_PROXY_UPSTREAM_FAILED",
          message: error instanceof Error ? error.message : "Proxy E2E indisponible.",
        }),
      );
    }
  });
}

function main() {
  const port = Number(process.env.SOMAFRIK_E2E_PROXY_PORT || 5055);
  const host = String(process.env.SOMAFRIK_E2E_PROXY_HOST || "0.0.0.0");
  const target = String(process.env.SOMAFRIK_E2E_PROXY_TARGET || CANONICAL_API_URLS.preview);
  const failPath = normalizePath(process.env.SOMAFRIK_E2E_FAIL_PATH || "/api/backoffice/users");
  const failMethod = String(process.env.SOMAFRIK_E2E_FAIL_METHOD || "GET").toUpperCase();

  if (target.replace(/\/$/, "") !== CANONICAL_API_URLS.preview) {
    throw new Error(`Le proxy E2E doit cibler uniquement la préprod canonique ${CANONICAL_API_URLS.preview}.`);
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`SOMAFRIK_E2E_PROXY_PORT invalide: ${port}.`);
  }

  const server = createFaultProxy({ target, failPath, failMethod });
  server.listen(port, host, () => {
    console.log(`E2E fault proxy: http://${host}:${port} -> ${target}`);
    console.log(`Injection: ${failMethod} ${failPath} -> 503`);
  });

  const close = () => server.close(() => process.exit(0));
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  createFaultProxy,
  normalizePath,
  safeForwardHeaders,
  shouldFaultRequest,
};
