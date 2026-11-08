/**
 * NFC-PRES-LOCAL-PR2 — primitives cryptographiques Mobile et parité avec le Backend (exécution Node).
 *   npx --yes tsx --test src/offline/rollCall/crypto/rollCallCrypto.test.ts
 *
 * Ces tests Node NE SATISFONT PAS seuls le gate S13 : la même suite (`runRollCallParitySuite`) doit
 * aussi passer sous Hermes Android (scripts/run-rc-offline-hermes-parity.js).
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ACCOUNT_ID_LENGTH, deriveAccountId, resolveRollCallAccount } from "../accountPartition";
import { canonicalize, canonicalContractJson, utf8 as utf8Encode } from "../jcs";
import { base64StdDecode, base64urlDecode, base64urlEncode, bytesToHex, constantTimeEqual, hexToBytes } from "./bytes";
import { runRollCallParitySuite } from "./parity";
import {
  canonicalJson,
  computePayloadDigest,
  computeProof,
  deriveCardKeyFromSecret,
  digestsEqual,
  lp,
  packSigningMessage,
  verifyEd25519,
} from "./primitives";

const ROOT = path.resolve(__dirname, "../../../../..");
const vectors = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/audits/NFC-PRES-LOCAL-PR0-vectors.json"), "utf8"));
const pr2Vectors = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/audits/NFC-PRES-LOCAL-PR2-vectors.json"), "utf8"));
// Oracle Backend exécuté dans le même processus Node (référence unique PR0 révision 5).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const backend = require(path.join(ROOT, "backend/lib/rollCallOfflineProof.js"));

test("S13 (Node) : suite de parité complète sur les vecteurs partagés", () => {
  const report = runRollCallParitySuite(vectors, pr2Vectors);
  assert.deepEqual(report.failed, [], JSON.stringify(report.cases.filter((c) => !c.ok)));
  assert.equal(report.total, 27);
  assert.equal(report.passed, 27);
  assert.match(report.engine, /^node-/);
});

test("vecteurs PR2 reproduits par le Backend (aucune valeur saisie à la main)", () => {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const out = execFileSync(process.execPath, [path.join(ROOT, "Mobile/scripts/generate-rc-offline-pr2-vectors.js"), "--check"], { encoding: "utf8" });
  assert.match(out, /reproduit par le Backend/);
});

test("UTF-8 strict : identique au Backend, surrogates isolés refusés, aucune normalisation", () => {
  const samples = ["", "a", "é", "é", "\u{1F600}", "  ", "\u0000\u001f\u007f", "Kabasélé", "ﬁ", "𝄞x"];
  for (const sample of samples) {
    assert.equal(bytesToHex(utf8Encode(sample)), Buffer.from(sample, "utf8").toString("hex"));
  }
  assert.notEqual(bytesToHex(utf8Encode("é")), bytesToHex(utf8Encode("é")));
  for (const bad of ["\ud800", "\udc00", "a\ud800b", "\udc00\ud800"]) {
    assert.throws(() => utf8Encode(bad));
    assert.throws(() => lp([bad]));
    assert.throws(() => backend.lp([bad]));
  }
});

test("base64url strict : canonique, sans remplissage, alphabet URL seul", () => {
  for (let length = 0; length < 70; length += 1) {
    const bytes = new Uint8Array(crypto.randomBytes(length));
    const encoded = base64urlEncode(bytes);
    assert.equal(encoded, Buffer.from(bytes).toString("base64url"));
    assert.deepEqual([...base64urlDecode(encoded)], [...bytes]);
  }
  assert.throws(() => base64urlDecode("AB=="));
  assert.throws(() => base64urlDecode("AB+/"));
  assert.throws(() => base64urlDecode("A"));
  // Bits de remplissage non nuls : même octets que "AA", forme refusée.
  assert.throws(() => base64urlDecode("AB"));
  assert.deepEqual([...base64StdDecode(Buffer.from("SQLite format 3\0").toString("base64"))], [...Buffer.from("SQLite format 3\0")]);
  assert.deepEqual([...hexToBytes("00ff")], [0, 255]);
  assert.throws(() => hexToBytes("0F"));
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
});

function randomString(rng: () => number): string {
  const pool = ["a", "Z", "é", "é", '"', "\\", "\n", "\t", "\u0001", "\u001f", "\u007f", " ", "/", "\u{1F600}", "ﬁ", " ", "0"];
  let out = "";
  const length = Math.floor(rng() * 6);
  for (let i = 0; i < length; i += 1) out += pool[Math.floor(rng() * pool.length)];
  return out;
}

function randomValue(rng: () => number, depth: number): unknown {
  const kind = Math.floor(rng() * (depth > 3 ? 4 : 6));
  if (kind === 0) return null;
  if (kind === 1) return rng() < 0.5;
  if (kind === 2) return [0, -1, 1, 300, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER][Math.floor(rng() * 6)];
  if (kind === 3) return randomString(rng);
  if (kind === 4) return Array.from({ length: Math.floor(rng() * 4) }, () => randomValue(rng, depth + 1));
  const object: Record<string, unknown> = {};
  for (let i = 0; i < Math.floor(rng() * 4); i += 1) object[randomString(rng) || "k"] = randomValue(rng, depth + 1);
  return object;
}

test("JCS : parité octet par octet avec backend jcs.js sur 3 000 valeurs aléatoires du domaine", () => {
  let seed = 0x5eed;
  const rng = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 2 ** 32;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const backendJcs = require(path.join(ROOT, "backend/contracts/reportCard/jcs.js"));
  for (let i = 0; i < 3000; i += 1) {
    const value = { v: randomValue(rng, 0) };
    assert.equal(canonicalJson(value), backend.canonicalJson(value), `cas ${i}`);
    assert.equal(canonicalize(value), backendJcs.canonicalize(value), `canonicalize ${i}`);
  }
  // Vecteurs J-1 à J-7 : jcs.ts publié = jcs.js = oracle du contrat.
  for (const id of ["J-1", "J-2", "J-3", "J-4", "J-5", "J-6", "J-7"]) {
    const vector = vectors.jcs[id];
    assert.equal(canonicalize(vector.input), backendJcs.canonicalize(vector.input), id);
    assert.equal(canonicalize(vector.input), vector.canonical, id);
    assert.equal(canonicalContractJson(vector.input).text, vector.canonical, id);
  }
});

test("JCS : refus identiques au Backend hors domaine", () => {
  const sparse = [1, , 3]; // eslint-disable-line no-sparse-arrays
  class NotPlain {
    a = 1;
  }
  const deep: Record<string, unknown> = {};
  let cursor = deep;
  for (let i = 0; i < 40; i += 1) {
    cursor.x = {};
    cursor = cursor.x as Record<string, unknown>;
  }
  const refused = [
    { v: -0 },
    { v: 0.5 },
    { v: Number.NaN },
    { v: Infinity },
    { v: 2 ** 53 },
    { v: undefined },
    { v: BigInt(1) },
    { v: new Date(0) },
    { v: sparse },
    { v: new NotPlain() },
    { v: { toJSON: () => 1 } },
    { "\ud800": 1 },
    { v: "\udfff" },
    deep,
    { v: "x".repeat(256 * 1024) },
  ];
  for (const value of refused) {
    assert.throws(() => canonicalJson(value));
    assert.throws(() => backend.canonicalJson(value));
  }
});

test("preuves, digest et message de pack : mêmes octets que le Backend sur des entrées aléatoires", () => {
  for (let i = 0; i < 50; i += 1) {
    const uuid = () => crypto.randomUUID();
    const secret = crypto.randomBytes(32).toString("base64url");
    const input = {
      contractVersion: "rc-offline-1",
      schoolId: uuid(),
      actorUserId: uuid(),
      classId: uuid(),
      date: "2026-11-09",
      mode: "teacher",
      sessionId: uuid(),
      packId: i % 5 === 0 ? "" : uuid(),
      scanId: uuid(),
      publicId: crypto.randomBytes(16).toString("base64url").slice(0, 22),
      medium: i % 2 ? "nfc" : "qr",
    };
    const key = deriveCardKeyFromSecret(secret);
    assert.equal(bytesToHex(key), backend.deriveCardKeyFromSecret(secret).toString("hex"));
    assert.equal(computeProof(key, input), backend.computeProof(Buffer.from(key), input));
    const body = { ...vectors.testSyncBodyWithoutDigest, operationId: uuid(), revision: i + 1 };
    assert.equal(computePayloadDigest(body), backend.computePayloadDigest(body));
    const pack = { ...vectors.testPack, packId: uuid() };
    assert.equal(bytesToHex(packSigningMessage(pack)), backend.packSigningMessage(pack).toString("hex"));
  }
  assert.throws(() => deriveCardKeyFromSecret("trop-court"));
  assert.equal(digestsEqual(vectors.expected["V-4_proof_nfc"], vectors.expected["V-4_proof_nfc"]), true);
  assert.equal(digestsEqual(vectors.expected["V-4_proof_nfc"], vectors.expected["V-5_proof_qr"]), false);
  assert.equal(digestsEqual("x", "x"), false);
});

test("Ed25519 strict : signatures du Backend acceptées, altérations et encodages non canoniques refusés", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64url");
  const message = packSigningMessage(vectors.testPack);
  const signature = crypto.sign(null, Buffer.from(message), privateKey).toString("base64url");
  assert.equal(verifyEd25519(signature, message, pub), true);
  const tampered = Buffer.from(signature, "base64url");
  tampered[10] ^= 1;
  assert.equal(verifyEd25519(tampered.toString("base64url"), message, pub), false);
  // S non canonique (S + L) : accepté par ZIP-215 laxiste, refusé ici comme par OpenSSL.
  const raw = Buffer.from(signature, "base64url");
  const L = (1n << 252n) + 27742317777372353535851937790883648493n;
  let s = 0n;
  for (let i = 31; i >= 0; i -= 1) s = (s << 8n) | BigInt(raw[32 + i]);
  const sPlusL = s + L;
  if (sPlusL < 1n << 256n) {
    const forged = Buffer.from(raw);
    let value = sPlusL;
    for (let i = 0; i < 32; i += 1) {
      forged[32 + i] = Number(value & 0xffn);
      value >>= 8n;
    }
    assert.equal(crypto.verify(null, Buffer.from(message), publicKey, forged), false);
    assert.equal(verifyEd25519(forged.toString("base64url"), message, pub), false);
  }
  assert.equal(verifyEd25519("court", message, pub), false);
  assert.equal(verifyEd25519(signature, message, "court"), false);
  assert.equal(verifyEd25519(signature, message, vectors.expected["V-9_ed25519_test_pub_raw"]), false);
});

test("accountId (cas reportés de test-rollcall-account.mjs) : HMAC du sel sur LP, 23 caractères, aucune donnée en clair", () => {
  const salt = new Uint8Array(32).fill(7);
  const account = { environmentId: "preproduction-8ac37e1c", userId: crypto.randomUUID(), schoolId: crypto.randomUUID() };
  const resolved = resolveRollCallAccount(account, salt);
  assert.deepEqual(resolveRollCallAccount(account, salt), resolved, "déterministe");
  const expected = crypto
    .createHmac("sha256", Buffer.from(salt))
    .update(backend.lp(["somafrik.rc-offline.account.v1", account.environmentId, account.userId, account.schoolId]))
    .digest("base64url")
    .slice(0, 23);
  assert.equal(resolved.accountId, expected, "oracle Node (HMAC node:crypto)");
  assert.equal(ACCOUNT_ID_LENGTH, 23);
  assert.match(resolved.accountId, /^[A-Za-z0-9_-]{23}$/);
  assert.match(resolved.fileName, /^somafrik-rollcall-v1-preproduction-8ac37e1c-[A-Za-z0-9_-]{23}\.db$/);
  assert.equal(resolved.keyName, `somafrik.rollCallDbKeyV1.preproduction-8ac37e1c.${resolved.accountId}`);
  for (const id of [account.userId, account.schoolId]) {
    assert.equal(resolved.fileName.includes(id) || resolved.keyName.includes(id), false);
    assert.equal(resolved.fileName.includes(id.slice(0, 8)), false);
  }
  assert.notEqual(deriveAccountId(salt, { ...account, userId: crypto.randomUUID() }), resolved.accountId, "autre utilisateur");
  assert.notEqual(deriveAccountId(salt, { ...account, schoolId: crypto.randomUUID() }), resolved.accountId, "autre établissement");
  assert.notEqual(deriveAccountId(salt, { ...account, environmentId: "production-8ac37e1c" }), resolved.accountId, "autre environnement");
  assert.notEqual(deriveAccountId(new Uint8Array(32).fill(8), account), resolved.accountId, "sel renouvelé");
  assert.throws(() => deriveAccountId(new Uint8Array(31), account), /RC_ACCOUNT_SCOPE_INVALID/);
  assert.throws(() => deriveAccountId(salt, { ...account, environmentId: "preprod/../prod" }), /RC_ACCOUNT_SCOPE_INVALID/);
  assert.throws(() => deriveAccountId(salt, { ...account, userId: "user-1" }), /RC_ACCOUNT_SCOPE_INVALID/);
  assert.throws(() => deriveAccountId(salt, { ...account, schoolId: "" }), /RC_ACCOUNT_SCOPE_INVALID/);
  assert.equal(base64urlEncode(new Uint8Array([255, 255, 255, 254])), "_____g");
});

test("LP (cas reportés de test-rollcall-jcs.mjs) : vecteurs V-6/V-7 et parité Backend", () => {
  const hex = (bytes: Uint8Array) => bytesToHex(bytes);
  assert.equal(hex(lp(["a|b", "c"])), vectors.expected["V-6_lp_a|b,c"]);
  assert.equal(hex(lp(["a", "b|c"])), vectors.expected["V-6_lp_a,b|c"]);
  assert.equal(hex(lp(["ab", "", "c"])), vectors.expected["V-7_lp_ab,empty,c"]);
  for (const fields of [["é"], ["\u{1F600}", ""], ["somafrik.rc-offline.proof.v1", "x".repeat(300)]]) {
    assert.equal(hex(lp(fields)), backend.lp(fields).toString("hex"));
  }
  assert.throws(() => lp([]));
});

test("sources Mobile : aucune dépendance Node (Buffer, node:crypto) ni normalisation Unicode", () => {
  const dir = path.join(ROOT, "Mobile/src/offline/rollCall");
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$|\.testutil\.ts$/.test(entry.name)) files.push(full);
    }
  };
  walk(dir);
  assert.ok(files.length >= 10);
  for (const file of [...files, path.join(dir, "jcs.ts"), path.join(dir, "accountPartition.ts")]) {
    const source = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(source, /\bBuffer\b/, file);
    assert.doesNotMatch(source, /node:|require\(["']crypto["']\)|from ["']crypto["']/, file);
    assert.doesNotMatch(source, /\.normalize\(/, file);
    assert.doesNotMatch(source, /TextEncoder|TextDecoder/, file);
    assert.doesNotMatch(source, /console\.(log|info|warn|error)/, file);
  }
});

test("dépendances cryptographiques figées et auditées", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "Mobile/package.json"), "utf8"));
  assert.equal(pkg.dependencies["@noble/hashes"], "2.0.1");
  assert.equal(pkg.dependencies["@noble/curves"], "2.0.1");
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "Mobile/package-lock.json"), "utf8"));
  assert.equal(lock.packages["node_modules/@noble/hashes"].version, "2.0.1");
  assert.equal(lock.packages["node_modules/@noble/curves"].version, "2.0.1");
  assert.deepEqual(lock.packages["node_modules/@noble/curves"].dependencies, { "@noble/hashes": "2.0.1" });
  assert.equal(lock.packages["node_modules/@noble/hashes"].license, "MIT");
  assert.equal(lock.packages["node_modules/@noble/curves"].license, "MIT");
});
