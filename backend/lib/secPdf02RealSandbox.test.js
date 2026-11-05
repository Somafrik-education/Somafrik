"use strict";

/**
 * SEC-PDF-02 — preuve de sandbox Chromium réelle (environnement non-root avec
 * espaces de noms utilisateur). Échoue, sans être ignoré, si l'environnement ne
 * permet pas la sandbox : un PASS ici prouve une sandbox active.
 *
 * Preuves : page interne chrome://sandbox (espaces de noms, seccomp-BPF),
 * arguments réels du processus Chromium, identité Unix des processus, rendu de
 * bulletins fictifs. Aucun test d'évasion.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const puppeteer = require("puppeteer");

const renderer = require("../services/bulletinPdfRenderer");
const { buildDesignPreviewReport } = require("./bulletinDesignPreview");
const { PDF_SANDBOX_MODES, resolvePdfChromiumSandboxPolicy } = require("./pdfChromiumSandboxPolicy");

const SCHOOL = { id: "school-sec-pdf-02", code: "SCH-SECPDF2", name: "École Test SEC-PDF-02" };

function procUid(pid) {
  const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
  return Number(/^Uid:\s+(\d+)/m.exec(status)[1]);
}

test.after(async () => {
  await renderer.closeBrowser();
});

test("PRÉREQUIS — processus non-root et politique « sandbox exigée »", () => {
  assert.notEqual(process.getuid(), 0, "exécuter cette suite avec un utilisateur non-root");
  assert.equal(resolvePdfChromiumSandboxPolicy().mode, PDF_SANDBOX_MODES.REQUIRED);
});

test("PDF2-01 — Chromium démarre avec la sandbox (chrome://sandbox)", { timeout: 60000 }, async () => {
  const browser = await puppeteer.launch(renderer.buildChromiumLaunchOptions());
  try {
    const spawnargs = browser.process().spawnargs;
    assert.equal(spawnargs.includes("--no-sandbox"), false);
    assert.equal(spawnargs.includes("--disable-setuid-sandbox"), false);
    const page = await browser.newPage();
    await page.goto("chrome://sandbox", { waitUntil: "load" });
    const status = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
    test.diagnostic?.(status);
    assert.match(status, /Layer 1 Sandbox Namespace/);
    assert.match(status, /PID namespaces Yes/);
    assert.match(status, /Network namespaces Yes/);
    assert.match(status, /Seccomp-BPF sandbox Yes/);
    assert.match(status, /You are adequately sandboxed/);
    console.log(`[SEC-PDF-02] ${await browser.version()} — ${status.slice(0, 260)}`);
  } finally {
    await browser.close();
  }
});

test("PDF2-02 / PDF2-07 — bulletin légitime généré par le moteur sandboxé, processus non-root", { timeout: 60000 }, async () => {
  const pdf = await renderer.renderReportCardPdf(
    {
      id: "REP-SBX",
      period: "Trimestre 1",
      status: "Publié",
      generatedAt: "2026-10-24T00:00:00.000Z",
      student: { name: "Élève Fictif", matricule: "EL-SBX", className: "6e" },
      subjects: [{ subject: "Mathématiques", average: 14, coefficient: 4 }],
      average: 14,
    },
    SCHOOL,
  );
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  const browser = await renderer.getBrowser();
  const child = browser.process();
  assert.equal(child.spawnargs.includes("--no-sandbox"), false, "moteur réel lancé sans --no-sandbox");
  assert.notEqual(procUid(child.pid), 0, "processus Chromium non-root");
});

test("PDF2-03 — aperçu PDF de conception (superadmin) généré sous sandbox", { timeout: 60000 }, async () => {
  const preview = buildDesignPreviewReport({
    school: SCHOOL,
    className: "6e",
    design: { reportTitle: "Aperçu SEC-PDF-02", showQrCode: true },
  });
  const pdf = await renderer.renderReportCardPdf(preview, SCHOOL);
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  assert.ok(pdf.length > 1000);
});
