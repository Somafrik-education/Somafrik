"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const {
  persistableLogoRef,
  firstInternalLogoRef,
  schoolHasStoredLogo,
  presentSchoolLogoFields,
  presentPublicSchoolLogoFields,
  validateSchoolLogoBuffer,
  sniffLogoMime,
  saveSchoolLogo,
  deleteSchoolLogo,
  commitSchoolLogoUpload,
  commitSchoolLogoDelete,
  readSchoolLogoFile,
  resolveSchoolLogoPath,
  MAX_SCHOOL_LOGO_BYTES,
} = require("./schoolLogo");
const { toPublicSchool } = require("./publicSchool");
const { renderReportCardHtml } = require("./bulletinTemplate");
const { EstablishmentService } = require("../services/establishmentService");

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const SCHOOL = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  code: "SCH-ABCDEF",
  loginCode: "CD-IN-26-001",
  publicId: "CD-IN-26-001",
  name: "Institut Nuruyetu",
};

function withTempStorage(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "somafrik-school-logo-"));
  const previous = process.env.SOMAFRIK_COMMUNICATION_STORAGE;
  process.env.SOMAFRIK_COMMUNICATION_STORAGE = root;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) delete process.env.SOMAFRIK_COMMUNICATION_STORAGE;
      else process.env.SOMAFRIK_COMMUNICATION_STORAGE = previous;
      fs.rmSync(root, { recursive: true, force: true });
    });
}

test("une URL HTTP saisie n'est jamais une référence de logo", () => {
  assert.equal(persistableLogoRef("https://cdn.evil.test/logo.png"), "");
  assert.equal(persistableLogoRef("http://example.test/x.jpg"), "");
  assert.equal(firstInternalLogoRef("https://cdn.somafrik.test/logo.png", "/somafrik-logo.png"), "");
  assert.equal(schoolHasStoredLogo({ logoUrl: "https://example.test/logo.png" }), false);
});

test("seule une clé interne school-logos/{tenant}/ est persistable", () => {
  const key = "school-logos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/logo.png";
  assert.equal(persistableLogoRef(key), key);
  assert.equal(persistableLogoRef("/api/schools/CD-IN-26-001/logo"), "");
  assert.equal(persistableLogoRef("../school-logos/escape/logo.png"), "");
});

test("présentation publique : pas de logo → pas d'URL, hasLogo false", () => {
  const presented = presentPublicSchoolLogoFields({ ...SCHOOL, logoUrl: "" });
  assert.equal(presented.hasLogo, false);
  assert.equal("logoUrl" in presented, false);
});

test("présentation publique : logo interne → chemin API généré, jamais l'URL utilisateur", () => {
  const presented = presentSchoolLogoFields({
    ...SCHOOL,
    logoUrl: "school-logos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/logo.png",
  });
  assert.equal(presented.hasLogo, true);
  assert.equal(presented.logoUrl, "/api/schools/CD-IN-26-001/logo");
  assert.doesNotMatch(presented.logoUrl, /^https?:\/\//);
});

test("toPublicSchool n'echoe plus une URL externe", () => {
  const result = toPublicSchool({
    ...SCHOOL,
    city: "Kinshasa",
    logoUrl: "https://example.test/logo.png",
  });
  assert.equal(result.hasLogo, false);
  assert.equal("logoUrl" in result, false);
});

test("sniff refuse un PDF et un MIME incohérent", () => {
  assert.equal(sniffLogoMime(Buffer.from("%PDF-1.7")), null);
  assert.throws(
    () => validateSchoolLogoBuffer(Buffer.from("not-an-image"), "image/png", "logo.png"),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => validateSchoolLogoBuffer(PNG_1X1, "application/pdf", "logo.png"),
    (error) => error.statusCode === 400,
  );
  const ok = validateSchoolLogoBuffer(PNG_1X1, "image/png", "whatever.bin");
  assert.equal(ok.mimeType, "image/png");
});

test("upload puis lecture restent isolés au tenant", async () => {
  await withTempStorage(async () => {
    const saved = await saveSchoolLogo({
      school: SCHOOL,
      buffer: PNG_1X1,
      fileName: "nuru.png",
      mimeType: "image/png",
    });
    assert.match(
      saved.storageKey,
      /^school-logos\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/logo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/,
    );
    const file = await readSchoolLogoFile({ ...SCHOOL, logoUrl: saved.storageKey });
    assert.ok(file);
    assert.equal(file.mimeType, "image/png");
    assert.deepEqual(file.bytes, PNG_1X1);

    const other = await readSchoolLogoFile({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      code: "SCH-OTHER",
      loginCode: "CD-EC-26-002",
      logoUrl: saved.storageKey,
    });
    assert.equal(other, null);
    assert.equal(
      resolveSchoolLogoPath({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        logoUrl: saved.storageKey,
      }),
      "",
    );
  });
});

test("suppression efface le fichier", async () => {
  await withTempStorage(async () => {
    const saved = await saveSchoolLogo({
      school: SCHOOL,
      buffer: PNG_1X1,
      fileName: "nuru.png",
      mimeType: "image/png",
    });
    const withLogo = { ...SCHOOL, logoUrl: saved.storageKey };
    assert.ok(resolveSchoolLogoPath(withLogo));
    await deleteSchoolLogo(withLogo);
    assert.equal(resolveSchoolLogoPath(withLogo), "");
  });
});

test("PDF établissement avec logo : img école, pas Somafrik", async () => {
  await withTempStorage(async () => {
    const saved = await saveSchoolLogo({
      school: SCHOOL,
      buffer: PNG_1X1,
      fileName: "nuru.png",
      mimeType: "image/png",
    });
    const logoPath = resolveSchoolLogoPath({ ...SCHOOL, logoUrl: saved.storageKey });
    const html = renderReportCardHtml({
      report: {
        id: "REP-2",
        period: "T1",
        generatedAt: "2026-09-12T00:00:00.000Z",
        student: { name: "Amina", matricule: "EL-1", className: "6e" },
        subjects: [{ subject: "Maths", average: 12, coefficient: 1 }],
        average: 12,
        design: { showQrCode: false },
      },
      school: { name: "Institut Nuruyetu", code: "CD-IN-26-001" },
      qrCodeDataUrl: "",
      logoPath,
    });
    assert.match(html, /<img /);
    assert.match(html, /Logo Institut Nuruyetu/);
    assert.doesNotMatch(html, /somafrik-logo/i);
  });
});

test("PDF établissement sans logo : zone vide, pas de Somafrik", () => {
  const html = renderReportCardHtml({
    report: {
      id: "REP-1",
      period: "T1",
      generatedAt: "2026-09-12T00:00:00.000Z",
      student: { name: "Amina", matricule: "EL-1", className: "6e" },
      subjects: [{ subject: "Maths", average: 12, coefficient: 1 }],
      average: 12,
      design: { showQrCode: false },
    },
    school: { name: "Institut Nuruyetu", code: "CD-IN-26-001" },
    qrCodeDataUrl: "",
    logoPath: "",
  });
  assert.doesNotMatch(html, /somafrik-logo/i);
  assert.doesNotMatch(html, /schoollink/i);
  assert.doesNotMatch(html, /<img /i);
  assert.match(html, /Institut Nuruyetu/);
});

test("PATCH établissement ignore une URL de logo fournie par le client", () => {
  const service = new EstablishmentService();
  const existing = {
    ...SCHOOL,
    name: "Institut Nuruyetu",
    type: "Institut",
    country: "RDC",
    countryCode: "CD",
    city: "Kinshasa",
    phone: "+243990000111",
    email: "contact@nuru.test",
    principalName: "Awa",
    principalEmail: "awa@nuru.test",
    logoUrl: "school-logos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/logo.png",
    status: "Actif",
    validationStatus: "Validé",
  };
  const principal = {
    role: "Admin School",
    schoolCode: existing.code,
    schoolId: existing.id,
    permissions: ["Paramètres Établissement:UPDATE", "Paramètres Établissement:READ"],
  };
  const { school } = service.update(
    existing.code,
    { name: "Institut Nuruyetu", logoUrl: "https://cdn.evil.test/logo.png" },
    { schools: [existing], countries: [{ code: "CD", name: "RDC" }] },
    principal,
  );
  assert.equal(school.logoUrl, existing.logoUrl);
  assert.doesNotMatch(school.logoUrl, /^https?:\/\//);
});

test("création d'établissement : logoUrl HTTP client n'est pas conservé", () => {
  const service = new EstablishmentService();
  const principal = {
    role: "Super Administrateur Somafrik",
    permissions: ["ALL_PRIVILEGES"],
  };
  const { school } = service.create(
    {
      name: "Lycée Logo Test",
      country: "RDC",
      city: "Kinshasa",
      type: "Lycée",
      phone: "+243990000111",
      email: "contact@logo-test.cd",
      principalName: "Awa Kabila",
      principalEmail: "awa@logo-test.cd",
      logoUrl: "https://cdn.somafrik.test/logo.png",
    },
    { schools: [], countries: [{ code: "CD", name: "RDC" }] },
    principal,
  );
  assert.equal(persistableLogoRef(school.logoUrl), "");
  assert.notEqual(school.logoUrl, "https://cdn.somafrik.test/logo.png");
});

test("taille excessive refusée", () => {
  const huge = Buffer.alloc(MAX_SCHOOL_LOGO_BYTES + 1, 0xff);
  huge[0] = 0x89;
  huge[1] = 0x50;
  huge[2] = 0x4e;
  huge[3] = 0x47;
  assert.throws(
    () => validateSchoolLogoBuffer(huge, "image/png", "logo.png"),
    (error) => error.statusCode === 400,
  );
});

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

test("échec persistEstablishment à l'upload : ancien fichier conservé, nouveau supprimé", async () => {
  await withTempStorage(async () => {
    const first = await saveSchoolLogo({
      school: SCHOOL,
      buffer: PNG_1X1,
      fileName: "nuru.png",
      mimeType: "image/png",
    });
    const withLogo = { ...SCHOOL, logoUrl: first.storageKey };
    const persistError = new Error("db down");
    await assert.rejects(
      () =>
        commitSchoolLogoUpload({
          school: withLogo,
          buffer: JPEG_MAGIC,
          fileName: "nuru.jpg",
          mimeType: "image/jpeg",
          persistEstablishment: async () => {
            throw persistError;
          },
        }),
      persistError,
    );
    assert.ok(resolveSchoolLogoPath(withLogo));
    const kept = await readSchoolLogoFile(withLogo);
    assert.ok(kept);
    assert.deepEqual(kept.bytes, PNG_1X1);
    const root = process.env.SOMAFRIK_COMMUNICATION_STORAGE;
    const leftovers = fs.readdirSync(path.join(root, "school-logos", SCHOOL.id));
    assert.equal(leftovers.length, 1);
    assert.equal(leftovers[0], path.posix.basename(first.storageKey));
  });
});

test("succès persistEstablishment à l'upload : nouveau conservé, ancien nettoyé", async () => {
  await withTempStorage(async () => {
    const first = await saveSchoolLogo({
      school: SCHOOL,
      buffer: PNG_1X1,
      fileName: "nuru.png",
      mimeType: "image/png",
    });
    const withLogo = { ...SCHOOL, logoUrl: first.storageKey };
    let persisted = null;
    const result = await commitSchoolLogoUpload({
      school: withLogo,
      buffer: JPEG_MAGIC,
      fileName: "nuru.jpg",
      mimeType: "image/jpeg",
      persistEstablishment: async (record) => {
        persisted = record;
        return record;
      },
    });
    assert.equal(persisted.logoUrl, result.storageKey);
    assert.notEqual(result.storageKey, first.storageKey);
    assert.equal(resolveSchoolLogoPath(withLogo), "");
    const nextSchool = { ...SCHOOL, logoUrl: result.storageKey };
    const file = await readSchoolLogoFile(nextSchool);
    assert.ok(file);
    assert.equal(file.mimeType, "image/jpeg");
    const root = process.env.SOMAFRIK_COMMUNICATION_STORAGE;
    const leftovers = fs.readdirSync(path.join(root, "school-logos", SCHOOL.id));
    assert.equal(leftovers.length, 1);
    assert.equal(leftovers[0], path.posix.basename(result.storageKey));
  });
});

test("échec persistEstablishment à la suppression : fichier et pointeur DB conservés", async () => {
  await withTempStorage(async () => {
    const saved = await saveSchoolLogo({
      school: SCHOOL,
      buffer: PNG_1X1,
      fileName: "nuru.png",
      mimeType: "image/png",
    });
    const withLogo = { ...SCHOOL, logoUrl: saved.storageKey };
    const persistError = new Error("db down");
    await assert.rejects(
      () =>
        commitSchoolLogoDelete({
          school: withLogo,
          persistEstablishment: async () => {
            throw persistError;
          },
        }),
      persistError,
    );
    assert.ok(resolveSchoolLogoPath(withLogo));
    const kept = await readSchoolLogoFile(withLogo);
    assert.ok(kept);
    assert.deepEqual(kept.bytes, PNG_1X1);
  });
});

test("succès persistEstablishment à la suppression : fichier retiré seulement après DB", async () => {
  await withTempStorage(async () => {
    const saved = await saveSchoolLogo({
      school: SCHOOL,
      buffer: PNG_1X1,
      fileName: "nuru.png",
      mimeType: "image/png",
    });
    const withLogo = { ...SCHOOL, logoUrl: saved.storageKey };
    let sawFileDuringPersist = false;
    const result = await commitSchoolLogoDelete({
      school: withLogo,
      persistEstablishment: async (record) => {
        sawFileDuringPersist = Boolean(resolveSchoolLogoPath(withLogo));
        assert.equal(record.logoUrl, "");
        return record;
      },
    });
    assert.equal(result.logoUrl, "");
    assert.equal(sawFileDuringPersist, true);
    assert.equal(resolveSchoolLogoPath(withLogo), "");
  });
});
