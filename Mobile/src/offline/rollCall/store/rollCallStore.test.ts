/**
 * NFC-PRES-LOCAL-PR2 — base locale d'appel : sécurité, persistance, immutabilité, résilience, purge.
 *   npx --yes tsx --test src/offline/rollCall/store/rollCallStore.test.ts
 *
 * Moteur SQLite réel (node:sqlite, fichiers réels) ; SQLCipher simulé (voir rcTestPlatform.testutil.ts).
 * Le chiffrement effectif sur disque et la persistance après arrêt forcé sur Android sont prouvés par
 * scripts/run-rc-offline-native-smoke.js.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { RC_DEVICE_SALT_KEY, RC_REGISTRY_FILE, parseRegistry } from "./accountFiles";
import { createRollCallAccountManager, loadRevocationState, type RcActiveAccount } from "./accountManager";
import { openRollCallAccountDatabase, type RcIdentity } from "./database";
import { createTestPlatform } from "./rcTestPlatform.testutil";
import {
  beginSyncAttempt,
  closeSession,
  countPendingSessions,
  getSession,
  listSessions,
  openDraftSession,
  readCounts,
  readStoredPackText,
  recordScan,
  recordSyncOutcome,
  removeScan,
  reviseSession,
  runPurge,
  setManualMark,
  storePack,
  type RcContext,
} from "./repository";
import { RC_FORBIDDEN_COLUMN_NAMES, RC_SCHEMA_V1 } from "./schema";
import { acceptDownloadedPack, loadUsablePack } from "../pack/packService";
import { validatePackKeyring } from "../pack/keyring";

const ROOT = path.resolve(__dirname, "../../../../..");
/* eslint-disable @typescript-eslint/no-require-imports */
const { createPackSigner } = require(path.join(ROOT, "backend/lib/rollCallOfflinePackSigner.js"));
const { buildPack, computePackWindow } = require(path.join(ROOT, "backend/lib/rollCallOfflinePack.js"));
const { computePayloadDigest: backendDigest } = require(path.join(ROOT, "backend/lib/rollCallOfflineProof.js"));
/* eslint-enable @typescript-eslint/no-require-imports */

const PROD = "production-3f2a9c1d";
const PREPROD = "preproduction-3f2a9c1d";
const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_1 = "22222222-2222-4222-8222-222222222222";
const USER_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLASS = "33333333-3333-4333-8333-333333333333";
const DATE = "2026-11-09";
const STUDENT_1 = "55555555-5555-4555-8555-555555555555";
const STUDENT_2 = "66666666-6666-4666-8666-666666666666";

function tmpDir(label: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rc-${label}-`));
}

function identity(userId = USER_1, schoolId = SCHOOL_A, environmentId = PROD): RcIdentity {
  return { environmentId, userId, schoolId };
}

function proof() {
  return crypto.randomBytes(32).toString("base64url");
}

function publicId() {
  return crypto.randomBytes(17).toString("base64url").slice(0, 22);
}

async function activate(manager: ReturnType<typeof createRollCallAccountManager>, who: RcIdentity): Promise<RcActiveAccount> {
  const result = await manager.activate(who);
  assert.ok(result.ok, JSON.stringify(result));
  return (result as { account: RcActiveAccount }).account;
}

async function draftWithScans(ctx: RcContext, count: number, match = false) {
  const { session } = await openDraftSession(ctx, { classId: CLASS, date: DATE, packId: null, syncDeadline: "2026-11-12T23:00:00Z" });
  for (let i = 0; i < count; i += 1) {
    const result = await recordScan(ctx, {
      sessionId: session.session_id,
      scanId: crypto.randomUUID(),
      publicId: publicId(),
      proof: proof(),
      medium: i % 2 ? "qr" : "nfc",
      scannedAt: new Date(Date.parse("2026-11-09T07:31:00Z") + i * 1000).toISOString(),
      match: match ? { matchKey: `MK-${i}`, studentId: crypto.randomUUID() } : null,
    });
    assert.equal(result.status, "recorded");
  }
  return session;
}

function rawOpen(dir: string, fileName: string) {
  return new DatabaseSync(path.join(dir, fileName));
}

// ---------------------------------------------------------------------------------------------
// Sécurité et cloisonnement
// ---------------------------------------------------------------------------------------------

test("cloisonnement : deux comptes, deux établissements, deux environnements → fichiers et clés distincts", async () => {
  const dir = tmpDir("iso");
  const platform = createTestPlatform({ dir });
  const manager = createRollCallAccountManager(platform);
  const identities = [identity(), identity(USER_2), identity(USER_1, SCHOOL_B), identity(USER_1, SCHOOL_A, PREPROD)];
  const accounts: RcActiveAccount[] = [];
  for (const who of identities) accounts.push(await activate(manager, who));
  const files = new Set(accounts.map((a) => a.fileName));
  const keys = new Set(accounts.map((a) => a.keyName));
  assert.equal(files.size, 4);
  assert.equal(keys.size, 4);
  const store = platform.keyStore.dump();
  const keyValues = accounts.map((a) => store[a.keyName]);
  assert.equal(new Set(keyValues).size, 4, "une clé de 256 bits différente par compte");
  for (const value of keyValues) assert.match(value, /^[0-9a-f]{64}$/);
  for (const account of accounts) {
    assert.match(account.fileName, /^somafrik-rollcall-v1-(production|preproduction)-3f2a9c1d-[A-Za-z0-9_-]{23}\.db$/);
    for (const id of [USER_1, USER_2, SCHOOL_A, SCHOOL_B]) {
      assert.equal(account.fileName.includes(id), false);
      assert.equal(account.fileName.includes(id.slice(0, 8)), false);
    }
  }
  assert.match(store[RC_DEVICE_SALT_KEY], /^[0-9a-f]{64}$/);
  // Le registre hors base ne contient aucun identifiant d'utilisateur ou d'établissement, ni clé.
  const registryText = fs.readFileSync(path.join(dir, RC_REGISTRY_FILE), "utf8");
  for (const secret of [USER_1, USER_2, SCHOOL_A, SCHOOL_B, ...keyValues]) assert.equal(registryText.includes(secret), false);
  assert.equal(parseRegistry(registryText).accounts.length, 4);
});

test("changement de compte avec brouillon en attente : base fermée, aucune donnée croisée, reprise au retour", async () => {
  const dir = tmpDir("switch");
  const manager = createRollCallAccountManager(createTestPlatform({ dir }));
  const first = await activate(manager, identity());
  const draft = await draftWithScans(first.ctx, 3);
  const second = await activate(manager, identity(USER_2));
  await assert.rejects(first.ctx.connection.read(async () => 1), /fermée/);
  assert.deepEqual(await listSessions(second.ctx), []);
  assert.equal(await countPendingSessions(second.ctx), 0);
  // Une session du compte 1 n'est pas lisible avec le contexte du compte 2, même par identifiant.
  await assert.rejects(getSession(second.ctx, draft.session_id), /introuvable/);
  const back = await activate(manager, identity());
  const sessions = await listSessions(back.ctx);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].state, "draft");
  assert.equal((await readCounts(back.ctx, draft.session_id)).scans, 3);
});

test("mauvaise clé : ouverture refusée visiblement, fichier jamais écrasé, aucune lecture possible du contenu", async () => {
  const dir = tmpDir("wrongkey");
  const platform = createTestPlatform({ dir });
  const manager = createRollCallAccountManager(platform);
  const account = await activate(manager, identity());
  await draftWithScans(account.ctx, 2);
  await manager.close();
  // Clé remplacée dans SecureStore (corruption, restauration partielle) : la base ne s'ouvre pas.
  const wrongKey = crypto.randomBytes(32).toString("hex");
  await platform.keyStore.setItem(account.keyName, wrongKey);
  const before = fs.readFileSync(path.join(dir, account.fileName));
  const refused = await manager.activate(identity());
  assert.equal(refused.ok, false);
  assert.equal((refused as { code: string }).code, "RC_DATABASE_UNREADABLE");
  assert.equal(manager.current(), null, "aucune base ouverte");
  const quarantine = fs.readdirSync(dir).find((name) => /\.db\.quarantine-\d+$/.test(name));
  assert.ok(quarantine, "fichier d'origine conservé en quarantaine");
  assert.deepEqual(fs.readFileSync(path.join(dir, quarantine as string)), before, "octets intacts");
  assert.equal(await platform.keyStore.getItem(account.keyName), null, "clé retirée du nom actif");
  assert.equal(await platform.keyStore.getItem(`${account.keyName}.${(quarantine as string).split(".").pop()}`), wrongKey, "clé suivie en quarantaine");
  assert.equal(await manager.pendingQuarantines(), 1, "quarantaine inscrite pour sa purge à 7 jours");
  // Lecture directe avec une clé arbitraire : refus du moteur simulé SQLCipher.
  const direct = await platform.openDatabase(quarantine as string);
  await direct.execAsync("PRAGMA key = 'autre'");
  await assert.rejects(direct.getAllAsync("SELECT * FROM rc_sessions"), /not a database/);
  // Ouverture suivante : base neuve, vide, avec une nouvelle clé.
  const fresh = await activate(manager, identity());
  assert.deepEqual(await listSessions(fresh.ctx), []);
  assert.notEqual(platform.keyStore.dump()[fresh.keyName], wrongKey);
});
test("aucun repli SQLite en clair : SQLCipher absent ou fichier en clair → refus, aucune base laissée", async () => {
  const dir = tmpDir("nocipher");
  const noCipher = await openRollCallAccountDatabase(createTestPlatform({ dir, cipherVersion: "" }), identity());
  assert.deepEqual(noCipher.ok, false);
  assert.equal((noCipher as { code: string }).code, "RC_SQLCIPHER_REQUIRED");
  assert.equal(fs.readdirSync(dir).filter((name) => name.endsWith(".db")).length, 0);

  const plainDir = tmpDir("plain");
  const plaintext = await openRollCallAccountDatabase(createTestPlatform({ dir: plainDir, plaintextHeader: true }), identity());
  assert.equal((plaintext as { code: string }).code, "RC_SQLCIPHER_PLAINTEXT_FILE");
  assert.equal(fs.readdirSync(plainDir).filter((name) => name.includes(".db")).length, 0, "fichier en clair supprimé");

  const web = await openRollCallAccountDatabase({ ...createTestPlatform({ dir: tmpDir("web") }), platform: "web" }, identity());
  assert.equal((web as { code: string }).code, "RC_SQLCIPHER_REQUIRED");
  const anonymous = await openRollCallAccountDatabase(createTestPlatform({ dir: tmpDir("anon") }), identity(""));
  assert.equal((anonymous as { code: string }).code, "RC_IDENTITY_REQUIRED");
});

test("aucun secret dans le SQL, le registre ou le schéma ; colonnes interdites absentes", async () => {
  const dir = tmpDir("secrets");
  const sqlLog: string[] = [];
  const platform = createTestPlatform({ dir, sqlLog });
  const manager = createRollCallAccountManager(platform);
  const account = await activate(manager, identity());
  const session = await draftWithScans(account.ctx, 2, true);
  await closeSession(account.ctx, session.session_id);
  const dbKey = platform.keyStore.dump()[account.keyName];
  const salt = platform.keyStore.dump()[RC_DEVICE_SALT_KEY];
  for (const sql of sqlLog) {
    assert.equal(sql.includes(dbKey), false, "clé SQLCipher jamais dans un texte SQL");
    assert.equal(sql.includes(salt), false);
  }
  assert.ok(sqlLog.some((sql) => sql === "PRAGMA key = '<redacted>'"));
  for (const column of RC_FORBIDDEN_COLUMN_NAMES) assert.doesNotMatch(RC_SCHEMA_V1, new RegExp(`\\b${column}\\b`, "i"));
  const meta = await account.ctx.connection.read((db) => db.getAllAsync<{ key: string; value: string }>("SELECT key, value FROM rc_meta"));
  for (const row of meta) {
    assert.equal(row.value.includes(dbKey), false);
    assert.equal(row.value.includes(salt), false);
    assert.equal(row.value.includes(USER_1), false);
  }
  const attempts = await beginSyncAttempt(account.ctx, session.session_id);
  await recordSyncOutcome(account.ctx, session.session_id, attempts.operationId, { kind: "http", httpStatus: 503, errorCode: "Mot de passe: x" });
  const journal = await account.ctx.connection.read((db) => db.getAllAsync<Record<string, unknown>>("SELECT * FROM rc_sync_attempts"));
  assert.deepEqual(Object.keys(journal[0]).sort(), ["attempt", "error_code", "http_status", "id", "operation_id", "session_id", "started_at"]);
  assert.equal(journal[0].error_code, "UNKNOWN_ERROR", "code d'erreur non conforme jamais recopié");
  await assert.rejects(
    account.ctx.connection.transaction((db) =>
      db.runAsync("INSERT INTO rc_sync_attempts (session_id, operation_id, attempt, started_at, error_code) VALUES (?, ?, 9, 'x', 'nom prénom')", [
        session.session_id,
        attempts.operationId,
      ]),
    ),
  );
});

// ---------------------------------------------------------------------------------------------
// Cas reportés de test-rollcall-local-store.mjs et test-rollcall-schema.cjs
// ---------------------------------------------------------------------------------------------

test("compteurs : chaque opération concurrente renvoie l'instantané de SON commit (scans et marques)", async () => {
  const manager = createRollCallAccountManager(createTestPlatform({ dir: tmpDir("concurrent") }));
  const { ctx } = await activate(manager, identity());
  const opening = openDraftSession(ctx, { classId: CLASS, date: DATE, packId: null, syncDeadline: null });
  const { session } = await opening;
  const scan = (i: number) =>
    recordScan(ctx, { sessionId: session.session_id, scanId: crypto.randomUUID(), publicId: publicId(), proof: proof(), medium: "nfc", scannedAt: "2026-11-09T07:31:00Z", match: { matchKey: `MK-${i}`, studentId: crypto.randomUUID() } });
  const concurrent = await Promise.all([scan(1), scan(2), scan(3)]);
  assert.deepEqual(concurrent.map((r) => r.counts.scans), [1, 2, 3], "aucune opération ne renvoie le compteur d'une opération ultérieure");
  const marks = await Promise.all(
    [4, 5].map((i) => setManualMark(ctx, { sessionId: session.session_id, matchKey: `MK-${i}`, studentId: crypto.randomUUID(), status: "absent" })),
  );
  assert.deepEqual(marks.map((m) => m.absent), [1, 2]);
  await closeSession(ctx, session.session_id);
  // Après clôture : scan, doublon et marque refusés, compteurs inchangés.
  const frozen = await readCounts(ctx, session.session_id);
  await assert.rejects(scan(9), /RC_SESSION_NOT_DRAFT/);
  const firstCard = (await ctx.connection.read((db) => db.getFirstAsync<{ public_id: string }>("SELECT public_id FROM rc_scans LIMIT 1")))!.public_id;
  await assert.rejects(
    recordScan(ctx, { sessionId: session.session_id, scanId: crypto.randomUUID(), publicId: firstCard, proof: proof(), medium: "nfc", scannedAt: "2026-11-09T07:31:00Z", match: null }),
    /RC_SESSION_NOT_DRAFT/,
    "doublon sur un appel clôturé : refus, pas un succès",
  );
  await assert.rejects(setManualMark(ctx, { sessionId: session.session_id, matchKey: "MK-9", studentId: STUDENT_1, status: "late" }), /RC_SESSION_NOT_DRAFT/);
  assert.deepEqual(await readCounts(ctx, session.session_id), frozen);
});

test("schéma : déplacement de scans ou de marques entre sessions refusé, statut excused refusé, session inconnue refusée", async () => {
  const manager = createRollCallAccountManager(createTestPlatform({ dir: tmpDir("schema") }));
  const { ctx } = await activate(manager, identity());
  const closedOne = await draftWithScans(ctx, 1, true);
  await closeSession(ctx, closedOne.session_id);
  const { session: draft } = await openDraftSession(ctx, { classId: "99999999-9999-4999-8999-999999999999", date: DATE, packId: null, syncDeadline: null });
  await recordScan(ctx, { sessionId: draft.session_id, scanId: crypto.randomUUID(), publicId: publicId(), proof: proof(), medium: "nfc", scannedAt: "2026-11-09T07:31:00Z", match: { matchKey: "MK-D", studentId: STUDENT_2 } });
  const attempts: Array<[string, unknown[]]> = [
    ["UPDATE rc_scans SET session_id = ? WHERE session_id = ?", [closedOne.session_id, draft.session_id]],
    ["UPDATE rc_scans SET session_id = ? WHERE session_id = ?", [draft.session_id, closedOne.session_id]],
    ["UPDATE rc_marks SET session_id = ? WHERE session_id = ?", [closedOne.session_id, draft.session_id]],
    ["UPDATE rc_marks SET session_id = ? WHERE session_id = ?", [draft.session_id, closedOne.session_id]],
    ["INSERT INTO rc_marks (session_id, match_key, student_id, status, source, updated_at) VALUES (?, 'MK-E', ?, 'excused', 'manual', 'x')", [draft.session_id, STUDENT_1]],
    ["INSERT INTO rc_scans (scan_id, session_id, public_id, proof, medium, scanned_at, local_status) VALUES (?, ?, ?, ?, 'nfc', 'x', 'unknown_local')", [crypto.randomUUID(), crypto.randomUUID(), publicId(), proof()]],
  ];
  for (const [sql, params] of attempts) {
    await assert.rejects(ctx.connection.transaction((db) => db.runAsync(sql, params)), /RC_/, sql);
  }
  const owners = await ctx.connection.read((db) => db.getAllAsync<{ session_id: string; n: number }>("SELECT session_id, count(*) AS n FROM rc_scans GROUP BY session_id ORDER BY session_id"));
  assert.deepEqual(owners.map((row) => ({ ...row })).sort((a, b) => (a.session_id < b.session_id ? -1 : 1)), [
    { session_id: closedOne.session_id, n: 1 },
    { session_id: draft.session_id, n: 1 },
  ].sort((a, b) => (a.session_id < b.session_id ? -1 : 1)));
});

test("SQLCipher absent : aucune instruction DDL exécutée", async () => {
  const sqlLog: string[] = [];
  const result = await openRollCallAccountDatabase(createTestPlatform({ dir: tmpDir("noddl"), cipherVersion: "", sqlLog }), identity());
  assert.equal((result as { code: string }).code, "RC_SQLCIPHER_REQUIRED");
  assert.equal(sqlLog.some((sql) => /CREATE|INSERT|BEGIN/i.test(sql)), false, sqlLog.join("\n"));
});

// ---------------------------------------------------------------------------------------------
// Persistance et transactions
// ---------------------------------------------------------------------------------------------

test("session, scans multiples, déduplication active, retrait puis nouveau scan de la même carte", async () => {
  const manager = createRollCallAccountManager(createTestPlatform({ dir: tmpDir("dedup") }));
  const { ctx } = await activate(manager, identity());
  const { session, resumed } = await openDraftSession(ctx, { classId: CLASS, date: DATE, packId: null, syncDeadline: null });
  assert.equal(resumed, false);
  assert.equal(session.sync_deadline, "2026-11-13T12:00:00.000Z", "borne locale la plus tardive sans pack (D+4 12:00 UTC)");
  const card = publicId();
  const scan = { sessionId: session.session_id, publicId: card, proof: proof(), medium: "nfc" as const, scannedAt: "2026-11-09T07:31:00.000Z", match: { matchKey: "MK-1", studentId: STUDENT_1 } };
  const firstScanId = crypto.randomUUID();
  assert.equal((await recordScan(ctx, { ...scan, scanId: firstScanId })).status, "recorded");
  const duplicate = await recordScan(ctx, { ...scan, scanId: crypto.randomUUID(), medium: "qr" });
  assert.equal(duplicate.status, "duplicate");
  assert.deepEqual(duplicate.counts, { scans: 1, verified: 1, unknown: 0, present: 1, late: 0, absent: 0 });
  // Deuxième carte du même élève : un scan de plus, une seule marque.
  await recordScan(ctx, { ...scan, scanId: crypto.randomUUID(), publicId: publicId() });
  assert.deepEqual(await readCounts(ctx, session.session_id), { scans: 2, verified: 2, unknown: 0, present: 1, late: 0, absent: 0 });
  await removeScan(ctx, session.session_id, firstScanId);
  assert.equal((await recordScan(ctx, { ...scan, scanId: crypto.randomUUID() })).status, "recorded", "carte retirée de nouveau scannable");
  // Le moteur refuse lui-même un doublon actif, même si le code applicatif était contourné.
  await assert.rejects(
    ctx.connection.transaction((db) =>
      db.runAsync(
        "INSERT INTO rc_scans (scan_id, session_id, public_id, proof, medium, scanned_at, local_status) VALUES (?, ?, ?, ?, 'nfc', 'x', 'unknown_local')",
        [crypto.randomUUID(), session.session_id, card, proof()],
      ),
    ),
    (error: { code?: string }) => error.code === "RC_STORAGE_CONSTRAINT",
  );
  // Un seul brouillon par classe et par jour : reprise, puis refus moteur d'un second brouillon.
  assert.equal((await openDraftSession(ctx, { classId: CLASS, date: DATE, packId: null, syncDeadline: null })).resumed, true);
  await assert.rejects(
    ctx.connection.transaction((db) =>
      db.runAsync(
        "INSERT INTO rc_sessions (session_id, user_id, school_id, class_id, roll_call_date, mode, state, opened_at, sync_deadline) VALUES (?, ?, ?, ?, ?, 'teacher', 'draft', 'x', 'y')",
        [crypto.randomUUID(), USER_1, SCHOOL_A, CLASS, DATE],
      ),
    ),
  );
});

test("transaction : une erreur annule tout l'événement ; aucun compteur modifié", async () => {
  const manager = createRollCallAccountManager(createTestPlatform({ dir: tmpDir("rollback") }));
  const { ctx } = await activate(manager, identity());
  const session = await draftWithScans(ctx, 2, true);
  const before = await readCounts(ctx, session.session_id);
  await assert.rejects(
    ctx.connection.transaction(async (db) => {
      await db.runAsync(
        "INSERT INTO rc_scans (scan_id, session_id, public_id, proof, medium, scanned_at, local_status, match_key) VALUES (?, ?, ?, ?, 'nfc', 'x', 'verified_local', 'MK-X')",
        [crypto.randomUUID(), session.session_id, publicId(), proof()],
      );
      await db.runAsync("INSERT INTO rc_marks (session_id, match_key, student_id, status, source, updated_at) VALUES (?, 'MK-X', ?, 'present', 'card', 'x')", [
        session.session_id,
        STUDENT_1,
      ]);
      throw new Error("panne simulée avant COMMIT");
    }),
  );
  assert.deepEqual(await readCounts(ctx, session.session_id), before);
  // Entrée invalide : refusée avant toute écriture.
  await assert.rejects(
    recordScan(ctx, { sessionId: session.session_id, scanId: crypto.randomUUID(), publicId: "court", proof: proof(), medium: "nfc", scannedAt: "2026-11-09T07:31:00Z", match: null }),
    /Carte invalide/,
  );
  assert.deepEqual(await readCounts(ctx, session.session_id), before);
});

test("COMMIT refusé (disque plein au COMMIT) : aucun succès ni compteur renvoyé, événement annulé", async () => {
  const platform = createTestPlatform({ dir: tmpDir("commitfail") });
  let failNextCommit = false;
  const flaky = {
    ...platform,
    openDatabase: async (name: string, options?: { useNewConnection?: boolean }) => {
      const db = await platform.openDatabase(name, options);
      return {
        ...db,
        async execAsync(sql: string) {
          if (failNextCommit && /^\s*COMMIT\s*$/i.test(sql)) {
            failNextCommit = false;
            throw new Error("SQLITE_FULL: database or disk is full");
          }
          return db.execAsync(sql);
        },
      };
    },
  };
  const manager = createRollCallAccountManager(flaky);
  const { ctx } = await activate(manager, identity());
  const session = await draftWithScans(ctx, 2);
  const before = await readCounts(ctx, session.session_id);
  failNextCommit = true;
  let resolved: unknown = null;
  await assert.rejects(
    recordScan(ctx, { sessionId: session.session_id, scanId: crypto.randomUUID(), publicId: publicId(), proof: proof(), medium: "nfc", scannedAt: "2026-11-09T07:31:00Z", match: null }).then((value) => {
      resolved = value;
      return value;
    }),
    (error: { code?: string }) => error.code === "RC_STORAGE_FULL",
  );
  assert.equal(resolved, null, "aucune confirmation renvoyée");
  assert.deepEqual(await readCounts(ctx, session.session_id), before, "scan annulé par ROLLBACK");
});

test("redémarrage : brouillon et scans relus après fermeture et réouverture de la base", async () => {
  const dir = tmpDir("restart");
  const platform = createTestPlatform({ dir });
  const first = createRollCallAccountManager(platform);
  const account = await activate(first, identity());
  const session = await draftWithScans(account.ctx, 5, true);
  await setManualMark(account.ctx, { sessionId: session.session_id, matchKey: "MK-1", studentId: STUDENT_2, status: "late" });
  await first.close();
  const second = createRollCallAccountManager(platform); // nouveau processus simulé
  const reopened = await activate(second, identity());
  const [recovered] = await listSessions(reopened.ctx);
  assert.equal(recovered.session_id, session.session_id);
  assert.equal(recovered.state, "draft");
  assert.deepEqual(await readCounts(reopened.ctx, session.session_id), { scans: 5, verified: 5, unknown: 0, present: 4, late: 1, absent: 0 });
});

test("clôture : corps figé conforme au contrat PR1c, digest identique au Backend, immutabilité imposée par le moteur", async () => {
  const manager = createRollCallAccountManager(createTestPlatform({ dir: tmpDir("freeze") }));
  const { ctx } = await activate(manager, identity());
  const { session } = await openDraftSession(ctx, { classId: CLASS, date: DATE, packId: "44444444-4444-4444-8444-444444444444", syncDeadline: "2026-11-12T23:00:00Z" });
  await recordScan(ctx, { sessionId: session.session_id, scanId: crypto.randomUUID(), publicId: publicId(), proof: proof(), medium: "nfc", scannedAt: "2026-11-09T07:31:00.000Z", match: { matchKey: "MK-A", studentId: STUDENT_1 } });
  await recordScan(ctx, { sessionId: session.session_id, scanId: crypto.randomUUID(), publicId: publicId(), proof: proof(), medium: "qr", scannedAt: "2026-11-09T07:32:00.000Z", match: null });
  const roster = [
    { matchKey: "MK-A", studentId: STUDENT_1, existingStatus: null },
    { matchKey: "MK-B", studentId: STUDENT_2, existingStatus: null },
    { matchKey: "MK-C", studentId: "77777777-7777-4777-8777-777777777777", existingStatus: "excused" },
  ];
  void roster; // NFC-APPEL-PARTIEL-01 : la liste n'intervient plus dans la clôture
  const frozen = await closeSession(ctx, session.session_id);
  const body = JSON.parse(frozen.frozenBody);
  assert.deepEqual(Object.keys(body).sort(), ["classId", "complete", "contractVersion", "date", "manual", "mode", "operationId", "packId", "payloadDigest", "revision", "scans", "schoolId", "sessionId"]);
  assert.equal(body.complete, false, "couverture partielle (NFC-APPEL-PARTIEL-01)");
  assert.equal(body.operationId, frozen.operationId);
  assert.deepEqual(body.manual, [], "aucune absence déduite pour l'inscrit non scanné : il reste non pointé");
  const defaults = await ctx.connection.transaction((db) => db.getAllAsync("SELECT 1 FROM rc_marks WHERE session_id = ? AND source = 'default'", [session.session_id]));
  assert.equal(defaults.length, 0, "aucune marque default créée à la clôture");
  assert.equal(body.scans.length, 2);
  assert.ok(body.scans[0].scanId < body.scans[1].scanId, "scans triés par scanId");
  assert.equal(frozen.payloadDigest, backendDigest(body), "digest recalculé à l'identique par le Backend");

  await assert.rejects(recordScan(ctx, { sessionId: session.session_id, scanId: crypto.randomUUID(), publicId: publicId(), proof: proof(), medium: "nfc", scannedAt: "2026-11-09T07:33:00Z", match: null }), /clôturé/);
  const forbidden: Array<[string, unknown[]]> = [
    ["UPDATE rc_sessions SET frozen_body = ? WHERE session_id = ?", ["{}", session.session_id]],
    ["UPDATE rc_sessions SET operation_id = ? WHERE session_id = ?", [crypto.randomUUID(), session.session_id]],
    ["UPDATE rc_sessions SET payload_digest = ? WHERE session_id = ?", ["0".repeat(64), session.session_id]],
    ["UPDATE rc_sessions SET state = 'draft', operation_id = NULL, payload_digest = NULL, frozen_body = NULL WHERE session_id = ?", [session.session_id]],
    ["UPDATE rc_sessions SET user_id = ? WHERE session_id = ?", [USER_2, session.session_id]],
    ["UPDATE rc_sessions SET state = 'synced', synced_at = 'x' WHERE session_id = ?", [session.session_id]],
    ["UPDATE rc_scans SET proof = NULL WHERE session_id = ?", [session.session_id]],
    ["UPDATE rc_marks SET status = 'present' WHERE session_id = ?", [session.session_id]],
    ["DELETE FROM rc_scans WHERE session_id = ?", [session.session_id]],
    ["DELETE FROM rc_sessions WHERE session_id = ?", [session.session_id]],
  ];
  for (const [sql, params] of forbidden) {
    await assert.rejects(ctx.connection.transaction((db) => db.runAsync(sql, params)), (error: { code?: string }) => /^RC_/.test(String(error.code)), sql);
  }
  const after = await getSession(ctx, session.session_id);
  assert.equal(after.frozen_body, frozen.frozenBody, "corps figé intact après les tentatives");
  assert.equal(after.state, "closed");
});

test("révision refusée sans not_recorded (timeout, 5xx, 401, 403, ACK divergent) puis permise avec not_recorded", async () => {
  const manager = createRollCallAccountManager(createTestPlatform({ dir: tmpDir("revision") }));
  const { ctx } = await activate(manager, identity());
  const session = await draftWithScans(ctx, 1);
  const first = await closeSession(ctx, session.session_id);
  const outcomes = [
    { kind: "network" as const },
    { kind: "http" as const, httpStatus: 504 },
    { kind: "http" as const, httpStatus: 429 },
    { kind: "http" as const, httpStatus: 401 },
    { kind: "http" as const, httpStatus: 403, errorCode: "REPLAY_FORBIDDEN" },
    { kind: "http" as const, httpStatus: 200, ack: { operationId: first.operationId, revision: 1, payloadDigest: "0".repeat(64) } },
  ];
  const expectedStates = ["failed_retryable", "failed_retryable", "failed_retryable", "unconfirmable", "unconfirmable", "failed_action_required"];
  for (const [index, outcome] of outcomes.entries()) {
    const current = await getSession(ctx, session.session_id);
    if (current.state === "failed_action_required") break;
    const attempt = await beginSyncAttempt(ctx, session.session_id);
    assert.equal(attempt.frozenBody, first.frozenBody, "renvoi des mêmes octets");
    assert.equal(attempt.operationId, first.operationId);
    const decision = await recordSyncOutcome(ctx, session.session_id, attempt.operationId, outcome);
    assert.equal(decision.state, expectedStates[index]);
    await assert.rejects(reviseSession(ctx, session.session_id), /not_recorded/);
    await assert.rejects(
      ctx.connection.transaction((db) =>
        db.runAsync("UPDATE rc_sessions SET state = 'draft', revision = 2, operation_id = NULL, payload_digest = NULL, frozen_body = NULL WHERE session_id = ?", [session.session_id]),
      ),
      /RC_/,
    );
  }
  const mismatch = await getSession(ctx, session.session_id);
  assert.equal(mismatch.state, "failed_action_required");
  assert.equal(mismatch.last_error_code, "ACK_MISMATCH");
  assert.equal(mismatch.last_session_state, null);

  // Autre session : erreur W attestée not_recorded → révision autorisée, même sessionId, nouvel operationId.
  const other = await draftWithScans(ctx, 1);
  const closed = await closeSession(ctx, other.session_id);
  const attempt = await beginSyncAttempt(ctx, other.session_id);
  await recordSyncOutcome(ctx, other.session_id, attempt.operationId, { kind: "http", httpStatus: 409, errorCode: "ROLL_CALL_ROSTER_CHANGED", sessionState: "not_recorded" });
  const revised = await reviseSession(ctx, other.session_id);
  assert.equal(revised.state, "draft");
  assert.equal(revised.revision, 2);
  assert.equal(revised.session_id, other.session_id);
  const reclosed = await closeSession(ctx, other.session_id);
  assert.notEqual(reclosed.operationId, closed.operationId);
  assert.equal(JSON.parse(reclosed.frozenBody).revision, 2);
  // Une révision ne peut pas être « rejouée » sur une réponse plus ancienne : après un nouvel envoi
  // terminé par un timeout, l'attestation not_recorded précédente ne vaut plus.
  const retry = await beginSyncAttempt(ctx, other.session_id);
  await recordSyncOutcome(ctx, other.session_id, retry.operationId, { kind: "http", httpStatus: 409, sessionState: "not_recorded" });
  const again = await beginSyncAttempt(ctx, other.session_id).catch(() => null);
  assert.equal(again, null, "failed_action_required : aucun renvoi, seule la révision est possible");
  // Réponse d'une autre opération refusée.
  await assert.rejects(recordSyncOutcome(ctx, other.session_id, crypto.randomUUID(), { kind: "network" }));
});

test("synchronisation confirmée : preuves, corps figé et pack purgés ; résumé conservé 7 jours", async () => {
  const platform = createTestPlatform({ dir: tmpDir("synced") });
  const manager = createRollCallAccountManager(platform);
  const { ctx } = await activate(manager, identity());
  const packId = "44444444-4444-4444-8444-444444444444";
  await storePack(ctx, { packId, classId: CLASS, date: DATE, expiresAt: "2026-11-09T23:00:00Z", envelopeText: '{"pack":{}}' });
  const { session } = await openDraftSession(ctx, { classId: CLASS, date: DATE, packId, syncDeadline: "2026-11-12T23:00:00Z" });
  await recordScan(ctx, { sessionId: session.session_id, scanId: crypto.randomUUID(), publicId: publicId(), proof: proof(), medium: "nfc", scannedAt: "2026-11-09T07:31:00Z", match: { matchKey: "MK-A", studentId: STUDENT_1 } });
  const frozen = await closeSession(ctx, session.session_id);
  const attempt = await beginSyncAttempt(ctx, session.session_id);
  const decision = await recordSyncOutcome(ctx, session.session_id, attempt.operationId, {
    kind: "http",
    httpStatus: 201,
    ack: { operationId: frozen.operationId, revision: 1, payloadDigest: frozen.payloadDigest, rollCallId: crypto.randomUUID(), counts: { present: 1, late: 0, absent: 0, excused: 0, enrolled: 1, studentName: "x" } },
  });
  assert.equal(decision.state, "synced");
  const synced = await getSession(ctx, session.session_id);
  assert.equal(synced.frozen_body, null);
  assert.deepEqual(JSON.parse(String(synced.summary_counts)), { absent: 0, enrolled: 1, excused: 0, late: 0, present: 1 });
  const proofs = await ctx.connection.read((db) => db.getAllAsync<{ proof: string | null }>("SELECT proof FROM rc_scans"));
  assert.deepEqual(proofs.map((row) => ({ ...row })), [{ proof: null }]);
  assert.equal(await readStoredPackText(ctx, packId), null, "pack (noms d'élèves) supprimé");
  assert.equal(await countPendingSessions(ctx), 0);
  platform.now.ms += 6 * 24 * 3600 * 1000;
  await runPurge(ctx);
  assert.equal((await listSessions(ctx)).length, 1, "résumé conservé avant 7 jours");
  platform.now.ms += 2 * 24 * 3600 * 1000;
  await runPurge(ctx);
  assert.equal((await listSessions(ctx)).length, 0, "résumé supprimé après 7 jours");
});

test("échéance J+3 : brouillon expiré et données purgées ; session non confirmable garde son corps figé", async () => {
  const platform = createTestPlatform({ dir: tmpDir("expire") });
  const manager = createRollCallAccountManager(platform);
  const { ctx } = await activate(manager, identity());
  const draft = await draftWithScans(ctx, 2);
  const { session: other } = await openDraftSession(ctx, { classId: "99999999-9999-4999-8999-999999999999", date: DATE, packId: null, syncDeadline: "2026-11-12T23:00:00Z" });
  await recordScan(ctx, { sessionId: other.session_id, scanId: crypto.randomUUID(), publicId: publicId(), proof: proof(), medium: "nfc", scannedAt: "2026-11-09T07:31:00Z", match: null });
  const frozen = await closeSession(ctx, other.session_id);
  const attempt = await beginSyncAttempt(ctx, other.session_id);
  await recordSyncOutcome(ctx, other.session_id, attempt.operationId, { kind: "http", httpStatus: 403 });
  platform.now.ms = Date.parse("2026-11-12T22:59:59Z");
  await runPurge(ctx);
  assert.equal((await getSession(ctx, draft.session_id)).state, "draft", "jamais purgé avant l'échéance");
  platform.now.ms = Date.parse("2026-11-12T23:00:00Z");
  const report = await runPurge(ctx);
  assert.equal(report.expired, 2);
  const expiredDraft = await getSession(ctx, draft.session_id);
  assert.equal(expiredDraft.state, "expired");
  const proofs = await ctx.connection.read((db) => db.getAllAsync<{ proof: string | null }>("SELECT proof FROM rc_scans WHERE session_id = ?", [draft.session_id]));
  assert.ok(proofs.every((row) => row.proof === null));
  const expiredUnconfirmable = await getSession(ctx, other.session_id);
  assert.equal(expiredUnconfirmable.state, "expired");
  assert.equal(expiredUnconfirmable.frozen_body, frozen.frozenBody, "corps figé conservé pour un renvoi identique");
  platform.now.ms += 8 * 24 * 3600 * 1000;
  await runPurge(ctx);
  const remaining = (await listSessions(ctx)).map((row) => row.session_id);
  assert.deepEqual(remaining, [other.session_id], "seule la session non confirmable reste, jusqu'à la purge de la base");
});

// ---------------------------------------------------------------------------------------------
// Résilience
// ---------------------------------------------------------------------------------------------

test("disque plein (SQLITE_FULL réel) : scan refusé, aucune confirmation, compteurs inchangés", async () => {
  const manager = createRollCallAccountManager(createTestPlatform({ dir: tmpDir("full") }));
  const { ctx } = await activate(manager, identity());
  const { session } = await openDraftSession(ctx, { classId: CLASS, date: DATE, packId: null, syncDeadline: null });
  const pages = await ctx.connection.read((db) => db.getFirstAsync<{ page_count: number }>("PRAGMA page_count"));
  await ctx.connection.read((db) => db.execAsync(`PRAGMA max_page_count = ${Number(pages?.page_count) + 1}`));
  let recorded = 0;
  let failure: { code?: string } | null = null;
  for (let i = 0; i < 300 && !failure; i += 1) {
    const before = await readCounts(ctx, session.session_id);
    try {
      await recordScan(ctx, { sessionId: session.session_id, scanId: crypto.randomUUID(), publicId: publicId(), proof: proof(), medium: "nfc", scannedAt: "2026-11-09T07:31:00Z", match: { matchKey: `MK-${i}-${"x".repeat(200)}`, studentId: crypto.randomUUID() } });
      recorded += 1;
    } catch (error) {
      failure = error as { code?: string };
      assert.deepEqual(await readCounts(ctx, session.session_id), before, "aucun compteur modifié");
    }
  }
  assert.ok(failure, "SQLITE_FULL atteint");
  assert.equal(failure?.code, "RC_STORAGE_FULL");
  assert.equal((await readCounts(ctx, session.session_id)).scans, recorded);
  const check = await ctx.connection.read((db) => db.getFirstAsync<{ quick_check: string }>("PRAGMA quick_check"));
  assert.equal(check?.quick_check, "ok");
});

test("base corrompue ou clé perdue : quarantaine sans écrasement, échec visible, suppression après 7 jours", async () => {
  const dir = tmpDir("corrupt");
  const platform = createTestPlatform({ dir });
  const manager = createRollCallAccountManager(platform);
  const account = await activate(manager, identity());
  await draftWithScans(account.ctx, 3);
  await manager.close();
  const file = path.join(dir, account.fileName);
  const bytes = fs.readFileSync(file);
  bytes.fill(0x5a, 0, 100);
  fs.writeFileSync(file, bytes);
  const corrupted = await manager.activate(identity());
  assert.equal((corrupted as { code: string }).code, "RC_DATABASE_UNREADABLE");
  assert.equal(await manager.pendingQuarantines(), 1);
  const fresh = await activate(manager, identity());
  assert.deepEqual(await listSessions(fresh.ctx), [], "aucun appel prétendu synchronisé ni recréé");
  await draftWithScans(fresh.ctx, 1);
  await manager.close();

  // Clé perdue (SecureStore effacé) : quarantaine aussi (cas reporté de test-rollcall-secure-manager.mjs).
  await platform.keyStore.deleteItem(fresh.keyName);
  const lostKey = await manager.activate(identity());
  assert.equal((lostKey as { code: string }).code, "RC_DATABASE_KEY_LOST");
  assert.equal(fs.existsSync(path.join(dir, fresh.fileName)), false, "jamais de base recréée par-dessus");
  assert.equal(fs.readdirSync(dir).filter((name) => /\.quarantine-\d+$/.test(name)).length, 2);
  assert.ok(await manager.activate(identity()).then((r) => r.ok), "base neuve à l'ouverture suivante");

  platform.now.ms += 7 * 24 * 3600 * 1000 + 1;
  const report = await manager.runStartupMaintenance();
  assert.equal(report.deletedQuarantines, 2);
  assert.equal(fs.readdirSync(dir).filter((name) => name.includes("quarantine")).length, 0);
  assert.equal(Object.keys(platform.keyStore.dump()).filter((name) => name.includes("quarantine")).length, 0, "clés de quarantaine effacées");
  assert.equal(await manager.pendingQuarantines(), 0);
});
test("base d'un autre compte déposée sous le nom du fichier : refusée et mise en quarantaine", async () => {
  const dir = tmpDir("swap");
  const platform = createTestPlatform({ dir });
  const manager = createRollCallAccountManager(platform);
  const a = await activate(manager, identity());
  await draftWithScans(a.ctx, 1);
  const b = await activate(manager, identity(USER_2));
  await manager.close();
  // Le fichier (et sa clé) du compte 1 sont recopiés à la place de ceux du compte 2.
  fs.copyFileSync(path.join(dir, a.fileName), path.join(dir, b.fileName));
  fs.copyFileSync(path.join(dir, `${a.fileName}.simkey`), path.join(dir, `${b.fileName}.simkey`));
  await platform.keyStore.setItem(b.keyName, platform.keyStore.dump()[a.keyName]);
  const refused = await manager.activate(identity(USER_2));
  assert.equal((refused as { code: string }).code, "RC_DATABASE_UNREADABLE");
  const reopened = await activate(manager, identity(USER_2));
  assert.deepEqual(await listSessions(reopened.ctx), []);
});

test("incidents fail-closed publiés (reportés de test-rollcall-secure-manager.mjs) : fichier perdu, sel perdu, clé invalide, ouverture initiale échouée", async () => {
  const dir = tmpDir("incidents");
  const platform = createTestPlatform({ dir });
  const manager = createRollCallAccountManager(platform);
  const account = await activate(manager, identity());
  // Même compte : même connexion ; changement de compte : nouvelle connexion, puis réouverture.
  assert.equal((await activate(manager, identity())).ctx.connection, account.ctx.connection);
  await activate(manager, identity(USER_2));
  const again = await activate(manager, identity());
  assert.equal(again.fileName, account.fileName);
  assert.notEqual(again.ctx.connection, account.ctx.connection);
  await manager.close();

  // Clé présente, fichier disparu : RC_DATABASE_FILE_LOST, clé conservée, aucune base vide recréée.
  const key = await platform.keyStore.getItem(account.keyName);
  fs.rmSync(path.join(dir, account.fileName));
  const lost = await manager.activate(identity());
  assert.equal((lost as { code: string }).code, "RC_DATABASE_FILE_LOST");
  assert.equal(await platform.keyStore.getItem(account.keyName), key, "clé conservée pour l'incident");
  assert.equal(fs.existsSync(path.join(dir, account.fileName)), false);
  // Levée du blocage par la purge à échéance du registre (clé effacée), puis ouverture normale.
  platform.now.ms += 8 * 24 * 3600 * 1000;
  await manager.runStartupMaintenance();
  assert.equal(await platform.keyStore.getItem(account.keyName), null);
  assert.ok((await manager.activate(identity())).ok);
  await manager.close();

  // Clé mal formée : jamais réinterprétée comme phrase de passe.
  await platform.keyStore.setItem(account.keyName, "pas-une-cle");
  assert.equal(((await manager.activate(identity())) as { code: string }).code, "RC_DATABASE_KEY_INVALID");

  // Sel d'appareil perdu alors que des bases existent : aucun nouveau sel.
  await platform.keyStore.deleteItem("somafrik.rollCallDeviceSaltV1");
  const salt = await manager.activate(identity(USER_2));
  assert.equal((salt as { code: string }).code, "RC_ACCOUNT_SALT_LOST");
  assert.equal(await platform.keyStore.getItem("somafrik.rollCallDeviceSaltV1"), null, "pas de régénération silencieuse");

  // Ouverture initiale échouée : ni clé orpheline ni fichier.
  const failingDir = tmpDir("initial-fail");
  const failing = createTestPlatform({ dir: failingDir });
  const before = Object.keys(failing.keyStore.dump());
  const broken = { ...failing, openDatabase: async () => { throw new Error("SIMULATED_OPEN_FAILURE"); } };
  await assert.rejects(openRollCallAccountDatabase(broken, identity()), /RC_STORAGE_FAILED/);
  assert.deepEqual(Object.keys(failing.keyStore.dump()).filter((name) => !before.includes(name)), ["somafrik.rollCallDeviceSaltV1"], "seul le sel reste");
  assert.equal(fs.readdirSync(failingDir).filter((name) => name.endsWith(".db")).length, 0);
});
// ---------------------------------------------------------------------------------------------
// Déconnexion et purge
// ---------------------------------------------------------------------------------------------

test("déconnexion sans appel en attente : crypto-effacement vérifié, clé AVANT fichier", async () => {
  const dir = tmpDir("erase");
  const platform = createTestPlatform({ dir });
  const order: string[] = [];
  const traced = {
    ...platform,
    keyStore: { ...platform.keyStore, deleteItem: async (key: string) => { order.push(`key:${key.startsWith("somafrik.rollCallDbKeyV1") ? "db" : key}`); await platform.keyStore.deleteItem(key); } },
    fs: { ...platform.fs, deleteFile: async (name: string) => { if (name.endsWith(".db")) order.push("file:db"); await platform.fs.deleteFile(name); } },
  };
  const manager = createRollCallAccountManager(traced);
  const account = await activate(manager, identity());
  assert.deepEqual(await manager.logout({ confirmPending: false }), { status: "erased" });
  assert.deepEqual(order, ["key:db", "file:db"], "clé supprimée avant le fichier");
  assert.equal(await platform.keyStore.getItem(account.keyName), null);
  assert.equal(fs.existsSync(path.join(dir, account.fileName)), false);
  assert.equal(parseRegistry(fs.readFileSync(path.join(dir, RC_REGISTRY_FILE), "utf8")).accounts.length, 0);
  assert.equal(manager.current(), null);
  await assert.rejects(account.ctx.connection.read(async () => 1), /RC_STORAGE_CLOSED/, "connexion réellement fermée");
});
test("déconnexion avec brouillon : confirmation exigée, base fermée en blocked_logout, reprise par le même compte", async () => {
  const dir = tmpDir("logout");
  const platform = createTestPlatform({ dir });
  const manager = createRollCallAccountManager(platform);
  const account = await activate(manager, identity());
  const draft = await draftWithScans(account.ctx, 2);
  const closedOne = await draftWithScans((await activate(manager, identity())).ctx, 0).catch(() => null);
  assert.equal(closedOne?.session_id, draft.session_id);
  assert.deepEqual(await manager.logout({ confirmPending: false }), { status: "confirmation_required", pending: 1 });
  assert.ok(manager.current(), "rien n'est fermé sans confirmation");
  assert.deepEqual(await manager.logout({ confirmPending: true }), { status: "blocked_logout", pending: 1 });
  assert.equal(manager.current(), null);
  assert.ok(fs.existsSync(path.join(dir, account.fileName)), "fichier conservé");
  assert.ok(await platform.keyStore.getItem(account.keyName), "clé conservée pour le même compte");
  const registry = parseRegistry(fs.readFileSync(path.join(dir, RC_REGISTRY_FILE), "utf8"));
  assert.equal(registry.accounts[0].state, "blocked_logout");
  assert.equal(registry.accounts[0].purgeAtMs, Date.parse("2026-11-12T23:00:00Z") + 7 * 24 * 3600 * 1000);
  const raw = rawOpen(dir, account.fileName);
  assert.equal((raw.prepare("SELECT state, state_before_logout FROM rc_sessions").get() as { state: string }).state, "blocked_logout");
  raw.close();

  // Un autre utilisateur ne voit rien et n'ouvre pas cette base.
  const other = await activate(manager, identity(USER_2));
  assert.deepEqual(await listSessions(other.ctx), []);
  assert.notEqual(other.fileName, account.fileName);
  // Reconnexion du même compte : états restaurés.
  const back = await activate(manager, identity());
  const [restored] = await listSessions(back.ctx);
  assert.equal(restored.state, "draft");
  assert.equal(restored.state_before_logout, null);
  assert.equal((await readCounts(back.ctx, draft.session_id)).scans, 2);
});

test("compte qui ne revient jamais : purge à l'échéance au démarrage, sans ouvrir sa base", async () => {
  const dir = tmpDir("absent");
  const platform = createTestPlatform({ dir });
  const manager = createRollCallAccountManager(platform);
  const absent = await activate(manager, identity());
  await draftWithScans(absent.ctx, 1);
  await manager.logout({ confirmPending: true });
  await activate(manager, identity(USER_2));
  platform.now.ms = Date.parse("2026-11-19T22:59:59Z");
  assert.equal((await manager.runStartupMaintenance()).erasedAccounts, 0, "pas avant l'échéance");
  platform.now.ms = Date.parse("2026-11-19T23:00:00Z");
  await manager.refreshPurgeDeadline(); // le compte connecté (USER_2) repousse sa propre échéance
  const sqlLog: string[] = [];
  const watched = createRollCallAccountManager(createTestPlatform({ dir, sqlLog, now: platform.now }));
  const report = await watched.runStartupMaintenance();
  assert.equal(report.erasedAccounts, 1);
  assert.equal(sqlLog.length, 0, "aucune base ouverte pour purger");
  assert.equal(fs.existsSync(path.join(dir, absent.fileName)), false);
  assert.equal(await platform.keyStore.getItem(absent.keyName), null);
  // Le compte connecté (USER_2) n'est pas effacé : son échéance n'est pas atteinte.
  assert.equal(parseRegistry(fs.readFileSync(path.join(dir, RC_REGISTRY_FILE), "utf8")).accounts.length, 1);
});

test("registre perdu : bases orphelines réinscrites avec une échéance de 7 jours, jamais effacées sur-le-champ", async () => {
  const dir = tmpDir("orphan");
  const platform = createTestPlatform({ dir });
  const manager = createRollCallAccountManager(platform);
  const account = await activate(manager, identity());
  await manager.close();
  fs.rmSync(path.join(dir, RC_REGISTRY_FILE));
  const fresh = createRollCallAccountManager(platform);
  assert.equal((await fresh.runStartupMaintenance()).registeredOrphans, 1);
  assert.ok(fs.existsSync(path.join(dir, account.fileName)));
  platform.now.ms += 7 * 24 * 3600 * 1000;
  assert.equal((await fresh.runStartupMaintenance()).erasedAccounts, 1);
  assert.equal(fs.existsSync(path.join(dir, account.fileName)), false);
});

// ---------------------------------------------------------------------------------------------
// Packs stockés
// ---------------------------------------------------------------------------------------------

test("pack : texte original stocké sans modification, immuable, re-vérifié et supprimé après révocation", async () => {
  const platform = createTestPlatform({ dir: tmpDir("packs"), now: { ms: Date.parse("2026-11-08T17:00:00Z") } });
  const manager = createRollCallAccountManager(platform);
  const { ctx } = await activate(manager, identity());
  const keys = ["rc-pack-production-1", "rc-pack-production-2"].map((keyId) => {
    const pair = crypto.generateKeyPairSync("ed25519");
    return { keyId, publicKey: pair.publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64url"), private: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url") };
  });
  const signer = (active: (typeof keys)[number], other: (typeof keys)[number], status: string, sequence: number) =>
    createPackSigner({
      ROLL_CALL_PACK_SIGNING_KEY: active.private,
      ROLL_CALL_PACK_KEYRING: JSON.stringify({ revocationSequence: sequence, keys: [{ keyId: active.keyId, publicKey: active.publicKey, status: "active" }, { keyId: other.keyId, publicKey: other.publicKey, status }] }),
    });
  const keyring = validatePackKeyring("production", keys.map((key, index) => ({ keyId: key.keyId, publicKey: key.publicKey, status: index ? "standby" : "active" })));
  const window = computePackWindow("Africa/Kinshasa", DATE);
  const issue = (s: ReturnType<typeof signer>, packId: string) => {
    const pack = buildPack({ packId, keyId: s.keyId, schoolId: SCHOOL_A, actorUserId: USER_1, classId: CLASS, date: DATE, timeZone: "Africa/Kinshasa", window, nowMs: Date.parse("2026-11-08T16:02:00Z"), students: [], cards: [], matchSecret: Buffer.alloc(32, 3) });
    // Indentation volontaire : le texte reçu est stocké tel quel, octet pour octet.
    return JSON.stringify({ pack, signature: s.signPack(pack), revocations: s.signedRevocations(pack.issuedAt) }, null, 1);
  };
  const expected = { schoolId: SCHOOL_A, actorUserId: USER_1, classId: CLASS, date: DATE };
  const text = issue(signer(keys[0], keys[1], "standby", 0), "44444444-4444-4444-8444-444444444444");
  const accepted = await acceptDownloadedPack(ctx, { keyring, envelopeText: text, expected, httpDateHeader: "Sun, 08 Nov 2026 17:00:00 GMT" });
  assert.ok(accepted.ok, JSON.stringify(accepted));
  assert.equal(await readStoredPackText(ctx, "44444444-4444-4444-8444-444444444444"), text);
  await assert.rejects(ctx.connection.transaction((db) => db.runAsync("UPDATE rc_packs SET signed_payload = '{}'")), /RC_PACK_IMMUTABLE/);
  platform.now.ms = Date.parse("2026-11-09T08:00:00Z");
  assert.ok((await loadUsablePack(ctx, { keyring, packId: "44444444-4444-4444-8444-444444444444", expected })).ok);

  // Rotation d'urgence reçue avec un nouveau pack : la clé 1 est révoquée.
  const rotated = issue(signer(keys[1], keys[0], "revoked", 1), "88888888-8888-4888-8888-888888888888");
  assert.ok((await acceptDownloadedPack(ctx, { keyring, envelopeText: rotated, expected, httpDateHeader: "Mon, 09 Nov 2026 08:00:00 GMT" })).ok);
  assert.deepEqual(await loadRevocationState(ctx), { sequence: 1, revokedKeyIds: ["rc-pack-production-1"] });
  const reload = await loadUsablePack(ctx, { keyring, packId: "44444444-4444-4444-8444-444444444444", expected });
  assert.deepEqual(reload, { ok: false, code: "RC_PACK_KEY_REVOKED" });
  assert.equal(await readStoredPackText(ctx, "44444444-4444-4444-8444-444444444444"), null, "pack refusé supprimé");
  // Liste plus ancienne rejouée : refus, la révocation reste.
  const replay = await acceptDownloadedPack(ctx, { keyring, envelopeText: issue(signer(keys[1], keys[0], "standby", 0), "99999999-9999-4999-8999-999999999999"), expected });
  assert.deepEqual(replay, { ok: false, code: "RC_PACK_REVOCATIONS_INVALID" });
  assert.deepEqual(await loadRevocationState(ctx), { sequence: 1, revokedKeyIds: ["rc-pack-production-1"] });

  // Horloge de l'appareil reculée de plus de 10 minutes sous le dernier instant de confiance.
  platform.now.ms = Date.parse("2026-11-08T23:30:00Z");
  const behind = await loadUsablePack(ctx, { keyring, packId: "88888888-8888-4888-8888-888888888888", expected });
  assert.deepEqual(behind, { ok: false, code: "RC_PACK_DEVICE_CLOCK_BEHIND" });
});
