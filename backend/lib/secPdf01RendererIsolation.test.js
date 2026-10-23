"use strict";

/**
 * SEC-PDF-01 — isolation du moteur PDF historique (bulletinPdfRenderer).
 *
 * Les scénarios réseau utilisent uniquement des serveurs HTTP fictifs locaux,
 * lancés par ce test, qui comptent les requêtes reçues. Aucune requête n'est
 * adressée à un service interne réel ni à un service de métadonnées cloud :
 * ces URL ne sont rendues qu'à travers le moteur protégé, dont la règle
 * processus est vérifiée avant chaque rendu.
 *
 * Chromium : PUPPETEER_EXECUTABLE_PATH si défini, sinon le Chrome de Puppeteer.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const puppeteer = require("puppeteer");
const QRCode = require("qrcode");

const renderer = require("../services/bulletinPdfRenderer");
const { saveSchoolLogo } = require("./schoolLogo");

const FONT_PATH = path.join(__dirname, "..", "templates", "reportCard", "fonts", "LiberationSans-Regular.ttf");
const RENDERER_SRC = path.join(__dirname, "..", "services", "bulletinPdfRenderer.js");

test.after(async () => {
  await renderer.closeBrowser();
});

// --- Outils ---------------------------------------------------------------

async function startProbeServer(host) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    res.setHeader("Content-Type", req.url.includes("css") ? "text/css" : "text/plain");
    res.end(req.url.includes("css") ? "body{color:red}" : "probe");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const { port } = server.address();
  return {
    hits,
    port,
    origin: `http://${host}:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function isPrivateIpv4(address) {
  return /^10\./.test(address) || /^192\.168\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

/** Adresse IPv4 non-loopback de la machine (privée RFC 1918 de préférence). */
function localInterfaceIpv4() {
  const candidates = Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
  return candidates.find(isPrivateIpv4) || candidates[0] || null;
}

/** Toutes les manières de charger une ressource sans JavaScript. */
function resourceVectors(origin, tag) {
  return `
    <link rel="stylesheet" href="${origin}/${tag}-link.css">
    <link rel="prefetch" href="${origin}/${tag}-prefetch">
    <link rel="preload" as="image" href="${origin}/${tag}-preload.png">
    <link rel="icon" href="${origin}/${tag}-icon.png">
    <style>
      @import url("${origin}/${tag}-import.css");
      @font-face { font-family: Probe; src: url("${origin}/${tag}-font.woff"); }
      body { font-family: Probe; background-image: url("${origin}/${tag}-bg.png"); }
    </style>
    <img src="${origin}/${tag}-img.png">
    <img srcset="${origin}/${tag}-srcset.png 1x">
    <picture><source srcset="${origin}/${tag}-picture.png"><img alt=""></picture>
    <iframe src="${origin}/${tag}-iframe"></iframe>
    <object data="${origin}/${tag}-object"></object>
    <embed src="${origin}/${tag}-embed">
    <video poster="${origin}/${tag}-poster.png"></video>
    <svg><image href="${origin}/${tag}-svg.png" width="1" height="1"/></svg>
    <script src="${origin}/${tag}-script.js"></script>`;
}

function htmlDocument(head, body = "") {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>SEC-PDF-01</title>${head}</head><body><p>Bulletin</p>${body}</body></html>`;
}

function assertPdf(buffer) {
  assert.ok(Buffer.isBuffer(buffer), "PDF Buffer attendu");
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "%PDF");
  assert.ok(buffer.length > 500, "PDF non vide");
}

/** Titre du document tel qu'écrit par Chromium dans le dictionnaire Info. */
function pdfTitle(buffer) {
  const text = buffer.toString("latin1");
  const literal = text.match(/\/Title\s*\(((?:\\.|[^\\)])*)\)/);
  if (literal) return literal[1].replace(/\\(.)/g, "$1");
  const hex = text.match(/\/Title\s*<([0-9A-Fa-f]+)>/);
  if (!hex) return "";
  const bytes = Buffer.from(hex[1], "hex");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const body = bytes.subarray(2);
    let out = "";
    for (let i = 0; i + 1 < body.length; i += 2) out += String.fromCharCode((body[i] << 8) | body[i + 1]);
    return out;
  }
  return bytes.toString("latin1");
}

function countImages(buffer) {
  return (buffer.toString("latin1").match(/\/Subtype\s*\/Image/g) || []).length;
}

function assertProcessLevelIsolation() {
  const { args } = renderer.buildChromiumLaunchOptions();
  assert.ok(
    args.includes("--host-resolver-rules=MAP * ~NOTFOUND"),
    "règle processus absente : rendu interdit (aucune requête réseau ne doit partir)",
  );
}

async function renderIsolated(html) {
  assertProcessLevelIsolation();
  const blocked = [];
  const pdf = await renderer.renderHtmlToPdf(html, { onBlockedRequest: (url) => blocked.push(url) });
  return { pdf, blocked };
}

function baseReport(overrides = {}) {
  return {
    id: "REP-SEC-PDF-01",
    period: "Trimestre 1",
    status: "Publié",
    generatedAt: "2026-10-23T00:00:00.000Z",
    student: { name: "Amina Test", matricule: "EL-0001", className: "6e A" },
    subjects: [
      { subject: "Mathématiques", average: 14.5, coefficient: 4 },
      { subject: "Français", average: 12, coefficient: 3 },
    ],
    average: 13.4,
    rankLabel: "3e / 30",
    appreciation: "Bon trimestre",
    ...overrides,
  };
}

const SCHOOL = { id: "school-sec-pdf-01", code: "SCH-SECPDF", name: "École Test SEC-PDF-01" };

// --- Contrôles du banc de test ---------------------------------------------

test("HARNESS — le serveur fictif reçoit bien les requêtes d'un Chromium non protégé", { timeout: 60000 }, async () => {
  const probe = await startProbeServer("127.0.0.1");
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-background-networking", "--disable-component-update"],
    });
    const page = await browser.newPage();
    await page.setContent(htmlDocument("", `<img src="${probe.origin}/control.png">`), { waitUntil: "load" });
  } finally {
    if (browser) await browser.close();
    await probe.close();
  }
  assert.ok(probe.hits.includes("/control.png"), "le banc doit détecter une requête réelle");
});

test("LAYER-PROCESS — options Chromium du moteur : aucun hôte joignable même sans interception ni blocage JS", { timeout: 60000 }, async () => {
  const loopback = await startProbeServer("127.0.0.1");
  const ifaceAddress = localInterfaceIpv4();
  const iface = ifaceAddress ? await startProbeServer(ifaceAddress) : null;
  let browser = null;
  try {
    browser = await puppeteer.launch(renderer.buildChromiumLaunchOptions());
    const page = await browser.newPage();
    const body = [
      resourceVectors(loopback.origin, "loop"),
      resourceVectors(`http://localhost:${loopback.port}`, "localhost"),
      resourceVectors(`http://0.0.0.0:${loopback.port}`, "zero"),
      iface ? resourceVectors(iface.origin, "iface") : "",
      `<script>fetch("${loopback.origin}/js-fetch").catch(()=>{});</script>`,
    ].join("\n");
    await page.setContent(htmlDocument("", body), { waitUntil: "load", timeout: 20000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
  } finally {
    if (browser) await browser.close();
    await loopback.close();
    if (iface) await iface.close();
  }
  assert.deepEqual(loopback.hits, [], "aucune requête loopback");
  if (iface) assert.deepEqual(iface.hits, [], `aucune requête vers ${ifaceAddress}`);
});

test("LAYER-PROXY — un proxy hérité de l'environnement (HTTP(S)_PROXY) ne relaie aucune requête", { timeout: 60000 }, async () => {
  const proxyHits = [];
  const proxy = http.createServer((req, res) => {
    proxyHits.push(`${req.method} ${req.url}`);
    res.end("proxied");
  });
  proxy.on("connect", (req, socket) => {
    proxyHits.push(`CONNECT ${req.url}`);
    socket.end();
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  const env = {
    ...process.env,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    no_proxy: "",
    NO_PROXY: "",
  };
  let browser = null;
  try {
    browser = await puppeteer.launch({ ...renderer.buildChromiumLaunchOptions(), env });
    const page = await browser.newPage();
    const body = [
      resourceVectors("http://external.sec-pdf-01.invalid", "proxy-http"),
      resourceVectors("https://external.sec-pdf-01.invalid", "proxy-https"),
    ].join("\n");
    await page.setContent(htmlDocument("", body), { waitUntil: "load", timeout: 20000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => proxy.close(resolve));
  }
  assert.deepEqual(proxyHits, [], "aucune requête relayée par le proxy");
  assert.ok(renderer.buildChromiumLaunchOptions().args.includes("--no-proxy-server"));
});

test("LAYER-CONFIG — JS désactivé, hors ligne, interception, contexte dédié, plus de networkidle0", () => {
  const src = fs.readFileSync(RENDERER_SRC, "utf8");
  assert.match(src, /setJavaScriptEnabled\(false\)/);
  assert.match(src, /emulateNetworkConditions\(\{ offline: true/);
  assert.match(src, /setRequestInterception\(true\)/);
  assert.match(src, /createBrowserContext\(\)/);
  assert.doesNotMatch(src, /networkidle/);
  assert.equal(renderer.isInlineResourceUrl("data:image/png;base64,AAAA"), true);
  assert.equal(renderer.isInlineResourceUrl("about:blank"), true);
  for (const url of ["http://x", "https://x", "file:///etc/hosts", "ws://x", "ftp://x", "blob:null/x", "chrome://version", ""]) {
    assert.equal(renderer.isInlineResourceUrl(url), false, url);
  }
});

test("SANDBOX — désactivée par défaut (image root), réactivable explicitement", () => {
  const defaults = renderer.buildChromiumLaunchOptions({});
  assert.ok(defaults.args.includes("--no-sandbox"));
  const sandboxed = renderer.buildChromiumLaunchOptions({ SOMAFRIK_PDF_CHROMIUM_SANDBOX: "enabled" });
  assert.equal(sandboxed.args.includes("--no-sandbox"), false);
  assert.equal(sandboxed.args.includes("--disable-setuid-sandbox"), false);
  assert.ok(sandboxed.args.includes("--host-resolver-rules=MAP * ~NOTFOUND"));
  const pinned = renderer.buildChromiumLaunchOptions({ PUPPETEER_EXECUTABLE_PATH: "/usr/bin/chromium" });
  assert.equal(pinned.executablePath, "/usr/bin/chromium");
});

// --- Scénarios PDF-01 à PDF-12 ----------------------------------------------

test("PDF-01 — bulletin légitime sans ressource distante : PDF généré", { timeout: 60000 }, async () => {
  const html = await renderer.renderReportCardPreviewHtml(baseReport(), SCHOOL);
  const { pdf, blocked } = await renderIsolated(html);
  assertPdf(pdf);
  assert.deepEqual(blocked, [], "le modèle par défaut ne demande aucune ressource externe");
  assert.match(pdfTitle(pdf), /Amina Test/);
  assert.ok(countImages(pdf) >= 1, "QR code incorporé");

  const viaPublicApi = await renderer.renderReportCardPdf(baseReport(), SCHOOL);
  assertPdf(viaPublicApi);
});

test("PDF-02 — JavaScript incorporé, distant ou en attribut : non exécuté", { timeout: 60000 }, async () => {
  const probe = await startProbeServer("127.0.0.1");
  try {
    const body = `
      <script>document.title = "JS_EXECUTED_INLINE";</script>
      <script src="${probe.origin}/remote.js"></script>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onerror="document.title='JS_EXECUTED_ONERROR'" onload="document.title='JS_EXECUTED_ONLOAD'">
      <svg onload="document.title='JS_EXECUTED_SVG'"></svg>
      <iframe srcdoc="<script>parent.document.title='JS_EXECUTED_SRCDOC'</script>"></iframe>
      <a href="javascript:document.title='JS_EXECUTED_HREF'">x</a>`;
    const { pdf } = await renderIsolated(htmlDocument("", body));
    assertPdf(pdf);
    assert.equal(pdfTitle(pdf), "SEC-PDF-01", "le titre initial ne doit pas avoir été modifié par un script");
    assert.deepEqual(probe.hits, []);
  } finally {
    await probe.close();
  }
});

test("PDF-03 — images HTTP/HTTPS externes : aucune requête", { timeout: 60000 }, async () => {
  const probe = await startProbeServer("127.0.0.1");
  try {
    const body = `${resourceVectors(probe.origin, "ext")}
      <img src="https://cdn.sec-pdf-01.invalid/logo.png">
      <img src="http://images.sec-pdf-01.invalid/a.png">`;
    const { pdf, blocked } = await renderIsolated(htmlDocument("", body));
    assertPdf(pdf);
    assert.deepEqual(probe.hits, []);
    assert.ok(blocked.some((url) => url.startsWith("https://cdn.sec-pdf-01.invalid/")), "requête HTTPS bloquée par le client");
    assert.ok(blocked.some((url) => url === `${probe.origin}/ext-img.png`), "requête HTTP bloquée par le client");
  } finally {
    await probe.close();
  }
});

test("PDF-04 — CSS distant (link, @import, font, background) : aucune requête", { timeout: 60000 }, async () => {
  const probe = await startProbeServer("127.0.0.1");
  try {
    const css = `@import url("${probe.origin}/tpl-import.css");
      @font-face { font-family: Remote; src: url("${probe.origin}/tpl-font.woff2"); }
      .x { background: url("${probe.origin}/tpl-bg.png"); font-family: Remote; }`;
    const report = baseReport({
      design: {
        htmlTemplate: `<link rel="stylesheet" href="${probe.origin}/tpl-link.css"><div class="x">{{STUDENT_NAME}}</div>`,
        cssTemplate: css,
        showQrCode: false,
      },
    });
    const html = await renderer.renderReportCardPreviewHtml(report, SCHOOL);
    const { pdf, blocked } = await renderIsolated(html);
    assertPdf(pdf);
    assert.deepEqual(probe.hits, []);
    assert.ok(blocked.includes(`${probe.origin}/tpl-link.css`), "feuille de style distante bloquée");
    assert.ok(blocked.includes(`${probe.origin}/tpl-import.css`), "@import bloqué");

    const viaPublicApi = await renderer.renderReportCardPdf(report, SCHOOL);
    assertPdf(viaPublicApi);
    assert.deepEqual(probe.hits, [], "chemin réel renderReportCardPdf");
  } finally {
    await probe.close();
  }
});

test("PDF-05 — ressources loopback (127.0.0.1, localhost, 0.0.0.0, variantes) : aucun accès", { timeout: 60000 }, async () => {
  const probe = await startProbeServer("127.0.0.1");
  try {
    const hosts = ["127.0.0.1", "localhost", "localhost.", "0.0.0.0", "127.1", "2130706433", "0x7f000001", "[::1]", "[::ffff:127.0.0.1]"];
    const body = hosts
      .map((host) => resourceVectors(`http://${host}:${probe.port}`, `lb-${hosts.indexOf(host)}`))
      .join("\n");
    const { pdf } = await renderIsolated(htmlDocument("", body));
    assertPdf(pdf);
    assert.deepEqual(probe.hits, []);
  } finally {
    await probe.close();
  }
});

test("PDF-06 — ressources réseau privé : aucun accès", { timeout: 60000 }, async (t) => {
  const address = localInterfaceIpv4();
  const probe = address ? await startProbeServer(address) : null;
  try {
    const privateLiterals = ["10.0.0.1", "172.16.0.1", "192.168.1.1", "100.64.0.1"];
    const body = [
      probe ? resourceVectors(probe.origin, "iface") : "",
      ...privateLiterals.map((ip) => `<img src="http://${ip}/p.png"><link rel="prefetch" href="http://${ip}/prefetch">`),
    ].join("\n");
    const { pdf, blocked } = await renderIsolated(htmlDocument("", body));
    assertPdf(pdf);
    for (const ip of privateLiterals) {
      assert.ok(blocked.some((url) => url.startsWith(`http://${ip}/`)), `requête vers ${ip} bloquée par le client`);
    }
    if (probe) {
      assert.deepEqual(probe.hits, [], `aucune requête vers l'interface ${address}`);
      t.diagnostic(`serveur fictif sur ${address} (${isPrivateIpv4(address) ? "RFC 1918" : "non-loopback"})`);
    } else {
      t.diagnostic("aucune interface IPv4 non-loopback : seules les adresses littérales sont vérifiées");
    }
  } finally {
    if (probe) await probe.close();
  }
});

test("PDF-07 — services de métadonnées cloud : aucun accès", { timeout: 60000 }, async () => {
  const probe = await startProbeServer("127.0.0.1");
  try {
    const targets = [
      "http://169.254.169.254/latest/meta-data/",
      "http://169.254.169.254/metadata/instance?api-version=2021-02-01",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://[fd00:ec2::254]/latest/meta-data/",
      "http://100.100.100.200/latest/meta-data/",
    ];
    const body = targets
      .map((url) => `<img src="${url}"><link rel="stylesheet" href="${url}"><link rel="prefetch" href="${url}"><iframe src="${url}"></iframe>`)
      .join("\n");
    const { pdf, blocked } = await renderIsolated(htmlDocument("", `${body}<img src="${probe.origin}/after-metadata.png">`));
    assertPdf(pdf);
    for (const url of targets) {
      assert.ok(blocked.includes(url), `${url} bloquée par le client`);
    }
    assert.deepEqual(probe.hits, []);
  } finally {
    await probe.close();
  }
});

test("PDF-08 — URI file: arbitraires : aucun accès", { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-pdf-01-file-"));
  const secret = path.join(dir, "secret.png");
  const cssFile = path.join(dir, "secret.css");
  // Largeur inhabituelle : si le fichier était lu, "/Width 157" apparaîtrait dans le PDF.
  fs.writeFileSync(secret, await QRCode.toBuffer("file-probe", { width: 157, margin: 0 }));
  fs.writeFileSync(cssFile, `body{background:url("file://${secret}")}`);
  try {
    const body = `
      <img src="file://${secret}">
      <img src="file:///etc/passwd">
      <link rel="stylesheet" href="file://${cssFile}">
      <div style="width:200px;height:200px;background:url('file://${secret}')"></div>
      <iframe src="file:///etc/hosts"></iframe>
      <object data="file:///proc/self/environ"></object>`;
    const { pdf } = await renderIsolated(htmlDocument("", body));
    const { pdf: control } = await renderIsolated(
      htmlDocument("", `<img src="http://blocked.sec-pdf-01.invalid/a.png"><img src="http://blocked.sec-pdf-01.invalid/b.png">`),
    );
    assertPdf(pdf);
    assert.doesNotMatch(pdf.toString("latin1"), /\/Width\s+157\b/, "image locale non incorporée");
    assert.equal(countImages(pdf), countImages(control), "seules les icônes d'image absente sont présentes");
    assert.doesNotMatch(pdf.toString("latin1"), /root:x:0:0/, "contenu /etc/passwd absent");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PDF-09 — logo local autorisé : incorporé ; contenu non image : ignoré", { timeout: 60000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sec-pdf-01-logo-"));
  const previous = process.env.SOMAFRIK_COMMUNICATION_STORAGE;
  process.env.SOMAFRIK_COMMUNICATION_STORAGE = root;
  try {
    const png = await QRCode.toBuffer("logo-sec-pdf-01", { width: 120 });
    const saved = await saveSchoolLogo({ school: SCHOOL, buffer: png, fileName: "logo.png", mimeType: "image/png" });
    const school = {
      ...SCHOOL,
      logoUrl: saved.storageKey,
      logoSource: "school_upload",
      logoUploadedAt: "2026-10-23T00:00:00.000Z",
    };
    const report = baseReport({ design: { showQrCode: false } });

    const withoutLogo = await renderer.renderReportCardPdf(report, SCHOOL);
    assert.equal(countImages(withoutLogo), 0);

    const html = await renderer.renderReportCardPreviewHtml(report, school);
    assert.match(html, /<img src="data:image\/png;base64,/);
    assert.doesNotMatch(html, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "aucun chemin serveur dans le document");
    const { pdf, blocked } = await renderIsolated(html);
    assertPdf(pdf);
    assert.deepEqual(blocked, []);
    assert.equal(countImages(pdf), 1, "logo incorporé");

    // Fichier falsifié (HTML sous extension .png) : non incorporé.
    fs.writeFileSync(path.join(root, ...saved.storageKey.split("/")), "<svg xmlns='http://www.w3.org/2000/svg'><image href='http://127.0.0.1:1/x'/></svg>");
    const forgedHtml = await renderer.renderReportCardPreviewHtml(report, school);
    assert.doesNotMatch(forgedHtml, /data:image/);
    assert.doesNotMatch(forgedHtml, /<svg/);
  } finally {
    if (previous === undefined) delete process.env.SOMAFRIK_COMMUNICATION_STORAGE;
    else process.env.SOMAFRIK_COMMUNICATION_STORAGE = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("PDF-10 — police embarquée en data: : rendu correct", { timeout: 60000 }, async () => {
  const font = fs.readFileSync(FONT_PATH).toString("base64");
  const template = (fontFace) =>
    baseReport({
      design: {
        htmlTemplate: `<h1 class="emb">{{STUDENT_NAME}}</h1><p class="emb">{{SCHOOL_NAME}}</p>`,
        cssTemplate: `${fontFace}.emb { font-family: "EmbeddedSecPdf", monospace; }`,
        showQrCode: false,
      },
    });
  const withFont = await renderer.renderReportCardPdf(
    template(`@font-face { font-family: "EmbeddedSecPdf"; src: url("data:font/ttf;base64,${font}") format("truetype"); }`),
    SCHOOL,
  );
  const control = await renderer.renderReportCardPdf(template(""), SCHOOL);
  assertPdf(withFont);
  assert.match(withFont.toString("latin1"), /\/FontName\s*\/[A-Z]{6}\+LiberationSans\b/, "police incorporée dans le PDF");
  assert.doesNotMatch(control.toString("latin1"), /\/FontName\s*\/[A-Z]{6}\+LiberationSans\b/, "témoin sans @font-face");
});

test("PDF-11 — valeurs malformées : échec contrôlé, sans détail serveur", { timeout: 60000 }, async () => {
  const cases = [
    [null, SCHOOL],
    ["rapport", SCHOOL],
    [baseReport(), null],
    [baseReport({ design: "html" }), SCHOOL],
    [baseReport({ design: [] }), SCHOOL],
    [baseReport({ design: { htmlTemplate: { toString: () => "<p>x</p>" } } }), SCHOOL],
    [baseReport({ design: { htmlTemplate: ["<p>"] } }), SCHOOL],
    [baseReport({ design: { htmlTemplate: "<p>x</p>", cssTemplate: 42 } }), SCHOOL],
    [baseReport({ design: { htmlTemplate: `<p>${"x".repeat(2 * 1024 * 1024)}</p>` } }), SCHOOL],
    [baseReport({ design: { htmlTemplate: "<p>x</p>", cssTemplate: "a".repeat(2 * 1024 * 1024 + 1) } }), SCHOOL],
  ];
  for (const [report, school] of cases) {
    await assert.rejects(
      () => renderer.renderReportCardPdf(report, school),
      (error) => {
        assert.equal(error.statusCode, 422);
        assert.equal(error.code, "BULLETIN_PDF_INVALID_INPUT");
        assert.equal(error.message, "Modèle de bulletin invalide.");
        return true;
      },
    );
  }
  for (const html of [undefined, "", "   ", 12, "x".repeat(16 * 1024 * 1024 + 1)]) {
    await assert.rejects(() => renderer.renderHtmlToPdf(html), (error) => error.code === "BULLETIN_PDF_INVALID_INPUT");
  }

  // Valeurs métier malformées mais typées : rendu sans plantage ni injection.
  const odd = await renderer.renderReportCardPdf(
    baseReport({
      generatedAt: "pas-une-date",
      average: "NaN",
      subjects: [{ subject: "<img src=http://127.0.0.1:1/x>", average: null, coefficient: "<b>" }],
      student: { name: "<script>document.title='X'</script>", matricule: null },
    }),
    SCHOOL,
  );
  assertPdf(odd);

  // Échec du moteur : erreur générique, cause interne non sérialisée.
  const failure = new renderer.PdfRenderError(500, "La génération du bulletin PDF a échoué.", "BULLETIN_PDF_RENDER_FAILED");
  assert.deepEqual(Object.keys(failure).sort(), ["code", "name", "statusCode"].sort());
});

test("PDF-12 — génération concurrente : isolation conservée", { timeout: 90000 }, async () => {
  const probe = await startProbeServer("127.0.0.1");
  try {
    const names = Array.from({ length: 6 }, (_, index) => `Élève Concurrent ${index + 1}`);
    const jobs = names.map((name, index) => {
      const hostile = index % 2 === 1;
      const report = baseReport({
        id: `REP-CONC-${index + 1}`,
        student: { name, matricule: `EL-C${index + 1}`, className: "6e" },
        design: hostile
          ? {
              htmlTemplate: `<!DOCTYPE html><html><head><title>Bulletin scolaire — {{STUDENT_NAME}}</title></head><body>${resourceVectors(probe.origin, `conc-${index}`)}<p>{{STUDENT_NAME}}</p></body></html>`,
              cssTemplate: "",
            }
          : undefined,
      });
      return renderer.renderReportCardPdf(report, SCHOOL);
    });
    const pdfs = await Promise.all(jobs);
    pdfs.forEach((pdf, index) => {
      assertPdf(pdf);
      assert.equal(pdfTitle(pdf), `Bulletin scolaire — ${names[index]}`, `document ${index + 1} non mélangé`);
    });
    assert.deepEqual(probe.hits, []);

    // Après une série concurrente, le moteur reste disponible.
    assertPdf(await renderer.renderReportCardPdf(baseReport(), SCHOOL));
  } finally {
    await probe.close();
  }
});
