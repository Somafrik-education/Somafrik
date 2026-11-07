"use strict";

/**
 * NFC-PRES-LOCAL-PR1a — conformité des primitives aux vecteurs partagés V-1 à V-12 et J-1 à J-10.
 * Fixture : copie octet pour octet de docs/audits/NFC-PRES-LOCAL-PR0-vectors.json (PR #1111,
 * HEAD 40239bcf15c390c0564dcf58ca0949d32baf006f, vecteurs révision 5). Valeurs fictives, réservées aux tests.
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
  MAX_CANONICAL_DEPTH,
  MAX_CANONICAL_BYTES,
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
const FIXTURE_SHA256 = "f6ee8286d2fac0f7e48e52115f65fa2d2708c2728a03bb8db16f61ab71a633de";
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
  assert.equal(vectors.revision, 5);
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

// --- Renforcements demandés en revue CTO de PR1a (#1112) ---------------------------------------

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test("aucune fonction ne modifie ses entrées (objets gelés et instantanés comparés)", () => {
  const k = key();
  const kBefore = Buffer.from(k);
  const frozenScope = deepFreeze({ ...scope });
  const frozenProof = deepFreeze(proofInput());
  const body = deepFreeze(structuredClone({ ...vectors.testSyncBodyWithoutDigest, payloadDigest: "x" }));
  const pack = deepFreeze(structuredClone(vectors.testPack));
  const fields = deepFreeze(["a", "b"]);
  const snapshots = [frozenScope, frozenProof, body, pack, fields].map((value) => JSON.stringify(value));
  computeCardRef(frozenScope);
  computeVerifier(k, frozenScope);
  const proof = computeProof(k, frozenProof);
  verifyProof(k, frozenProof, proof);
  computePayloadDigest(body);
  packSigningMessage(pack);
  canonicalJson(pack);
  lp(fields);
  assert.deepEqual([frozenScope, frozenProof, body, pack, fields].map((value) => JSON.stringify(value)), snapshots);
  assert.deepEqual(k, kBefore);
  assert.equal(body.payloadDigest, "x");
});

test("LP : surrogates isolés refusés, paire valide acceptée, aucune collision avec U+FFFD", () => {
  assert.equal(lp(["\ufffd"]).toString("hex"), "00000003efbfbd");
  assert.equal(lp(["\ud83d\ude00"]).toString("hex"), "00000004f09f9880");
  for (const [name, value] of Object.entries({
    "haut isolé": "\ud800",
    "bas isolé": "\udc00",
    "haut en fin": "a\ud83d",
    "paire inversée": "\ude00\ud83d",
    "deux hauts": "\ud83d\ud83d",
  })) {
    assertFieldError(() => lp([value]), "LP[0]");
    assert.equal(name.length > 0, true);
  }
  assertFieldError(() => lp(["ok", "\udfff"]), "LP[1]");
  // Les champs de preuve étant validés en ASCII, un surrogate y est refusé en amont.
  assertFieldError(() => computeProof(key(), proofInput({ publicId: "AAAAAAAAAAAAAAAAAAAA\ud800A" })), "publicId");
  assert.throws(() => canonicalJson(vectors.jcs["J-11"] && { v: "\ud800" }), (error) => error.code === OFFLINE_PROOF_ERROR.VALUE_INVALID);
});

test("JCS (jcs.js) : exemple de tri de la RFC 8785 §3.2.3 et échappements du domaine admis", () => {
  const input = {
    "\u20ac": "Euro Sign",
    "\r": "Carriage Return",
    "\ufb33": "Hebrew Letter Dalet With Dagesh",
    "1": "One",
    "\ud83d\ude00": "Emoji: Grinning Face",
    "\u0080": "Control",
    "\u00f6": "Latin Small Letter O With Diaeresis",
  };
  assert.equal(
    canonicalJson(input),
    '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis",' +
      '"\u20ac":"Euro Sign","\ud83d\ude00":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
  );
  // Échappements : seuls " \\ et U+0000..U+001F ; formes courtes \\b \\f \\n \\r \\t, sinon \\u00xx minuscule.
  assert.equal(canonicalJson({ v: "\b\f\n\r\t\u0000\u001f\u000b" }), '{"v":"\\b\\f\\n\\r\\t\\u0000\\u001f\\u000b"}');
  // Restent littéraux : U+007F, U+2028, U+2029, « / », non-ASCII.
  assert.equal(canonicalJson({ v: "\u007f\u2028\u2029/é" }), '{"v":"\u007f\u2028\u2029/é"}');
  assert.equal(canonicalJson({ q: '"', b: "\\" }), '{"b":"\\\\","q":"\\""}');
  // Entiers : forme décimale minimale, sans exposant ni zéro de tête.
  assert.equal(canonicalJson([0, -1, 10, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]), "[0,-1,10,9007199254740991,-9007199254740991]");
  assert.equal(canonicalJson({ a: [], b: {}, c: [{}], d: null, e: true, f: false, g: "" }), '{"a":[],"b":{},"c":[{}],"d":null,"e":true,"f":false,"g":""}');
});

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = ["a", "Z", "0", " ", "é", "ß", "\u0080", "\u00f6", "\u20ac", "\ufb33", "\ud83d\ude00", "\u2028", "\u007f", "\n", "\u0001", '"', "\\", "/", "\r", "1"];

function randomString(rand) {
  let out = "";
  const length = Math.floor(rand() * 6);
  for (let i = 0; i < length; i += 1) out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return out;
}

function randomValue(rand, depth) {
  const pick = rand();
  if (depth >= 4 || pick < 0.35) {
    const leaf = Math.floor(rand() * 5);
    if (leaf === 0) return null;
    if (leaf === 1) return rand() < 0.5;
    if (leaf === 2) return Math.floor((rand() - 0.5) * 2 * Number.MAX_SAFE_INTEGER) || 0;
    return randomString(rand);
  }
  if (pick < 0.65) return Array.from({ length: Math.floor(rand() * 4) }, () => randomValue(rand, depth + 1));
  const object = {};
  for (let i = Math.floor(rand() * 5); i > 0; i -= 1) object[randomString(rand)] = randomValue(rand, depth + 1);
  return object;
}

function shuffledCopy(value, rand) {
  if (Array.isArray(value)) return value.map((item) => shuffledCopy(item, rand));
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(() => rand() - 0.5);
    return Object.fromEntries(entries.map(([k, v]) => [k, shuffledCopy(v, rand)]));
  }
  return value;
}

function utf16Less(a, b) {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) return a.charCodeAt(i) < b.charCodeAt(i);
  }
  return a.length < b.length;
}

/**
 * Oracle indépendant de jcs.js pour le domaine admis : tri par comparateur UTF-16 explicite
 * (et non par Array.prototype.sort par défaut), chaînes et entiers via JSON.stringify.
 */
function referenceCanonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(referenceCanonical).join(",")}]`;
  const keys = Object.keys(value).sort((a, b) => (utf16Less(a, b) ? -1 : utf16Less(b, a) ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${referenceCanonical(value[k])}`).join(",")}}`;
}

test("JCS (jcs.js) : propriétés sur 2 000 valeurs aléatoires du domaine admis (graine fixe)", () => {
  const rand = mulberry32(0x5eed1098);
  for (let i = 0; i < 2000; i += 1) {
    const value = randomValue(rand, 0);
    const canonical = canonicalJson(value);
    const parsed = JSON.parse(canonical);
    assert.deepEqual(parsed, value, "aller-retour");
    assert.equal(canonicalJson(parsed), canonical, "idempotence");
    assert.equal(canonicalJson(shuffledCopy(value, rand)), canonical, "indépendance de l'ordre d'insertion");
    assert.equal(/[\u0000-\u001f]/.test(canonical), false, "aucun caractère de contrôle brut");
    assert.equal(/^\s|\s$|[,:]\s/.test(canonical.replace(/"(?:[^"\\]|\\.)*"/g, '""')), false, "aucun espace hors chaînes");
    assert.equal(canonical, referenceCanonical(value), "oracle indépendant (tri UTF-16 explicite)");
  }
});

test("bornes : profondeur et taille du JSON canonique, lot réaliste de 300 scans", () => {
  let nested = 1;
  for (let i = 0; i < MAX_CANONICAL_DEPTH; i += 1) nested = [nested];
  assert.equal(canonicalJson(nested).length, MAX_CANONICAL_DEPTH * 2 + 1, "profondeur maximale acceptée");
  assert.throws(() => canonicalJson([nested]), (error) => error.code === OFFLINE_PROOF_ERROR.VALUE_INVALID, "profondeur + 1 refusée");

  const base = vectors.testSyncBodyWithoutDigest;
  const scans = Array.from({ length: 300 }, (_, index) => ({
    ...base.scans[0],
    scanId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  }));
  const manual = Array.from({ length: 300 }, (_, index) => ({
    studentId: `00000000-0000-4000-9000-${String(index).padStart(12, "0")}`,
    status: "absent",
  }));
  const large = { ...base, scans, manual };
  const started = process.hrtime.bigint();
  const digest = computePayloadDigest(large);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(computePayloadDigest(structuredClone(large)), digest);
  assert.ok(Buffer.byteLength(canonicalJson(large)) < MAX_CANONICAL_BYTES);
  assert.ok(elapsedMs < 1000, `digest d'un lot de 300 scans : ${elapsedMs} ms`);

  const atLimit = { v: "a".repeat(MAX_CANONICAL_BYTES - '{"v":""}'.length) };
  assert.equal(Buffer.byteLength(canonicalJson(atLimit)), MAX_CANONICAL_BYTES, "exactement 256 Kio acceptés");
  assert.throws(() => canonicalJson({ v: `${atLimit.v}a` }), (error) => error.code === OFFLINE_PROOF_ERROR.VALUE_INVALID, "256 Kio + 1 octet refusés");
  // Plafond mesuré en octets UTF-8, pas en unités UTF-16.
  assert.throws(() => canonicalJson({ v: "é".repeat(MAX_CANONICAL_BYTES / 2) }), (error) => error.code === OFFLINE_PROOF_ERROR.VALUE_INVALID);
});
