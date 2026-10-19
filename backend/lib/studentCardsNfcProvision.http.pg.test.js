"use strict";

/**
 * CARTE-FIX-QR-NFC — provisionnement NFC de la carte active existante et relecture.
 * HTTP de production + PostgreSQL local jetable (fixture NFC), identités synthétiques.
 * Une carte logique active par élève : l'ajout du NFC ne crée ni ne révoque aucune carte.
 */
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createIntegrationFixture } = require("./studentCardsNfcIntegration.fixture");

let fixture;
before(async () => {
  fixture = await createIntegrationFixture();
});
after(async () => {
  if (!fixture) return;
  for (const pool of [fixture.pool, fixture.repo?.pool]) pool?.on?.("error", () => {});
  await fixture.close();
});

let uidSequence = 0;
function nextUid() {
  uidSequence += 1;
  return `04${String(uidSequence).padStart(12, "0")}`.slice(0, 14).toUpperCase();
}

const post = (path, body, token) => fixture.request(path, { method: "POST", body: JSON.stringify(body) }, token);

async function qrCard(school) {
  const { students } = await fixture.cohort(1, school);
  const issued = await post("/student-cards", { studentId: students[0], medium: "qr" }, school.token);
  assert.equal(issued.status, 201, JSON.stringify(issued.data));
  return { studentId: students[0], card: issued.data };
}

async function begin(cardId, cardToken, uid, token, extra = {}) {
  return post(`/student-cards/${cardId}/nfc-provision`, {
    cardToken, nfc: { uid, tagType: "NTAG213" }, operationId: extra.operationId ?? randomUUID(), ...extra,
  }, token);
}

async function confirm(cardId, cardToken, uid, started, token, extra = {}) {
  return post(`/student-cards/${cardId}/nfc-provision/confirm`, {
    cardToken, nfc: { uid, tagType: "NTAG213" }, operationId: started.operationId, challenge: started.challenge, ...extra,
  }, token);
}

async function provision(cardId, cardToken, uid, token) {
  const operationId = randomUUID();
  const started = await begin(cardId, cardToken, uid, token, { operationId });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  return { started: { ...started.data, operationId }, done: await confirm(cardId, cardToken, uid, { ...started.data, operationId }, token) };
}

async function rows(studentId) {
  return (await fixture.pool.query(
    "SELECT id, public_id, status, medium, nfc_uid, nfc_encoding_state FROM student_access_cards WHERE student_id = $1 ORDER BY created_at",
    [studentId],
  )).rows;
}

async function audits(cardId, action) {
  return (await fixture.pool.query(
    "SELECT new_value FROM audit_logs WHERE entity_id = $1 AND action = $2",
    [String(cardId), action],
  )).rows;
}

test("QR-01 / QR-02 — relecture : carte active reconnue et rattachée à la fiche, carte révoquée refusée", async () => {
  const school = fixture.schools[0];
  const { card } = await qrCard(school);
  const same = await post("/student-cards/verify", { cardToken: card.cardToken, cardId: card.id }, school.token);
  assert.equal(same.status, 200);
  assert.equal(same.data.card.valid, true);
  assert.equal(same.data.matchesCard, true, "la carte lue est celle de la fiche");
  const other = await post("/student-cards/verify", { cardToken: card.cardToken, cardId: randomUUID() }, school.token);
  assert.equal(other.data.matchesCard, false);
  assert.equal(JSON.stringify(same.data).includes(card.cardToken.split(".")[1]), false, "aucun secret renvoyé");
  const before = await rows(card.id ? (await fixture.pool.query("SELECT student_id FROM student_access_cards WHERE id=$1", [card.id])).rows[0].student_id : null);
  assert.equal(before.length, 1, "la relecture ne crée aucune carte");

  assert.equal((await post(`/student-cards/${card.id}/revoke`, { reason: "test" }, school.token)).status, 200);
  const revoked = await post("/student-cards/verify", { cardToken: card.cardToken, cardId: card.id }, school.token);
  assert.deepEqual(revoked.data, { card: { valid: false }, scope: "none" });
});

test("QR-03 / QR-04 — non habilité : 403 ; autre établissement : refus sans donnée", async () => {
  const school = fixture.schools[0];
  const { card } = await qrCard(school);
  const uid = nextUid();
  // Enseignant (Élèves:READ seulement) : jamais de provisionnement.
  const teacher = await begin(card.id, card.cardToken, uid, fixture.extraTokens.teacher);
  assert.equal(teacher.status, 403);
  for (const key of ["super", "country"]) {
    assert.equal((await begin(card.id, card.cardToken, uid, fixture.extraTokens[key])).status, 403, key);
  }
  // Admin d'un autre établissement : carte introuvable, relecture invalide.
  const foreign = fixture.schools[1];
  assert.equal((await begin(card.id, card.cardToken, uid, foreign.token)).status, 404);
  const verify = await post("/student-cards/verify", { cardToken: card.cardToken, cardId: card.id }, foreign.token);
  assert.deepEqual(verify.data, { card: { valid: false }, scope: "none" });
  assert.equal((await rows((await fixture.pool.query("SELECT student_id FROM student_access_cards WHERE id=$1", [card.id])).rows[0].student_id))[0].nfc_uid, null);
});

test("NFC-01 / NFC-03 / CARD-01 — QR actif → NFC sur la même carte, QR toujours valide, une seule carte active", async () => {
  const school = fixture.schools[0];
  const { studentId, card } = await qrCard(school);
  const uid = nextUid();
  const { started, done } = await provision(card.id, card.cardToken, uid, school.token);
  assert.match(started.challenge, /^\d{13}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.id, card.id, "même carte");
  assert.equal(done.data.publicId, card.publicId, "même identité, aucun secret renouvelé");
  assert.equal(done.data.medium, "nfc_qr");
  assert.deepEqual(done.data.supports, { qr: "issued", nfc: "encoded" });
  assert.equal(Object.hasOwn(done.data, "cardToken"), false);
  const all = await rows(studentId);
  assert.equal(all.length, 1, "aucune deuxième carte");
  assert.equal(all[0].status, "active");
  assert.equal(all[0].nfc_uid, uid);
  // Le même jeton (QR imprimé ou puce) est reconnu : relecture NFC/QR.
  const reread = await post("/student-cards/verify", { cardToken: card.cardToken, cardId: card.id }, school.token);
  assert.equal(reread.data.card.valid, true);
  assert.equal(reread.data.card.medium, "nfc_qr");
  assert.equal(reread.data.matchesCard, true);
  const logged = await audits(card.id, "student_card_nfc_provisioned");
  assert.equal(logged.length, 1);
  assert.equal(JSON.stringify(logged).includes(card.cardToken.split(".")[1]), false, "journal sans secret");
  const listed = await fixture.request(`/students/${studentId}/cards`, {}, school.token);
  assert.deepEqual(listed.data.cards[0].supports, { qr: "issued", nfc: "encoded" });
});

test("NFC-02 — réencoder la même puce : rejeu idempotent, aucun doublon ni second audit", async () => {
  const school = fixture.schools[0];
  const { studentId, card } = await qrCard(school);
  const uid = nextUid();
  const first = await provision(card.id, card.cardToken, uid, school.token);
  assert.equal(first.done.status, 200);
  const again = await begin(card.id, card.cardToken, uid, school.token);
  assert.equal(again.status, 200);
  assert.equal(again.data.alreadyProvisioned, true);
  const replay = await confirm(card.id, card.cardToken, uid, first.started, school.token);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.idempotentReplay, true);
  assert.equal((await rows(studentId)).length, 1);
  assert.equal((await audits(card.id, "student_card_nfc_provisioned")).length, 1);
  // Une autre puce sur une carte déjà encodée : refus explicite, jamais d'écrasement.
  const other = await begin(card.id, card.cardToken, nextUid(), school.token);
  assert.equal(other.status, 409);
  assert.equal(other.data.code, "STUDENT_CARD_NFC_ALREADY_PROVISIONED");
});

test("NFC-04 — puce déjà associée à un autre élève : refus, aucune association croisée", async () => {
  const school = fixture.schools[0];
  const a = await qrCard(school);
  const b = await qrCard(school);
  const uid = nextUid();
  assert.equal((await provision(a.card.id, a.card.cardToken, uid, school.token)).done.status, 200);
  const stolen = await begin(b.card.id, b.card.cardToken, uid, school.token);
  assert.equal(stolen.status, 409);
  assert.equal(stolen.data.code, "STUDENT_CARD_NFC_UID_EXISTS");
  assert.equal((await rows(b.studentId))[0].nfc_uid, null);
});

test("NFC-05 — écriture interrompue ou preuve insuffisante : aucun faux succès", async () => {
  const school = fixture.schools[0];
  const { studentId, card } = await qrCard(school);
  const uid = nextUid();
  // Identifiant public seul (secret inconnu) : jamais de provisionnement.
  const guessed = await begin(card.id, `${card.publicId}.${"A".repeat(43)}`, uid, school.token);
  assert.equal(guessed.status, 404);
  const operationId = randomUUID();
  const started = await begin(card.id, card.cardToken, uid, school.token, { operationId });
  assert.equal(started.status, 200);
  const ctx = { ...started.data, operationId };
  // Écriture interrompue : pas de confirmation, la carte reste « NFC non encodé ».
  assert.equal((await rows(studentId))[0].nfc_uid, null);
  // Relecture altérée (jeton différent) : refus.
  assert.equal((await confirm(card.id, `${card.publicId}.${"B".repeat(43)}`, uid, ctx, school.token)).status, 404);
  // Déclaration sans défi serveur, défi falsifié ou lié à une autre puce : refus.
  for (const challenge of [undefined, `${Date.now() + 60000}.${"x".repeat(43)}`]) {
    const forged = await confirm(card.id, card.cardToken, uid, { ...ctx, challenge }, school.token);
    assert.equal(forged.status, challenge === undefined ? 400 : 409, JSON.stringify(forged.data));
  }
  const otherChip = await confirm(card.id, card.cardToken, nextUid(), ctx, school.token);
  assert.equal(otherChip.status, 409);
  assert.equal(otherChip.data.code, "STUDENT_CARD_NFC_PROVISION_CHALLENGE_INVALID");
  // Défi d'une autre opération : refus.
  assert.equal((await confirm(card.id, card.cardToken, uid, { ...ctx, operationId: randomUUID() }, school.token)).status, 409);
  assert.equal((await rows(studentId))[0].nfc_uid, null, "aucune puce enregistrée sans preuve complète");
  assert.equal((await audits(card.id, "student_card_nfc_provisioned")).length, 0);
  // La preuve complète reste acceptée ensuite.
  assert.equal((await confirm(card.id, card.cardToken, uid, ctx, school.token)).status, 200);
});

test("NFC-06 — deux encodages concurrents : un seul gagnant, état cohérent", async () => {
  const school = fixture.schools[0];
  const { studentId, card } = await qrCard(school);
  const uidA = nextUid();
  const uidB = nextUid();
  const opA = randomUUID();
  const opB = randomUUID();
  const startA = await begin(card.id, card.cardToken, uidA, school.token, { operationId: opA });
  const startB = await begin(card.id, card.cardToken, uidB, school.token, { operationId: opB });
  assert.equal(startA.status, 200);
  assert.equal(startB.status, 200);
  const results = await Promise.all([
    confirm(card.id, card.cardToken, uidA, { ...startA.data, operationId: opA }, school.token),
    confirm(card.id, card.cardToken, uidB, { ...startB.data, operationId: opB }, school.token),
  ]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409], JSON.stringify(results.map((r) => r.data)));
  const loser = results.find((r) => r.status === 409);
  assert.equal(loser.data.code, "STUDENT_CARD_NFC_ALREADY_PROVISIONED");
  const stored = await rows(studentId);
  assert.equal(stored.length, 1);
  assert.ok([uidA, uidB].includes(stored[0].nfc_uid));
  assert.equal((await audits(card.id, "student_card_nfc_provisioned")).length, 1);
  // Même puce confirmée deux fois en parallèle : un encodage, un rejeu.
  const second = await qrCard(school);
  const uid = nextUid();
  const op = randomUUID();
  const st = await begin(second.card.id, second.card.cardToken, uid, school.token, { operationId: op });
  const twice = await Promise.all([0, 1].map(() => confirm(second.card.id, second.card.cardToken, uid, { ...st.data, operationId: op }, school.token)));
  assert.deepEqual(twice.map((r) => r.status), [200, 200]);
  assert.equal(twice.filter((r) => r.data.idempotentReplay === true).length, 1);
  assert.equal((await audits(second.card.id, "student_card_nfc_provisioned")).length, 1);
});

test("CARD-02 — carte remplacée ou révoquée : anciens supports invalides, aucune réactivation implicite", async () => {
  const school = fixture.schools[0];
  const { studentId, card } = await qrCard(school);
  const replaced = await post(`/student-cards/${card.id}/replace`, {}, school.token);
  assert.equal(replaced.status, 200, JSON.stringify(replaced.data));
  const uid = nextUid();
  const onOld = await begin(card.id, card.cardToken, uid, school.token);
  assert.equal(onOld.status, 409);
  assert.equal(onOld.data.code, "STUDENT_CARD_INVALID_STATE");
  const oldVerify = await post("/student-cards/verify", { cardToken: card.cardToken }, school.token);
  assert.equal(oldVerify.data.card.valid, false);
  // Carte provisionnée puis révoquée : QR et NFC (même jeton) invalides, pas de reprovisionnement.
  const newToken = replaced.data.cardToken ?? replaced.data.card?.cardToken;
  const newId = replaced.data.id ?? replaced.data.card?.id;
  assert.ok(newToken && newId, JSON.stringify(Object.keys(replaced.data)));
  assert.equal((await provision(newId, newToken, uid, school.token)).done.status, 200);
  assert.equal((await post(`/student-cards/${newId}/revoke`, { reason: "test" }, school.token)).status, 200);
  assert.equal((await post("/student-cards/verify", { cardToken: newToken }, school.token)).data.card.valid, false);
  const again = await begin(newId, newToken, nextUid(), school.token);
  assert.equal(again.status, 409);
  const active = (await rows(studentId)).filter((row) => row.status === "active");
  assert.equal(active.length, 0, "aucune carte réactivée");
});
