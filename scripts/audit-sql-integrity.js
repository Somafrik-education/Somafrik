/**
 * Audit d'intégrité sur les tables relationnelles PostgreSQL.
 *
 *   npm run audit:sql-integrity
 */
const path = require("path");
try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
} catch {
  // optional
}

const CHECKS = [
  {
    label: "Notes au-dessus du barème",
    severity: "critical",
    sql: `
      SELECT g.id, g.student_id, g.score, g.max_score
      FROM grades g
      WHERE g.score > g.max_score
      LIMIT 20
    `,
  },
  {
    label: "Doublons présence (élève + date + classe)",
    severity: "high",
    sql: `
      SELECT student_id, attendance_date, class_id, COUNT(*) AS cnt
      FROM attendance
      GROUP BY student_id, attendance_date, class_id
      HAVING COUNT(*) > 1
      LIMIT 20
    `,
  },
  {
    label: "Soldes frais négatifs",
    severity: "high",
    sql: `
      SELECT id, student_id, fee_type, balance
      FROM student_fee_obligations
      WHERE balance < 0 AND archived_at IS NULL
      LIMIT 20
    `,
  },
  {
    label: "Incohérence solde frais (amount_due - amount_paid - exemption)",
    severity: "medium",
    sql: `
      SELECT id, student_id, fee_type, amount_due, amount_paid, exemption, balance
      FROM student_fee_obligations
      WHERE archived_at IS NULL
        AND ABS(balance - GREATEST(0, amount_due - amount_paid - exemption)) > 0.01
      LIMIT 20
    `,
  },
  {
    label: "Paiements sans élève (orphelins)",
    severity: "critical",
    sql: `
      SELECT p.id, p.payment_code, p.student_id
      FROM payments p
      LEFT JOIN students s ON s.id = p.student_id
      WHERE s.id IS NULL
      LIMIT 20
    `,
  },
  {
    label: "Présences sans élève (orphelines)",
    severity: "critical",
    sql: `
      SELECT a.id, a.student_id, a.attendance_date
      FROM attendance a
      LEFT JOIN students s ON s.id = a.student_id
      WHERE s.id IS NULL
      LIMIT 20
    `,
  },
];

function printRows(label, severity, rows) {
  console.log(`[${severity}] ${label} — ${rows.length} problème(s)`);
  for (const row of rows.slice(0, 10)) {
    console.log(`  ${JSON.stringify(row)}`);
  }
  if (rows.length > 10) {
    console.log(`  … ${rows.length - 10} autre(s)`);
  }
}

async function runChecks(pool) {
  const issues = [];
  for (const check of CHECKS) {
    const result = await pool.query(check.sql);
    const rows = result.rows ?? [];
    if (rows.length) {
      issues.push({ ...check, rows });
      printRows(check.label, check.severity, rows);
      console.log("");
    }
  }
  return issues;
}

async function runChecksViaDocker() {
  const { execSync } = require("child_process");
  const issues = [];
  const composeFile = path.join(__dirname, "..", "docker-compose.yml");
  for (const check of CHECKS) {
    const sql = check.sql.replace(/\s+/g, " ").trim();
    const output = execSync(
      `docker compose -f "${composeFile}" exec -T postgres psql -U ${process.env.POSTGRES_USER ?? "somafrik"} -d ${process.env.POSTGRES_DB ?? "somafrik"} -t -A -F "," -c "${sql}"`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    if (!output) continue;
    const rows = output.split("\n").filter(Boolean).map((line) => {
      const parts = line.split(",");
      return parts.reduce((acc, value, index) => {
        acc[`col${index}`] = value;
        return acc;
      }, {});
    });
    if (rows.length) {
      issues.push({ ...check, rows });
      printRows(check.label, check.severity, rows);
      console.log("");
    }
  }
  return issues;
}

async function main() {
  console.log("\n=== Audit intégrité SQL (PostgreSQL) ===\n");

  const backendRoot = path.join(__dirname, "..", "backend");
  const { Pool } = require(path.join(backendRoot, "node_modules", "pg"));
  const { buildDatabaseUrl } = require(path.join(backendRoot, "db", "connectionConfig"));

  let databaseUrl = process.env.DATABASE_URL || buildDatabaseUrl();
  const hostPort = process.env.POSTGRES_HOST_PORT || "5433";
  if (!process.env.POSTGRES_PORT && !process.env.DATABASE_URL?.includes(`:${hostPort}/`)) {
    databaseUrl = databaseUrl.replace(/:(\d+)\/([^/]+)$/, `:${hostPort}/$2`);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  let issues = [];

  try {
    issues = await runChecks(pool);
  } catch (error) {
    console.warn(`Connexion PostgreSQL locale indisponible (${error.code ?? error.message}) — repli Docker.`);
    try {
      issues = await runChecksViaDocker();
    } catch (dockerError) {
      console.error(`Audit SQL via Docker échoué : ${dockerError.message}`);
      process.exit(3);
    }
  } finally {
    await pool.end().catch(() => {});
  }

  try {
    const critical = issues.filter((item) => item.severity === "critical").length;
    const high = issues.filter((item) => item.severity === "high").length;

    console.log("Résumé");
    console.log(`  Contrôles exécutés : ${CHECKS.length}`);
    console.log(`  Anomalies détectées : ${issues.length}`);
    console.log(`  Critiques            : ${critical}`);
    console.log(`  Élevées              : ${high}`);
    console.log("");

    if (!issues.length) {
      console.log("Audit SQL : OK");
      process.exit(0);
    }

    console.log("Audit SQL : anomalies détectées (voir détails ci-dessus)");
    process.exit(critical > 0 ? 2 : 1);
  } catch (error) {
    console.error(`Audit SQL interrompu : ${error.message}`);
    process.exit(3);
  }
}

main();
