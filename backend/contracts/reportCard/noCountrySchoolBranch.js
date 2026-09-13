"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ENGINE_SCAN_ROOTS } = require("./contract");

const ROOT = path.resolve(__dirname, "../../..");

const BRANCH_IDENT =
  "(?:country|countryCode|country_code|iso_code|isoCode|school|schoolCode|school_code|schoolName|school_name)";

const FORBIDDEN = [
  new RegExp(String.raw`if\s*\(\s*${BRANCH_IDENT}\b`),
  new RegExp(String.raw`switch\s*\(\s*${BRANCH_IDENT}\b`),
  new RegExp(String.raw`\b${BRANCH_IDENT}\s*===?\s*['"]`),
  new RegExp(String.raw`['"][^'"]+['"]\s*===?\s*${BRANCH_IDENT}\b`),
  new RegExp(String.raw`\b${BRANCH_IDENT}\s*===?\s*['"][^'"]+['"]\s*\?`),
  new RegExp(String.raw`['"][^'"]+['"]\s*===?\s*${BRANCH_IDENT}\s*\?`),
  new RegExp(String.raw`\[\s*${BRANCH_IDENT}\s*\]`),
  new RegExp(String.raw`new\s+Map\s*\(\s*\[\s*\[\s*['"][A-Z]{2}['"]`),
  /iso_code\s*===\s*["']BI["']/,
  /countryCode\s*===\s*["']BI["']/,
  /country\s*===\s*["']BI["']/,
  /school\s*===\s*["']La Colombi[eè]re["']/,
];

const EXTRA_SCAN_FILES = Object.freeze([
  "backend/db/academicRuleProfilePgStore.js",
  "backend/db/academicRuleProfileSchema.js",
]);

const SKIP_NAMES = new Set([
  "noCountrySchoolBranch.js",
  "reportCardLot0.scan.test.js",
  "reportCardLot0.contract.test.js",
  "reportCardLot0.crypto.test.js",
  "reportCardLot0.fixtures.test.js",
]);

const SCANNED_EXTENSIONS = new Set([".js", ".ts", ".mjs"]);

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!SCANNED_EXTENSIONS.has(ext)) continue;
      if (entry.name.endsWith(".test.js") || entry.name.endsWith(".test.ts")) continue;
      if (SKIP_NAMES.has(entry.name)) continue;
      acc.push(full);
    }
  }
  return acc;
}

function collectFiles(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [abs];
  return walk(abs);
}

function scanText(src) {
  const hits = [];
  for (const re of FORBIDDEN) {
    re.lastIndex = 0;
    if (re.test(src)) hits.push(String(re));
  }
  return hits;
}

function scanEngineSources() {
  const hits = [];
  const roots = [...ENGINE_SCAN_ROOTS, ...EXTRA_SCAN_FILES];
  for (const rel of roots) {
    for (const file of collectFiles(rel)) {
      const matched = scanText(fs.readFileSync(file, "utf8"));
      for (const pattern of matched) {
        hits.push({ file: path.relative(ROOT, file), pattern });
      }
    }
  }
  return hits;
}

module.exports = { scanEngineSources, scanText, FORBIDDEN };
