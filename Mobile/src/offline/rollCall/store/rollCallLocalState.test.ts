/**
 * NFC-PRES-LOCAL-PR2 — état local de sécurité (révocations, horloge de confiance) : fail-closed.
 *   NODE_OPTIONS=--experimental-sqlite npx --yes tsx --test src/offline/rollCall/store/rollCallLocalState.test.ts
 *
 * Revue CTO du 2026-11-08 (HEAD b2a3a3ef) : une valeur stockée illisible ne doit JAMAIS être
 * remplacée par un état vide (qui réautoriserait une clé révoquée ou désactiverait la protection
 * contre le recul d'horloge). Absente ou mal formée → refus explicite, aucune écriture.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RC_INITIAL_PACK_REVOCATIONS,
  RC_LOCAL_STATE_ERROR,
  createRollCallAccountManager,
  loadLastTrustedTime,
  loadRevocationState,
  recordTrustedTime,
  saveRevocationState,
  type RcActiveAccount,
} from "./accountManager";
import { createTestPlatform } from "./rcTestPlatform.testutil";
import { readStoredPackText, type RcContext } from "./repository";
import { acceptDownloadedPack, loadUsablePack } from "../pack/packService";
import { validatePackKeyring } from "../pack/keyring";
import { parseRevocationState } from "../pack/revocations";

const ROOT = path.resolve(__dirname, "../../../../..");
/* eslint-disable @typescript-eslint/no-require-imports */
const { createPackSigner } = require(path.join(ROOT, "backend/lib/rollCallOfflinePackSigner.js"));
const { buildPack, computePackWindow } = require(path.join(ROOT, "backend/lib/rollCallOfflinePack.js"));
/* eslint-enable @typescript-eslint/no-require-imports */

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const TEACHER = "22222222-2222-4222-8222-222222222222";
const CLASS = "33333333-3333-4333-8333-333333333333";
const DATE = "2026-11-09";
const IDENTITY = { environmentId: "production-3f2a9c1d", userId: TEACHER, schoolId: SCHOOL };
const EXPECTED = { schoolId: SCHOOL, actorUserId: TEACHER, classId: CLASS, date: DATE };
const PACK_A = "44444444-4444-4444-8444-444444444444";
const PACK_B = "88888888-8888-4888-8888-888888888888";

const keys = ["rc-pack-production-1", "rc-pack-production-2"].map((keyId) => {
  const pair = crypto.generateKeyPairSync("ed25519");
  return {
    keyId,
    publicKey: pair.publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64url"),
    privateKey: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
  };
});
const keyring = validatePackKeyring("production", [
  { keyId: keys[0].keyId, publicKey: keys[0].publicKey, status: "active" },
  { keyId: keys[1].keyId, publicKey: keys[1].publicKey, status: "standby" },
]);

function envelope(activeIndex: number, otherStatus: string, sequence: number, packId: string): string {
  const active = keys[activeIndex];
  const other = keys[1 - activeIndex];
  const signer = createPackSigner({
    ROLL_CALL_PACK_SIGNING_KEY: active.privateKey,
    ROLL_CALL_PACK_KEYRING: JSON.stringify({
      revocationSequence: sequence,
      keys: [
        { keyId: active.keyId, publicKey: active.publicKey, status: "active" },
        { keyId: other.keyId, publicKey: other.publicKey, status: otherStatus },
      ],
    }),
  });
  const pack = buildPack({
    packId,
    keyId: signer.keyId,
    schoolId: SCHOOL,
    actorUserId: TEACHER,
    classId: CLASS,
    date: DATE,
    timeZone: "Africa/Kinshasa",
    window: computePackWindow("Africa/Kinshasa", DATE),
    nowMs: Date.parse("2026-11-08T16:02:00Z"),
    students: [],
    cards: [],
    matchSecret: Buffer.alloc(32, 5),
  });
  return JSON.stringify({ pack, signature: signer.signPack(pack), revocations: signer.signedRevocations(pack.issuedAt) });
}

async function setup(label: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rc-state-${label}-`));
  const platform = createTestPlatform({ dir, now: { ms: Date.parse("2026-11-08T17:00:00Z") } });
  const manager = createRollCallAccountManager(platform);
  const opened = await manager.activate(IDENTITY);
  assert.ok(opened.ok, JSON.stringify(opened));
  const { ctx } = (opened as { account: RcActiveAccount }).account;
  return { platform, ctx };
}

/** Pack A signé par la clé 1, puis rotation d'urgence : clé 1 révoquée (séquence 1). */
async function withRevokedKey(ctx: RcContext, platform: { now: { ms: number } }) {
  assert.ok((await acceptDownloadedPack(ctx, { keyring, envelopeText: envelope(0, "standby", 0, PACK_A), expected: EXPECTED, httpDateHeader: "Sun, 08 Nov 2026 17:00:00 GMT" })).ok);
  assert.ok((await acceptDownloadedPack(ctx, { keyring, envelopeText: envelope(1, "revoked", 1, PACK_B), expected: EXPECTED })).ok);
  assert.deepEqual(await loadRevocationState(ctx), { sequence: 1, revokedKeyIds: ["rc-pack-production-1"] });
  platform.now.ms = Date.parse("2026-11-09T08:00:00Z");
}

/** Corruption hors moteur (stockage altéré) : les gardes SQL sont retirées le temps de l'écriture. */
async function corruptMeta(ctx: RcContext, key: string, value: string | null) {
  await ctx.connection.transaction(async (db) => {
    await db.execAsync("DROP TRIGGER IF EXISTS rc_meta_protected_delete");
    await db.execAsync("DROP TRIGGER IF EXISTS rc_meta_trusted_time_monotone");
    await db.execAsync("DROP TRIGGER IF EXISTS rc_meta_revocations_monotone");
    if (value === null) await db.runAsync("DELETE FROM rc_meta WHERE key = ?", [key]);
    else await db.runAsync("UPDATE rc_meta SET value = ? WHERE key = ?", [value, key]);
  });
}

async function rawMeta(ctx: RcContext, key: string): Promise<string | null> {
  const row = await ctx.connection.read((db) => db.getFirstAsync<{ value: string }>("SELECT value FROM rc_meta WHERE key = ?", [key]));
  return row ? String(row.value) : null;
}

test("base neuve : valeurs initiales écrites à la création (jamais « absentes »)", async () => {
  const { ctx } = await setup("initial");
  assert.equal(await rawMeta(ctx, "pack_revocations"), RC_INITIAL_PACK_REVOCATIONS);
  assert.equal(await rawMeta(ctx, "last_trusted_time_ms"), "0");
  assert.deepEqual(await loadRevocationState(ctx), { sequence: 0, revokedKeyIds: [] });
  assert.equal(await loadLastTrustedTime(ctx), null);
});

const CORRUPT_REVOCATIONS: Array<[string, string | null]> = [
  ["JSON invalide", "{pas du json"],
  ["tableau au lieu d'objet", "[]"],
  ["revokedKeyIds absent", '{"sequence":1}'],
  ["revokedKeyIds non tableau", '{"sequence":1,"revokedKeyIds":"rc-pack-production-1"}'],
  ["identifiant invalide", '{"sequence":1,"revokedKeyIds":["BAD ID"]}'],
  ["identifiant non chaîne", '{"sequence":1,"revokedKeyIds":[7]}'],
  ["identifiants non triés", '{"sequence":1,"revokedKeyIds":["rc-pack-production-2","rc-pack-production-1"]}'],
  ["identifiants en double", '{"sequence":1,"revokedKeyIds":["rc-pack-production-1","rc-pack-production-1"]}'],
  ["séquence négative", '{"sequence":-1,"revokedKeyIds":[]}'],
  ["séquence flottante", '{"sequence":1.5,"revokedKeyIds":[]}'],
  ["séquence texte", '{"sequence":"1","revokedKeyIds":[]}'],
  ["révocation avec séquence 0", '{"sequence":0,"revokedKeyIds":["rc-pack-production-1"]}'],
  ["champ inattendu", '{"sequence":1,"revokedKeyIds":[],"extra":1}'],
  ["état vidé (réinitialisation)", ""],
  ["ligne supprimée", null],
];

for (const [label, value] of CORRUPT_REVOCATIONS) {
  test(`révocations corrompues (${label}) : refus explicite, aucun état vide, aucune écriture`, async () => {
    const { platform, ctx } = await setup(`rev-${CORRUPT_REVOCATIONS.findIndex(([l]) => l === label)}`);
    await withRevokedKey(ctx, platform);
    await corruptMeta(ctx, "pack_revocations", value);
    const before = await rawMeta(ctx, "pack_revocations");
    await assert.rejects(loadRevocationState(ctx), (error: { code?: string }) => error.code === RC_LOCAL_STATE_ERROR.REVOCATIONS_CORRUPT);
    // Le pack signé par la clé révoquée n'est jamais réautorisé, ni au chargement ni au téléchargement.
    assert.deepEqual(await loadUsablePack(ctx, { keyring, packId: PACK_A, expected: EXPECTED }), { ok: false, code: "RC_PACK_REVOCATIONS_STATE_CORRUPT" });
    assert.deepEqual(await loadUsablePack(ctx, { keyring, packId: PACK_B, expected: EXPECTED }), { ok: false, code: "RC_PACK_REVOCATIONS_STATE_CORRUPT" });
    assert.deepEqual(
      await acceptDownloadedPack(ctx, { keyring, envelopeText: envelope(0, "standby", 0, "99999999-9999-4999-8999-999999999999"), expected: EXPECTED }),
      { ok: false, code: "RC_PACK_REVOCATIONS_STATE_CORRUPT" },
    );
    await assert.rejects(saveRevocationState(ctx, { sequence: 0, revokedKeyIds: [] }), (error: { code?: string }) => error.code === RC_LOCAL_STATE_ERROR.REVOCATIONS_CORRUPT);
    assert.equal(await rawMeta(ctx, "pack_revocations"), before, "état corrompu jamais écrasé par un état vide");
    assert.notEqual(await readStoredPackText(ctx, PACK_B), null, "pack non supprimé : seul l'état local est en cause");
    assert.equal(await readStoredPackText(ctx, "99999999-9999-4999-8999-999999999999"), null, "aucun nouveau pack stocké");
  });
}

const CORRUPT_TRUSTED_TIME: Array<[string, string | null]> = [
  ["texte", "abc"],
  ["négative", "-5"],
  ["décimale", "1.5"],
  ["vide", ""],
  ["zéro de tête", "01"],
  ["trop grande", "99999999999999999"],
  ["notation exponentielle", "1e12"],
  ["ligne supprimée", null],
];

for (const [label, value] of CORRUPT_TRUSTED_TIME) {
  test(`horloge de confiance corrompue (${label}) : refus explicite, protection anti-recul jamais désactivée`, async () => {
    const { platform, ctx } = await setup(`clock-${CORRUPT_TRUSTED_TIME.findIndex(([l]) => l === label)}`);
    await withRevokedKey(ctx, platform);
    await corruptMeta(ctx, "last_trusted_time_ms", value);
    const before = await rawMeta(ctx, "last_trusted_time_ms");
    // Horloge appareil fortement reculée : sans état fiable, rien ne doit passer.
    platform.now.ms = Date.parse("2026-11-08T23:30:00Z");
    await assert.rejects(loadLastTrustedTime(ctx), (error: { code?: string }) => error.code === RC_LOCAL_STATE_ERROR.TRUSTED_TIME_CORRUPT);
    assert.deepEqual(await loadUsablePack(ctx, { keyring, packId: PACK_B, expected: EXPECTED }), { ok: false, code: "RC_TRUSTED_TIME_STATE_CORRUPT" });
    assert.deepEqual(
      await acceptDownloadedPack(ctx, { keyring, envelopeText: envelope(1, "revoked", 1, "99999999-9999-4999-8999-999999999999"), expected: EXPECTED, httpDateHeader: "Mon, 09 Nov 2026 09:00:00 GMT" }),
      { ok: false, code: "RC_TRUSTED_TIME_STATE_CORRUPT" },
    );
    await assert.rejects(recordTrustedTime(ctx, Date.parse("2026-11-09T09:00:00Z")), (error: { code?: string }) => error.code === RC_LOCAL_STATE_ERROR.TRUSTED_TIME_CORRUPT);
    assert.equal(await rawMeta(ctx, "last_trusted_time_ms"), before, "valeur corrompue jamais remplacée");
    assert.notEqual(await readStoredPackText(ctx, PACK_B), null);
  });
}

test("moteur SQLite : suppression, recul de séquence, retrait d'une clé révoquée et recul d'horloge refusés", async () => {
  const { platform, ctx } = await setup("guards");
  await withRevokedKey(ctx, platform);
  const trusted = await rawMeta(ctx, "last_trusted_time_ms");
  const refusedSql: Array<[string, unknown[]]> = [
    ["DELETE FROM rc_meta WHERE key = 'pack_revocations'", []],
    ["DELETE FROM rc_meta WHERE key = 'last_trusted_time_ms'", []],
    ["DELETE FROM rc_meta WHERE key = 'account_id'", []],
    ["UPDATE rc_meta SET value = ? WHERE key = 'pack_revocations'", ['{"sequence":0,"revokedKeyIds":[]}']],
    ["UPDATE rc_meta SET value = ? WHERE key = 'pack_revocations'", ['{"sequence":2,"revokedKeyIds":[]}']],
    ["UPDATE rc_meta SET value = ? WHERE key = 'pack_revocations'", ["{pas du json"]],
    ["UPDATE rc_meta SET value = ? WHERE key = 'pack_revocations'", ['{"sequence":"9","revokedKeyIds":["rc-pack-production-1"]}']],
    ["UPDATE rc_meta SET value = ? WHERE key = 'last_trusted_time_ms'", [String(Number(trusted) - 1)]],
    ["UPDATE rc_meta SET value = ? WHERE key = 'last_trusted_time_ms'", ["abc"]],
    ["UPDATE rc_meta SET value = ? WHERE key = 'last_trusted_time_ms'", [""]],
    ["UPDATE rc_meta SET value = ? WHERE key = 'account_id'", ["AAAAAAAAAAAAAAAAAAAAAAA"]],
    ["UPDATE rc_meta SET key = 'old_revocations' WHERE key = 'pack_revocations'", []],
  ];
  for (const [sql, params] of refusedSql) {
    await assert.rejects(ctx.connection.transaction((db) => db.runAsync(sql, params)), /RC_/, `${sql} ${JSON.stringify(params)}`);
  }
  assert.deepEqual(await loadRevocationState(ctx), { sequence: 1, revokedKeyIds: ["rc-pack-production-1"] });
  assert.equal(await rawMeta(ctx, "last_trusted_time_ms"), trusted);
  // Mises à jour monotones légitimes : acceptées.
  await ctx.connection.transaction((db) =>
    db.runAsync("UPDATE rc_meta SET value = ? WHERE key = 'pack_revocations'", ['{"sequence":2,"revokedKeyIds":["rc-pack-production-1","rc-pack-production-7"]}']),
  );
  await ctx.connection.transaction((db) => db.runAsync("UPDATE rc_meta SET value = ? WHERE key = 'last_trusted_time_ms'", [String(Number(trusted) + 1)]));
  assert.deepEqual(await loadRevocationState(ctx), { sequence: 2, revokedKeyIds: ["rc-pack-production-1", "rc-pack-production-7"] });
});

test("cohérence après échec du COMMIT : ni révocation ni horloge à moitié écrites", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-state-commit-"));
  const base = createTestPlatform({ dir, now: { ms: Date.parse("2026-11-08T17:00:00Z") } });
  let failCommit = false;
  const flaky = {
    ...base,
    openDatabase: async (name: string, options?: { useNewConnection?: boolean }) => {
      const db = await base.openDatabase(name, options);
      return {
        ...db,
        async execAsync(sql: string) {
          if (failCommit && /^\s*COMMIT\s*$/i.test(sql)) {
            failCommit = false;
            throw new Error("SQLITE_IOERR: disk I/O error");
          }
          return db.execAsync(sql);
        },
      };
    },
  };
  const manager = createRollCallAccountManager(flaky);
  const opened = await manager.activate(IDENTITY);
  const { ctx } = (opened as { account: RcActiveAccount }).account;
  await withRevokedKey(ctx, base);
  const revocations = await rawMeta(ctx, "pack_revocations");
  const trusted = await rawMeta(ctx, "last_trusted_time_ms");
  failCommit = true;
  await assert.rejects(saveRevocationState(ctx, { sequence: 5, revokedKeyIds: ["rc-pack-production-1", "rc-pack-production-9"] }), /RC_STORAGE_IO/);
  assert.equal(await rawMeta(ctx, "pack_revocations"), revocations);
  failCommit = true;
  await assert.rejects(recordTrustedTime(ctx, Date.parse("2026-11-20T00:00:00Z")), /RC_STORAGE_IO/);
  assert.equal(await rawMeta(ctx, "last_trusted_time_ms"), trusted);
  // L'état reste lisible et monotone ; l'opération suivante réussit normalement.
  assert.deepEqual(await saveRevocationState(ctx, { sequence: 5, revokedKeyIds: ["rc-pack-production-9"] }), {
    sequence: 5,
    revokedKeyIds: ["rc-pack-production-1", "rc-pack-production-9"],
  });
});

test("validation stricte de l'état calculé avant écriture", async () => {
  const { ctx } = await setup("incoming");
  for (const bad of [
    { sequence: -1, revokedKeyIds: [] },
    { sequence: 0, revokedKeyIds: ["rc-pack-production-1"] },
    { sequence: 1, revokedKeyIds: ["nope"] },
  ]) {
    await assert.rejects(saveRevocationState(ctx, bad as never), (error: { code?: string }) => error.code === RC_LOCAL_STATE_ERROR.REVOCATIONS_CORRUPT);
  }
  assert.equal(parseRevocationState({ sequence: 1, revokedKeyIds: ["rc-pack-production-1"] })?.sequence, 1);
  assert.equal(parseRevocationState(null), null);
  assert.equal(await rawMeta(ctx, "pack_revocations"), RC_INITIAL_PACK_REVOCATIONS);
});
