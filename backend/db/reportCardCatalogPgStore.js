"use strict";

/**
 * BULLETIN-CATALOG-01 — persistance du catalogue de modèles et de leur
 * disponibilité par pays. Aucune donnée d'élève, de note ni de bulletin n'est
 * lue ici : uniquement modèles, pays (`countries`), disponibilité et historique,
 * plus, pour un établissement, son pays et ses référentiels pédagogiques
 * (matières, types d'évaluation, trimestres) bornés à `school_id`.
 */

function text(value) {
  return value == null ? "" : String(value).trim();
}

/** Tables absentes (migration non appliquée) : catalogue indisponible, jamais une liste vide. */
function unavailable(err) {
  if (err && err.code === "42P01") {
    const wrapped = new Error("CATALOG_UNAVAILABLE");
    wrapped.code = "CATALOG_UNAVAILABLE";
    return wrapped;
  }
  return err;
}

function createReportCardCatalogPgStore(db) {
  const rawPool = db && db.pool ? db.pool : db;
  if (!rawPool || typeof rawPool.query !== "function") throw new Error("PostgreSQL requis.");
  const pool = {
    query: (...args) => rawPool.query(...args).catch((err) => Promise.reject(unavailable(err))),
    connect: async () => {
      const client = await rawPool.connect();
      return {
        query: (...args) => client.query(...args).catch((err) => Promise.reject(unavailable(err))),
        release: () => client.release(),
      };
    },
  };

  async function listModels() {
    const result = await pool.query(
      `SELECT model_id, version, name, description, presentation_style, status, updated_at
         FROM report_card_catalog_models ORDER BY model_id`,
    );
    return result.rows;
  }

  async function getModel(modelId) {
    const result = await pool.query(
      `SELECT model_id, version, name, description, presentation_style, status
         FROM report_card_catalog_models WHERE model_id = $1`,
      [text(modelId)],
    );
    return result.rows[0] || null;
  }

  async function listCountries() {
    const result = await pool.query(`SELECT id::text AS id, name, iso_code FROM countries ORDER BY name, iso_code`);
    return result.rows;
  }

  async function getCountry(countryId) {
    const result = await pool.query(`SELECT id::text AS id, name, iso_code FROM countries WHERE id::text = $1`, [
      text(countryId),
    ]);
    return result.rows[0] || null;
  }

  async function listAvailability() {
    const result = await pool.query(
      `SELECT model_id, country_id::text AS country_id, available, updated_by, updated_at
         FROM report_card_catalog_availability`,
    );
    return result.rows;
  }

  async function isAvailable(modelId, countryId) {
    if (!text(modelId) || !text(countryId)) return false;
    const result = await pool.query(
      `SELECT a.available
         FROM report_card_catalog_availability a
         JOIN report_card_catalog_models m ON m.model_id = a.model_id
        WHERE a.model_id = $1 AND a.country_id::text = $2 AND m.status = 'active'`,
      [text(modelId), text(countryId)],
    );
    return result.rows[0]?.available === true;
  }

  /** Modification + trace d'audit dans la même transaction (verrou de ligne). */
  async function setAvailability({ modelId, countryId, available, actorId }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT available FROM report_card_catalog_availability
          WHERE model_id = $1 AND country_id::text = $2 FOR UPDATE`,
        [modelId, countryId],
      );
      const previous = current.rows.length ? current.rows[0].available : null;
      if (previous === available) {
        await client.query("ROLLBACK");
        return { changed: false, previous, available };
      }
      await client.query(
        `INSERT INTO report_card_catalog_availability (model_id, country_id, available, updated_by, updated_at)
         VALUES ($1, $2::uuid, $3, $4, NOW())
         ON CONFLICT (model_id, country_id)
         DO UPDATE SET available = EXCLUDED.available, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [modelId, countryId, available, actorId],
      );
      const audit = await client.query(
        `INSERT INTO report_card_catalog_availability_audit (model_id, country_id, old_available, new_available, actor_id)
         VALUES ($1, $2::uuid, $3, $4, $5)
         RETURNING id, model_id, country_id::text AS country_id, old_available, new_available, actor_id, created_at`,
        [modelId, countryId, previous, available, actorId],
      );
      await client.query("COMMIT");
      return { changed: true, previous, available, audit: audit.rows[0] };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async function listAudit({ modelId, limit = 200 } = {}) {
    const params = [];
    let where = "";
    if (text(modelId)) {
      params.push(text(modelId));
      where = "WHERE a.model_id = $1";
    }
    params.push(Math.max(1, Math.min(500, Number(limit) || 200)));
    const result = await pool.query(
      `SELECT a.id, a.model_id, a.country_id::text AS country_id, c.name AS country_name,
              a.old_available, a.new_available, a.actor_id, a.created_at,
              NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS actor_label
         FROM report_card_catalog_availability_audit a
         JOIN countries c ON c.id = a.country_id
         LEFT JOIN users u ON u.id::text = a.actor_id
         ${where}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $${params.length}`,
      params,
    );
    return result.rows;
  }

  /** Pays de l'établissement : source canonique `schools.country_id`. */
  async function schoolCountry(schoolId) {
    const result = await pool.query(
      `SELECT c.id::text AS id, c.name, c.iso_code
         FROM schools s JOIN countries c ON c.id = s.country_id
        WHERE s.id::text = $1`,
      [text(schoolId)],
    );
    return result.rows[0] || null;
  }

  /**
   * BULLETIN-CLASSE-01 / L2 — classe de l'établissement (null si inconnue ou d'un autre
   * établissement) et son année scolaire, source de vérité de la portée.
   */
  async function classScope(schoolId, classId) {
    const id = text(classId);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const result = await pool.query(
      `SELECT c.id::text AS class_id, c.academic_year_id::text AS academic_year_id, c.name,
              y.name AS academic_year_name
         FROM classes c JOIN academic_years y ON y.id = c.academic_year_id AND y.school_id = c.school_id
        WHERE c.id::text = $1 AND c.school_id::text = $2`,
      [id, text(schoolId)]
    );
    return result.rows[0] || null;
  }

  /**
   * Référentiels de configuration (aucune donnée d'élève). Avec une classe : seules les
   * matières ayant un cours actif dans la classe (et la matière principale de chaque
   * sous-matière enseignée), et les périodes de l'année de la classe.
   */
  async function classContext(schoolId, scope) {
    const tenant = text(schoolId);
    const [subjects, types, terms] = await Promise.all([
      pool.query(
        `WITH taught AS (
           SELECT DISTINCT sc.subject_id FROM school_courses sc
            WHERE sc.school_id::text = $1 AND sc.class_id::text = $2 AND sc.status = 'active'
         )
         SELECT s.subject_code AS code, s.name, s.status, s.display_order, p.subject_code AS parent_code
           FROM subjects s
           LEFT JOIN subjects p ON p.id = s.parent_subject_id AND p.school_id = s.school_id
          WHERE s.school_id::text = $1
            AND (s.id IN (SELECT subject_id FROM taught)
                 OR EXISTS (SELECT 1 FROM subjects child JOIN taught t ON t.subject_id = child.id
                             WHERE child.parent_subject_id = s.id AND child.school_id = s.school_id))
          ORDER BY s.display_order NULLS LAST, s.name, s.subject_code COLLATE "C"`,
        [tenant, scope.class_id]
      ),
      pool.query(`SELECT code, name, status FROM evaluation_types WHERE school_id::text = $1 ORDER BY display_order, code`, [tenant]),
      pool.query(
        `SELECT t.name FROM terms t WHERE t.academic_year_id::text = $1 ORDER BY t.start_date NULLS LAST, t.name`,
        [scope.academic_year_id]
      ),
    ]);
    return {
      subjects: subjects.rows.map((row) => ({ ...row, parent_code: row.parent_code ?? null })),
      evaluationTypes: types.rows,
      terms: [...new Set(terms.rows.map((row) => text(row.name)).filter(Boolean))],
    };
  }

  /** Référentiels de configuration de l'établissement (aucune donnée d'élève). */
  async function schoolContext(schoolId) {
    const tenant = text(schoolId);
    const [subjects, types, terms] = await Promise.all([
      pool.query(
        `SELECT s.subject_code AS code, s.name, s.status, s.display_order, p.subject_code AS parent_code
           FROM subjects s
           LEFT JOIN subjects p ON p.id = s.parent_subject_id AND p.school_id = s.school_id
          WHERE s.school_id::text = $1
          ORDER BY s.display_order NULLS LAST, s.name, s.subject_code COLLATE "C"`,
        [tenant],
      ),
      pool.query(
        `SELECT code, name, status FROM evaluation_types WHERE school_id::text = $1 ORDER BY display_order, code`,
        [tenant],
      ),
      pool.query(
        `SELECT t.name
           FROM terms t JOIN academic_years y ON y.id = t.academic_year_id
          WHERE y.school_id::text = $1
          ORDER BY y.is_current DESC NULLS LAST, t.start_date NULLS LAST, t.name`,
        [tenant],
      ),
    ]);
    return {
      subjects: subjects.rows.map((row) => ({ ...row, parent_code: row.parent_code ?? null })),
      evaluationTypes: types.rows,
      terms: [...new Set(terms.rows.map((row) => text(row.name)).filter(Boolean))],
    };
  }

  return {
    listModels,
    getModel,
    listCountries,
    getCountry,
    listAvailability,
    isAvailable,
    setAvailability,
    listAudit,
    schoolCountry,
    schoolContext,
    classScope,
    classContext,
  };
}

module.exports = { createReportCardCatalogPgStore };
