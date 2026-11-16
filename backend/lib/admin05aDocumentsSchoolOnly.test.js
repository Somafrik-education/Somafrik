"use strict";

/**
 * ADMIN-05A — Documents : périmètre school-only + clôture métadonnées.
 * D05-01 → D05-18. Pas d'upload. Pas de migration. Pas d'élargissement plateforme.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createDocumentsExamsMemoryStore } = require("../db/documentsExamsMemoryStore");
const { RbacService } = require("../services/rbacService");
const {
  SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM,
  isPlatformPersonalDataForbidden,
} = require("./platformPersonalDataGuard");
const {
  DOCUMENTS_EXAMS_ERROR,
  DOCUMENT_STATUSES,
  mapSchoolDocumentRow,
  mapSchoolDocumentAuditValue,
  prepareSchoolDocumentWrite,
} = require("./documentsExamsManagement");
const {
  listSchoolDocuments,
  createSchoolDocument,
  patchSchoolDocument,
  archiveSchoolDocument,
} = require("./documentsExamsService");

const rbac = new RbacService();
const AUDIT = { ipAddress: "127.0.0.1", userAgent: "admin05a-d05" };

const DOCUMENT_ROUTES = [
  "GET /api/school-documents",
  "POST /api/school-documents",
  "PATCH /api/school-documents/:documentId",
  "POST /api/school-documents/:documentId/archive",
];

const SUPER = {
  sub: "super",
  role: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES", "Documents:READ", "Documents:CREATE", "Documents:UPDATE"],
  schoolCode: "*",
};

const SUPER_WITH_SCHOOL = {
  ...SUPER,
  schoolCode: "CD-2026-0001",
};

const COUNTRY = {
  sub: "admin-pays",
  role: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["COUNTRY_PRIVILEGES", "Documents:READ", "Documents:CREATE", "Documents:UPDATE"],
  schoolCode: "*",
  countryCode: "CD",
};

const COUNTRY_WITH_SCHOOL = {
  ...COUNTRY,
  schoolCode: "CD-2026-0001",
};

const SCHOOL_A = {
  sub: "admin-a",
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Documents:READ", "Documents:CREATE", "Documents:UPDATE"],
  schoolCode: "CD-2026-0001",
  schoolId: "school-a",
};

const SCHOOL_B = {
  sub: "admin-b",
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Documents:READ", "Documents:CREATE", "Documents:UPDATE"],
  schoolCode: "BI-2026-0002",
  schoolId: "school-b",
};

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

function secretLeak(value) {
  const blob = JSON.stringify(value ?? {});
  return /storageKey|storage_key|temporaryPassword|password_hash|pin_hash|refresh_token|Bearer |eyJ[A-Za-z0-9_-]{10,}\.|https?:\/\/|signed|secret/i.test(
    blob,
  )
    ? blob
    : null;
}

function seedStore() {
  return createDocumentsExamsMemoryStore({
    schools: [
      { id: "school-a", school_code: "CD-2026-0001" },
      { id: "school-b", school_code: "BI-2026-0002" },
    ],
    students: [
      {
        id: "student-a",
        school_id: "school-a",
        student_code: "STU-A",
        first_name: "Esther",
        last_name: "OKITO",
      },
      {
        id: "student-b",
        school_id: "school-b",
        student_code: "STU-B",
        first_name: "Cross",
        last_name: "Tenant",
      },
    ],
  });
}

function createMemoryRepo(store = seedStore()) {
  const audits = [];
  const repo = {
    getDocumentsExamsStore: () => store,
    createTxScope() {
      return {
        getDocumentsExamsStore: () => store,
        recordAudit: async (payload) => {
          audits.push({
            ...payload,
            recordedAt: new Date().toISOString(),
          });
        },
      };
    },
    withTransaction: async (fn) => fn({}),
  };
  return { repo, store, audits };
}

async function expectRejection(promise, { status, code }) {
  try {
    await promise;
    throw new Error(`Expected rejection ${code || status}`);
  } catch (error) {
    if (error.message.startsWith("Expected rejection")) throw error;
    assert.equal(error.statusCode, status, error.message);
    if (code) assert.equal(error.code, code, error.message);
  }
}

test("D05-01 SUPER_ADMIN_ALLOWED_VIEWS n'inclut pas documents", () => {
  const access = readUtf8("../../web/src/lib/superAdminAccess.ts");
  assert.match(access, /SUPER_ADMIN_ALLOWED_VIEWS/);
  assert.doesNotMatch(access, /SUPER_ADMIN_ALLOWED_VIEWS[\s\S]*"documents"/);
  assert.doesNotMatch(access, /SUPER_ADMIN_ALLOWED_FEATURES[\s\S]*"Documents"/);
  const layout = readUtf8("../../web/src/pages/administration/AdministrationLayout.tsx");
  assert.match(layout, /canReadView\(ctx, tab\.view\)/);
});

test("D05-02 SUPER_ADMIN GET /school-documents → 403", async () => {
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/school-documents"), true);
  assert.equal(isPlatformPersonalDataForbidden(SUPER, "GET /api/school-documents"), true);
  assert.equal(isPlatformPersonalDataForbidden(SUPER_WITH_SCHOOL, "GET /api/school-documents"), true);
  assert.equal(rbac.canAccess(SUPER, "GET /api/school-documents"), false);
  const { repo } = createMemoryRepo();
  await expectRejection(listSchoolDocuments(repo, SUPER_WITH_SCHOOL), {
    status: 403,
    code: DOCUMENTS_EXAMS_ERROR.FORBIDDEN,
  });
});

test("D05-03 SUPER_ADMIN POST → 403", async () => {
  assert.equal(isPlatformPersonalDataForbidden(SUPER, "POST /api/school-documents"), true);
  assert.equal(rbac.canAccess(SUPER, "POST /api/school-documents"), false);
  const { repo } = createMemoryRepo();
  await expectRejection(
    createSchoolDocument(repo, { title: "Attestation", documentType: "attestation" }, SUPER_WITH_SCHOOL, AUDIT),
    { status: 403, code: DOCUMENTS_EXAMS_ERROR.FORBIDDEN },
  );
});

test("D05-04 COUNTRY_ADMIN plateforme deny conforme", async () => {
  for (const route of DOCUMENT_ROUTES) {
    assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes(route), true, route);
    assert.equal(isPlatformPersonalDataForbidden(COUNTRY, route), true, route);
    assert.equal(isPlatformPersonalDataForbidden(COUNTRY_WITH_SCHOOL, route), true, route);
    assert.equal(rbac.canAccess(COUNTRY, route), false, route);
  }
  const { repo } = createMemoryRepo();
  await expectRejection(listSchoolDocuments(repo, COUNTRY_WITH_SCHOOL), {
    status: 403,
    code: DOCUMENTS_EXAMS_ERROR.FORBIDDEN,
  });
});

test("D05-05 SCHOOL_ADMIN autorisé conserve Documents:READ/CREATE/UPDATE", () => {
  assert.equal(isPlatformPersonalDataForbidden(SCHOOL_A, "GET /api/school-documents"), false);
  assert.equal(rbac.canAccess(SCHOOL_A, "GET /api/school-documents"), true);
  assert.equal(rbac.canAccess(SCHOOL_A, "POST /api/school-documents"), true);
  assert.equal(rbac.canAccess(SCHOOL_A, "PATCH /api/school-documents/:documentId"), true);
  assert.equal(rbac.canAccess(SCHOOL_A, "POST /api/school-documents/:documentId/archive"), true);
});

test("D05-06 SCHOOL_ADMIN liste uniquement son école", async () => {
  const { repo } = createMemoryRepo();
  await createSchoolDocument(repo, { title: "Attestation A", documentType: "attestation" }, SCHOOL_A, AUDIT);
  await createSchoolDocument(repo, { title: "Attestation B", documentType: "attestation" }, SCHOOL_B, AUDIT);
  const listed = await listSchoolDocuments(repo, SCHOOL_A);
  assert.equal(listed.every((row) => row.schoolCode === "CD-2026-0001"), true);
  assert.equal(listed.some((row) => row.title === "Attestation A"), true);
  assert.equal(listed.some((row) => row.title === "Attestation B"), false);
});

test("D05-07 create persiste", async () => {
  const { repo } = createMemoryRepo();
  const created = await createSchoolDocument(
    repo,
    {
      title: "Attestation de scolarité",
      documentType: "attestation",
      studentId: "student-a",
      schoolCode: "BI-2026-0002",
      schoolId: "school-b",
      storageKey: "https://evil.example/file.pdf",
    },
    SCHOOL_A,
    AUDIT,
  );
  assert.equal(created.title, "Attestation de scolarité");
  assert.equal(created.documentType, "attestation");
  assert.equal(created.status, "available");
  assert.equal(created.schoolCode, "CD-2026-0001");
  assert.equal(created.studentId, "student-a");
  assert.equal(created.studentName, "Esther OKITO");
  assert.equal(Object.hasOwn(created, "storageKey"), false);
  const listed = await listSchoolDocuments(repo, SCHOOL_A);
  assert.equal(listed.some((row) => row.id === created.id && row.title === created.title), true);
});

test("D05-08 PATCH titre persiste", async () => {
  const { repo } = createMemoryRepo();
  const created = await createSchoolDocument(repo, { title: "Avant", documentType: "attestation" }, SCHOOL_A, AUDIT);
  const patched = await patchSchoolDocument(repo, created.id, { title: "Après" }, SCHOOL_A, AUDIT);
  assert.equal(patched.title, "Après");
  assert.equal(patched.documentType, "attestation");
});

test("D05-09 PATCH type persiste", async () => {
  const { repo } = createMemoryRepo();
  const created = await createSchoolDocument(repo, { title: "Pièce", documentType: "attestation" }, SCHOOL_A, AUDIT);
  const patched = await patchSchoolDocument(repo, created.id, { documentType: "certificat" }, SCHOOL_A, AUDIT);
  assert.equal(patched.documentType, "certificat");
});

test("D05-10 archive persiste", async () => {
  const { repo } = createMemoryRepo();
  const created = await createSchoolDocument(repo, { title: "À archiver", documentType: "attestation" }, SCHOOL_A, AUDIT);
  const generating = await patchSchoolDocument(repo, created.id, { status: "generating" }, SCHOOL_A, AUDIT);
  assert.equal(generating.status, "generating");
  const archived = await archiveSchoolDocument(repo, created.id, SCHOOL_A, AUDIT);
  assert.equal(archived.status, "archived");
  assert.deepEqual([...DOCUMENT_STATUSES], ["available", "generating", "archived"]);
});

test("D05-11 reload conserve mutations", async () => {
  const { repo } = createMemoryRepo();
  const created = await createSchoolDocument(repo, { title: "Reload", documentType: "attestation" }, SCHOOL_A, AUDIT);
  await patchSchoolDocument(repo, created.id, { title: "Reload v2", documentType: "certificat" }, SCHOOL_A, AUDIT);
  await archiveSchoolDocument(repo, created.id, SCHOOL_A, AUDIT);
  const listed = await listSchoolDocuments(repo, SCHOOL_A);
  const row = listed.find((item) => item.id === created.id);
  assert.equal(row.title, "Reload v2");
  assert.equal(row.documentType, "certificat");
  assert.equal(row.status, "archived");
});

test("D05-12 école A ne lit pas école B", async () => {
  const { repo } = createMemoryRepo();
  await createSchoolDocument(repo, { title: "Secret B", documentType: "attestation" }, SCHOOL_B, AUDIT);
  const listed = await listSchoolDocuments(repo, SCHOOL_A);
  assert.equal(listed.some((row) => row.title === "Secret B"), false);
});

test("D05-13 école A ne modifie pas document école B", async () => {
  const { repo } = createMemoryRepo();
  const foreign = await createSchoolDocument(repo, { title: "Doc B", documentType: "attestation" }, SCHOOL_B, AUDIT);
  await expectRejection(patchSchoolDocument(repo, foreign.id, { title: "Hack" }, SCHOOL_A, AUDIT), {
    status: 404,
    code: DOCUMENTS_EXAMS_ERROR.NOT_FOUND,
  });
  await expectRejection(archiveSchoolDocument(repo, foreign.id, SCHOOL_A, AUDIT), {
    status: 404,
    code: DOCUMENTS_EXAMS_ERROR.NOT_FOUND,
  });
  const stillB = await listSchoolDocuments(repo, SCHOOL_B);
  assert.equal(stillB[0].title, "Doc B");
  assert.equal(stillB[0].status, "available");
});

test("D05-14 student_id cross-school refusé", async () => {
  const { repo } = createMemoryRepo();
  await expectRejection(
    createSchoolDocument(
      repo,
      { title: "Cross", documentType: "attestation", studentId: "student-b" },
      SCHOOL_A,
      AUDIT,
    ),
    { status: 404, code: DOCUMENTS_EXAMS_ERROR.NOT_FOUND },
  );
  const listed = await listSchoolDocuments(repo, SCHOOL_A);
  assert.equal(listed.length, 0);
});

test("D05-15 audit create sans secret", async () => {
  const { repo, audits } = createMemoryRepo();
  const created = await createSchoolDocument(
    repo,
    { title: "Audit create", documentType: "attestation", studentId: "student-a" },
    SCHOOL_A,
    AUDIT,
  );
  const entry = audits.find((row) => row.action === "create_school_document");
  assert.ok(entry);
  assert.equal(entry.userId, SCHOOL_A.sub);
  assert.equal(entry.schoolCode, "CD-2026-0001");
  assert.equal(entry.entityId, created.id);
  assert.equal(entry.newValue.documentType, "attestation");
  assert.equal(entry.newValue.status, "available");
  assert.ok(entry.recordedAt);
  assert.equal(secretLeak(entry), null);
  assert.equal(Object.hasOwn(entry.newValue, "storageKey"), false);
});

test("D05-16 audit update/archive sans secret", async () => {
  const { repo, audits } = createMemoryRepo();
  const created = await createSchoolDocument(repo, { title: "Audit maj", documentType: "attestation" }, SCHOOL_A, AUDIT);
  await patchSchoolDocument(repo, created.id, { title: "Audit maj 2" }, SCHOOL_A, AUDIT);
  await archiveSchoolDocument(repo, created.id, SCHOOL_A, AUDIT);
  const update = audits.find((row) => row.action === "update_school_document");
  const archive = audits.find((row) => row.action === "archive_school_document");
  assert.ok(update);
  assert.ok(archive);
  assert.equal(update.newValue.title, "Audit maj 2");
  assert.equal(archive.newValue.status, "archived");
  assert.equal(secretLeak(update), null);
  assert.equal(secretLeak(archive), null);
});

test("D05-17 storageKey ne donne aucun accès fichier", () => {
  const mapped = mapSchoolDocumentRow({
    id: "doc-1",
    school_id: "school-a",
    school_code: "CD-2026-0001",
    student_id: null,
    document_type: "attestation",
    title: "X",
    storage_key: "https://evil.example/secret.pdf",
    mime_type: "application/pdf",
    status: "available",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  });
  assert.equal(Object.hasOwn(mapped, "storageKey"), false);
  const prepared = prepareSchoolDocumentWrite({
    title: "X",
    storageKey: "https://evil.example/secret.pdf",
    schoolCode: "BI-2026-0002",
  });
  assert.equal(Object.hasOwn(prepared, "storageKey"), false);
  assert.equal(Object.hasOwn(prepared, "schoolCode"), false);
  const audit = mapSchoolDocumentAuditValue(mapped);
  assert.equal(Object.hasOwn(audit, "storageKey"), false);
  const server = readUtf8("../server.js");
  assert.match(server, /app\.get\("\/api\/school-documents"/);
  assert.doesNotMatch(server, /app\.(get|post)\("\/api\/school-documents\/:documentId\/(download|upload|file)/);
  assert.doesNotMatch(server, /school-documents\/:documentId\/download/);
  const api = readUtf8("../../web/src/lib/schoolDocumentsApi.ts");
  assert.doesNotMatch(api, /storageKey/);
  assert.doesNotMatch(api, /download|upload/);
});

test("D05-18 platformPersonalDataGuard non élargi", () => {
  const guard = readUtf8("./platformPersonalDataGuard.js");
  for (const route of DOCUMENT_ROUTES) {
    assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes(route), true, route);
    assert.match(guard, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(guard, /deny plateforme AVANT requiredPermissions|ALL_PRIVILEGES \/ COUNTRY_PRIVILEGES/);
  assert.doesNotMatch(guard, /SUPER_ADMIN_ALLOWED_VIEWS/);
  const service = readUtf8("./documentsExamsService.js");
  assert.match(service, /assertSchoolDocumentsPlatformDenied/);
  assert.match(service, /isPlatformPersonalDataForbidden\(principal, "GET \/api\/school-documents"\)/);
});

const SCHOOL_CREATE_ONLY = {
  sub: "admin-create-only",
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Documents:READ", "Documents:CREATE"],
  schoolCode: "CD-2026-0001",
  schoolId: "school-a",
};

const SCHOOL_UPDATE_ONLY = {
  sub: "admin-update-only",
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Documents:READ", "Documents:UPDATE"],
  schoolCode: "CD-2026-0001",
  schoolId: "school-a",
};

test("D05-LP-01 READ + CREATE peut CREATE", async () => {
  const { repo } = createMemoryRepo();
  const created = await createSchoolDocument(
    repo,
    { title: "CREATE only", documentType: "attestation" },
    SCHOOL_CREATE_ONLY,
    AUDIT,
  );
  assert.equal(created.title, "CREATE only");
  const listed = await listSchoolDocuments(repo, SCHOOL_CREATE_ONLY);
  assert.equal(listed.some((row) => row.id === created.id), true);
});

test("D05-LP-02 READ + CREATE ne peut pas PATCH via service → 403", async () => {
  const { repo } = createMemoryRepo();
  const created = await createSchoolDocument(
    repo,
    { title: "No patch", documentType: "attestation" },
    SCHOOL_A,
    AUDIT,
  );
  await expectRejection(patchSchoolDocument(repo, created.id, { title: "Hack CREATE" }, SCHOOL_CREATE_ONLY, AUDIT), {
    status: 403,
    code: DOCUMENTS_EXAMS_ERROR.FORBIDDEN,
  });
  const listed = await listSchoolDocuments(repo, SCHOOL_A);
  assert.equal(listed.find((row) => row.id === created.id).title, "No patch");
});

test("D05-LP-03 READ + CREATE ne peut pas ARCHIVE via service → 403", async () => {
  const { repo } = createMemoryRepo();
  const created = await createSchoolDocument(
    repo,
    { title: "No archive", documentType: "attestation" },
    SCHOOL_A,
    AUDIT,
  );
  await expectRejection(archiveSchoolDocument(repo, created.id, SCHOOL_CREATE_ONLY, AUDIT), {
    status: 403,
    code: DOCUMENTS_EXAMS_ERROR.FORBIDDEN,
  });
  const listed = await listSchoolDocuments(repo, SCHOOL_A);
  assert.equal(listed.find((row) => row.id === created.id).status, "available");
});

test("D05-LP-04 READ + UPDATE conserve PATCH/ARCHIVE", async () => {
  const { repo } = createMemoryRepo();
  const created = await createSchoolDocument(
    repo,
    { title: "Update path", documentType: "attestation" },
    SCHOOL_UPDATE_ONLY,
    AUDIT,
  );
  const patched = await patchSchoolDocument(repo, created.id, { title: "Update path v2" }, SCHOOL_UPDATE_ONLY, AUDIT);
  assert.equal(patched.title, "Update path v2");
  const archived = await archiveSchoolDocument(repo, created.id, SCHOOL_UPDATE_ONLY, AUDIT);
  assert.equal(archived.status, "archived");
  const management = readUtf8("./documentsExamsManagement.js");
  assert.match(management, /function assertDocumentsCreate/);
  assert.match(management, /function assertDocumentsWrite/);
  const writeFn = management.slice(
    management.indexOf("function assertDocumentsWrite"),
    management.indexOf("function assertTemplatesWrite"),
  );
  assert.doesNotMatch(writeFn, /Documents:CREATE/);
  const service = readUtf8("./documentsExamsService.js");
  assert.match(service, /assertDocumentsCreate,/);
  const fallback = readUtf8("../db/fallbackRepository.js");
  assert.doesNotMatch(fallback, /insertExam\([^)]*\)\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(fallback, /generateReportCard\([^)]*\)\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(fallback, /insertSchoolDocument\([\s\S]{0,240}\)\.catch\(\(\) => \{\}\)/);
});
