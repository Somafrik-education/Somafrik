/**
 * AC-G1 — Garde de génération Lot 1 (OBLIGATOIRE).
 *
 * Toute expression de génération Mobile produisant TEACHER-*, teachers-*
 * ou un préfixe non canonique pour une NOUVELLE fiche échoue le gate.
 *
 * Autorisé : lecture / match historique, édition conservatrice, fixtures AC-HIST-02.
 *
 *   node scripts/guard-teacher-record-lot1-mobile-generation.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FILES = [
  "Mobile/src/lib/userTeacherSync.ts",
  "Mobile/src/screens/AdminCrudScreen.tsx",
  "Mobile/src/screens/TeachersScreen.tsx",
  "Mobile/src/lib/contactProvisioning.ts",
];

/** Patterns de GÉNÉRATION interdits (pas les matchers de lecture). */
const FORBIDDEN = [
  {
    id: "TEMPLATE_TEACHER_DOLLAR",
    // `TEACHER-${...}` but not `TEACHERS-${...}`
    re: /`TEACHER-\$\{/,
    detail: "template literal TEACHER-${...} (non TEACHERS-)",
  },
  {
    id: "CONCAT_TEACHER_PREFIX",
    re: /(["'`])TEACHER-\1\s*\+|(["'`])TEACHER-\2\s*\+|return\s+`TEACHER-(?!S)/,
    detail: "concat/return TEACHER- (hors TEACHERS-)",
  },
  {
    id: "TEMPLATE_TEACHERS_LOWER",
    re: /`teachers-\$\{/i,
    detail: "template teachers-${...} non canonique",
  },
  {
    id: "CREATE_INTERNAL_TEACHERS_GENERIC",
    // createInternalId returning generic prefix- without TEACHERS branch is checked separately
    re: /createInternalId\(\s*["']TEACHER["']\s*\)/,
    detail: "createInternalId('TEACHER')",
  },
];

function stripCommentsAndStringsForMatchers(source) {
  // Keep source mostly intact; we scan raw for generation templates.
  return source;
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function main() {
  const violations = [];
  const scanned = [];

  for (const rel of FILES) {
    const absolute = path.join(ROOT, rel);
    if (!fs.existsSync(absolute)) {
      violations.push({ file: rel, id: "MISSING_FILE", line: 0, detail: "fichier attendu absent" });
      continue;
    }
    const source = fs.readFileSync(absolute, "utf8");
    scanned.push(rel);

    // Explicit allow: createTeacherRecordId / TEACHERS- generation
    // Explicit allow: /^TEACHER-/i matchers for HIST-02

    for (const rule of FORBIDDEN) {
      const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : `${rule.re.flags}g`);
      let match;
      while ((match = re.exec(source))) {
        const idx = match.index;
        const line = lineOf(source, idx);
        const snippet = source.slice(idx, idx + 80).replace(/\s+/g, " ");
        // Allow TEACHERS- templates
        if (/TEACHERS-/i.test(snippet) && rule.id.startsWith("TEMPLATE_TEACHER")) {
          continue;
        }
        // Allow regex matchers like /^TEACHER-/i or /TEACHER-/ without template gen
        if (/\/\^?TEACHER-/.test(snippet) || /isTeacherTwinCode|TEACHER-\* historique|HIST-02/.test(source.slice(Math.max(0, idx - 120), idx + 80))) {
          if (!/`TEACHER-\$\{/.test(snippet) && !/`TEACHER-(?!S)/.test(snippet)) {
            continue;
          }
        }
        violations.push({ file: rel, id: rule.id, line, detail: `${rule.detail} :: ${snippet}` });
      }
    }

    // AdminCrud: createInternalId must special-case teachers → createTeacherRecordId
    if (rel.endsWith("AdminCrudScreen.tsx")) {
      if (!/createTeacherRecordId/.test(source)) {
        violations.push({
          file: rel,
          id: "MISSING_CREATE_TEACHER_RECORD_ID",
          line: 0,
          detail: "AdminCrudScreen doit utiliser createTeacherRecordId pour les enseignants",
        });
      }
      if (!/toLowerCase\(\)\s*===\s*["']teachers["']/.test(source) && !/===\s*["']teachers["']/.test(source)) {
        // must branch on teachers entity in createInternalId
        if (!/prefix.*teachers|teachers.*createTeacherRecordId/i.test(source)) {
          violations.push({
            file: rel,
            id: "MISSING_TEACHERS_ID_BRANCH",
            line: 0,
            detail: "createInternalId doit brancher sur entity teachers",
          });
        }
      }
    }

    // userTeacherSync must not contain TEACHER-${ generation
    if (rel.endsWith("userTeacherSync.ts")) {
      if (/`TEACHER-\$\{/.test(source)) {
        violations.push({
          file: rel,
          id: "LEGACY_NEW_TEACHER_ID",
          line: lineOf(source, source.indexOf("`TEACHER-${")),
          detail: "newTeacherId legacy TEACHER-${ encore présent",
        });
      }
      if (!/createTeacherRecordId|TEACHERS-\$\{/.test(source)) {
        violations.push({
          file: rel,
          id: "MISSING_TEACHERS_GENERATOR",
          line: 0,
          detail: "générateur TEACHERS-* attendu",
        });
      }
    }
  }

  const ok = violations.length === 0;
  const report = {
    gate: "AC-G1",
    subject: "TEACHER-RECORD-LOT1-MOBILE-GENERATION-GUARD",
    scanned,
    violations,
    ok,
    generatedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(report, null, 2));
  if (!ok) {
    console.error("\nAC-G1 FAIL — génération non canonique détectée");
    process.exit(1);
  }
  console.log("\nAC-G1 PASS — aucune génération TEACHER-*/teachers-* non canonique");
}

main();
