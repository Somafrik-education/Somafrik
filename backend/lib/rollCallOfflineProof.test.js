"use strict";

/**
 * NFC-PRES-LOCAL-PR1a — conformité des primitives aux vecteurs partagés V-1 à V-12 et J-1 à J-10.
 * Fixture : copie octet pour octet de docs/audits/NFC-PRES-LOCAL-PR0-vectors.json (PR #1111,
 * HEAD 5a23d6555e8309a4f48aa9cf32f070c7ea18aaee). Valeurs fictives, réservées aux tests.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  CONTRACT_VERSION,
  TAGS,
  OFFLINE_PROOF_ERROR,
  lp,
  deriveCardKeyFromSecret,
  cardKeyFromTokenHash,
  computeCardRef,
  computeVerifier,
  computeProof,
  verifyProof,
  digestsEqual,
  canonicalJson,
  computePayloadDigest,
  packSigningMessage,
} = require("./rollCallOfflineProof");

const FIXTURE_PATH = path.join(__dirname, "fixtures", "rollCallOfflineVectors.json");
const FIXTURE_SHA256 = "c28fd639b6d7315fae05fe4f4ef9b0c064b6a475eaa9e1fd018e609bde2c9b93";
const raw = fs.readFileSync(FIXTURE_PATH);
const vectors = JSON.parse(raw.toString("utf8"));
const input = vectors.inputs;
const expected = vectors.expected;

const scope = { schoolId: input.schoolId, classId: input.classId, packId: input.packId, publicId: input.publicId };
const proofInput = (overrides = {}) => ({
  contractVersion: input.contractVersion,
  schoolId: input.schoolId,
  actorUserId: input.actorUserId,
  classId: input.classId,
  date: input.date,
  mode: input.mode,
  sessionId: input.sessionId,
  packId: input.packId,
  scanId: input.scanId,
  publicId: input.publicId,
  medium: "nfc",
  ...overrides,
});
const key = () => deriveCardKeyFromSecret(input.secret);
const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

function assertFieldError(fn, field) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, OFFLINE_PROOF_ERROR.FIELD_INVALID);
    if (field) assert.equal(error.field, field);
    return true;
  });
}

test("fixture identique au fichier de vecteurs de PR0 et constantes du contrat", () => {
  assert.equal(crypto.createHash("sha256").update(raw).digest("hex"), FIXTURE_SHA256);
  assert.equal(vectors.revision, 4);
  assert.equal(CONTRACT_VERSION, input.contractVersion);
  assert.equal(TAGS.cardRef, vectors.tags.cardRef);
  assert.equal(TAGS.verifier, vectors.tags.verifier);
  assert.equal(TAGS.proof, vectors.tags.proof);
  assert.equal(TAGS.pack, "somafrik.rc-offline.pack.v1\n");
});

test("V-1 : K = SHA-256(utf8(secret)) = hex_decode(token_hash)", () => {
  assert.equal(key().toString("hex"), expected["V-1_K_hex"]);
  assert.deepEqual(cardKeyFromTokenHash(expected["V-1_K_hex"]), key());
});

test("V-2 / V-3 : cardRef et verifier", () => {
  assert.equal(computeCardRef(scope), expected["V-2_cardRef"]);
  assert.equal(computeVerifier(key(), scope), expected["V-3_verifier"]);
  // Même résultat avec la clé reconstruite côté serveur.
  assert.equal(computeVerifier(cardKeyFromTokenHash(expected["V-1_K_hex"]), scope), expected["V-3_verifier"]);
});

test("V-4 / V-5 / V-8 : preuve liée au support et au pack", () => {
  assert.equal(computeProof(key(), proofInput()), expected["V-4_proof_nfc"]);
  assert.equal(computeProof(key(), proofInput({ medium: "qr" })), expected["V-5_proof_qr"]);
  assert.notEqual(expected["V-4_proof_nfc"], expected["V-5_proof_qr"]);
  assert.equal(computeProof(key(), proofInput({ packId: "" })), expected["V-8_proof_nfc_noPack"]);
});

test("V-6 / V-7 : LP sans ambiguïté, champ vide encodé", () => {
  assert.equal("a|b" + "|" + "c", "a" + "|" + "b|c");
  assert.equal(lp(["a|b", "c"]).toString("hex"), expected["V-6_lp_a|b,c"]);
  assert.equal(lp(["a", "b|c"]).toString("hex"), expected["V-6_lp_a,b|c"]);
  assert.notEqual(expected["V-6_lp_a|b,c"], expected["V-6_lp_a,b|c"]);
  assert.equal(lp(["ab", "", "c"]).toString("hex"), expected["V-7_lp_ab,empty,c"]);
});

test("LP : UTF-8 multioctet et refus des champs non chaînes", () => {
  assert.equal(lp(["é"]).toString("hex"), "00000002c3a9");
  assertFieldError(() => lp([]), "LP");
  assertFieldError(() => lp("abc"), "LP");
  assertFieldError(() => lp(["a", 1]), "LP[1]");
  assertFieldError(() => lp(["a", null]), "LP[1]");
});

test("V-9 / V-10 : message signé du pack vérifié par la clé publique de test", () => {
  const publicKey = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(expected["V-9_ed25519_test_pub_raw"], "base64url")]),
    format: "der",
    type: "spki",
  });
  const signature = Buffer.from(expected["V-10_pack_signature"], "base64url");
  const message = packSigningMessage(vectors.testPack);
  assert.equal(sha256(canonicalJson(vectors.testPack)), expected["V-10_pack_canonical_sha256"]);
  assert.equal(crypto.verify(null, message, publicKey, signature), true);
  const tampered = packSigningMessage({ ...vectors.testPack, classId: input.schoolId });
  assert.equal(crypto.verify(null, tampered, publicKey, signature), false);
  // Sans le préfixe de domaine, la même signature ne vérifie pas.
  assert.equal(crypto.verify(null, Buffer.from(canonicalJson(vectors.testPack), "utf8"), publicKey, signature), false);
});

test("V-11 / V-12 : payloadDigest du lot, support authentifié", () => {
  const body = vectors.testSyncBodyWithoutDigest;
  assert.equal(computePayloadDigest(body), expected["V-11_payloadDigest"]);
  // Le champ payloadDigest éventuel est exclu du calcul.
  assert.equal(computePayloadDigest({ ...body, payloadDigest: "x" }), expected["V-11_payloadDigest"]);
  const qr = { ...body, scans: body.scans.map((scan) => ({ ...scan, medium: "qr" })) };
  assert.equal(computePayloadDigest(qr), expected["V-12_payloadDigest_medium_qr"]);
  // Ordre des clés indifférent.
  const reordered = Object.fromEntries(Object.entries(body).reverse());
  assert.equal(computePayloadDigest(reordered), expected["V-11_payloadDigest"]);
});

test("J-1 à J-7 : JSON canonique et SHA-256 conformes", () => {
  for (const name of ["J-1", "J-2", "J-3", "J-4", "J-5", "J-6", "J-7"]) {
    const entry = vectors.jcs[name];
    const canonical = canonicalJson(entry.input);
    assert.equal(canonical, entry.canonical, name);
    assert.equal(sha256(canonical), entry.sha256, name);
  }
  // J-2 (NFD) n'est pas normalisé : empreinte différente de J-1 (NFC).
  assert.notEqual(vectors.jcs["J-1"].sha256, vectors.jcs["J-2"].sha256);
});

test("J-8 à J-10 et autres types hors contrat : refus avant canonicalisation", () => {
  const refused = {
    "J-8 -0": { v: -0 },
    "J-9 flottant": { v: 0.1 },
    "J-9 exposant": { w: 1e21 },
    "J-10 undefined": { a: undefined, b: 1 },
    "entier non sûr": { v: 2 ** 53 },
    NaN: { v: Number.NaN },
    Infinity: { v: Number.POSITIVE_INFINITY },
    BigInt: { v: 1n },
    Date: { d: new Date(0) },
    "toJSON": { d: { toJSON: () => "x" } },
    "tableau creux": { v: [1, , 2] }, // eslint-disable-line no-sparse-arrays
    "surrogate isolé (valeur)": { v: "\ud800" },
    "surrogate isolé (clé)": { "\udc00": 1 },
    Map: { v: new Map() },
    fonction: { v() {} },
    "symbole": { v: Symbol("s") },
    "undefined racine": undefined,
  };
  for (const [name, value] of Object.entries(refused)) {
    assert.throws(() => canonicalJson(value), (error) => error.code === OFFLINE_PROOF_ERROR.VALUE_INVALID, name);
  }
  let deep = 1;
  for (let i = 0; i < 40; i += 1) deep = [deep];
  assert.throws(() => canonicalJson(deep), (error) => error.code === OFFLINE_PROOF_ERROR.VALUE_INVALID);
  assert.throws(() => computePayloadDigest([]), (error) => error.code === OFFLINE_PROOF_ERROR.VALUE_INVALID);
  assert.throws(() => packSigningMessage(null), (error) => error.code === OFFLINE_PROOF_ERROR.VALUE_INVALID);
});

test("verifyProof : accepte la preuve exacte, refuse toute altération sans lever d'exception", () => {
  const proof = expected["V-4_proof_nfc"];
  assert.equal(verifyProof(key(), proofInput(), proof), true);
  assert.equal(verifyProof(cardKeyFromTokenHash(expected["V-1_K_hex"]), proofInput(), proof), true);
  const otherUuid = "00000000-0000-4000-8000-0000000000ff";
  const altered = {
    "support qr": proofInput({ medium: "qr" }),
    "autre établissement": proofInput({ schoolId: otherUuid }),
    "autre acteur": proofInput({ actorUserId: otherUuid }),
    "autre classe": proofInput({ classId: otherUuid }),
    "autre date": proofInput({ date: "2026-11-10" }),
    "autre session": proofInput({ sessionId: otherUuid }),
    "autre pack": proofInput({ packId: otherUuid }),
    "sans pack": proofInput({ packId: "" }),
    "autre scan": proofInput({ scanId: otherUuid }),
    "autre carte": proofInput({ publicId: "BAAAAAAAAAAAAAAAAAAAAA" }),
  };
  for (const [name, fields] of Object.entries(altered)) {
    assert.equal(verifyProof(key(), fields, proof), false, name);
  }
  assert.equal(verifyProof(Buffer.alloc(32, 7), proofInput(), proof), false, "autre clé");
  // Champs hors format, clé invalide, preuve mal formée : false, jamais d'exception.
  assert.equal(verifyProof(key(), proofInput({ medium: "NFC" }), proof), false);
  assert.equal(verifyProof(key(), proofInput({ contractVersion: "rc-offline-2" }), proof), false);
  assert.equal(verifyProof(Buffer.alloc(16), proofInput(), proof), false);
  assert.equal(verifyProof("cle", proofInput(), proof), false);
  for (const bad of [undefined, null, "", proof.slice(1), `${proof}A`, `${proof.slice(0, -1)}h`, proof.replace(/./, "+"), 42]) {
    assert.equal(verifyProof(key(), proofInput(), bad), false, String(bad));
  }
});

test("digestsEqual : forme base64url canonique de 32 octets uniquement", () => {
  const value = expected["V-2_cardRef"];
  assert.equal(digestsEqual(value, value), true);
  assert.equal(digestsEqual(value, expected["V-3_verifier"]), false);
  // Dernier caractère à bits de remplissage non nuls : même octets décodés, refusé.
  const lastIndex = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".indexOf(value.at(-1));
  const sibling = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[lastIndex ^ 1];
  const variant = value.slice(0, -1) + sibling;
  assert.deepEqual(Buffer.from(variant, "base64url"), Buffer.from(value, "base64url"));
  assert.equal(digestsEqual(value, variant), false);
  assert.equal(digestsEqual(value, null), false);
  assert.equal(digestsEqual(value, value.slice(2)), false);
});

test("validation stricte des champs, sans normalisation silencieuse", () => {
  const k = key();
  // UUID en majuscules : refusé, jamais converti.
  assertFieldError(() => computeProof(k, proofInput({ schoolId: "00000000-0000-4000-8000-00000000000A" })), "schoolId");
  assertFieldError(() => computeProof(k, proofInput({ date: "2026-02-30" })), "date");
  assertFieldError(() => computeProof(k, proofInput({ date: "2026-1-09" })), "date");
  assertFieldError(() => computeProof(k, proofInput({ medium: "NFC" })), "medium");
  assertFieldError(() => computeProof(k, proofInput({ medium: undefined })), "medium");
  assertFieldError(() => computeProof(k, proofInput({ mode: "direction" })), "mode");
  assertFieldError(() => computeProof(k, proofInput({ contractVersion: "rc-offline-2" })), "contractVersion");
  assertFieldError(() => computeProof(k, proofInput({ packId: null })), "packId");
  assertFieldError(() => computeProof(k, proofInput({ sessionId: ` ${input.sessionId}` })), "sessionId");
  assertFieldError(() => computeProof(k, proofInput({ publicId: "AAAA" })), "publicId");
  assertFieldError(() => computeProof(k, proofInput({ publicId: `${input.publicId}.` })), "publicId");
  assertFieldError(() => computeCardRef({ ...scope, classId: "not-a-uuid" }), "classId");
  assertFieldError(() => computeVerifier(Buffer.alloc(31), scope), "K");
  assertFieldError(() => cardKeyFromTokenHash(expected["V-1_K_hex"].toUpperCase()), "token_hash");
  assertFieldError(() => cardKeyFromTokenHash("00"), "token_hash");
  assertFieldError(() => deriveCardKeyFromSecret(`${input.secret}=`), "secret");
  assertFieldError(() => deriveCardKeyFromSecret(42), "secret");
});

test("aucun message d'erreur ne contient la valeur refusée", () => {
  const secretLike = "SECRET-NE-DOIT-PAS-FUIR-000000000000000000=";
  const cases = [
    () => deriveCardKeyFromSecret(secretLike),
    () => cardKeyFromTokenHash(secretLike),
    () => computeProof(key(), proofInput({ publicId: secretLike })),
    () => canonicalJson({ v: secretLike, n: 0.5 }),
  ];
  for (const fn of cases) {
    assert.throws(fn, (error) => {
      assert.equal(String(error.message).includes(secretLike), false);
      assert.equal(JSON.stringify({ ...error, message: error.message }).includes(secretLike), false);
      return true;
    });
  }
});
