import { assertSafeBulletinHtml } from "./bulletin.js";

export async function renderBulletinPdf(browserBinding, html) {
  assertSafeBulletinHtml(html);
  if (!browserBinding || typeof browserBinding.fetch !== "function") {
    const error = new Error("BROWSER_BINDING_REQUIRED");
    error.code = "BROWSER_BINDING_REQUIRED";
    throw error;
  }
  const puppeteer = (await import("@cloudflare/puppeteer")).default;
  const browser = await puppeteer.launch(browserBinding);
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    const bytes = pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf);
    const header = new TextDecoder().decode(bytes.subarray(0, 5));
    if (header !== "%PDF-") {
      const error = new Error("POC_PDF_INVALID");
      error.code = "POC_PDF_INVALID";
      throw error;
    }
    return bytes;
  } finally {
    await browser.close();
  }
}
