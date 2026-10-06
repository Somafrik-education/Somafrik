import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_CAMERA_PERMISSION,
  STUDENT_CARD_SCAN_COPY,
  applyQrConfirmedPresence,
  cardBelongsToSelectedClass,
  extractQrCapability,
  holdCardToken,
  hydrateAfterQrConfirm,
  isAttendanceAuthorReady,
  isInvalidCardStatus,
  isQrBarcodeType,
  isStaleScanScope,
  isStudentCardAttendanceScanEnabled,
  isStudentCardQrScanEnabled,
  isStudentCardScanFinanceEnabled,
  isoAttendanceDate,
  releaseCardToken,
  runStudentCardScanFlow,
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
assert.doesNotMatch(modal, /Linking\.openURL/);
assert.doesNotMatch(modal, /scanFromURLAsync/);
assert.doesNotMatch(modal, /console\.log/);
assert.doesNotMatch(modal, /safeLogger/);
assert.doesNotMatch(modal, /AsyncStorage|SecureStore|SQLite|submitProtectedMutation|persistOutbox/);
assert.doesNotMatch(modal, /react-native-nfc-manager|expo-nfc|NDEFReader/);
assert.doesNotMatch(modal, /status:\s*"late"|setAttendanceStatus/);
assert.match(api, /\/student-cards\/scan/);
assert.match(api, /httpRequest/);
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
assert.match(attendance, /isStudentCardAttendanceScanEnabled/);
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
