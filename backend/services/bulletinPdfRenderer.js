const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const QRCode = require("qrcode");
const { buildVerificationPayload, renderReportCardHtml } = require("../lib/bulletinTemplate");

let browserPromise = null;

function resolveLogoPath() {
  const assetsDir = path.join(__dirname, "..", "assets");
  const candidates = ["somafrik-logo.jpg", "somafrik-logo.png"];
  for (const name of candidates) {
    const fullPath = path.join(assetsDir, name);
    if (fs.existsSync(fullPath)) return fullPath;
  }
  return "";
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
    });
  }
  return browserPromise;
}

async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
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

async function renderReportCardPreviewHtml(report, school) {
  const design = report.design ?? {};
  const payload = buildVerificationPayload(report, school);
  const qrCodeDataUrl =
    design.showQrCode === false ? "" : await buildQrCodeDataUrl(payload);
  return renderReportCardHtml({
    report,
    school,
    qrCodeDataUrl,
    logoPath: resolveLogoPath(),
  });
}

async function renderReportCardPdf(report, school) {
  const design = report.design ?? {};
  const payload = buildVerificationPayload(report, school);
  const qrCodeDataUrl =
    design.showQrCode === false ? "" : await buildQrCodeDataUrl(payload);
  const html = renderReportCardHtml({
    report,
    school,
    qrCodeDataUrl,
    logoPath: resolveLogoPath(),
  });

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "12mm",
        right: "10mm",
        bottom: "12mm",
        left: "10mm",
      },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

module.exports = {
  closeBrowser,
  renderReportCardPdf,
  renderReportCardPreviewHtml,
};
