"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  createStudentDocumentsService,
  assertDocumentRight,
  requireType,
} = require("./studentAdministrativeDocuments");

const schoolId = "11111111-1111-4111-8111-111111111111";
const studentId = "22222222-2222-4222-8222-222222222222";
const schoolCode = "CD-IN-26-001"; // schools.login_code (canonique)
const legacySchoolCode = "CD-2026-0001"; // schools.school_code (legacy, divergent)
const studentCode = "CD-TEST-001";
const perms = ["Documents:READ", "Documents:CREATE", "Documents:UPDATE"];
const principal = { schoolCode, role: "SCHOOL_ADMIN", permissions: perms };
const pdf = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

function createFakeRepo() {
  const docs = new Map();
  return {
    engine: "postgresql",
    async one(sql, params) {
      if (sql.startsWith("SELECT st.id")) {
        // Vérifie le vrai SQL, pas seulement le comportement du faux repository.
        assert.match(sql, /upper\(btrim\(sc\.login_code\)\) = \$2/);
        assert.doesNotMatch(sql, /sc\.school_code/);
        return (params[0] === studentCode || params[0] === studentId) &&
          params[1] === schoolCode ? { id: studentId, school_id: schoolId } : null;
      }
      if (sql.startsWith("INSERT INTO student_documents")) {
        const id = "33333333-3333-4333-8333-333333333333";
        const row = {
          id, student_id: params[1], school_id: params[0],
          document_type: params[3], title: params[4], status: "submitted",
          storage_key: params[6],
          metadata: JSON.parse(params[7]),
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        docs.set(id, row);
        return row;
      }
      if (sql.startsWith("SELECT id, school_id, student_id")) {
        const row = docs.get(params[0]);
        return row && row.student_id === params[1] && row.school_id === params[2]
          ? row : null;
      }
      if (sql.startsWith("UPDATE student_documents")) {
        const row = docs.get(String(params[0]));
        if (!row || row.student_id !== params[1] || row.school_id !== params[2]) return null;
        const nextStatus = sql.includes("status='verified'") ? "verified" : "archived";
        if (nextStatus === "verified" && row.status !== "submitted") return null;
        if (nextStatus === "archived" && !["submitted", "verified"].includes(row.status)) return null;
        const next = { ...row, status: nextStatus,
          metadata: { ...row.metadata, ...JSON.parse(params[3]) },
          updated_at: new Date().toISOString() };
        docs.set(row.id, next);
        return next;
      }
      throw new Error("Unexpected SQL: " + sql);
    },
    async all(sql, params) {
      if (!sql.includes("FROM student_documents")) throw new Error("Unexpected list SQL");
      return [...docs.values()].filter(x=>x.school_id===params[0]&&x.student_id===params[1]);
    },
    query: async () => ({ rows: [] }),
    docs,
  };
}

test("FICHE-DOC-01 : la lecture et l'écriture refusent plateforme et permissions absentes", () => {
  assert.throws(
    () => assertDocumentRight({ role: "SUPER_ADMIN", schoolCode: "*", permissions: perms }, "read"),
    (e) => e.statusCode === 403,
  );
  assert.throws(
    () => assertDocumentRight({ role: "Directeur", roleKey: "PARENT", schoolCode, permissions: perms }, "read"),
    (e) => e.statusCode === 403,
  );
  assert.throws(
    () => assertDocumentRight({ schoolCode, permissions: ["Documents:READ"] }, "create"),
    (e) => e.statusCode === 403,
  );
  assert.throws(
    () => assertDocumentRight({ schoolCode, permissions: ["Documents:CREATE"] }, "update"),
    (e) => e.statusCode === 403,
  );
  assert.doesNotThrow(() => assertDocumentRight(principal, "read"));
  assert.throws(() => requireType("../../etc"), (e) => e.statusCode === 400);
  assert.equal(requireType("BIRTH_CERTIFICATE"), "BIRTH_CERTIFICATE");
  assert.throws(() => createStudentDocumentsService({ engine: "memory" }), (e) => e.statusCode === 503);
});

test("FICHE-DOC-01 : upload PostgreSQL, téléchargement, vérification unique et archivage", async () => {
  const oldEnv = process.env.SOMAFRIK_COMMUNICATION_STORAGE;
  const oldNode = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "somafrik-docs-"));
  process.env.SOMAFRIK_COMMUNICATION_STORAGE = temp;
  try {
    const repo = createFakeRepo();
    const svc = createStudentDocumentsService(repo);
    // Un code établissement de l'ancien champ ne donne jamais accès au dossier.
    await assert.rejects(
      svc.list({ studentRef: studentCode, schoolCode: legacySchoolCode, principal }),
      (e) => e.statusCode === 404,
    );
    assert.deepEqual(await svc.list({ studentRef: studentCode, schoolCode, principal }), []);
    assert.deepEqual(await svc.list({ studentRef: studentId, schoolCode, principal }), []);
    await assert.rejects(
      svc.list({ studentRef: studentCode, schoolCode: "BI-2026-0001", principal }),
      (e) => e.statusCode === 404,
    );
    await assert.rejects(
      svc.upload({ studentRef: studentCode, schoolCode, principal,
        documentType: "BIRTH_CERTIFICATE", buffer: Buffer.from("MZ executable"),
        fileName: "scan.pdf", mimeType: "application/pdf" }),
      (e) => e.statusCode === 400,
    );
    await assert.rejects(
      svc.upload({ studentRef: studentCode, schoolCode, principal,
        documentType: "PHOTO", buffer: pdf, fileName: "photo.pdf", mimeType: "application/pdf" }),
      (e) => e.statusCode === 400,
    );
    const row = await svc.upload({ studentRef: studentCode, schoolCode, principal,
      documentType: "BIRTH_CERTIFICATE", buffer: pdf,
      fileName: "birth.pdf", mimeType: "application/pdf" });
    assert.equal(row.status, "submitted");
    assert.equal(row.documentType, "BIRTH_CERTIFICATE");
    assert.equal(row.fileName, "birth.pdf");
    assert.equal(Object.hasOwn(row, "storageKey"), false);
    assert.equal((await svc.list({ studentRef: studentCode, schoolCode, principal })).length, 1);
    const bytes = await svc.download({ studentRef: studentCode, schoolCode, principal,
      documentId: row.id });
    assert.deepEqual(bytes.bytes, pdf);
    await assert.rejects(svc.download({ studentRef: studentCode, schoolCode: "BI-2026-0001", principal,
      documentId: row.id }), (e) => e.statusCode === 404);
    await assert.rejects(svc.verify({ studentRef: studentCode, schoolCode,
      principal: { schoolCode, permissions: ["Documents:READ"] }, documentId: row.id }),
      (e) => e.statusCode === 403);
    const verified = await svc.verify({ studentRef: studentCode, schoolCode, principal,
      documentId: row.id });
    assert.equal(verified.status, "verified");
    await assert.rejects(svc.verify({ studentRef: studentCode, schoolCode, principal,
      documentId: row.id }), (e) => e.statusCode === 409);
    const archived = await svc.archive({ studentRef: studentCode, schoolCode, principal,
      documentId: row.id });
    assert.equal(archived.status, "archived");
    await assert.rejects(svc.download({ studentRef: studentCode, schoolCode, principal,
      documentId: row.id }), (e) => e.statusCode === 404);
    assert.equal((await svc.archive({ studentRef: studentCode, schoolCode, principal,
      documentId: row.id })).status, "archived");
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
    if (oldEnv === undefined) delete process.env.SOMAFRIK_COMMUNICATION_STORAGE;
    else process.env.SOMAFRIK_COMMUNICATION_STORAGE = oldEnv;
    if (oldNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNode;
  }
});

test("CARTE-PHOTO-02 : photo canonique scellée établissement + élève, droits et fichier manquant", async () => {
  const queries = [];
  const base = createFakeRepo();
  let photoRow = null;
  const repo = {
    ...base,
    async one(sql, params) {
      if (sql.includes("document_type='PHOTO'")) {
        queries.push({ sql, params });
        return photoRow;
      }
      return base.one(sql, params);
    },
  };
  const svc = createStudentDocumentsService(repo);
  await assert.rejects(
    svc.photo({ studentRef: studentCode, schoolCode, principal: { schoolCode, permissions: ["Élèves:READ"] } }),
    (e) => e.statusCode === 403,
  );
  await assert.rejects(
    svc.photo({ studentRef: studentCode, schoolCode: "BI-2026-0001", principal }),
    (e) => e.statusCode === 404 && e.code === "STUDENT_DOC_NOT_FOUND",
  );
  await assert.rejects(
    svc.photo({ studentRef: studentCode, schoolCode, principal }),
    (e) => e.statusCode === 404 && e.code === "STUDENT_PHOTO_ABSENT",
  );
  const { sql, params } = queries.at(-1);
  assert.match(sql, /WHERE school_id=\$1 AND student_id=\$2/);
  assert.match(sql, /status IN \('submitted','verified'\)/);
  assert.match(sql, /ORDER BY created_at DESC/);
  assert.deepEqual(params, [schoolId, studentId, "administrative_upload"]);

  photoRow = { id: "p1", storage_key: "", metadata: { mimeType: "application/pdf" } };
  await assert.rejects(svc.photo({ studentRef: studentCode, schoolCode, principal }),
    (e) => e.statusCode === 422 && e.code === "STUDENT_PHOTO_INVALID");
  photoRow = { id: "p1", storage_key: "", metadata: { mimeType: "image/png" } };
  await assert.rejects(svc.photo({ studentRef: studentCode, schoolCode, principal }),
    (e) => e.statusCode === 404 && e.code === "STUDENT_PHOTO_FILE_MISSING");
});
