"use strict";

/**
 * Lot R4 (RED) — contrat des producteurs de notifications.
 *
 * Objectif : geler la matrice des types de notifications et interdire qu'un
 * producteur déclarant une ressource ouvrable sorte avec une cible vide.
 *
 * Deux garde-fous complémentaires :
 *  1. tout évènement déclaré « ouvrable » doit affecter une `navigationTarget`
 *     non vide dans `eventSpec()` ;
 *  2. tout évènement traité par `eventSpec()` doit être déclaré dans la matrice,
 *     de sorte qu'un futur producteur ne puisse pas être livré sans décision
 *     explicite sur son ouverture.
 *
 * État actuel (develop@7bcca23a) : `planning.timetable.changed` et
 * `planning.teacher.replacement` affectent `navigationTarget = {}`. Le premier
 * garde-fou échoue donc aujourd'hui, par conception.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { LOT_I_EVENTS, mapDispatcherEventToLotI } = require("./schoolNotificationPolicy");

const ROOT = path.resolve(__dirname, "../..");
const SERVICE = path.join(ROOT, "backend/lib/communicationsNotificationsService.js");

/**
 * Matrice gelée. `openable: true` signifie « la notification désigne une
 * ressource métier consultable » et impose donc une cible de navigation.
 * `targetType` fige le discriminant attendu côté client.
 */
const NOTIFICATION_CONTRACT = Object.freeze({
  "communication.message.created": { openable: true, targetType: "conversation", requiredKeys: ["conversationId"] },
  "communication.announcement.published": { openable: true, targetType: "announcement", requiredKeys: ["announcementId"] },
  "attendance.student.absent": { openable: true, targetType: "attendance", requiredKeys: ["studentId", "attendanceId"] },
  "attendance.student.late": { openable: true, targetType: "attendance", requiredKeys: ["studentId", "attendanceId"] },
  "pedagogy.grade.published": { openable: true, targetType: "grade", requiredKeys: ["studentId", "gradeId"] },
  "pedagogy.report_card.published": { openable: true, targetType: "report_card", requiredKeys: ["studentId", "reportCardId"] },
  "finance.payment.recorded": { openable: true, targetType: "payment", requiredKeys: ["studentId", "paymentId"] },
  "finance.payment.due": { openable: true, targetType: "finance_obligation", requiredKeys: ["studentId", "obligationId"] },
  "planning.timetable.changed": { openable: true, targetType: "timetable", requiredKeys: ["weeklySlotId", "classId"] },
  "planning.teacher.replacement": { openable: true, targetType: "teacher_replacement", requiredKeys: ["replacementId", "classId", "occurrenceDate"] },
});

function serviceSource() {
  return fs.readFileSync(SERVICE, "utf8");
}

/** Corps de `eventSpec()`, seule zone où les cibles de navigation sont décidées. */
function eventSpecBody(source) {
  const start = source.indexOf("async function eventSpec(");
  assert.ok(start >= 0, "eventSpec() introuvable dans le service");
  const end = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, end > 0 ? end : undefined);
}

/**
 * Découpe `eventSpec()` par branche `eventType === "..."` et retourne, pour
 * chaque type, la dernière affectation de `navigationTarget` de sa branche.
 */
function navigationAssignmentsByEventType(body) {
  const markers = [...body.matchAll(/eventType === "([^"]+)"/g)];
  const assignments = new Map();
  for (const [index, marker] of markers.entries()) {
    const from = marker.index;
    const to = index + 1 < markers.length ? markers[index + 1].index : body.length;
    const branch = body.slice(from, to);
    const found = [...branch.matchAll(/navigationTarget = ([\s\S]*?);\n/g)];
    assignments.set(marker[1], found.length ? found.at(-1)[1].trim() : null);
  }
  return assignments;
}

test("RED-N7-01 — tout évènement ouvrable affecte une cible de navigation non vide", () => {
  const assignments = navigationAssignmentsByEventType(eventSpecBody(serviceSource()));
  const offenders = [];
  for (const [eventType, contract] of Object.entries(NOTIFICATION_CONTRACT)) {
    if (!contract.openable) continue;
    const assigned = assignments.get(eventType);
    if (assigned === undefined) continue; // couvert par RED-N7-03
    if (assigned === null || assigned === "{}") {
      offenders.push(`${eventType} -> ${assigned === null ? "aucune affectation" : "{}"}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `producteurs déclarant une ressource ouvrable mais sortant sans cible : ${offenders.join(" | ")}`,
  );
});

test("RED-N7-02 — la cible d'un évènement ouvrable porte son discriminant et ses identifiants", () => {
  const assignments = navigationAssignmentsByEventType(eventSpecBody(serviceSource()));
  const offenders = [];
  for (const [eventType, contract] of Object.entries(NOTIFICATION_CONTRACT)) {
    if (!contract.openable) continue;
    const assigned = assignments.get(eventType);
    if (!assigned || assigned === "{}") {
      offenders.push(`${eventType} : cible vide`);
      continue;
    }
    if (!assigned.includes(`type: "${contract.targetType}"`)) {
      offenders.push(`${eventType} : discriminant « ${contract.targetType} » absent`);
    }
    for (const key of contract.requiredKeys) {
      if (!assigned.includes(`${key}:`)) offenders.push(`${eventType} : clé « ${key} » absente de la cible`);
    }
  }
  assert.deepEqual(offenders, [], `cibles incomplètes : ${offenders.join(" | ")}`);
});

test("RED-N7-03 — aucun producteur ne peut être livré hors de la matrice gelée", () => {
  const assignments = navigationAssignmentsByEventType(eventSpecBody(serviceSource()));
  const undeclared = [...assignments.keys()].filter((eventType) => !(eventType in NOTIFICATION_CONTRACT));
  assert.deepEqual(
    undeclared,
    [],
    `évènements traités par eventSpec() mais absents de la matrice : ${undeclared.join(", ")}`,
  );
});

test("RED-N7-04 — la matrice couvre les 9 évènements Lot I", () => {
  const mapped = Object.keys(NOTIFICATION_CONTRACT)
    .map((eventType) => mapDispatcherEventToLotI(eventType))
    .filter(Boolean);
  const missing = LOT_I_EVENTS.filter((event) => !mapped.includes(event));
  assert.deepEqual(missing, [], `évènements Lot I absents de la matrice de navigation : ${missing.join(", ")}`);
});

test("RED-N7-05 — les discriminants de cible restent uniques et stables", () => {
  const byType = new Map();
  for (const [eventType, contract] of Object.entries(NOTIFICATION_CONTRACT)) {
    if (!contract.openable) continue;
    const bucket = byType.get(contract.targetType) ?? [];
    bucket.push(eventType);
    byType.set(contract.targetType, bucket);
  }
  // `attendance` est volontairement partagé par absence et retard : même écran cible.
  const shared = [...byType.entries()].filter(([type, events]) => events.length > 1 && type !== "attendance");
  assert.deepEqual(
    shared.map(([type]) => type),
    [],
    "deux évènements distincts ne doivent pas réutiliser le même discriminant de cible",
  );
});
