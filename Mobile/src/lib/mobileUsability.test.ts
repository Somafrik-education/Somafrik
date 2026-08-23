import assert from "node:assert/strict";
import {
  ATTENDANCE_ACTIONS,
  USABILITY_TEST_IDS,
  DEFAULT_ANDROID_KEYBOARD_HEIGHT,
  MIN_TOUCH_TARGET_DP,
  SMALL_ANDROID_VIEWPORT,
  attendanceActionForStudent,
  compactPersonLine,
  filterClassesByQuery,
  formatMoneyAmount,
  iconButtonAccessibility,
  keyboardFormLayout,
  layoutPaymentReceipt,
  loginKeyboardScenario,
  messagesComposerKeyboardScenario,
  notesLastStudentKeyboardScenario,
  planningChipState,
  statusHasNonColorCue,
  statusPresentation,
  touchTargetMeetsMinimum,
} from "./mobileUsability";

const classes = [
  { id: "1", name: "6e A", classCode: "CLS-6A" },
  { id: "2", name: "5e B", classCode: "CLS-5B" },
  { id: "3", name: "Terminale C", classCode: "CLS-TC" },
];

assert.deepEqual(
  filterClassesByQuery(classes, "term").map((row) => row.name),
  ["Terminale C"],
  "search term → Terminale C",
);
assert.deepEqual(
  filterClassesByQuery(classes, "CLS-5B").map((row) => row.name),
  ["5e B"],
  "search code → classe correspondante",
);
assert.deepEqual(filterClassesByQuery(classes, "  6E a  ").map((row) => row.name), ["6e A"]);
assert.deepEqual(
  filterClassesByQuery([{ id: "4", name: "4e D", publicId: "CLS-4D" }], "cls-4d").map((row) => row.name),
  ["4e D"],
  "search publicId → classe correspondante",
);
assert.equal(filterClassesByQuery(classes, "xyz-inexistant").length, 0, "search inexistant → empty");

const login = loginKeyboardScenario();
assert.equal(login.withoutScroll.visibleHeight, SMALL_ANDROID_VIEWPORT.height - DEFAULT_ANDROID_KEYBOARD_HEIGHT);
assert.equal(login.withoutScroll.ctaVisible, false, "sans scroll le CTA est sous le clavier");
assert.equal(login.withScroll.ctaVisible, true, "avec scroll le CTA Connexion est atteignable");
assert.equal(login.withScroll.focusedFieldVisible, true);
assert.equal(login.withScroll.errorVisible, true);

const notes = notesLastStudentKeyboardScenario(50);
assert.equal(notes.withoutScroll.focusedFieldVisible, false, "50e élève hors zone visible clavier ouvert");
assert.equal(notes.withScroll.focusedFieldVisible, true, "scroll rend le dernier champ de note visible");
assert.equal(notes.withScroll.ctaVisible, true, "CTA Enregistrer atteignable");

const composer = messagesComposerKeyboardScenario();
assert.equal(composer.withoutScroll.ctaVisible, false);
assert.equal(composer.withScroll.ctaVisible, true);
assert.equal(composer.withScroll.focusedFieldVisible, true);

assert.equal(touchTargetMeetsMinimum({ width: 28, height: 28 }), false);
assert.equal(touchTargetMeetsMinimum({ width: 28, height: 28, hitSlop: { top: 8, bottom: 8, left: 8, right: 8 } }), true);
assert.equal(touchTargetMeetsMinimum({ width: 44, height: 44 }), true);
assert.equal(MIN_TOUCH_TARGET_DP, 44);

const receipt = layoutPaymentReceipt(
  [
    { feeLabel: "Minerval", amount: 500 },
    { feeLabel: "Examen", amount: 1 },
    { feeLabel: "Cantine", amount: 40 },
  ],
  541,
);
assert.equal(receipt.lines.length, 3);
assert.equal(receipt.lines[0].amountText.includes("500"), true);
assert.equal(receipt.lines[1].amountText.includes("1"), true);
assert.equal(receipt.lines[2].amountText.includes("40"), true);
assert.equal(receipt.total, 541);
assert.match(receipt.totalText, /541/);
assert.equal(receipt.truncatedCritical, false);
assert.equal(formatMoneyAmount(541).includes("…"), false);

assert.equal(statusHasNonColorCue("Payé"), true);
assert.equal(statusPresentation("Payé").label.toLowerCase().includes("pay"), true);
assert.equal(statusPresentation("Impayé").icon.length > 0, true);
assert.equal(statusPresentation("Présent").label, "Présent");
assert.equal(statusPresentation("Validée").icon, "shield-checkmark");
assert.equal(statusPresentation("queued").label.length > 0, true);

const present = attendanceActionForStudent("stu-42", "Présent");
assert.equal(present.studentId, "stu-42");
assert.equal(present.testID, "attendance-action-stu-42-present");
assert.equal(attendanceActionForStudent("stu-42", "Retard").testID, "attendance-action-stu-42-late");
assert.equal(attendanceActionForStudent("stu-42", "Justifié").testID, "attendance-action-stu-42-excused");
assert.equal(USABILITY_TEST_IDS.attendanceCurrentStatus("QA-ATT-A1"), "attendance-current-status-QA-ATT-A1");
assert.equal(
  USABILITY_TEST_IDS.attendanceCurrentStatusValue("QA-ATT-A1", "Présent"),
  "attendance-current-status-QA-ATT-A1-present",
);
assert.equal(
  USABILITY_TEST_IDS.attendanceCurrentStatusValue("QA-ATT-B1", "Absent"),
  "attendance-current-status-QA-ATT-B1-absent",
);
assert.match(present.accessibilityLabel, /Présent/);
assert.deepEqual(ATTENDANCE_ACTIONS, ["Présent", "Absent", "Retard", "Justifié"]);

const chip = planningChipState(true);
assert.equal(chip.minHeight, 44);
assert.equal(chip.accessibilityState.selected, true);
assert.equal(planningChipState(false).accessibilityState.selected, false);

assert.equal(
  iconButtonAccessibility("Modifier l'enseignant", "Jean Tshibangu"),
  "Modifier l'enseignant Jean Tshibangu",
);
assert.notEqual(iconButtonAccessibility("Fermer"), "button");

assert.match(
  compactPersonLine(["Jean-Baptiste Mukendi Tshibangu", "administrateur établissement", "+243800000000"]),
  /Jean-Baptiste/,
);

const modal = keyboardFormLayout({
  viewportHeight: 568,
  keyboardHeight: 260,
  focusedFieldBottom: 520,
  ctaBottom: 560,
  scrollOffset: 280,
});
assert.equal(modal.ctaVisible, true, "modal 320px + clavier : CTA scrollable");

console.log("mobileUsability.test.ts OK");
