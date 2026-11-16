/**
 * NFC-PRES-LOCAL-PR2 — vérification locale des packs signés, révocation monotone, horloge.
 *   npx --yes tsx --test src/offline/rollCall/pack/rollCallPack.test.ts
 *
 * Les packs sont signés ici par le CODE BACKEND (createPackSigner de PR1b, buildPack) avec des clés
 * Ed25519 générées pour le test : la vérification Mobile est éprouvée contre le vrai signataire.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import test from "node:test";
import { advanceTrustedTime, isDeviceClockBehind, parseHttpDate } from "./clock";
import { EMBEDDED_PACK_KEYRINGS, embeddedPackKeyring, validatePackKeyring, type PackKeyringEntry } from "./keyring";
import { EMPTY_REVOCATION_STATE, applyRevocations } from "./revocations";
import { PACK_ERROR, matchCardInPack, parsePackEnvelopeText, verifyDownloadedPack, verifyPackEnvelope, type PackCheckContext } from "./verifyPack";
import { deriveCardKeyFromSecret } from "../crypto/primitives";

const ROOT = path.resolve(__dirname, "../../../../..");
/* eslint-disable @typescript-eslint/no-require-imports */
const { createPackSigner } = require(path.join(ROOT, "backend/lib/rollCallOfflinePackSigner.js"));
const { buildPack, computePackWindow } = require(path.join(ROOT, "backend/lib/rollCallOfflinePack.js"));
/* eslint-enable @typescript-eslint/no-require-imports */

type KeyPair = { keyId: string; publicKey: string; privatePkcs8: string };
function keyPair(keyId: string): KeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    keyId,
    publicKey: publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64url"),
    privatePkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
  };
}

const ACTIVE = keyPair("rc-pack-production-1");
const STANDBY = keyPair("rc-pack-production-2");
const PREPROD = keyPair("rc-pack-preproduction-1");

function backendSigner(active: KeyPair, others: Array<{ key: KeyPair; status: string }>, sequence = 0) {
  return createPackSigner({
    ROLL_CALL_PACK_SIGNING_KEY: active.privatePkcs8,
    ROLL_CALL_PACK_KEYRING: JSON.stringify({
      revocationSequence: sequence,
      keys: [{ keyId: active.keyId, publicKey: active.publicKey, status: "active" }, ...others.map(({ key, status }) => ({ keyId: key.keyId, publicKey: key.publicKey, status }))],
    }),
  });
}

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const TEACHER = "22222222-2222-4222-8222-222222222222";
const CLASS = "33333333-3333-4333-8333-333333333333";
const DATE = "2026-11-09";
const SECRET = crypto.randomBytes(32).toString("base64url");
const PUBLIC_ID = "BBBBBBBBBBBBBBBBBBBBBB";
const window = computePackWindow("Africa/Kinshasa", DATE);
const issuedMs = Date.parse("2026-11-08T16:02:00Z");

function issue(signer = backendSigner(ACTIVE, [{ key: STANDBY, status: "standby" }]), overrides: Record<string, unknown> = {}) {
  const pack = buildPack({
    packId: "44444444-4444-4444-8444-444444444444",
    keyId: signer.keyId,
    schoolId: SCHOOL,
    actorUserId: TEACHER,
    classId: CLASS,
    date: DATE,
    timeZone: "Africa/Kinshasa",
    window,
    nowMs: issuedMs,
    students: [
      { studentId: "55555555-5555-4555-8555-555555555555", studentCode: "E-1", firstName: "Ngalula", lastName: "Kabasélé", existingStatus: null },
      { studentId: "66666666-6666-4666-8666-666666666666", studentCode: "E-2", firstName: "Test", lastName: "Deux", existingStatus: "excused" },
    ],
    cards: [{ studentId: "55555555-5555-4555-8555-555555555555", publicId: PUBLIC_ID, tokenHash: crypto.createHash("sha256").update(SECRET).digest("hex") }],
    matchSecret: Buffer.alloc(32, 9),
    ...overrides,
  });
  return { pack, signature: signer.signPack(pack), revocations: signer.signedRevocations(pack.issuedAt) };
}

const keyring = validatePackKeyring("production", [
  { keyId: ACTIVE.keyId, publicKey: ACTIVE.publicKey, status: "active" },
  { keyId: STANDBY.keyId, publicKey: STANDBY.publicKey, status: "standby" },
]);
const DURING = Date.parse("2026-11-09T08:00:00Z");
function context(overrides: Partial<PackCheckContext> = {}): PackCheckContext {
  return {
    keyring,
    revocations: EMPTY_REVOCATION_STATE,
    expected: { schoolId: SCHOOL, actorUserId: TEACHER, classId: CLASS, date: DATE },
    nowMs: DURING,
    lastTrustedTimeMs: issuedMs,
    ...overrides,
  };
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("pack signé par le signataire Backend PR1b : accepté, texte JSON intact, carte rapprochée", () => {
  const envelope = issue();
  const text = JSON.stringify(envelope);
  const parsed = parsePackEnvelopeText(text);
  assert.ok(parsed.ok);
  const { result, revocations } = verifyDownloadedPack(parsed.envelope, context());
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(revocations.sequence, 0);
  if (!result.ok) return;
  assert.equal(result.verified.expiresAtMs, window.expiresAt);
  const matchKey = matchCardInPack(result.verified, PUBLIC_ID, deriveCardKeyFromSecret(SECRET));
  assert.equal(matchKey, envelope.pack.cards[0].matchKey);
  assert.equal(matchCardInPack(result.verified, PUBLIC_ID, deriveCardKeyFromSecret(crypto.randomBytes(32).toString("base64url"))), null);
  assert.equal(matchCardInPack(result.verified, "CCCCCCCCCCCCCCCCCCCCCC", deriveCardKeyFromSecret(SECRET)), null);
});

test("pack signé par la clé standby (rotation d'urgence) : accepté", () => {
  const signer = backendSigner(STANDBY, [{ key: ACTIVE, status: "retired" }]);
  assert.ok(verifyPackEnvelope(issue(signer), context()).ok);
});

test("refus : signature falsifiée, contenu modifié après signature, champs absents ou en trop, JSON invalide", () => {
  const envelope = issue();
  const forged = clone(envelope);
  forged.signature.value = `${forged.signature.value.slice(0, 10)}${forged.signature.value[10] === "A" ? "B" : "A"}${forged.signature.value.slice(11)}`;
  assert.equal((verifyPackEnvelope(forged, context()) as { code: string }).code, PACK_ERROR.SIGNATURE_INVALID);

  const renamed = clone(envelope);
  renamed.pack.students[0].lastName = "Autre";
  assert.equal((verifyPackEnvelope(renamed, context()) as { code: string }).code, PACK_ERROR.SIGNATURE_INVALID);

  const unicode = clone(envelope);
  const accented = unicode.pack.students.find((student: { lastName: string }) => student.lastName !== student.lastName.normalize("NFD"));
  assert.ok(accented, "élève au nom accentué présent dans le pack");
  accented.lastName = accented.lastName.normalize("NFD");
  assert.equal((verifyPackEnvelope(unicode, context()) as { code: string }).code, PACK_ERROR.SIGNATURE_INVALID);

  const missing = clone(envelope) as { pack: Record<string, unknown> };
  delete missing.pack.syncDeadline;
  assert.equal((verifyPackEnvelope(missing, context()) as { code: string }).code, PACK_ERROR.SHAPE_INVALID);

  const extra = clone(envelope) as { pack: Record<string, unknown> };
  extra.pack.secret = "x";
  assert.equal((verifyPackEnvelope(extra, context()) as { code: string }).code, PACK_ERROR.SHAPE_INVALID);

  const extraEnvelope = { ...clone(envelope), more: 1 };
  assert.equal((verifyPackEnvelope(extraEnvelope, context()) as { code: string }).code, PACK_ERROR.SHAPE_INVALID);

  const float = clone(envelope) as { pack: Record<string, unknown> };
  float.pack.packVersion = 1.5;
  assert.equal((verifyPackEnvelope(float, context()) as { code: string }).code, PACK_ERROR.SHAPE_INVALID);

  assert.deepEqual(parsePackEnvelopeText("{pas du json"), { ok: false, code: PACK_ERROR.JSON_INVALID });
  assert.deepEqual(parsePackEnvelopeText(""), { ok: false, code: PACK_ERROR.JSON_INVALID });
  assert.equal((verifyPackEnvelope(null, context()) as { code: string }).code, PACK_ERROR.SHAPE_INVALID);
  assert.equal((verifyPackEnvelope([], context()) as { code: string }).code, PACK_ERROR.SHAPE_INVALID);
});

test("refus : version incompatible, algorithme ou keyId de signature incohérent", () => {
  const signer = backendSigner(ACTIVE, []);
  const v2 = issue(signer);
  const pack = { ...v2.pack, packVersion: 2 };
  assert.equal((verifyPackEnvelope({ pack, signature: signer.signPack(pack) }, context()) as { code: string }).code, PACK_ERROR.VERSION_UNSUPPORTED);
  const contract = { ...v2.pack, contractVersion: "rc-offline-2" };
  assert.equal(
    (verifyPackEnvelope({ pack: contract, signature: signer.signPack(contract) }, context()) as { code: string }).code,
    PACK_ERROR.VERSION_UNSUPPORTED,
  );
  const alg = clone(v2);
  alg.signature.alg = "EdDSA";
  assert.equal((verifyPackEnvelope(alg, context()) as { code: string }).code, PACK_ERROR.SIGNATURE_ALG);
  const keyId = clone(v2);
  keyId.signature.keyId = STANDBY.keyId;
  assert.equal((verifyPackEnvelope(keyId, context()) as { code: string }).code, PACK_ERROR.SIGNATURE_ALG);
});

test("refus : clé inconnue, pack d'un autre environnement (trousseau préproduction ≠ production)", () => {
  const unknown = keyPair("rc-pack-production-9");
  assert.equal((verifyPackEnvelope(issue(backendSigner(unknown, [])), context()) as { code: string }).code, PACK_ERROR.KEY_UNKNOWN);
  const preprodPack = issue(backendSigner(PREPROD, []));
  assert.equal((verifyPackEnvelope(preprodPack, context()) as { code: string }).code, PACK_ERROR.KEY_UNKNOWN);
  const preprodKeyring = validatePackKeyring("preproduction", [{ keyId: PREPROD.keyId, publicKey: PREPROD.publicKey, status: "active" }]);
  assert.ok(verifyPackEnvelope(preprodPack, context({ keyring: preprodKeyring })).ok);
  assert.equal((verifyPackEnvelope(issue(), context({ keyring: preprodKeyring })) as { code: string }).code, PACK_ERROR.KEY_UNKNOWN);
  // Même keyId mais autre clé publique : la signature ne vérifie pas.
  const impostor = keyPair(ACTIVE.keyId);
  assert.equal((verifyPackEnvelope(issue(backendSigner(impostor, [])), context()) as { code: string }).code, PACK_ERROR.SIGNATURE_INVALID);
});

test("refus : autre établissement, autre enseignant, autre classe, autre date (contenu authentifié)", () => {
  const envelope = issue();
  const expected = context().expected;
  const cases: Array<[Partial<typeof expected>, string]> = [
    [{ schoolId: "77777777-7777-4777-8777-777777777777" }, PACK_ERROR.OTHER_SCHOOL],
    [{ actorUserId: "77777777-7777-4777-8777-777777777777" }, PACK_ERROR.OTHER_TEACHER],
    [{ classId: "77777777-7777-4777-8777-777777777777" }, PACK_ERROR.OTHER_CLASS],
    [{ date: "2026-11-10" }, PACK_ERROR.OTHER_DATE],
  ];
  for (const [override, code] of cases) {
    assert.equal((verifyPackEnvelope(envelope, context({ expected: { ...expected, ...override } })) as { code: string }).code, code);
  }
});

test("dates limites : notBefore inclus, expiresAt exclu, horloge en retard de plus de 10 minutes refusée", () => {
  const envelope = issue();
  assert.equal((verifyPackEnvelope(envelope, context({ nowMs: window.notBefore - 1 })) as { code: string }).code, PACK_ERROR.NOT_YET_VALID);
  // Préchargement la veille : stockable, mais jamais utilisable avant notBefore.
  assert.ok(verifyPackEnvelope(envelope, context({ nowMs: window.notBefore - 1, purpose: "store" })).ok);
  assert.equal(
    (verifyPackEnvelope(envelope, context({ nowMs: window.expiresAt, purpose: "store" })) as { code: string }).code,
    PACK_ERROR.EXPIRED,
  );
  assert.ok(verifyPackEnvelope(envelope, context({ nowMs: window.notBefore })).ok);
  assert.ok(verifyPackEnvelope(envelope, context({ nowMs: window.expiresAt - 1 })).ok);
  assert.equal((verifyPackEnvelope(envelope, context({ nowMs: window.expiresAt })) as { code: string }).code, PACK_ERROR.EXPIRED);
  const trusted = DURING + 10 * 60 * 1000;
  assert.ok(verifyPackEnvelope(envelope, context({ lastTrustedTimeMs: trusted })).ok, "retard de 10 min exactement toléré");
  assert.equal(
    (verifyPackEnvelope(envelope, context({ lastTrustedTimeMs: trusted + 1 })) as { code: string }).code,
    PACK_ERROR.CLOCK_BEHIND,
  );
  // Un fuseau d'appareil différent n'a aucun effet : seules des instants UTC signés sont comparés.
  const previousTz = process.env.TZ;
  process.env.TZ = "Pacific/Kiritimati";
  try {
    assert.ok(verifyPackEnvelope(envelope, context()).ok);
  } finally {
    process.env.TZ = previousTz;
  }
});

test("révocation : liste signée appliquée avant le pack, pack d'une clé révoquée refusé, liste monotone", () => {
  // Rotation d'urgence : la clé active est compromise ; le serveur signe avec standby et révoque l'ancienne.
  const rotated = backendSigner(STANDBY, [{ key: ACTIVE, status: "revoked" }], 1);
  const fresh = issue(rotated);
  const downloaded = verifyDownloadedPack(fresh, context());
  assert.ok(downloaded.result.ok);
  assert.deepEqual(downloaded.revocations, { sequence: 1, revokedKeyIds: [ACTIVE.keyId] });

  // Un pack déjà stocké, signé par la clé désormais révoquée, est refusé au rechargement.
  const stored = issue();
  assert.equal((verifyPackEnvelope(stored, context({ revocations: downloaded.revocations })) as { code: string }).code, PACK_ERROR.KEY_REVOKED);
  // Un nouveau pack signé par la clé compromise, même avec sa propre liste, est refusé.
  const compromised = verifyDownloadedPack(issue(backendSigner(ACTIVE, [], 0)), context({ revocations: downloaded.revocations }));
  assert.equal((compromised.result as { code: string }).code, PACK_ERROR.REVOCATIONS_INVALID);
  assert.deepEqual(compromised.revocations, downloaded.revocations, "état de révocation inchangé");

  // Liste plus ancienne (séquence inférieure) : refusée, état conservé.
  const older = applyRevocations(issue(backendSigner(STANDBY, [], 0)).revocations, keyring, downloaded.revocations);
  assert.equal(older.ok, false);
  assert.deepEqual(older.state, downloaded.revocations);
  // Liste de même séquence sans la révocation : l'union conserve la clé révoquée.
  const replay = applyRevocations(issue(backendSigner(STANDBY, [{ key: keyPair("rc-pack-production-7"), status: "revoked" }], 1)).revocations, keyring, downloaded.revocations);
  assert.ok(replay.ok);
  if (replay.ok) assert.deepEqual(replay.state.revokedKeyIds, [ACTIVE.keyId, "rc-pack-production-7"].sort());
});

test("révocation : listes non signées, altérées, signées par une clé inconnue ou absentes → pack refusé", () => {
  const envelope = issue();
  const tampered = clone(envelope);
  tampered.revocations.list.revokedKeyIds = [];
  tampered.revocations.list.sequence = 5;
  assert.equal((verifyDownloadedPack(tampered, context()).result as { code: string }).code, PACK_ERROR.REVOCATIONS_INVALID);
  const unsigned = clone(envelope) as { revocations: { signature?: unknown } };
  delete unsigned.revocations.signature;
  assert.equal((verifyDownloadedPack(unsigned, context()).result as { code: string }).code, PACK_ERROR.REVOCATIONS_INVALID);
  const absent = clone(envelope) as { revocations?: unknown };
  delete absent.revocations;
  assert.equal((verifyDownloadedPack(absent, context()).result as { code: string }).code, PACK_ERROR.REVOCATIONS_INVALID);
  const foreign = issue(backendSigner(keyPair("rc-pack-production-8"), []));
  assert.equal(applyRevocations(foreign.revocations, keyring, EMPTY_REVOCATION_STATE).ok, false);
});

test("trousseaux embarqués : clés publiques uniquement, distincts par environnement, vides tant que non générés", () => {
  for (const [profile, keys] of Object.entries(EMBEDDED_PACK_KEYRINGS)) {
    const ring = embeddedPackKeyring(profile);
    assert.equal(ring.keys.length, keys.length);
    for (const key of keys as PackKeyringEntry[]) assert.match(key.publicKey, /^[A-Za-z0-9_-]{43}$/);
  }
  const prodIds = new Set(EMBEDDED_PACK_KEYRINGS.production.map((key) => key.keyId));
  for (const key of EMBEDDED_PACK_KEYRINGS.preproduction) assert.equal(prodIds.has(key.keyId), false);
  assert.throws(() => embeddedPackKeyring("staging"));
  assert.throws(() => validatePackKeyring("production", [
    { keyId: ACTIVE.keyId, publicKey: ACTIVE.publicKey, status: "active" },
    { keyId: STANDBY.keyId, publicKey: STANDBY.publicKey, status: "active" },
  ]));
  assert.throws(() => validatePackKeyring("production", [{ keyId: "pack-1", publicKey: ACTIVE.publicKey, status: "active" }]));
  // Trousseau vide (état de cette PR) : tout pack est refusé, jamais accepté par défaut.
  assert.equal((verifyPackEnvelope(issue(), context({ keyring: embeddedPackKeyring("production") })) as { code: string }).code, PACK_ERROR.KEY_UNKNOWN);
});

test("horloge de confiance : monotone, en-tête Date strict", () => {
  assert.equal(advanceTrustedTime(null, 5), 5);
  assert.equal(advanceTrustedTime(10, 5), 10);
  assert.equal(advanceTrustedTime(10, null), 10);
  assert.equal(parseHttpDate("Mon, 09 Nov 2026 07:30:00 GMT"), Date.parse("2026-11-09T07:30:00Z"));
  assert.equal(parseHttpDate("2026-11-09T07:30:00Z"), null);
  assert.equal(parseHttpDate("lundi"), null);
  assert.equal(isDeviceClockBehind(0, 600_001), true);
  assert.equal(isDeviceClockBehind(0, 600_000), false);
  assert.equal(isDeviceClockBehind(0, null), false);
});
