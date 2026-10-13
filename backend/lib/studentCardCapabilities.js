"use strict";

const {
  coerceFailClosedBoolean,
  mapStudentCardFlags,
} = require("./schoolSettingsManagement");
const { createSchoolSettingsPgStore } = require("../db/schoolSettingsPgStore");

const STUDENT_CARD_CAPABILITY_HTTP_KEYS = Object.freeze([
  "studentCardEnabled",
  "studentCardQrEnabled",
  "studentCardNfcEnabled",
  "studentCardAttendanceEnabled",
  "studentCardFinanceCheckEnabled",
]);

function projectStudentCardCapabilitiesHttp(row) {
  const flags = mapStudentCardFlags(row);
  return {
    studentCardEnabled: coerceFailClosedBoolean(flags.studentCardEnabled),
    studentCardQrEnabled: coerceFailClosedBoolean(flags.studentCardQrEnabled),
    studentCardNfcEnabled: coerceFailClosedBoolean(flags.studentCardNfcEnabled),
    studentCardAttendanceEnabled: coerceFailClosedBoolean(flags.studentCardAttendanceEnabled),
    studentCardFinanceCheckEnabled: coerceFailClosedBoolean(flags.studentCardFinanceCheckEnabled),
  };
}

function settingsStore(repo) {
  if (typeof repo?.getSchoolSettingsStore === "function") {
    return repo.getSchoolSettingsStore();
  }
  return createSchoolSettingsPgStore(repo);
}

async function readStudentCardCapabilities(repo, schoolId) {
  const store = settingsStore(repo);
  const row = typeof store.getSettings === "function" ? await store.getSettings(schoolId) : null;
  return projectStudentCardCapabilitiesHttp(row);
}

module.exports = {
  STUDENT_CARD_CAPABILITY_HTTP_KEYS,
  projectStudentCardCapabilitiesHttp,
  readStudentCardCapabilities,
};
