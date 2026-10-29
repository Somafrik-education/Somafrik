"use strict";

/**
 * SEC-PDF-02 — politique de sandbox Chromium et comportement fail-closed du
 * moteur PDF des bulletins. Documents fictifs uniquement ; aucun test
 * d'évasion de sandbox.
 *
 * Les rendus réels utilisent la politique de l'environnement courant
 * (SOMAFRIK_PDF_CHROMIUM_SANDBOX) : sandbox réelle en CI (non-root), mode
 * `disabled` explicite pour un poste local en root.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const renderer = require("../services/bulletinPdfRenderer");
const {
  PDF_CHROMIUM_SANDBOX_ENV,
  PDF_SANDBOX_MODES,
  resolvePdfChromiumSandboxPolicy,
} = require("./pdfChromiumSandboxPolicy");

const SCHOOL = { id: "school-sec-pdf-02", code: "SCH-SECPDF2", name: "École Test SEC-PDF-02" };

function report(overrides = {}) {
  return {
    id: "REP-SEC-PDF-02",
    period: "Trimestre 1",
    status: "Publié",
    generatedAt: "2026-10-24T00:00:00.000Z",
    student: { name: "Élève Fictif", matricule: "EL-0002", className: "6e B" },
    subjects: [{ subject: "Mathématiques", average: 15, coefficient: 4 }],
    average: 15,
    design: { showQrCode: false },
    ...overrides,
  };
}

function assertPdf(buffer) {
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "%PDF");
}

function assertUnavailable(error, reason) {
  assert.equal(error.statusCode, 503);
  assert.equal(error.code, "BULLETIN_PDF_UNAVAILABLE");
  assert.equal(error.message, "La génération des bulletins PDF est temporairement indisponible.");
  assert.doesNotMatch(error.message, /[\\/]|chrom|sandbox|puppeteer/i, "aucun détail système dans le message");
  assert.deepEqual(Object.keys(error).sort(), ["code", "name", "statusCode"], "seuls code/statut sont sérialisables");
  if (reason) assert.equal(error.reason, reason);
  return true;
}

/** Exécute `fn` avec des variables d'environnement temporaires et un moteur réinitialisé. */
async function withEnv(overrides, fn) {
  await renderer.closeBrowser();
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    await renderer.closeBrowser();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function silenceConsoleError() {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(" "));
  return { lines, restore: () => (console.error = original) };
}

test.after(async () => {
  await renderer.closeBrowser();
});

// --- Politique --------------------------------------------------------------

test("POLICY — table de décision explicite", () => {
  const cases = [
    [{}, PDF_SANDBOX_MODES.REQUIRED, "default"],
    [{ NODE_ENV: "production" }, PDF_SANDBOX_MODES.REQUIRED, "default"],
    [{ [PDF_CHROMIUM_SANDBOX_ENV]: "enabled" }, PDF_SANDBOX_MODES.REQUIRED, "explicit"],
    [{ [PDF_CHROMIUM_SANDBOX_ENV]: " REQUIRED " }, PDF_SANDBOX_MODES.REQUIRED, "explicit"],
    [{ [PDF_CHROMIUM_SANDBOX_ENV]: "disabled", NODE_ENV: "development" }, PDF_SANDBOX_MODES.INSECURE_LOCAL, "explicit"],
    [{ [PDF_CHROMIUM_SANDBOX_ENV]: "insecure-local", NODE_ENV: "test" }, PDF_SANDBOX_MODES.INSECURE_LOCAL, "explicit"],
    [{ [PDF_CHROMIUM_SANDBOX_ENV]: "disabled", NODE_ENV: "test", APP_ENV: "ci" }, PDF_SANDBOX_MODES.INSECURE_LOCAL, "explicit"],
    [{ [PDF_CHROMIUM_SANDBOX_ENV]: "disabled", NODE_ENV: "production" }, PDF_SANDBOX_MODES.INVALID, "explicit"],
    [{ [PDF_CHROMIUM_SANDBOX_ENV]: "pdf-disabled", NODE_ENV: "production" }, PDF_SANDBOX_MODES.PDF_DISABLED, "explicit"],
    [{ [PDF_CHROMIUM_SANDBOX_ENV]: "false" }, PDF_SANDBOX_MODES.INVALID, "explicit"],
    [{ [PDF_CHROMIUM_SANDBOX_ENV]: "0" }, PDF_SANDBOX_MODES.INVALID, "explicit"],
  ];
  for (const [env, mode, source] of cases) {
    const policy = resolvePdfChromiumSandboxPolicy(env);
    assert.equal(policy.mode, mode, JSON.stringify(env));
    assert.equal(policy.source, source, JSON.stringify(env));
  }
});

test("POLICY — mode sans sandbox refusé hors poste local explicite", () => {
  const refused = [
    [{}, "insecure_requires_local_node_env"],
    [{ NODE_ENV: "" }, "insecure_requires_local_node_env"],
    [{ NODE_ENV: "staging" }, "insecure_requires_local_node_env"],
    [{ NODE_ENV: "production" }, "insecure_requires_local_node_env"],
    [{ NODE_ENV: "production", APP_ENV: "preproduction" }, "insecure_requires_local_node_env"],
    [{ NODE_ENV: "development", APP_ENV: "preproduction" }, "insecure_forbidden_app_env"],
    [{ NODE_ENV: "test", APP_ENV: "production" }, "insecure_forbidden_app_env"],
    [{ NODE_ENV: "development", APP_ENV: "demo" }, "insecure_forbidden_app_env"],
    [{ NODE_ENV: "development", APP_ENV: "inconnu" }, "insecure_forbidden_app_env"],
    [{ NODE_ENV: "development", RENDER: "true" }, "insecure_forbidden_on_render"],
    [{ NODE_ENV: "test", APP_ENV: "local", RENDER: "true" }, "insecure_forbidden_on_render"],
  ];
  for (const [env, reason] of refused) {
    for (const value of ["disabled", "insecure-local"]) {
      const policy = resolvePdfChromiumSandboxPolicy({ ...env, [PDF_CHROMIUM_SANDBOX_ENV]: value });
      assert.equal(policy.mode, PDF_SANDBOX_MODES.INVALID, `${value} ${JSON.stringify(env)}`);
      assert.equal(policy.reason, reason, `${value} ${JSON.stringify(env)}`);
      assert.throws(
        () => renderer.buildChromiumLaunchOptions({ ...env, [PDF_CHROMIUM_SANDBOX_ENV]: value }),
        (error) => assertUnavailable(error),
      );
    }
  }
});

test("PDF2-04 — configuration absente en production : sandbox exigée, jamais désactivée", () => {
  const options = renderer.buildChromiumLaunchOptions({ NODE_ENV: "production" });
  assert.equal(options.args.includes("--no-sandbox"), false);
  assert.equal(options.args.includes("--disable-setuid-sandbox"), false);
  assert.ok(options.args.includes("--host-resolver-rules=MAP * ~NOTFOUND"), "isolation réseau SEC-PDF-01 conservée");
  assert.ok(options.args.includes("--no-proxy-server"));
});

test("PDF2-05 — configuration invalide ou interdite : refus contrôlé", async () => {
  for (const env of [
    { [PDF_CHROMIUM_SANDBOX_ENV]: "yes" },
    { [PDF_CHROMIUM_SANDBOX_ENV]: "disabled", NODE_ENV: "production" },
    { [PDF_CHROMIUM_SANDBOX_ENV]: "pdf-disabled" },
  ]) {
    assert.throws(() => renderer.buildChromiumLaunchOptions(env), (error) => assertUnavailable(error));
  }
  const spy = silenceConsoleError();
  try {
    await withEnv({ [PDF_CHROMIUM_SANDBOX_ENV]: "disabled", NODE_ENV: "production" }, async () => {
      await assert.rejects(
        () => renderer.renderReportCardPdf(report(), SCHOOL),
        (error) => assertUnavailable(error, "sandbox_config_insecure_requires_local_node_env"),
      );
    });
    await withEnv({ [PDF_CHROMIUM_SANDBOX_ENV]: "pdf-disabled" }, async () => {
      await assert.rejects(() => renderer.renderReportCardPdf(report(), SCHOOL), (error) => assertUnavailable(error, "pdf_disabled"));
    });
  } finally {
    spy.restore();
  }
  assert.ok(spy.lines.some((line) => line.includes("[SEC-PDF-02]") && line.includes("insecure_requires_local_node_env")));
});

test("PDF2-06 — sandbox exigée mais indisponible : un seul essai, aucun repli --no-sandbox", { timeout: 60000 }, async () => {
  // Faux Chromium : consigne ses arguments puis échoue, comme un binaire dont
  // la sandbox ne peut pas démarrer.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-pdf-02-fake-chrome-"));
  const argsLog = path.join(dir, "args.log");
  const fakeChrome = path.join(dir, "chrome");
  fs.writeFileSync(
    fakeChrome,
    `#!/bin/sh\nprintf '%s\\n' "--- launch ---" "$@" >> "${argsLog}"\necho "No usable sandbox! ${dir}/chrome-sandbox is not configured" >&2\nexit 1\n`,
    { mode: 0o755 },
  );
  const spy = silenceConsoleError();
  try {
    await withEnv(
      { [PDF_CHROMIUM_SANDBOX_ENV]: undefined, NODE_ENV: "production", PUPPETEER_EXECUTABLE_PATH: fakeChrome },
      async () => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await assert.rejects(
            () => renderer.renderReportCardPdf(report(), SCHOOL),
            (error) => assertUnavailable(error, "chromium_launch_failed_sandbox_required"),
          );
        }
      },
    );
    const launches = fs.readFileSync(argsLog, "utf8").split("--- launch ---").filter((chunk) => chunk.trim());
    assert.equal(launches.length, 2, "un seul lancement par demande, aucune relance interne");
    for (const args of launches) {
      assert.doesNotMatch(args, /--no-sandbox/);
      assert.doesNotMatch(args, /--disable-setuid-sandbox/);
      assert.match(args, /--host-resolver-rules=MAP \* ~NOTFOUND/);
    }
  } finally {
    spy.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const log = spy.lines.join("\n");
  assert.match(log, /\[SEC-PDF-02\] Génération PDF indisponible \(chromium_launch_failed_sandbox_required\)/);
  assert.equal(log.includes(dir), false, "chemin absolu masqué dans le journal");
});

test("PDF2-09 — binaire Chromium absent : erreur contrôlée, sans chemin", async () => {
  const spy = silenceConsoleError();
  try {
    await withEnv(
      { [PDF_CHROMIUM_SANDBOX_ENV]: "disabled", NODE_ENV: "test", APP_ENV: undefined, RENDER: undefined, PUPPETEER_EXECUTABLE_PATH: "/nonexistent/sec-pdf-02/chrome" },
      async () => {
        await assert.rejects(
          () => renderer.renderReportCardPdf(report(), SCHOOL),
          (error) => assertUnavailable(error, "chromium_launch_failed"),
        );
      },
    );
  } finally {
    spy.restore();
  }
  assert.doesNotMatch(spy.lines.join("\n"), /sec-pdf-02\/chrome/);
});

test("PDF2-08 — répertoire temporaire inutilisable : erreur contrôlée", async () => {
  const notADirectory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sec-pdf-02-")), "fichier");
  fs.writeFileSync(notADirectory, "pas un répertoire");
  const spy = silenceConsoleError();
  try {
    await withEnv({ TMPDIR: notADirectory, TMP: notADirectory, TEMP: notADirectory }, async () => {
      await assert.rejects(() => renderer.renderReportCardPdf(report(), SCHOOL), (error) => assertUnavailable(error));
    });
  } finally {
    spy.restore();
    fs.rmSync(path.dirname(notADirectory), { recursive: true, force: true });
  }
});

test("PDF2-16 — erreur PDF côté HTTP : uniquement message générique et code", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const handler = src.slice(src.lastIndexOf("app.use((error, _req, res, _next) => {"));
  assert.match(handler, /if \(error\.statusCode\) \{/);
  assert.match(handler, /message: error\.message,/);
  let error = null;
  try {
    renderer.buildChromiumLaunchOptions({ [PDF_CHROMIUM_SANDBOX_ENV]: "pdf-disabled" });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "refus attendu");
  const body = JSON.parse(JSON.stringify({ message: error.message, code: error.code }));
  assert.deepEqual(body, {
    message: "La génération des bulletins PDF est temporairement indisponible.",
    code: "BULLETIN_PDF_UNAVAILABLE",
  });
  assert.equal(JSON.stringify(error).includes("reason"), false);
});

// --- Rendus réels (politique de l'environnement courant) --------------------

test("PDF2-17 — mode local explicite (`disabled`) hors production : rendu conforme", { timeout: 60000 }, async () => {
  await withEnv({ [PDF_CHROMIUM_SANDBOX_ENV]: "disabled", NODE_ENV: "test", APP_ENV: undefined, RENDER: undefined }, async () => {
    assertPdf(await renderer.renderReportCardPdf(report(), SCHOOL));
  });
});

test("PDF2-10 — Chromium interrompu brutalement : échec maîtrisé puis récupération", { timeout: 90000 }, async () => {
  await withEnv({}, async () => {
    assertPdf(await renderer.renderReportCardPdf(report(), SCHOOL));
    const browser = await renderer.getBrowser();
    const child = browser.process();
    assert.ok(child && child.pid, "processus Chromium identifié");
    const disconnected = new Promise((resolve) => browser.once("disconnected", resolve));
    process.kill(child.pid, "SIGKILL");
    await disconnected;
    // La demande suivante relance Chromium avec la même politique.
    assertPdf(await renderer.renderReportCardPdf(report({ id: "REP-AFTER-KILL" }), SCHOOL));
    const relaunched = await renderer.getBrowser();
    assert.notEqual(relaunched.process().pid, child.pid);
  });
});

test("PDF2-18 — arrêt puis redémarrage du moteur : comportement identique", { timeout: 90000 }, async () => {
  await withEnv({}, async () => {
    const first = await renderer.renderReportCardPdf(report(), SCHOOL);
    await renderer.closeBrowser();
    const second = await renderer.renderReportCardPdf(report(), SCHOOL);
    assertPdf(first);
    assertPdf(second);
    const firstArgs = (await renderer.getBrowser()).process().spawnargs;
    assert.equal(firstArgs.includes("--host-resolver-rules=MAP * ~NOTFOUND"), true);
  });
});
