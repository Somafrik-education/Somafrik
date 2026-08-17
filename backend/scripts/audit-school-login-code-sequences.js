"use strict";

/**
 * Diagnostic lecture seule — collisions SEQ3 login_code par pays + année.
 * N'écrit jamais schools.login_code.
 *
 *   node backend/scripts/audit-school-login-code-sequences.js
 */
const { Pool } = require("pg");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();

function pad(value, width) {
  return String(value ?? "").padEnd(width);
}

async function main() {
  if (!DATABASE_URL) {
    console.log("audit-school-login-code-sequences.js SKIP (DATABASE_URL absent)");
    return;
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const view = await pool.query(`
      SELECT to_regclass('public.school_login_code_sequence_audit') AS audit_view
    `);
    if (!view.rows[0]?.audit_view) {
      console.log("Vue school_login_code_sequence_audit absente — migration 20260825 non appliquée.");
      return;
    }

    const rows = await pool.query(`
      SELECT
        name,
        school_code,
        country_iso,
        login_code,
        created_year,
        seq,
        initials,
        sequence_collision
      FROM school_login_code_sequence_audit
      ORDER BY country_iso, created_year, seq, login_code
    `);

    console.log(
      [
        pad("school", 36),
        pad("country", 8),
        pad("login_code", 18),
        pad("year", 6),
        pad("seq", 5),
        pad("initials", 10),
        "collision",
      ].join(" "),
    );
    console.log("-".repeat(110));

    for (const row of rows.rows) {
      console.log(
        [
          pad(row.name, 36),
          pad(row.country_iso, 8),
          pad(row.login_code, 18),
          pad(row.created_year, 6),
          pad(String(row.seq).padStart(3, "0"), 5),
          pad(row.initials, 10),
          row.sequence_collision ? "OUI" : "non",
        ].join(" "),
      );
    }

    const collisions = rows.rows.filter((row) => row.sequence_collision);
    const counters = await pool.query(`
      SELECT c.iso_code, ctr.creation_year, ctr.last_value
      FROM school_login_code_counters ctr
      JOIN countries c ON c.id = ctr.country_id
      ORDER BY c.iso_code, ctr.creation_year
    `);

    console.log("");
    console.log(`lignes=${rows.rowCount} collisions_logiques=${collisions.length}`);
    console.log("compteurs (country, year) → last_value (prochaine allocation = last_value+1) :");
    for (const row of counters.rows) {
      console.log(`  ${row.iso_code} ${row.creation_year} last=${row.last_value}`);
    }
    console.log("");
    console.log("Stratégie recommandée : A — ne pas réécrire les codes déjà émis.");
    console.log("Dry-run rewrite : SELECT * FROM school_login_code_seq_backfill_preview WHERE would_change;");
    console.log("Aucun UPDATE n'a été exécuté.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
