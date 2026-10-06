"use strict";

const { createHttpError } = require("./classesManagement");
const { isStudentCardCapabilityEnabled, mapSettingsRow } = require("./schoolSettingsManagement");
const { createSchoolSettingsPgStore } = require("../db/schoolSettingsPgStore");
const { scanStudentCard } = require("./studentAccessCardsManagement");

const STUDENT_CARD_ATTENDANCE_ERROR = Object.freeze({
  DISABLED: "STUDENT_CARD_ATTENDANCE_DISABLED",
  STATUS_INVALID: "STUDENT_CARD_ATTENDANCE_STATUS_INVALID",
});

const CARD_ATTENDANCE_STATUSES = Object.freeze(["present", "late"]);
const FORGED_ATTENDANCE_KEYS = Object.freeze([
  "studentId",
  "studentCode",
  "classId",
  "classCode",
  "schoolId",
  "schoolCode",
  "countryCode",
]);

function hasAttendanceIntent(payload) {
  return Boolean(payload)
    && typeof payload === "object"
    && !Array.isArray(payload)
    && Object.prototype.hasOwnProperty.call(payload, "attendance");
}

function settingsStore(repo) {
  if (typeof repo.getSchoolSettingsStore === "function") {
    return repo.getSchoolSettingsStore();
  }
  return createSchoolSettingsPgStore(repo);
}

async function assertStudentCardAttendanceEnabled(repo, schoolId) {
  const store = settingsStore(repo);
  const row = typeof store.getSettings === "function" ? await store.getSettings(schoolId) : null;
  if (!isStudentCardCapabilityEnabled(mapSettingsRow(row), "studentCardAttendanceEnabled")) {
    throw createHttpError(
      404,
      "Pointage par carte désactivé.",
      STUDENT_CARD_ATTENDANCE_ERROR.DISABLED,
    );
  }
}

function invalidStatusError() {
  return createHttpError(
    400,
    "Statut de présence invalide.",
    STUDENT_CARD_ATTENDANCE_ERROR.STATUS_INVALID,
  );
}

/**
 * Construit l'item Présence à partir du resolver. Les identifiants client sont ignorés.
 */
function buildAttendanceItem(resolved, intent) {
  if (intent == null || typeof intent !== "object" || Array.isArray(intent)) {
    throw invalidStatusError();
  }
  const status = typeof intent.status === "string" ? intent.status.trim() : "";
  if (!CARD_ATTENDANCE_STATUSES.includes(status)) {
    throw invalidStatusError();
  }
  const item = {
    studentId: resolved.student.id,
    classId: resolved.class.id,
    classCode: resolved.class.classCode,
    date: intent.date,
    status,
  };
  const teacherId = typeof intent.teacherId === "string" ? intent.teacherId.trim() : "";
  if (teacherId) item.teacherId = teacherId;
  for (const key of FORGED_ATTENDANCE_KEYS) {
    if (key === "studentId" || key === "classId" || key === "classCode") continue;
    if (Object.prototype.hasOwnProperty.call(item, key)) delete item[key];
  }
  return item;
}

async function scanStudentCardHttp(repo, payload, schoolScope, principal, auditMeta) {
  const resolved = await scanStudentCard(repo, { cardToken: payload?.cardToken }, schoolScope);
  if (!hasAttendanceIntent(payload)) {
    return { statusCode: 200, body: resolved };
  }
  await assertStudentCardAttendanceEnabled(repo, schoolScope.schoolId);
  const item = buildAttendanceItem(resolved, payload.attendance);
  const saved = await repo.upsertSchoolAttendanceBatch({ items: [item] }, principal, auditMeta);
  const attendance = Array.isArray(saved) ? saved[0] : saved;
  return {
    statusCode: 201,
    body: {
      ...resolved,
      attendance,
    },
  };
}

module.exports = {
  STUDENT_CARD_ATTENDANCE_ERROR,
  CARD_ATTENDANCE_STATUSES,
  FORGED_ATTENDANCE_KEYS,
  hasAttendanceIntent,
  assertStudentCardAttendanceEnabled,
  buildAttendanceItem,
  scanStudentCardHttp,
};
