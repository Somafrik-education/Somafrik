"use strict";

/**
 * NFC-PRES-LOCAL-PR1b — signataire Ed25519 des packs et liste de révocation.
 * Clés générées à l'exécution ; la seule clé reconstruite est la clé de TEST du vecteur V-10
 * (graine publique fictive 32 × 0x01, docs/audits/NFC-PRES-LOCAL-PR0-vectors.json).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const {
  SIGNING_KEY_ENV,
  KEYRING_ENV,
  PACK_SIGNER_ERROR,
  MATCH_SECRET_ENV,
  parseKeyring,
  createPackSigner,
  packSignerFromEnv,
  resetPackSignerCacheForTests,
  resolvePackMatchSecret,
  verifySignature,
} = require("./rollCallOfflinePackSigner");
const { packSigningMessage, revocationsSigningMessage } = require("./rollCallOfflineProof");

const vectors = require(path.join(__dirname, "fixtures", "rollCallOfflineVectors.json"));

function newKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privateDer: privateKey.export({ format: "der", type: "pkcs8" }),
    publicRaw: publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64url"),
  };
}

function keyFromSeed(seed) {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der",
    type: "pkcs8",
  });
  return {
    privateDer: privateKey.export({ format: "der", type: "pkcs8" }),
    publicRaw: crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(12).toString("base64url"),
  };
}

function env({ signing, keys, sequence = 0, encoding = "base64url" }) {
  return {
    [SIGNING_KEY_ENV]: signing === undefined ? undefined : Buffer.from(signing).toString(encoding),
    [KEYRING_ENV]: JSON.stringify({ revocationSequence: sequence, keys }),
  };
}

function assertUnavailable(fn, reason) {
  assert.throws(fn, (error) => {
    assert.equal(error.statusCode, 503);
    assert.equal(error.code, PACK_SIGNER_ERROR.UNAVAILABLE);
    if (reason) assert.equal(error.reason, reason);
    return true;
  });
}

const A = newKey();
const B = newKey();
const C = newKey();
const samplePack = (keyId) => ({ ...vectors.testPack, keyId });

test("V-10 : la signature du pack de test par la clé de test est reproduite à l'identique", () => {
  const seedKey = keyFromSeed(Buffer.alloc(32, 1));
  assert.equal(seedKey.publicRaw, vectors.expected["V-9_ed25519_test_pub_raw"]);
  const signer = createPackSigner(env({
    signing: seedKey.privateDer,
    keys: [{ keyId: "rc-pack-test-1", publicKey: seedKey.publicRaw, status: "active" }],
  }));
  const signature = signer.signPack(vectors.testPack);
  assert.deepEqual(signature, { alg: "Ed25519", keyId: "rc-pack-test-1", value: vectors.expected["V-10_pack_signature"] });
});

test("signature valide, champ signé altéré, mauvaise clé publique, keyId inconnu", () => {
  const keys = [{ keyId: "rc-pack-a", publicKey: A.publicRaw, status: "active" }, { keyId: "rc-pack-b", publicKey: B.publicRaw, status: "standby" }];
  const signer = createPackSigner(env({ signing: A.privateDer, keys }));
  const keyring = parseKeyring(env({ signing: A.privateDer, keys })[KEYRING_ENV]);
  const pack = samplePack("rc-pack-a");
  const signature = signer.signPack(pack);
  assert.equal(signature.keyId, "rc-pack-a");
  assert.equal(verifySignature({ message: packSigningMessage(pack), signature, keyring }), true);
  for (const [field, value] of [["classId", vectors.inputs.schoolId], ["expiresAt", "2026-11-10T23:00:00Z"], ["students", []], ["mode", "direction"]]) {
    assert.equal(verifySignature({ message: packSigningMessage({ ...pack, [field]: value }), signature, keyring }), false, field);
  }
  // Mauvaise clé publique : même keyId, autre clé.
  const wrongRing = parseKeyring(JSON.stringify({ revocationSequence: 0, keys: [{ keyId: "rc-pack-a", publicKey: C.publicRaw, status: "active" }] }));
  assert.equal(verifySignature({ message: packSigningMessage(pack), signature, keyring: wrongRing }), false);
  // keyId inconnu, algorithme et signatures mal formés.
  assert.equal(verifySignature({ message: packSigningMessage(pack), signature: { ...signature, keyId: "rc-pack-zz" }, keyring }), false);
  assert.equal(verifySignature({ message: packSigningMessage(pack), signature: { ...signature, alg: "HS256" }, keyring }), false);
  assert.equal(verifySignature({ message: packSigningMessage(pack), signature: { ...signature, value: signature.value.slice(1) }, keyring }), false);
  assert.equal(verifySignature({ message: packSigningMessage(pack), signature: null, keyring }), false);
  // Un pack dont le keyId ne correspond pas à la clé active n'est jamais signé.
  assertUnavailable(() => signer.signPack(samplePack("rc-pack-b")), "pack_key_id");
});

test("clé privée absente, mal formée, d'un autre type ou ne correspondant pas à la clé active : 503", () => {
  const keys = [{ keyId: "rc-pack-a", publicKey: A.publicRaw, status: "active" }];
  assertUnavailable(() => createPackSigner(env({ signing: undefined, keys })), "signing_key_missing");
  assertUnavailable(() => createPackSigner({ ...env({ signing: A.privateDer, keys }), [SIGNING_KEY_ENV]: "   " }), "signing_key_missing");
  assertUnavailable(() => createPackSigner({ ...env({ signing: A.privateDer, keys }), [SIGNING_KEY_ENV]: "pas de la base64 !" }), "signing_key_encoding");
  assertUnavailable(() => createPackSigner(env({ signing: Buffer.from("not a pkcs8 key at all"), keys })), "signing_key_format");
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ format: "der", type: "pkcs8" });
  assertUnavailable(() => createPackSigner(env({ signing: rsa, keys })), "signing_key_type");
  assertUnavailable(() => createPackSigner(env({ signing: B.privateDer, keys })), "signing_key_mismatch");
  // Les deux encodages base64 et base64url sont acceptés.
  assert.equal(createPackSigner(env({ signing: A.privateDer, keys, encoding: "base64" })).keyId, "rc-pack-a");
  assert.equal(createPackSigner(env({ signing: A.privateDer, keys, encoding: "base64url" })).keyId, "rc-pack-a");
});

test("trousseau : validation stricte et fail-closed", () => {
  const ok = { keyId: "rc-pack-a", publicKey: A.publicRaw, status: "active" };
  const ring = (value) => () => parseKeyring(typeof value === "string" ? value : JSON.stringify(value));
  assertUnavailable(ring(""), "keyring_missing");
  assertUnavailable(ring("{"), "keyring_json");
  assertUnavailable(ring([]), "keyring_shape");
  assertUnavailable(ring({ keys: [ok] }), "keyring_sequence");
  assertUnavailable(ring({ revocationSequence: -1, keys: [ok] }), "keyring_sequence");
  assertUnavailable(ring({ revocationSequence: 1.5, keys: [ok] }), "keyring_sequence");
  assertUnavailable(ring({ revocationSequence: 0, keys: [] }), "keyring_keys");
  assertUnavailable(ring({ revocationSequence: 0, keys: [{ ...ok, keyId: "Pack-A" }] }), "keyring_key_id");
  assertUnavailable(ring({ revocationSequence: 0, keys: [ok, { ...ok, publicKey: B.publicRaw }] }), "keyring_key_id");
  assertUnavailable(ring({ revocationSequence: 0, keys: [{ ...ok, publicKey: "AAAA" }] }), "keyring_public_key");
  assertUnavailable(ring({ revocationSequence: 0, keys: [ok, { keyId: "rc-pack-b", publicKey: A.publicRaw, status: "standby" }] }), "keyring_public_key");
  assertUnavailable(ring({ revocationSequence: 0, keys: [{ ...ok, status: "enabled" }] }), "keyring_status");
  assertUnavailable(ring({ revocationSequence: 0, keys: [{ ...ok, status: "standby" }] }), "keyring_active_count");
  assertUnavailable(ring({ revocationSequence: 0, keys: [ok, { keyId: "rc-pack-b", publicKey: B.publicRaw, status: "active" }] }), "keyring_active_count");
  // Une révocation exige une séquence ≥ 1.
  assertUnavailable(ring({ revocationSequence: 0, keys: [ok, { keyId: "rc-pack-b", publicKey: B.publicRaw, status: "revoked" }] }), "keyring_sequence");
});

test("révocation : liste signée, monotone, sans matériel de clé ; clé révoquée refusée à la vérification", () => {
  const keys = [
    { keyId: "rc-pack-b", publicKey: B.publicRaw, status: "active" },
    { keyId: "rc-pack-a", publicKey: A.publicRaw, status: "revoked" },
    { keyId: "rc-pack-c", publicKey: C.publicRaw, status: "standby" },
  ];
  const config = env({ signing: B.privateDer, keys, sequence: 3 });
  const signer = createPackSigner(config);
  const keyring = parseKeyring(config[KEYRING_ENV]);
  const signed = signer.signedRevocations("2026-11-08T16:02:00Z");
  assert.deepEqual(signed.list, { contractVersion: "rc-offline-1", sequence: 3, revokedKeyIds: ["rc-pack-a"], issuedAt: "2026-11-08T16:02:00Z" });
  assert.equal(verifySignature({ message: revocationsSigningMessage(signed.list), signature: signed.signature, keyring }), true);
  // Liste rejouée avec une séquence modifiée : signature invalide.
  assert.equal(verifySignature({ message: revocationsSigningMessage({ ...signed.list, sequence: 2 }), signature: signed.signature, keyring }), false);
  // Aucune clé (privée ou publique) ni donnée d'établissement dans la liste.
  const rendered = JSON.stringify(signed);
  for (const secret of [A.publicRaw, B.publicRaw, C.publicRaw, B.privateDer.toString("base64url"), B.privateDer.toString("base64")]) {
    assert.equal(rendered.includes(secret), false);
  }
  // Une signature d'un pack par la clé révoquée (ancienne clé compromise) n'est jamais acceptée.
  const formerSigner = createPackSigner(env({ signing: A.privateDer, keys: [{ keyId: "rc-pack-a", publicKey: A.publicRaw, status: "active" }] }));
  const pack = samplePack("rc-pack-a");
  assert.equal(verifySignature({ message: packSigningMessage(pack), signature: formerSigner.signPack(pack), keyring }), false);
});

test("rotation : standby devient active ; les packs déjà signés restent vérifiables par la clé retirée", () => {
  const before = [{ keyId: "rc-pack-a", publicKey: A.publicRaw, status: "active" }, { keyId: "rc-pack-b", publicKey: B.publicRaw, status: "standby" }];
  const oldSigner = createPackSigner(env({ signing: A.privateDer, keys: before }));
  const oldPack = samplePack("rc-pack-a");
  const oldSignature = oldSigner.signPack(oldPack);
  // Rotation planifiée : B active, A retirée, séquence inchangée.
  const after = [{ keyId: "rc-pack-a", publicKey: A.publicRaw, status: "retired" }, { keyId: "rc-pack-b", publicKey: B.publicRaw, status: "active" }];
  const config = env({ signing: B.privateDer, keys: after });
  const newSigner = createPackSigner(config);
  const keyring = parseKeyring(config[KEYRING_ENV]);
  assert.equal(newSigner.keyId, "rc-pack-b");
  const newPack = samplePack("rc-pack-b");
  assert.equal(verifySignature({ message: packSigningMessage(newPack), signature: newSigner.signPack(newPack), keyring }), true);
  assert.equal(verifySignature({ message: packSigningMessage(oldPack), signature: oldSignature, keyring }), true, "clé retirée, non révoquée");
  // L'ancienne clé privée déployée par erreur après rotation : refus.
  assertUnavailable(() => createPackSigner(env({ signing: A.privateDer, keys: after })), "signing_key_mismatch");
  // Rotation d'urgence : A révoquée, séquence incrémentée ; son ancien pack n'est plus accepté.
  const urgent = env({ signing: B.privateDer, sequence: 1, keys: [{ ...after[0], status: "revoked" }, after[1]] });
  const urgentRing = parseKeyring(urgent[KEYRING_ENV]);
  assert.deepEqual(createPackSigner(urgent).signedRevocations("2026-11-08T16:02:00Z").list.revokedKeyIds, ["rc-pack-a"]);
  assert.equal(verifySignature({ message: packSigningMessage(oldPack), signature: oldSignature, keyring: urgentRing }), false);
});

test("aucun message d'erreur ne contient de matériel de clé", () => {
  const keys = [{ keyId: "rc-pack-a", publicKey: A.publicRaw, status: "active" }];
  const leaked = B.privateDer.toString("base64url");
  try {
    createPackSigner(env({ signing: B.privateDer, keys }));
    assert.fail("devait échouer");
  } catch (error) {
    const rendered = `${error.message} ${JSON.stringify(error)} ${error.reason}`;
    assert.equal(rendered.includes(leaked), false);
    assert.equal(rendered.includes(A.publicRaw), false);
  }
});

test("signataire réévalué à chaque appel : même configuration réutilisée, changement pris en compte, jamais de signataire périmé", () => {
  resetPackSignerCacheForTests();
  const ringA = [{ keyId: "rc-pack-a", publicKey: A.publicRaw, status: "active" }, { keyId: "rc-pack-b", publicKey: B.publicRaw, status: "standby" }];
  const ringB = [{ keyId: "rc-pack-a", publicKey: A.publicRaw, status: "retired" }, { keyId: "rc-pack-b", publicKey: B.publicRaw, status: "active" }];
  const process1 = env({ signing: A.privateDer, keys: ringA });
  const first = packSignerFromEnv(process1);
  assert.equal(first.keyId, "rc-pack-a");
  assert.equal(packSignerFromEnv({ ...process1 }), first, "même configuration : même signataire");
  // Nouvelle configuration (rotation) : nouveau signataire, nouvelle clé.
  const rotated = packSignerFromEnv(env({ signing: B.privateDer, keys: ringB }));
  assert.equal(rotated.keyId, "rc-pack-b");
  assert.notEqual(rotated, first);
  // Configuration devenue invalide après une configuration valide : 503, l'ancien signataire n'est pas servi.
  assertUnavailable(() => packSignerFromEnv(env({ signing: A.privateDer, keys: ringB })), "signing_key_mismatch");
  assertUnavailable(() => packSignerFromEnv({ ...process1, [SIGNING_KEY_ENV]: "" }), "signing_key_missing");
  // Retour à une configuration valide : de nouveau disponible.
  assert.equal(packSignerFromEnv(process1).keyId, "rc-pack-a");
  resetPackSignerCacheForTests();
});

test("secret de rapprochement dédié : fail-closed si absent, faible ou égal à JWT_SECRET", () => {
  const strong = "pr1b-test-only-match-".repeat(3);
  const unavailable = (envValue) => assert.throws(() => resolvePackMatchSecret(envValue), (error) => {
    assert.equal(error.statusCode, 503);
    assert.equal(error.code, PACK_SIGNER_ERROR.MATCH_SECRET_UNAVAILABLE);
    assert.equal(String(error.message).includes(strong), false);
    return true;
  });
  assert.equal(MATCH_SECRET_ENV, "ROLL_CALL_PACK_MATCH_SECRET");
  assert.equal(resolvePackMatchSecret({ [MATCH_SECRET_ENV]: strong, JWT_SECRET: "jwt-secret-different-of-at-least-32-chars" }), strong);
  unavailable({});
  unavailable({ [MATCH_SECRET_ENV]: "   " });
  unavailable({ [MATCH_SECRET_ENV]: "trop-court" });
  unavailable({ [MATCH_SECRET_ENV]: "change-this-long-random-secret-before-use" });
  unavailable({ [MATCH_SECRET_ENV]: strong, JWT_SECRET: strong });
});
