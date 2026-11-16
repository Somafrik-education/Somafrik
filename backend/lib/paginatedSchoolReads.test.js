"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const reads = require("./paginatedSchoolReads");
const { isPlatformPersonalDataForbiddenHttp } = require("./platformPersonalDataGuard");

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ROW_ID = "33333333-3333-4333-8333-333333333333";

function recordingRepository(rows = []) {
  const sql = [];
  return {
    sql,
    all: async (text, params) => {
      sql.push({ text, params });
      return rows;
    },
    mapAttendance: (row) => ({ id: row.id }),
    mapGrade: (row) => ({ id: row.id }),
  };
}

function placeholdersOf(text) {
  return Math.max(0, ...[...text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
}

test("limit : 50 par défaut, 200 au plus, toute autre valeur refusée", () => {
  assert.equal(reads.parseLimit(undefined), 50);
  assert.equal(reads.parseLimit("1"), 1);
  assert.equal(reads.parseLimit("200"), 200);
  for (const bad of ["0", "-1", "abc", "1.5", "201", "100000", " 5 6"]) {
    assert.throws(() => reads.parseLimit(bad), (error) => error.statusCode === 400, `limit=${bad}`);
  }
});

test("dates : jour réel, période ordonnée, pas de mélange date et période", () => {
  assert.deepEqual(reads.parseRange({ date: "2026-11-04" }), { from: "2026-11-04", to: "2026-11-04" });
  assert.deepEqual(reads.parseRange({ from: "2026-01-01" }), { from: "2026-01-01", to: null });
  for (const query of [
    { date: "2026-02-30" },
    { date: "04-11-2026" },
    { from: "2026-12-01", to: "2026-01-01" },
    { date: "2026-11-04", from: "2026-11-01" },
  ]) {
    assert.throws(() => reads.parseRange(query), (error) => error.statusCode === 400, JSON.stringify(query));
  }
});

test("curseur : altéré, d'un autre filtre ou mal formé → 400", () => {
  const fp = reads.fingerprint(["presences", SCHOOL]);
  const good = reads.encodeCursor("2026-11-04", ROW_ID, fp);
  assert.deepEqual(reads.decodeCursor(good, fp, "date"), { key: "2026-11-04", id: ROW_ID });
  const otherFp = reads.fingerprint(["presences", OTHER]);
  for (const bad of [
    "pas-un-curseur",
    Buffer.from("{").toString("base64url"),
    reads.encodeCursor("2026-11-04", "pas-un-uuid", fp),
    reads.encodeCursor("2026-13-40", ROW_ID, fp),
    reads.encodeCursor("2026-11-04", ROW_ID, otherFp),
  ]) {
    assert.throws(() => reads.decodeCursor(bad, fp, "date"), (error) => error.statusCode === 400);
  }
});

test("Parent et Élève restent sur les routes historiques", () => {
  for (const principal of [{ role: "Parent" }, { role: "Élève" }, { role: "Etudiant" }, { roleKeys: ["PARENT"] }]) {
    assert.throws(() => reads.assertStaff(principal), (error) => error.statusCode === 403 && error.code === "PAGINATION_STAFF_ONLY");
  }
  assert.doesNotThrow(() => reads.assertStaff({ role: "Admin School" }));
  assert.throws(() => reads.assertStaff(null), (error) => error.statusCode === 401);
});

test("Superadmin et Admin Pays sont refusés avant la route", () => {
  for (const path of ["/api/v2/presences?limit=5", "/api/v2/payments", "/api/v2/notes?cursor=x"]) {
    assert.equal(isPlatformPersonalDataForbiddenHttp({ role: "Super Administrateur Somafrik" }, "GET", path), true, path);
    assert.equal(isPlatformPersonalDataForbiddenHttp({ role: "Admin Pays", countryCode: "CD" }, "GET", path), true, path);
  }
});

test("sans établissement résolu, aucune lecture", async () => {
  const repository = recordingRepository();
  for (const scope of [null, {}, { countryCode: "CD" }, { schoolId: "pas-un-uuid" }]) {
    await assert.rejects(
      reads.resolveReadContext(repository, { role: "Admin School" }, scope, async () => null),
      (error) => error.statusCode === 403 && error.code === "PAGINATION_SCHOOL_REQUIRED",
    );
  }
  assert.equal(repository.sql.length, 0);
});

test("enseignant sans affectation : liste vide sans requête de liste", async () => {
  const repository = recordingRepository();
  const context = await reads.resolveReadContext(repository, { role: "Enseignant" }, { schoolId: SCHOOL }, async () => []);
  for (const list of ["listPresencesPage", "listNotesPage", "listPaymentsPage"]) {
    assert.deepEqual(await reads[list](repository, context, {}), { items: [], nextCursor: null, hasMore: false });
  }
  assert.equal(repository.sql.length, 0);
});

test("chaque requête a autant de paramètres que d'emplacements, LIMIT = limit + 1", async () => {
  const context = { schoolId: SCHOOL, classIds: [ROW_ID] };
  const queries = {
    listPresencesPage: { date: "2026-11-04", classId: ROW_ID, studentId: "CD-2026-0001", status: "Retard", limit: "10" },
    listNotesPage: { classId: ROW_ID, subjectId: ROW_ID, termId: ROW_ID, studentId: "S-1", limit: "10" },
    listPaymentsPage: { from: "2026-01-01", to: "2026-12-31", studentId: "S-1", q: "Kabila", limit: "10" },
  };
  for (const [list, query] of Object.entries(queries)) {
    const repository = recordingRepository();
    await reads[list](repository, context, query);
    const [main] = repository.sql;
    assert.equal(main.params.length, placeholdersOf(main.text), list);
    assert.equal(main.params[main.params.length - 1], 11, `${list} LIMIT`);
    assert.match(main.text, /school_id = \$1::uuid/);
    assert.equal(main.params[0], SCHOOL);
  }
});

test("le curseur ajoute la comparaison keyset (clé, id) en SQL", async () => {
  const context = { schoolId: SCHOOL, classIds: null };
  const fp = reads.fingerprint(["presences", SCHOOL, "-date", { from: null, to: null }, null, null, null, ""]);
  const cursor = reads.encodeCursor("2026-11-04", ROW_ID, fp);
  const repository = recordingRepository();
  await reads.listPresencesPage(repository, context, { cursor });
  assert.match(repository.sql[0].text, /\(a\.attendance_date, a\.id\) < \(\$2::date, \$3::uuid\)/);
  assert.match(repository.sql[0].text, /ORDER BY a\.attendance_date DESC, a\.id DESC/);
});

test("une erreur PostgreSQL n'est pas remplacée par une autre lecture", async () => {
  const repository = {
    all: async () => {
      throw new Error("connection lost");
    },
  };
  const context = { schoolId: SCHOOL, classIds: null };
  for (const list of ["listPresencesPage", "listNotesPage", "listPaymentsPage"]) {
    await assert.rejects(reads[list](repository, context, {}), /connection lost/);
  }
});

test("statut et filtres inconnus refusés", async () => {
  const repository = recordingRepository();
  const context = { schoolId: SCHOOL, classIds: null };
  await assert.rejects(reads.listPresencesPage(repository, context, { status: "Inconnu" }), (e) => e.statusCode === 400);
  await assert.rejects(reads.listPresencesPage(repository, context, { classId: "x" }), (e) => e.statusCode === 400);
  await assert.rejects(reads.listNotesPage(repository, context, { sort: "score" }), (e) => e.statusCode === 400);
  await assert.rejects(reads.listPaymentsPage(repository, context, { q: "x".repeat(65) }), (e) => e.statusCode === 400);
  await assert.rejects(reads.listPaymentsPage(repository, context, { studentId: "a b" }), (e) => e.statusCode === 400);
  assert.equal(repository.sql.length, 0);
});

test("G7-RELEASE-PAGINATION-01 : curseur timestamp conservé à la microseconde", () => {
  const fp = reads.fingerprint(["notes", SCHOOL]);
  const micro = "2026-11-04T08:00:00.123456Z";
  const decoded = reads.decodeCursor(reads.encodeCursor(micro, ROW_ID, fp), fp, "timestamp");
  assert.equal(decoded.key, micro, "aucune troncature à la milliseconde");
  // Anciens curseurs (milliseconde, ou ISO non UTC) toujours acceptés.
  assert.equal(
    reads.decodeCursor(reads.encodeCursor("2026-11-04T08:00:00.123Z", ROW_ID, fp), fp, "timestamp").key,
    "2026-11-04T08:00:00.123Z",
  );
  assert.equal(
    reads.decodeCursor(reads.encodeCursor("2026-11-04T09:00:00+01:00", ROW_ID, fp), fp, "timestamp").key,
    "2026-11-04T08:00:00.000Z",
  );
  for (const bad of ["pas-une-date", "2026-11-04T08:00:00.1234567Z"]) {
    const cursor = reads.encodeCursor(bad, ROW_ID, fp);
    if (bad === "pas-une-date") {
      assert.throws(() => reads.decodeCursor(cursor, fp, "timestamp"), (error) => error.statusCode === 400);
    } else {
      // Plus de 6 décimales : hors format exact, normalisé par Date (jamais injecté tel quel).
      assert.match(reads.decodeCursor(cursor, fp, "timestamp").key, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  }
  assert.equal(
    reads.cursorTimestampSql("g.updated_at"),
    `to_char(g.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  );
});

test("G7-RELEASE-PAGINATION-01 : notes et paiements encodent la clé SQL microseconde", async () => {
  const scope = { schoolId: SCHOOL };
  const principal = { role: "Directeur", schoolId: SCHOOL };
  const key = "2026-11-04T08:00:00.123456Z";
  const rows = [
    { id: ROW_ID, updated_at: new Date("2026-11-04T08:00:00.123Z"), pagination_cursor_key: key },
    { id: OTHER, updated_at: new Date("2026-11-04T08:00:00.123Z"), pagination_cursor_key: key },
  ];
  const repo = recordingRepository(rows);
  const context = await reads.resolveReadContext(repo, principal, scope, async () => null);
  const page = await reads.listNotesPage(repo, context, { limit: "1" });
  const encoded = JSON.parse(Buffer.from(page.nextCursor, "base64url").toString("utf8"));
  assert.equal(encoded.k, key, "la clé vient de PostgreSQL, pas d'un Date JavaScript");
  assert.match(repo.sql.at(-1).text, /to_char\(g\.updated_at AT TIME ZONE 'UTC'/);
  assert.deepEqual(page.items, [{ id: ROW_ID }], "colonne technique absente du DTO");
});
