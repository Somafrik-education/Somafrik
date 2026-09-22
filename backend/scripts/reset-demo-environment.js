const path = require("path");
const { spawnSync } = require("child_process");
const { Pool } = require("pg");
const { hashSecret } = require("../services/credentialService");
const {
  assertDemoResetSafety,
  hardenBackOfficeCredentials,
} = require("../lib/demoResetSafety");
const { resolveDemoInternalSeedPin } = require("../lib/demoGatewayPolicy");
const { seedDemoCanonicalPlanning } = require("../lib/demoCanonicalPlanningSeed");
const { seedDemoShowcaseData } = require("../lib/demoShowcaseDataSeed");

const PUBLIC_DEMO_LOGIN_CODE = "CD-IN-26-001";
const PUBLIC_DEMO_SUBSCRIPTION_START = "01-09-2026";
const PUBLIC_DEMO_SUBSCRIPTION_END = "31-12-2099";

async function hardenDemoCredentials(databaseUrl, internalSeedPin) {
  const pool = new Pool({ connectionString: databaseUrl });
  const secretHash = hashSecret(internalSeedPin);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const users = await client.query(
      `UPDATE users
       SET password_hash = $1, pin_hash = $1, updated_at = NOW()
       WHERE status = 'active'
       RETURNING id`,
      [secretHash],
    );

    const state = await client.query(
      `SELECT state_payload
       FROM backoffice_state
       WHERE state_key = 'default'
       FOR UPDATE`,
    );
    if (state.rows[0]?.state_payload) {
      const hardenedPayload = hardenBackOfficeCredentials(state.rows[0].state_payload, secretHash);
      await client.query(
        `UPDATE backoffice_state
         SET state_payload = $1::jsonb, updated_at = NOW()
         WHERE state_key = 'default'`,
        [JSON.stringify(hardenedPayload)],
      );
    }

    await client.query("COMMIT");
    return { rotatedUsers: users.rowCount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function patchEffectiveDemoSubscriptionState(payload = {}) {
  const next = payload && typeof payload === "object" ? { ...payload } : {};
  const schools = Array.isArray(next.schools) ? next.schools.map((row) => ({ ...row })) : [];
  const subscriptions = Array.isArray(next.subscriptions)
    ? next.subscriptions.map((row) => ({ ...row }))
    : [];

  const schoolIndexes = [];
  schools.forEach((school, index) => {
    const identities = [school?.loginCode, school?.publicId, school?.code]
      .map((value) => String(value ?? "").trim().toUpperCase())
      .filter(Boolean);
    if (identities.includes(PUBLIC_DEMO_LOGIN_CODE)) schoolIndexes.push(index);
  });

  if (schoolIndexes.length !== 1) {
    throw new Error(`PUBLIC_DEMO_EFFECTIVE_SCHOOL_NOT_FOUND:${schoolIndexes.length}`);
  }

  const schoolIndex = schoolIndexes[0];
  const schoolCode = String(schools[schoolIndex]?.code ?? "").trim();
  schools[schoolIndex] = {
    ...schools[schoolIndex],
    subscriptionPlan: "Essentiel",
    subscriptionStartDate: PUBLIC_DEMO_SUBSCRIPTION_START,
    subscriptionEndDate: PUBLIC_DEMO_SUBSCRIPTION_END,
    validationStatus: "Validé",
    subscriptionStatus: "À jour",
  };

  const subscriptionIndexes = [];
  subscriptions.forEach((subscription, index) => {
    const subscriptionSchoolCode = String(subscription?.schoolCode ?? "").trim();
    if (subscriptionSchoolCode === schoolCode || subscriptionSchoolCode === PUBLIC_DEMO_LOGIN_CODE) {
      subscriptionIndexes.push(index);
    }
  });

  if (subscriptionIndexes.length !== 1) {
    throw new Error(`PUBLIC_DEMO_EFFECTIVE_SUBSCRIPTION_NOT_FOUND:${subscriptionIndexes.length}`);
  }

  const subscriptionIndex = subscriptionIndexes[0];
  subscriptions[subscriptionIndex] = {
    ...subscriptions[subscriptionIndex],
    plan: "Essentiel",
    status: "Actif",
    paymentStatus: "À jour",
    startDate: PUBLIC_DEMO_SUBSCRIPTION_START,
    endDate: PUBLIC_DEMO_SUBSCRIPTION_END,
  };

  return {
    payload: { ...next, schools, subscriptions },
    schoolCode,
    schools: schoolIndexes.length,
    subscriptions: subscriptionIndexes.length,
  };
}

function verifyEffectiveDemoSubscriptionState(payload = {}) {
  const schools = Array.isArray(payload?.schools) ? payload.schools : [];
  const subscriptions = Array.isArray(payload?.subscriptions) ? payload.subscriptions : [];
  const school = schools.find((row) =>
    [row?.loginCode, row?.publicId]
      .map((value) => String(value ?? "").trim().toUpperCase())
      .includes(PUBLIC_DEMO_LOGIN_CODE),
  );
  const schoolCode = String(school?.code ?? "").trim();
  const subscription = subscriptions.find((row) => {
    const subscriptionSchoolCode = String(row?.schoolCode ?? "").trim();
    return subscriptionSchoolCode === schoolCode || subscriptionSchoolCode === PUBLIC_DEMO_LOGIN_CODE;
  });

  return Boolean(
    school &&
      school.subscriptionPlan === "Essentiel" &&
      school.subscriptionStartDate === PUBLIC_DEMO_SUBSCRIPTION_START &&
      school.subscriptionEndDate === PUBLIC_DEMO_SUBSCRIPTION_END &&
      school.validationStatus === "Validé" &&
      school.subscriptionStatus === "À jour" &&
      subscription &&
      subscription.plan === "Essentiel" &&
      subscription.status === "Actif" &&
      subscription.paymentStatus === "À jour" &&
      subscription.startDate === PUBLIC_DEMO_SUBSCRIPTION_START &&
      subscription.endDate === PUBLIC_DEMO_SUBSCRIPTION_END,
  );
}

async function keepPublicDemoSubscriptionActive(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE subscriptions sub
       SET status = 'active',
           start_date = DATE '2026-09-01',
           end_date = DATE '2099-12-31',
           updated_at = NOW()
       FROM schools s
       WHERE sub.school_id = s.id
         AND s.login_code = $1
       RETURNING sub.id, TO_CHAR(sub.end_date, 'YYYY-MM-DD') AS end_date, sub.status`,
      [PUBLIC_DEMO_LOGIN_CODE],
    );
    if (result.rowCount !== 1) {
      throw new Error(`PUBLIC_DEMO_SUBSCRIPTION_NOT_FOUND:${result.rowCount}`);
    }

    const state = await client.query(
      `SELECT state_payload
       FROM backoffice_state
       WHERE state_key = 'default'
       FOR UPDATE`,
    );
    if (!state.rows[0]?.state_payload) {
      throw new Error("PUBLIC_DEMO_EFFECTIVE_STATE_MISSING");
    }
    const patchedState = patchEffectiveDemoSubscriptionState(state.rows[0].state_payload);
    await client.query(
      `UPDATE backoffice_state
       SET state_payload = $1::jsonb, updated_at = NOW()
       WHERE state_key = 'default'`,
      [JSON.stringify(patchedState.payload)],
    );

    await client.query("COMMIT");
    return {
      subscriptions: result.rowCount,
      status: result.rows[0].status,
      endDate: result.rows[0].end_date,
      effectiveSchools: patchedState.schools,
      effectiveSubscriptions: patchedState.subscriptions,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function verifyDataset(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM countries) AS countries,
         (SELECT COUNT(*)::int FROM countries WHERE iso_code = 'CD') AS cd_countries,
         (SELECT COUNT(*)::int FROM schools) AS schools,
         (SELECT COUNT(*)::int FROM schools WHERE login_code = 'CD-IN-26-001') AS public_demo_schools,
         (SELECT COUNT(*)::int
            FROM subscriptions sub
            JOIN schools s ON s.id = sub.school_id
           WHERE s.login_code = 'CD-IN-26-001'
             AND sub.status = 'active'
             AND sub.end_date >= CURRENT_DATE) AS valid_demo_subscriptions,
         (SELECT COUNT(*)::int FROM classes) AS classes,
         (SELECT COUNT(*)::int FROM students) AS students,
         (SELECT COUNT(*)::int FROM teachers) AS teachers,
         (SELECT COUNT(*)::int FROM teacher_assignments WHERE status = 'active') AS teacher_assignments,
         (SELECT COUNT(*)::int FROM payments) AS payments,
         (SELECT COUNT(*)::int FROM student_fee_obligations WHERE archived_at IS NULL) AS student_fee_obligations,
         (SELECT COUNT(*)::int FROM payment_allocations WHERE reversed_at IS NULL) AS payment_allocations,
         (SELECT COUNT(*)::int FROM report_cards WHERE status <> 'archived') AS report_cards,
         (SELECT COUNT(*)::int FROM course_schedule_weekly_slots WHERE status = 'active') AS course_schedule_weekly_slots,
         (SELECT COUNT(*)::int FROM users WHERE role IN ('SUPER_ADMIN','COUNTRY_ADMIN')) AS privileged_users,
         (SELECT COUNT(*)::int FROM users WHERE COALESCE(phone, '') <> '') AS users_with_phone,
         (SELECT COUNT(*)::int FROM users WHERE COALESCE(email, '') <> '' AND email NOT LIKE '%@demo.somafrik.invalid') AS users_with_external_email,
         (SELECT COUNT(*)::int FROM students WHERE COALESCE(parent_phone, '') <> '') AS students_with_parent_phone,
         (SELECT COUNT(*)::int FROM students WHERE COALESCE(parent_email, '') <> '' AND parent_email NOT LIKE '%@demo.somafrik.invalid') AS students_with_external_parent_email,
         (SELECT COUNT(*)::int FROM schools WHERE COALESCE(phone, '') <> '' OR COALESCE(email, '') NOT LIKE '%@demo.somafrik.invalid') AS schools_with_external_contact`,
    );
    const counts = result.rows[0];
    const state = await pool.query(
      `SELECT state_payload
       FROM backoffice_state
       WHERE state_key = 'default'`,
    );
    counts.effective_demo_subscription_state = verifyEffectiveDemoSubscriptionState(
      state.rows[0]?.state_payload,
    )
      ? 1
      : 0;

    const invalidShape =
      !counts ||
      counts.countries !== 1 ||
      counts.cd_countries !== 1 ||
      counts.schools !== 1 ||
      counts.public_demo_schools !== 1 ||
      counts.valid_demo_subscriptions !== 1 ||
      counts.effective_demo_subscription_state !== 1 ||
      counts.classes !== 10 ||
      counts.students !== 200 ||
      counts.teachers !== 20 ||
      counts.teacher_assignments < 40 ||
      counts.payments !== 200 ||
      counts.student_fee_obligations !== 400 ||
      counts.payment_allocations < 1 ||
      counts.report_cards !== 200 ||
      counts.course_schedule_weekly_slots < 40 ||
      counts.privileged_users !== 0 ||
      counts.users_with_phone !== 0 ||
      counts.users_with_external_email !== 0 ||
      counts.students_with_parent_phone !== 0 ||
      counts.students_with_external_parent_email !== 0 ||
      counts.schools_with_external_contact !== 0;

    if (invalidShape) {
      throw new Error(`Dataset public Démo invalide : ${JSON.stringify(counts || {})}`);
    }
    return counts;
  } finally {
    await pool.end();
  }
}

async function main() {
  const { databaseUrl } = assertDemoResetSafety(process.env);
  const internalSeedPin = resolveDemoInternalSeedPin(process.env);
  const seedScript = path.join(__dirname, "seed-demo-public.js");

  console.log("Reset contrôlé du dataset public Démo…");
  const run = spawnSync(process.execPath, [seedScript, "--fresh"], {
    cwd: path.join(__dirname, "..", ".."),
    env: process.env,
    stdio: "inherit",
  });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    throw new Error(`Seed public Démo échoué (code ${run.status}).`);
  }

  const subscription = await keepPublicDemoSubscriptionActive(databaseUrl);
  const planning = await seedDemoCanonicalPlanning(databaseUrl);
  const showcase = await seedDemoShowcaseData(databaseUrl);
  const hardening = await hardenDemoCredentials(databaseUrl, internalSeedPin);
  const counts = await verifyDataset(databaseUrl);
  console.log(`Abonnement public Démo actif : ${JSON.stringify(subscription)}.`);
  console.log(`Planning Démo canonique : ${JSON.stringify(planning)}.`);
  console.log(`Showcase Démo canonique : ${JSON.stringify(showcase)}.`);
  console.log(`Credentials Démo durcis : ${hardening.rotatedUsers} comptes.`);
  console.log(`Dataset public Démo vérifié : ${JSON.stringify(counts)}`);
  console.log("Rappel : seul le port public de la passerelle Démo doit être publié.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  hardenDemoCredentials,
  keepPublicDemoSubscriptionActive,
  patchEffectiveDemoSubscriptionState,
  verifyDataset,
  verifyEffectiveDemoSubscriptionState,
};
