#!/usr/bin/env node
"use strict";

/**
 * Audit lecture seule du paiement Oscar CD-IN-26-001-2026-PAY-0006.
 * Aucun INSERT/UPDATE/DELETE. Si DATABASE_URL est absent, le script s'arrête sans erreur.
 */
const { Pool } = require("pg");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const PAYMENT_CODE = process.env.SOMAFRIK_OSCAR_PAYMENT_CODE || "CD-IN-26-001-2026-PAY-0006";

async function main() {
  if (!DATABASE_URL) {
    console.log("audit-finance-oscar-readonly: SKIP (DATABASE_URL absent) — aucune donnée lue ni mutée.");
    return;
  }
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    const payment = await pool.query(
      `SELECT id, payment_code, amount, payment_status, profile_payload, school_id, student_id
       FROM payments WHERE payment_code = $1`,
      [PAYMENT_CODE],
    );
    if (!payment.rowCount) {
      console.log(JSON.stringify({ paymentCode: PAYMENT_CODE, found: false }, null, 2));
      return;
    }
    const pay = payment.rows[0];
    const items = await pool.query(
      `SELECT id, amount, obligation_id, fee_type, fee_label FROM payment_items WHERE payment_id = $1 ORDER BY sort_order`,
      [pay.id],
    );
    const allocations = await pool.query(
      `SELECT id, amount, obligation_id, reversed_at FROM payment_allocations WHERE payment_id = $1`,
      [pay.id],
    );
    const obligationIds = [
      ...new Set(
        [...items.rows, ...allocations.rows]
          .map((row) => row.obligation_id)
          .filter(Boolean),
      ),
    ];
    const obligations =
      obligationIds.length === 0
        ? { rows: [] }
        : await pool.query(
            `SELECT id, initial_amount, amount_due, amount_paid, exemption, balance, status, label
             FROM student_fee_obligations WHERE id = ANY($1::uuid[])`,
            [obligationIds],
          );
    console.log(
      JSON.stringify(
        {
          found: true,
          payment: pay,
          items: items.rows,
          allocations: allocations.rows,
          obligations: obligations.rows,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
