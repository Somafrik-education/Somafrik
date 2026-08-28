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

  const extractStart = repo.indexOf("extractExplicitTeacherKey(payload = {})");
  const extractEnd = repo.indexOf("async resolveUniqueTeacherInSchool", extractStart);
  const extractBody = extractStart >= 0 && extractEnd > extractStart ? repo.slice(extractStart, extractEnd) : "";
  if (!extractBody) {
    violations.push({
      file: FILES.repository,
      id: "MISSING_EXTRACT_TEACHER_KEY_BODY",
      line: 0,
      detail: "extractExplicitTeacherKey introuvable",
    });
  } else if (/\bauthorId\b/.test(extractBody)) {
    violations.push({
      file: FILES.repository,
      id: "AUTHOR_ID_AS_TEACHER_KEY",
      line: lineOf(repo, extractStart),
      detail: "authorId ne doit pas résoudre l'enseignant pédagogique",
    });
  } else if (!/payload\.teacherId/.test(extractBody)) {
    violations.push({
      file: FILES.repository,
      id: "MISSING_TEACHER_ID_KEY",
      line: lineOf(repo, extractStart),
      detail: "teacherId absent de extractExplicitTeacherKey",
    });
  }

  const mapStart = repo.indexOf("mapGrade(grade) {");
  const mapEnd = repo.indexOf("mapAttendance(", mapStart);
  const mapBody = mapStart >= 0 && mapEnd > mapStart ? repo.slice(mapStart, mapEnd) : "";
  if (!mapBody) {
    violations.push({
      file: FILES.repository,
      id: "MISSING_MAP_GRADE_BODY",
      line: 0,
      detail: "mapGrade introuvable",
    });
  } else if (!/teacherId:\s*grade\.teacher_code/.test(mapBody)) {
    violations.push({
      file: FILES.repository,
      id: "MAP_GRADE_MISSING_TEACHER_ID",
      line: lineOf(repo, mapStart),
      detail: "mapGrade doit projeter teacherId depuis teacher_code",
    });
  } else if (/authorId:\s*grade\.teacher_code/.test(mapBody)) {
    violations.push({
      file: FILES.repository,
      id: "MAP_GRADE_TEACHER_AS_AUTHOR",
      line: lineOf(repo, mapStart),
      detail: "teacher_code ne doit plus être présenté comme authorId",
    });
  }

  const attendStart = repo.indexOf("async findTeacherForAttendance");
  const attendEnd = repo.indexOf("mentionForScore(score) {", attendStart);
  const attendBody = attendStart >= 0 && attendEnd > attendStart ? repo.slice(attendStart, attendEnd) : "";
  if (!attendBody) {
    violations.push({
      file: FILES.repository,
      id: "MISSING_FIND_TEACHER_FOR_ATTENDANCE",
      line: 0,
      detail: "findTeacherForAttendance introuvable",
    });
  } else if (!/ta\.status = 'active'/.test(attendBody) || !/teacher_assignments/.test(attendBody)) {
    violations.push({
      file: FILES.repository,
      id: "ATTENDANCE_TEACHER_WITHOUT_CLASS_ASSIGNMENT",
      line: lineOf(repo, attendStart),
      detail: "admin/préfet : affectation active sur class_id exigée",
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
