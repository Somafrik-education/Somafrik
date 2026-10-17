import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import {
  CLASS_ROLL_CALL_COPY,
  applyRollCallScan,
  classRollCallCounts,
  classRollCallValidateBody,
  createClassRollCall,
  isLockedStudent,
  markAllPresent,
  mergeReloadedRoster,
  parseRollCallRoster,
  setStudentStatus,
  validateClassRollCall,
  type RosterStudent,
} from "./studentCardClassRollCall";

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const CONTEXT = { scopeKey: "scope", sessionId: SESSION, classId: id(99), date: "2026-10-26" };

const rawRoster = {
  sessionId: SESSION,
  students: [
    { studentId: id(1), studentCode: "E1", firstName: "Amina", lastName: "Kabila", existingStatus: null, provisionalStatus: "absent", matchKey: "k1" },
    { studentId: id(2), studentCode: "E2", firstName: "Bao", lastName: "Lutete", existingStatus: "excused", provisionalStatus: "excused", matchKey: "k2" },
    { studentId: id(3), studentCode: "E3", firstName: "Cyn", lastName: "Mbuyi", existingStatus: "present", provisionalStatus: "present", matchKey: "k3" },
    { studentId: id(4), studentCode: "E4", firstName: "Dan", lastName: "Ngoy", existingStatus: "absent", provisionalStatus: "absent", matchKey: "k4" },
    { studentId: id(5), studentCode: "E5", firstName: "Eli", lastName: "Ombe", existingStatus: null, provisionalStatus: "absent", matchKey: "k5" },
  ],
};

function roster(): RosterStudent[] {
  const parsed = parseRollCallRoster(rawRoster);
  assert.ok(parsed);
  return parsed;
}

test("liste : liste blanche, identifiants UUID, doublons et lignes invalides écartés", () => {
  const parsed = parseRollCallRoster({
    students: [
      ...rawRoster.students,
      { studentId: "pas-un-uuid", matchKey: "x" },
      { studentId: id(1), matchKey: "dupe" },
      { studentId: id(7), matchKey: "" },
      { studentId: id(8), matchKey: "k8", existingStatus: "inconnu", token: "secret", phone: "+243" },
    ],
  });
  assert.ok(parsed);
  assert.deepEqual(parsed.map((row) => row.studentId), [id(1), id(2), id(3), id(4), id(5), id(8)]);
  assert.equal(parsed[5].existingStatus, null, "statut inconnu ignoré");
  assert.equal(JSON.stringify(parsed).includes("secret"), false, "aucun champ hors liste blanche");
  assert.equal(parseRollCallRoster({ students: "x" }), null);
  assert.equal(parseRollCallRoster(null), null);
});

test("ouverture : statut existant conservé, élève sans statut « Absent » provisoire", () => {
  const draft = createClassRollCall(CONTEXT, roster());
  assert.deepEqual(draft.marks[id(1)], { status: "absent", source: "default" });
  assert.deepEqual(draft.marks[id(2)], { status: "excused", source: "existing" });
  assert.deepEqual(draft.marks[id(3)], { status: "present", source: "existing" });
  assert.deepEqual(draft.marks[id(4)], { status: "absent", source: "existing" });
  assert.deepEqual(classRollCallCounts(draft), { present: 1, absent: 3, late: 0, excused: 1, total: 5 });
  assert.deepEqual(roster().map(isLockedStudent), [false, true, true, false, false], "justifié et présent verrouillés, absent corrigeable");
});

test("Tous présents : seuls les élèves modifiables passent présents ; justifié et présent existants intacts", () => {
  const draft = markAllPresent(createClassRollCall(CONTEXT, roster()));
  assert.equal(draft.marks[id(1)].status, "present");
  assert.equal(draft.marks[id(4)].status, "present", "absent existant corrigé");
  assert.equal(draft.marks[id(5)].status, "present");
  assert.deepEqual(draft.marks[id(2)], { status: "excused", source: "existing" });
  assert.deepEqual(draft.marks[id(3)], { status: "present", source: "existing" });
  assert.deepEqual(classRollCallCounts(draft), { present: 4, absent: 0, late: 0, excused: 1, total: 5 });
});

test("correction individuelle : présent / retard / absent ; statuts verrouillés refusés", () => {
  let draft = markAllPresent(createClassRollCall(CONTEXT, roster()));
  draft = setStudentStatus(draft, id(1), "late");
  draft = setStudentStatus(draft, id(5), "absent");
  assert.equal(draft.marks[id(1)].status, "late");
  assert.equal(draft.marks[id(5)].status, "absent");
  const locked = setStudentStatus(draft, id(2), "present");
  assert.equal(locked, draft, "justifié jamais modifiable localement");
  assert.equal(setStudentStatus(draft, id(3), "absent"), draft, "présence existante jamais rétrogradée");
  assert.equal(setStudentStatus(draft, id(1), "excused" as never), draft, "justifié non saisissable à l'appel");
});

test("scan : rapprochement uniquement par la clé de session ; doublon et statut verrouillé signalés", () => {
  const start = createClassRollCall(CONTEXT, roster());
  const first = applyRollCallScan(start, { dedupKey: "k1", receipt: "r1" });
  assert.equal(first.feedback.kind, "accepted");
  assert.equal(first.feedback.message, CLASS_ROLL_CALL_COPY.scanned("Amina Kabila"));
  assert.deepEqual(first.draft.marks[id(1)], { status: "present", source: "card", receipt: "r1" });
  const again = applyRollCallScan(first.draft, { dedupKey: "k1", receipt: "r1-bis" });
  assert.equal(again.feedback.kind, "duplicate");
  assert.equal(again.draft, first.draft, "double scan sans effet");
  const locked = applyRollCallScan(first.draft, { dedupKey: "k2", receipt: "r2" });
  assert.equal(locked.feedback.kind, "info");
  assert.equal(locked.draft.marks[id(2)].status, "excused", "un scan n'écrase jamais un justifié");
  const unknown = applyRollCallScan(first.draft, { dedupKey: "inconnue", receipt: "r9" });
  assert.equal(unknown.feedback.kind, "refused");
  assert.equal(unknown.draft, first.draft);
});

test("validation : reçus des scannés, pointage manuel des autres modifiables, statuts conservés non renvoyés", () => {
  let draft = createClassRollCall(CONTEXT, roster());
  draft = applyRollCallScan(draft, { dedupKey: "k1", receipt: "r1" }).draft;
  draft = setStudentStatus(draft, id(5), "late");
  const { body, receiptStudentIds } = classRollCallValidateBody(draft);
  assert.deepEqual(body, {
    sessionId: SESSION,
    classId: id(99),
    date: "2026-10-26",
    mode: "teacher",
    receipts: ["r1"],
    manual: [
      { studentId: id(4), status: "absent" },
      { studentId: id(5), status: "late" },
    ],
    complete: true,
  });
  assert.deepEqual(receiptStudentIds, [id(1)]);
});

test("correction après scan : le reçu n'est plus envoyé, le statut manuel l'emporte", () => {
  let draft = applyRollCallScan(createClassRollCall(CONTEXT, roster()), { dedupKey: "k1", receipt: "r1" }).draft;
  draft = setStudentStatus(draft, id(1), "late");
  const { body } = classRollCallValidateBody(draft);
  assert.deepEqual(body.receipts, []);
  assert.deepEqual(body.manual.find((row) => row.studentId === id(1)), { studentId: id(1), status: "late" });
});

test("validation réussie : idempotence par la session, comptage serveur et statuts protégés", async () => {
  const calls: { body: unknown; key: string }[] = [];
  const draft = markAllPresent(createClassRollCall(CONTEXT, roster()));
  const outcome = await validateClassRollCall(draft, {
    validate: async (body, options) => {
      calls.push({ body, key: options.idempotencyKey });
      return { counts: { present: 4, absent: 0, late: 0, excused: 1, enrolled: 5 }, protected: 1 };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, SESSION, "Idempotency-Key = session");
  assert.equal(outcome.kind, "validated");
  if (outcome.kind !== "validated") return;
  assert.deepEqual(outcome.counts, { present: 4, absent: 0, late: 0, excused: 1, enrolled: 5 });
  assert.match(outcome.message, /4 présent\(s\), 0 absent\(s\), 0 retard\(s\), 1 justifié\(s\)/);
  assert.match(outcome.message, /1 statut\(s\) déjà enregistré\(s\) conservé\(s\)/);
});

test("erreurs de validation : effectif modifié, scans invalides ou expirés, déjà validé, hors ligne", async () => {
  let draft = createClassRollCall(CONTEXT, roster());
  draft = applyRollCallScan(draft, { dedupKey: "k1", receipt: "r1" }).draft;
  draft = applyRollCallScan(draft, { dedupKey: "k5", receipt: "r5" }).draft;
  const fail = (error: unknown) => validateClassRollCall(draft, { validate: async () => { throw error; } });

  const changed = await fail({ status: 409, code: "ROLL_CALL_ROSTER_CHANGED" });
  assert.equal(changed.kind, "roster_changed");

  const invalid = await fail({ status: 409, code: "ROLL_CALL_CARD_INVALID", details: { invalidReceiptIndexes: [1] } });
  assert.equal(invalid.kind, "cards_invalid");
  if (invalid.kind === "cards_invalid") {
    assert.deepEqual(invalid.draft.marks[id(5)], { status: "absent", source: "default" }, "scan retiré : absent provisoire");
    assert.equal(invalid.draft.marks[id(1)].source, "card", "les autres scans sont conservés");
  }

  const expired = await fail({ status: 409, code: "ROLL_CALL_RECEIPT_EXPIRED" });
  assert.equal(expired.kind, "expired");
  if (expired.kind === "expired") assert.equal(expired.draft.marks[id(1)].source, "default");

  const already = await fail({ status: 409, code: "ROLL_CALL_ALREADY_VALIDATED" });
  assert.deepEqual([already.kind, already.kind === "validated" ? already.message : ""], ["validated", CLASS_ROLL_CALL_COPY.alreadyValidated]);

  const offline = await fail({ status: 0, code: "NETWORK_UNAVAILABLE" });
  assert.deepEqual(offline, { kind: "error", message: CLASS_ROLL_CALL_COPY.offline });
  const forbidden = await fail({ status: 403, code: "ROLL_CALL_CLASS_FORBIDDEN" });
  assert.deepEqual(forbidden, { kind: "error", message: CLASS_ROLL_CALL_COPY.roleForbidden });
});

test("rechargement après changement d'effectif : choix conservés, nouvel élève absent, statuts enregistrés entre-temps prioritaires", () => {
  let draft = createClassRollCall(CONTEXT, roster());
  draft = setStudentStatus(draft, id(1), "late");
  draft = applyRollCallScan(draft, { dedupKey: "k5", receipt: "r5" }).draft;
  const reloaded = parseRollCallRoster({
    students: [
      { ...rawRoster.students[0] },
      { ...rawRoster.students[4], existingStatus: "excused" },
      { studentId: id(6), studentCode: "E6", firstName: "Fey", lastName: "Pemba", existingStatus: null, matchKey: "k6" },
    ],
  });
  assert.ok(reloaded);
  const merged = mergeReloadedRoster(draft, reloaded);
  assert.equal(merged.marks[id(1)].status, "late");
  assert.deepEqual(merged.marks[id(5)], { status: "excused", source: "existing" }, "justifié enregistré entre-temps prioritaire");
  assert.deepEqual(merged.marks[id(6)], { status: "absent", source: "default" });
  assert.equal(merged.marks[id(2)], undefined, "élève retiré de la liste");
});

test("écran et modale : confirmation obligatoire, appel complet, aucun enseignant envoyé, appel manuel hors ligne préservé", () => {
  const modal = readFileSync(new URL("../components/StudentCardClassRollCallModal.tsx", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../screens/TeacherAttendanceScreen.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../services/studentCardRollCallApi.ts", import.meta.url), "utf8");
  assert.match(modal, /getClassRollCallRoster\(context\)/, "liste chargée à l'ouverture");
  assert.match(modal, /Alert\.alert\(CLASS_ROLL_CALL_COPY\.confirmTitle, CLASS_ROLL_CALL_COPY\.confirmBody\(counts\)/,
    "récapitulatif avec le nombre exact d'absents avant validation");
  assert.match(modal, /validateClassRollCall\(current, \{ validate: validateCompleteClassRollCall \}\)/);
  assert.match(modal, /if \(validatingRef\.current \|\| !current\) return; \/\/ double validation bloquée/);
  assert.doesNotMatch(modal, /teacherId/);
  assert.doesNotMatch(modal, /AsyncStorage|SecureStore/, "brouillon en mémoire uniquement");
  assert.match(api, /complete: true;/);
  assert.match(api, /idempotencyKey: options\.idempotencyKey/);
  assert.match(screen, /submitProtectedMutation/, "appel manuel classique (hors ligne) inchangé");
  assert.match(screen, /attendance-roll-call-direction-nfc/, "appel exceptionnel de direction inchangé");
});
