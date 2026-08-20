"use strict";

const { randomUUID } = require("node:crypto");
const {
  DOCUMENTS_EXAMS_ERROR,
  asTrimmed,
  createDocumentsExamsError,
  canonicalizeExamStatus,
  parseIsoDate,
  validateTemplateLayout,
  mapExamRow,
  mapReportCardRow,
  mapTemplateRow,
  mapSchoolDocumentRow,
  classifyResidualExam,
  classifyResidualReportCard,
  classifyResidualDocument,
  ignoreClientScope,
} = require("../lib/documentsExamsManagement");

function createDocumentsExamsPgStore(repo) {
  const one = (...args) => repo.one(...args);
  const all = (...args) => repo.all(...args);
  const query = (...args) => repo.query(...args);

  async function getSchoolByCode(schoolCode) {
    return one(
      `SELECT s.id, s.school_code FROM schools s
       WHERE upper(s.school_code) = upper($1)
          OR upper(coalesce(s.login_code, '')) = upper($1)`,
      [asTrimmed(schoolCode).toUpperCase()],
    );
  }

  async function requireSchoolByCode(schoolCode) {
    const school = await getSchoolByCode(schoolCode);
    if (!school) {
      throw createDocumentsExamsError(404, "Établissement introuvable.", DOCUMENTS_EXAMS_ERROR.SCHOOL_NOT_FOUND);
    }
    return school;
  }

  async function requireOwnedRow(sql, params, label) {
    const row = await one(sql, params);
    if (!row) {
      throw createDocumentsExamsError(404, `${label} introuvable.`, DOCUMENTS_EXAMS_ERROR.NOT_FOUND);
    }
    return row;
  }

  async function listClassNames(schoolId) {
    const rows = await all(`SELECT name FROM classes WHERE school_id = $1 AND status = 'active' ORDER BY name`, [schoolId]);
    return rows.map((row) => row.name);
  }

  async function listSubjectNames(schoolId) {
    const rows = await all(`SELECT name FROM subjects WHERE school_id = $1 AND status = 'active' ORDER BY name`, [schoolId]);
    return rows.map((row) => row.name);
  }

  async function listTermNames(schoolId) {
    const rows = await all(
      `SELECT t.name
       FROM terms t
       JOIN academic_years y ON y.id = t.academic_year_id
       WHERE y.school_id = $1
       ORDER BY t.name`,
      [schoolId],
    );
    return rows.map((row) => row.name);
  }

  async function resolveClass(schoolId, payload) {
    if (payload.classId) {
      return requireOwnedRow(
        `SELECT * FROM classes WHERE id = $1 AND school_id = $2`,
        [payload.classId, schoolId],
        "Classe",
      );
    }
    const name = asTrimmed(payload.className);
    if (!name) {
      throw createDocumentsExamsError(400, "Classe obligatoire.", DOCUMENTS_EXAMS_ERROR.CLASS_REQUIRED);
    }
    const row = await one(
      `SELECT * FROM classes WHERE school_id = $1 AND lower(btrim(name)) = lower(btrim($2)) LIMIT 1`,
      [schoolId, name],
    );
    if (!row) throw createDocumentsExamsError(404, "Classe introuvable.", DOCUMENTS_EXAMS_ERROR.NOT_FOUND);
    return row;
  }

  async function resolveSubject(schoolId, payload) {
    if (payload.subjectId) {
      return requireOwnedRow(
        `SELECT * FROM subjects WHERE id = $1 AND school_id = $2`,
        [payload.subjectId, schoolId],
        "Cours",
      );
    }
    const name = asTrimmed(payload.subject);
    if (!name) {
      throw createDocumentsExamsError(400, "Cours obligatoire.", DOCUMENTS_EXAMS_ERROR.SUBJECT_REQUIRED);
    }
    const row = await one(
      `SELECT * FROM subjects WHERE school_id = $1 AND lower(btrim(name)) = lower(btrim($2)) LIMIT 1`,
      [schoolId, name],
    );
    if (!row) throw createDocumentsExamsError(404, "Cours introuvable.", DOCUMENTS_EXAMS_ERROR.NOT_FOUND);
    return row;
  }

  async function resolveOpenYear(schoolId, payload) {
    if (payload.academicYearId) {
      const year = await requireOwnedRow(
        `SELECT * FROM academic_years WHERE id = $1 AND school_id = $2`,
        [payload.academicYearId, schoolId],
        "Année scolaire",
      );
      if (!["open", "active"].includes(year.status)) {
        throw createDocumentsExamsError(409, "L'année scolaire n'est pas ouverte.", DOCUMENTS_EXAMS_ERROR.CONFLICT);
      }
      return year;
    }
    const year = await one(
      `SELECT * FROM academic_years
       WHERE school_id = $1 AND status IN ('active', 'open')
       ORDER BY is_current DESC, created_at DESC LIMIT 1`,
      [schoolId],
    );
    if (!year) {
      throw createDocumentsExamsError(400, "Aucune année scolaire ouverte.", DOCUMENTS_EXAMS_ERROR.ACADEMIC_YEAR_REQUIRED);
    }
    return year;
  }

  async function resolveTerm(year, payload) {
    if (payload.termId) {
      return requireOwnedRow(
        `SELECT * FROM terms WHERE id = $1 AND academic_year_id = $2`,
        [payload.termId, year.id],
        "Période",
      );
    }
    const name = asTrimmed(payload.period);
    if (!name) {
      throw createDocumentsExamsError(400, "Période académique obligatoire.", DOCUMENTS_EXAMS_ERROR.TERM_REQUIRED);
    }
    const row = await one(
      `SELECT * FROM terms WHERE academic_year_id = $1 AND lower(btrim(name)) = lower(btrim($2)) LIMIT 1`,
      [year.id, name],
    );
    if (!row) throw createDocumentsExamsError(404, "Période introuvable.", DOCUMENTS_EXAMS_ERROR.NOT_FOUND);
    return row;
  }

  async function resolveStudent(schoolId, payload) {
    const raw = asTrimmed(payload.studentId);
    if (!raw) {
      throw createDocumentsExamsError(400, "Élève obligatoire.", DOCUMENTS_EXAMS_ERROR.STUDENT_REQUIRED);
    }
    const row = await one(
      `SELECT * FROM students WHERE school_id = $1 AND (id::text = $2 OR student_code = $2) LIMIT 1`,
      [schoolId, raw],
    );
    if (!row) throw createDocumentsExamsError(404, "Élève introuvable.", DOCUMENTS_EXAMS_ERROR.NOT_FOUND);
    return row;
  }

  function formatExamDate(value) {
    if (typeof repo.formatIsoDate === "function") return repo.formatIsoDate(value);
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  }

  async function hydrateExam(row) {
    if (!row) return null;
    const school = await one(`SELECT school_code FROM schools WHERE id = $1`, [row.school_id]);
    const klass = row.class_id ? await one(`SELECT name FROM classes WHERE id = $1`, [row.class_id]) : null;
    const subject = row.subject_id ? await one(`SELECT name FROM subjects WHERE id = $1`, [row.subject_id]) : null;
    const term = row.term_id ? await one(`SELECT name FROM terms WHERE id = $1`, [row.term_id]) : null;
    return mapExamRow(row, {
      schoolCode: school?.school_code,
      className: klass?.name,
      subjectName: subject?.name,
      termName: term?.name,
      examDate: formatExamDate(row.exam_date),
    });
  }

  async function listExams(schoolId) {
    const rows = await all(
      `SELECT ex.*, s.school_code, cl.name AS class_name, sub.name AS subject_name, t.name AS term_name
       FROM exams ex
       JOIN schools s ON s.id = ex.school_id
       JOIN classes cl ON cl.id = ex.class_id
       LEFT JOIN subjects sub ON sub.id = ex.subject_id
       LEFT JOIN terms t ON t.id = ex.term_id
       WHERE ex.school_id = $1
       ORDER BY ex.exam_date DESC, ex.created_at DESC`,
      [schoolId],
    );
    return rows.map((row) =>
      mapExamRow(row, {
        schoolCode: row.school_code,
        className: row.class_name,
        subjectName: row.subject_name,
        termName: row.term_name,
        examDate: formatExamDate(row.exam_date),
      }),
    );
  }

  async function getExam(schoolId, examId) {
    const row = await requireOwnedRow(
      `SELECT * FROM exams WHERE id = $1 AND school_id = $2`,
      [examId, schoolId],
      "Examen",
    );
    return hydrateExam(row);
  }

  async function insertExam(schoolId, payload) {
    const body = ignoreClientScope(payload);
    const klass = await resolveClass(schoolId, body);
    const subject = await resolveSubject(schoolId, body);
    if (!subject) {
      throw createDocumentsExamsError(400, "Cours obligatoire.", DOCUMENTS_EXAMS_ERROR.SUBJECT_REQUIRED);
    }
    const year = await resolveOpenYear(schoolId, body);
    const term = await resolveTerm(year, body);
    const name = asTrimmed(body.name);
    const examDate = parseIsoDate(body.date ?? body.examDate);
    if (!name) throw createDocumentsExamsError(400, "Intitulé d'examen obligatoire.");
    if (!examDate) throw createDocumentsExamsError(400, "Date d'examen obligatoire.");
    const examType = asTrimmed(body.examType ?? body.type) || "Examen";
    const status = canonicalizeExamStatus(body.status) || "scheduled";
    const code = asTrimmed(body.code) || `EXA-${randomUUID().slice(0, 8).toUpperCase()}`;
    const duplicate = await one(
      `SELECT id FROM exams
       WHERE school_id = $1 AND class_id = $2 AND exam_date = $3 AND lower(btrim(name)) = lower(btrim($4))
         AND status <> 'archived'
       LIMIT 1`,
      [schoolId, klass.id, examDate, name],
    );
    if (duplicate) {
      throw createDocumentsExamsError(409, "Un examen identique existe déjà pour cette classe et cette date.", DOCUMENTS_EXAMS_ERROR.CONFLICT);
    }
    try {
      const row = await one(
        `INSERT INTO exams (
           school_id, class_id, subject_id, term_id, academic_year_id, evaluation_type_id,
           exam_code, name, exam_type, exam_date, starts_at, ends_at, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          schoolId,
          klass.id,
          subject?.id ?? null,
          term.id,
          year.id,
          body.evaluationTypeId || null,
          code,
          name,
          examType,
          examDate,
          body.startsAt || null,
          body.endsAt || null,
          status,
        ],
      );
      return hydrateExam(row);
    } catch (error) {
      if (error?.code === "23505") {
        throw createDocumentsExamsError(409, "Code examen déjà utilisé.", DOCUMENTS_EXAMS_ERROR.CONFLICT);
      }
      throw error;
    }
  }

  async function updateExam(schoolId, examId, payload) {
    const current = await requireOwnedRow(
      `SELECT * FROM exams WHERE id = $1 AND school_id = $2`,
      [examId, schoolId],
      "Examen",
    );
    const body = ignoreClientScope(payload);
    const nextStatus = hasStatus(body) ? canonicalizeExamStatus(body.status) : current.status;
    if (hasStatus(body) && !nextStatus) {
      throw createDocumentsExamsError(400, "Statut d'examen invalide.", DOCUMENTS_EXAMS_ERROR.INVALID_STATUS);
    }
    if (["cancelled", "archived"].includes(current.status) && nextStatus !== current.status) {
      throw createDocumentsExamsError(409, "Examen clôturé, modification refusée.", DOCUMENTS_EXAMS_ERROR.CONFLICT);
    }
    const klass = body.classId || body.className ? await resolveClass(schoolId, body) : { id: current.class_id };
    const subject =
      body.subjectId || body.subject ? await resolveSubject(schoolId, body) : { id: current.subject_id };
    const year =
      body.academicYearId || body.termId || body.period
        ? await resolveOpenYear(schoolId, { ...body, academicYearId: body.academicYearId || current.academic_year_id })
        : { id: current.academic_year_id };
    const term =
      body.termId || body.period ? await resolveTerm(year.id ? year : current, body) : { id: current.term_id };
    const name = hasOwn(body, "name") ? asTrimmed(body.name) : current.name;
    const examDate = hasOwn(body, "date") || hasOwn(body, "examDate")
      ? parseIsoDate(body.date ?? body.examDate)
      : formatExamDate(current.exam_date);
    const row = await one(
      `UPDATE exams SET
         class_id = $3, subject_id = $4, term_id = $5, academic_year_id = $6,
         name = $7, exam_type = $8, exam_date = $9, starts_at = $10, ends_at = $11,
         status = $12, updated_at = NOW()
       WHERE id = $1 AND school_id = $2
       RETURNING *`,
      [
        examId,
        schoolId,
        klass.id,
        subject?.id ?? current.subject_id,
        term.id,
        year.id,
        name,
        asTrimmed(body.examType ?? body.type) || current.exam_type,
        examDate,
        body.startsAt === undefined ? current.starts_at : body.startsAt,
        body.endsAt === undefined ? current.ends_at : body.endsAt,
        nextStatus,
      ],
    );
    return hydrateExam(row);
  }

  function hasStatus(body) {
    return body && Object.prototype.hasOwnProperty.call(body, "status");
  }

  function hasOwn(body, key) {
    return body && Object.prototype.hasOwnProperty.call(body, key);
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));
  }

  async function setExamStatus(schoolId, examId, status) {
    const next = canonicalizeExamStatus(status);
    if (!next) throw createDocumentsExamsError(400, "Statut d'examen invalide.", DOCUMENTS_EXAMS_ERROR.INVALID_STATUS);
    await requireOwnedRow(`SELECT id FROM exams WHERE id = $1 AND school_id = $2`, [examId, schoolId], "Examen");
    const row = await one(
      `UPDATE exams SET status = $3, updated_at = NOW() WHERE id = $1 AND school_id = $2 RETURNING *`,
      [examId, schoolId, next],
    );
    return hydrateExam(row);
  }

  async function computeStudentAverage(schoolId, studentId, termId) {
    const row = await one(
      `SELECT AVG(g.score) AS average
       FROM grades g
       JOIN evaluations e ON e.id = g.evaluation_id
       WHERE g.school_id = $1 AND g.student_id = $2 AND e.term_id = $3 AND g.score IS NOT NULL`,
      [schoolId, studentId, termId],
    );
    const value = Number(row?.average);
    return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
  }

  async function hydrateReportCard(row) {
    const school = await one(`SELECT school_code FROM schools WHERE id = $1`, [row.school_id]);
    const student = await one(`SELECT first_name, last_name, student_code FROM students WHERE id = $1`, [row.student_id]);
    const klass = row.class_id ? await one(`SELECT name FROM classes WHERE id = $1`, [row.class_id]) : null;
    const term = await one(`SELECT name FROM terms WHERE id = $1`, [row.term_id]);
    const average = await computeStudentAverage(row.school_id, row.student_id, row.term_id);
    return mapReportCardRow(row, {
      schoolCode: school?.school_code,
      studentName: [student?.first_name, student?.last_name].filter(Boolean).join(" "),
      className: klass?.name,
      termName: term?.name,
      average,
    });
  }

  async function listReportCards(schoolId) {
    const rows = await all(
      `SELECT * FROM report_cards WHERE school_id = $1 ORDER BY generated_at DESC`,
      [schoolId],
    );
    const result = [];
    for (const row of rows) result.push(await hydrateReportCard(row));
    return result;
  }

  async function generateReportCard(schoolId, payload) {
    const body = ignoreClientScope(payload);
    const student = await resolveStudent(schoolId, body);
    const year = await resolveOpenYear(schoolId, body);
    const term = await resolveTerm(year, body);
    const enrollment = await one(
      `SELECT class_id FROM enrollments
       WHERE school_id = $1 AND student_id = $2 AND academic_year_id = $3 AND status = 'active'
       LIMIT 1`,
      [schoolId, student.id, year.id],
    );
    const classId = enrollment?.class_id || body.classId || null;
    const existing = await one(
      `SELECT * FROM report_cards WHERE school_id = $1 AND student_id = $2 AND academic_year_id = $3 AND term_id = $4`,
      [schoolId, student.id, year.id, term.id],
    );
    if (existing && existing.status !== "archived") {
      return hydrateReportCard(existing);
    }
    const row = await one(
      `INSERT INTO report_cards (school_id, student_id, class_id, academic_year_id, term_id, status, generated_at)
       VALUES ($1,$2,$3,$4,$5,'generated', NOW())
       ON CONFLICT (school_id, student_id, academic_year_id, term_id)
       DO UPDATE SET status = 'generated', generated_at = NOW(), class_id = COALESCE(EXCLUDED.class_id, report_cards.class_id), updated_at = NOW()
       RETURNING *`,
      [schoolId, student.id, classId, year.id, term.id],
    );
    return hydrateReportCard(row);
  }

  async function setReportCardStatus(schoolId, cardId, status) {
    await requireOwnedRow(
      `SELECT id FROM report_cards WHERE id = $1 AND school_id = $2`,
      [cardId, schoolId],
      "Bulletin",
    );
    const publishedAt = status === "published" ? new Date().toISOString() : null;
    const row = await one(
      `UPDATE report_cards
       SET status = $3, published_at = CASE WHEN $3 = 'published' THEN COALESCE(published_at, NOW()) ELSE published_at END, updated_at = NOW()
       WHERE id = $1 AND school_id = $2
       RETURNING *`,
      [cardId, schoolId, status],
    );
    void publishedAt;
    return hydrateReportCard(row);
  }

  async function listTemplates(schoolId) {
    const rows = await all(
      `SELECT t.*, s.school_code, c.name AS class_name
       FROM report_card_templates t
       JOIN schools s ON s.id = t.school_id
       LEFT JOIN classes c ON c.id = t.class_id
       WHERE t.school_id = $1
       ORDER BY t.updated_at DESC`,
      [schoolId],
    );
    return rows.map((row) =>
      mapTemplateRow(row, { schoolCode: row.school_code, className: row.class_name }),
    );
  }

  async function upsertTemplate(schoolId, payload) {
    const body = ignoreClientScope(payload);
    const layout = validateTemplateLayout(body.layout ?? body);
    const klass = body.classId || body.className ? await resolveClass(schoolId, body) : null;
    const templateType = asTrimmed(body.templateType) || "bulletin";
    const existing = klass
      ? await one(
          `SELECT * FROM report_card_templates WHERE school_id = $1 AND class_id = $2 AND template_type = $3 AND status = 'active' LIMIT 1`,
          [schoolId, klass.id, templateType],
        )
      : await one(
          `SELECT * FROM report_card_templates WHERE school_id = $1 AND class_id IS NULL AND template_type = $2 AND status = 'active' LIMIT 1`,
          [schoolId, templateType],
        );
    if (existing && body.id && existing.id !== body.id) {
      throw createDocumentsExamsError(409, "Un modèle actif existe déjà pour ce périmètre.", DOCUMENTS_EXAMS_ERROR.CONFLICT);
    }
    if (existing) {
      const row = await one(
        `UPDATE report_card_templates
         SET layout = $3::jsonb, version = version + 1, academic_year_id = $4, updated_at = NOW()
         WHERE id = $1 AND school_id = $2
         RETURNING *`,
        [existing.id, schoolId, JSON.stringify(layout), body.academicYearId || existing.academic_year_id],
      );
      return mapTemplateRow(row, { schoolCode: (await one(`SELECT school_code FROM schools WHERE id = $1`, [schoolId]))?.school_code });
    }
    const row = await one(
      `INSERT INTO report_card_templates (school_id, class_id, academic_year_id, template_type, layout, status, version)
       VALUES ($1,$2,$3,$4,$5::jsonb,'active',1)
       RETURNING *`,
      [schoolId, klass?.id ?? null, body.academicYearId || null, templateType, JSON.stringify(layout)],
    );
    return mapTemplateRow(row);
  }

  async function getTemplate(schoolId, templateId) {
    const row = await requireOwnedRow(
      `SELECT * FROM report_card_templates WHERE id = $1 AND school_id = $2`,
      [templateId, schoolId],
      "Modèle",
    );
    return mapTemplateRow(row);
  }

  async function archiveTemplate(schoolId, templateId) {
    await requireOwnedRow(
      `SELECT id FROM report_card_templates WHERE id = $1 AND school_id = $2`,
      [templateId, schoolId],
      "Modèle",
    );
    const row = await one(
      `UPDATE report_card_templates SET status = 'archived', updated_at = NOW() WHERE id = $1 AND school_id = $2 RETURNING *`,
      [templateId, schoolId],
    );
    return mapTemplateRow(row);
  }

  async function resolveActiveBulletinLayout(schoolId, className) {
    const name = asTrimmed(className);
    if (name) {
      const classSpecific = await one(
        `SELECT t.layout
         FROM report_card_templates t
         JOIN classes c ON c.id = t.class_id
         WHERE t.school_id = $1
           AND t.status = 'active'
           AND t.template_type = 'bulletin'
           AND lower(btrim(c.name)) = lower(btrim($2))
         ORDER BY t.updated_at DESC
         LIMIT 1`,
        [schoolId, name],
      );
      if (classSpecific?.layout && typeof classSpecific.layout === "object") {
        return classSpecific.layout;
      }
    }
    const fallback = await one(
      `SELECT layout
       FROM report_card_templates
       WHERE school_id = $1 AND class_id IS NULL AND status = 'active' AND template_type = 'bulletin'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [schoolId],
    );
    return fallback?.layout && typeof fallback.layout === "object" ? fallback.layout : null;
  }

  async function listSchoolDocuments(schoolId) {
    const rows = await all(
      `SELECT d.*, s.school_code, st.first_name, st.last_name
       FROM school_documents d
       JOIN schools s ON s.id = d.school_id
       LEFT JOIN students st ON st.id = d.student_id
       WHERE d.school_id = $1
       ORDER BY d.created_at DESC`,
      [schoolId],
    );
    return rows.map((row) =>
      mapSchoolDocumentRow(row, {
        schoolCode: row.school_code,
        studentName: [row.first_name, row.last_name].filter(Boolean).join(" "),
      }),
    );
  }

  async function insertSchoolDocument(schoolId, payload, createdBy) {
    const body = ignoreClientScope(payload);
    const title = asTrimmed(body.title);
    const documentType = asTrimmed(body.documentType) || "document";
    if (!title) throw createDocumentsExamsError(400, "Titre de document obligatoire.");
    let studentId = null;
    if (body.studentId) {
      studentId = (await resolveStudent(schoolId, body)).id;
    }
    const row = await one(
      `INSERT INTO school_documents (school_id, student_id, document_type, title, storage_key, mime_type, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        schoolId,
        studentId,
        documentType,
        title,
        asTrimmed(body.storageKey) || null,
        asTrimmed(body.mimeType) || null,
        asTrimmed(body.status) || "available",
        isUuid(createdBy) ? createdBy : null,
      ],
    );
    return mapSchoolDocumentRow(row);
  }

  async function updateSchoolDocument(schoolId, documentId, payload) {
    const current = await requireOwnedRow(
      `SELECT * FROM school_documents WHERE id = $1 AND school_id = $2`,
      [documentId, schoolId],
      "Document",
    );
    const body = ignoreClientScope(payload);
    const row = await one(
      `UPDATE school_documents
       SET title = $3, document_type = $4, storage_key = $5, mime_type = $6, status = $7, updated_at = NOW()
       WHERE id = $1 AND school_id = $2
       RETURNING *`,
      [
        documentId,
        schoolId,
        hasOwn(body, "title") ? asTrimmed(body.title) : current.title,
        hasOwn(body, "documentType") ? asTrimmed(body.documentType) : current.document_type,
        hasOwn(body, "storageKey") ? asTrimmed(body.storageKey) || null : current.storage_key,
        hasOwn(body, "mimeType") ? asTrimmed(body.mimeType) || null : current.mime_type,
        hasOwn(body, "status") ? asTrimmed(body.status) : current.status,
      ],
    );
    return mapSchoolDocumentRow(row);
  }

  async function archiveSchoolDocument(schoolId, documentId) {
    await requireOwnedRow(
      `SELECT id FROM school_documents WHERE id = $1 AND school_id = $2`,
      [documentId, schoolId],
      "Document",
    );
    const row = await one(
      `UPDATE school_documents SET status = 'archived', updated_at = NOW() WHERE id = $1 AND school_id = $2 RETURNING *`,
      [documentId, schoolId],
    );
    return mapSchoolDocumentRow(row);
  }

  async function listActiveResidual(schoolId, domain) {
    return all(
      `SELECT legacy_json_id, profile_payload
       FROM establishment_residual_records
       WHERE school_id = $1 AND record_domain = $2 AND archived_at IS NULL`,
      [schoolId, domain],
    );
  }

  async function relationExists(name) {
    const row = await one(`SELECT to_regclass($1) AS ref`, [`public.${name}`]);
    return Boolean(row?.ref);
  }

  async function inventorySchool(school) {
    const residualExams = await listActiveResidual(school.id, "exam");
    const residualCards = await listActiveResidual(school.id, "bulletin");
    const residualDocs = await listActiveResidual(school.id, "document");
    const relationalExams = await listExams(school.id);
    const relationalCards = (await relationExists("report_cards")) ? await listReportCards(school.id) : [];
    const relationalDocuments = (await relationExists("school_documents"))
      ? await listSchoolDocuments(school.id)
      : [];
    const classNames = await listClassNames(school.id);
    const subjectNames = await listSubjectNames(school.id);
    const termNames = await listTermNames(school.id);
    const students = await all(`SELECT id::text AS id, student_code FROM students WHERE school_id = $1`, [school.id]);
    const context = {
      classNames,
      subjectNames,
      termNames,
      relationalExams,
      relationalCards,
      relationalDocuments,
      studentIds: students.map((row) => row.id),
      studentCodes: students.map((row) => row.student_code).filter(Boolean),
    };
    const examIssues = [];
    for (const row of residualExams) {
      const classified = classifyResidualExam(parsePayload(row.profile_payload), context);
      if (classified.ambiguous) examIssues.push({ schoolCode: school.school_code, keys: classified.issues.map((item) => item.key) });
    }
    const cardIssues = [];
    for (const row of residualCards) {
      const classified = classifyResidualReportCard(parsePayload(row.profile_payload), context);
      if (classified.ambiguous) cardIssues.push({ schoolCode: school.school_code, keys: classified.issues.map((item) => item.key) });
    }
    const docIssues = [];
    for (const row of residualDocs) {
      const classified = classifyResidualDocument(parsePayload(row.profile_payload), context);
      if (classified.ambiguous) docIssues.push({ schoolCode: school.school_code, keys: classified.issues.map((item) => item.key) });
    }
    return {
      schoolCode: school.school_code,
      residualCounts: { exam: residualExams.length, bulletin: residualCards.length, document: residualDocs.length },
      examIssues,
      cardIssues,
      docIssues,
    };
  }

  function parsePayload(value) {
    if (!value) return {};
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  async function inventoryLegacyResidualRecords() {
    const schools = await all(`SELECT id, school_code FROM schools ORDER BY school_code`);
    const inventory = [];
    const examAmbiguous = [];
    const cardAmbiguous = [];
    const docAmbiguous = [];
    for (const school of schools) {
      const item = await inventorySchool(school);
      inventory.push(item);
      examAmbiguous.push(...item.examIssues);
      cardAmbiguous.push(...item.cardIssues);
      docAmbiguous.push(...item.docIssues);
    }
    return { inventory, examAmbiguous, cardAmbiguous, docAmbiguous };
  }

  return {
    getSchoolByCode,
    requireSchoolByCode,
    listExams,
    getExam,
    insertExam,
    updateExam,
    setExamStatus,
    listReportCards,
    generateReportCard,
    setReportCardStatus,
    listTemplates,
    upsertTemplate,
    getTemplate,
    archiveTemplate,
    resolveActiveBulletinLayout,
    listSchoolDocuments,
    insertSchoolDocument,
    updateSchoolDocument,
    archiveSchoolDocument,
    inventoryLegacyResidualRecords,
  };
}

module.exports = {
  createDocumentsExamsPgStore,
};
