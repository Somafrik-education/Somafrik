// CARTE-UX-ROLE-01 — parcours Enseignant / Direction de l'appel collectif côté Mobile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import {
  COLLECTIVE_ROLL_CALL_COPY,
  createRollCallDraft,
  rollCallCanSubmit,
  rollCallScanFailure,
  rollCallScopeKey,
  rollCallValidateBody,
  validateRollCallDraft,
  type RollCallDraft,
} from "./studentCardRollCall";
import { parseRollCallOverview, rollCallActor } from "./studentCardRollCallRoles";

const SESSION = "11111111-1111-4111-8111-111111111111";
const CLASS = "22222222-2222-4222-8222-222222222222";
const draft = (mode: "teacher" | "direction", count = 1): RollCallDraft => ({
  ...createRollCallDraft({ scopeKey: `k|${mode}`, sessionId: SESSION, classId: CLASS, date: "2026-10-15", mode }),
  entries: Array.from({ length: count }, (_, i) => ({ dedupKey: `d${i}`, receipt: `rc1.r${i}` })),
});
const session = (roleKeys: string[] | undefined, permissions: string[] = [], role = "") => ({
  user: { role, ...(roleKeys ? { roleKeys } : {}), permissions },
  permissions,
});
const UPDATE = ["Présences:READ", "Présences:CREATE", "Présences:UPDATE"];

test("acteur : enseignant, direction autorisée, rôles secondaires, multi-rôles, plateforme et parents", () => {
  assert.deepEqual(rollCallActor(session(["TEACHER"], UPDATE)), { teacher: true, direction: false, supervision: false, verify: true });
  assert.deepEqual(rollCallActor(session(["PRINCIPAL"], UPDATE)), { teacher: false, direction: true, supervision: true, verify: true });
  assert.deepEqual(rollCallActor(session(["PROVISEUR"], ["Présences:READ", "Présences:CREATE"])),
    { teacher: false, direction: false, supervision: true, verify: true }, "direction sans UPDATE : supervision seule");
  assert.deepEqual(rollCallActor(session(["PRINCIPAL", "TEACHER"], UPDATE, "Directeur")),
    { teacher: true, direction: true, supervision: true, verify: true });
  assert.deepEqual(rollCallActor(session(["SUPERVISOR"], UPDATE)), { teacher: false, direction: false, supervision: false, verify: true });
  for (const keys of [["SUPER_ADMIN"], ["COUNTRY_ADMIN"], ["TEACHER", "SUPER_ADMIN"], ["PARENT"], ["STUDENT"], ["CUSTOM_ROLE"], []]) {
    assert.deepEqual(rollCallActor(session(keys, UPDATE)), { teacher: false, direction: false, supervision: false, verify: false }, keys.join("+"));
  }
});

test("bouton « Enregistrer l'appel (N) » actif uniquement avec au moins un scan, et justification pour la direction", () => {
  assert.equal(COLLECTIVE_ROLL_CALL_COPY.validate(3), "Enregistrer l'appel (3)");
  assert.equal(rollCallCanSubmit(draft("teacher", 0), ""), false);
  assert.equal(rollCallCanSubmit(draft("teacher", 1), ""), true);
  assert.equal(rollCallCanSubmit(draft("direction", 1), "court"), false);
  assert.equal(rollCallCanSubmit(draft("direction", 0), "Enseignant absent ce matin"), false);
  assert.equal(rollCallCanSubmit(draft("direction", 2), "  Enseignant   absent ce matin "), true);
  assert.equal(rollCallCanSubmit(draft("direction", 2), "x".repeat(501)), false);
});

test("corps de validation : jamais d'enseignant fourni par le client ; mode et justification pour la direction", () => {
  const teacherBody = rollCallValidateBody(draft("teacher", 2));
  assert.deepEqual(teacherBody, { sessionId: SESSION, classId: CLASS, date: "2026-10-15", mode: "teacher", receipts: ["rc1.r0", "rc1.r1"] });
  assert.equal("teacherId" in teacherBody, false);
  assert.deepEqual(rollCallValidateBody(draft("direction"), "  Enseignant   absent ce matin "), {
    sessionId: SESSION, classId: CLASS, date: "2026-10-15", mode: "direction", receipts: ["rc1.r0"], justification: "Enseignant absent ce matin",
  });
});

test("brouillons séparés par parcours et refus de rôle compris", async () => {
  const base = { resourceScopeKey: "r", schoolCode: "CD-LAC-26-001", classId: CLASS, date: "2026-10-15" };
  assert.notEqual(rollCallScopeKey({ ...base, mode: "teacher" }), rollCallScopeKey({ ...base, mode: "direction" }));
  const refusal = rollCallScanFailure({ status: 403, code: "ROLL_CALL_ROLE_FORBIDDEN" });
  assert.equal(refusal.stop, true);
  assert.equal(refusal.feedback.message, COLLECTIVE_ROLL_CALL_COPY.roleForbidden);
  const sent: unknown[] = [];
  const justified = await validateRollCallDraft(draft("direction"), {
    justification: "court",
    validate: async (body) => { sent.push(body); return { recorded: 1 }; },
  });
  assert.equal(justified.kind, "error");
  assert.equal(justified.message, COLLECTIVE_ROLL_CALL_COPY.justificationRequired);
  assert.deepEqual(sent, [], "aucun envoi sans justification valide");
  const refused = await validateRollCallDraft(draft("direction"), {
    justification: "Enseignant absent ce matin",
    validate: async () => { throw Object.assign(new Error("x"), { status: 403, code: "ROLL_CALL_ROLE_FORBIDDEN" }); },
  });
  assert.deepEqual(refused, { kind: "error", message: COLLECTIVE_ROLL_CALL_COPY.roleForbidden });
  const ok = await validateRollCallDraft(draft("direction", 2), {
    justification: "Enseignant absent ce matin",
    validate: async (body, options) => {
      assert.equal(options.idempotencyKey, SESSION);
      assert.equal((body as { mode?: string }).mode, "direction");
      return { recorded: 1, alreadyPresent: 1 };
    },
  });
  assert.deepEqual(ok, { kind: "validated", recorded: 1, message: COLLECTIVE_ROLL_CALL_COPY.validatedDirection(1, 1) });
});

test("supervision : seuls les compteurs par classe sont conservés", () => {
  const parsed = parseRollCallOverview({
    date: "2026-10-15",
    classes: [
      { classId: CLASS, classCode: "RC-A1", className: "2e A", enrolled: 7, present: 2, absent: 0, late: 0, excused: 0,
        recorded: 2, notRecorded: 5, status: "partial", lastUpdatedAt: "2026-10-15T08:00:00.000Z", students: [{ name: "Amina" }] },
      { classId: "bad", status: "complete" },
      { classId: "33333333-3333-4333-8333-333333333333", classCode: "RC-A2", className: "2e B", enrolled: -4, present: "x", status: "weird" },
    ],
  });
  assert.equal(parsed?.date, "2026-10-15");
  assert.equal(parsed?.classes.length, 2);
  assert.deepEqual(Object.keys(parsed!.classes[0]).sort(), [
    "absent", "classCode", "classId", "className", "enrolled", "excused", "lastUpdatedAt", "late", "notRecorded", "present", "recorded", "status",
  ]);
  assert.equal(JSON.stringify(parsed).includes("Amina"), false);
  assert.deepEqual([parsed!.classes[1].enrolled, parsed!.classes[1].present, parsed!.classes[1].status], [0, 0, "not_started"]);
  assert.equal(parseRollCallOverview({ classes: "nope" }), null);
});

test("écran Appel : parcours affichés selon le rôle canonique, sans enseignant fictif", () => {
  const screen = readFileSync(new URL("../screens/TeacherAttendanceScreen.tsx", import.meta.url), "utf8");
  const modal = readFileSync(new URL("../components/StudentCardRollCallModal.tsx", import.meta.url), "utf8");
  assert.match(screen, /rollCallActor\(session\)/);
  assert.match(screen, /actor\.teacher && nfcControl === "ready"/);
  assert.match(screen, /actor\.direction/);
  assert.match(screen, /attendance-roll-call-direction-nfc/);
  assert.match(screen, /StudentCardRollCallOverview/);
  assert.match(screen, /actor\.verify && \(nfcControl === "ready" \|\| canOpenQrScanner\)/);
  assert.doesNotMatch(screen, /teacherId=\{rollCallTeacherId\}/, "plus d'attribution à un enseignant choisi");
  assert.match(modal, /roll-call-justification/);
  assert.match(modal, /rollCallCanSubmit\(draft, justification\)/);
  assert.doesNotMatch(modal, /teacherId/);
});
