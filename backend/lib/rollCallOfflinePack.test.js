"use strict";

/**
 * NFC-PRES-LOCAL-PR1b — fenêtre temporelle, éligibilité des cartes et construction du pack.
 * Fonctions pures uniquement ; les autorisations et lectures PostgreSQL sont couvertes par
 * rollCallOfflinePack.http.pg.test.js.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  OFFLINE_PACK_ERROR,
  readPackQuery,
  canonicalTimeZone,
  wallTime,
  computePackWindow,
  assertIssuanceWindow,
  isoSeconds,
  isCardEligible,
  deriveMatchKeySecret,
  computeMatchKey,
  buildPack,
} = require("./rollCallOfflinePack");
const { computeCardRef, computeVerifier, cardKeyFromTokenHash, canonicalJson } = require("./rollCallOfflineProof");

const at = (iso) => Date.parse(iso);
const iso = (window) => Object.fromEntries(Object.entries(window).map(([k, v]) => [k, isoSeconds(v)]));

test("fenêtres du contrat §4.5 : Kinshasa, Lubumbashi, Paris (heure d'été et d'hiver)", () => {
  const cases = [
    ["Africa/Kinshasa", "2026-11-09", { issueFrom: "2026-11-08T11:00:00Z", notBefore: "2026-11-08T23:00:00Z", expiresAt: "2026-11-09T23:00:00Z", syncDeadline: "2026-11-12T23:00:00Z" }, 24, 36],
    ["Africa/Lubumbashi", "2026-11-09", { issueFrom: "2026-11-08T10:00:00Z", notBefore: "2026-11-08T22:00:00Z", expiresAt: "2026-11-09T22:00:00Z", syncDeadline: "2026-11-12T22:00:00Z" }, 24, 36],
    ["Europe/Paris", "2026-03-29", { issueFrom: "2026-03-28T11:00:00Z", notBefore: "2026-03-28T23:00:00Z", expiresAt: "2026-03-29T22:00:00Z", syncDeadline: "2026-04-01T22:00:00Z" }, 23, 35],
    ["Europe/Paris", "2026-10-25", { issueFrom: "2026-10-24T10:00:00Z", notBefore: "2026-10-24T22:00:00Z", expiresAt: "2026-10-25T23:00:00Z", syncDeadline: "2026-10-28T23:00:00Z" }, 25, 37],
  ];
  for (const [tz, date, expected, useHours, holdHours] of cases) {
    const window = computePackWindow(tz, date);
    assert.deepEqual(iso(window), expected, `${tz} ${date}`);
    assert.equal((window.expiresAt - window.notBefore) / 3600e3, useHours, `${tz} durée d'utilisation`);
    assert.equal((window.expiresAt - window.issueFrom) / 3600e3, holdHours, `${tz} détention maximale`);
    // Les bornes sont des heures murales exactes dans le fuseau.
    assert.equal(wallTime(tz, window.notBefore), `${date}T00:00:00`);
    assert.equal(wallTime(tz, window.issueFrom).slice(11), "12:00:00");
  }
});

test("minuit inexistant (America/Santiago, 2026-09-06) : début au premier instant du jour local", () => {
  const window = computePackWindow("America/Santiago", "2026-09-06");
  assert.equal(isoSeconds(window.notBefore), "2026-09-06T04:00:00Z");
  assert.equal(wallTime("America/Santiago", window.notBefore), "2026-09-06T01:00:00");
  assert.equal(wallTime("America/Santiago", window.notBefore - 1000), "2026-09-05T23:59:59");
});

test("émission : bornes inclusives et exclusives à la seconde", () => {
  const window = computePackWindow("Africa/Kinshasa", "2026-11-09");
  const refused = (ms) => assert.throws(() => assertIssuanceWindow(window, ms), (error) => error.statusCode === 409 && error.code === OFFLINE_PACK_ERROR.DATE_OUT_OF_RANGE);
  refused(at("2026-11-08T10:59:59Z")); // D−1 11:59:59 locale
  assertIssuanceWindow(window, at("2026-11-08T11:00:00Z")); // D−1 12:00:00 locale, incluse
  assertIssuanceWindow(window, at("2026-11-08T16:02:00Z")); // veille 17:02 (cas du contrat)
  assertIssuanceWindow(window, at("2026-11-09T14:00:00Z")); // jour même 15:00
  assertIssuanceWindow(window, at("2026-11-09T22:59:59Z")); // D 23:59:59, incluse
  refused(at("2026-11-09T23:00:00Z")); // D+1 00:00:00, exclue
  refused(at("2026-11-07T12:00:00Z")); // deux jours avant
  // Heure d'hiver à Paris : la journée D de 25 h reste entièrement couverte.
  const paris = computePackWindow("Europe/Paris", "2026-10-25");
  assertIssuanceWindow(paris, at("2026-10-25T22:59:59Z"));
  assert.throws(() => assertIssuanceWindow(paris, at("2026-10-25T23:00:00Z")));
});

test("lecture stricte de la requête et du fuseau", () => {
  const classId = "00000000-0000-4000-8000-000000000003";
  assert.deepEqual(readPackQuery({ classId, date: "2026-11-09" }), { classId, date: "2026-11-09" });
  for (const query of [
    {}, { classId, date: "2026-02-30" }, { classId, date: "2026-11-9" }, { classId, date: ["2026-11-09"] },
    { classId: "0000000a-0000-4000-8000-00000000000b".toUpperCase(), date: "2026-11-09" }, { classId: `${classId} `, date: "2026-11-09" }, { classId: "x", date: "2026-11-09" },
  ]) {
    assert.throws(() => readPackQuery(query), (error) => error.statusCode === 400 && error.code === OFFLINE_PACK_ERROR.INPUT_INVALID, JSON.stringify(query));
  }
  assert.equal(canonicalTimeZone(""), "Africa/Kinshasa");
  assert.equal(canonicalTimeZone("Europe/Paris"), "Europe/Paris");
  assert.throws(() => canonicalTimeZone("Mars/Olympus"), (error) => error.statusCode === 503 && error.code === OFFLINE_PACK_ERROR.TIMEZONE_INVALID);
});

test("éligibilité : carte active, encodée pour le NFC, support activé uniquement", () => {
  const both = { nfc: true, qr: true };
  const nfcOnly = { nfc: true, qr: false };
  const qrOnly = { nfc: false, qr: true };
  const card = (over) => ({ status: "active", medium: "nfc_qr", nfc_encoding_state: "encoded", ...over });
  assert.equal(isCardEligible(card(), both), true);
  assert.equal(isCardEligible(card({ nfc_encoding_state: "locked" }), nfcOnly), true);
  for (const status of ["issued", "lost", "revoked", "replaced"]) assert.equal(isCardEligible(card({ status }), both), false, status);
  assert.equal(isCardEligible(card({ nfc_encoding_state: "pending" }), both), false, "encodage en attente");
  assert.equal(isCardEligible(card({ nfc_encoding_state: null }), nfcOnly), false, "NFC non encodée");
  assert.equal(isCardEligible(card({ nfc_encoding_state: null }), qrOnly), true, "nfc_qr non encodée, QR activé");
  assert.equal(isCardEligible(card({ medium: "nfc" }), qrOnly), false, "NFC seule, QR seul activé");
  assert.equal(isCardEligible(card({ medium: "qr", nfc_encoding_state: null }), nfcOnly), false, "QR seule, NFC seul activé");
  assert.equal(isCardEligible(card({ medium: "qr", nfc_encoding_state: null }), qrOnly), true);
  assert.equal(isCardEligible(card(), { nfc: false, qr: false }), false);
  assert.equal(isCardEligible(null, both), false);
});

const SCHOOL = "00000000-0000-4000-8000-000000000001";
const ACTOR = "00000000-0000-4000-8000-000000000002";
const CLASS = "00000000-0000-4000-8000-000000000003";
const PACK = "00000000-0000-4000-8000-000000000005";
const student = (n, extra = {}) => ({ studentId: `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`, studentCode: `S-${n}`, firstName: `F${n}`, lastName: `L${n}`, existingStatus: null, ...extra });
const tokenHash = (n) => crypto.createHash("sha256").update(`test-only-secret-${n}`).digest("hex");
const publicId = (n) => `TESTPUBLICID${String(n).padStart(10, "0")}`;

function sample(overrides = {}) {
  return buildPack({
    packId: PACK,
    keyId: "rc-pack-test-1",
    schoolId: SCHOOL,
    actorUserId: ACTOR,
    classId: CLASS,
    date: "2026-11-09",
    timeZone: "Africa/Kinshasa",
    window: computePackWindow("Africa/Kinshasa", "2026-11-09"),
    nowMs: at("2026-11-08T16:02:00.789Z"),
    students: [student(3), student(1, { existingStatus: "excused" }), student(2, { existingStatus: "bogus" }), student(1)],
    cards: [
      { studentId: student(1).studentId, publicId: publicId(1), tokenHash: tokenHash(1) },
      { studentId: student(1).studentId, publicId: publicId(11), tokenHash: tokenHash(11) },
      { studentId: student(2).studentId, publicId: publicId(2), tokenHash: tokenHash(2) },
      { studentId: student(9).studentId, publicId: publicId(9), tokenHash: tokenHash(9) },
    ],
    matchSecret: deriveMatchKeySecret("ci-test-secret-with-enough-length-for-production-checks"),
    ...overrides,
  });
}

test("pack : structure du contrat, tri déterministe, élèves uniques, plusieurs cartes par élève", () => {
  const pack = sample();
  assert.deepEqual(Object.keys(pack), [
    "contractVersion", "packVersion", "keyId", "packId", "schoolId", "actorUserId", "mode", "classId", "date", "timeZone",
    "issuedAt", "notBefore", "expiresAt", "syncDeadline", "students", "cards",
  ]);
  assert.equal(pack.contractVersion, "rc-offline-1");
  assert.equal(pack.packVersion, 1);
  assert.equal(pack.mode, "teacher");
  assert.equal(pack.issuedAt, "2026-11-08T16:02:00Z", "à la seconde");
  assert.equal(pack.notBefore, "2026-11-08T23:00:00Z");
  assert.equal(pack.expiresAt, "2026-11-09T23:00:00Z");
  assert.equal(pack.syncDeadline, "2026-11-12T23:00:00Z");
  assert.equal(pack.students.length, 3, "élève en double dédupliqué");
  assert.deepEqual(pack.students.map((s) => s.matchKey), [...pack.students.map((s) => s.matchKey)].sort());
  assert.deepEqual(pack.cards.map((c) => c.cardRef), [...pack.cards.map((c) => c.cardRef)].sort());
  assert.equal(pack.cards.length, 3, "carte d'un élève hors liste exclue");
  const s1 = pack.students.find((s) => s.studentId === student(1).studentId);
  assert.equal(pack.cards.filter((c) => c.matchKey === s1.matchKey).length, 2, "deux cartes pour le même élève");
  assert.equal(s1.existingStatus, "excused");
  assert.equal(pack.students.find((s) => s.studentId === student(2).studentId).existingStatus, null, "statut inconnu neutralisé");
  for (const card of pack.cards) assert.deepEqual(Object.keys(card), ["cardRef", "matchKey", "verifier"]);
  for (const entry of pack.students) assert.deepEqual(Object.keys(entry), ["matchKey", "studentId", "studentCode", "firstName", "lastName", "existingStatus"]);
  // Valeurs cryptographiques issues des primitives de référence.
  const scope = { schoolId: SCHOOL, classId: CLASS, packId: PACK, publicId: publicId(2) };
  const card2 = pack.cards.find((c) => c.cardRef === computeCardRef(scope));
  assert.equal(card2.verifier, computeVerifier(cardKeyFromTokenHash(tokenHash(2)), scope));
  // Déterminisme : même entrée, même pack, même JSON canonique ; ordre des entrées indifférent.
  assert.equal(canonicalJson(sample()), canonicalJson(pack));
  assert.equal(canonicalJson(sample({ students: [student(1), student(2), student(3)], cards: [...sample.cardsReversed()] })), canonicalJson({ ...pack, students: pack.students.map((s) => (s.studentId === student(1).studentId ? { ...s, existingStatus: null } : s)) }));
});
sample.cardsReversed = () => [
  { studentId: student(2).studentId, publicId: publicId(2), tokenHash: tokenHash(2) },
  { studentId: student(1).studentId, publicId: publicId(11), tokenHash: tokenHash(11) },
  { studentId: student(1).studentId, publicId: publicId(1), tokenHash: tokenHash(1) },
];

test("pack : aucun publicId, token_hash, secret ni UID ; matchKey non corrélable entre packs", () => {
  const pack = sample();
  const rendered = JSON.stringify(pack);
  for (const n of [1, 2, 11, 9]) {
    assert.equal(rendered.includes(publicId(n)), false, `publicId ${n}`);
    assert.equal(rendered.includes(tokenHash(n)), false, `token_hash ${n}`);
  }
  assert.equal(/token|secret|publicId|uid|nfc/i.test(Object.keys(pack).concat(...pack.cards.map(Object.keys)).join(",")), false);
  const other = sample({ packId: "00000000-0000-4000-8000-0000000000aa" });
  const keys = new Set(pack.students.map((s) => s.matchKey));
  assert.equal(other.students.some((s) => keys.has(s.matchKey)), false, "matchKey différent d'un pack à l'autre");
  const refs = new Set(pack.cards.map((c) => c.cardRef));
  assert.equal(other.cards.some((c) => refs.has(c.cardRef)), false, "cardRef différent d'un pack à l'autre");
  assert.equal(computeMatchKey(deriveMatchKeySecret("a".repeat(32)), PACK, student(1).studentId).length, 43);
  assert.throws(() => deriveMatchKeySecret("court"));
});

test("pack : classe sans carte et classe vide", () => {
  const noCards = sample({ cards: [] });
  assert.equal(noCards.students.length, 3);
  assert.deepEqual(noCards.cards, []);
  const empty = sample({ students: [], cards: [] });
  assert.deepEqual([empty.students, empty.cards], [[], []]);
  canonicalJson(empty);
});
