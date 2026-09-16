"use strict";

const { Pool } = require("pg");

function money(value) {
  const number = Number(value || 0);
  return Math.round(number * 100) / 100;
}

function splitPayment(amount, mode) {
  const total = money(amount);
  if (!(total > 0)) {
    return {
      registrationDue: 5000,
      tuitionDue: 15000,
      registrationAllocation: 0,
      tuitionAllocation: 0,
    };
  }

  if (mode === 0) {
    const registrationDue = money(total * 0.4);
    const tuitionDue = money(total - registrationDue);
    return {
      registrationDue,
      tuitionDue,
      registrationAllocation: registrationDue,
      tuitionAllocation: tuitionDue,
    };
  }

  if (mode === 1) {
    const registrationDue = money(total * 0.4);
    const tuitionDue = money(total * 1.2);
    return {
      registrationDue,
      tuitionDue,
      registrationAllocation: registrationDue,
      tuitionAllocation: money(total - registrationDue),
    };
  }

  return {
    registrationDue: total,
    tuitionDue: total,
    registrationAllocation: total,
    tuitionAllocation: 0,
  };
}

async function insertObligation(client, enrollment, suffix, input) {
  const publicId = `DEMO-FEE-${String(enrollment.student_code || enrollment.student_id)}-${suffix}`.slice(0, 120);
  const label = suffix === "REG" ? "Frais d'inscription" : "Frais de scolarité — Trimestre 1";
  const feeType = suffix === "REG" ? "Inscription" : "Scolarité";
  const feeTypeCode = suffix === "REG" ? "REGISTRATION" : "TUITION";
  const periodLabel = suffix === "REG" ? "Annuel" : "Trimestre 1";
  const periodKey = suffix === "REG" ? "ANNUAL" : "T1";
  const dueDate = suffix === "REG" ? "2025-09-15" : "2025-10-15";
  const amountDue = money(input.amountDue);

  const result = await client.query(
    `INSERT INTO student_fee_obligations (
       school_id, student_id, class_id, fee_grid_id, school_fee_item_id,
       fee_type, fee_type_code, label, currency, academic_year,
       period_label, period_key, initial_amount, discount, exemption,
       amount_due, amount_paid, balance, due_date, status,
       source_enrollment_id, profile_payload
     ) VALUES (
       $1,$2,$3,NULL,NULL,
       $4,$5,$6,'CDF',$7,
       $8,$9,$10,0,0,
       $10,0,$10,$11,'À payer',
       $12,$13::jsonb
     )
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      enrollment.school_id,
      enrollment.student_id,
      enrollment.class_id,
      feeType,
      feeTypeCode,
      label,
      enrollment.academic_year,
      periodLabel,
      periodKey,
      amountDue,
      dueDate,
      enrollment.enrollment_id,
      JSON.stringify({
        publicId,
        studentId: enrollment.student_code,
        studentName: [enrollment.first_name, enrollment.last_name].filter(Boolean).join(" "),
        className: enrollment.class_name,
        classId: enrollment.class_id,
        schoolCode: enrollment.login_code || enrollment.school_code,
        feeTypeCode,
        periodKey,
        source: "demo-showcase-data-seed",
      }),
    ],
  );

  if (result.rows[0]?.id) return result.rows[0].id;

  const existing = await client.query(
    `SELECT id
     FROM student_fee_obligations
     WHERE school_id = $1
       AND student_id = $2
       AND academic_year = $3
       AND fee_type_code = $4
       AND period_key = $5
       AND archived_at IS NULL
     LIMIT 1`,
    [
      enrollment.school_id,
      enrollment.student_id,
      enrollment.academic_year,
      feeTypeCode,
      periodKey,
    ],
  );
  return existing.rows[0]?.id || null;
}

async function insertAllocation(client, { schoolId, paymentId, obligationId, amount }) {
  const value = money(amount);
  if (!paymentId || !obligationId || !(value > 0)) return false;
  await client.query(
    `INSERT INTO payment_allocations (school_id, payment_id, obligation_id, amount)
     SELECT $1,$2,$3,$4
     WHERE NOT EXISTS (
       SELECT 1
       FROM payment_allocations
       WHERE payment_id = $2
         AND obligation_id = $3
         AND reversed_at IS NULL
     )`,
    [schoolId, paymentId, obligationId, value],
  );
  return true;
}

async function seedDemoFinance(client) {
  await client.query("DELETE FROM payment_allocations");
  await client.query("DELETE FROM student_fee_obligations");

  const enrollments = await client.query(
    `SELECT
       e.id AS enrollment_id,
       e.school_id,
       e.student_id,
       e.class_id,
       ay.name AS academic_year,
       st.student_code,
       st.first_name,
       st.last_name,
       cl.name AS class_name,
       s.school_code,
       s.login_code,
       p.id AS payment_id,
       p.amount AS payment_amount
     FROM enrollments e
     JOIN academic_years ay ON ay.id = e.academic_year_id
     JOIN students st ON st.id = e.student_id AND st.school_id = e.school_id
     JOIN classes cl ON cl.id = e.class_id AND cl.school_id = e.school_id
     JOIN schools s ON s.id = e.school_id
     LEFT JOIN LATERAL (
       SELECT id, amount
       FROM payments
       WHERE school_id = e.school_id
         AND student_id = e.student_id
         AND payment_status = 'paid'
         AND cancelled_at IS NULL
       ORDER BY payment_date NULLS LAST, created_at, id
       LIMIT 1
     ) p ON TRUE
     WHERE lower(btrim(e.status)) = 'active'
     ORDER BY e.school_id, st.student_code, st.id`,
  );

  let obligations = 0;
  let allocations = 0;
  const statusModes = { paid: 0, partial: 0, unpaid: 0 };

  for (let index = 0; index < enrollments.rows.length; index += 1) {
    const enrollment = enrollments.rows[index];
    const mode = index % 3;
    const split = splitPayment(enrollment.payment_amount, mode);
    const registrationId = await insertObligation(client, enrollment, "REG", {
      amountDue: split.registrationDue,
    });
    const tuitionId = await insertObligation(client, enrollment, "T1", {
      amountDue: split.tuitionDue,
    });
    obligations += Number(Boolean(registrationId)) + Number(Boolean(tuitionId));

    if (enrollment.payment_id) {
      if (
        await insertAllocation(client, {
          schoolId: enrollment.school_id,
          paymentId: enrollment.payment_id,
          obligationId: registrationId,
          amount: split.registrationAllocation,
        })
      ) {
        allocations += 1;
      }
      if (
        await insertAllocation(client, {
          schoolId: enrollment.school_id,
          paymentId: enrollment.payment_id,
          obligationId: tuitionId,
          amount: split.tuitionAllocation,
        })
      ) {
        allocations += 1;
      }
    }

    if (mode === 0) statusModes.paid += 1;
    else if (mode === 1) statusModes.partial += 1;
    else statusModes.unpaid += 1;
  }

  return {
    enrollments: enrollments.rowCount,
    obligations,
    allocations,
    statusModes,
  };
}

async function seedDemoReportCards(client) {
  await client.query("DELETE FROM report_cards");

  const result = await client.query(
    `WITH source AS (
       SELECT
         e.school_id,
         e.student_id,
         e.class_id,
         e.academic_year_id,
         term.id AS term_id,
         ROW_NUMBER() OVER (PARTITION BY e.school_id ORDER BY st.student_code, st.id) AS ordinal
       FROM enrollments e
       JOIN students st ON st.id = e.student_id AND st.school_id = e.school_id
       JOIN LATERAL (
         SELECT t.id
         FROM terms t
         WHERE t.academic_year_id = e.academic_year_id
         ORDER BY t.start_date, t.created_at, t.id
         LIMIT 1
       ) term ON TRUE
       WHERE lower(btrim(e.status)) = 'active'
     )
     INSERT INTO report_cards (
       school_id, student_id, class_id, academic_year_id, term_id,
       status, generated_at, published_at, created_at, updated_at
     )
     SELECT
       school_id,
       student_id,
       class_id,
       academic_year_id,
       term_id,
       CASE WHEN MOD(ordinal, 3) = 0 THEN 'published' ELSE 'generated' END,
       NOW() - ((ordinal % 10)::text || ' days')::interval,
       CASE WHEN MOD(ordinal, 3) = 0 THEN NOW() - ((ordinal % 7)::text || ' days')::interval ELSE NULL END,
       NOW(),
       NOW()
     FROM source
     ON CONFLICT (school_id, student_id, academic_year_id, term_id)
     DO UPDATE SET
       class_id = EXCLUDED.class_id,
       status = EXCLUDED.status,
       generated_at = EXCLUDED.generated_at,
       published_at = EXCLUDED.published_at,
       updated_at = NOW()
     RETURNING id`,
  );

  return { reportCards: result.rowCount };
}

async function verifyShowcaseData(client) {
  const result = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM student_fee_obligations WHERE archived_at IS NULL) AS obligations,
       (SELECT COUNT(*)::int FROM payment_allocations WHERE reversed_at IS NULL) AS allocations,
       (SELECT COUNT(*)::int FROM report_cards WHERE status <> 'archived') AS report_cards,
       (SELECT COUNT(*)::int FROM student_fee_obligations WHERE status = 'Payé') AS paid_obligations,
       (SELECT COUNT(*)::int FROM student_fee_obligations WHERE status = 'Partiellement payé') AS partial_obligations,
       (SELECT COUNT(*)::int FROM student_fee_obligations WHERE status IN ('À payer', 'En retard')) AS unpaid_obligations`,
  );
  const counts = result.rows[0] || {};
  if (
    Number(counts.obligations) < 1 ||
    Number(counts.allocations) < 1 ||
    Number(counts.report_cards) < 1 ||
    Number(counts.paid_obligations) < 1 ||
    Number(counts.partial_obligations) < 1 ||
    Number(counts.unpaid_obligations) < 1
  ) {
    throw new Error(`DEMO_SHOWCASE_DATA_INCOMPLETE:${JSON.stringify(counts)}`);
  }
  return counts;
}

async function seedDemoShowcaseData(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const finance = await seedDemoFinance(client);
    const reportCards = await seedDemoReportCards(client);
    const verified = await verifyShowcaseData(client);
    await client.query("COMMIT");
    return { finance, reportCards, verified };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = {
  money,
  splitPayment,
  seedDemoFinance,
  seedDemoReportCards,
  verifyShowcaseData,
  seedDemoShowcaseData,
};
