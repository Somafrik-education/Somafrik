"use strict";

// Fail the build, rather than publishing an API that cannot render official PDFs.
const fs = require("node:fs");
const puppeteer = require("puppeteer");

const executable = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
if (!executable || !fs.existsSync(executable)) {
  console.error("[bulletin-pdf] Chrome/Chromium missing after installation. Check Puppeteer cache and build configuration.");
  process.exitCode = 1;
} else {
  console.log("[bulletin-pdf] Browser executable available for PDF rendering.");
}
