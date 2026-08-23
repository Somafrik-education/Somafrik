/**
 *   npx tsx Mobile/src/lib/attendanceStatusTheme.test.ts
 */
import assert from "node:assert/strict";
import {
  ATTENDANCE_STATUS_COLORS,
  ATTENDANCE_STATUS_THEME,
  attendanceActionSlug,
  attendanceStatusTheme,
} from "./attendanceStatusTheme";

function run() {
  assert.equal(ATTENDANCE_STATUS_THEME.Présent.fill, "#16A34A");
  assert.equal(ATTENDANCE_STATUS_THEME.Absent.fill, "#DC2626");
  assert.equal(ATTENDANCE_STATUS_THEME.Retard.fill, "#D97706");
  assert.equal(ATTENDANCE_STATUS_THEME.Justifié.fill, "#2563EB");
  assert.equal(ATTENDANCE_STATUS_THEME.Présent.semantic, "success");
  assert.equal(ATTENDANCE_STATUS_THEME.Absent.semantic, "danger");
  assert.equal(ATTENDANCE_STATUS_THEME.Retard.semantic, "warning");
  assert.equal(ATTENDANCE_STATUS_THEME.Justifié.semantic, "info");

  const idle = attendanceStatusTheme("Présent", { selected: false });
  assert.equal(idle.fill, ATTENDANCE_STATUS_COLORS.idleFill);
  assert.equal(idle.text, ATTENDANCE_STATUS_COLORS.idleText);
  assert.equal(idle.selected, false);
  assert.equal(idle.icon, undefined);

  const selected = attendanceStatusTheme("Absent", { selected: true });
  assert.equal(selected.fill, "#DC2626");
  assert.equal(selected.text, "#FFFFFF");
  assert.equal(selected.selected, true);
  assert.equal(selected.borderWidth, 2);
  assert.equal(selected.fontWeight, "900");

  const disabled = attendanceStatusTheme("Retard", { selected: true, disabled: true });
  assert.equal(disabled.disabled, true);
  assert.equal(disabled.fill, "#D97706");

  assert.equal(attendanceActionSlug("Présent"), "present");
  assert.equal(attendanceActionSlug("Absent"), "absent");
  assert.equal(attendanceActionSlug("Retard"), "late");
  assert.equal(attendanceActionSlug("Justifié"), "excused");

  console.log("attendanceStatusTheme.test.ts OK");
}

run();
