"use strict";

/**
 * CARTE-PHOTO-02 — photo d'identité canonique de l'élève pour la carte.
 *
 * Reproduit la cause racine : une photo déposée dans les pièces de l'élève (type PHOTO)
 * ne renseigne jamais students.photo_url ; la fiche renvoyait donc photoUrl = "" et la carte
 * imprimait les initiales. Vérifie ensuite GET /api/students/:id/photo : photo réelle,
 * remplacement, absence, fichier disparu, isolation inter-établissements, droits insuffisants,
 * et aucune modification des cartes existantes. Fixtures jetables, base isolée, aucun élève réel.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("path");
const { Pool } = require("pg");
const { deflateSync } = require("node:zlib");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_CARTE_PHOTO02_IT_DATABASE ?? "somafrik_carte_photo02_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_CARTE_PHOTO02_HTTP_PORT ?? 19892);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LOGIN_A = "CD-LAC-26-001";
const LOGIN_B = "BI-BUJ-26-001";
const LEFTOVER_A = "CD-2026-0001";
const LEFTOVER_B = "BI-2026-0001";
const USER_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const USER_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const USER_CARDS = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03";
const STUDENT_PHOTO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee11";
const STUDENT_NONE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee12";
const STUDENT_LOST = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee13";
const STUDENT_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee14";
// Matricules alloués par PostgreSQL (trigger) : relus après insertion.
let CODE_PHOTO = "";
let CODE_NONE = "";
let CODE_LOST = "";
let CODE_B = "";
const ADMIN_PERMS = [
  "Élèves:READ", "Élèves:UPDATE", "Gérer élèves", "Voir élèves",
  "Documents:READ", "Documents:CREATE", "Documents:UPDATE",
];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** PNG RGB uni : image de test, aucune photo réelle. */
function png(width, height, rgb) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) raw.set(rgb, y * (width * 3 + 1) + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function request(pathname, { method = "GET", token, body, headers = {} } = {}) {
  const raw = Buffer.isBuffer(body);
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    method,
    headers: {
      ...(raw ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  let data = null;
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    try {
      data = JSON.parse(bytes.toString("utf8"));
    } catch {
      data = null;
    }
  }
  return { status: response.status, data, bytes, headers: response.headers };
}

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend health timeout\n${stderrRef.value}`);
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function setLoginCodeTriggers(pool, enabled) {
  const action = enabled ? "ENABLE" : "DISABLE";
  await pool.query(`
    DO $trg$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_schools_login_code_insert') THEN
        EXECUTE 'ALTER TABLE schools ${action} TRIGGER zz_schools_login_code_insert';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_schools_login_code_update') THEN
        EXECUTE 'ALTER TABLE schools ${action} TRIGGER zz_schools_login_code_update';
      END IF;
    END
    $trg$;
  `);
}

async function ensureCountry(pool, name, iso, phone, currency) {
  const existing = await pool.query(`SELECT id FROM countries WHERE iso_code = $1 LIMIT 1`, [iso]);
  if (existing.rowCount) return existing.rows[0];
  const inserted = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, iso, phone, currency],
  );
  return inserted.rows[0];
}

async function seed(pool) {
  await setLoginCodeTriggers(pool, false);
  const cd = await ensureCountry(pool, "RDC", "CD", "+243", "CDF");
  const bi = await ensureCountry(pool, "Burundi", "BI", "+257", "BIF");
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'LAC', 'Lycee Photo A', 'active') RETURNING id`,
    [cd.id, LEFTOVER_A, LOGIN_A],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'BUJ', 'Lycee Photo B', 'active') RETURNING id`,
    [bi.id, LEFTOVER_B, LOGIN_B],
  );
  await setLoginCodeTriggers(pool, true);
  const schoolAId = schoolA.rows[0].id;
  const schoolBId = schoolB.rows[0].id;
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $4, 'ADM-PH-A', 'Admin', 'A', 'a@carte-photo02.test', 'Admin School', 'active', FALSE),
       ($2, $5, 'ADM-PH-B', 'Admin', 'B', 'b@carte-photo02.test', 'Admin School', 'active', FALSE),
       ($3, $4, 'CRD-PH-A', 'Cartes', 'A', 'c@carte-photo02.test', 'Gestion cartes', 'active', FALSE)`,
    [USER_A, USER_B, USER_CARDS, schoolAId, schoolBId],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES ($1, $4, 'SCHOOL_ADMIN', 'active'), ($2, $5, 'SCHOOL_ADMIN', 'active'), ($3, $4, 'GESTION_CARTES', 'active')`,
    [USER_A, USER_B, USER_CARDS, schoolAId, schoolBId],
  );
  const cardsRole = await pool.query(
    `INSERT INTO establishment_roles (role_code, role_name, scope, status, school_assignable)
     VALUES ('GESTION_CARTES', 'Gestion cartes', 'school', 'active', TRUE) RETURNING id`,
  );
  await pool.query(
    `INSERT INTO establishment_role_permissions (role_id, permission) VALUES ($1, 'Élèves:READ'), ($1, 'Élèves:UPDATE')`,
    [cardsRole.rows[0].id],
  );
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, status, updated_by
     ) VALUES ('GESTION_CARTES', 'global', 'students', FALSE, TRUE, TRUE, FALSE, 'active', 'carte-photo02')`,
  );
  const insertStudent = async (id, schoolId, firstName, lastName) => {
    const row = await pool.query(
      `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
       VALUES ($1, $2, 'PENDING', $3, $4, 'active') RETURNING student_code`,
      [id, schoolId, firstName, lastName],
    );
    return row.rows[0].student_code;
  };
  CODE_PHOTO = await insertStudent(STUDENT_PHOTO, schoolAId, "Onesphore", "Kabila");
  CODE_NONE = await insertStudent(STUDENT_NONE, schoolAId, "Aucune", "Photo");
  CODE_LOST = await insertStudent(STUDENT_LOST, schoolAId, "Perdue", "Fichier");
  CODE_B = await insertStudent(STUDENT_B, schoolBId, "Autre", "Ecole");
  await pool.query(
    `INSERT INTO student_access_cards (school_id, student_id, public_id, token_hash, medium, status)
     VALUES ($1, $2, 'pubPhoto02Fixture', $3, 'nfc_qr', 'active')`,
    [schoolAId, STUDENT_PHOTO, "a".repeat(64)],
  );
  return { schoolAId, schoolBId };
}

async function cardsSnapshot(pool) {
  const rows = await pool.query("SELECT row_to_json(c)::text AS row FROM student_access_cards c ORDER BY id");
  return rows.rows.map((row) => row.row);
}

async function uploadPhoto(token, code, bytes, fileName) {
  return request(`/students/${encodeURIComponent(code)}/documents`, {
    method: "POST",
    token,
    body: bytes,
    headers: { "Content-Type": "image/png", "x-document-type": "PHOTO", "x-filename": fileName },
  });
}

async function main() {
  if (!DATABASE_URL) {
    console.log("studentCardPhoto.http.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: isolatedUrl });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }

  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const repo = createPostgresRepository(isolatedUrl);
  const tokens = new TokenService({ secret: JWT_SECRET });
  const mint = (payload) => tokens.createAccessToken({ mustChangePassword: false, ...payload });
  const pool = new Pool({ connectionString: isolatedUrl });
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "somafrik-photo02-"));
  let child = null;

  try {
    await repo.init();
    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);
    const { schoolAId } = await seed(pool);
    const cardsBefore = await cardsSnapshot(pool);

    child = spawn(process.execPath, ["backend/server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(HTTP_PORT),
        DATABASE_URL: isolatedUrl,
        JWT_SECRET,
        SOMAFRIK_DB_REQUIRED: "true",
        SOMAFRIK_SKIP_DEMO_SEED: "true",
        SOMAFRIK_API_ONLY: "true",
        SOMAFRIK_COMMUNICATION_STORAGE: storage,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrRef = { value: "" };
    child.stderr.on("data", (data) => {
      stderrRef.value += String(data);
    });
    await waitForHealth(child, stderrRef);

    const tokenA = mint({ sub: USER_A, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: LEFTOVER_A, permissions: ADMIN_PERMS });
    const tokenB = mint({ sub: USER_B, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: LEFTOVER_B, permissions: ADMIN_PERMS });
    const tokenCards = mint({
      sub: USER_CARDS, role: "Gestion cartes", roleKeys: ["GESTION_CARTES"], schoolCode: LEFTOVER_A,
      permissions: ["Élèves:READ", "Élèves:UPDATE"],
    });

    const first = png(30, 39, [214, 190, 160]);
    const second = png(30, 39, [30, 60, 120]);

    // 1. Cause racine : la photo est déposée comme pièce PHOTO ; students.photo_url reste vide.
    const uploaded = await uploadPhoto(tokenA, CODE_PHOTO, first, "photo-identite.png");
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
    assert.equal(uploaded.data.documentType, "PHOTO");
    const column = await pool.query("SELECT photo_url FROM students WHERE id = $1", [STUDENT_PHOTO]);
    assert.ok(!column.rows[0].photo_url, "le téléversement ne renseigne pas students.photo_url");
    const dossier = await request(`/students/${encodeURIComponent(CODE_PHOTO)}`, { token: tokenA });
    assert.equal(dossier.status, 200, JSON.stringify(dossier.data));
    assert.equal(dossier.data.photoUrl, "", "la fiche ne transporte aucune URL : la carte affichait les initiales");

    // 2. Route canonique : photo réelle, par matricule ou par identifiant interne.
    const photo = await request(`/students/${encodeURIComponent(CODE_PHOTO)}/photo`, { token: tokenA });
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get("content-type"), "image/png");
    assert.match(photo.headers.get("cache-control") || "", /no-store/);
    assert.equal(photo.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(photo.bytes, first);
    const byUuid = await request(`/students/${STUDENT_PHOTO}/photo`, { token: tokenA });
    assert.equal(byUuid.status, 200);
    assert.deepEqual(byUuid.bytes, first);

    // 3. Photo remplacée : la plus récente est servie ; archivée, la précédente revient.
    const replaced = await uploadPhoto(tokenA, CODE_PHOTO, second, "nouvelle-photo.png");
    assert.equal(replaced.status, 201);
    assert.deepEqual((await request(`/students/${encodeURIComponent(CODE_PHOTO)}/photo`, { token: tokenA })).bytes, second);
    const archived = await request(
      `/students/${encodeURIComponent(CODE_PHOTO)}/documents/${replaced.data.id}/archive`,
      { method: "POST", token: tokenA, body: {} },
    );
    assert.equal(archived.status, 200, JSON.stringify(archived.data));
    assert.deepEqual((await request(`/students/${encodeURIComponent(CODE_PHOTO)}/photo`, { token: tokenA })).bytes, first);

    // 4. Autre pièce que PHOTO : jamais servie comme photo.
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    const birth = await request(`/students/${encodeURIComponent(CODE_NONE)}/documents`, {
      method: "POST", token: tokenA, body: pdf,
      headers: { "Content-Type": "application/pdf", "x-document-type": "BIRTH_CERTIFICATE", "x-filename": "acte.pdf" },
    });
    assert.equal(birth.status, 201, JSON.stringify(birth.data));

    // 5. Absence de photo.
    const none = await request(`/students/${encodeURIComponent(CODE_NONE)}/photo`, { token: tokenA });
    assert.equal(none.status, 404);
    assert.equal(none.data.code, "STUDENT_PHOTO_ABSENT");

    // 6. Pièce PHOTO présente, fichier disparu du stockage.
    const lost = await uploadPhoto(tokenA, CODE_LOST, first, "perdue.png");
    assert.equal(lost.status, 201);
    const key = await pool.query("SELECT storage_key FROM student_documents WHERE id = $1", [lost.data.id]);
    await fs.rm(path.join(storage, ...key.rows[0].storage_key.split("/")));
    const missing = await request(`/students/${encodeURIComponent(CODE_LOST)}/photo`, { token: tokenA });
    assert.equal(missing.status, 404);
    assert.equal(missing.data.code, "STUDENT_PHOTO_FILE_MISSING");
    assert.doesNotMatch(JSON.stringify(missing.data), /student-documents|\/tmp|storage/i);

    // 7. Isolation : un autre établissement ne lit jamais la photo, et inversement.
    const crossB = await request(`/students/${encodeURIComponent(CODE_PHOTO)}/photo`, { token: tokenB });
    assert.equal(crossB.status, 404);
    assert.equal(crossB.bytes.includes(first), false);
    const crossUuid = await request(`/students/${STUDENT_PHOTO}/photo`, { token: tokenB });
    assert.equal(crossUuid.status, 404);
    const crossA = await request(`/students/${encodeURIComponent(CODE_B)}/photo`, { token: tokenA });
    assert.equal(crossA.status, 404);

    // 8. Droits : sans Documents:READ, aucune image ; sans jeton, 401.
    const denied = await request(`/students/${encodeURIComponent(CODE_PHOTO)}/photo`, { token: tokenCards });
    assert.equal(denied.status, 403, `status ${denied.status}`);
    assert.equal(denied.bytes.includes(first), false);
    const anonymous = await request(`/students/${encodeURIComponent(CODE_PHOTO)}/photo`);
    assert.equal(anonymous.status, 401);

    // 9. Cartes existantes inchangées : public_id, token_hash, statut, NFC.
    assert.deepEqual(await cardsSnapshot(pool), cardsBefore);
    const cardCount = await pool.query("SELECT count(*)::int AS n FROM student_access_cards WHERE school_id = $1", [schoolAId]);
    assert.equal(cardCount.rows[0].n, 1);
    assert.doesNotMatch(stderrRef.value, /Bearer |eyJ[A-Za-z0-9_-]{10,}/);

    console.log("studentCardPhoto.http.pg.test.js PASS");
  } finally {
    await stopChild(child);
    await pool.end();
    await repo.close?.();
    await fs.rm(storage, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
