const puppeteer = require("puppeteer");
const QRCode = require("qrcode");
const { buildVerificationPayload, renderReportCardHtml } = require("../lib/bulletinTemplate");
const { resolveSchoolLogoPath } = require("../lib/schoolLogo");
const { PDF_SANDBOX_MODES, resolvePdfChromiumSandboxPolicy } = require("../lib/pdfChromiumSandboxPolicy");

/**
 * SEC-PDF-01 — moteur PDF historique des bulletins.
 *
 * Les modèles de bulletin (report_card_templates.layout.htmlTemplate / cssTemplate)
 * sont du HTML/CSS libre saisi par un compte établissement. Le rendu Chromium doit
 * donc être isolé du réseau et du système de fichiers :
 *
 * 1. Processus : aucune résolution DNS ni connexion vers un hôte, y compris les
 *    adresses IP littérales, loopback, privées et de métadonnées cloud
 *    (`--host-resolver-rules=MAP * ~NOTFOUND`), et aucun proxy hérité de
 *    l'environnement (`--no-proxy-server`). Couvre aussi prefetch/preload,
 *    iframes et objets, que l'interception par page ne voit pas toujours.
 * 2. Page : JavaScript du document désactivé, mode hors ligne, interception de
 *    toute requête autre que `data:` / `about:blank` (http, https, ws, file, ...).
 * 3. Contexte de navigation dédié par rendu (cache, cookies, stockage isolés).
 * 4. SEC-PDF-02 — sandbox Chromium exigée par défaut (voir
 *    `lib/pdfChromiumSandboxPolicy.js`). Si elle ne peut pas démarrer, la
 *    génération PDF échoue (503) : jamais de relance avec `--no-sandbox`.
 *
 * Les ressources légitimes (logo, QR code, polices) sont préparées par le serveur
 * et incorporées en `data:`. Une ressource externe n'est jamais téléchargée : elle
 * est ignorée (image absente, police système). Toute autre erreur fait échouer le
 * rendu avec un message générique, sans chemin serveur.
 */

const PDF_RENDER_TIMEOUT_MS = 20_000;
const MAX_TEMPLATE_HTML_CHARS = 2 * 1024 * 1024;
const MAX_TEMPLATE_CSS_CHARS = 2 * 1024 * 1024;
const MAX_DOCUMENT_CHARS = 16 * 1024 * 1024;

const BLOCK_ALL_HOSTS_RULE = "--host-resolver-rules=MAP * ~NOTFOUND";
const NETWORK_HARDENING_ARGS = Object.freeze([
  BLOCK_ALL_HOSTS_RULE,
  // Ignore tout proxy hérité de l'environnement (HTTP(S)_PROXY) : pas de relais sortant.
  "--no-proxy-server",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-domain-reliability",
  "--disable-sync",
  "--disable-default-apps",
  "--disable-extensions",
  "--no-pings",
  "--no-first-run",
]);
const NO_SANDBOX_ARGS = Object.freeze(["--no-sandbox", "--disable-setuid-sandbox"]);

class PdfRenderError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.name = "PdfRenderError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function invalidInput() {
  return new PdfRenderError(422, "Modèle de bulletin invalide.", "BULLETIN_PDF_INVALID_INPUT");
}

function renderFailed() {
  return new PdfRenderError(500, "La génération du bulletin PDF a échoué.", "BULLETIN_PDF_RENDER_FAILED");
}

function pdfUnavailable(reason) {
  const error = new PdfRenderError(
    503,
    "La génération des bulletins PDF est temporairement indisponible.",
    "BULLETIN_PDF_UNAVAILABLE",
  );
  Object.defineProperty(error, "reason", { value: reason, enumerable: false });
  return error;
}

/** Journal interne, sans chemin absolu ni détail système dans le message. */
function logPdfUnavailable(reason, cause) {
  const detail = cause
    ? String(cause.message ?? cause)
        .split("\n")[0]
        .replace(/(?:[A-Za-z]:)?[\\/][^\s'"]+/g, "<chemin>")
        .slice(0, 200)
    : "";
  console.error(`[SEC-PDF-02] Génération PDF indisponible (${reason})${detail ? ` : ${detail}` : ""}`);
}

/**
 * SEC-PDF-02 — options de lancement Chromium selon la politique de sandbox.
 * Lève une erreur 503 si la génération PDF est désactivée ou mal configurée.
 */
function buildChromiumLaunchOptions(env = process.env) {
  const policy = resolvePdfChromiumSandboxPolicy(env);
  if (policy.mode === PDF_SANDBOX_MODES.PDF_DISABLED) {
    throw pdfUnavailable("pdf_disabled");
  }
  if (policy.mode === PDF_SANDBOX_MODES.INVALID) {
    throw pdfUnavailable(`sandbox_config_${policy.reason}`);
  }
  const insecure = policy.mode === PDF_SANDBOX_MODES.INSECURE_LOCAL;
  return {
    headless: true,
    executablePath: env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [...(insecure ? NO_SANDBOX_ARGS : []), ...NETWORK_HARDENING_ARGS, "--font-render-hinting=none"],
  };
}

let browserPromise = null;

function resolveLogoPath(school) {
  return resolveSchoolLogoPath(school);
}

async function launchBrowser() {
  let options;
  try {
    options = buildChromiumLaunchOptions();
  } catch (error) {
    logPdfUnavailable(error.reason ?? "sandbox_config", null);
    throw error;
  }
  try {
    // Un seul essai, avec la configuration de la politique : aucun repli.
    return await puppeteer.launch(options);
  } catch (error) {
    const sandboxRequired = !options.args.includes("--no-sandbox");
    const reason = sandboxRequired ? "chromium_launch_failed_sandbox_required" : "chromium_launch_failed";
    logPdfUnavailable(reason, error);
    throw pdfUnavailable(reason);
  }
}

async function getBrowser() {
  if (!browserPromise) {
    const launching = launchBrowser();
    browserPromise = launching;
    launching.then(
      (browser) => {
        browser.once("disconnected", () => {
          if (browserPromise === launching) browserPromise = null;
        });
      },
      () => {
        if (browserPromise === launching) browserPromise = null;
      },
    );
  }
  return browserPromise;
}

async function closeBrowser() {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  const browser = await pending.catch(() => null);
  if (browser) await browser.close();
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertOptionalString(value, maxChars) {
  if (value == null) return;
  if (typeof value !== "string" || value.length > maxChars) throw invalidInput();
}

function assertRenderInput(report, school) {
  if (!isPlainObject(report) || !isPlainObject(school)) throw invalidInput();
  if (report.design == null) return;
  if (!isPlainObject(report.design)) throw invalidInput();
  assertOptionalString(report.design.htmlTemplate, MAX_TEMPLATE_HTML_CHARS);
  assertOptionalString(report.design.cssTemplate, MAX_TEMPLATE_CSS_CHARS);
}

function isInlineResourceUrl(url) {
  const value = String(url ?? "");
  return value === "about:blank" || value.startsWith("data:");
}

async function buildQrCodeDataUrl(payload) {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256,
    color: {
      dark: "#0f172a",
      light: "#ffffff",
    },
  });
}

async function buildReportCardHtml(report, school) {
  assertRenderInput(report, school);
  const design = report.design ?? {};
  const payload = buildVerificationPayload(report, school);
  const qrCodeDataUrl =
    design.showQrCode === false ? "" : await buildQrCodeDataUrl(payload);
  return renderReportCardHtml({
    report,
    school,
    qrCodeDataUrl,
    logoPath: resolveLogoPath(school),
  });
}

async function renderReportCardPreviewHtml(report, school) {
  return buildReportCardHtml(report, school);
}

/**
 * Rendu isolé d'un document HTML complet. `onBlockedRequest` reçoit l'URL de
 * chaque requête refusée (diagnostic et tests ; jamais renvoyé au client).
 */
async function renderHtmlToPdf(html, { onBlockedRequest } = {}) {
  if (typeof html !== "string" || !html.trim() || html.length > MAX_DOCUMENT_CHARS) {
    throw invalidInput();
  }

  let context = null;
  try {
    const browser = await getBrowser();
    context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.setDefaultTimeout(PDF_RENDER_TIMEOUT_MS);
    await page.setJavaScriptEnabled(false);
    await page.emulateNetworkConditions({ offline: true, download: 0, upload: 0, latency: 0 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.isInterceptResolutionHandled()) return;
      const url = request.url();
      if (isInlineResourceUrl(url)) {
        request.continue().catch(() => {});
        return;
      }
      if (typeof onBlockedRequest === "function") {
        try {
          onBlockedRequest(url);
        } catch {
          /* diagnostic uniquement */
        }
      }
      request.abort("blockedbyclient").catch(() => {});
    });

    await page.setContent(html, { waitUntil: "load", timeout: PDF_RENDER_TIMEOUT_MS });
    // Évaluation côté DevTools (le JavaScript du document reste désactivé).
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      timeout: PDF_RENDER_TIMEOUT_MS,
      margin: {
        top: "12mm",
        right: "10mm",
        bottom: "12mm",
        left: "10mm",
      },
    });
    return Buffer.from(pdf);
  } catch (error) {
    if (error instanceof PdfRenderError) throw error;
    const failure = renderFailed();
    Object.defineProperty(failure, "cause", { value: error, enumerable: false });
    throw failure;
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

async function renderReportCardPdf(report, school) {
  const html = await buildReportCardHtml(report, school);
  return renderHtmlToPdf(html);
}

module.exports = {
  PdfRenderError,
  buildChromiumLaunchOptions,
  closeBrowser,
  // Diagnostic et tests uniquement (processus Chromium courant).
  getBrowser,
  isInlineResourceUrl,
  renderHtmlToPdf,
  renderReportCardPdf,
  renderReportCardPreviewHtml,
};
