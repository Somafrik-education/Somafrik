"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  REQUIRED_ENTITIES,
  SCAN_ROOTS,
  SCAN_EXTENSIONS,
  IGNORE_DIR_NAMES,
  RULES,
  isAllowlisted,
} = require("./rules");

const DEFAULT_ROOT = path.resolve(__dirname, "../..");
const INVENTORY_RELATIVE = "docs/audits/id-canonical-01a-entities.json";

function walkFiles(root, dir, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORE_DIR_NAMES.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(root, absolute, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!SCAN_EXTENSIONS.has(ext)) continue;
    files.push(path.relative(root, absolute).replaceAll("\\", "/"));
  }
}

function collectScanFiles(root) {
  const files = [];
  for (const rel of SCAN_ROOTS) {
    const absolute = path.join(root, rel);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.statSync(absolute);
    if (stat.isFile()) {
      files.push(rel.replaceAll("\\", "/"));
      continue;
    }
    walkFiles(root, absolute, files);
  }
  return files.sort();
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function scanFile(relativePath, source) {
  const findings = [];
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : `${rule.re.flags}g`);
    let match;
    while ((match = re.exec(source))) {
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        description: rule.description,
        file: relativePath,
        line: lineOf(source, match.index),
        match: match[0].replace(/\s+/g, " ").slice(0, 80),
        allowlisted: isAllowlisted(relativePath),
      });
    }
  }
  return findings;
}

function loadEntityInventory(root) {
  const absolute = path.join(root, INVENTORY_RELATIVE);
  if (!fs.existsSync(absolute)) {
    return { ok: false, path: INVENTORY_RELATIVE, error: "inventaire JSON absent", entities: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    return { ok: false, path: INVENTORY_RELATIVE, error: `JSON invalide: ${error.message}`, entities: [] };
  }
  const entities = Array.isArray(parsed.entities) ? parsed.entities : [];
  const missingFields = [];
  const requiredFields = [
    "entity",
    "table",
    "pk",
    "publicCode",
    "loginIdentifier",
    "legacyAliases",
    "consumers",
    "runtimeFallbacks",
    "decision",
    "canonicalFormat",
    "finalConstraint",
  ];
  for (const row of entities) {
    for (const field of requiredFields) {
      if (row[field] == null || row[field] === "") {
        missingFields.push(`${row.entity ?? "?"}.${field}`);
      }
    }
  }
  const present = new Set(entities.map((row) => row.entity));
  const missingEntities = REQUIRED_ENTITIES.filter((name) => !present.has(name));
  const invalidDecisions = entities
    .filter((row) => !["KEEP", "RENAME", "DELETE", "COLLAPSE"].includes(row.decision))
    .map((row) => `${row.entity}:${row.decision}`);
  return {
    ok: missingEntities.length === 0 && missingFields.length === 0 && invalidDecisions.length === 0,
    path: INVENTORY_RELATIVE,
    entities,
    missingEntities,
    missingFields,
    invalidDecisions,
    error: null,
  };
}

function summarize(findings) {
  const blocking = findings.filter((item) => !item.allowlisted);
  const allowlisted = findings.filter((item) => item.allowlisted);
  const byRule = {};
  for (const item of findings) {
    byRule[item.ruleId] = (byRule[item.ruleId] ?? 0) + 1;
  }
  return {
    total: findings.length,
    blocking: blocking.length,
    allowlisted: allowlisted.length,
    byRule,
  };
}

function scanRepository(options = {}) {
  const root = options.root ?? DEFAULT_ROOT;
  const files = collectScanFiles(root);
  const findings = [];
  for (const relativePath of files) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    findings.push(...scanFile(relativePath, source));
  }
  const inventory = loadEntityInventory(root);
  return {
    generatedAt: new Date().toISOString(),
    mode: options.strict ? "strict" : "report",
    root,
    scannedFileCount: files.length,
    inventory,
    findings,
    summary: summarize(findings),
  };
}

function formatReport(report) {
  const lines = [];
  lines.push("ID-CANONICAL-01 — inventaire des identités legacy");
  lines.push(`mode=${report.mode} fichiers=${report.scannedFileCount}`);
  lines.push(
    `hits=${report.summary.total} bloquants=${report.summary.blocking} allowlist=${report.summary.allowlisted}`,
  );
  if (!report.inventory.ok) {
    lines.push(`inventaire INCOMPLET: ${report.inventory.path}`);
    if (report.inventory.error) lines.push(`  ${report.inventory.error}`);
    if (report.inventory.missingEntities?.length) {
      lines.push(`  entités manquantes: ${report.inventory.missingEntities.join(", ")}`);
    }
    if (report.inventory.missingFields?.length) {
      lines.push(`  champs manquants: ${report.inventory.missingFields.slice(0, 12).join(", ")}`);
    }
    if (report.inventory.invalidDecisions?.length) {
      lines.push(`  décisions invalides: ${report.inventory.invalidDecisions.join(", ")}`);
    }
  } else {
    lines.push(`inventaire OK (${report.inventory.entities.length} entités) — ${report.inventory.path}`);
  }
  lines.push("");
  lines.push("Par règle:");
  for (const [ruleId, count] of Object.entries(report.summary.byRule).sort()) {
    lines.push(`  ${ruleId}: ${count}`);
  }
  lines.push("");
  const preview = report.findings.filter((item) => !item.allowlisted).slice(0, 40);
  if (preview.length) {
    lines.push("Résidus runtime (extrait, hors allowlist):");
    for (const item of preview) {
      lines.push(`  ${item.file}:${item.line} [${item.ruleId}] ${item.match}`);
    }
    if (report.summary.blocking > preview.length) {
      lines.push(`  … ${report.summary.blocking - preview.length} autres hits bloquants`);
    }
  } else {
    lines.push("Aucun résidu runtime hors allowlist.");
  }
  return lines.join("\n");
}

module.exports = {
  INVENTORY_RELATIVE,
  scanRepository,
  formatReport,
  scanFile,
  loadEntityInventory,
};
