import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import {
  ENTRY_CONTROL_COPY,
  createEntryReadGate,
  describeEntryResult,
  entryControlActor,
  entryControlMedia,
  entryScanFailure,
  parseEntryScanResponse,
  submitEntryScan,
} from "./studentCardEntryControl";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTRY = "Contrôle d'entrée:CREATE";

function session(roleKeys: string[], permissions: string[]) {
  return { roleKeys, permissions, user: { id: "u1", roleKeys, permissions } };
}

test("visibilité : clé admissible ET permission effective Contrôle d'entrée:CREATE, jamais l'une sans l'autre", () => {
  for (const key of ["PROVISEUR", "PRINCIPAL", "PREFET_ETUDES", "SECRETARY", "SUPERVISOR", "SCHOOL_ADMIN"]) {
    assert.equal(entryControlActor(session([key], [ENTRY])), true, key);
    assert.equal(entryControlActor(session([key], ["Présences:UPDATE", "Contrôle d'entrée:READ"])), false, `${key} sans CREATE`);
  }
  // Rôles non admissibles, même avec la permission (jamais de rôle enseignant fictif).
  for (const key of ["TEACHER", "ACCOUNTANT", "PARENT", "STUDENT", "SUPER_ADMIN", "COUNTRY_ADMIN", "INCONNU"]) {
    assert.equal(entryControlActor(session([key], [ENTRY])), false, key);
  }
  // Une clé plateforme ou inconnue à côté d'une clé admissible ferme l'accès.
  assert.equal(entryControlActor(session(["SUPERVISOR", "SUPER_ADMIN"], [ENTRY])), false);
  assert.equal(entryControlActor(session([], [ENTRY])), false);
  assert.equal(entryControlActor(null), false);
});

test("lecteurs proposés : NFC sur Android seulement, réglages de l'établissement respectés quand connus", () => {
  assert.deepEqual(entryControlMedia({ settings: null, platformOs: "android" }), { nfc: true, qr: true });
  assert.deepEqual(entryControlMedia({ settings: null, platformOs: "ios" }), { nfc: false, qr: true });
  assert.deepEqual(
    entryControlMedia({ settings: { studentCardEnabled: true, studentCardNfcEnabled: true, studentCardQrEnabled: false }, platformOs: "android" }),
    { nfc: true, qr: false },
  );
  assert.deepEqual(
    entryControlMedia({ settings: { studentCardEnabled: false, studentCardNfcEnabled: true, studentCardQrEnabled: true }, platformOs: "android" }),
    { nfc: false, qr: false },
  );
});

test("réponse : liste blanche, aucun identifiant ni photo conservé, finance seulement si renvoyée", () => {
  const parsed = parseEntryScanResponse({
    status: "entered",
    entry: { id: "e1", enteredAt: "2026-10-16T07:42:00.000Z", localDate: "2026-10-16" },
    student: { id: "s1", studentCode: "EL-001", firstName: "Amani", lastName: "Kabila", photoUrl: "https://x/p.jpg" },
    class: { id: "c1", classCode: "6A", className: "6e A" },
    finance: { code: "OVERDUE", label: "Échéance impayée", amount: 12 },
    token_hash: "secret",
  });
  assert.ok(parsed);
  assert.deepEqual(parsed, {
    status: "entered",
    enteredAt: "2026-10-16T07:42:00.000Z",
    localDate: "2026-10-16",
    studentName: "Amani Kabila",
    studentCode: "EL-001",
    className: "6e A",
    finance: { code: "OVERDUE", label: "Échéance impayée" },
  });
  const noFinance = parseEntryScanResponse({ status: "already_entered", entry: { enteredAt: "2026-10-16T07:42:00.000Z" }, student: {}, class: {} });
  assert.equal(noFinance?.finance, undefined);
  assert.equal(parseEntryScanResponse({ status: "entered" })?.status, "entered");
  assert.equal(parseEntryScanResponse({ status: "autre" }), null);
  assert.equal(parseEntryScanResponse(null), null);
  const unavailable = parseEntryScanResponse({ status: "entered", entry: {}, finance: { status: "UNAVAILABLE" } });
  assert.deepEqual(unavailable?.finance, { code: "UNAVAILABLE", label: ENTRY_CONTROL_COPY.financeUnavailable });
});

test("affichage : entrée enregistrée, déjà entré, classe et situation financière", () => {
  const entered = describeEntryResult({
    status: "entered", enteredAt: "2026-10-16T07:42:00.000Z", localDate: "2026-10-16",
    studentName: "Amani Kabila", studentCode: "EL-001", className: "6e A",
    finance: { code: "OVERDUE", label: "Échéance impayée" },
  });
  assert.equal(entered.tone, "entered");
  assert.equal(entered.headline, ENTRY_CONTROL_COPY.entered);
  assert.deepEqual(entered.rows.map((row) => row.label), ["Élève", "Matricule", "Classe", "Situation financière"]);
  assert.equal(entered.financeAlert, true);
  const already = describeEntryResult({ status: "already_entered", enteredAt: "", localDate: "", studentName: "", studentCode: "", className: "6e A" });
  assert.equal(already.tone, "already");
  assert.equal(already.headline, ENTRY_CONTROL_COPY.alreadyEntered);
  assert.equal(already.financeAlert, false);
  assert.deepEqual(already.rows, [{ label: "Classe", value: "6e A" }]);
});

test("erreurs : carte inconnue/étrangère, révoquée, accès interdit, réseau (reprise), désactivée, illisible", () => {
  const cases: [unknown, string, boolean][] = [
    [{ status: 404, code: "STUDENT_CARD_NOT_FOUND" }, ENTRY_CONTROL_COPY.unknownCard, false],
    [{ status: 403, code: "STUDENT_CARD_TENANT_DENIED" }, ENTRY_CONTROL_COPY.otherSchool, false],
    [{ status: 409, code: "STUDENT_CARD_INVALID_STATE" }, ENTRY_CONTROL_COPY.revokedCard, false],
    [{ status: 409, code: "STUDENT_CARD_ENROLLMENT_UNRESOLVED" }, ENTRY_CONTROL_COPY.noEnrollment, false],
    [{ status: 404, code: "STUDENT_CARD_DISABLED" }, ENTRY_CONTROL_COPY.disabled, false],
    [{ status: 403, code: "ENTRY_ROLE_FORBIDDEN" }, ENTRY_CONTROL_COPY.forbidden, false],
    [{ status: 403, code: "PLATFORM_PERSONAL_DATA_DENIED" }, ENTRY_CONTROL_COPY.forbidden, false],
    [{ status: 401 }, ENTRY_CONTROL_COPY.forbidden, false],
    [{ status: 400, code: "ENTRY_INPUT_INVALID" }, ENTRY_CONTROL_COPY.unreadable, false],
    [{ status: 409, code: "ENTRY_OPERATION_CONFLICT" }, ENTRY_CONTROL_COPY.conflict, false],
    [{ status: 0, code: "NETWORK_UNAVAILABLE" }, ENTRY_CONTROL_COPY.offline, true],
    [{ status: 408, code: "TIMEOUT" }, ENTRY_CONTROL_COPY.offline, true],
    [{ status: 503 }, ENTRY_CONTROL_COPY.failed, true],
  ];
  for (const [error, message, retry] of cases) {
    const failure = entryScanFailure(error);
    assert.equal(failure.message, message, JSON.stringify(error));
    assert.equal(failure.retry, retry, JSON.stringify(error));
  }
  assert.equal(entryScanFailure({ status: 403, code: "ENTRY_ROLE_FORBIDDEN" }).stop, true, "accès interdit : arrêt du scan continu");
});

test("soumission : un operationId UUID par lecture physique, Idempotency-Key identique, reprise réseau avec le même identifiant", async () => {
  const calls: { body: Record<string, unknown>; key: string }[] = [];
  let fail = true;
  const scan = async (body: { cardToken: string; medium: "nfc" | "qr"; operationId: string }, options: { idempotencyKey: string }) => {
    calls.push({ body, key: options.idempotencyKey });
    if (fail) throw { status: 0, code: "NETWORK_UNAVAILABLE" };
    return { status: "entered", entry: { enteredAt: "2026-10-16T07:42:00.000Z", localDate: "2026-10-16" }, student: {}, class: { className: "6e A" } };
  };
  const first = await submitEntryScan({ cardToken: "tok-1", medium: "nfc" }, { scan });
  assert.equal(first.kind, "failed");
  if (first.kind !== "failed") return;
  assert.equal(first.failure.retry, true);
  assert.ok(first.retry, "une reprise est proposée après une perte réseau");
  assert.match(String(calls[0].body.operationId), UUID);
  assert.equal(calls[0].key, calls[0].body.operationId);
  fail = false;
  const retried = await submitEntryScan(first.retry!, { scan });
  assert.equal(retried.kind, "recorded");
  assert.equal(calls[1].body.operationId, calls[0].body.operationId, "la reprise rejoue la même opération (aucun doublon)");
  const next = await submitEntryScan({ cardToken: "tok-2", medium: "qr" }, { scan });
  assert.equal(next.kind, "recorded");
  assert.notEqual(calls[2].body.operationId, calls[0].body.operationId, "nouvelle lecture physique : nouvel identifiant");
  assert.equal(calls[2].body.medium, "qr");
  // Erreur définitive : aucune reprise proposée (le jeton ne reste pas en mémoire).
  const refused = await submitEntryScan({ cardToken: "tok-3", medium: "nfc" }, {
    scan: async () => { throw { status: 409, code: "STUDENT_CARD_INVALID_STATE" }; },
  });
  assert.equal(refused.kind, "failed");
  if (refused.kind === "failed") assert.equal(refused.retry, undefined);
  // Réponse inattendue : jamais affichée comme une entrée.
  const odd = await submitEntryScan({ cardToken: "tok-4", medium: "nfc" }, { scan: async () => ({ status: "?" }) });
  assert.equal(odd.kind, "failed");
});

test("double lecture : la même carte relue pendant le délai n'est pas renvoyée, une autre carte passe", () => {
  const gate = createEntryReadGate(3_000);
  assert.equal(gate.accept("tok-1", 1_000), true);
  assert.equal(gate.accept("tok-1", 2_500), false);
  assert.equal(gate.accept("tok-2", 2_600), true);
  assert.equal(gate.accept("tok-1", 2_700), true, "après une autre carte, la première peut repasser");
  assert.equal(gate.accept("tok-1", 6_000), true);
  gate.reset();
  assert.equal(gate.accept("tok-1", 6_100), true);
});

test("écran Présences : entrée « Contrôle d'entrée » sans choix de classe, n'enregistre aucune présence en classe", () => {
  const screen = readFileSync(new URL("../screens/TeacherAttendanceScreen.tsx", import.meta.url), "utf8");
  const modal = readFileSync(new URL("../components/StudentCardEntryControlModal.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../services/studentCardEntryApi.ts", import.meta.url), "utf8");
  assert.match(screen, /const entryActor = entryControlActor\(session\)/);
  assert.match(screen, /testID="attendance-entry-control"/);
  // Le bouton n'est pas dans le bloc de la classe sélectionnée : visible sans classe.
  const button = screen.indexOf('testID="attendance-entry-control"');
  const listView = screen.indexOf("if (!selectedClass) {");
  const classView = screen.indexOf("<FlatList", listView);
  assert.ok(listView > 0 && button > listView && button < classView, "bouton sur la vue des classes, avant tout choix");
  assert.match(screen, /canOpenEntryControl = entryActor && \(entryMedia\.nfc \|\| entryMedia\.qr\)/);
  assert.match(api, /"\/student-cards\/entry-scan"/);
  assert.match(api, /idempotencyKey: options\.idempotencyKey/);
  assert.doesNotMatch(modal, /\/presences|submitProtectedMutation|roll-call|recordPresence/);
  assert.doesNotMatch(modal, /AsyncStorage|SecureStore|console\.log/);
  assert.match(modal, /createRollCallNfcLoop/);
  assert.match(modal, /accessibilityLiveRegion="polite"/);
  // Pointage individuel préservé.
  assert.match(screen, /USABILITY_TEST_IDS\.attendanceScanNfc/);
  assert.match(screen, /StudentCardQrScannerModal/);
});
