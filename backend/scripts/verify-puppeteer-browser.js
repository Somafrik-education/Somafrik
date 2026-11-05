"use strict";

const fs = require("node:fs");
const { CACHE_DIR, findPdfBrowserExecutable } = require("../lib/reportCard/pdfBrowserExecutable");

const executable = findPdfBrowserExecutable();
if (!executable || !fs.existsSync(executable)) {
  console.error("[bulletin-pdf] Chrome missing from packaged cache:", CACHE_DIR);
  process.exitCode = 1;
} else {
  console.log("[bulletin-pdf] Browser executable available for PDF rendering.");
}
