/**
 *   npx tsx Mobile/src/lib/attendanceOffline.test.ts
 */
import assert from "node:assert/strict";
import { overlayPresenceOutboxOnAttendance } from "./attendanceOffline";
import { applyRollCallStatus, ROLL_CALL_COPY, type RollCallEntry } from "./attendanceTruth";
import type { OutboxEntry } from "./outbox";

function entry(partial: Partial<OutboxEntry> & Pick<OutboxEntry, "status" | "payload">): OutboxEntry {
  return {
    id: "k1",
    idempotencyKey: "k1",
    intentionId: "presence:uuid-a:23-08-2026",
    domain: "presences",
    method: "POST",
    path: "/presences",
    createdAt: "2026-08-23T08:00:00.000Z",
    attemptCount: 0,
    lastError: null,
    userId: "teacher-1",
    schoolScope: "CD-2026-0001",
    ...partial,
  };
}

function run() {
  const students = [{ id: "s1", matricule: "M1", publicId: "s1" }];
  const draft: Record<string, RollCallEntry> = {
    s1: applyRollCallStatus(undefined, "Présent", "QA", new Date("2026-08-23T08:00:00")),
  };
  const queued = overlayPresenceOutboxOnAttendance({
    attendance: {
      s1: { status: "Présent", source: "unset" },
    },
    students,
    entries: [
      entry({
        status: "pending",
        payload: {
          classId: "uuid-a",
          classCode: "CLS-A",
          date: "23-08-2026",
          items: [{ studentId: "s1", status: "Absent" }],
        },
      }),
    ],
    identity: { classId: "uuid-a", classCode: "CLS-A" },
    todayLabel: "23-08-2026",
  });
  assert.equal(queued.s1?.source, "queued");
  assert.equal(queued.s1?.status, "Absent");
  assert.equal(ROLL_CALL_COPY.queued, "En attente de synchronisation");
  assert.equal(
    ROLL_CALL_COPY.queuedAlertTitle,
    "Appel enregistré sur cet appareil — en attente de synchronisation",
  );

  const keptDraft = overlayPresenceOutboxOnAttendance({
    attendance: draft,
    students,
    entries: [
      entry({
        status: "pending",
        payload: {
          classId: "uuid-a",
          date: "23-08-2026",
          items: [{ studentId: "s1", status: "Absent" }],
        },
      }),
    ],
    identity: { classId: "uuid-a", classCode: "CLS-A" },
    todayLabel: "23-08-2026",
  });
  assert.equal(keptDraft.s1?.source, "draft", "édition locale après queue non écrasée tant que pending");

  const afterAck = overlayPresenceOutboxOnAttendance({
    attendance: {
      s1: { status: "Présent", source: "draft", modifiedAt: "23-08-2026 08:01" },
    },
    students,
    entries: [
      entry({
        status: "sent",
        payload: {
          classId: "uuid-a",
          date: "23-08-2026",
          items: [{ studentId: "s1", status: "Absent" }],
        },
      }),
    ],
    identity: { classId: "uuid-a", classCode: "CLS-A" },
    todayLabel: "23-08-2026",
  });
  assert.equal(afterAck.s1?.source, "postgres", "ACK : le brouillon local ne masque plus PostgreSQL");
  assert.equal(afterAck.s1?.modifiedAt, undefined);

  const failed = overlayPresenceOutboxOnAttendance({
    attendance: { s1: { status: "Présent", source: "unset" } },
    students,
    entries: [
      entry({
        status: "failed",
        payload: {
          classId: "uuid-a",
          date: "23-08-2026",
          items: [{ studentId: "s1", status: "Présent" }],
        },
      }),
    ],
    identity: { classId: "uuid-a", classCode: "CLS-A" },
    todayLabel: "23-08-2026",
  });
  assert.equal(failed.s1?.source, "failed");
  assert.equal(ROLL_CALL_COPY.syncError, "Erreur de synchronisation");
  assert.match(ROLL_CALL_COPY.persistFailedBody, /Impossible de conserver cet appel hors connexion/);

  console.log("attendanceOffline.test.ts OK");
}

run();
