#!/usr/bin/env node
"use strict";

/**
 * STUDENT-INTEGRITY-01 — diagnostic PostgreSQL en lecture seule.
 * N'écrit rien. Les totaux sont regroupés par code établissement.
 * --student-code limite la fiche à un matricule et omet le nom.
 *
 * Usage :
 *   DATABASE_URL=postgres://... node backend/scripts/audit-student-integrity.js
 *   DATABASE_URL=postgres://... node backend/scripts/audit-student-integrity.js --student-code CD-IN-ME-26-00010
 */

const {
  INTEGRITY_COUNT_SQL,
  STUDENT_DIAGNOSIS_SQL,
  summarizeIntegrityCounts,
  assertReadOnlySql,
  classifyStudentIntegrity,
} = require("../lib/studentIntegrity");

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return String(process.argv[index + 1] ?? "").trim();
}

function activeEnrollment(enrollments) {
  return (Array.isArray(enrollments) ? enrollments : []).some((row) => {
    const status = String(row.enrollmentStatus ?? "").trim().toLowerCase();
    return status === "active" || status === "enrolled";
  });
}

async function main() {
  assertReadOnlySql(INTEGRITY_COUNT_SQL);
  assertReadOnlySql(STUDENT_DIAGNOSIS_SQL);
  const databaseUrl = String(process.env.DATABASE_URL || process.env.SOMAFRIK_TEST_PG_URL || "").trim();
  const studentCode = readArg("--student-code");
  if (!databaseUrl) {
    console.log(JSON.stringify({
      available: false,
      readOnly: true,
      reason: "DATABASE_URL absent. Aucune ligne n'a été lue ni modifiée.",
    }));
    return;
  }

  const { Client } = require("pg");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("SET default_transaction_read_only = on");
    const counts = await client.query(INTEGRITY_COUNT_SQL);
    const report = {
      available: true,
      readOnly: true,
      summary: summarizeIntegrityCounts(counts.rows),
    };
    if (studentCode) {
      const diagnosis = await client.query(STUDENT_DIAGNOSIS_SQL, [studentCode]);
      const row = diagnosis.rows[0];
      if (!row) {
        report.student = classifyStudentIntegrity({
          studentExists: false,
          displayedStudentId: studentCode,
        });
      } else {
        const enrollments = Array.isArray(row.enrollments) ? row.enrollments : [];
        report.student = {
          studentUuid: row.student_uuid,
          schoolCode: row.school_code,
          studentStatus: row.student_status,
          enrollments,
          obligationCount: row.obligation_count,
          openObligationCount: row.open_obligation_count,
          paymentCount: row.payment_count,
          ...classifyStudentIntegrity({
            studentExists: true,
            financeRowExists: Number(row.obligation_count) > 0,
            studentUuid: row.student_uuid,
            matricule: studentCode,
            displayedStudentId: row.identity_mismatch ? "profile-studentId" : studentCode,
            studentStatus: row.student_status,
            hasActiveEnrollment: activeEnrollment(enrollments),
          }),
        };
      }
    }
    console.log(JSON.stringify(report));
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
