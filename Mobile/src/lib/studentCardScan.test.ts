import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_CAMERA_PERMISSION,
  STUDENT_CARD_SCAN_COPY,
  applyQrConfirmedPresence,
  attendanceClassScopeKey,
  cardBelongsToSelectedClass,
  decideCameraPermissionPrompt,
  decideQrScannerForeground,
  extractQrCapability,
  hasValidSelectedClass,
  holdCardToken,
  hydrateAfterQrConfirm,
  initialQrScannerUiState,
  isAttendanceAuthorReady,
  isInvalidCardStatus,
  isQrBarcodeType,
  isQrScannerCameraLive,
  isStaleScanScope,
  isStudentCardAttendanceScanEnabled,
  isStudentCardQrScanEnabled,
  isStudentCardQrScannerVisible,
  isStudentCardScanFinanceEnabled,
  reduceQrScannerUi,
  sanitizeStudentCardCapabilities,
  isoAttendanceDate,
  releaseCardToken,
  runStudentCardScanFlow,
  shouldCloseQrScannerForClassChange,
  shouldCloseQrScannerForTenantChange,
  studentCardScanErrorMessage,
  type StudentCardScanResolved,
  type VolatileCardToken,
} from "./studentCardScan";

assert.equal(
  CANONICAL_CAMERA_PERMISSION,
  "Somafrik utilise l’appareil photo pour prendre la photo du compte et scanner les cartes élève par QR code.",
);
assert.equal(STUDENT_CARD_SCAN_COPY.button, "Scanner une carte QR");
assert.equal(STUDENT_CARD_SCAN_COPY.permissionDenied, "Caméra non autorisée. Le scanner QR est indisponible.");
assert.equal(STUDENT_CARD_SCAN_COPY.offline, "Le scan QR nécessite une connexion Internet.");
assert.equal(
  STUDENT_CARD_SCAN_COPY.classMismatch,
  "Cette carte n’appartient pas à la classe actuellement sélectionnée.",
);
assert.equal(STUDENT_CARD_SCAN_COPY.invalidCard, "Cette carte n’est plus valide.");

assert.equal(isStudentCardQrScanEnabled(null), false);
assert.equal(isStudentCardAttendanceScanEnabled({ studentCardEnabled: true }), false);
assert.equal(
  isStudentCardAttendanceScanEnabled({ studentCardEnabled: true, studentCardQrEnabled: true }),
  false,
  "QR sans attendance → pas de scanner",
);
assert.equal(
  isStudentCardAttendanceScanEnabled({
    studentCardEnabled: true,
    studentCardQrEnabled: false,
    studentCardAttendanceEnabled: true,
  }),
  false,
  "master ON + QR OFF → aucun scanner",
);
assert.equal(
  isStudentCardAttendanceScanEnabled({
    studentCardEnabled: true,
    studentCardQrEnabled: true,
    studentCardAttendanceEnabled: true,
  }),
  true,
);

const validClass = { classId: "cls-1", classCode: "5A" };
assert.equal(
  isStudentCardQrScannerVisible({
    canUpdatePresences: true,
    settings: {
      studentCardEnabled: true,
      studentCardQrEnabled: true,
      studentCardAttendanceEnabled: true,
    },
    selectedClass: validClass,
  }),
  true,
  "MOB-CAP-02",
);
assert.equal(
  isStudentCardQrScannerVisible({
    canUpdatePresences: true,
    settings: {
      studentCardEnabled: false,
      studentCardQrEnabled: true,
      studentCardAttendanceEnabled: true,
    },
    selectedClass: validClass,
  }),
  false,
  "MOB-CAP-03 master",
);
assert.equal(
  isStudentCardQrScannerVisible({
    canUpdatePresences: true,
    settings: {
      studentCardEnabled: true,
      studentCardQrEnabled: false,
      studentCardAttendanceEnabled: true,
    },
    selectedClass: validClass,
  }),
  false,
  "MOB-CAP-04 QR",
);
assert.equal(
  isStudentCardQrScannerVisible({
    canUpdatePresences: true,
    settings: {
      studentCardEnabled: true,
      studentCardQrEnabled: true,
      studentCardAttendanceEnabled: false,
    },
    selectedClass: validClass,
  }),
  false,
  "MOB-CAP-05 attendance",
);
assert.equal(
  isStudentCardQrScannerVisible({
    canUpdatePresences: true,
    settings: null,
    selectedClass: validClass,
  }),
  false,
  "MOB-CAP-06 erreur/null",
);
assert.equal(
  isStudentCardQrScannerVisible({
    canUpdatePresences: false,
    settings: {
      studentCardEnabled: true,
      studentCardQrEnabled: true,
      studentCardAttendanceEnabled: true,
    },
    selectedClass: validClass,
  }),
  false,
  "MOB-CAP-02 sans Présences CREATE/UPDATE",
);

assert.equal(
  decideCameraPermissionPrompt({
    visible: true,
    permission: { granted: true, canAskAgain: true },
    alreadyRequested: false,
  }),
  "granted",
  "QR-LIFE-01 granted → pas de requestPermission",
);
assert.equal(
  decideCameraPermissionPrompt({ visible: true, permission: null, alreadyRequested: false }),
  "wait",
  "QR-LIFE-02 permission inconnue",
);
assert.equal(
  decideCameraPermissionPrompt({
    visible: true,
    permission: { granted: false, canAskAgain: true },
    alreadyRequested: false,
  }),
  "request",
  "QR-LIFE-03 ouverture explicite → une demande",
);
assert.equal(
  decideCameraPermissionPrompt({
    visible: true,
    permission: { granted: false, canAskAgain: true },
    alreadyRequested: true,
  }),
  "idle",
  "QR-LIFE-03 pas de boucle",
);
assert.equal(
  decideCameraPermissionPrompt({
    visible: true,
    permission: { granted: false, canAskAgain: false },
    alreadyRequested: false,
  }),
  "blocked",
  "QR-LIFE-04 canAskAgain=false",
);

const inactive = decideQrScannerForeground({
  nextAppState: "inactive",
  visible: true,
  permissionGranted: true,
  busy: false,
  hasResult: false,
});
assert.equal(inactive.releaseToken, true, "QR-LIFE-05 token libéré");
assert.equal(inactive.pauseCamera, true, "QR-LIFE-05 paused");
assert.equal(inactive.closeModal, false);
const rearm = decideQrScannerForeground({
  nextAppState: "active",
  visible: true,
  permissionGranted: true,
  busy: false,
  hasResult: false,
});
assert.equal(rearm.rearmCamera, true, "QR-LIFE-06 réarmement");
assert.equal(rearm.closeModal, false);
assert.equal(
  decideQrScannerForeground({
    nextAppState: "active",
    visible: true,
    permissionGranted: true,
    busy: true,
    hasResult: false,
  }).rearmCamera,
  false,
  "QR-LIFE-07 busy",
);
assert.equal(
  decideQrScannerForeground({
    nextAppState: "active",
    visible: true,
    permissionGranted: true,
    busy: false,
    hasResult: true,
  }).rearmCamera,
  false,
  "QR-LIFE-08 résultat présent",
);

const classA = { classId: "cls-1", classCode: "5A", className: "5ème A" };
const classAAlias = { classId: "cls-1", classCode: "5A", className: "5ème A (alias)" };
const classB = { classId: "cls-2", classCode: "5B", className: "5ème B" };
assert.equal(attendanceClassScopeKey(classA), attendanceClassScopeKey(classAAlias));
assert.equal(
  shouldCloseQrScannerForClassChange(attendanceClassScopeKey(classA), attendanceClassScopeKey(classB)),
  true,
  "QR-LIFE-09 classe réelle",
);
assert.equal(
  shouldCloseQrScannerForClassChange(attendanceClassScopeKey(classA), attendanceClassScopeKey(classAAlias)),
  false,
  "QR-LIFE-10 même classe, nouvelle référence",
);
assert.equal(shouldCloseQrScannerForTenantChange("user|CD-LAC-26-001", "user|CD-LAC-26-001"), false);
assert.equal(
  shouldCloseQrScannerForTenantChange("user|CD-LAC-26-001", "user|BI-BUJ-26-001"),
  true,
  "QR-LIFE-11 tenant réel",
);

let life = initialQrScannerUiState({ permission: { granted: true } });
life = reduceQrScannerUi(life, { type: "setVisible", visible: true });
assert.equal(life.lastPrompt, "granted", "QR-LIFE-01 reducer");
life = reduceQrScannerUi(life, { type: "holdToken" });
life = reduceQrScannerUi(life, { type: "appState", next: "inactive" });
assert.equal(life.tokenHeld, false, "QR-LIFE-05/12 token libéré");
assert.equal(life.paused, true);
assert.equal(life.modalClosed, false, "AppState ne ferme pas le modal");
life = reduceQrScannerUi(life, { type: "appState", next: "active" });
assert.equal(life.paused, false, "QR-LIFE-06 caméra réarmée");
assert.equal(life.visible, true);
assert.equal(
  isQrScannerCameraLive({
    visible: life.visible,
    appActive: life.appActive,
    permissionGranted: true,
    paused: life.paused,
    hasResult: life.hasResult,
    busy: life.busy,
  }),
  true,
  "CameraView redevient active",
);
life = reduceQrScannerUi(life, {
  type: "classScope",
  previous: attendanceClassScopeKey(classA),
  next: attendanceClassScopeKey(classAAlias),
});
assert.equal(life.visible, true, "QR-LIFE-10 reducer");
life = reduceQrScannerUi(life, {
  type: "classScope",
  previous: attendanceClassScopeKey(classA),
  next: attendanceClassScopeKey(classB),
});
assert.equal(life.visible, false, "QR-LIFE-09 reducer");
assert.equal(life.modalClosed, true);
life = reduceQrScannerUi(initialQrScannerUiState({ visible: true, permission: { granted: true } }), {
  type: "tenantScope",
  previous: "user|A",
  next: "user|A",
});
assert.equal(life.visible, true, "même resourceScopeKey → pas de fermeture");
life = reduceQrScannerUi(life, { type: "tenantScope", previous: "user|A", next: "user|B" });
assert.equal(life.tokenHeld, false, "QR-LIFE-11 token libéré");
assert.equal(life.modalClosed, true);

const remount = reduceQrScannerUi(
  reduceQrScannerUi(
    initialQrScannerUiState({ visible: true, permission: { granted: true }, tokenHeld: true }),
    { type: "setVisible", visible: false },
  ),
  { type: "setVisible", visible: true },
);
assert.equal(remount.tokenHeld, false, "QR-LIFE-12 pas de fuite token après remount");
assert.equal(remount.lastPrompt, "granted");
assert.equal(remount.visible, true);
assert.equal(sanitizeStudentCardCapabilities(undefined), null);
assert.equal(sanitizeStudentCardCapabilities("oui"), null);
assert.deepEqual(
  sanitizeStudentCardCapabilities({
    studentCardEnabled: true,
    studentCardQrEnabled: "true",
    studentCardAttendanceEnabled: 1,
    schoolName: "Secret",
  }),
  {
    studentCardEnabled: true,
    studentCardQrEnabled: false,
    studentCardAttendanceEnabled: false,
    studentCardFinanceCheckEnabled: false,
  },
);
assert.equal(
  isStudentCardScanFinanceEnabled({
    studentCardEnabled: true,
    studentCardQrEnabled: true,
    studentCardFinanceCheckEnabled: true,
  }),
  true,
);
assert.equal(
  isStudentCardScanFinanceEnabled({
    studentCardEnabled: true,
    studentCardQrEnabled: true,
    studentCardFinanceCheckEnabled: false,
  }),
  false,
);

assert.equal(extractQrCapability("  abc.def  "), "abc.def");
assert.equal(extractQrCapability(""), "");
assert.equal(extractQrCapability("x".repeat(300)), "");
assert.equal(isQrBarcodeType("qr"), true);
assert.equal(isQrBarcodeType("org.iso.QRCode"), true);
assert.equal(isQrBarcodeType("ean13"), false);
assert.equal(isQrBarcodeType("code128"), false);

const holder: VolatileCardToken = { current: null };
assert.equal(holdCardToken(holder, "pub.secret"), true);
assert.equal(holder.current, "pub.secret");
assert.equal(holdCardToken(holder, "other.token"), false, "double callback → une seule résolution");
releaseCardToken(holder);
assert.equal(holder.current, null);

assert.equal(
  studentCardScanErrorMessage({ code: "TOKEN_INVALID" }),
  "QR illisible ou carte non reconnue.",
);
assert.equal(studentCardScanErrorMessage({ code: "DISABLED" }), "La carte élève est désactivée pour cet établissement.");
assert.equal(studentCardScanErrorMessage({ code: "INVALID_STATE" }), STUDENT_CARD_SCAN_COPY.invalidCard);
assert.match(isoAttendanceDate(new Date("2026-10-06T12:00:00")), /^\d{4}-\d{2}-\d{2}$/);

assert.equal(
  cardBelongsToSelectedClass({ id: "cls-1", classCode: "A", className: "CM1" }, { classId: "cls-1", classCode: "A" }),
  true,
);
assert.equal(
  cardBelongsToSelectedClass({ id: "cls-2", classCode: "A", className: "CM1" }, { classId: "cls-1", classCode: "A" }),
  false,
  "id différent prime sur classCode",
);
assert.equal(
  cardBelongsToSelectedClass({ classCode: "B1" }, { classCode: "B1", className: "CM2" }),
  true,
);
assert.equal(
  cardBelongsToSelectedClass({ className: "CM1" }, { className: "CM1" }),
  false,
  "nom seul insuffisant",
);
assert.equal(hasValidSelectedClass({ className: "CM1" }), false);
assert.equal(hasValidSelectedClass({ classId: "cls-1", classCode: "A", className: "CM1" }), true);
assert.equal(isInvalidCardStatus("lost"), true);
assert.equal(isInvalidCardStatus("revoked"), true);
assert.equal(isInvalidCardStatus("replaced"), true);
assert.equal(isInvalidCardStatus("active"), false);

assert.deepEqual(isAttendanceAuthorReady({ status: "teacher_session" }), { ok: true });
assert.deepEqual(isAttendanceAuthorReady({ status: "auto", teacherId: "t1" }), { ok: true, teacherId: "t1" });
assert.deepEqual(isAttendanceAuthorReady({ status: "need_selection" }), { ok: false });

assert.equal(
  isStaleScanScope(
    { generation: 1, resourceScopeKey: "A", schoolCode: "SCH-A", classId: "c1", classCode: "A" },
    { generation: 2, resourceScopeKey: "A", schoolCode: "SCH-A", classId: "c1", classCode: "A" },
  ),
  true,
);
assert.equal(
  isStaleScanScope(
    { generation: 1, resourceScopeKey: "A", schoolCode: "SCH-A", classId: "c1", classCode: "A" },
    { generation: 1, resourceScopeKey: "B", schoolCode: "SCH-A", classId: "c1", classCode: "A" },
  ),
  true,
);

const resolvedSameClass: StudentCardScanResolved = {
  card: { status: "active" },
  student: { id: "stu-1", studentCode: "M-1", firstName: "Awa", lastName: "Diop" },
  class: { id: "cls-1", classCode: "A", className: "CM1 A" },
};

function scope(generation = 1) {
  return { generation, resourceScopeKey: "SCH-A", schoolCode: "SCH-A", classId: "cls-1", classCode: "A" };
}

async function flow(
  overrides: Partial<{
    isOffline: () => boolean;
    author: { status: string; teacherId?: string };
    financeEnabled: boolean;
    scope: ReturnType<typeof scope>;
    currentScope: () => ReturnType<typeof scope>;
    resolveCard: () => Promise<StudentCardScanResolved>;
    recordAttendance: (
      token: string,
      attendance: { date: string; status: "present"; teacherId?: string },
      key: string,
    ) => Promise<StudentCardScanResolved>;
    readFinance: () => Promise<StudentCardScanResolved>;
  }> = {},
) {
  const calls: string[] = [];
  const outcome = await runStudentCardScanFlow({
    cardToken: "synthetic.token",
    scope: overrides.scope ?? scope(),
    selectedClass: { classId: "cls-1", classCode: "A" },
    author: overrides.author ?? { status: "teacher_session" },
    attendanceDate: "2026-10-06",
    financeEnabled: overrides.financeEnabled ?? false,
    isOffline: overrides.isOffline ?? (() => false),
    currentScope: overrides.currentScope ?? (() => scope()),
    resolveCard: async () => {
      calls.push("resolve");
      return overrides.resolveCard ? overrides.resolveCard() : resolvedSameClass;
    },
    recordAttendance: async (_token, attendance, key) => {
      calls.push(`attendance:${attendance.status}:${key}`);
      if (overrides.recordAttendance) return overrides.recordAttendance(_token, attendance, key);
      return { ...resolvedSameClass, attendance: { status: "present", date: attendance.date } };
    },
    readFinance: async () => {
      calls.push("finance");
      if (overrides.readFinance) return overrides.readFinance();
      return { finance: { code: "UP_TO_DATE", label: "À jour" } };
    },
    createIdempotencyKey: () => "11111111-1111-4111-8111-111111111111",
  });
  return { outcome, calls };
}

async function runFlowCases() {
{
  const { outcome, calls } = await flow({ isOffline: () => true });
  assert.equal(outcome.kind, "offline");
  assert.deepEqual(calls, []);
}

{
  const { outcome, calls } = await flow({ author: { status: "need_selection" } });
  assert.equal(outcome.kind, "teacher_unresolved");
  assert.deepEqual(calls, []);
}

{
  const outcome = await runStudentCardScanFlow({
    cardToken: "synthetic.token",
    scope: scope(),
    selectedClass: { className: "CM1" },
    author: { status: "teacher_session" },
    attendanceDate: "2026-10-06",
    financeEnabled: false,
    isOffline: () => false,
    currentScope: () => scope(),
    resolveCard: async () => resolvedSameClass,
    recordAttendance: async () => resolvedSameClass,
    createIdempotencyKey: () => "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(outcome.kind, "error");
}

{
  const { outcome, calls } = await flow({
    resolveCard: async () => ({
      ...resolvedSameClass,
      class: { id: "cls-other", classCode: "Z", className: "CM2" },
    }),
  });
  assert.equal(outcome.kind, "class_mismatch");
  assert.equal(calls.includes("resolve"), true);
  assert.equal(calls.some((row) => row.startsWith("attendance:")), false);
}

{
  const { outcome, calls } = await flow({
    resolveCard: async () => ({ ...resolvedSameClass, card: { status: "lost" } }),
  });
  assert.equal(outcome.kind, "invalid_card");
  assert.equal(calls.some((row) => row.startsWith("attendance:")), false);
}

{
  const { outcome, calls } = await flow();
  assert.equal(outcome.kind, "success");
  if (outcome.kind === "success") {
    assert.equal(outcome.view.attendanceRecorded, true);
    assert.equal(outcome.view.studentName, "Awa Diop");
    assert.equal(outcome.view.financeLabel, "");
  }
  assert.deepEqual(
    calls,
    ["resolve", "attendance:present:11111111-1111-4111-8111-111111111111"],
    "resolve avant attendance, pas de finance si OFF",
  );
}

{
  let postedTeacherId: string | undefined = "sentinel";
  const { outcome } = await flow({
    author: { status: "teacher_session" },
    recordAttendance: async (_token, attendance) => {
      postedTeacherId = attendance.teacherId;
      return { ...resolvedSameClass, attendance: { status: "present", date: attendance.date } };
    },
  });
  assert.equal(outcome.kind, "success");
  assert.equal(postedTeacherId, undefined, "AUTHOR-01.7 teacher_session : aucun teacherId injecté");
}

{
  const { outcome, calls } = await flow({ financeEnabled: true });
  assert.equal(outcome.kind, "success");
  if (outcome.kind === "success") {
    assert.equal(outcome.view.financeLabel, "À jour");
    assert.equal(outcome.view.attendanceRecorded, true);
  }
  assert.deepEqual(calls, [
    "resolve",
    "attendance:present:11111111-1111-4111-8111-111111111111",
    "finance",
  ]);
}

{
  const { outcome, calls } = await flow({
    financeEnabled: true,
    readFinance: async () => {
      throw Object.assign(new Error("timeout"), { code: "TIMEOUT" });
    },
  });
  assert.equal(outcome.kind, "success");
  if (outcome.kind === "success") {
    assert.equal(outcome.view.attendanceRecorded, true);
    assert.equal(outcome.view.financeUnavailable, true);
  }
  assert.equal(calls.some((row) => row.startsWith("attendance:")), true);
}

{
  let current = scope(1);
  const { outcome } = await flow({
    scope: scope(1),
    currentScope: () => current,
    resolveCard: async () => {
      current = scope(2);
      return resolvedSameClass;
    },
  });
  assert.equal(outcome.kind, "stale", "scan A pending → école/génération B → réponse A ignorée");
}

{
  let current = scope(1);
  const { outcome, calls } = await flow({
    scope: scope(1),
    currentScope: () => current,
    resolveCard: async () => resolvedSameClass,
    recordAttendance: async () => {
      current = { ...scope(1), classId: "cls-2", classCode: "B" };
      return resolvedSameClass;
    },
  });
  assert.equal(outcome.kind, "stale", "attendance A pending → changement classe → résultat A ignoré");
  assert.equal(calls.some((row) => row.startsWith("attendance:")), true);
}

{
  let current = scope(1);
  const { outcome } = await flow({
    financeEnabled: true,
    scope: scope(1),
    currentScope: () => current,
    readFinance: async () => {
      current = { ...scope(1), resourceScopeKey: "SCH-B", schoolCode: "SCH-B" };
      return { finance: { code: "OVERDUE", label: "Échéance impayée" } };
    },
  });
  assert.equal(outcome.kind, "stale", "finance A pending → changement scope → badge A ignoré");
}
}

void runFlowCases()
  .then(() => {
    console.log("studentCardScan.test.ts OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

{
  const afterDraft = applyQrConfirmedPresence(
    {
      "stu-1": { status: "Absent", source: "draft", modifiedAt: "06-10-2026 10:00" },
    },
    "stu-1",
  );
  assert.equal(afterDraft["stu-1"].status, "Présent");
  assert.equal(afterDraft["stu-1"].source, "postgres");
  assert.equal(afterDraft["stu-1"].modifiedAt, undefined);
  const kept = hydrateAfterQrConfirm(afterDraft["stu-1"], {
    status: "Absent",
    source: "draft",
    modifiedAt: "06-10-2026 10:00",
  });
  assert.equal(kept?.status, "Présent", "scan confirmé non écrasé par un ancien draft");
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const modal = read("components/StudentCardQrScannerModal.tsx");
const attendance = read("screens/TeacherAttendanceScreen.tsx");
const api = read("services/studentCardScanApi.ts");
const appJson = read("../app.json");
const inventory = fs.readFileSync(path.join(root, "../../docs/mobile/PLAY-STORE-DATA-INVENTORY.md"), "utf8");

assert.match(modal, /CameraView/);
assert.match(modal, /barcodeTypes:\s*\["qr"\]/);
assert.match(modal, /useCameraPermissions/);
assert.match(modal, /Linking\.openSettings/);
assert.match(modal, /decideCameraPermissionPrompt/);
assert.match(modal, /decideQrScannerForeground/);
assert.match(modal, /isQrScannerCameraLive/);
assert.match(modal, /visibleRef/);
assert.match(modal, /permissionGrantedRef/);
assert.match(modal, /busyRef/);
assert.match(modal, /resultRef/);
assert.doesNotMatch(modal, /AppState\.addEventListener\([\s\S]{0,800}onClose\(/);
assert.doesNotMatch(modal, /Linking\.openURL/);
assert.doesNotMatch(modal, /scanFromURLAsync/);
assert.doesNotMatch(modal, /console\.log/);
assert.doesNotMatch(modal, /safeLogger/);
assert.doesNotMatch(modal, /AsyncStorage|SecureStore|SQLite|submitProtectedMutation|persistOutbox/);
assert.doesNotMatch(modal, /react-native-nfc-manager|expo-nfc|NDEFReader/);
assert.doesNotMatch(modal, /status:\s*"late"|setAttendanceStatus/);
assert.match(api, /\/student-cards\/scan/);
assert.match(api, /httpRequest<StudentCardCapabilities>\("\/student-cards\/capabilities"/);
assert.doesNotMatch(api, /schoolCode/);
assert.match(api, /httpRequest/);
assert.match(api, /export function getStudentCardCapabilities/);
assert.match(api, /export function resolveStudentCard/);
assert.match(api, /export function recordStudentCardAttendance/);
assert.match(api, /export function readStudentCardFinance/);
assert.doesNotMatch(api, /attendance:[\s\S]{0,80}finance:\s*true/);
assert.doesNotMatch(api, /console\.log/);

assert.match(attendance, /USABILITY_TEST_IDS\.attendanceSave/);
assert.match(attendance, /USABILITY_TEST_IDS\.attendanceMarkAllPresent/);
assert.match(attendance, /ATTENDANCE_ACTIONS/);
assert.match(attendance, /Tout présent/);
assert.match(attendance, /Enregistrer l'appel/);
assert.match(attendance, /USABILITY_TEST_IDS\.attendanceScanQr/);
assert.match(attendance, /StudentCardQrScannerModal/);
assert.match(attendance, /isStudentCardQrScannerVisible/);
assert.match(attendance, /getStudentCardCapabilities/);
assert.match(attendance, /sanitizeStudentCardCapabilities/);
assert.match(attendance, /attendanceClassScopeKey/);
assert.match(attendance, /selectedClassScopeKey/);
assert.doesNotMatch(attendance, /setScannerOpen\(false\);\s*\}, \[selectedClass\]\)/);
assert.doesNotMatch(attendance, /getSchoolSettings\(/);
assert.doesNotMatch(attendance, /Paramètres Établissement:READ/);
assert.doesNotMatch(attendance, /navigate\("StudentCardScan"/);
assert.doesNotMatch(attendance, /useCameraPermissions|requestCameraPermissionsAsync/);
assert.doesNotMatch(attendance, /CameraView/);
assert.doesNotMatch(JSON.stringify(modal.match(/synthetic\.token|pub\.secret/) || []), /token/);

assert.match(appJson, /"expo-camera"/);
assert.match(appJson, /"recordAudioAndroid": false/);
assert.equal(
  (appJson.match(/Somafrik utilise l’appareil photo pour prendre la photo du compte et scanner les cartes élève par QR code\./g) || [])
    .length,
  2,
  "chaîne caméra duale identique sur image-picker et camera",
);
assert.match(inventory, /Identifiant carte élève \/ QR/);
assert.doesNotMatch(modal + api + attendance, /TOKEN_TEST|publicId\.secret/);
