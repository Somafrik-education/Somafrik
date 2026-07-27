/**
 * AC-N4 — Garde anti-fallback Lot 2 (OBLIGATOIRE).
 *
 * Interdit toute résolution d'enseignant pour note/présence via
 * « premier teacher de l'école » / ORDER BY created_at LIMIT 1 / findAnyTeacher.
 *
 * Allowlist documentée : terms, seed admin user, listes démo classes/subjects/students
 * (hors auteur pédagogique).
 *
 *   node scripts/guard-teacher-record-lot2-notes-attendance.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FILES = {
  repository: "backend/db/postgresRepository.js",
  server: "backend/server.js",
};

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function main() {
  const violations = [];

  const repoPath = path.join(ROOT, FILES.repository);
  const serverPath = path.join(ROOT, FILES.server);
  if (!fs.existsSync(repoPath)) {
    violations.push({ file: FILES.repository, id: "MISSING_FILE", line: 0, detail: "absent" });
  }
  if (!fs.existsSync(serverPath)) {
    violations.push({ file: FILES.server, id: "MISSING_FILE", line: 0, detail: "absent" });
  }
  if (violations.length) {
    console.log(JSON.stringify({ ok: false, violations }, null, 2));
    process.exit(1);
  }

  const repo = fs.readFileSync(repoPath, "utf8");
  const server = fs.readFileSync(serverPath, "utf8");

  // 1) School-wide first-teacher invent (the Lot 2 root cause)
  const schoolWideRe =
    /SELECT\s+\*\s+FROM\s+teachers\s+WHERE\s+school_id\s*=\s*\$1\s+ORDER\s+BY\s+created_at\s+LIMIT\s+1/gi;
  let match;
  while ((match = schoolWideRe.exec(repo))) {
    violations.push({
      file: FILES.repository,
      id: "SCHOOL_FIRST_TEACHER_FALLBACK",
      line: lineOf(repo, match.index),
      detail: "fallback premier teacher école",
      snippet: match[0].replace(/\s+/g, " ").slice(0, 120),
    });
  }

  if (/findAnyTeacher\s*\(/.test(repo)) {
    violations.push({
      file: FILES.repository,
      id: "FIND_ANY_TEACHER",
      line: 0,
      detail: "findAnyTeacher présent",
    });
  }

  // 2) Lot 2 symbols required in repository
  for (const symbol of [
    "resolveUniqueTeacherInSchool",
    "extractExplicitTeacherKey",
    "teacherUnresolvedError",
    "GRADE_TEACHER_UNRESOLVED",
    "ATTENDANCE_TEACHER_UNRESOLVED",
  ]) {
    if (!repo.includes(symbol)) {
      violations.push({
        file: FILES.repository,
        id: "MISSING_SYMBOL",
        line: 0,
        detail: symbol,
      });
    }
  }

  // 3) identitySyncAck always attached on PUT response path
  if (!server.includes("identitySyncAck")) {
    violations.push({
      file: FILES.server,
      id: "MISSING_IDENTITY_SYNC_ACK",
      line: 0,
      detail: "identitySyncAck absent de server.js",
    });
  }
  if (!/identitySyncAck:\s*\{\s*skips:/.test(server) && !/identitySyncAck\s*=\s*\{\s*skips:/.test(server)) {
    violations.push({
      file: FILES.server,
      id: "IDENTITY_SYNC_ACK_SHAPE",
      line: 0,
      detail: "forme identitySyncAck.skips non trouvée",
    });
  }

  const ok = violations.length === 0;
  const report = {
    ok,
    guard: "AC-N4",
    lot: "TEACHER-RECORD-LOT2-NOTES-ATTENDANCE-IDENTITY-ACK",
    scanned: Object.values(FILES),
    violations,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!ok) {
    console.error(`AC-N4 FAIL: ${violations.length} violation(s)`);
    process.exit(1);
  }
  console.error("AC-N4 PASS");
}

main();
