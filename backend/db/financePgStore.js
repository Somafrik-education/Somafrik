"use strict";

const { randomUUID } = require("node:crypto");
const {
  FINANCE_ERROR,
  createFinanceError,
  asTrimmed,
  money,
  mapPaymentRow,
  mapObligationRow,
  mapGridRow,
  mapItemRow,
  mapReminderRow,
  mapStatusRow,
  studentMatches,
  obligationStatus,
  toIsoDate,
  mapBoStatusToDb,
  parsePayload,
} = require("../lib/financeManagement");
const financeService = require("../lib/financeService");

function createFinancePgStore(repo) {
  function bind(client) {
    const one = (sql, params) => (client.one ? client.one(sql, params) : repo.one(sql, params));
    const all = (sql, params) => (client.all ? client.all(sql, params) : repo.all(sql, params));
    const query = (sql, params) => (client.query ? client.query(sql, params) : repo.query(sql, params));

    return {
      async getSchoolByCode(code) {
        const row = await one("SELECT * FROM schools WHERE school_code = $1", [asTrimmed(code).toUpperCase()]);
        if (!row) return null;
        return { ...row, code: row.school_code, currency: row.currency || parsePayload(row.profile_payload).currency || "CDF" };
      },
      async findStudent(studentKey, principal) {
        const key = asTrimmed(studentKey);
        const schoolCode = asTrimmed(principal?.schoolCode);
        const params = [key, key];
        let sql = `
          SELECT st.*, s.school_code, cl.name AS class_name
          FROM students st
          JOIN schools s ON s.id = st.school_id
          LEFT JOIN enrollments e ON e.student_id = st.id AND e.status = 'active'
          LEFT JOIN classes cl ON cl.id = e.class_id
          WHERE st.student_code = $1 OR st.id::text = $2
        `;
        if (schoolCode && schoolCode !== "*") {
          sql += " AND s.school_code = $3";
          params.push(schoolCode.toUpperCase());
        }
        sql += " LIMIT 1";
        const row = await one(sql, params);
        if (!row) return null;
        const profile = parsePayload(row.profile_payload);
        return {
          id: profile.publicId || profile.id || row.student_code,
          dbId: row.id,
          publicId: profile.publicId || row.student_code,
          studentCode: row.student_code,
          firstName: row.first_name,
          lastName: row.last_name,
          name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
          schoolCode: row.school_code,
          className: row.class_name || profile.className || "",
        };
      },
      async listStudentsInClass(schoolCode, className) {
        const rows = await all(
          `SELECT st.*, s.school_code, cl.name AS class_name
           FROM students st
           JOIN schools s ON s.id = st.school_id
           JOIN enrollments e ON e.student_id = st.id AND e.status = 'active'
           JOIN classes cl ON cl.id = e.class_id
           WHERE s.school_code = $1 AND lower(btrim(cl.name)) = lower(btrim($2))`,
          [asTrimmed(schoolCode).toUpperCase(), className],
        );
        return rows.map((row) => {
          const profile = parsePayload(row.profile_payload);
          return {
            id: profile.publicId || row.student_code,
            dbId: row.id,
            publicId: profile.publicId || row.student_code,
            studentCode: row.student_code,
            firstName: row.first_name,
            lastName: row.last_name,
            name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
            schoolCode: row.school_code,
            className: row.class_name,
          };
        });
      },
      async listPaymentCodes(schoolId) {
        const rows = await all("SELECT payment_code FROM payments WHERE school_id = $1", [schoolId]);
        return rows.map((row) => row.payment_code);
      },
      async insertPayment(payment) {
        try {
          const row = await one(
            `INSERT INTO payments (
               school_id, student_id, payment_code, amount, currency, payment_method, payment_status,
               payment_date, description, fee_type, profile_payload, created_at, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),NOW())
             RETURNING *, $12::text AS school_code, $13::text AS student_code`,
            [
              payment.schoolId,
              payment.studentDbId,
              payment.reference,
              payment.amount,
              payment.currency,
              payment.method,
              mapBoStatusToDb(payment.status),
              payment.date,
              payment.comment,
              payment.feeType,
              JSON.stringify(payment),
              payment.schoolCode,
              payment.studentId,
            ],
          );
          return mapPaymentRow(row);
        } catch (error) {
          if (error.code === "23505") {
            throw createFinanceError(409, "Référence de paiement dupliquée.", FINANCE_ERROR.PAYMENT_REFERENCE_DUPLICATE);
          }
          throw error;
        }
      },
      async getPaymentByCode(code, principal) {
        const params = [code, code];
        let sql = `
          SELECT p.*, s.school_code, st.student_code
          FROM payments p
          JOIN schools s ON s.id = p.school_id
          JOIN students st ON st.id = p.student_id
          WHERE p.payment_code = $1 OR p.id::text = $2
        `;
        const schoolCode = asTrimmed(principal?.schoolCode);
        if (schoolCode && schoolCode !== "*") {
          sql += " AND s.school_code = $3";
          params.push(schoolCode.toUpperCase());
        }
        sql += " LIMIT 1";
        const row = await one(sql, params);
        return row ? mapPaymentRow(row) : null;
      },
      async cancelPayment(dbId, reason) {
        const row = await one(
          `UPDATE payments
           SET cancelled_at = NOW(), cancel_reason = $2::text, payment_status = 'cancelled',
               profile_payload = COALESCE(profile_payload, '{}'::jsonb) || jsonb_build_object('status','Annulé','cancelReason',$2::text),
               updated_at = NOW()
           WHERE id = $1 AND cancelled_at IS NULL
           RETURNING *`,
          [dbId, reason],
        );
        const persisted = row || await one("SELECT * FROM payments WHERE id = $1", [dbId]);
        if (!persisted) throw createFinanceError(404, "Paiement introuvable.", FINANCE_ERROR.PAYMENT_NOT_FOUND);
        const school = await one("SELECT school_code FROM schools WHERE id = $1", [persisted.school_id]);
        const student = await one("SELECT student_code FROM students WHERE id = $1", [persisted.student_id]);
        return mapPaymentRow({ ...persisted, school_code: school?.school_code, student_code: student?.student_code });
      },
      async listObligationsByStudent(schoolId, studentDbId, { lock } = {}) {
        const sql = `
          SELECT o.*, s.school_code, st.student_code
          FROM student_fee_obligations o
          JOIN schools s ON s.id = o.school_id
          JOIN students st ON st.id = o.student_id
          WHERE o.school_id = $1 AND o.student_id = $2
          ${lock ? "FOR UPDATE OF o" : ""}
        `;
        const rows = await all(sql, [schoolId, studentDbId]);
        return rows.map(mapObligationRow);
      },
      async getObligation(id) {
        const row = await one(
          `SELECT o.*, s.school_code, st.student_code
           FROM student_fee_obligations o
           JOIN schools s ON s.id = o.school_id
           JOIN students st ON st.id = o.student_id
           WHERE o.id = $1`,
          [id],
        );
        return row ? mapObligationRow(row) : null;
      },
      async getObligationByPublicId(id) {
        const row = await one(
          `SELECT o.*, s.school_code, st.student_code
           FROM student_fee_obligations o
           JOIN schools s ON s.id = o.school_id
           JOIN students st ON st.id = o.student_id
           WHERE o.id::text = $1 OR COALESCE(o.profile_payload->>'publicId','') = $1
           LIMIT 1`,
          [id],
        );
        return row ? mapObligationRow(row) : null;
      },
      async updateObligation(fee) {
        const row = await one(
          `UPDATE student_fee_obligations
           SET amount_paid = $2, discount = $3, exemption = $4, amount_due = $5, balance = $6, status = $7,
               archived_at = CASE WHEN $8 THEN NOW() ELSE archived_at END,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [fee.dbId || fee.id, fee.amountPaid, fee.discount || 0, fee.exemption || 0, fee.amountDue, fee.balance, fee.status, Boolean(fee.archived)],
        );
        return mapObligationRow({ ...row, school_code: fee.schoolCode, student_code: fee.studentId, profile_payload: { publicId: fee.id, studentId: fee.studentId, studentName: fee.studentName, className: fee.className, schoolCode: fee.schoolCode } });
      },
      async insertAllocation(row) {
        await query(
          `INSERT INTO payment_allocations (school_id, payment_id, obligation_id, amount)
           VALUES ($1,$2,$3,$4)`,
          [row.schoolId, row.paymentId, row.obligationId, row.amount],
        );
      },
      async listAllocations(paymentId) {
        const rows = await all(
          "SELECT * FROM payment_allocations WHERE payment_id = $1",
          [paymentId],
        );
        return rows.map((row) => ({
          obligationId: row.obligation_id,
          amount: money(row.amount),
          reversedAt: row.reversed_at,
        }));
      },
      async reverseAllocations(paymentId) {
        await query(
          "UPDATE payment_allocations SET reversed_at = NOW() WHERE payment_id = $1 AND reversed_at IS NULL",
          [paymentId],
        );
      },
      async upsertGrid(input) {
        const duplicate = await one(
          `SELECT * FROM fee_grids
           WHERE school_id = $1 AND lower(btrim(class_name)) = lower(btrim($2))
             AND lower(btrim(academic_year)) = lower(btrim($3))
             AND lower(btrim(period_name)) = lower(btrim($4))
             AND ($5::text IS NULL OR grid_code <> $5)
           LIMIT 1`,
          [input.schoolId, input.className, input.academicYear, input.periodName || "", input.id || null],
        );
        if (duplicate) {
          throw createFinanceError(409, "Une grille existe déjà pour cette classe et cette année.", FINANCE_ERROR.FEE_GRID_DUPLICATE);
        }
        const gridCode = input.id || `FEEGRID-${randomUUID()}`;
        const row = await one(
          `INSERT INTO fee_grids (
             school_id, grid_code, name, class_name, academic_year, period_name, currency, status, profile_payload
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
           ON CONFLICT (school_id, grid_code) DO UPDATE SET
             name = EXCLUDED.name,
             class_name = EXCLUDED.class_name,
             academic_year = EXCLUDED.academic_year,
             period_name = EXCLUDED.period_name,
             currency = EXCLUDED.currency,
             status = EXCLUDED.status,
             profile_payload = EXCLUDED.profile_payload,
             updated_at = NOW()
           RETURNING *`,
          [input.schoolId, gridCode, input.name, input.className, input.academicYear, input.periodName || "", input.currency, input.status, JSON.stringify(input)],
        );
        return mapGridRow({ ...row, school_code: input.schoolCode });
      },
      async getGrid(gridId) {
        const row = await one(
          `SELECT g.*, s.school_code FROM fee_grids g
           JOIN schools s ON s.id = g.school_id
           WHERE g.grid_code = $1 OR g.id::text = $1
           LIMIT 1`,
          [gridId],
        );
        return row ? mapGridRow(row) : null;
      },
      async setGridStatus(dbId, status) {
        const row = await one(
          `UPDATE fee_grids SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
          [dbId, status],
        );
        const school = await one("SELECT school_code FROM schools WHERE id = $1", [row.school_id]);
        return mapGridRow({ ...row, school_code: school?.school_code });
      },
      async replaceGridItems(grid, items) {
        await query("DELETE FROM school_fee_items WHERE fee_grid_id = $1", [grid.dbId]);
        for (const item of items) {
          await query(
            `INSERT INTO school_fee_items (
               school_id, fee_grid_id, item_code, fee_type, label, amount, due_date, period_label,
               monthly_months, mandatory, status, profile_payload
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb)`,
            [
              item.schoolId,
              grid.dbId,
              item.id || `FEEITEM-${randomUUID()}`,
              item.feeType,
              item.label,
              money(item.amount),
              toIsoDate(item.dueDate),
              item.periodLabel || "",
              JSON.stringify(item.monthlyMonths || []),
              item.mandatory !== false,
              item.status || "Actif",
              JSON.stringify({ ...item, gridCode: grid.id, schoolCode: item.schoolCode }),
            ],
          );
        }
      },
      async listItemsByGrid(gridDbId) {
        const rows = await all(
          `SELECT i.*, g.grid_code, s.school_code
           FROM school_fee_items i
           JOIN fee_grids g ON g.id = i.fee_grid_id
           JOIN schools s ON s.id = i.school_id
           WHERE i.fee_grid_id = $1`,
          [gridDbId],
        );
        return rows.map(mapItemRow);
      },
      async insertObligationIfAbsent(input) {
        const period = input.periodLabel || "";
        const amount = money(input.item.amount);
        const amounts = obligationStatus({ amountDue: amount, amountPaid: 0, exemption: 0, dueDate: input.item.dueDate });
        try {
          await query("SAVEPOINT finance_obligation_insert");
          await query(
            `INSERT INTO student_fee_obligations (
               school_id, student_id, fee_grid_id, school_fee_item_id, fee_type, label, currency,
               academic_year, period_label, initial_amount, amount_due, amount_paid, balance, due_date, status,
               profile_payload
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,0,$11,$12,$13,$14::jsonb)`,
            [
              input.schoolId,
              input.student.dbId,
              input.grid.id,
              input.item.id,
              input.item.feeType,
              period ? `${input.item.label} — ${period}` : input.item.label,
              input.grid.currency,
              input.grid.academicYear,
              period,
              amount,
              amounts.balance,
              toIsoDate(input.item.dueDate),
              amounts.status,
              JSON.stringify({
                publicId: `STUFEE-${randomUUID()}`,
                studentId: input.student.publicId || input.student.studentCode,
                studentName: `${input.student.firstName ?? ""} ${input.student.lastName ?? input.student.name ?? ""}`.trim(),
                className: input.grid.className,
                schoolCode: input.schoolCode,
              }),
            ],
          );
          await query("RELEASE SAVEPOINT finance_obligation_insert");
          return true;
        } catch (error) {
          try {
            await query("ROLLBACK TO SAVEPOINT finance_obligation_insert");
          } catch {
            /* ignore */
          }
          if (error.code === "23505") return false;
          throw error;
        }
      },
      async insertTariffHistory(row) {
        await query(
          `INSERT INTO fee_tariff_history (school_id, fee_grid_id, action, actor_id, payload)
           VALUES ($1,$2,$3,$4,$5::jsonb)`,
          [row.schoolId, row.feeGridId, row.action, row.actorId, JSON.stringify(row.payload || {})],
        );
      },
      async listRemindersByStudent(studentDbId) {
        const rows = await all(
          `SELECT r.*, s.school_code, st.student_code
           FROM payment_reminders r
           JOIN schools s ON s.id = r.school_id
           JOIN students st ON st.id = r.student_id
           WHERE r.student_id = $1
           ORDER BY r.sent_at DESC`,
          [studentDbId],
        );
        return rows.map(mapReminderRow);
      },
      async insertReminder(reminder) {
        const row = await one(
          `INSERT INTO payment_reminders (
             school_id, student_id, recipient, channel, message, summary, send_status, sent_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING *`,
          [
            reminder.schoolId,
            reminder.studentDbId,
            reminder.recipient,
            reminder.channel,
            reminder.message,
            reminder.summary,
            reminder.sendStatus,
            reminder.sentAt,
          ],
        );
        return mapReminderRow({ ...row, school_code: reminder.schoolCode, student_code: reminder.studentId, profile_payload: reminder });
      },
    };
  }

  const api = {
    async withTransaction(fn) {
      return repo.withTransaction(async (tx) => {
        const scoped = repo.createTxScope(tx);
        return fn(bind(scoped));
      });
    },
    async listProjection() {
      const [payments, statuses, grids, items, fees, history, reminders] = await Promise.all([
        repo.all(
          `SELECT p.*, s.school_code, st.student_code
           FROM payments p
           JOIN schools s ON s.id = p.school_id
           JOIN students st ON st.id = p.student_id
           ORDER BY p.created_at`,
        ),
        repo.all(
          `SELECT ps.*, s.school_code FROM payment_statuses ps LEFT JOIN schools s ON s.id = ps.school_id`,
        ),
        repo.all(
          `SELECT g.*, s.school_code FROM fee_grids g JOIN schools s ON s.id = g.school_id ORDER BY g.created_at`,
        ),
        repo.all(
          `SELECT i.*, g.grid_code, s.school_code
           FROM school_fee_items i
           JOIN fee_grids g ON g.id = i.fee_grid_id
           JOIN schools s ON s.id = i.school_id`,
        ),
        repo.all(
          `SELECT o.*, s.school_code, st.student_code
           FROM student_fee_obligations o
           JOIN schools s ON s.id = o.school_id
           JOIN students st ON st.id = o.student_id
           ORDER BY o.created_at`,
        ),
        repo.all(`SELECT * FROM fee_tariff_history ORDER BY created_at DESC`),
        repo.all(
          `SELECT r.*, s.school_code, st.student_code
           FROM payment_reminders r
           JOIN schools s ON s.id = r.school_id
           JOIN students st ON st.id = r.student_id
           ORDER BY r.sent_at DESC`,
        ),
      ]);
      return {
        payments: payments.map(mapPaymentRow),
        paymentStatuses: statuses.map(mapStatusRow),
        feeGrids: grids.map(mapGridRow),
        schoolFeeItems: items.map(mapItemRow),
        studentFees: fees.map(mapObligationRow),
        feeTariffHistory: history.map((row) => ({
          id: row.id,
          feeGridId: row.fee_grid_id,
          action: row.action,
          createdAt: row.created_at,
          payload: parsePayload(row.payload),
        })),
        paymentReminders: reminders.map(mapReminderRow),
      };
    },
    createSchoolPayment: (payload, principal) => financeService.createPayment(api, payload, principal),
    getSchoolPayment: (id, principal) => bind(repo).getPaymentByCode(id, principal),
    cancelSchoolPayment: (id, reason, principal) => financeService.cancelPayment(api, id, reason, principal),
    upsertFinanceFeeGrid: (payload, principal) => financeService.upsertFeeGrid(api, payload, principal),
    getFinanceFeeGrid: async (id, principal) => {
      const grid = await bind(repo).getGrid(id, principal);
      if (!grid) return null;
      return { grid, items: await bind(repo).listItemsByGrid(grid.dbId) };
    },
    setFinanceFeeGridStatus: (id, status, principal) => financeService.setFeeGridStatus(api, id, status, principal),
    applyFinanceFeeGrid: (id, principal, options) => financeService.applyFeeGrid(api, id, principal, options),
    listFinanceFeeGrids: async () => {
      const rows = await repo.all(
        `SELECT g.*, s.school_code FROM fee_grids g JOIN schools s ON s.id = g.school_id ORDER BY g.created_at`,
      );
      return rows.map(mapGridRow);
    },
    listFinanceStudentFees: async () => {
      const rows = await repo.all(
        `SELECT o.*, s.school_code, st.student_code
         FROM student_fee_obligations o
         JOIN schools s ON s.id = o.school_id
         JOIN students st ON st.id = o.student_id`,
      );
      return rows.map(mapObligationRow);
    },
    getFinanceStudentFee: (id, principal) => bind(repo).getObligationByPublicId(id, principal),
    adjustFinanceStudentFee: (id, patch, principal) => financeService.adjustStudentFee(api, id, patch, principal),
    createFinanceReminder: (studentId, payload, principal, options) =>
      financeService.createReminder(api, studentId, payload, principal, options),
    listFinancePaymentStatuses: async () => {
      const rows = await repo.all(
        `SELECT ps.*, s.school_code FROM payment_statuses ps LEFT JOIN schools s ON s.id = ps.school_id`,
      );
      return rows.map(mapStatusRow);
    },
    upsertFinancePaymentStatus: async (payload, principal) => {
        const school = principal?.schoolCode && principal.schoolCode !== "*"
          ? await bind(repo).getSchoolByCode(principal.schoolCode)
          : null;
        const code = asTrimmed(payload.code || payload.id);
        const existing = await repo.one(
          `SELECT * FROM payment_statuses WHERE status_code = $1 AND ($2::uuid IS NULL OR school_id = $2) LIMIT 1`,
          [code, school?.id || null],
        );
        const row = existing
          ? await repo.one(
              `UPDATE payment_statuses SET label = $2, is_active = $3, sort_order = $4, profile_payload = $5::jsonb, updated_at = NOW()
               WHERE id = $1 RETURNING *`,
              [existing.id, payload.label || code, payload.status !== "Inactif", Number(payload.sortOrder || 0), JSON.stringify(payload)],
            )
          : await repo.one(
              `INSERT INTO payment_statuses (school_id, status_code, label, is_active, sort_order, profile_payload)
               VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,
              [school?.id || null, code, payload.label || code, payload.status !== "Inactif", Number(payload.sortOrder || 0), JSON.stringify(payload)],
            );
        return mapStatusRow({ ...row, school_code: school?.code });
      },
  };

  return api;
}

module.exports = { createFinancePgStore };
