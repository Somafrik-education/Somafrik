/**
 * D3.5b — Vérifie que la ligne conservée est la plus récente
 * (updated_at DESC, created_at DESC, id DESC), miroir du CTE SQL.
 */
const assert = require("assert");
const { pickCanonicalAttendanceRow } = require("./attendanceUniqueness");

function run() {
  const older = {
    id: "11111111-1111-1111-1111-111111111111",
    school_id: "school",
    student_id: "student",
    attendance_date: "2026-07-23",
    status: "present",
    created_at: "2026-07-23T08:00:00.000Z",
    updated_at: "2026-07-23T08:00:00.000Z",
  };
  const newer = {
    id: "22222222-2222-2222-2222-222222222222",
    school_id: "school",
    student_id: "student",
    attendance_date: "2026-07-23",
    status: "excused",
    created_at: "2026-07-23T09:00:00.000Z",
    updated_at: "2026-07-23T10:00:00.000Z",
  };

  const kept = pickCanonicalAttendanceRow([older, newer]);
  assert.strictEqual(kept.id, newer.id, "conserve updated_at le plus récent");
  assert.strictEqual(kept.status, "excused");

  const sameUpdated = pickCanonicalAttendanceRow([
    {
      ...older,
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      updated_at: "2026-07-23T10:00:00.000Z",
      created_at: "2026-07-23T08:00:00.000Z",
    },
    {
      ...newer,
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      updated_at: "2026-07-23T10:00:00.000Z",
      created_at: "2026-07-23T09:30:00.000Z",
    },
  ]);
  assert.strictEqual(
    sameUpdated.id,
    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "à updated_at égal, conserve created_at le plus récent",
  );

  const tieBreakId = pickCanonicalAttendanceRow([
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      updated_at: "2026-07-23T10:00:00.000Z",
      created_at: "2026-07-23T10:00:00.000Z",
    },
    {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      updated_at: "2026-07-23T10:00:00.000Z",
      created_at: "2026-07-23T10:00:00.000Z",
    },
  ]);
  assert.strictEqual(
    tieBreakId.id,
    "cccccccc-cccc-cccc-cccc-cccccccccccc",
    "à égalité temporelle, conserve id DESC",
  );

  console.log("attendanceUniqueness.test.js : OK");
}

run();
