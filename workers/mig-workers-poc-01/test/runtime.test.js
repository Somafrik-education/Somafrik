import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { templateCss, templateHtml } from "../src/bulletinTemplates.js";
import { buildPocBulletinHtml } from "../src/bulletin.js";
import { issuePocAccessToken } from "../src/app.js";
import { renderBulletinPdf } from "../src/pdf.js";
import { assertPocConnectionString } from "../src/transaction.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const connectionString = process.env.POC_DATABASE_URL ?? "";
const secret = `poc-${"a".repeat(40)}`;

function startWorker(configPath) {
  const child = spawn(
    process.execPath,
    [
      path.join(root, "node_modules", "wrangler", "bin", "wrangler.js"),
      "dev",
      "--local",
      "--port",
      "8791",
      "--ip",
      "127.0.0.1",
      "--config",
      configPath,
    ],
    {
      cwd: root,
      env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  const onData = (chunk) => {
    logs += chunk.toString();
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  return { child, get logs() { return logs; } };
}

async function waitForReady(session) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (session.child.exitCode != null) {
      throw new Error(`wrangler s'est arrêté\n${session.logs.slice(-2000)}`);
    }
    try {
      const response = await fetch("http://127.0.0.1:8791/api/poc/health");
      if (response.status === 200) return;
    } catch {
      // Le port n'écoute pas encore.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Worker POC injoignable\n${session.logs.slice(-2000)}`);
}

async function stopWorker(session) {
  if (session.child.exitCode != null) return;
  session.child.kill("SIGTERM");
  const exited = once(session.child, "exit");
  const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
  await Promise.race([exited, timeout]);
  if (session.child.exitCode == null) session.child.kill("SIGKILL");
}

test("MIG-WORKERS-POC-01 — Express, Hyperdrive local, file, PDF non simulé", async (t) => {
  assert.ok(connectionString, "POC_DATABASE_URL manquant");
  assert.equal(assertPocConnectionString(connectionString).includes("workers_poc"), true);
  assert.throws(() => assertPocConnectionString("postgresql://u:p@db.supabase.co:5432/somafrik_workers_poc"), /HOST_REFUSED/);
  assert.throws(() => assertPocConnectionString("postgresql://u:p@127.0.0.1:5432/somafrik"), /NAME_REFUSED/);

  const html = buildPocBulletinHtml();
  assert.match(html, /Élève fictif POC-01/);
  await assert.rejects(renderBulletinPdf(undefined, html), /BROWSER_BINDING_REQUIRED/);

  const normalizeLineEndings = (value) => value.replace(/\r\n/g, "\n");
  const officialHtml = await readFile(
    path.resolve(root, "../../backend/templates/bulletin/report-card.html"),
    "utf8",
  );
  assert.equal(normalizeLineEndings(templateHtml), normalizeLineEndings(officialHtml));
  const officialCss = await readFile(
    path.resolve(root, "../../backend/templates/bulletin/report-card.css"),
    "utf8",
  );
  assert.equal(normalizeLineEndings(templateCss), normalizeLineEndings(officialCss));

  const configPath = path.join(root, ".wrangler-test.jsonc");
  const base = JSON.parse(
    (await readFile(path.join(root, "wrangler.jsonc"), "utf8")).replace(/^\s*\/\/.*$/gm, ""),
  );
  delete base.$schema;
  base.hyperdrive = [
    {
      binding: "HYPERDRIVE",
      id: "00000000000000000000000000000000",
      localConnectionString: connectionString,
    },
  ];
  base.vars = {
    ...base.vars,
    POC_JWT_SECRET: secret,
  };
  await writeFile(configPath, JSON.stringify(base, null, 2));

  const session = startWorker(configPath);
  t.after(async () => {
    await stopWorker(session);
    await rm(configPath, { force: true });
  });
  await waitForReady(session);

  const admin = issuePocAccessToken(secret, "school_admin");
  const student = issuePocAccessToken(secret, "student");
  const accountant = issuePocAccessToken(secret, "Comptable");
  const platform = issuePocAccessToken(secret, "super_admin");

  const anonymous = await fetch("http://127.0.0.1:8791/api/poc/students-access");
  assert.equal(anonymous.status, 401);

  const queryToken = await fetch("http://127.0.0.1:8791/api/poc/students-access?token=abc");
  assert.equal(queryToken.status, 401);

  const invalid = await fetch("http://127.0.0.1:8791/api/poc/students-access", {
    headers: { authorization: "Bearer pas-un-jwt" },
  });
  assert.equal(invalid.status, 401);

  const denied = await fetch("http://127.0.0.1:8791/api/poc/students-access", {
    headers: { authorization: `Bearer ${accountant}` },
  });
  assert.equal(denied.status, 403);

  const studentAllowed = await fetch("http://127.0.0.1:8791/api/poc/students-access", {
    headers: { authorization: `Bearer ${student}` },
  });
  assert.equal(studentAllowed.status, 200);
  assert.deepEqual(await studentAllowed.json(), {
    allowed: true,
    route: "GET /api/students",
    role: "student",
    middleware: "representative-simplified",
  });

  const platformDenied = await fetch("http://127.0.0.1:8791/api/poc/students-access", {
    headers: { authorization: `Bearer ${platform}` },
  });
  assert.equal(platformDenied.status, 403);

  const allowed = await fetch("http://127.0.0.1:8791/api/poc/students-access", {
    headers: { authorization: `Bearer ${admin}` },
  });
  assert.equal(allowed.status, 200);
  const allowedBody = await allowed.json();
  assert.deepEqual(allowedBody, {
    allowed: true,
    route: "GET /api/students",
    role: "school_admin",
    middleware: "representative-simplified",
  });

  const transaction = await fetch("http://127.0.0.1:8791/api/poc/transaction", {
    method: "POST",
    headers: { authorization: `Bearer ${admin}` },
  });
  assert.equal(transaction.status, 200, session.logs.slice(-1500));
  assert.deepEqual(await transaction.json(), { rolledBack: true });

  const pdf = await fetch("http://127.0.0.1:8791/api/poc/bulletin.pdf", {
    method: "POST",
    headers: { authorization: `Bearer ${admin}` },
  });
  assert.equal(pdf.status, 503);
  assert.deepEqual(await pdf.json(), { code: "BROWSER_BINDING_REQUIRED" });

  const queued = await fetch("http://127.0.0.1:8791/api/poc/outbox", {
    method: "POST",
    headers: { authorization: `Bearer ${admin}` },
  });
  assert.equal(queued.status, 202, session.logs.slice(-1500));
  const queuedBody = await queued.json();
  assert.equal(queuedBody.status, "queued");
  assert.match(queuedBody.id, /^[0-9a-f-]{36}$/);

  let processed = null;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const row = await fetch(`http://127.0.0.1:8791/api/poc/outbox/${queuedBody.id}`, {
      headers: { authorization: `Bearer ${admin}` },
    });
    assert.equal(row.status, 200);
    processed = await row.json();
    if (processed.status === "processed") break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.equal(processed?.status, "processed", session.logs.slice(-2000));
});
