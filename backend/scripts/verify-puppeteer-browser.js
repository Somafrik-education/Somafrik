"use strict";

// Match the build artifact's browser location regardless of npm --prefix/CWD.
const fs = require("node:fs");
const path = require("node:path");
process.env.PUPPETEER_CACHE_DIR = path.resolve(__dirname, "../.cache/puppeteer");
const puppeteer = require("puppeteer");

const executable = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
if (!executable || !fs.existsSync(executable)) {
  console.error("[bulletin-pdf] Browser missing from backend build artifact.");
  process.exitCode = 1;
} else {
  console.log("[bulletin-pdf] Browser executable available for PDF rendering.");
}
