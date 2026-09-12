"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ENGINE_SCAN_ROOTS } = require("./contract");

const ROOT = path.resolve(__dirname, "../../..");

const FORBIDDEN = [
  /if\s*\(\s*country\b/,
  /if\s*\(\s*school\b/,
  /if\s*\(\s*schoolCode\b/,
  /iso_code\s*===\s*["']BI["']/,
  /countryCode\s*===\s*["']BI["']/,
  /country\s*===\s*["']BI["']/,
  /school\s*===\s*["']La Colombi[eè]re["']/,
];

const SKIP_NAMES = new Set([
  "noCountrySchoolBranch.js",
  "reportCardLot0.scan.test.js",
  "reportCardLot0.contract.test.js",
  "reportCardLot0.crypto.test.js",
  "reportCardLot0.fixtures.test.js",
]);

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile() && entry.name.endsWith(".js") && !SKIP_NAMES.has(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function scanEngineSources() {
  const hits = [];
  for (const rel of ENGINE_SCAN_ROOTS) {
    const abs = path.join(ROOT, rel);
    for (const file of walk(abs)) {
      const src = fs.readFileSync(file, "utf8");
      for (const re of FORBIDDEN) {
        if (re.test(src)) {
          hits.push({ file: path.relative(ROOT, file), pattern: String(re) });
        }
      }
    }
  }
  return hits;
}

module.exports = { scanEngineSources, FORBIDDEN };
