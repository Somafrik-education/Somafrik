#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { auditTeacherDuplicates } = require("../lib/teacherHistoricalDuplicateAudit");

function parseArgs(argv) {
  const options = { dryRun: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") options.input = argv[++index];
    else if (arg === "--json-output") options.jsonOutput = argv[++index];
    else if (arg === "--markdown-output") options.markdownOutput = argv[++index];
    else if (arg === "--database-url-env") options.databaseUrlEnv = argv[++index];
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--apply") throw new Error("--apply est interdit dans la PR d'audit ; --dry-run est obligatoire");
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  return options;
}

function absolute(target, fallback) {
  return path.resolve(process.cwd(), target ?? fallback);
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function loadFromDatabase(envName) {
  const connectionString = process.env[envName];
  if (!connectionString) throw new Error(`Variable ${envName} absente`);
  const { Client } = require("pg");
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const snapshot = await client.query(
      "SELECT state_payload, updated_at FROM backoffice_state ORDER BY updated_at DESC LIMIT 1",
    );
    if (!snapshot.rows[0]?.state_payload) throw new Error("Aucun snapshot backoffice_state disponible");
    const rawState = snapshot.rows[0].state_payload;
    const snapshotHash = hash(JSON.stringify(rawState));
    const backofficeTeachers = (rawState.teachers ?? []).length;
    const state = JSON.parse(JSON.stringify(rawState));
    const postgresTeachers = await client.query(
      `SELECT t.teacher_code AS id, s.school_code AS "schoolCode", t.user_id::text AS "userId",
              t.status, t.id::text AS "postgresId"
         FROM teachers t
         JOIN schools s ON s.id = t.school_id`,
    );
    const teachersById = new Map(
      (state.teachers ?? []).map((teacher) => [String(teacher.id ?? "").trim(), teacher]),
    );
    for (const teacher of postgresTeachers.rows) {
      const existing = teachersById.get(String(teacher.id ?? "").trim());
      teachersById.set(String(teacher.id ?? "").trim(), existing ? { ...teacher, ...existing } : teacher);
    }
    state.teachers = [...teachersById.values()];
    const referenceQueries = {
      postgresTeacherAssignments: "SELECT ta.id::text AS id, t.teacher_code AS \"teacherId\" FROM teacher_assignments ta JOIN teachers t ON t.id=ta.teacher_id",
      postgresGrades: "SELECT g.id::text AS id, t.teacher_code AS \"teacherId\" FROM grades g JOIN teachers t ON t.id=g.teacher_id",
      postgresAttendance: "SELECT a.id::text AS id, t.teacher_code AS \"teacherId\" FROM attendance a JOIN teachers t ON t.id=a.teacher_id WHERE a.teacher_id IS NOT NULL",
      postgresEvaluations: "SELECT e.id::text AS id, t.teacher_code AS \"teacherId\" FROM evaluations e JOIN teachers t ON t.id=e.teacher_id WHERE e.teacher_id IS NOT NULL",
    };
    for (const [key, sql] of Object.entries(referenceQueries)) {
      state[key] = (await client.query(sql)).rows;
    }
    await client.query("ROLLBACK");
    return {
      state,
      source: `postgres:backoffice_state@${new Date(snapshot.rows[0].updated_at).toISOString()}`,
      snapshotHash,
      sourceInventory: {
        backofficeTeachers,
        postgresTeachers: postgresTeachers.rows.length,
        unionTeachers: state.teachers.length,
      },
    };
  } finally {
    await client.end();
  }
}

function loadFromFile(input) {
  const raw = fs.readFileSync(absolute(input), "utf8");
  return { state: JSON.parse(raw), source: `file:${path.basename(input)}`, snapshotHash: hash(raw) };
}

function markdown(report) {
  const lines = [
    "# Audit read-only — doublons historiques enseignants",
    "",
    `- Généré : ${report.generatedAt}`,
    `- Source : ${report.source}`,
    `- Hash snapshot SHA-256 : \`${report.snapshotHash ?? "n/a"}\``,
    "- Mode : **DRY-RUN READ-ONLY**",
    "",
    "## Synthèse",
    "",
    ...(report.sourceInventory
      ? [
          `- Fiches Backoffice : **${report.sourceInventory.backofficeTeachers}**`,
          `- Fiches PostgreSQL : **${report.sourceInventory.postgresTeachers}**`,
          `- Union auditée : **${report.sourceInventory.unionTeachers}**`,
        ]
      : []),
    `- Fiches enseignants : **${report.totals.teachers}**`,
    `- Groupes suspects : **${report.totals.suspectGroups}**`,
    `- Groupes SAFE_DUPLICATE : **${report.totals.safeDuplicateGroups}**`,
    `- Fiches doublons sûres : **${report.totals.safeDuplicateRecords}**`,
    `- Groupes AMBIGUOUS : **${report.totals.ambiguousGroups}**`,
    `- Groupes HOMONYM_POSSIBLE : **${report.totals.homonymPossibleGroups}**`,
    `- Groupes avec références réparties : **${report.totals.referenceSplitGroups}**`,
    `- Fiches ORPHAN : **${report.totals.orphanRecords}**`,
    "",
    "## Groupes",
    "",
  ];
  if (!report.groups.length) lines.push("Aucun groupe suspect détecté.", "");
  for (const group of report.groups) {
    lines.push(
      `### ${group.groupId} — ${group.classification}`,
      "",
      `- Établissement : \`${group.schoolCode || "non renseigné"}\``,
      `- Fiches : ${group.teacherIds.map((id) => `\`${id}\``).join(", ")}`,
      `- Canon proposé : ${group.canonicalTeacherId ? `\`${group.canonicalTeacherId}\`` : "aucun"}`,
      `- Signaux : ${group.evidence.map((item) => item.signals?.join("+") ?? item.signal).join(", ") || "aucun"}`,
      `- Drapeaux : ${group.flags.join(", ") || "aucun"}`,
      "",
      "| teacherId | type | userId | contactId | identifier | publicId | références |",
      "|---|---|---|---|---|---|---|",
    );
    for (const teacher of group.teachers) {
      const counts = Object.entries(teacher.referenceCounts ?? {})
        .map(([key, count]) => `${key}:${count}`)
        .join(", ");
      lines.push(
        `| ${teacher.teacherId} | ${teacher.codeType ?? ""} | ${teacher.userId ?? ""} | ${teacher.contactId ?? ""} | ${teacher.identifier ?? ""} | ${teacher.publicId ?? ""} | ${counts || "0"} |`,
      );
    }
    lines.push("");
  }
  lines.push("## Plan de réconciliation proposé", "");
  if (!report.reconciliationPlan.length) lines.push("Aucune réconciliation automatique proposée.", "");
  for (const item of report.reconciliationPlan) {
    lines.push(
      `- \`${item.duplicateTeacherId}\` → \`${item.canonicalTeacherId}\` : ${item.referenceTotal} référence(s) à déplacer (${Object.entries(item.referencesToMove).map(([key, count]) => `${key}:${count}`).join(", ") || "aucune"}).`,
    );
  }
  lines.push(
    "",
    "## Résultat du dry-run",
    "",
    `- teachers : ${report.dryRun.teacherCountBefore} → ${report.dryRun.teacherCountAfter}`,
    `- références simulées à déplacer : ${report.dryRun.referencesThatWouldMove}`,
    `- assignments : ${report.dryRun.domainCountsBefore.assignments} → ${report.dryRun.domainCountsAfter.assignments}`,
    `- grades : ${report.dryRun.domainCountsBefore.grades} → ${report.dryRun.domainCountsAfter.grades}`,
    `- attendance/presences : ${report.dryRun.domainCountsBefore.attendance} → ${report.dryRun.domainCountsAfter.attendance}`,
    `- evaluations : ${report.dryRun.domainCountsBefore.evaluations} → ${report.dryRun.domainCountsAfter.evaluations}`,
    `- références pendantes après simulation : ${report.dryRun.invariants.danglingReferencesAfterSimulation}`,
    "",
    "Aucune mutation n'a été exécutée. Toute exécution préproduction nécessite une validation CTO séparée.",
    "",
  );
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.dryRun) throw new Error("Le dry-run est obligatoire");
  const loaded = options.input
    ? loadFromFile(options.input)
    : await loadFromDatabase(options.databaseUrlEnv ?? "DATABASE_URL");
  const report = auditTeacherDuplicates(loaded.state, {
    source: loaded.source,
    sourceInventory: loaded.sourceInventory,
  });
  report.snapshotHash = loaded.snapshotHash;
  report.sourceInventory = loaded.sourceInventory ?? null;
  const jsonOutput = absolute(options.jsonOutput, "docs/audits/TEACHER-HISTORICAL-DEDUP-REPORT.json");
  const markdownOutput = absolute(options.markdownOutput, "docs/audits/TEACHER-HISTORICAL-DEDUP-REPORT.md");
  fs.mkdirSync(path.dirname(jsonOutput), { recursive: true });
  fs.mkdirSync(path.dirname(markdownOutput), { recursive: true });
  fs.writeFileSync(jsonOutput, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownOutput, markdown(report));
  console.log(JSON.stringify({ totals: report.totals, dryRun: report.dryRun }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
